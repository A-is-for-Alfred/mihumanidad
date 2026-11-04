import * as THREE from 'three';

const CONFIG = {
  servicio: 'https://n8n.srv1091049.hstgr.cloud/webhook/orbe-ccoia-conversa', // flujo de n8n: Claude Sonnet y la voz de ElevenLabs
  saludo: 'saludo.json',   // grabado una vez con la misma voz, para no gastar cada vez que alguien abre la página
  distancia: 2.2,          // unidades de escena entre la cámara y la orbe (≈ metros)
  elevacion: 0.28,         // la orbe aparece un poco arriba del centro para dejar sitio a los subtítulos
  radio: 0.22,
  colorNucleo: new THREE.Color('#CFE84A'),  // lima claro CCOIA
  colorBorde: new THREE.Color('#A7C41C'),   // lima CCOIA
  retrasoVoz: 1.4,         // segundos entre que aparece la orbe y empieza a hablar
  turnosHistorial: 8,      // lo que se manda de la conversación para que la orbe siga el hilo
  esperaRespuesta: 30000,  // milisegundos antes de dar la pregunta por perdida
};

// Si no se pudo bajar el saludo grabado, la orbe lo dice con la voz del teléfono.
const SALUDO = 'Hola, soy la orbe del CCOIA, el Consejo Coordinador de Inteligencia Artificial de la UNAM. ' +
  'Pregúntame lo que quieras sobre la inteligencia artificial en tu universidad. Toca «Hablar» y dime.';
const SUGERENCIAS = [
  '¿Qué es el CCOIA?',
  '¿Dónde puedo estudiar inteligencia artificial?',
  '¿Puedo usar inteligencia artificial en mis tareas?',
  '¿Qué es el supercómputo?',
];

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
};

// Núcleo: esfera que ondula con el ruido; el centro se pone al rojo blanco cuando habla.
const nucleo = new THREE.Mesh(
  new THREE.IcosahedronGeometry(CONFIG.radio, 24),
  new THREE.ShaderMaterial({
    uniforms: uniformes,
    transparent: true,
    depthWrite: false,
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
      uniform vec3 uNucleo; uniform vec3 uBorde; uniform float uNivel; uniform float uAparicion;
      varying vec3 vNormal; varying vec3 vVista; varying float vRuido;
      void main() {
        float f = 1.0 - max(dot(vNormal, vVista), 0.0);
        float borde = pow(f, 2.2);
        float centro = pow(1.0 - f, 3.0);
        vec3 col = mix(uBorde, uNucleo, centro);
        col += vec3(1.0) * centro * (0.2 + uNivel * 0.6);
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

// Chispas que orbitan en una capa delgada alrededor del núcleo.
function chispas(cantidad, radioMin, radioMax, tamano) {
  const pos = new Float32Array(cantidad * 3);
  for (let i = 0; i < cantidad; i++) {
    const v = new THREE.Vector3().randomDirection().multiplyScalar(THREE.MathUtils.lerp(radioMin, radioMax, Math.random()));
    v.y *= 0.55;
    pos.set([v.x, v.y, v.z], i * 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const p = new THREE.Points(geo, new THREE.PointsMaterial({
    size: tamano, map: texPunto, color: CONFIG.colorNucleo, transparent: true, opacity: 0.7,
    depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  orbe.add(p);
  return p;
}
const chispasA = chispas(110, CONFIG.radio * 1.5, CONFIG.radio * 2.4, 0.028);
const chispasB = chispas(60, CONFIG.radio * 2.2, CONFIG.radio * 3.2, 0.02);
chispasB.rotation.z = 0.5;

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

/* ---------- Voz de la orbe ---------- */

let ctx, analizador, fuente;
let frases = [];             // [{ texto, inicio, fin }] de lo que la orbe dice ahora
let inicioVoz = 0;
let estado = 'espera';       // espera | escuchando | pensando | hablando
let vozDelNavegador = false; // la voz sale de speechSynthesis, sin analizador: el brillo se simula
let alCallar = null;         // termina la promesa de decir() si se interrumpe a la orbe
const muestras = new Float32Array(1024);
let nivel = 0;

function crearAudio() {
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  ctx.resume();
  analizador = ctx.createAnalyser();
  analizador.fftSize = 1024;
  analizador.connect(ctx.destination);
}

// iOS distingue «reproducir» de «reproducir y grabar»: sin volver a «reproducir» después de escuchar,
// la voz sale bajita por el auricular.
function sesionDeAudio(tipo) {
  try { if (navigator.audioSession) navigator.audioSession.type = tipo; } catch { /* Safari < 16.4 */ }
}

function callar() {
  if (fuente) { fuente.onended = null; try { fuente.stop(); } catch { /* ya terminó */ } fuente = null; }
  if (window.speechSynthesis) speechSynthesis.cancel();
  vozDelNavegador = false;
  frases = [];
  $('subtitulo').textContent = '';
  if (alCallar) { const listo = alCallar; alCallar = null; listo(); }
}

function bytesDeBase64(b64) {
  const binario = atob(b64);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return bytes.buffer;
}

// Si las frases llegaron sin tiempos, se reparten por su largo a lo largo del audio.
function conTiempos(lista, duracion) {
  if (lista.every((f) => f.inicio != null)) return lista;
  const total = lista.reduce((s, f) => s + f.texto.length, 0) || 1;
  let t = 0;
  return lista.map((f) => {
    const dura = duracion * f.texto.length / total;
    const conTiempo = { texto: f.texto, inicio: t, fin: t + dura };
    t += dura;
    return conTiempo;
  });
}

// Dice una respuesta: con el audio de ElevenLabs si llegó y, si no, con la voz del teléfono.
// La promesa se cumple cuando la orbe calla, ya sea porque terminó o porque la interrumpieron.
async function decir({ frases: lista = [], audio = null }) {
  callar();
  if (!lista.length) return;
  sesionDeAudio('playback');
  if (ctx.state === 'suspended') await ctx.resume();
  if (audio) {
    try {
      const buffer = await ctx.decodeAudioData(typeof audio === 'string' ? bytesDeBase64(audio) : audio.slice(0));
      return await new Promise((listo) => {
        const esta = ctx.createBufferSource();
        esta.buffer = buffer;
        esta.connect(analizador);
        esta.onended = () => {
          if (fuente !== esta) return;
          fuente = null;
          frases = [];
          $('subtitulo').textContent = '';
          alCallar = null;
          listo();
        };
        frases = conTiempos(lista, buffer.duration);
        inicioVoz = ctx.currentTime + 0.05;
        esta.start(inicioVoz);
        fuente = esta;
        alCallar = listo;
      });
    } catch (e) {
      console.warn('No se pudo reproducir el audio; hablo con la voz del navegador.', e);
    }
  }
  return decirConNavegador(lista);
}

let vozEspanol = null;
function elegirVoz() {
  const voces = window.speechSynthesis?.getVoices() ?? [];
  vozEspanol = ['es-MX', 'es-US', 'es-419', 'es']
    .map((idioma) => voces.find((v) => v.lang.replace('_', '-').startsWith(idioma)))
    .find(Boolean) ?? null;
}
if (window.speechSynthesis) {
  elegirVoz();
  speechSynthesis.addEventListener?.('voiceschanged', elegirVoz);
}

function decirConNavegador(lista) {
  return new Promise((listo) => {
    alCallar = listo;
    if (!window.speechSynthesis) {
      // Sin voz: cada frase se queda en pantalla el tiempo de leerla.
      let i = 0;
      const siguiente = () => {
        if (alCallar !== listo) return;
        if (i >= lista.length) { $('subtitulo').textContent = ''; alCallar = null; listo(); return; }
        $('subtitulo').textContent = lista[i].texto;
        setTimeout(siguiente, 1200 + lista[i++].texto.length * 55);
      };
      siguiente();
      return;
    }
    vozDelNavegador = true;
    lista.forEach((f, i) => {
      const u = new SpeechSynthesisUtterance(f.texto);
      u.lang = vozEspanol?.lang ?? 'es-MX';
      if (vozEspanol) u.voice = vozEspanol;
      u.onstart = () => { if (alCallar === listo) $('subtitulo').textContent = f.texto; };
      if (i === lista.length - 1) {
        u.onend = u.onerror = () => {
          if (alCallar !== listo) return;
          vozDelNavegador = false;
          $('subtitulo').textContent = '';
          alCallar = null;
          listo();
        };
      }
      speechSynthesis.speak(u);
    });
  });
}

// Cada frase se queda hasta que empieza la siguiente; la última, hasta que termina el audio.
function subtituloEn(t) {
  const i = frases.findLastIndex((f) => f.inicio <= t + 0.05);
  return i < 0 ? '' : frases[i].texto;
}

function medirVoz(t) {
  if (vozDelNavegador) return 0.3 + 0.35 * Math.abs(Math.sin(t * 9.1) * Math.sin(t * 3.7 + 1));
  if (!fuente) return 0;
  analizador.getFloatTimeDomainData(muestras);
  let suma = 0;
  for (const m of muestras) suma += m * m;
  const rms = Math.sqrt(suma / muestras.length);
  return THREE.MathUtils.clamp((rms - 0.015) / 0.16, 0, 1);
}

/* ---------- Conversación ---------- */

const historial = [];  // [{ rol: 'persona' | 'orbe', texto }]; vive solo en esta pestaña
let turno = 0;         // cada pregunta nueva deja sin efecto la respuesta que estuviera en camino

const ETIQUETAS = {
  espera: ['Hablar', 'Hablar con la orbe'],
  escuchando: ['Listo, enviar', 'Terminar y enviar la pregunta'],
  pensando: ['Pensando…', 'La orbe está pensando; toca para hacer otra pregunta'],
  hablando: ['Interrumpir', 'Interrumpir a la orbe y hablar'],
};

function ponerEstado(nuevo) {
  estado = nuevo;
  const boton = $('microfono');
  boton.dataset.estado = nuevo;
  [boton.textContent] = ETIQUETAS[nuevo];
  boton.setAttribute('aria-label', ETIQUETAS[nuevo][1]);
  $('sugerencias').hidden = nuevo !== 'espera';
}

function pintarSugerencias() {
  $('sugerencias').replaceChildren(...SUGERENCIAS.map((texto) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = texto;
    b.addEventListener('click', () => preguntar(texto));
    return b;
  }));
}

// Debajo de la respuesta, de dónde salió: enlaces a Gaceta UNAM y a los sitios oficiales.
// Las fuentes internas (el discurso unificado, los mensajes del CCOIA) no tienen enlace y no se muestran.
function pintarFuentes(todas = []) {
  const caja = $('fuentes');
  caja.replaceChildren();
  const lista = todas.filter((f) => f.url);
  if (!lista.length) return;
  const etiqueta = document.createElement('span');
  etiqueta.className = 'etiqueta';
  etiqueta.textContent = lista.length > 1 ? 'Fuentes:' : 'Fuente:';
  caja.append(etiqueta, ...lista.map((f) => {
    const a = document.createElement('a');
    a.textContent = f.titulo;
    a.href = f.url;
    a.target = '_blank';
    a.rel = 'noopener';
    return a;
  }));
}

function respuestaLocal(texto) {
  return { ok: false, texto, frases: [{ texto, inicio: null, fin: null }], audio: null, fuentes: [] };
}

async function preguntar(texto) {
  texto = texto.replace(/\s+/g, ' ').trim().slice(0, 400);
  if (!texto) return;
  const mio = ++turno;
  if (reconocedor) { const r = reconocedor; reconocedor = null; r.abort(); }
  callar();
  pintarFuentes();
  $('oido').textContent = texto;
  ponerEstado('pensando');

  let respuesta;
  try {
    const control = new AbortController();
    const limite = setTimeout(() => control.abort(), CONFIG.esperaRespuesta);
    const r = await fetch(CONFIG.servicio, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pregunta: texto, historial: historial.slice(-CONFIG.turnosHistorial), voz: true }),
      signal: control.signal,
    });
    clearTimeout(limite);
    respuesta = await r.json();
  } catch (e) {
    console.warn(e);
    respuesta = respuestaLocal('No pude conectarme. Revisa tu internet e inténtalo otra vez.');
  }
  if (mio !== turno) return;
  if (!Array.isArray(respuesta.frases) || !respuesta.frases.length) {
    respuesta = respuestaLocal(respuesta.texto || 'No tengo una respuesta para eso.');
  }
  if (respuesta.ok) historial.push({ rol: 'persona', texto }, { rol: 'orbe', texto: respuesta.texto });

  pintarFuentes(respuesta.fuentes);
  ponerEstado('hablando');
  await decir(respuesta);
  if (mio === turno) ponerEstado('espera');
}

/* ---------- Oído: el navegador convierte la voz en texto ---------- */

const Reconocimiento = window.SpeechRecognition || window.webkitSpeechRecognition;
let reconocedor = null;

function mostrarTeclado(mensaje) {
  $('escribir').hidden = false;
  $('teclado').setAttribute('aria-pressed', 'true');
  if (mensaje) $('subtitulo').textContent = mensaje;
}

function escuchar() {
  if (!Reconocimiento) {
    mostrarTeclado('Tu navegador no me deja escucharte, pero puedes escribirme.');
    $('texto').focus();
    return;
  }
  turno++;
  callar();
  pintarFuentes();
  sesionDeAudio('play-and-record');
  const r = new Reconocimiento();
  r.lang = 'es-MX';
  r.interimResults = true;
  r.maxAlternatives = 1;
  let final = '';
  let parcial = '';
  let error = '';
  r.onresult = (e) => {
    parcial = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (e.results[i].isFinal) final += e.results[i][0].transcript;
      else parcial += e.results[i][0].transcript;
    }
    $('oido').textContent = (final + parcial).trim();
  };
  r.onerror = (e) => { error = e.error; };
  r.onend = () => {
    if (reconocedor !== r) return;
    reconocedor = null;
    sesionDeAudio('playback');
    const texto = (final || parcial).trim();
    if (texto) { preguntar(texto); return; }
    ponerEstado('espera');
    if (error === 'not-allowed' || error === 'service-not-allowed') {
      mostrarTeclado('No tengo permiso para usar el micrófono. Puedes escribirme tu pregunta.');
    } else if (error === 'network') {
      $('subtitulo').textContent = 'No pude escucharte por un problema de conexión. Inténtalo otra vez o escríbeme.';
    } else if (error !== 'aborted') {
      $('subtitulo').textContent = 'No te escuché. Toca «Hablar» y vuelve a intentarlo.';
    }
  };
  reconocedor = r;
  $('oido').textContent = '';
  ponerEstado('escuchando');
  try {
    r.start();
  } catch (e) {
    console.warn(e);
    reconocedor = null;
    ponerEstado('espera');
  }
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

async function cargarSaludo() {
  try {
    const leer = (url, como) => fetch(url).then((r) => { if (!r.ok) throw new Error(`${url}: ${r.status}`); return r[como](); });
    const saludo = await leer(CONFIG.saludo, 'json');
    return { frases: saludo.frases, audio: await leer(saludo.audio, 'arrayBuffer') };
  } catch (e) {
    console.warn('Sin saludo grabado; lo digo con la voz del navegador.', e);
    return respuestaLocal(SALUDO);
  }
}
const promesaSaludo = cargarSaludo(); // se descarga mientras la persona lee

$('empezar').addEventListener('click', async () => {
  const boton = $('empezar');
  boton.disabled = true;
  boton.textContent = 'Preparando…';
  crearAudio();                        // dentro del toque: desbloquea el sonido…
  if (window.speechSynthesis) speechSynthesis.speak(new SpeechSynthesisUtterance('')); // …y la voz del navegador en iOS
  const pMovimiento = pedirMovimiento(); // dentro del toque: iOS lo exige
  const [movimiento, hayCamara, saludo] = await Promise.all([pMovimiento, encenderCamara(), promesaSaludo]);
  usarGiro = movimiento && await esperarGiro(900);

  $('inicio').hidden = true;
  $('experiencia').hidden = false;
  $('recentrar').hidden = !usarGiro;
  $('pista').textContent = usarGiro
    ? 'Mueve el teléfono despacio: la orbe se queda en su lugar.'
    : hayCamara ? 'Sube el volumen. La orbe está frente a ti.' : 'No se pudo abrir la cámara. La orbe te escucha igual.';
  setTimeout(() => $('pista').classList.add('oculta'), 6500);
  if (!Reconocimiento) mostrarTeclado();
  pintarSugerencias();

  colocarOrbe();
  orbe.position.copy(base);
  materializar();
  navigator.wakeLock?.request('screen').catch(() => {});

  const mio = ++turno;
  ponerEstado('hablando');
  await esperar(CONFIG.retrasoVoz * 1000);
  if (mio !== turno) return;
  await decir(saludo);
  if (mio === turno) ponerEstado('espera');
});

function materializar() { aparicion = 0; tAparicion = reloj.getElapsedTime(); }

$('microfono').addEventListener('click', () => {
  if (estado === 'escuchando') { reconocedor?.stop(); return; }
  escuchar();
});
$('teclado').addEventListener('click', () => {
  const abrir = $('escribir').hidden;
  $('escribir').hidden = !abrir;
  $('teclado').setAttribute('aria-pressed', String(abrir));
  if (abrir) $('texto').focus();
});
$('escribir').addEventListener('submit', (e) => {
  e.preventDefault();
  const texto = $('texto').value;
  $('texto').value = '';
  $('texto').blur(); // en el teléfono cierra el teclado para que se vea la orbe
  preguntar(texto);
});
$('recentrar').addEventListener('click', () => { colocarOrbe(); materializar(); });

// Si la persona cambia de app, la orbe deja de hablar y de escuchar.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden || estado === 'espera') return;
  turno++;
  if (reconocedor) { const r = reconocedor; reconocedor = null; r.abort(); }
  callar();
  ponerEstado('espera');
});

// Navegadores dentro de otras apps (Instagram, Facebook, TikTok…) suelen bloquear la cámara y el micrófono.
if (/Instagram|FBAN|FBAV|FB_IAB|Line\/|TikTok|musical_ly|Snapchat/i.test(navigator.userAgent)) {
  $('aviso-app').hidden = false;
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

function cuadro() {
  const t = reloj.getElapsedTime();

  // Cámara virtual: sigue al teléfono, o se inclina un poco con el puntero en computadora.
  if (usarGiro) {
    camara.quaternion.slerp(quaternionDelTelefono(objetivo), 0.35);
  } else {
    euler.set(-puntero.y * 0.12, -puntero.x * 0.16, 0, 'YXZ');
    camara.quaternion.slerp(objetivo.setFromEuler(euler), 0.06);
  }

  // Nivel de brillo: la voz manda. Callada, la orbe respira; escuchando, late más fuerte; pensando, gira.
  const voz = medirVoz(t);
  nivel += (voz - nivel) * (voz > nivel ? 0.5 : 0.09);
  const respiro = estado === 'escuchando' ? 0.32 + 0.12 * Math.sin(t * 5.5)
    : estado === 'pensando' ? 0.2 + 0.1 * Math.sin(t * 3.2)
    : 0.1 + 0.06 * Math.sin(t * 1.7);
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

  const vel = menosMovimiento ? 0.05 : 0.18 + nivel * 0.9 + (estado === 'pensando' ? 0.8 : 0);
  chispasA.rotation.y += 0.016 * vel;
  chispasB.rotation.y -= 0.011 * vel;
  chispasA.material.opacity = (0.35 + brillo * 0.6) * aparicion;
  chispasB.material.opacity = (0.25 + brillo * 0.5) * aparicion;

  // Una onda por cada golpe de voz (cuando el volumen sube de golpe) y, mientras escucha, una cada segundo.
  const golpe = voz > 0.6 && vozAnterior < 0.45;
  const sonar = estado === 'escuchando' && t - ultimaOnda > 1.1;
  if (!menosMovimiento && (golpe || sonar) && t - ultimaOnda > 0.5) lanzarOnda(t);
  vozAnterior = voz;
  for (const o of ondas) {
    if (o.userData.vida >= 1) { o.material.opacity = 0; continue; }
    o.userData.vida = Math.min(o.userData.vida + 0.016 / 1.1, 1);
    const v = o.userData.vida;
    o.quaternion.copy(camara.quaternion);
    o.scale.setScalar(1 + v * 2.2);
    o.material.opacity = 0.4 * (1 - v) * (1 - v);
  }

  if (fuente && frases.length) {
    const texto = subtituloEn(ctx.currentTime - inicioVoz);
    if ($('subtitulo').textContent !== texto) $('subtitulo').textContent = texto;
  }

  renderer.render(escena, camara);
  requestAnimationFrame(cuadro);
}
requestAnimationFrame(cuadro);
