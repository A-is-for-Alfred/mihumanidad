/*
  mihumanidad · Avatar — Variante C
  «Escaneo topográfico: curvas de nivel + malla de alambre»

  Módulo ES sin dependencias externas.
    export function mountAvatar(el, opts = {}) -> { destroy(), setHumanity(v) }

  Técnica
  - CPU (una sola vez, al cargar): se combinan el mapa de profundidad y la
    luminancia del retrato en un campo F; con marching squares se trazan
    NLEV curvas de nivel. Con puntos de alto gradiente + rejilla con jitter
    se hace una triangulación de Delaunay (Bowyer-Watson) para la malla.
    Curvas y malla se rasterizan en dos texturas que codifican, además de la
    cobertura de la línea, el nivel / identificador / posición a lo largo de
    cada arista, para animarlas en el shader.
  - GPU (cada cuadro): un único shader de pantalla completa compone la foto
    humana, el holograma, las capas con paralaje y la frontera de
    construcción a partir del campo de humanidad S(x,y,t) (ruido fbm con
    deformación de dominio). Las partículas que se ensamblan se dibujan como
    GL_POINTS calculadas en CPU.
  - El mismo ruido existe en JS para estimar la fracción humana visible
    (onHumanity) y mantener la base ~65 % con un control proporcional.
*/

const DESC = 'Retrato de Alfredo, sonriente: cabello negro, lentes de armazón metálico delgado, bigote largo con las puntas enroscadas y piocha; camisa blanca con pines dorados en forma de alas en el cuello y chaleco gris. Una parte del retrato es holograma en construcción.';
const IMG_ASPECT = 0.75;          // 3:4
const NLEV = 26;                  // curvas de nivel
const GW = 360, GH = 480;         // rejilla de análisis
const CW = 45, CH = 60;           // rejilla gruesa (fracción humana, partículas)
const HALO_AMP = 0.115, HALO_R = 0.095;
const DIR_X = -0.940, DIR_Y = 0.341;  // gradiente base: lo humano domina a la izquierda y abajo
const NOISE_AMP = 0.30;            // amplitud del ruido de la frontera
const STATIC_T = 31.0;            // instante del fotograma fijo (movimiento reducido)
const POWER_DUR = 1.3;            // encendido (s)

/* ------------------------------------------------------------------ */
/* Ruido compartido CPU/GPU (misma aritmética que en GLSL)            */
/* ------------------------------------------------------------------ */
const _h = [0, 0];
const fr = (x) => x - Math.floor(x);
function hash22(px, py) {
  let x = fr(px * 0.1031), y = fr(py * 0.1030), z = fr(px * 0.0973);
  const d = x * (y + 33.33) + y * (z + 33.33) + z * (x + 33.33);
  x += d; y += d; z += d;
  _h[0] = fr((x + y) * z);
  _h[1] = fr((x + z) * y);
}
function gnoise(px, py) {
  const ix = Math.floor(px), iy = Math.floor(py);
  const fx = px - ix, fy = py - iy;
  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  hash22(ix, iy);         const n00 = (_h[0] * 2 - 1) * fx + (_h[1] * 2 - 1) * fy;
  hash22(ix + 1, iy);     const n10 = (_h[0] * 2 - 1) * (fx - 1) + (_h[1] * 2 - 1) * fy;
  hash22(ix, iy + 1);     const n01 = (_h[0] * 2 - 1) * fx + (_h[1] * 2 - 1) * (fy - 1);
  hash22(ix + 1, iy + 1); const n11 = (_h[0] * 2 - 1) * (fx - 1) + (_h[1] * 2 - 1) * (fy - 1);
  const a = n00 + (n10 - n00) * ux, b = n01 + (n11 - n01) * ux;
  return (a + (b - a) * uy) * 1.6;
}
function fbm(px, py, oct) {
  let s = 0, a = 0.5;
  for (let k = 0; k < oct; k++) {
    s += a * gnoise(px, py);
    const nx = 1.6 * px - 1.2 * py + 1.7, ny = 1.2 * px + 1.6 * py + 9.2;
    px = nx; py = ny; a *= 0.5;
  }
  return s;
}
// Campo de humanidad sin halo. q = (u * 0.75, v): espacio isótropo, alto = 1.
function fieldS0(qx, qy, t, off) {
  const wx = fbm(qx * 1.8 + 1.7 + t * 0.021, qy * 1.8 + 9.2 + t * 0.013, 3);
  const wy = fbm(qx * 1.8 + 8.3 - t * 0.017, qy * 1.8 + 2.8 - t * 0.019, 3);
  const n = fbm(qx * 2.3 + wx * 1.15 + 3.1 + t * 0.012, qy * 2.3 + wy * 1.15 + 4.7 - t * 0.010, 4);
  return (qx - 0.375) * DIR_X + (qy - 0.5) * DIR_Y + NOISE_AMP * n + off;
}

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
// misma atenuación de bordes que el shader (para que la fracción cuente solo lo visible)
function edgeFade(u, v) {
  const b = 1 - sstep(0.80, 0.995, v + 0.05 * Math.pow(Math.abs(u - 0.5) * 2, 2));
  const s = sstep(0, 0.07, u) * (1 - sstep(0.93, 1, u));
  const m = sstep(0.55, 0.8, v);
  return b * (1 + (s - 1) * m);
}
const idle = () => new Promise((r) => setTimeout(r, 0));

/* ------------------------------------------------------------------ */
/* Shaders                                                            */
/* ------------------------------------------------------------------ */
const NOISE_GLSL = `
vec2 hash22(vec2 p){
  vec3 p3 = fract(vec3(p.x, p.y, p.x) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
float hash12(vec2 p){
  vec3 p3 = fract(vec3(p.x, p.y, p.x) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float gnoise(vec2 p){
  vec2 i = floor(p); vec2 f = p - i;
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  vec2 g00 = hash22(i) * 2.0 - 1.0;
  vec2 g10 = hash22(i + vec2(1.0, 0.0)) * 2.0 - 1.0;
  vec2 g01 = hash22(i + vec2(0.0, 1.0)) * 2.0 - 1.0;
  vec2 g11 = hash22(i + vec2(1.0, 1.0)) * 2.0 - 1.0;
  float n00 = dot(g00, f);
  float n10 = dot(g10, f - vec2(1.0, 0.0));
  float n01 = dot(g01, f - vec2(0.0, 1.0));
  float n11 = dot(g11, f - vec2(1.0, 1.0));
  return mix(mix(n00, n10, u.x), mix(n01, n11, u.x), u.y) * 1.6;
}
vec2 octStep(vec2 p){ return vec2(1.6 * p.x - 1.2 * p.y + 1.7, 1.2 * p.x + 1.6 * p.y + 9.2); }
float fbm3(vec2 p){
  float s = 0.5 * gnoise(p); p = octStep(p);
  s += 0.25 * gnoise(p); p = octStep(p);
  s += 0.125 * gnoise(p);
  return s;
}
float fbm4(vec2 p){
  float s = 0.5 * gnoise(p); p = octStep(p);
  s += 0.25 * gnoise(p); p = octStep(p);
  s += 0.125 * gnoise(p); p = octStep(p);
  s += 0.0625 * gnoise(p);
  return s;
}
`;

const QUAD_VS = `
attribute vec2 aPos;
uniform vec2 uFit;
varying vec2 vUv;
void main(){
  vec2 uv = vec2(aPos.x * 0.5 + 0.5, 0.5 - aPos.y * 0.5);
  vUv = (uv - 0.5) * uFit + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

const MAIN_FS = `
uniform sampler2D uPhoto;
uniform sampler2D uAux;
uniform sampler2D uCont;
uniform sampler2D uMesh;
uniform float uT;
uniform float uOffset;
uniform vec3 uHalo;
uniform vec2 uTilt;
uniform float uOn;
uniform float uScale;
uniform float uFlick;
uniform float uBeam;
uniform vec2 uGlitch;
varying vec2 vUv;

const vec3 HOLO  = vec3(0.435, 0.953, 1.0);
const vec3 HOLO2 = vec3(0.227, 0.659, 1.0);
const vec3 WARM  = vec3(0.941, 0.702, 0.541);
const vec3 CORE  = vec3(0.86, 1.0, 1.0);
${NOISE_GLSL}
float fieldS(vec2 uv){
  vec2 q = vec2(uv.x * 0.75, uv.y);
  float t = uT;
  float wx = fbm3(vec2(q.x * 1.8 + 1.7 + t * 0.021, q.y * 1.8 + 9.2 + t * 0.013));
  float wy = fbm3(vec2(q.x * 1.8 + 8.3 - t * 0.017, q.y * 1.8 + 2.8 - t * 0.019));
  float n = fbm4(vec2(q.x * 2.3 + wx * 1.15 + 3.1 + t * 0.012, q.y * 2.3 + wy * 1.15 + 4.7 - t * 0.010));
  float s = (q.x - 0.375) * (${DIR_X.toFixed(3)}) + (q.y - 0.5) * (${DIR_Y.toFixed(3)}) + ${NOISE_AMP.toFixed(3)} * n + uOffset;
  vec2 dh = q - uHalo.xy;
  s += uHalo.z * exp(-dot(dh, dh) / ${(HALO_R * HALO_R).toFixed(5)});
  return s;
}

float edgeFade(vec2 uv){
  float b = 1.0 - smoothstep(0.80, 0.995, uv.y + 0.05 * pow(abs(uv.x - 0.5) * 2.0, 2.0));
  float s = smoothstep(0.0, 0.07, uv.x) * (1.0 - smoothstep(0.93, 1.0, uv.x));
  return b * mix(1.0, s, smoothstep(0.55, 0.8, uv.y));
}

void main(){
  vec2 uv = vUv;
  vec4 aux = texture2D(uAux, uv);
  float dep = aux.g;
  vec2 tl = uTilt;
  // paralaje por capas: foto (según profundidad), curvas y malla por delante
  vec2 uvP = uv - tl * (dep - 0.5) * 0.022;
  vec2 uvC = uv - tl * ((dep - 0.5) * 0.030 + 0.006);
  vec2 uvM = uv - tl * ((dep - 0.5) * 0.036 + 0.013);

  float S = fieldS(uvP);
#ifdef HAS_DERIV
  float gS = length(vec2(dFdx(S), dFdy(S)));
#else
  float gS = 1.3 * uScale / 720.0;
#endif
  // distancia con signo a la frontera, en "dp" (avatar = 720 dp de alto); + = humano
  float dc = S / max(gS, 1e-6) * uScale;

  float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
  if (aux.r < 0.003 || inside < 0.5) { gl_FragColor = vec4(0.0); return; }

  // falla ocasional: bandas horizontales desplazadas (solo holograma)
  float row = floor(uv.y * 42.0);
  float gh = hash12(vec2(row, uGlitch.y));
  float gAmt = uGlitch.x * step(0.74, gh);
  vec2 gOff = vec2((hash12(vec2(row + 3.7, uGlitch.y * 1.3)) - 0.5) * 0.05 * gAmt, 0.0);

  vec4 ph = texture2D(uPhoto, uvP);
  float aP = ph.a;

  // máscara humana con teselas que se colocan junto a la frontera
  float hum = smoothstep(-0.8, 0.8, dc);
  vec2 tid = floor(uvP * vec2(150.0, 200.0));
  float tr = hash12(tid);
  float tclk = uT * 2.4 + tr * 9.0;
  float slot = floor(tclk);
  float tage = tclk - slot;
  float ts = hash12(tid + vec2(slot * 3.17, slot * 1.31));
  float tz = smoothstep(-18.0, -1.0, dc);
  float tileW = step(1.0 - 0.55 * tz * tz, ts) * (1.0 - hum) * 0.9;
  float humanOn = smoothstep(0.42, 1.0, uOn);
  float H = (hum + tileW) * humanOn;
  float Z = 1.0 - H;
  // cada tesela aparece con un destello cian y se asienta como foto
  float tflash = 1.0 - smoothstep(0.0, 0.4, tage);
  vec3 tileRGB = mix(ph.rgb, HOLO * ph.a, 0.18 + 0.5 * tflash) + CORE * (0.25 * tflash * ph.a);
  vec3 humanRGB = ph.rgb * hum + tileRGB * tileW;

  // holograma: cuerpo translúcido a partir de la luminancia
  vec4 pg = texture2D(uPhoto, uvP + gOff);
  float lu = dot(pg.rgb, vec3(0.299, 0.587, 0.114)) / max(pg.a, 0.004);
  float scan = 0.74 + 0.26 * sin((gl_FragCoord.y * uScale + uT * 7.0) * 2.0944);
  float body = (0.05 + 0.48 * pow(lu, 1.45)) * pg.a;
  vec3 holo = mix(HOLO2, HOLO, smoothstep(0.1, 0.9, lu)) * body * scan;
  float holoA = body * 0.8;
  float auxP = texture2D(uAux, uvP).r;
  float rim = pg.a * (1.0 - smoothstep(0.5, 0.97, auxP));
  holo += HOLO * rim * 0.32;
  holoA += rim * 0.25;
  float beam = exp(-pow((uv.y - uBeam) / 0.016, 2.0));
  holo += HOLO * beam * 0.10 * pg.a;

  // curvas de nivel: un trazador recorre cada curva (cometa angular)
  vec4 ct = texture2D(uCont, uvC + gOff);
  float cMask = smoothstep(0.1, 0.6, texture2D(uPhoto, uvC).a);
  float lev = ct.g / max(ct.r, 0.004);
  vec2 dv = vec2((uvC.x - 0.545) * 0.75, uvC.y - 0.47);
  float th = atan(dv.y, dv.x) * 0.159155 + 0.5;
  float li = floor(lev * ${(NLEV - 1).toFixed(1)} + 0.5);
  float sg = mod(li, 2.0) * 2.0 - 1.0;
  float ph0 = fract(uT * 0.055 * sg + li * 0.381966);
  float dth = fract((ph0 - th) * sg);
  float trail = exp(-dth * 9.0);
  float cI = ct.r * cMask * (0.28 + 0.95 * trail + 0.9 * beam);

  // malla de alambre: en la banda de frontera las aristas se tejen
  vec4 mt = texture2D(uMesh, uvM + gOff);
  float mMask = smoothstep(0.1, 0.6, texture2D(uPhoto, uvM).a);
  float eid = mt.g / max(mt.r, 0.004);
  float alo = mt.b / max(mt.r, 0.004);
  float wz = exp(-dc * dc / 900.0);
  float cyc = fract(uT * 0.26 + eid * 17.31);
  float grow = clamp(cyc / 0.42, 0.0, 1.0);
  float vis = step(alo, grow) * (1.0 - smoothstep(0.82, 1.0, cyc));
  float tip = exp(-abs(alo - grow) * 16.0) * step(cyc, 0.42);
  float mI = mt.r * mMask * mix(0.20 + 0.6 * beam, vis * (0.6 + 2.4 * tip), wz);
  float nd = texture2D(uCont, uvM + gOff).b;
  float tw = 0.6 + 0.4 * sin(uT * 2.1 + hash12(floor(uvM * 96.0)) * 6.2832);
  float nI = nd * mMask * (0.38 * tw + 1.4 * wz + 0.6 * beam);
  float meshZ = 1.0 - smoothstep(-2.0, 10.0, dc);

  float fl = uFlick;
  vec3 hcol = (holo + HOLO * cI) * fl;
  float hA = holoA + cI * 0.85;
  vec3 mcol = (mix(HOLO2, HOLO, 0.55) * mI + CORE * nI) * fl;
  float mA = (mI + nI) * 0.85;
  float mW = meshZ * (1.0 - 0.65 * H);
  vec3 col = humanRGB * humanOn + hcol * Z + mcol * mW;
  float A = aP * H + hA * Z + mA * mW;

  // frontera de construcción
  float fm = smoothstep(0.02, 0.5, aP);
  float core = exp(-dc * dc / 0.7);
  float inner = exp(-dc * dc / 6.0);
  float glow = exp(-dc * dc / 40.0);
  float haze = dc < 0.0 ? exp(dc / 30.0) : exp(-dc / 4.0);
  vec2 qP = vec2(uvP.x * 0.75, uvP.y);
  float en = 0.72 + 0.75 * smoothstep(0.05, 0.7, gnoise(qP * 22.0 + vec2(uT * 0.8, -uT * 0.6)));
  vec3 fr = (CORE * (core * 1.2 + inner * 0.32) + HOLO * glow * 0.42 + HOLO2 * haze * 0.17) * en;
  fr += WARM * exp(-(dc - 2.3) * (dc - 2.3)) * 0.28;
  vec2 sp = gl_FragCoord.xy * uScale / 6.0;
  vec2 sc = floor(sp);
  float sr = hash12(sc + 13.1);
  float sl = floor(uT * 6.0 + sr * 11.0);
  vec2 so = hash22(sc + vec2(sl * 1.37, sl * 0.71)) * 0.7 + 0.15;
  float son = step(0.86, hash12(sc * 1.91 + vec2(sl * 0.73, 2.0)));
  float sd = length(fract(sp) - so) * 6.0;
  float spark = son * exp(-sd * sd * 1.6) * exp(-dc * dc / 80.0);
  fr += CORE * spark * 1.3;
  fr *= fm * smoothstep(0.25, 0.8, uOn);
  col += fr;

  // encendido: un barrido de escáner descubre la imagen de arriba abajo
  float sy = uOn * 1.3 - 0.12;
  float rev = 1.0 - smoothstep(sy - 0.015, sy + 0.015, uv.y);
  float bl = exp(-pow((uv.y - sy) / 0.005, 2.0)) * step(uOn, 0.999) * smoothstep(0.02, 0.4, auxP);
  col = col * rev + (CORE * 0.9 + HOLO * 0.3) * bl;
  A = A * rev;

  A = clamp(max(A, max(col.r, max(col.g, col.b))), 0.0, 1.0);
  col = min(col, vec3(A));
  // el busto se funde con el fondo: sin cortes rectos abajo ni a los lados
  float ef = edgeFade(uv);
  gl_FragColor = vec4(col * ef, A * ef);
}
`;

const PART_VS = `
attribute vec4 aP;
uniform vec2 uFit;
uniform float uPx;
varying float vA;
void main(){
  vec2 uv = (aP.xy - 0.5) / uFit + 0.5;
  gl_Position = vec4(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, 0.0, 1.0);
  gl_PointSize = max(aP.z * uPx, 1.0);
  vA = aP.w;
}
`;
const PART_FS = `
varying float vA;
void main(){
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d) * 2.0;
  float m = 1.0 - smoothstep(0.0, 1.0, r);
  m = m * m;
  float core = 1.0 - smoothstep(0.0, 0.35, r);
  vec3 c = vec3(0.435, 0.953, 1.0) * m + vec3(0.9, 1.0, 1.0) * core * 0.8;
  gl_FragColor = vec4(c * vA, m * 0.6 * vA);
}
`;

function shaderSource(gl2, kind, body, hasDeriv) {
  if (gl2) {
    let h = '#version 300 es\n';
    if (kind === 'v') h += '#define attribute in\n#define varying out\n';
    else h += 'precision highp float;\n#define varying in\n#define texture2D texture\n#define gl_FragColor fragColor\nout vec4 fragColor;\n#define HAS_DERIV 1\n';
    return h + body;
  }
  let h = '';
  if (kind === 'f') {
    if (hasDeriv) h += '#extension GL_OES_standard_derivatives : enable\n#define HAS_DERIV 1\n';
    h += '#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\n#else\nprecision mediump float;\n#endif\n';
  }
  return h + body;
}

/* ------------------------------------------------------------------ */
/* Análisis en CPU                                                     */
/* ------------------------------------------------------------------ */
function blur(src, W, H, sigma) {
  const r = Math.max(1, Math.ceil(sigma * 3));
  const k = new Float32Array(r * 2 + 1);
  let ks = 0;
  for (let i = -r; i <= r; i++) { const v = Math.exp(-(i * i) / (2 * sigma * sigma)); k[i + r] = v; ks += v; }
  for (let i = 0; i < k.length; i++) k[i] /= ks;
  const tmp = new Float32Array(W * H), out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    const row = y * W;
    for (let x = 0; x < W; x++) {
      let s = 0;
      for (let i = -r; i <= r; i++) {
        let xx = x + i; xx = xx < 0 ? 0 : xx >= W ? W - 1 : xx;
        s += src[row + xx] * k[i + r];
      }
      tmp[row + x] = s;
    }
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let s = 0;
      for (let i = -r; i <= r; i++) {
        let yy = y + i; yy = yy < 0 ? 0 : yy >= H ? H - 1 : yy;
        s += tmp[yy * W + x] * k[i + r];
      }
      out[y * W + x] = s;
    }
  }
  return out;
}

// Reducción 2x2 por promedio y muestreo bilineal.
function down2(src, W, H) {
  const w = W >> 1, h = H >> 1, out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const k = y * 2 * W + x * 2;
      out[y * w + x] = (src[k] + src[k + 1] + src[k + W] + src[k + W + 1]) * 0.25;
    }
  }
  return out;
}
function sample2(src, W, H, x, y) {
  x = clamp(x, 0, W - 1.001); y = clamp(y, 0, H - 1.001);
  const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j, k = j * W + i;
  const a = src[k] + (src[k + 1] - src[k]) * fx, b = src[k + W] + (src[k + W + 1] - src[k + W]) * fx;
  return a + (b - a) * fy;
}

// Marching squares con niveles equiespaciados. Devuelve un arreglo de segmentos por nivel.
function marching(F, W, H, levels) {
  const NL = levels.length, L0 = levels[0], dL = levels[1] - levels[0];
  const out = levels.map(() => []);
  for (let j = 0; j < H - 1; j++) {
    for (let i = 0; i < W - 1; i++) {
      const k = j * W + i;
      const a = F[k], b = F[k + 1], c = F[k + W + 1], d = F[k + W];
      const mn = Math.min(a, b, c, d), mx = Math.max(a, b, c, d);
      let l0 = Math.ceil((mn - L0) / dL), l1 = Math.floor((mx - L0) / dL);
      if (l0 < 0) l0 = 0;
      if (l1 > NL - 1) l1 = NL - 1;
      for (let l = l0; l <= l1; l++) {
        const L = levels[l];
        const idx = (a > L ? 8 : 0) | (b > L ? 4 : 0) | (c > L ? 2 : 0) | (d > L ? 1 : 0);
        if (idx === 0 || idx === 15) continue;
        const s = out[l];
        // puntos sobre aristas: T(op), R(ight), B(ottom), L(eft)
        const tx = i + (L - a) / (b - a), ty = j;
        const rx = i + 1, ry = j + (L - b) / (c - b);
        const bx = i + (L - d) / (c - d), by = j + 1;
        const lx = i, ly = j + (L - a) / (d - a);
        switch (idx) {
          case 1: case 14: s.push(lx, ly, bx, by); break;
          case 2: case 13: s.push(bx, by, rx, ry); break;
          case 3: case 12: s.push(lx, ly, rx, ry); break;
          case 4: case 11: s.push(tx, ty, rx, ry); break;
          case 6: case 9: s.push(tx, ty, bx, by); break;
          case 7: case 8: s.push(lx, ly, tx, ty); break;
          case 5: {
            const ctr = (a + b + c + d) * 0.25;
            if (ctr > L) { s.push(lx, ly, tx, ty); s.push(bx, by, rx, ry); }
            else { s.push(lx, ly, bx, by); s.push(tx, ty, rx, ry); }
            break;
          }
          case 10: {
            const ctr = (a + b + c + d) * 0.25;
            if (ctr > L) { s.push(tx, ty, rx, ry); s.push(lx, ly, bx, by); }
            else { s.push(lx, ly, tx, ty); s.push(bx, by, rx, ry); }
            break;
          }
        }
      }
    }
  }
  return out.map((a) => new Float32Array(a));
}

// Delaunay (Bowyer-Watson). P = [x0, y0, x1, y1, ...]. Devuelve índices de triángulos.
function delaunay(P) {
  const n = P.length / 2;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = P[i * 2], y = P[i * 2 + 1];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  const dm = Math.max(maxX - minX, maxY - minY) || 1, mx = (minX + maxX) / 2, my = (minY + maxY) / 2;
  const X = Array.from(P);
  X.push(mx - 20 * dm, my - dm, mx, my + 20 * dm, mx + 20 * dm, my - dm);
  const mk = (a, b, c) => {
    const ax = X[a * 2], ay = X[a * 2 + 1], bx = X[b * 2], by = X[b * 2 + 1], cx = X[c * 2], cy = X[c * 2 + 1];
    const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
    if (Math.abs(d) < 1e-12) return { a, b, c, x: ax, y: ay, r2: Infinity };
    const a2 = ax * ax + ay * ay, b2 = bx * bx + by * by, c2 = cx * cx + cy * cy;
    const ux = (a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / d;
    const uy = (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / d;
    return { a, b, c, x: ux, y: uy, r2: (ax - ux) * (ax - ux) + (ay - uy) * (ay - uy) };
  };
  let tris = [mk(n, n + 1, n + 2)];
  const M = 1 << 16;
  for (let i = 0; i < n; i++) {
    const px = X[i * 2], py = X[i * 2 + 1];
    const keep = [], edges = new Map();
    for (const t of tris) {
      const dx = px - t.x, dy = py - t.y;
      if (dx * dx + dy * dy < t.r2) {
        for (const [u, v] of [[t.a, t.b], [t.b, t.c], [t.c, t.a]]) {
          const key = u < v ? u * M + v : v * M + u;
          edges.set(key, edges.has(key) ? null : [u, v]);
        }
      } else keep.push(t);
    }
    for (const e of edges.values()) if (e) keep.push(mk(e[0], e[1], i));
    tris = keep;
  }
  const out = [];
  for (const t of tris) if (t.a < n && t.b < n && t.c < n) out.push(t.a, t.b, t.c);
  return out;
}

function buildMesh(lumB, alpha, W, H) {
  const N = W * H;
  const gm = new Float32Array(N);
  for (let j = 1; j < H - 1; j++) {
    for (let i = 1; i < W - 1; i++) {
      const k = j * W + i;
      if (alpha[k] < 0.8) continue;
      const gx = lumB[k + 1] - lumB[k - 1], gy = lumB[k + W] - lumB[k - W];
      gm[k] = Math.sqrt(gx * gx + gy * gy);
    }
  }
  const aAt = (x, y) => alpha[clamp(Math.round(y), 0, H - 1) * W + clamp(Math.round(x), 0, W - 1)];
  const R = 9, cs = R, gwc = Math.ceil(W / cs) + 1, ghc = Math.ceil(H / cs) + 1;
  const bins = new Array(gwc * ghc);
  const pts = [], feat = [];
  const ok = (x, y, r) => {
    const cx = Math.floor(x / cs), cy = Math.floor(y / cs), rr = Math.ceil(r / cs);
    for (let yy = cy - rr; yy <= cy + rr; yy++) {
      if (yy < 0 || yy >= ghc) continue;
      for (let xx = cx - rr; xx <= cx + rr; xx++) {
        if (xx < 0 || xx >= gwc) continue;
        const b = bins[yy * gwc + xx];
        if (!b) continue;
        for (const p of b) {
          const dx = pts[p * 2] - x, dy = pts[p * 2 + 1] - y;
          if (dx * dx + dy * dy < r * r) return false;
        }
      }
    }
    return true;
  };
  const add = (x, y, f) => {
    const id = pts.length / 2;
    pts.push(x + (Math.random() - 0.5) * 0.6, y + (Math.random() - 0.5) * 0.6);
    feat.push(f);
    const key = Math.floor(y / cs) * gwc + Math.floor(x / cs);
    (bins[key] || (bins[key] = [])).push(id);
  };
  // 1) puntos de alto gradiente (rasgos: lentes, ojos, bigote, cabello, cuello)
  const cand = [];
  for (let j = 2; j < H - 2; j += 2) for (let i = 2; i < W - 2; i += 2) { const k = j * W + i; if (gm[k] > 0.035) cand.push(k); }
  cand.sort((a, b) => gm[b] - gm[a]);
  for (const k of cand) {
    if (pts.length / 2 >= 520) break;
    const x = k % W, y = (k / W) | 0;
    if (ok(x, y, R)) add(x, y, 1);
  }
  // 2) rejilla con jitter
  const SP = 24;
  for (let y = SP / 2; y < H; y += SP) {
    for (let x = SP / 2; x < W; x += SP) {
      const jx = x + (Math.random() - 0.5) * SP * 0.6, jy = y + (Math.random() - 0.5) * SP * 0.6;
      if (aAt(jx, jy) > 0.5 && ok(jx, jy, R * 1.15)) add(jx, jy, 0);
    }
  }
  // 3) contorno de la silueta y borde inferior
  const edge = [];
  for (let j = 3; j < H - 3; j += 3) {
    for (let i = 3; i < W - 3; i += 3) {
      const k = j * W + i;
      if (alpha[k] > 0.5 && (alpha[k - 3] < 0.5 || alpha[k + 3] < 0.5 || alpha[k - 3 * W] < 0.5 || alpha[k + 3 * W] < 0.5)) edge.push(k);
    }
  }
  for (let i = edge.length - 1; i > 0; i--) { const r = (Math.random() * (i + 1)) | 0; const t = edge[i]; edge[i] = edge[r]; edge[r] = t; }
  for (const k of edge) { const x = k % W, y = (k / W) | 0; if (ok(x, y, R * 1.7)) add(x, y, 0); }
  for (let x = 4; x < W; x += 20) if (aAt(x, H - 2) > 0.5 && ok(x, H - 2, R)) add(x, H - 2, 0);

  const T = delaunay(pts);
  const edges = new Map();
  const used = new Uint8Array(pts.length / 2);
  const M = 1 << 16;
  const maxL2 = 70 * 70;
  for (let t = 0; t < T.length; t += 3) {
    const a = T[t], b = T[t + 1], c = T[t + 2];
    const ax = pts[a * 2], ay = pts[a * 2 + 1], bx = pts[b * 2], by = pts[b * 2 + 1], cx = pts[c * 2], cy = pts[c * 2 + 1];
    if (aAt((ax + bx + cx) / 3, (ay + by + cy) / 3) < 0.5) continue;
    if (aAt((ax + bx) / 2, (ay + by) / 2) < 0.3 || aAt((bx + cx) / 2, (by + cy) / 2) < 0.3 || aAt((cx + ax) / 2, (cy + ay) / 2) < 0.3) continue;
    const l1 = (ax - bx) ** 2 + (ay - by) ** 2, l2 = (bx - cx) ** 2 + (by - cy) ** 2, l3 = (cx - ax) ** 2 + (cy - ay) ** 2;
    if (l1 > maxL2 || l2 > maxL2 || l3 > maxL2) continue;
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      const key = u < v ? u * M + v : v * M + u;
      if (!edges.has(key)) edges.set(key, Math.random() < 0.5 ? [u, v] : [v, u]);
    }
    used[a] = used[b] = used[c] = 1;
  }
  const E = new Float32Array(edges.size * 5);
  let o = 0;
  for (const [u, v] of edges.values()) {
    E[o++] = pts[u * 2]; E[o++] = pts[u * 2 + 1]; E[o++] = pts[v * 2]; E[o++] = pts[v * 2 + 1]; E[o++] = Math.random();
  }
  const nodes = [];
  for (let i = 0; i < used.length; i++) if (used[i]) nodes.push(pts[i * 2], pts[i * 2 + 1], feat[i]);
  return { edges: E, nodes: new Float32Array(nodes) };
}

async function analyze(photo, depthImg, alive) {
  const N = GW * GH;
  const cv = document.createElement('canvas');
  cv.width = GW; cv.height = GH;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  cx.imageSmoothingEnabled = true;
  cx.imageSmoothingQuality = 'high';
  cx.drawImage(photo, 0, 0, GW, GH);
  const pd = cx.getImageData(0, 0, GW, GH).data;
  let dd = null;
  if (depthImg) {
    cx.clearRect(0, 0, GW, GH);
    cx.drawImage(depthImg, 0, 0, GW, GH);
    dd = cx.getImageData(0, 0, GW, GH).data;
  }
  const alpha = new Float32Array(N), la = new Float32Array(N), depth = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const a = pd[i * 4 + 3] / 255;
    alpha[i] = a;
    la[i] = a * (0.299 * pd[i * 4] + 0.587 * pd[i * 4 + 1] + 0.114 * pd[i * 4 + 2]) / 255;
    depth[i] = dd ? dd[i * 4] / 255 : 0.5 * a;
  }
  await idle(); if (!alive()) return null;

  const laB = blur(la, GW, GH, 1.1), aB = blur(alpha, GW, GH, 1.1);
  const lumB = new Float32Array(N);
  for (let i = 0; i < N; i++) lumB[i] = aB[i] > 1e-3 ? laB[i] / aB[i] : 0;
  const depB = blur(depth, GW, GH, 2.0);
  await idle(); if (!alive()) return null;

  // campo combinado profundidad + luminancia, extendido fuera de la silueta
  const F = new Float32Array(N), fa = new Float32Array(N);
  let msum = 0, mcount = 0;
  for (let i = 0; i < N; i++) {
    F[i] = 0.58 * depB[i] + 0.42 * lumB[i];
    fa[i] = F[i] * alpha[i];
    if (alpha[i] > 0.5) { msum += F[i]; mcount++; }
  }
  const mean = mcount ? msum / mcount : 0.5;
  // difuminados anchos a media resolución (más baratos)
  const AW = GW / 2, AH = GH / 2;
  const alpha2 = down2(alpha, GW, GH), fa2 = down2(fa, GW, GH), depth2 = down2(depth, GW, GH);
  const faB = blur(fa2, AW, AH, 3.5), aW = blur(alpha2, AW, AH, 3.5);
  const ext2 = new Float32Array(AW * AH);
  for (let i = 0; i < AW * AH; i++) ext2[i] = aW[i] > 1e-3 ? faB[i] / aW[i] : mean;
  await idle(); if (!alive()) return null;
  for (let y = 0; y < GH; y++) {
    for (let x = 0; x < GW; x++) {
      const i = y * GW + x, a = alpha[i];
      if (a > 0.999) continue;
      F[i] = a * F[i] + (1 - a) * sample2(ext2, AW, AH, x * 0.5 - 0.25, y * 0.5 - 0.25);
    }
  }
  await idle(); if (!alive()) return null;

  const samp = [];
  for (let i = 0; i < N; i += 7) if (alpha[i] > 0.5) samp.push(F[i]);
  samp.sort((a, b) => a - b);
  const lo = samp[Math.floor(samp.length * 0.015)] ?? 0, hi = samp[Math.floor(samp.length * 0.985)] ?? 1;
  const levels = [];
  for (let k = 0; k < NLEV; k++) levels.push(lo + (k + 0.5) * (hi - lo) / NLEV);
  const segs = marching(F, GW, GH, levels);
  await idle(); if (!alive()) return null;

  const mesh = buildMesh(lumB, alpha, GW, GH);
  await idle(); if (!alive()) return null;

  // rejilla gruesa (alfa y profundidad medias) — a media resolución
  const depS = blur(depth2, AW, AH, 2.5);
  const aSoft = blur(alpha2, AW, AH, 2);
  const bx = AW / CW, by = AH / CH;
  const cAlpha = new Float32Array(CW * CH), cDepth = new Float32Array(CW * CH);
  for (let j = 0; j < CH; j++) {
    for (let i = 0; i < CW; i++) {
      let sa = 0, sd = 0, c = 0;
      for (let y = j * by; y < (j + 1) * by; y++) for (let x = i * bx; x < (i + 1) * bx; x++) { const k = y * AW + x; sa += alpha2[k]; sd += depS[k]; c++; }
      cAlpha[j * CW + i] = (sa / c) * edgeFade((i + 0.5) / CW, (j + 0.5) / CH); cDepth[j * CW + i] = sd / c;
    }
  }
  // textura auxiliar: R = alfa difuminada, G = profundidad suave
  const aux = document.createElement('canvas');
  aux.width = AW; aux.height = AH;
  const ax = aux.getContext('2d');
  const id = ax.createImageData(AW, AH);
  for (let k = 0; k < AW * AH; k++) {
    const o = k * 4;
    id.data[o] = Math.round(clamp(aSoft[k], 0, 1) * 255);
    id.data[o + 1] = Math.round(clamp(depS[k], 0, 1) * 255);
    id.data[o + 2] = 0;
    id.data[o + 3] = 255;
  }
  ax.putImageData(id, 0, 0);
  return { segs, mesh, cAlpha, cDepth, aux };
}

/* ------------------------------------------------------------------ */
/* Módulo                                                             */
/* ------------------------------------------------------------------ */
export function mountAvatar(el, opts = {}) {
  const src = opts.src ? String(opts.src) : new URL('../assets/img/avatar.webp', import.meta.url).href;
  const depthSrc = opts.depth ? String(opts.depth) : new URL('../assets/img/avatar-depth.png', import.meta.url).href;
  const onHumanity = typeof opts.onHumanity === 'function' ? opts.onHumanity : null;
  // Avisa una sola vez, cuando ya hay algo pintado (la página oculta entonces el retrato estático).
  const onReady = typeof opts.onReady === 'function' ? opts.onReady : null;
  let readySent = false;
  const sendReady = () => { if (!readySent && onReady && !destroyed) { readySent = true; onReady(); } };

  const coarse = (window.matchMedia && matchMedia('(pointer: coarse)').matches) || Math.min(screen.width, screen.height) < 600;
  const DPR_MAX = coarse ? 1.5 : 2;
  const NPART = coarse ? 260 : 680;
  const rmq = window.matchMedia ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  let reduced = !!(rmq && rmq.matches);

  const root = document.createElement('div');
  root.style.cssText = 'position:relative;width:100%;height:100%;';
  const canvas = document.createElement('canvas');
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', DESC);
  canvas.textContent = DESC;
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;background:transparent;';
  root.appendChild(canvas);
  el.appendChild(root);

  // --- estado ---
  let destroyed = false, ready = false, lost = false, failed = false;
  let gl = null, gl2 = false, hasDeriv = false;
  let progMain = null, progPart = null, uM = {}, uP = {};
  let quadBuf = null, partBuf = null, texPhoto = null, texAux = null, texCont = null, texMesh = null;
  let photoImg = null, data = null;
  let photoCv = null, contCv = null, meshCv = null;
  let raf = 0, last = 0, visible = true;
  let cssW = 0, cssH = 0, devW = 0, devH = 0, imgH = 0, fit = [1, 1], texH = 0;
  let resizeTimer = 0, lostTimer = 0;
  let fallbackEl = null;
  let bootGen = 0, prep = null;

  let t = 0, onT = 0;
  let base = 0.65, offset = 0, frac0 = base, frac = base, gridT = -1;
  const bandCells = [];

  const ptr = { has: false, touch: false, u: 0.5, v: 0.5, inside: false, tx: 0, ty: 0, touchUntil: -1 };
  const tilt = { x: 0, y: 0, vx: 0, vy: 0 };
  const halo = { x: 0.375, y: 0.5, amp: 0 };
  let nextGlitch = 3 + Math.random() * 4, glitchEnd = -1, glitchSeed = 0;
  let dipEnd = -1;

  const P = {
    sx: new Float32Array(NPART), sy: new Float32Array(NPART),
    tx: new Float32Array(NPART), ty: new Float32Array(NPART),
    life: new Float32Array(NPART), dur: new Float32Array(NPART),
    size: new Float32Array(NPART), alive: new Uint8Array(NPART),
    next: new Float32Array(NPART),
  };
  for (let i = 0; i < NPART; i++) P.next[i] = 0.8 + Math.random() * 1.6;
  const partData = new Float32Array(NPART * 4);

  const alive = () => !destroyed;

  // --- respaldo: retrato en <img> con tratamiento CSS ---
  function showFallback() {
    if (fallbackEl || destroyed) return;
    failed = true;
    stopLoop();
    canvas.style.display = 'none';
    canvas.setAttribute('aria-hidden', 'true');
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:absolute;inset:0;opacity:0;transition:opacity .9s ease, filter .9s ease;filter:brightness(1.6) saturate(0);' +
      '-webkit-mask-image:linear-gradient(to bottom,#000 78%,rgba(0,0,0,0) 99%);mask-image:linear-gradient(to bottom,#000 78%,rgba(0,0,0,0) 99%);';
    const img = new Image();
    img.alt = DESC;
    img.decoding = 'async';
    img.src = src;
    img.decode().then(sendReady, sendReady);
    img.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:contain;display:block;filter:contrast(1.03) saturate(.94);';
    const ov = document.createElement('div');
    ov.setAttribute('aria-hidden', 'true');
    const abs = new URL(src, document.baseURI).href;
    ov.style.cssText = [
      'position:absolute', 'inset:0', 'pointer-events:none', 'mix-blend-mode:screen',
      'background:linear-gradient(222deg, rgba(111,243,255,.55) 0%, rgba(58,168,255,.22) 30%, rgba(58,168,255,0) 52%),' +
        'repeating-linear-gradient(0deg, rgba(111,243,255,.14) 0 1px, rgba(0,0,0,0) 1px 3px)',
      `-webkit-mask-image:url("${abs}")`, `mask-image:url("${abs}")`,
      '-webkit-mask-size:contain', 'mask-size:contain',
      '-webkit-mask-position:center', 'mask-position:center',
      '-webkit-mask-repeat:no-repeat', 'mask-repeat:no-repeat',
    ].join(';');
    wrap.appendChild(img);
    wrap.appendChild(ov);
    root.appendChild(wrap);
    fallbackEl = wrap;
    requestAnimationFrame(() => requestAnimationFrame(() => { wrap.style.opacity = '1'; wrap.style.filter = 'none'; }));
    if (onHumanity) onHumanity(0.65);
  }

  // --- WebGL ---
  const ctxAttrs = { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false };
  function getContext() {
    try {
      gl = canvas.getContext('webgl2', ctxAttrs);
      gl2 = !!gl;
      if (!gl) gl = canvas.getContext('webgl', ctxAttrs) || canvas.getContext('experimental-webgl', ctxAttrs);
    } catch (e) { gl = null; }
    return !!gl;
  }
  function compile(type, srcText) {
    const s = gl.createShader(type);
    gl.shaderSource(s, srcText);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) {
      const log = gl.getShaderInfoLog(s);
      gl.deleteShader(s);
      throw new Error('Shader: ' + log);
    }
    return s;
  }
  function program(vs, fs, attribs) {
    const p = gl.createProgram();
    const v = compile(gl.VERTEX_SHADER, shaderSource(gl2, 'v', vs, hasDeriv));
    const f = compile(gl.FRAGMENT_SHADER, shaderSource(gl2, 'f', fs, hasDeriv));
    gl.attachShader(p, v); gl.attachShader(p, f);
    attribs.forEach((a, i) => gl.bindAttribLocation(p, i, a));
    gl.linkProgram(p);
    gl.deleteShader(v); gl.deleteShader(f);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS) && !gl.isContextLost()) throw new Error('Link: ' + gl.getProgramInfoLog(p));
    return p;
  }
  function makeTex() {
    const tx = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tx);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tx;
  }
  function upload(tx, source, premult) {
    gl.bindTexture(gl.TEXTURE_2D, tx);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, premult);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  }
  function initGL() {
    hasDeriv = gl2 || !!gl.getExtension('OES_standard_derivatives');
    progMain = program(QUAD_VS, MAIN_FS, ['aPos']);
    progPart = program(PART_VS, PART_FS, ['aP']);
    for (const n of ['uPhoto', 'uAux', 'uCont', 'uMesh', 'uT', 'uOffset', 'uHalo', 'uTilt', 'uOn', 'uScale', 'uFlick', 'uBeam', 'uGlitch', 'uFit']) uM[n] = gl.getUniformLocation(progMain, n);
    for (const n of ['uFit', 'uPx']) uP[n] = gl.getUniformLocation(progPart, n);
    quadBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    partBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, partBuf);
    gl.bufferData(gl.ARRAY_BUFFER, partData.byteLength, gl.DYNAMIC_DRAW);
    texPhoto = makeTex(); texAux = makeTex(); texCont = makeTex(); texMesh = makeTex();
  }
  function freeGL() {
    if (!gl) return;
    try {
      for (const tx of [texPhoto, texAux, texCont, texMesh]) if (tx) gl.deleteTexture(tx);
      for (const b of [quadBuf, partBuf]) if (b) gl.deleteBuffer(b);
      for (const p of [progMain, progPart]) if (p) gl.deleteProgram(p);
    } catch (e) { /* contexto perdido */ }
    texPhoto = texAux = texCont = texMesh = quadBuf = partBuf = progMain = progPart = null;
  }

  // --- rasterizado de capas al tamaño de pantalla ---
  // part: -1 = todo; 0 = foto; 1 = curvas + nodos; 2 = malla (permite repartir el trabajo al iniciar)
  function rasterize(part = -1) {
    const TH = texH, TW = Math.round(TH * IMG_ASPECT);
    const sx = TW / GW, sy = TH / GH, dp = TH / 720;
    if (part <= 0) {
      photoCv = photoCv || document.createElement('canvas');
      photoCv.width = TW; photoCv.height = TH;
      const pc = photoCv.getContext('2d');
      pc.imageSmoothingEnabled = true; pc.imageSmoothingQuality = 'high';
      pc.clearRect(0, 0, TW, TH);
      pc.drawImage(photoImg, 0, 0, TW, TH);
      if (part === 0) return;
    }
    if (part === -1 || part === 1) rasterContours(TW, TH, sx, sy, dp);
    if (part === -1 || part === 2) rasterMesh(TW, TH, sx, sy, dp);
  }
  function rasterContours(TW, TH, sx, sy, dp) {
    contCv = contCv || document.createElement('canvas');
    contCv.width = TW; contCv.height = TH;
    const c = contCv.getContext('2d');
    c.globalCompositeOperation = 'source-over';
    c.fillStyle = '#000'; c.fillRect(0, 0, TW, TH);
    c.lineCap = 'round'; c.lineJoin = 'round';
    data.segs.forEach((s, l) => {
      const major = l % 5 === 2;
      const R = major ? 255 : 150, G = Math.round(R * l / (NLEV - 1));
      c.strokeStyle = `rgb(${R},${G},0)`;
      c.lineWidth = Math.max(0.9, (major ? 1.15 : 0.8) * dp);
      c.beginPath();
      for (let i = 0; i < s.length; i += 4) {
        c.moveTo((s[i] + 0.5) * sx, (s[i + 1] + 0.5) * sy);
        c.lineTo((s[i + 2] + 0.5) * sx, (s[i + 3] + 0.5) * sy);
      }
      c.stroke();
    });
    // nodos de la malla en el canal azul
    c.globalCompositeOperation = 'lighter';
    const nd = data.mesh.nodes;
    for (let i = 0; i < nd.length; i += 3) {
      const x = (nd[i] + 0.5) * sx, y = (nd[i + 1] + 0.5) * sy, f = nd[i + 2];
      c.fillStyle = 'rgb(0,0,60)';
      c.beginPath(); c.arc(x, y, Math.max(1.6, 2.6 * dp), 0, Math.PI * 2); c.fill();
      c.fillStyle = f ? 'rgb(0,0,255)' : 'rgb(0,0,190)';
      c.beginPath(); c.arc(x, y, Math.max(0.8, (f ? 1.0 : 0.8) * dp), 0, Math.PI * 2); c.fill();
    }
    c.globalCompositeOperation = 'source-over';
  }
  function rasterMesh(TW, TH, sx, sy, dp) {
    meshCv = meshCv || document.createElement('canvas');
    meshCv.width = TW; meshCv.height = TH;
    const m = meshCv.getContext('2d');
    m.fillStyle = '#000'; m.fillRect(0, 0, TW, TH);
    m.lineCap = 'round';
    m.lineWidth = Math.max(0.85, 0.65 * dp);
    const E = data.mesh.edges;
    for (let i = 0; i < E.length; i += 5) {
      const x0 = (E[i] + 0.5) * sx, y0 = (E[i + 1] + 0.5) * sy, x1 = (E[i + 2] + 0.5) * sx, y1 = (E[i + 3] + 0.5) * sy;
      const g = Math.round(E[i + 4] * 255);
      const gr = m.createLinearGradient(x0, y0, x1, y1);
      gr.addColorStop(0, `rgb(255,${g},0)`);
      gr.addColorStop(1, `rgb(255,${g},255)`);
      m.strokeStyle = gr;
      m.beginPath(); m.moveTo(x0, y0); m.lineTo(x1, y1); m.stroke();
    }
  }
  function uploadAll() {
    upload(texPhoto, photoCv, true);
    upload(texAux, data.aux, false);
    upload(texCont, contCv, false);
    upload(texMesh, meshCv, false);
  }

  // --- tamaño ---
  function measure() {
    const r = root.getBoundingClientRect();
    cssW = r.width; cssH = r.height;
    if (cssW < 2 || cssH < 2) return false;
    const dpr = Math.min(DPR_MAX, window.devicePixelRatio || 1);
    devW = Math.max(1, Math.round(cssW * dpr));
    devH = Math.max(1, Math.round(cssH * dpr));
    const ca = devW / devH;
    fit = ca > IMG_ASPECT ? [ca / IMG_ASPECT, 1] : [1, IMG_ASPECT / ca];
    imgH = ca > IMG_ASPECT ? devH : devW / IMG_ASPECT;
    return true;
  }
  function applySize(immediateTextures) {
    if (!measure()) return;
    if (canvas.width !== devW || canvas.height !== devH) { canvas.width = devW; canvas.height = devH; }
    if (!ready) return;
    const want = Math.round(clamp(imgH, 320, 1600));
    if (Math.abs(want - texH) / Math.max(1, texH) > 0.04) {
      clearTimeout(resizeTimer);
      const go = () => { if (destroyed || lost || failed) return; texH = want; rasterize(); uploadAll(); if (reduced) renderStatic(); };
      if (immediateTextures) go(); else resizeTimer = setTimeout(go, 160);
    }
    if (reduced) renderStatic();
  }

  // --- campo en la rejilla gruesa ---
  const haloAt = (qx, qy) => {
    if (halo.amp < 1e-3) return 0;
    const dx = qx - halo.x, dy = qy - halo.y;
    return HALO_AMP * halo.amp * Math.exp(-(dx * dx + dy * dy) / (HALO_R * HALO_R));
  };
  const sAt = (qx, qy) => fieldS0(qx, qy, t, offset) + haloAt(qx, qy);
  function grid(withBand) {
    let sa = 0, s0h = 0, sh = 0;
    if (withBand) bandCells.length = 0;
    for (let j = 0; j < CH; j++) {
      const qy = (j + 0.5) / CH;
      for (let i = 0; i < CW; i++) {
        const k = j * CW + i, a = data.cAlpha[k];
        if (a < 0.02) continue;
        const qx = (i + 0.5) / CW * IMG_ASPECT;
        const s0 = fieldS0(qx, qy, t, offset), s = s0 + haloAt(qx, qy);
        sa += a; s0h += a * sstep(-0.004, 0.004, s0); sh += a * sstep(-0.004, 0.004, s);
        if (withBand && a > 0.55 && Math.abs(s) < 0.035) bandCells.push(k);
      }
    }
    frac0 = sa ? s0h / sa : 0; frac = sa ? sh / sa : 0;
  }
  // base ±: para base 0.65 oscila entre ~0.55 y ~0.80 (periodos de ~33 s y ~15 s)
  const oscTarget = (tt) => clamp(base + 0.025 + 0.085 * Math.sin(tt * 0.19) + 0.04 * Math.sin(tt * 0.43 + 1.7), 0.02, 0.98);
  function solveOffset(target) {
    let lo = -1.5, hi = 1.5;
    for (let it = 0; it < 14; it++) {
      offset = (lo + hi) / 2;
      grid(false);
      if (frac0 < target) lo = offset; else hi = offset;
    }
    offset = (lo + hi) / 2;
  }
  const humanOnOf = (on) => sstep(0.42, 1.0, on);

  // --- partículas ---
  const sampleC = (arr, u, v) => {
    const x = clamp(u * CW - 0.5, 0, CW - 1.001), y = clamp(v * CH - 0.5, 0, CH - 1.001);
    const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j, k = j * CW + i;
    const a = arr[k] + (arr[k + 1] - arr[k]) * fx, b = arr[k + CW] + (arr[k + CW + 1] - arr[k + CW]) * fx;
    return a + (b - a) * fy;
  };
  function spawn(i) {
    if (!bandCells.length) { P.next[i] = t + 0.2; return; }
    const k = bandCells[(Math.random() * bandCells.length) | 0];
    let qx = ((k % CW) + Math.random()) / CW * IMG_ASPECT, qy = (((k / CW) | 0) + Math.random()) / CH;
    let nx = 0, ny = 1;
    for (let it = 0; it < 2; it++) {
      const s = sAt(qx, qy), e = 0.003;
      const gx = (sAt(qx + e, qy) - s) / e, gy = (sAt(qx, qy + e) - s) / e;
      const g2 = gx * gx + gy * gy + 1e-9, gl = Math.sqrt(g2);
      qx -= s * gx / g2; qy -= s * gy / g2;
      nx = gx / gl; ny = gy / gl;
    }
    if (sampleC(data.cAlpha, qx / IMG_ASPECT, qy) < 0.6) { P.next[i] = t + 0.05; return; }
    const d0 = 0.014 + Math.random() * 0.055, tg = (Math.random() - 0.5) * 0.02;
    P.sx[i] = qx - nx * d0 - ny * tg; P.sy[i] = qy - ny * d0 + nx * tg;
    P.tx[i] = qx; P.ty[i] = qy;
    P.life[i] = 0; P.dur[i] = 0.6 + Math.random() * 1.0;
    P.size[i] = 1.8 + Math.random() * 1.8;
    P.alive[i] = 1;
  }
  function stepParticles(dt) {
    let n = 0;
    const canSpawn = onT > POWER_DUR * 0.7;
    for (let i = 0; i < NPART; i++) {
      if (!P.alive[i]) {
        if (canSpawn && t >= P.next[i]) spawn(i);
        if (!P.alive[i]) continue;
      }
      P.life[i] += dt;
      const u = P.life[i] / P.dur[i];
      let x, y, a, sz;
      if (u < 1) {
        const e = 1 - (1 - u) * (1 - u) * (1 - u);
        x = P.sx[i] + (P.tx[i] - P.sx[i]) * e; y = P.sy[i] + (P.ty[i] - P.sy[i]) * e;
        a = sstep(0, 0.25, u) * (0.3 + 0.45 * u);
        sz = P.size[i] * (0.7 + 0.3 * u);
      } else {
        const kf = (P.life[i] - P.dur[i]) / 0.32;
        if (kf >= 1) { P.alive[i] = 0; P.next[i] = t + Math.random() * 0.5; continue; }
        x = P.tx[i]; y = P.ty[i];
        a = (1 - kf) * (1 - kf);
        sz = P.size[i] * (1 + 1.4 * (1 - kf));
      }
      const u0 = x / IMG_ASPECT, v0 = y;
      const dep = sampleC(data.cDepth, u0, v0);
      const o = n * 4;
      partData[o] = u0 + tilt.x * (dep - 0.5) * 0.022;
      partData[o + 1] = v0 + tilt.y * (dep - 0.5) * 0.022;
      partData[o + 2] = sz;
      partData[o + 3] = a;
      n++;
    }
    return n;
  }

  // --- dibujo ---
  function draw(params, nPart) {
    if (!gl || lost || imgH <= 0) return;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.disable(gl.BLEND);
    gl.useProgram(progMain);
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const units = [texPhoto, texAux, texCont, texMesh];
    ['uPhoto', 'uAux', 'uCont', 'uMesh'].forEach((n, i) => {
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, units[i]);
      gl.uniform1i(uM[n], i);
    });
    gl.uniform1f(uM.uT, params.t);
    gl.uniform1f(uM.uOffset, offset);
    gl.uniform3f(uM.uHalo, halo.x, halo.y, HALO_AMP * halo.amp);
    gl.uniform2f(uM.uTilt, params.tiltX, params.tiltY);
    gl.uniform1f(uM.uOn, params.on);
    gl.uniform1f(uM.uScale, 720 / imgH);
    gl.uniform1f(uM.uFlick, params.flick);
    gl.uniform1f(uM.uBeam, params.beam);
    gl.uniform2f(uM.uGlitch, params.glitch, params.gseed);
    gl.uniform2f(uM.uFit, fit[0], fit[1]);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.disableVertexAttribArray(0);

    if (nPart > 0) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(progPart);
      gl.bindBuffer(gl.ARRAY_BUFFER, partBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, partData.subarray(0, nPart * 4));
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 0, 0);
      gl.uniform2f(uP.uFit, fit[0], fit[1]);
      gl.uniform1f(uP.uPx, imgH / 720);
      gl.drawArrays(gl.POINTS, 0, nPart);
      gl.disableVertexAttribArray(0);
      gl.disable(gl.BLEND);
    }
  }

  function renderStatic() {
    if (!ready || lost || failed || destroyed) return;
    t = STATIC_T; onT = 99;
    halo.amp = 0;
    solveOffset(clamp(base, 0.02, 0.98));
    grid(false);
    draw({ t: STATIC_T, tiltX: 0, tiltY: 0, on: 1, flick: 1, beam: 0.31, glitch: 0, gseed: 0 }, 0);
    sendReady();
    if (onHumanity) onHumanity(frac);
  }

  function frame(now) {
    if (destroyed || !ready) { raf = 0; return; }
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    t += dt; onT += dt;

    // puntero: halo humanizante e inclinación con resorte
    const active = ptr.has && (!ptr.touch || t < ptr.touchUntil);
    const haloTarget = active && ptr.inside ? 1 : 0;
    const qx = ptr.u * IMG_ASPECT, qy = ptr.v;
    if (halo.amp < 0.02 && haloTarget) { halo.x = qx; halo.y = qy; }
    const kp = 1 - Math.exp(-dt * 6);
    halo.x += (qx - halo.x) * kp; halo.y += (qy - halo.y) * kp;
    halo.amp += (haloTarget - halo.amp) * (1 - Math.exp(-dt * (haloTarget > halo.amp ? 3.0 : 1.6)));
    const ttx = active ? ptr.tx * 0.85 : 0.12 * Math.sin(t * 0.23), tty = active ? ptr.ty * 0.85 : 0.08 * Math.sin(t * 0.31 + 1.1);
    const K = 30, C = 2 * Math.sqrt(K) * 0.82;
    tilt.vx += (K * (ttx - tilt.x) - C * tilt.vx) * dt; tilt.x += tilt.vx * dt;
    tilt.vy += (K * (tty - tilt.y) - C * tilt.vy) * dt; tilt.y += tilt.vy * dt;

    // humanidad: control proporcional hacia la base oscilante + reporte ~9 Hz
    if (t - gridT >= 0.1) {
      grid(true);
      offset += clamp((oscTarget(t) - frac0) * 0.5, -0.04, 0.04);
      gridT = t;
      if (onHumanity) onHumanity(frac * humanOnOf(clamp(onT / POWER_DUR, 0, 1)));
    }

    // falla ocasional y parpadeo
    let glitch = 0;
    if (t > nextGlitch) { glitchEnd = t + 0.08 + Math.random() * 0.18; glitchSeed = Math.random() * 97; nextGlitch = t + 3.5 + Math.random() * 5.5; }
    if (t < glitchEnd) glitch = 0.45 + Math.random() * 0.55;
    if (t > dipEnd && Math.random() < 0.004) dipEnd = t + 0.06;
    const flick = (t < dipEnd ? 0.78 : 1) * (0.95 + 0.05 * Math.sin(t * 13.1) * Math.sin(t * 7.3));
    const beam = ((t % 7.5) / 7.5) * 1.3 - 0.15;

    const nPart = stepParticles(dt);
    draw({ t, tiltX: tilt.x, tiltY: tilt.y, on: clamp(onT / POWER_DUR, 0, 1), flick, beam, glitch, gseed: glitchSeed }, nPart);
    sendReady();
  }

  function shouldRun() { return ready && !reduced && visible && !document.hidden && !destroyed && !lost && !failed; }
  function stopLoop() { if (raf) { cancelAnimationFrame(raf); raf = 0; } }
  function updateLoop() {
    if (shouldRun()) { if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); } }
    else stopLoop();
  }

  // --- eventos ---
  function onMove(e) {
    const r = canvas.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return;
    const cu = (e.clientX - r.left) / r.width, cv = (e.clientY - r.top) / r.height;
    ptr.u = (cu - 0.5) * fit[0] + 0.5;
    ptr.v = (cv - 0.5) * fit[1] + 0.5;
    ptr.inside = ptr.u > -0.08 && ptr.u < 1.08 && ptr.v > -0.06 && ptr.v < 1.06;
    ptr.tx = clamp((cu - 0.5) / 0.7, -1, 1);
    ptr.ty = clamp((cv - 0.5) / 0.7, -1, 1);
    ptr.has = true;
    ptr.touch = e.pointerType === 'touch' || e.pointerType === 'pen';
    if (ptr.touch) ptr.touchUntil = t + 1.6;
  }
  function onOut(e) { if (!e.relatedTarget) ptr.has = false; }
  function onBlur() { ptr.has = false; }
  function onVis() { updateLoop(); }
  function onMotionPref() {
    reduced = !!(rmq && rmq.matches);
    updateLoop();
    if (reduced) renderStatic(); else if (ready) { onT = POWER_DUR; }
  }
  window.addEventListener('pointermove', onMove, { passive: true });
  window.addEventListener('pointerdown', onMove, { passive: true });
  window.addEventListener('mouseout', onOut, { passive: true });
  window.addEventListener('blur', onBlur);
  document.addEventListener('visibilitychange', onVis);
  if (rmq) { rmq.addEventListener ? rmq.addEventListener('change', onMotionPref) : rmq.addListener(onMotionPref); }

  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => applySize(false)) : null;
  if (ro) ro.observe(root); else window.addEventListener('resize', onWinResize);
  function onWinResize() { applySize(false); }
  const io = typeof IntersectionObserver !== 'undefined'
    ? new IntersectionObserver((ents) => { visible = ents[ents.length - 1].isIntersecting; updateLoop(); }, { rootMargin: '80px' })
    : null;
  if (io) io.observe(root);

  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    if (destroyed) return;
    lost = true;
    stopLoop();
    if (!ready) bootGen++;   // el arranque en curso se abandona; se repite al restaurar
    clearTimeout(lostTimer);
    lostTimer = setTimeout(showFallback, 3000);   // si no vuelve, queda el retrato de respaldo
  });
  canvas.addEventListener('webglcontextrestored', () => {
    clearTimeout(lostTimer);
    if (destroyed || failed) return;
    if (!ready) { lost = false; boot(++bootGen); return; }
    try { initGL(); lost = false; uploadAll(); updateLoop(); if (reduced) renderStatic(); }
    catch (err) { console.warn('[avatar-c]', err); showFallback(); }
  });

  // --- arranque asíncrono (no bloquea) ---
  const loadImage = (url) => new Promise((res, rej) => {
    const im = new Image();
    im.crossOrigin = 'anonymous';
    im.decoding = 'async';
    im.onload = () => res(im);
    im.onerror = () => rej(new Error('No se pudo cargar ' + url));
    im.src = url;
  });

  // Imágenes y análisis: no dependen del contexto GL, así que se hacen una sola vez.
  function prepare() {
    if (!prep) {
      prep = (async () => {
        const [ph, dp] = await Promise.all([loadImage(src), loadImage(depthSrc).catch(() => null)]);
        if (destroyed) return;
        photoImg = ph;
        data = await analyze(ph, dp, alive);
      })();
    }
    return prep;
  }

  async function boot(gen) {
    const stale = () => destroyed || gen !== bootGen;
    if (!getContext()) { showFallback(); return; }
    try { initGL(); } catch (err) { console.warn('[avatar-c]', err); showFallback(); return; }
    try {
      await prepare();
      if (!data || stale()) return;
      measure();
      if (canvas.width !== devW || canvas.height !== devH) { canvas.width = devW; canvas.height = devH; }
      texH = Math.round(clamp(imgH || 960, 320, 1600));
      for (const part of [0, 1, 2]) { rasterize(part); await idle(); if (stale()) return; }
      if (lost) return;
      uploadAll();
      await idle(); if (stale() || lost) return;
      t = 0; onT = 0;
      solveOffset(oscTarget(0));
      grid(true);
      ready = true;
      if (reduced) {
        canvas.style.opacity = '0';
        canvas.style.transition = 'opacity .5s ease';
        renderStatic();
        requestAnimationFrame(() => { canvas.style.opacity = '1'; });
      } else updateLoop();
    } catch (err) {
      if (!stale()) { console.warn('[avatar-c]', err); showFallback(); }
    }
  }
  boot(bootGen);

  return {
    destroy() {
      if (destroyed) return;
      destroyed = true;
      stopLoop();
      clearTimeout(resizeTimer);
      clearTimeout(lostTimer);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', onMove);
      window.removeEventListener('mouseout', onOut);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('resize', onWinResize);
      document.removeEventListener('visibilitychange', onVis);
      if (rmq) { rmq.removeEventListener ? rmq.removeEventListener('change', onMotionPref) : rmq.removeListener(onMotionPref); }
      if (ro) ro.disconnect();
      if (io) io.disconnect();
      freeGL();
      if (gl) { const ext = gl.getExtension('WEBGL_lose_context'); if (ext) ext.loseContext(); }
      gl = null;
      photoImg = null; data = null;
      for (const c of [photoCv, contCv, meshCv]) if (c) { c.width = 0; c.height = 0; }
      photoCv = contCv = meshCv = null;
      root.remove();
    },
    setHumanity(v) {
      const n = Number(v);
      if (!Number.isFinite(n)) return;
      base = clamp(n, 0, 1);
      if (reduced) renderStatic();
    },
  };
}
