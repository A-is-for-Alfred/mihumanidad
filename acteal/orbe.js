import * as THREE from 'three';

const CONFIG = {
  dialogos: 'dialogos.json', // cada código QR de la ofrenda abre uno: ?d=<id>
  distancia: 2.2,          // unidades de escena entre la cámara y la orbe (≈ metros)
  elevacion: 0.28,         // la orbe aparece un poco arriba del centro para dejar sitio a los subtítulos
  radio: 0.2,
  colorNucleo: new THREE.Color('#FFB52E'),  // cempasúchil claro
  colorBorde: new THREE.Color('#F2711C'),   // cempasúchil
  colorCalor: new THREE.Color('#FFE9C2'),   // el centro arde en ámbar, no en blanco
  petalos: 90,
  retrasoVoz: 1.6,         // segundos entre que aparece la orbe y empieza a hablar
};

const $ = (id) => document.getElementById(id);
const menosMovimiento = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- Escena ---------- */

const lienzo = $('escena');
const renderer = new THREE.WebGLRenderer({ canvas: lienzo, antialias: true, alpha: true });
renderer.setClearColor(0x000000, 0);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));

const escena = new THREE.Scene();
const camara = new THREE.PerspectiveCamera(60, 1, 0.05, 50);
const orbe = new THREE.Group();
orbe.position.set(0, CONFIG.elevacion, -CONFIG.distancia);
escena.add(orbe);

// Ruido simplex 3D (Ashima Arts / Stefan Gustavson, licencia MIT)
const RUIDO = /* glsl */`
vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0); const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy)); vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz); vec3 l=1.0-g; vec3 i1=min(g.xyz,l.zxy); vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx; vec3 x2=x0-i2+C.yyy; vec3 x3=x0-D.yyy;
  i=mod289(i);
  vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=0.142857142857; vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.0*floor(p*ns.z*ns.z); vec4 x_=floor(j*ns.z); vec4 y_=floor(j-7.0*x_);
  vec4 x=x_*ns.x+ns.yyyy; vec4 y=y_*ns.x+ns.yyyy; vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy); vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.0+1.0; vec4 s1=floor(b1)*2.0+1.0; vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy; vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x); vec3 p1=vec3(a0.zw,h.y); vec3 p2=vec3(a1.xy,h.z); vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x; p1*=norm.y; p2*=norm.z; p3*=norm.w;
  vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0); m=m*m;
  return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}`;

const uniformes = {
  uTiempo: { value: 0 },
  uNivel: { value: 0 },
  uAparicion: { value: 1 },
  uNucleo: { value: CONFIG.colorNucleo },
  uBorde: { value: CONFIG.colorBorde },
  uCalor: { value: CONFIG.colorCalor },
};

// Núcleo: esfera que ondula con el ruido; el centro se enciende en ámbar cuando habla.
// Escribe profundidad para que los pétalos que pasan por detrás queden detrás.
const nucleo = new THREE.Mesh(
  new THREE.IcosahedronGeometry(CONFIG.radio, 24),
  new THREE.ShaderMaterial({
    uniforms: uniformes,
    transparent: true,
    depthWrite: true,
    vertexShader: /* glsl */`
      uniform float uTiempo; uniform float uNivel;
      varying vec3 vNormal; varying vec3 vVista; varying float vRuido;
      ${RUIDO}
      void main() {
        float n = snoise(normal * 1.4 + vec3(uTiempo * 0.35, uTiempo * 0.27, 0.0));
        vRuido = n;
        vec3 p = position + normal * n * (0.006 + uNivel * 0.02);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vNormal = normalize(normalMatrix * normal);
        vVista = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uNucleo; uniform vec3 uBorde; uniform vec3 uCalor; uniform float uNivel; uniform float uAparicion;
      varying vec3 vNormal; varying vec3 vVista; varying float vRuido;
      void main() {
        float f = 1.0 - max(dot(vNormal, vVista), 0.0);
        float borde = pow(f, 2.2);
        float centro = pow(1.0 - f, 3.0);
        vec3 col = mix(uBorde, uNucleo, centro);
        col += uCalor * centro * (0.15 + uNivel * 0.55);
        col += uBorde * borde * (0.5 + uNivel * 1.3);
        col *= 0.86 + 0.14 * vRuido;
        float a = clamp(0.5 + centro * 0.5 + borde * 0.45, 0.0, 1.0) * uAparicion;
        gl_FragColor = vec4(col, a);
        #include <colorspace_fragment>
      }`,
  }),
);
orbe.add(nucleo);

function texturaRadial(paradas) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  for (const [pos, alfa] of paradas) grad.addColorStop(pos, `rgba(255,255,255,${alfa})`);
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const texHalo = texturaRadial([[0, 1], [0.18, 0.55], [0.45, 0.14], [1, 0]]);
const texPunto = texturaRadial([[0, 1], [0.35, 0.6], [1, 0]]);

function halo(escala, color) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({
    map: texHalo, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  s.scale.setScalar(escala);
  s.userData.base = escala;
  orbe.add(s);
  return s;
}
const haloCerca = halo(CONFIG.radio * 4.2, CONFIG.colorNucleo);
const haloLejos = halo(CONFIG.radio * 10, CONFIG.colorBorde);
// Una llama tenue sobre la orbe: la luz de vela que da forma de espíritu.
const llama = halo(1, CONFIG.colorBorde);
llama.scale.set(CONFIG.radio * 2.6, CONFIG.radio * 6, 1);
llama.position.y = CONFIG.radio * 1.1;

// Brasas: polvo de luz que acompaña a los pétalos.
function chispas(cantidad, radioMin, radioMax, tamano) {
  const pos = new Float32Array(cantidad * 3);
  for (let i = 0; i < cantidad; i++) {
    const v = new THREE.Vector3().randomDirection().multiplyScalar(THREE.MathUtils.lerp(radioMin, radioMax, Math.random()));
    v.y *= 0.8;
    pos.set([v.x, v.y, v.z], i * 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const p = new THREE.Points(geo, new THREE.PointsMaterial({
    size: tamano, map: texPunto, color: CONFIG.colorNucleo, transparent: true, opacity: 0.6,
    depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  orbe.add(p);
  return p;
}
const brasas = chispas(50, CONFIG.radio * 1.4, CONFIG.radio * 3.4, 0.018);

/* ---------- Pétalos de cempasúchil ---------- */

// Pétalo dibujado a mano: base angosta y oscura, abanico que se abre y un borde rizado más claro.
function texturaPetalo() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 192;
  const g = c.getContext('2d');
  g.beginPath();
  g.moveTo(64, 188);
  g.bezierCurveTo(34, 156, 8, 96, 12, 48);
  const lobulos = 5;
  for (let i = 0; i < lobulos; i++) {
    const xa = 12 + (104 * i) / lobulos, xb = 12 + (104 * (i + 1)) / lobulos;
    g.quadraticCurveTo((xa + xb) / 2, i % 2 ? 14 : 4, xb, i % 2 ? 44 : 40);
  }
  g.bezierCurveTo(120, 96, 94, 156, 64, 188);
  g.closePath();
  const grad = g.createLinearGradient(0, 188, 0, 6);
  grad.addColorStop(0, '#A8360A');
  grad.addColorStop(0.45, '#F2711C');
  grad.addColorStop(1, '#FFB22B');
  g.fillStyle = grad;
  g.fill();
  g.save();
  g.clip();
  g.globalAlpha = 0.28;
  g.strokeStyle = '#7A2604';
  g.lineWidth = 2;
  for (const dx of [-34, -16, 0, 16, 34]) {
    g.beginPath(); g.moveTo(64, 186); g.quadraticCurveTo(64 + dx * 0.5, 110, 64 + dx, 30); g.stroke();
  }
  g.restore();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const cuantosPetalos = menosMovimiento ? 40 : CONFIG.petalos;
const petalos = new THREE.InstancedMesh(
  new THREE.PlaneGeometry(0.05, 0.075),
  new THREE.MeshBasicMaterial({ map: texturaPetalo(), side: THREE.DoubleSide, alphaTest: 0.4 }),
  cuantosPetalos,
);
petalos.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
orbe.add(petalos);

// Cada pétalo gira alrededor de la orbe, baja despacio dando tumbos y vuelve a entrar por arriba.
const ALTO = 0.5;
const datosPetalo = Array.from({ length: cuantosPetalos }, (_, i) => {
  const tinte = new THREE.Color('#ffffff').lerp(new THREE.Color('#ffc48a'), Math.random() * 0.6);
  petalos.setColorAt(i, tinte);
  return {
    radio: THREE.MathUtils.lerp(CONFIG.radio * 1.5, CONFIG.radio * 3.8, Math.random()),
    angulo: Math.random() * Math.PI * 2,
    altura: THREE.MathUtils.lerp(-ALTO, ALTO, Math.random()),
    vuelta: THREE.MathUtils.lerp(0.12, 0.35, Math.random()) * (Math.random() < 0.85 ? 1 : -1),
    caida: THREE.MathUtils.lerp(0.025, 0.06, Math.random()),
    eje: new THREE.Vector3().randomDirection(),
    tumbo: THREE.MathUtils.lerp(0.6, 1.8, Math.random()),
    fase: Math.random() * Math.PI * 2,
    escala: THREE.MathUtils.lerp(0.7, 1.25, Math.random()),
  };
});
petalos.instanceColor.needsUpdate = true;

const m4 = new THREE.Matrix4();
const qPetalo = new THREE.Quaternion();
const pPetalo = new THREE.Vector3();
const sPetalo = new THREE.Vector3();

function moverPetalos(t, dt, nivelVoz, visible) {
  for (let i = 0; i < cuantosPetalos; i++) {
    const d = datosPetalo[i];
    d.angulo += d.vuelta * dt * (1 + nivelVoz * 2.2);
    d.altura -= d.caida * dt * (1 + nivelVoz * 0.8);
    if (d.altura < -ALTO) { d.altura = ALTO; d.angulo = Math.random() * Math.PI * 2; }
    const entrada = Math.min(1, (ALTO - Math.abs(d.altura)) / 0.12); // aparecen y se desvanecen en los extremos
    const r = d.radio * (1 + nivelVoz * 0.22);
    pPetalo.set(Math.cos(d.angulo) * r, d.altura + Math.sin(t * 0.8 + d.fase) * 0.02, Math.sin(d.angulo) * r);
    qPetalo.setFromAxisAngle(d.eje, t * d.tumbo + d.fase);
    sPetalo.setScalar(d.escala * entrada * visible);
    petalos.setMatrixAt(i, m4.compose(pPetalo, qPetalo, sPetalo));
  }
  petalos.instanceMatrix.needsUpdate = true;
}

// Ondas: anillos que salen del núcleo en los golpes de voz.
const ondas = Array.from({ length: 3 }, () => {
  const m = new THREE.Mesh(
    new THREE.RingGeometry(CONFIG.radio * 1.02, CONFIG.radio * 1.09, 96),
    new THREE.MeshBasicMaterial({
      color: CONFIG.colorNucleo, transparent: true, opacity: 0, depthWrite: false,
      side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    }),
  );
  m.userData.vida = 1;
  orbe.add(m);
  return m;
});
let ultimaOnda = 0;
let vozAnterior = 0;

function lanzarOnda(t) {
  const libre = ondas.find((o) => o.userData.vida >= 1);
  if (!libre) return;
  libre.userData.vida = 0;
  ultimaOnda = t;
}

/* ---------- Orientación del teléfono (3 grados de libertad) ---------- */

const giro = { alpha: 0, beta: 0, gamma: 0, recibido: false };
let usarGiro = false;
const objetivo = new THREE.Quaternion();
const eje = new THREE.Vector3(0, 0, 1);
const euler = new THREE.Euler();
const q0 = new THREE.Quaternion();
const qAtras = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5)); // la cámara mira por la espalda del teléfono

function alGirar(e) {
  if (e.alpha == null) return;
  giro.alpha = e.alpha; giro.beta = e.beta; giro.gamma = e.gamma;
  giro.recibido = true;
}

function pedirMovimiento() {
  if (typeof DeviceOrientationEvent === 'undefined') return Promise.resolve(false);
  const escuchar = () => { addEventListener('deviceorientation', alGirar); return true; };
  if (typeof DeviceOrientationEvent.requestPermission === 'function') {
    // iOS: debe llamarse dentro del toque del usuario.
    return DeviceOrientationEvent.requestPermission()
      .then((r) => (r === 'granted' ? escuchar() : false))
      .catch(() => false);
  }
  return Promise.resolve(escuchar());
}

function quaternionDelTelefono(salida) {
  const r = THREE.MathUtils.degToRad;
  const pantalla = r(screen.orientation?.angle ?? window.orientation ?? 0);
  euler.set(r(giro.beta), r(giro.alpha), -r(giro.gamma), 'YXZ');
  salida.setFromEuler(euler).multiply(qAtras).multiply(q0.setFromAxisAngle(eje, -pantalla));
  return salida;
}

function esperar(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function esperarGiro(ms) {
  const fin = performance.now() + ms;
  while (!giro.recibido && performance.now() < fin) await esperar(50);
  return giro.recibido;
}

const base = new THREE.Vector3().copy(orbe.position);

// Coloca la orbe frente a donde apunta el teléfono en este momento; luego se queda fija en ese lugar.
function colocarOrbe() {
  if (!usarGiro) { base.set(0, CONFIG.elevacion, -CONFIG.distancia); return; }
  quaternionDelTelefono(camara.quaternion);
  const frente = new THREE.Vector3(0, 0, -1).applyQuaternion(camara.quaternion);
  frente.y = THREE.MathUtils.clamp(frente.y, -0.55, 0.55);
  frente.normalize();
  const arriba = new THREE.Vector3(0, 1, 0).applyQuaternion(camara.quaternion);
  base.copy(frente).multiplyScalar(CONFIG.distancia).addScaledVector(arriba, CONFIG.elevacion);
}

/* ---------- Diálogos: cada QR de la ofrenda abre uno ---------- */

const ESCUCHADAS = 'ofrenda-acteal:escuchadas';
function leerEscuchadas() {
  try { return new Set(JSON.parse(localStorage.getItem(ESCUCHADAS) || '[]')); } catch { return new Set(); }
}
function marcarEscuchada(id) {
  try { localStorage.setItem(ESCUCHADAS, JSON.stringify([...leerEscuchadas().add(id)])); } catch { /* sin almacenamiento */ }
}

let dialogo = null;
let dialogos = [];
const promesaDialogo = fetch(CONFIG.dialogos).then((r) => r.json()).then((lista) => {
  dialogos = lista;
  const pedido = new URLSearchParams(location.search).get('d');
  dialogo = lista.find((x) => x.id === pedido) ?? lista[0];
  const n = lista.indexOf(dialogo) + 1;
  $('segmento').textContent = `Voz ${n} de ${lista.length} · Ofrenda a Acteal`;
  $('titulo').textContent = dialogo.titulo;
  $('bajada').textContent = dialogo.bajada;
  document.title = `${dialogo.titulo} · Ofrenda a Acteal`;
  pintarOtras();
  return dialogo;
});

function pintarOtras() {
  const escuchadas = leerEscuchadas();
  $('otras-lista').replaceChildren(...dialogos.map((x, i) => {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = `?d=${encodeURIComponent(x.id)}`;
    if (x === dialogo) a.setAttribute('aria-current', 'page');
    if (escuchadas.has(x.id)) a.classList.add('escuchada');
    const num = document.createElement('b');
    num.textContent = i + 1;
    const nombre = document.createElement('span');
    nombre.textContent = x.titulo;
    a.append(num, nombre);
    li.append(a);
    return li;
  }));
}

/* ---------- Voz y subtítulos ---------- */

const promesaAudio = promesaDialogo.then((d) => fetch(d.audio)).then((r) => {
  if (!r.ok) throw new Error(`No se encontró ${r.url}`);
  return r.arrayBuffer();
});
const promesaSubs = promesaDialogo.then((d) => fetch(d.subtitulos)).then((r) => r.json()).catch(() => []);
let frases = [];
promesaSubs.then((f) => {
  frases = f;
  if (f.length) $('duracion').textContent = `Voz de ${Math.round(f.at(-1).fin)} s`;
});

let ctx, analizador, buffer, fuente;
let inicioVoz = 0;
let estado = 'espera'; // espera | hablando | pausa | terminado
const muestras = new Float32Array(1024);
let nivel = 0;

function crearAudio() {
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch { /* Safari < 16.4 */ }
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  ctx.resume();
  analizador = ctx.createAnalyser();
  analizador.fftSize = 1024;
  analizador.connect(ctx.destination);
}

async function prepararVoz() {
  const bytes = await promesaAudio;
  buffer = await ctx.decodeAudioData(bytes.slice(0));
}

function hablar() {
  if (!buffer) return;
  if (fuente) { fuente.onended = null; try { fuente.stop(); } catch { /* ya terminó */ } }
  if (ctx.state === 'suspended') ctx.resume();
  const esta = ctx.createBufferSource();
  esta.buffer = buffer;
  esta.connect(analizador);
  esta.onended = () => { if (fuente === esta) terminar(); };
  inicioVoz = ctx.currentTime + 0.05;
  esta.start(inicioVoz);
  fuente = esta;
  estado = 'hablando';
  $('pausa').disabled = false;
  $('pausa').textContent = 'Pausa';
  $('repetir').classList.remove('destacado');
  $('otras').hidden = true;
}

function terminar() {
  estado = 'terminado';
  $('subtitulo').textContent = '';
  $('pausa').disabled = true;
  $('repetir').classList.add('destacado');
  marcarEscuchada(dialogo.id);
  pintarOtras();
  $('otras').hidden = dialogos.length < 2;
}

function alternarPausa() {
  if (estado === 'hablando') {
    ctx.suspend(); estado = 'pausa'; $('pausa').textContent = 'Seguir';
  } else if (estado === 'pausa') {
    ctx.resume(); estado = 'hablando'; $('pausa').textContent = 'Pausa';
  }
}

// Cada frase se queda hasta que empieza la siguiente: así no se borra si Whisper no ubicó sus últimas
// palabras (una dirección web, una sigla). La última se va 1.2 s después de terminar.
function subtituloEn(t) {
  const i = frases.findLastIndex((f) => f.inicio <= t + 0.05);
  if (i < 0) return '';
  if (i === frases.length - 1 && t > frases[i].fin + 1.2) return '';
  return frases[i].texto;
}

function medirVoz() {
  if (estado !== 'hablando') return 0;
  analizador.getFloatTimeDomainData(muestras);
  let suma = 0;
  for (const m of muestras) suma += m * m;
  const rms = Math.sqrt(suma / muestras.length);
  return THREE.MathUtils.clamp((rms - 0.015) / 0.16, 0, 1);
}

/* ---------- Cámara ---------- */

async function encenderCamara() {
  const video = $('camara');
  if (!navigator.mediaDevices?.getUserMedia) return false;
  try {
    const flujo = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
    });
    video.srcObject = flujo;
    await video.play();
    const ajustes = flujo.getVideoTracks()[0]?.getSettings?.() ?? {};
    video.classList.toggle('espejo', ajustes.facingMode !== 'environment' && !matchMedia('(pointer: coarse)').matches);
    video.classList.add('encendida');
    return true;
  } catch (e) {
    console.warn('Cámara no disponible:', e);
    return false;
  }
}

/* ---------- Inicio ---------- */

let aparicion = 1;   // 0 → 1 cuando la orbe se materializa
let tAparicion = -1;

$('empezar').addEventListener('click', async () => {
  const boton = $('empezar');
  boton.disabled = true;
  boton.textContent = 'Preparando…';
  crearAudio();                       // dentro del toque: desbloquea el sonido
  const pMovimiento = pedirMovimiento(); // dentro del toque: iOS lo exige
  const pCamara = encenderCamara();
  const pVoz = prepararVoz().catch((e) => { console.error(e); return 'error'; });

  const [movimiento, hayCamara, voz] = await Promise.all([pMovimiento, pCamara, pVoz]);
  usarGiro = movimiento && await esperarGiro(900);

  $('inicio').hidden = true;
  $('experiencia').hidden = false;
  $('recentrar').hidden = !usarGiro;
  $('pista').textContent = usarGiro
    ? 'Mueve el teléfono despacio: la luz se queda en su lugar.'
    : hayCamara ? 'Sube el volumen. La luz está frente a ti.' : 'No se pudo abrir la cámara. La luz habla igual.';
  setTimeout(() => $('pista').classList.add('oculta'), 6500);

  colocarOrbe();
  orbe.position.copy(base);
  materializar();
  navigator.wakeLock?.request('screen').catch(() => {});

  if (voz === 'error') {
    $('subtitulo').textContent = 'No se pudo cargar la voz. Revisa la conexión y recarga la página.';
    $('pausa').disabled = true;
    $('repetir').disabled = true;
    return;
  }
  setTimeout(hablar, CONFIG.retrasoVoz * 1000);
});

function materializar() { aparicion = 0; tAparicion = reloj.getElapsedTime(); }

$('pausa').addEventListener('click', alternarPausa);
$('repetir').addEventListener('click', hablar);
$('recentrar').addEventListener('click', () => { colocarOrbe(); materializar(); });

document.addEventListener('visibilitychange', () => {
  if (document.hidden && estado === 'hablando') alternarPausa();
});

// Navegadores dentro de otras apps (Instagram, Facebook, TikTok…) suelen bloquear la cámara.
if (/Instagram|FBAN|FBAV|FB_IAB|Line\/|TikTok|musical_ly|Snapchat/i.test(navigator.userAgent)) {
  $('aviso-app').hidden = false;
}

// En computadora: código QR de esta misma dirección para abrirla en el celular.
if (!matchMedia('(pointer: coarse)').matches && typeof qrcode !== 'undefined') {
  const qr = qrcode(0, 'M');
  qr.addData(location.href);
  qr.make();
  $('qr-imagen').innerHTML = qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
  $('qr').hidden = false;
}

/* ---------- Animación ---------- */

const reloj = new THREE.Clock();
const puntero = new THREE.Vector2();
addEventListener('pointermove', (e) => {
  puntero.set(e.clientX / innerWidth - 0.5, e.clientY / innerHeight - 0.5);
});

function ajustarTamano() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camara.aspect = w / h;
  camara.updateProjectionMatrix();
}
addEventListener('resize', ajustarTamano);
ajustarTamano();

let tAnterior = 0;
function cuadro() {
  const t = reloj.getElapsedTime();
  const dt = Math.min(t - tAnterior, 0.05);
  tAnterior = t;

  // Cámara virtual: sigue al teléfono, o se inclina un poco con el puntero en computadora.
  if (usarGiro) {
    camara.quaternion.slerp(quaternionDelTelefono(objetivo), 0.35);
  } else {
    euler.set(-puntero.y * 0.12, -puntero.x * 0.16, 0, 'YXZ');
    camara.quaternion.slerp(objetivo.setFromEuler(euler), 0.06);
  }

  // Nivel de brillo: la voz manda; en silencio la orbe titila como vela.
  const voz = medirVoz();
  nivel += (voz - nivel) * (voz > nivel ? 0.5 : 0.09);
  const vela = menosMovimiento ? 0 : 0.035 * Math.sin(t * 7.3) + 0.025 * Math.sin(t * 11.9 + 1.3) + 0.02 * Math.sin(t * 3.1);
  const respiro = 0.12 + 0.05 * Math.sin(t * 1.3) + vela;
  const brillo = Math.max(nivel, respiro);

  if (tAparicion >= 0) {
    const k = Math.min((t - tAparicion) / 1.2, 1);
    aparicion = 1 - Math.pow(1 - k, 3);
    if (k >= 1) tAparicion = -1;
  }

  orbe.position.copy(base);
  orbe.position.y += menosMovimiento ? 0 : Math.sin(t * 0.9) * 0.035;
  const escala = (0.6 + 0.4 * aparicion) * (1 + brillo * 0.08);
  nucleo.scale.setScalar(escala);

  uniformes.uTiempo.value = t * (1 + nivel * 1.6);
  uniformes.uNivel.value = brillo;
  uniformes.uAparicion.value = aparicion;

  haloCerca.material.opacity = (0.35 + brillo * 0.65) * aparicion;
  haloCerca.scale.setScalar(haloCerca.userData.base * (0.9 + brillo * 0.45));
  haloLejos.material.opacity = (0.12 + brillo * 0.38) * aparicion;
  haloLejos.scale.setScalar(haloLejos.userData.base * (0.85 + brillo * 0.5));

  llama.material.opacity = (0.16 + brillo * 0.3 + vela) * aparicion;
  llama.scale.y = CONFIG.radio * (5.6 + brillo * 1.6 + vela * 6);

  moverPetalos(t, menosMovimiento ? dt * 0.3 : dt, nivel, aparicion);
  brasas.rotation.y += 0.004 * (1 + nivel * 3);
  brasas.position.y = ((t * 0.04) % 0.2) - 0.1;
  brasas.material.opacity = (0.3 + brillo * 0.5) * aparicion;

  // Una onda por cada golpe de voz (cuando el volumen sube de golpe), no mientras se mantiene alto.
  if (!menosMovimiento && voz > 0.6 && vozAnterior < 0.45 && t - ultimaOnda > 0.5) lanzarOnda(t);
  vozAnterior = voz;
  for (const o of ondas) {
    if (o.userData.vida >= 1) { o.material.opacity = 0; continue; }
    o.userData.vida = Math.min(o.userData.vida + 0.016 / 1.1, 1);
    const v = o.userData.vida;
    o.quaternion.copy(camara.quaternion);
    o.scale.setScalar(1 + v * 2.2);
    o.material.opacity = 0.4 * (1 - v) * (1 - v);
  }

  if (estado === 'hablando' || estado === 'pausa') {
    const texto = subtituloEn(ctx.currentTime - inicioVoz);
    if ($('subtitulo').textContent !== texto) $('subtitulo').textContent = texto;
  }

  renderer.render(escena, camara);
  requestAnimationFrame(cuadro);
}
requestAnimationFrame(cuadro);
