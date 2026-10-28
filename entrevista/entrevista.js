// mihumanidad · entrevista
// Chat con el entrevistador de IA de Alfredo. El enlace personal trae un token en el fragmento (#...),
// que nunca viaja al servidor de la página: solo se manda, como cabecera, a la API de entrevistas. Al
// abrir, el token pasa a sessionStorage y se quita de la barra de direcciones y del historial.

const API = (() => {
  const local = ['localhost', '127.0.0.1'].includes(location.hostname);
  const propia = new URLSearchParams(location.search).get('api');
  return local && propia ? propia.replace(/\/$/, '') : 'https://entrevistas.srv1091049.hstgr.cloud';
})();
const CLAVE = 'mihumanidad-entrevista-token';
const MAX_AUDIO_S = 240;

const $ = (id) => document.getElementById(id);
const app = $('app');
const lista = $('mensajes');
const texto = $('texto');
const estado = $('estado');

let token = '';
let vista = null;
let pintados = 0;
let ocupado = false;

// ---------- Token ----------
function leerToken() {
  let delFragmento = '';
  try { delFragmento = decodeURIComponent(location.hash.replace(/^#/, '').replace(/^t=/, '')).trim(); } catch {}
  if (/^[A-Za-z0-9_-]{40,64}$/.test(delFragmento)) {
    try { sessionStorage.setItem(CLAVE, delFragmento); } catch {}
    try { history.replaceState(null, '', location.pathname + location.search); } catch {}
    return delFragmento;
  }
  try { return sessionStorage.getItem(CLAVE) ?? ''; } catch { return ''; }
}

const nuevoId = () => (crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`);

// ---------- API ----------
async function api(metodo, ruta, cuerpo, tipo = 'application/json') {
  let r;
  try {
    r = await fetch(API + ruta, {
      method: metodo,
      headers: { Authorization: `Bearer ${token}`, ...(cuerpo ? { 'Content-Type': tipo } : {}) },
      body: cuerpo ? (tipo === 'application/json' ? JSON.stringify(cuerpo) : cuerpo) : undefined,
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    });
  } catch {
    throw new Error('No hay conexión con el entrevistador. Revisa tu internet e intenta de nuevo.');
  }
  const datos = await r.json().catch(() => ({}));
  if (!r.ok) {
    const error = new Error(datos.error || 'Algo falló. Intenta de nuevo en un momento.');
    error.codigo = r.status;
    throw error;
  }
  return datos;
}

// ---------- Pintar ----------
function pantalla(nombre) { app.dataset.pantalla = nombre; }

function burbuja(t, { pendiente = false } = {}) {
  const li = document.createElement('li');
  li.className = `mensaje ${t.rol === 'persona' ? 'persona' : 'entrevistador'}${pendiente ? ' pendiente' : ''}`;
  const quien = document.createElement('span');
  quien.className = 'quien mono';
  quien.textContent = t.rol === 'persona'
    ? `${vista?.nombre || 'Tú'}${String(t.via ?? '').startsWith('audio') ? ' · nota de voz' : ''}`
    : 'Asistente de Alfredo · IA';
  const cuerpo = document.createElement('div');
  cuerpo.className = 'cuerpo';
  cuerpo.textContent = t.texto;
  li.append(quien, cuerpo);
  return li;
}

function bajar() {
  requestAnimationFrame(() => lista.lastElementChild?.scrollIntoView({ block: 'end', behavior: 'smooth' }));
}

function pintar(v) {
  vista = v;
  const palabra = v.palabra === 'plática' ? 'plática' : 'entrevista';
  $('titulo').textContent = v.titulo;
  document.title = `${v.titulo} · mihumanidad`;
  $('marca-texto').textContent = `mihumanidad · ${palabra}`;
  $('confirmar-texto').textContent = `¿Quieres terminar la ${palabra}? Después ya no podrás seguir escribiendo. Para pausar, mejor solo cierra la página.`;
  $('final-texto').textContent = `La ${palabra} terminó. ¡Gracias!`;
  lista.querySelectorAll('.pendiente').forEach((n) => n.remove());

  if (v.estado === 'aviso') {
    pantalla('aviso');
    if (v.aviso) { $('aviso-propio').textContent = v.aviso; $('aviso-propio').hidden = false; }
    $('aviso-duracion').textContent = v.duracion_estimada_min ? `Duración aproximada: ${v.duracion_estimada_min} minutos de chat.` : '';
    return;
  }

  pantalla('chat');
  if (v.turnos.length < pintados) { lista.replaceChildren(); pintados = 0; }
  for (const t of v.turnos.slice(pintados)) lista.append(burbuja(t));
  pintados = v.turnos.length;

  const opciones = $('opciones');
  opciones.replaceChildren(...(v.opciones ?? []).map((o) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'opcion';
    b.textContent = o;
    b.addEventListener('click', () => enviar(o, 'texto'));
    return b;
  }));

  const enCurso = v.estado === 'en_curso';
  $('pie').hidden = !enCurso;
  $('terminar').hidden = !enCurso;
  $('final').hidden = enCurso;
  if (!enCurso) app.append($('final'));
  bajar();
}

function avisar(mensaje, { error = false } = {}) {
  estado.textContent = mensaje || '';
  estado.classList.toggle('error', error);
}

function bloquear(si, mensaje = '') {
  ocupado = si;
  for (const id of ['enviar', 'microfono', 'texto']) $(id).disabled = si;
  $('opciones').querySelectorAll('button').forEach((b) => { b.disabled = si; });
  avisar(mensaje);
}

// ---------- Acciones ----------
async function cargar() {
  pantalla('cargando');
  token = leerToken();
  if (!token) {
    $('error-texto').textContent = 'Este enlace está incompleto. Ábrelo tal como te lo mandaron (incluye todo lo que va después del #).';
    pantalla('error');
    return;
  }
  try {
    pintar(await api('GET', '/api/sesion'));
  } catch (e) {
    $('error-texto').textContent = e.codigo === 401 ? 'Este enlace no es válido o ya no está activo. Pídele a Alfredo uno nuevo.' : e.message;
    pantalla('error');
  }
}

async function enviar(contenido, via, idAudio = null) {
  const t = String(contenido ?? '').trim();
  if (!t || ocupado) return;
  if (vista && t.length > vista.max_caracteres) {
    if (via === 'audio') { texto.value = t; ajustar(); }
    avisar(via === 'audio'
      ? `Tu nota quedó muy larga para un solo mensaje (${t.length} de ${vista.max_caracteres} caracteres). La dejé en la caja: recórtala o divídela y envíala.`
      : `Tu mensaje es muy largo (${t.length} de ${vista.max_caracteres} caracteres). Puedes dividirlo en varios.`, { error: true });
    return;
  }
  if (via === 'texto' && t === texto.value.trim()) { texto.value = ''; ajustar(); }
  $('opciones').replaceChildren();
  lista.append(burbuja({ rol: 'persona', texto: t, via }, { pendiente: true }));
  bajar();
  bloquear(true, 'El asistente está escribiendo…');
  const idCliente = nuevoId();
  try {
    pintar(await api('POST', '/api/mensaje', { texto: t, via, id_audio: idAudio, id_cliente: idCliente }));
    bloquear(false);
  } catch (e) {
    lista.querySelectorAll('.pendiente').forEach((n) => n.remove());
    bloquear(false);
    if (!e.codigo) {
      // Se cortó la conexión: el servidor pudo haber guardado el turno. Antes de reenviar, se sincroniza.
      try {
        const v = await api('GET', '/api/sesion');
        const ultimaPersona = [...v.turnos].reverse().find((x) => x.rol === 'persona');
        pintar(v);
        if (ultimaPersona?.texto === t) { avisar(''); return; }
      } catch {}
    }
    if (via === 'texto' || !texto.value.trim()) { texto.value = t; ajustar(); }
    avisar(e.message, { error: true });
    if (e.codigo === 409 || e.codigo === 401) cargar();
  }
  if (!$('pie').hidden && !matchMedia('(pointer: coarse)').matches) texto.focus();
}

function ajustar() {
  texto.style.height = 'auto';
  texto.style.height = Math.min(texto.scrollHeight, innerHeight * 0.38) + 'px';
}

// ---------- Notas de voz ----------
let grabadora = null;
let trozos = [];
let reloj = null;
let inicio = 0;
let descartar = false;

const tipoAudio = () => ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/ogg']
  .find((t) => window.MediaRecorder?.isTypeSupported?.(t)) ?? '';

async function grabar() {
  if (ocupado || grabadora) return;
  let flujo;
  try {
    flujo = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  } catch {
    avisar('No pude usar el micrófono. Revisa el permiso del navegador o escribe tu respuesta.', { error: true });
    return;
  }
  const tipo = tipoAudio();
  grabadora = new MediaRecorder(flujo, tipo ? { mimeType: tipo, audioBitsPerSecond: 32000 } : undefined);
  trozos = [];
  descartar = false;
  grabadora.addEventListener('dataavailable', (e) => { if (e.data.size) trozos.push(e.data); });
  grabadora.addEventListener('stop', () => {
    flujo.getTracks().forEach((p) => p.stop());
    clearInterval(reloj);
    const blob = new Blob(trozos, { type: grabadora.mimeType || tipo || 'audio/webm' });
    grabadora = null;
    $('grabando').hidden = true;
    $('redactor').hidden = false;
    if (!descartar) mandarAudio(blob);
  });
  grabadora.start(1000);
  inicio = Date.now();
  $('cronometro').textContent = '0:00';
  reloj = setInterval(() => {
    const s = Math.floor((Date.now() - inicio) / 1000);
    $('cronometro').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    if (s >= MAX_AUDIO_S) grabadora?.stop();
  }, 250);
  $('redactor').hidden = true;
  $('grabando').hidden = false;
  avisar(`Graba hasta ${MAX_AUDIO_S / 60} minutos por nota.`);
}

async function mandarAudio(blob) {
  if (blob.size < 1500) { avisar('La nota quedó vacía. ¿La grabas de nuevo?', { error: true }); return; }
  bloquear(true, 'Convirtiendo tu audio en texto…');
  try {
    const { texto: transcrito, id_audio: idAudio } = await api('POST', '/api/transcribir', blob, blob.type.split(';')[0] || 'audio/webm');
    bloquear(false);
    await enviar(transcrito, 'audio', idAudio);
  } catch (e) {
    bloquear(false);
    avisar(e.message, { error: true });
  }
}

// ---------- Eventos ----------
$('reintentar').addEventListener('click', cargar);
$('aceptar').addEventListener('click', async () => {
  $('aceptar').disabled = true;
  try { pintar(await api('POST', '/api/aceptar')); } catch (e) { $('error-texto').textContent = e.message; pantalla('error'); }
  $('aceptar').disabled = false;
  if (!matchMedia('(pointer: coarse)').matches) texto.focus();
});
$('enviar').addEventListener('click', () => enviar(texto.value, 'texto'));
texto.addEventListener('input', () => {
  ajustar();
  const max = vista?.max_caracteres ?? 4000;
  if (texto.value.length > max * 0.85) avisar(`${texto.value.length} / ${max} caracteres`, { error: texto.value.length > max });
  else if (estado.textContent.includes('caracteres')) avisar('');
});
texto.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !matchMedia('(pointer: coarse)').matches) {
    e.preventDefault();
    enviar(texto.value, 'texto');
  }
});
$('microfono').addEventListener('click', grabar);
$('enviar-audio').addEventListener('click', () => { descartar = false; grabadora?.stop(); });
$('cancelar-audio').addEventListener('click', () => { descartar = true; grabadora?.stop(); avisar(''); });
if (!window.MediaRecorder || !navigator.mediaDevices?.getUserMedia) $('microfono').hidden = true;

const dialogo = $('confirmar');
$('terminar').addEventListener('click', () => dialogo.showModal());
$('confirmar-no').addEventListener('click', () => dialogo.close());
$('confirmar-si').addEventListener('click', async () => {
  dialogo.close();
  bloquear(true, 'Terminando…');
  try { pintar(await api('POST', '/api/terminar')); bloquear(false); } catch (e) { bloquear(false); avisar(e.message, { error: true }); }
});

addEventListener('hashchange', cargar);
cargar();
