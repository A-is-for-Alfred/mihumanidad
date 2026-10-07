/*
  mihumanidad · index
  Sin dependencias. El retrato vive en ./avatar.js (contrato mountAvatar).
*/

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const FIRST_YEAR = 2026;

/* ---------------------------------------------------------------- */
/* Año del pie                                                       */
/* ---------------------------------------------------------------- */
{
  const y = new Date().getFullYear();
  const text = y > FIRST_YEAR ? `${FIRST_YEAR}–${y}` : String(FIRST_YEAR);
  $$('[data-year]').forEach((el) => { el.textContent = text; });
}

/* ---------------------------------------------------------------- */
/* Encabezado: fondo al desplazarse y menú compacto                  */
/* ---------------------------------------------------------------- */
const header = $('[data-header]');
const toggle = $('[data-nav-toggle]');
const nav = $('#nav-principal');

if (header) {
  let ticking = false;
  const sync = () => {
    ticking = false;
    header.classList.toggle('is-scrolled', window.scrollY > 8);
  };
  window.addEventListener('scroll', () => {
    if (!ticking) { ticking = true; requestAnimationFrame(sync); }
  }, { passive: true });
  sync();
}

if (header && toggle && nav) {
  const isOpen = () => toggle.getAttribute('aria-expanded') === 'true';
  const setOpen = (open) => {
    toggle.setAttribute('aria-expanded', String(open));
    header.classList.toggle('is-open', open);
  };
  toggle.addEventListener('click', () => {
    setOpen(!isOpen());
    if (isOpen()) nav.querySelector('a')?.focus({ preventScroll: true });
  });
  nav.addEventListener('click', (e) => { if (e.target.closest('a')) setOpen(false); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen()) { setOpen(false); toggle.focus(); }
  });
  document.addEventListener('pointerdown', (e) => {
    if (isOpen() && !header.contains(e.target)) setOpen(false);
  });
  nav.addEventListener('focusout', (e) => {
    if (isOpen() && e.relatedTarget && !header.contains(e.relatedTarget)) setOpen(false);
  });
  // En em, igual que el CSS: con la fuente del navegador agrandada, el menú compacto llega antes.
  const wide = matchMedia('(min-width: 68.75em)');
  const onWide = () => { if (wide.matches) setOpen(false); };
  wide.addEventListener ? wide.addEventListener('change', onWide) : wide.addListener(onWide);
}

/* Enlace activo según la sección visible */
if ('IntersectionObserver' in window && nav) {
  const links = new Map();
  $$('a[href^="#"]', nav).forEach((a) => {
    const target = document.getElementById(a.getAttribute('href').slice(1));
    if (target) links.set(target, a);
  });
  const inView = new Set();
  const spy = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) inView.add(e.target);
      else inView.delete(e.target);
    }
    // El primero en el orden del documento gana (dos tarjetas pueden compartir fila).
    let current = null;
    for (const target of links.keys()) {
      if (inView.has(target)) { current = target; break; }
    }
    links.forEach((a, target) => {
      if (target === current) a.setAttribute('aria-current', 'true');
      else a.removeAttribute('aria-current');
    });
  }, { rootMargin: '-45% 0px -50% 0px' });
  links.forEach((_, target) => spy.observe(target));
}

/* ---------------------------------------------------------------- */
/* Revelados suaves al hacer scroll                                  */
/* ---------------------------------------------------------------- */
{
  const items = $$('[data-reveal]');
  if (!reduceMotion.matches && 'IntersectionObserver' in window && items.length) {
    document.documentElement.classList.add('reveal-armed');
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.classList.add('is-in');
        io.unobserve(e.target);
      }
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    items.forEach((el) => io.observe(el));
  } else {
    items.forEach((el) => el.classList.add('is-in'));
  }
}

/* ---------------------------------------------------------------- */
/* Lectura de humanidad                                              */
/* ---------------------------------------------------------------- */
const readout = $('[data-readout]');
const valueEl = $('[data-humanity-value]');
const srEl = $('[data-humanity-text]');
const traceEl = $('[data-trace]');
const TRACE_N = 80;
const trace = [];
let latest = 0.65;
let pending = false;
let lastSr = -1;

function drawReadout() {
  pending = false;
  if (valueEl) valueEl.textContent = (latest * 100).toFixed(1);
  if (readout) readout.style.setProperty('--h', latest.toFixed(4));
  trace.push(latest);
  if (trace.length > TRACE_N) trace.shift();
  if (traceEl) {
    const step = 100 / (TRACE_N - 1);
    const off = TRACE_N - trace.length;
    let pts = '';
    for (let i = 0; i < trace.length; i++) {
      // 40 % → abajo, 90 % → arriba
      const y = 24 - Math.min(1, Math.max(0, (trace[i] - 0.4) / 0.5)) * 24;
      pts += `${((off + i) * step).toFixed(2)},${y.toFixed(2)} `;
    }
    traceEl.setAttribute('points', pts.trim());
  }
}

function onHumanity(frac) {
  if (!Number.isFinite(frac)) return;
  latest = Math.min(1, Math.max(0, frac));
  if (!pending) { pending = true; requestAnimationFrame(drawReadout); }
}

/* Texto para lectores de pantalla: se actualiza con calma, sin anunciarse. */
setInterval(() => {
  if (!srEl || document.hidden) return;
  const pct = Math.round(latest * 100);
  if (pct === lastSr) return;
  lastSr = pct;
  srEl.textContent = `Humanidad visible en el retrato: alrededor de ${pct} por ciento.`;
}, 4000);

/* ---------------------------------------------------------------- */
/* Coordenadas del puntero sobre el retrato (HUD)                    */
/* ---------------------------------------------------------------- */
const frame = $('[data-avatar-frame]');
const coordsEl = $('[data-coords]');
if (frame && coordsEl) {
  const EMPTY = 'X —.——— · Y —.———';
  let cx = 0, cy = 0, queued = false;
  const paint = () => {
    queued = false;
    const r = frame.getBoundingClientRect();
    const x = (cx - r.left) / r.width;
    const y = (cy - r.top) / r.height;
    coordsEl.textContent = (x >= 0 && x <= 1 && y >= 0 && y <= 1)
      ? `X ${x.toFixed(3)} · Y ${y.toFixed(3)}`
      : EMPTY;
  };
  const onPointer = (e) => {
    cx = e.clientX; cy = e.clientY;
    if (!queued) { queued = true; requestAnimationFrame(paint); }
  };
  window.addEventListener('pointermove', onPointer, { passive: true });
  window.addEventListener('pointerdown', onPointer, { passive: true });
  coordsEl.textContent = EMPTY;
}

/* ---------------------------------------------------------------- */
/* Retrato: humano en parte, holograma en construcción               */
/* ---------------------------------------------------------------- */
const avatarEl = $('[data-avatar]');
const motionToggle = $('[data-motion-toggle]');
const MOTION_KEY = 'mihumanidad:movimiento';
let avatar = null;
let mountGen = 0;
let paused = false;
try { paused = localStorage.getItem(MOTION_KEY) === 'pausado'; } catch (e) { /* sin almacenamiento */ }

function montar() {
  if (!avatarEl) return;
  const gen = ++mountGen;
  import('./avatar.js')
    .then(({ mountAvatar }) => {
      if (gen !== mountGen) return;
      avatar = mountAvatar(avatarEl, {
        src: 'assets/img/avatar.webp',
        depth: 'assets/img/avatar-depth.png',
        onHumanity,
        // El retrato estático se va solo cuando el módulo ya pintó su primer cuadro.
        onReady: () => { if (gen === mountGen) avatarEl.setAttribute('data-mounted', ''); }
      });
    })
    .catch((err) => {
      // Si el módulo falla, el retrato estático se queda en su lugar.
      console.warn('mihumanidad: el avatar interactivo no se pudo montar.', err);
    });
}

function desmontar() {
  mountGen++;
  avatar?.destroy();
  avatar = null;
  avatarEl?.removeAttribute('data-mounted');
  onHumanity(0.65);   // la lectura vuelve al valor del retrato fijo
}

/* Pausar el movimiento (WCAG 2.2.2): se queda el retrato fijo y se detienen los parpadeos. */
function setPaused(value) {
  paused = value;
  document.documentElement.classList.toggle('motion-paused', paused);
  if (motionToggle) {
    motionToggle.setAttribute('aria-pressed', String(paused));
    motionToggle.textContent = paused ? 'Reanudar movimiento' : 'Pausar movimiento';
  }
}

setPaused(paused);
if (motionToggle) {
  motionToggle.hidden = false;
  motionToggle.addEventListener('click', () => {
    setPaused(!paused);
    try { localStorage.setItem(MOTION_KEY, paused ? 'pausado' : 'activo'); } catch (e) { /* sin almacenamiento */ }
    if (paused) desmontar(); else montar();
  });
}
if (!paused) montar();
window.addEventListener('pagehide', (e) => { if (!e.persisted) avatar?.destroy(); });
