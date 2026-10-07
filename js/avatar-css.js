/*
  mihumanidad · Avatar — implementación de RESPALDO (sin canvas, sin WebGL)

  Contrato (idéntico al de las variantes del laboratorio):
    export function mountAvatar(el, opts = {}) -> { destroy(), setHumanity(v) }
    opts.src         retrato con transparencia, relativo a la página   (assets/img/avatar.webp)
    opts.depth       mapa de profundidad; esta versión no lo necesita  (assets/img/avatar-depth.png)
    opts.onHumanity  callback(frac 0..1) unas 9 veces por segundo
    opts.onReady     callback() una vez, cuando el retrato ya se ve (o no hay imagen que mostrar)

  Cómo funciona:
    · Dos copias del retrato (<img>): la foto real y un duplicado cian translúcido
      con líneas de barrido (repeating-linear-gradient) y mix-blend-mode.
    · El campo de humanidad H(x,y,t) se dibuja con máscaras CSS: un degradado base
      en diagonal, mordido por manchas que tallan holograma y unido a manchas que se
      asoman al holograma. Las máscaras de la foto y del holograma son complementarias
      exactas (mask-composite add / intersect).
    · La banda de frontera es el producto de la región humana dilatada por la
      región holograma dilatada: un borde cian de puntos con resplandor, más
      partículas y chispas en el DOM que se ensamblan sobre ella.
    · El mismo campo se evalúa en JS (rejilla de 24 × 32 ponderada por la silueta)
      para onHumanity y para un control lento que mantiene la humanidad base
      oscilando entre ~55 % y ~80 %.

  Sin dependencias externas: debe poder abrirse igual dentro de muchos años.
*/

const LABEL = 'Retrato de Alfredo, sonriente: cabello negro, lentes de armazón metálico delgado, bigote largo con las puntas enroscadas y piocha; camisa blanca con pines dorados en forma de alas en el cuello y chaleco gris. Una parte del retrato es holograma en construcción.';

const A = 4 / 3;            // alto / ancho del retrato (3:4). Coordenadas en "unidades de ancho".
const DEG = Math.PI / 180;
const TAU = Math.PI * 2;

/* Silueta aproximada: alfa medio del retrato en una rejilla de 24 × 32 (0–9). */
const GW = 24;
const GH = 32;
const ALPHA = Float32Array.from(
  '000000000000000000000000000000000445531000000000000000007999999400000000000000059999999972000000' +
  '000000299999999998100000000001999999999999400000000007999999999999700000000029999999999999910000' +
  '000039999999999999950000000049999999999999940000000029999999999999910000000019999999999999510000' +
  '000019999999999999100000000039999999999999300000000019999999999999300000000007999999999999200000' +
  '000002799999999999100000000000199999999997000000000000059999999993000000000000039999999950000000' +
  '000000029999999910000000000000019999999920000000000000059999999960000000000000089999999992000000' +
  '000015899999999999710000014799999999999999996200599999999999999999999961999999999999999999999999' +
  '999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999',
  (c) => Number(c) / 9
);

/* ------------------------------------------------------------------ */
/* Parámetros del campo                                                */
/* ------------------------------------------------------------------ */
const CFG = {
  angle: 64,        // ángulo CSS del degradado base: lo humano abajo-izquierda, el holograma arriba-derecha
  w: 0.045,         // semiancho de la rampa base (fracción de la línea del degradado)
  core: 0.62,       // núcleo sólido de las manchas (fracción del radio)
  span: 1.3,        // largo del tramo de frontera donde viven las manchas
  haloR: 0.25,      // radio del halo del puntero (unidades de ancho)
  haloCore: 0.18,
  gain: 1.5,        // control de la frontera hacia la humanidad objetivo
  edge: { core: 0.9, w: 0.01, d: 0.0045 }   // banda de construcción (borde luminoso)
};
const SIN = Math.sin(CFG.angle * DEG);
const COS = Math.cos(CFG.angle * DEG);
const LEN = Math.abs(SIN) + A * Math.abs(COS);   // largo de la línea del degradado CSS
const NX = SIN, NY = -COS;                        // normal hacia el holograma
const TX = COS, TY = SIN;                         // tangente a la frontera

/* Manchas que agregan humanidad (se asoman al holograma) y que tallan holograma.
   Todas cruzan la frontera (off < 0.45 del radio): muerden o abultan, no dejan islas redondas. */
const H_BLOBS = [
  { s: 0.05, r: 0.2, off: 0.26, f: [0.061, 0.097, 0.043, 0.052], ph: [0.3, 2.1, 4.0, 1.2] },
  { s: 0.27, r: 0.15, off: 0.32, f: [0.083, 0.054, 0.121, 0.077], ph: [1.7, 0.4, 2.9, 3.3] },
  { s: 0.47, r: 0.18, off: 0.24, f: [0.049, 0.112, 0.071, 0.064], ph: [3.1, 5.2, 0.8, 0.5] },
  { s: 0.7, r: 0.13, off: 0.34, f: [0.074, 0.066, 0.093, 0.101], ph: [4.6, 1.3, 3.7, 2.4] },
  { s: 0.92, r: 0.19, off: 0.28, f: [0.058, 0.089, 0.062, 0.045], ph: [2.2, 3.9, 5.1, 4.4] }
];
const K_BLOBS = [
  { s: 0.16, r: 0.14, off: 0.26, f: [0.057, 0.088, 0.104, 0.069], ph: [2.4, 3.3, 1.1, 5.0] },
  { s: 0.38, r: 0.11, off: 0.3, f: [0.091, 0.047, 0.067, 0.058], ph: [0.9, 4.4, 5.5, 2.0] },
  { s: 0.6, r: 0.15, off: 0.24, f: [0.069, 0.081, 0.052, 0.094], ph: [5.8, 2.6, 0.2, 3.6] },
  { s: 0.82, r: 0.12, off: 0.3, f: [0.078, 0.059, 0.087, 0.049], ph: [3.7, 1.5, 4.8, 0.9] }
];

/* Humano = halo ∪ H ∪ (L ∩ K̄)   ·   Holograma = complemento exacto (más la silueta). */
const HUMAN_OPS = ['add', ...H_BLOBS.map(() => 'add'), ...K_BLOBS.map(() => 'intersect'), 'add'];
const HOLO_OPS = ['intersect', ...H_BLOBS.map(() => 'intersect'), ...K_BLOBS.map(() => 'add'), 'add'];
const HOLO_SIL_OPS = ['intersect', ...HOLO_OPS];
const WK = { add: 'source-over', intersect: 'source-in' };
const wk = (ops) => ops.map((o) => WK[o]).join(', ');

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const clamp01 = (v) => clamp(v, 0, 1);
const wave = (t, f, ph) => Math.sin(t * f * TAU + ph);
const n4 = (v) => (Math.round(v * 1e4) / 1e4).toString();

/* ------------------------------------------------------------------ */
/* Estilos del módulo (se inyectan una vez)                            */
/* ------------------------------------------------------------------ */
const STYLES = `
.mh-av{position:absolute;inset:0;perspective:1600px;opacity:0;transition:opacity .35s ease;-webkit-tap-highlight-color:transparent;user-select:none;-webkit-user-select:none}
.mh-av.is-on{opacity:1}
.mh-av__stage{position:absolute;inset:0;transform-origin:50% 58%;will-change:transform}
.mh-av__l{position:absolute;inset:0;pointer-events:none}
.mh-av img{position:absolute;inset:0;width:100%;height:100%;display:block;object-fit:fill;-webkit-user-drag:none}
.mh-av__human,.mh-av__holo,.mh-av__glitch,.mh-av__edge,.mh-av__edge>i{-webkit-mask-repeat:no-repeat;mask-repeat:no-repeat;-webkit-mask-size:100% 100%;mask-size:100% 100%}
.mh-av__human{-webkit-mask-composite:${wk(HUMAN_OPS)};mask-composite:${HUMAN_OPS.join(', ')}}
.mh-av__holo,.mh-av__glitch,.mh-av__edge>i{-webkit-mask-composite:${wk(HOLO_SIL_OPS)};mask-composite:${HOLO_SIL_OPS.join(', ')}}
.mh-av__edge{-webkit-mask-composite:${wk(HUMAN_OPS)};mask-composite:${HUMAN_OPS.join(', ')}}
.mh-av__glow{mix-blend-mode:screen;filter:drop-shadow(0 0 5px rgba(111,243,255,.7))}
.mh-av__holo{mix-blend-mode:screen;animation:mhFlicker 5.3s linear infinite}
.mh-av__holo img{filter:grayscale(1) contrast(1.32) brightness(1.2)}
.mh-av__tint{background:linear-gradient(172deg,#d4feff 0%,#6ff3ff 36%,#3aa8ff 100%);mix-blend-mode:multiply}
.mh-av__lift{background:rgba(111,243,255,.12);mix-blend-mode:screen}
.mh-av__lines{background:repeating-linear-gradient(180deg,rgba(2,6,10,.6) 0 1px,transparent 1px 3px)}
.mh-av__dots{background:radial-gradient(circle,rgba(200,253,255,.6) 0 .7px,transparent 1.1px) 0 0/5px 5px;mix-blend-mode:screen;opacity:.6}
.mh-av__scan{height:22%;bottom:auto;background:linear-gradient(180deg,transparent,rgba(111,243,255,.08) 55%,rgba(200,255,255,.36) 97%,transparent);mix-blend-mode:screen;animation:mhScan 7s cubic-bezier(.45,0,.55,1) infinite;will-change:transform}
.mh-av__glitch{opacity:0;mix-blend-mode:screen}
.mh-av__glitch img{filter:grayscale(1) brightness(1.5) sepia(1) hue-rotate(140deg) saturate(3.4)}
.mh-av__edge>i{display:block;position:absolute;inset:0;background:radial-gradient(circle,#f2ffff 0 .75px,transparent 1.15px) 0 0/3px 3px,linear-gradient(180deg,rgba(170,250,255,.55),rgba(111,243,255,.5) 45%,rgba(58,168,255,.45));animation:mhPulse 3.4s ease-in-out infinite}
.mh-av__fx{mix-blend-mode:screen}
.mh-av__p{position:absolute;left:0;top:0;width:2px;height:2px;margin:-1px 0 0 -1px;background:#bdfcff;opacity:0;box-shadow:0 0 4px rgba(111,243,255,.85);will-change:transform,opacity}
.mh-av__p.is-w{background:#fff}
.mh-av__s{position:absolute;left:0;top:0;width:1px;height:14px;margin:-7px 0 0 0;background:linear-gradient(180deg,transparent,#effffe 50%,transparent);opacity:0;will-change:transform,opacity}
.mh-av__boot{opacity:0;background:linear-gradient(180deg,transparent 72%,rgba(111,243,255,.16) 99.3%,#eaffff 99.3%)}
.mh-av.is-boot .mh-av__boot{animation:mhSweep .9s cubic-bezier(.3,.6,.2,1) both}
.mh-av.is-boot .mh-av__holo{animation:mhReveal .9s cubic-bezier(.3,.6,.2,1) both,mhFlicker 5.3s linear infinite}
.mh-av.is-boot .mh-av__human{animation:mhHumanOn 1.3s linear both}
.mh-av.is-boot .mh-av__glow,.mh-av.is-boot .mh-av__fx{animation:mhEdgeOn 1.3s linear both}
.mh-av.is-paused,.mh-av.is-paused *{animation-play-state:paused!important}
@keyframes mhScan{from{transform:translateY(-100%)}to{transform:translateY(460%)}}
@keyframes mhFlicker{0%,37%,41%,77%,79%,100%{opacity:.94}38%{opacity:.72}39%{opacity:.98}40%{opacity:.84}78%{opacity:.8}}
@keyframes mhPulse{0%,100%{opacity:.9}50%{opacity:1}}
@keyframes mhReveal{from{clip-path:inset(0 0 100% 0)}to{clip-path:inset(0 0 0 0)}}
@keyframes mhSweep{0%{transform:translateY(-100%);opacity:0}8%{opacity:1}86%{opacity:1}100%{transform:translateY(0);opacity:0}}
@keyframes mhHumanOn{0%,22%{opacity:0}32%{opacity:.7}36%{opacity:.2}48%{opacity:.9}53%{opacity:.45}70%,100%{opacity:1}}
@keyframes mhEdgeOn{0%,30%{opacity:0}100%{opacity:1}}
@media (prefers-reduced-motion:reduce){.mh-av,.mh-av *{animation:none!important;transition:none!important}.mh-av__scan{transform:translateY(160%)}.mh-av__boot{display:none}}
`;

let styleEl = null;
let styleRefs = 0;
function useStyles() {
  styleRefs += 1;
  if (styleEl) return;
  styleEl = document.createElement('style');
  styleEl.setAttribute('data-mh-avatar', '');
  styleEl.textContent = STYLES;
  document.head.appendChild(styleEl);
}
function releaseStyles() {
  styleRefs = Math.max(0, styleRefs - 1);
  if (styleRefs === 0 && styleEl) {
    styleEl.remove();
    styleEl = null;
  }
}

/* ------------------------------------------------------------------ */
/* Campo de humanidad (JS): exactamente lo que dibujan las máscaras    */
/* ------------------------------------------------------------------ */
function linAlpha(X, Y, p, w) {
  const t = ((X - 0.5) * SIN - (Y - A / 2) * COS) / LEN + 0.5;
  return clamp01((p + w - t) / (2 * w));
}
function radAlpha(X, Y, cx, cy, rx, ry, core) {
  if (rx <= 1e-4 || ry <= 1e-4) return 0;
  const rho = Math.hypot((X - cx) / rx, (Y - cy) / ry);
  if (rho <= core) return 1;
  if (rho >= 1) return 0;
  return (1 - rho) / (1 - core);
}
/* Humanidad sin el halo del puntero (la que controla la frontera). */
function baseField(X, Y, st) {
  let v = linAlpha(X, Y, st.p, CFG.w);
  for (const b of st.k) v *= 1 - radAlpha(X, Y, b.x, b.y, b.rx, b.ry, CFG.core);
  let inv = 1 - v;
  for (const b of st.h) inv *= 1 - radAlpha(X, Y, b.x, b.y, b.rx, b.ry, CFG.core);
  return 1 - inv;
}
function withHalo(v, X, Y, st) {
  if (st.gs < 0.002) return v;
  const g = st.gs * radAlpha(X, Y, st.gx, st.gy, st.gr, st.gr, CFG.haloCore);
  return g + v * (1 - g);
}
const fullField = (X, Y, st) => withHalo(baseField(X, Y, st), X, Y, st);

function silAt(X, Y) {
  const i = clamp(Math.floor(X * GW), 0, GW - 1);
  const j = clamp(Math.floor((Y / A) * GH), 0, GH - 1);
  return ALPHA[j * GW + i];
}

/* Fracción humana del área visible (ponderada por alfa). */
function measure(st) {
  let sw = 0, sb = 0, sf = 0;
  for (let j = 0; j < GH; j++) {
    const Y = ((j + 0.5) / GH) * A;
    for (let i = 0; i < GW; i++) {
      const a = ALPHA[j * GW + i];
      if (a <= 0) continue;
      const X = (i + 0.5) / GW;
      const b = baseField(X, Y, st);
      sw += a;
      sb += a * b;
      sf += a * withHalo(b, X, Y, st);
    }
  }
  return { base: sb / sw, full: sf / sw };
}

/* Posición de las manchas a lo largo de la frontera en el instante t. */
function placeBlobs(st, t) {
  const c0x = 0.5 + NX * (st.p - 0.5) * LEN;
  const c0y = A / 2 + NY * (st.p - 0.5) * LEN;
  const put = (list, src, sign) => {
    for (let i = 0; i < src.length; i++) {
      const b = src[i];
      const o = list[i];
      const sig = (b.s - 0.5) * CFG.span + 0.09 * (0.6 * wave(t, b.f[0], b.ph[0]) + 0.4 * wave(t, b.f[1] * 1.7, b.ph[1]));
      const r = b.r * (0.82 + 0.28 * wave(t, b.f[2], b.ph[1]));
      const asp = 0.32 * wave(t, b.f[3], b.ph[3]);          // la mancha respira y se deforma
      o.rx = r * (1 + asp);
      o.ry = r * (1 - asp);
      const off = sign * b.off * r * (0.7 + 0.45 * wave(t, b.f[1], b.ph[2]));
      o.x = c0x + TX * sig + NX * off;
      o.y = c0y + TY * sig + NY * off;
    }
  };
  put(st.h, H_BLOBS, 1);
  put(st.k, K_BLOBS, -1);
}

/* Humanidad objetivo: base ± oscilación lenta (≈ 55 % – 80 % con base 0.65). */
function targetAt(base, t) {
  const osc = 0.085 * Math.sin((t * TAU) / 29 + 0.6) + 0.035 * Math.sin((t * TAU) / 11.3 + 2.2) + 0.02;
  return clamp(base + osc, 0.02, 0.98);
}

/* Ajusta p para que la humanidad base coincida con el objetivo (bisección). */
function solveP(st, target, t) {
  let lo = -0.4, hi = 1.4;
  for (let i = 0; i < 22; i++) {
    st.p = (lo + hi) / 2;
    placeBlobs(st, t);
    if (measure(st).base < target) lo = st.p;
    else hi = st.p;
  }
  st.p = (lo + hi) / 2;
  placeBlobs(st, t);
}

/* ------------------------------------------------------------------ */
/* Máscaras CSS                                                        */
/* ------------------------------------------------------------------ */
const pct = (v) => `${(v * 100).toFixed(3)}%`;
function radialCss(b, v, d, inv) {
  const f = (1 + CFG.core) / (1 + v.core);       // alinea el contorno 0.5 entre núcleos distintos
  const rx = Math.max(0.002, b.rx * f + d);
  const ry = Math.max(0.002, b.ry * f + d);
  const at = `${pct(b.x)} ${pct(b.y / A)}`;
  const c = `${(v.core * 100).toFixed(1)}%`;
  return inv
    ? `radial-gradient(${pct(rx)} ${pct(ry / A)} at ${at}, transparent ${c}, #000 100%)`
    : `radial-gradient(${pct(rx)} ${pct(ry / A)} at ${at}, #000 ${c}, transparent 100%)`;
}
function haloCss(st, d, inv) {
  const r = Math.max(0.002, st.gr + d);
  const at = `${pct(st.gx)} ${pct(st.gy / A)}`;
  const c = `${(CFG.haloCore * 100).toFixed(1)}%`;
  const s = clamp01(st.gs);
  return inv
    ? `radial-gradient(${pct(r)} ${pct(r / A)} at ${at}, rgba(0,0,0,${n4(1 - s)}) ${c}, #000 100%)`
    : `radial-gradient(${pct(r)} ${pct(r / A)} at ${at}, rgba(0,0,0,${n4(s)}) ${c}, transparent 100%)`;
}
function linearCss(st, v, d, inv) {
  const shift = d / LEN;
  const a = pct(st.p + shift - v.w);
  const b = pct(st.p + shift + v.w);
  return inv
    ? `linear-gradient(${CFG.angle}deg, transparent ${a}, #000 ${b})`
    : `linear-gradient(${CFG.angle}deg, #000 ${a}, transparent ${b})`;
}
/* Región humana (dilatada d > 0, contraída d < 0). */
function humanStack(st, v, d) {
  const out = [haloCss(st, d, false)];
  for (const b of st.h) out.push(radialCss(b, v, d, false));
  for (const b of st.k) out.push(radialCss(b, v, -d, true));
  out.push(linearCss(st, v, d, false));
  return out.join(',');
}
/* Complemento exacto de humanStack(st, v, d), recortado por la silueta. */
function holoStack(st, v, d, sil) {
  const out = [sil, haloCss(st, d, true)];
  for (const b of st.h) out.push(radialCss(b, v, d, true));
  for (const b of st.k) out.push(radialCss(b, v, -d, false));
  out.push(linearCss(st, v, d, true));
  return out.join(',');
}

/* ------------------------------------------------------------------ */
/* Montaje                                                             */
/* ------------------------------------------------------------------ */
export function mountAvatar(el, opts = {}) {
  if (!el) throw new Error('mountAvatar: falta el contenedor');
  const src = opts.src || 'assets/img/avatar.webp';
  const onHumanity = typeof opts.onHumanity === 'function' ? opts.onHumanity : () => {};
  const onReady = typeof opts.onReady === 'function' ? opts.onReady : () => {};
  const absSrc = new URL(src, document.baseURI).href;
  const silCss = `url("${absSrc.replace(/["\\\n]/g, encodeURIComponent)}")`;
  const MASK = typeof CSS !== 'undefined' && CSS.supports && CSS.supports('mask-image', 'linear-gradient(#000,#000)')
    ? 'maskImage'
    : 'webkitMaskImage';

  let booted = false;
  let destroyed = false;
  let bootTimer = 0;

  useStyles();
  if (getComputedStyle(el).position === 'static') el.style.position = 'relative';

  const root = document.createElement('div');
  root.className = 'mh-av';
  root.setAttribute('role', 'img');
  root.setAttribute('aria-label', LABEL);
  root.innerHTML =
    '<div class="mh-av__stage">' +
      '<div class="mh-av__l mh-av__human"><img alt="" draggable="false"></div>' +
      '<div class="mh-av__l mh-av__holo"><img alt="" draggable="false">' +
        '<div class="mh-av__l mh-av__tint"></div><div class="mh-av__l mh-av__lift"></div>' +
        '<div class="mh-av__l mh-av__lines"></div><div class="mh-av__l mh-av__dots"></div>' +
        '<div class="mh-av__l mh-av__scan"></div>' +
      '</div>' +
      '<div class="mh-av__l mh-av__glitch"><img alt="" draggable="false"></div>' +
      '<div class="mh-av__l mh-av__glow"><div class="mh-av__l mh-av__edge"><i></i></div></div>' +
      '<div class="mh-av__l mh-av__fx"></div>' +
      '<div class="mh-av__l mh-av__boot"></div>' +
    '</div>';
  for (const node of root.children[0].querySelectorAll('*')) node.setAttribute('aria-hidden', 'true');
  el.appendChild(root);

  const q = (s) => root.querySelector(s);
  const stage = q('.mh-av__stage');
  const human = q('.mh-av__human');
  const holo = q('.mh-av__holo');
  const glitch = q('.mh-av__glitch');
  const edgeOuter = q('.mh-av__edge');
  const edgeInner = edgeOuter.firstElementChild;
  const fx = q('.mh-av__fx');
  const imgs = [...root.querySelectorAll('img')];

  const coarse = matchMedia('(pointer: coarse)').matches;
  const small = () => root.clientWidth < 420;
  const reduceMQ = matchMedia('(prefers-reduced-motion: reduce)');
  let reduced = reduceMQ.matches;

  /* Estado del campo */
  const st = {
    p: 0.6,
    h: H_BLOBS.map(() => ({ x: 0, y: 0, rx: 0, ry: 0 })),
    k: K_BLOBS.map(() => ({ x: 0, y: 0, rx: 0, ry: 0 })),
    gx: 0.5, gy: 0.7, gr: CFG.haloR, gs: 0
  };
  let base = 0.65;
  let t = 0;
  let pRate = 0;

  /* Partículas y chispas */
  const P_COUNT = coarse || small() ? 18 : 42;
  const S_COUNT = coarse || small() ? 3 : 6;
  const parts = [];
  const sparks = [];
  for (let i = 0; i < P_COUNT; i++) {
    const n = document.createElement('i');
    n.className = 'mh-av__p' + (i % 5 === 0 ? ' is-w' : '');
    fx.appendChild(n);
    parts.push({ n, age: 0, life: 0, sx: 0, sy: 0, ex: 0, ey: 0, alive: false, delay: Math.random() * 1.6, size: 1 });
  }
  for (let i = 0; i < S_COUNT; i++) {
    const n = document.createElement('i');
    n.className = 'mh-av__s';
    fx.appendChild(n);
    sparks.push({ n, age: 0, life: 0, x: 0, y: 0, dx: 0, dy: 0, ang: 0, len: 1, alive: false });
  }
  let nextSpark = 0;

  /* Medidas del contenedor */
  let W = el.clientWidth || 300;
  const ro = typeof ResizeObserver !== 'undefined'
    ? new ResizeObserver(() => { W = root.clientWidth || W; if (reduced) renderStatic(); })
    : null;
  if (ro) ro.observe(root);

  /* Puntero */
  const ptr = { cx: 0, cy: 0, seen: false, touch: false, until: 0 };
  const onMove = (e) => {
    ptr.cx = e.clientX; ptr.cy = e.clientY; ptr.seen = true;
    ptr.touch = e.pointerType === 'touch' || e.pointerType === 'pen';
    if (ptr.touch) ptr.until = performance.now() + 1600;
  };
  const onLeave = (e) => { if (!e.relatedTarget) ptr.seen = false; };
  const onBlur = () => { ptr.seen = false; };
  window.addEventListener('pointermove', onMove, { passive: true });
  window.addEventListener('pointerdown', onMove, { passive: true });
  document.addEventListener('pointerout', onLeave, { passive: true });
  window.addEventListener('blur', onBlur);

  /* Caja del retrato en pantalla: se vuelve a leer solo al desplazarse o redimensionar */
  let rect = null;
  let rectAt = 0;
  const dropRect = () => { rect = null; };
  window.addEventListener('scroll', dropRect, { passive: true, capture: true });
  window.addEventListener('resize', dropRect, { passive: true });

  const tilt = { x: 0, y: 0, vx: 0, vy: 0 };
  let glitchUntil = 0;
  let nextGlitch = 0;

  /* --------------------------- Dibujo --------------------------- */
  const SOFT = { core: CFG.core, w: CFG.w };
  function applyMasks(withGlitch) {
    const hs = humanStack(st, SOFT, 0);
    const ho = holoStack(st, SOFT, 0, silCss);
    human.style[MASK] = hs;
    holo.style[MASK] = ho;
    if (withGlitch) glitch.style[MASK] = ho;
    edgeOuter.style[MASK] = humanStack(st, CFG.edge, CFG.edge.d);
    edgeInner.style[MASK] = holoStack(st, CFG.edge, -CFG.edge.d, silCss);
  }

  /* Punto aleatorio sobre la frontera visible y su dirección hacia el holograma. */
  function boundaryPoint(tol, tries = 36) {
    for (let i = 0; i < tries; i++) {
      const X = 0.08 + Math.random() * 0.84;
      const Y = Math.random() * A;
      if (silAt(X, Y) < 0.6) continue;
      const v = fullField(X, Y, st);
      if (Math.abs(v - 0.5) > tol) continue;
      const e = 0.012;
      let gx = fullField(X + e, Y, st) - fullField(X - e, Y, st);
      let gy = fullField(X, Y + e, st) - fullField(X, Y - e, st);
      let g = Math.hypot(gx, gy);
      if (g < 1e-5) { gx = -NX; gy = -NY; g = 1; }
      return { x: X, y: Y, nx: -gx / g, ny: -gy / g };
    }
    return null;
  }

  function spawnParticle(pt) {
    const b = boundaryPoint(0.16);
    if (!b) { pt.alive = false; pt.delay = 0.2; return; }
    const dist = 0.03 + Math.random() * 0.1;
    const side = (Math.random() - 0.5) * 0.05;
    pt.ex = b.x; pt.ey = b.y;
    pt.sx = b.x + b.nx * dist + -b.ny * side;
    pt.sy = b.y + b.ny * dist + b.nx * side;
    pt.age = 0;
    pt.life = 0.9 + Math.random() * 1.1;
    pt.size = 0.7 + Math.random() * 0.8;
    pt.alive = true;
  }

  function updateParticles(dt) {
    for (const pt of parts) {
      if (!pt.alive) {
        pt.delay -= dt;
        if (pt.delay <= 0) spawnParticle(pt);
        if (!pt.alive) continue;
      }
      pt.age += dt;
      const k = pt.age / pt.life;
      if (k >= 1) {
        pt.alive = false;
        pt.delay = Math.random() * 0.5;
        pt.n.style.opacity = '0';
        continue;
      }
      const e = 1 - Math.pow(1 - k, 3);
      const x = (pt.sx + (pt.ex - pt.sx) * e) * W;
      const y = (pt.sy + (pt.ey - pt.sy) * e) * W;
      const o = k < 0.15 ? k / 0.15 : k > 0.82 ? Math.max(0, 1 - (k - 0.82) / 0.18) : 0.85 + 0.15 * Math.sin(k * 20);
      const s = pt.size * (k > 0.82 ? 1.6 : 1);
      pt.n.style.transform = `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0) scale(${s.toFixed(2)})`;
      pt.n.style.opacity = o.toFixed(3);
    }
  }

  function updateSparks(dt, now) {
    if (now >= nextSpark) {
      nextSpark = now + 90 + Math.random() * 170;
      const sp = sparks.find((s) => !s.alive);
      const b = sp && boundaryPoint(0.1);
      if (b) {
        sp.alive = true; sp.age = 0; sp.life = 0.18 + Math.random() * 0.2;
        sp.x = b.x; sp.y = b.y; sp.dx = b.nx; sp.dy = b.ny;
        sp.ang = Math.atan2(b.ny, b.nx) / DEG - 90;
        sp.len = 0.5 + Math.random() * 0.9;
      }
    }
    for (const sp of sparks) {
      if (!sp.alive) continue;
      sp.age += dt;
      const k = sp.age / sp.life;
      if (k >= 1) { sp.alive = false; sp.n.style.opacity = '0'; continue; }
      const travel = 0.025 * k;
      const x = (sp.x + sp.dx * travel) * W;
      const y = (sp.y + sp.dy * travel) * W;
      sp.n.style.transform = `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0) rotate(${sp.ang.toFixed(1)}deg) scaleY(${(sp.len * (1 - k * 0.6)).toFixed(2)})`;
      sp.n.style.opacity = (k < 0.2 ? k / 0.2 : 1 - (k - 0.2) / 0.8).toFixed(3);
    }
  }

  function updateGlitch(now) {
    if (now >= nextGlitch && glitchUntil === 0) {
      const dur = 90 + Math.random() * 90;
      glitchUntil = now + dur;
      const y0 = 0.08 + Math.random() * 0.75;
      const h = 0.015 + Math.random() * 0.06;
      const dx = (Math.random() < 0.5 ? -1 : 1) * (5 + Math.random() * 9);
      glitch.style.clipPath = `inset(${(y0 * 100).toFixed(2)}% 0 ${((1 - y0 - h) * 100).toFixed(2)}% 0)`;
      glitch.style.transform = `translate3d(${dx.toFixed(1)}px,0,0)`;
      glitch.style.opacity = '0.85';
      holo.style.transform = `translate3d(${(dx * 0.25).toFixed(1)}px,0,0)`;
    } else if (glitchUntil && now >= glitchUntil) {
      glitchUntil = 0;
      nextGlitch = now + 2400 + Math.random() * 4200;
      glitch.style.opacity = '0';
      holo.style.transform = '';
    }
  }

  /* --------------------------- Bucle --------------------------- */
  let raf = 0;
  let running = false;
  let visible = true;
  let lastT = 0;
  let lastMask = 0;
  let lastMeasure = 0;
  const maskEvery = coarse ? 1000 / 22 : 1000 / 32;   // la frontera es lenta: 30 fps de máscara bastan

  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = lastT ? Math.min(0.05, (now - lastT) / 1000) : 1 / 60;
    lastT = now;
    t += dt;

    /* Puntero: halo humanizante e inclinación */
    if (!rect || now - rectAt > 500) { rect = root.getBoundingClientRect(); rectAt = now; }
    let hs = 0, tx = 0, ty = 0;
    if (ptr.seen && rect.width > 0) {
      const fxp = (ptr.cx - rect.left) / rect.width;
      const fyp = (ptr.cy - rect.top) / rect.height;
      const inside = fxp > -0.12 && fxp < 1.12 && fyp > -0.08 && fyp < 1.08;
      const active = inside && (!ptr.touch || now < ptr.until);
      if (active) {
        hs = 1;
        const kx = 1 - Math.exp(-dt * 5);
        st.gx += (clamp(fxp, -0.1, 1.1) - st.gx) * kx;
        st.gy += (clamp(fyp, -0.1, 1.1) * A - st.gy) * kx;
      }
      if (!ptr.touch) {
        tx = clamp((ptr.cx - (rect.left + rect.width / 2)) / (rect.width * 1.1), -1, 1);
        ty = clamp((ptr.cy - (rect.top + rect.height / 2)) / (rect.height * 1.1), -1, 1);
      }
    }
    st.gs += (hs - st.gs) * (1 - Math.exp(-dt * (hs > st.gs ? 3.2 : 1.4)));

    const K = 34, C = 8.5;
    tilt.vx += ((tx - tilt.x) * K - tilt.vx * C) * dt; tilt.x += tilt.vx * dt;
    tilt.vy += ((ty - tilt.y) * K - tilt.vy * C) * dt; tilt.y += tilt.vy * dt;
    stage.style.transform = `rotateX(${(-tilt.y * 3.2).toFixed(3)}deg) rotateY(${(tilt.x * 4.6).toFixed(3)}deg)`;
    fx.style.transform = `translate3d(${(tilt.x * 5).toFixed(2)}px,${(tilt.y * 4).toFixed(2)}px,0)`;

    /* Frontera */
    st.p += pRate * dt;
    placeBlobs(st, t);
    updateGlitch(now);
    if (now - lastMask >= maskEvery) { applyMasks(glitchUntil > 0); lastMask = now; }

    /* Lectura (~9 por segundo) y control lento hacia la humanidad objetivo */
    if (now - lastMeasure >= 110) {
      const m = measure(st);
      pRate = CFG.gain * (targetAt(base, t) - m.base);
      lastMeasure = now;
      try { onHumanity(m.full); } catch (err) { /* el callback de la página no debe detener el retrato */ }
    }

    updateParticles(dt);
    updateSparks(dt, now);
  }

  function start() {
    if (running || reduced || !visible || document.hidden || !booted) return;
    running = true;
    lastT = 0;
    root.classList.remove('is-paused');
    raf = requestAnimationFrame(frame);
  }
  function stop() {
    if (!running) return;
    running = false;
    cancelAnimationFrame(raf);
    root.classList.add('is-paused');
  }

  /* Fotograma fijo para prefers-reduced-motion */
  const STATIC_T = 7.3;
  function renderStatic() {
    st.gs = 0;
    t = STATIC_T;
    solveP(st, targetAt(base, STATIC_T), STATIC_T);
    applyMasks(false);
    stage.style.transform = '';
    fx.style.transform = '';
    holo.style.transform = '';
    glitch.style.opacity = '0';
    let i = 0;
    for (const pt of parts) {
      const b = i++ % 2 ? null : boundaryPoint(0.12, 400);
      if (!b) { pt.n.style.opacity = '0'; continue; }
      const d = 0.004 + Math.random() * 0.03;
      pt.n.style.transform = `translate3d(${((b.x + b.nx * d) * W).toFixed(1)}px,${((b.y + b.ny * d) * W).toFixed(1)}px,0)`;
      pt.n.style.opacity = (0.35 + Math.random() * 0.5).toFixed(2);
    }
    for (const sp of sparks) sp.n.style.opacity = '0';
    const m = measure(st);
    try { onHumanity(m.full); } catch (err) { /* nada */ }
  }

  /* Visibilidad: en pantalla y pestaña activa */
  const io = typeof IntersectionObserver !== 'undefined'
    ? new IntersectionObserver((entries) => {
      for (const e of entries) visible = e.isIntersecting;
      if (visible) start(); else stop();
    }, { rootMargin: '80px' })
    : null;
  if (io) io.observe(root);
  const onVis = () => { if (document.hidden) stop(); else start(); };
  document.addEventListener('visibilitychange', onVis);

  const onReduce = () => {
    reduced = reduceMQ.matches;
    if (reduced) { stop(); renderStatic(); }
    else { solveP(st, targetAt(base, t), t); start(); }
  };
  if (reduceMQ.addEventListener) reduceMQ.addEventListener('change', onReduce);

  /* Carga y encendido */
  solveP(st, targetAt(base, 0), 0);
  applyMasks(false);
  nextGlitch = performance.now() + 2600;

  for (const img of imgs) {
    img.decoding = 'async';
    img.src = absSrc;
  }
  const ready = imgs[0].decode ? imgs[0].decode() : new Promise((res, rej) => { imgs[0].onload = res; imgs[0].onerror = rej; });
  ready.then(() => {
    if (destroyed) return;
    booted = true;
    if (reduced) {
      renderStatic();
      root.classList.add('is-on');
      onReady();
      return;
    }
    root.classList.add('is-boot', 'is-on');
    onReady();
    bootTimer = setTimeout(() => root.classList.remove('is-boot'), 1350);
    start();
  }).catch(() => {
    /* Sin imagen no hay retrato: se deja el contenedor vacío y accesible. */
    if (!destroyed) { root.classList.add('is-on'); onReady(); }
  });

  return {
    setHumanity(v) {
      const n = Number(v);
      if (!Number.isFinite(n)) return;
      base = clamp01(n);
      if (reduced && booted) renderStatic();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      stop();
      clearTimeout(bootTimer);
      if (io) io.disconnect();
      if (ro) ro.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      if (reduceMQ.removeEventListener) reduceMQ.removeEventListener('change', onReduce);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', onMove);
      document.removeEventListener('pointerout', onLeave);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('scroll', dropRect, { capture: true });
      window.removeEventListener('resize', dropRect);
      for (const img of imgs) img.removeAttribute('src');
      root.remove();
      releaseStyles();
    }
  };
}

export default mountAvatar;
