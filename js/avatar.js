/*
  mihumanidad · Avatar — punto de entrada (contrato mountAvatar).

  Con WebGL: el escaneo topográfico (avatar-holo.js): foto real, curvas de nivel,
  malla de alambre y una frontera de construcción que se mueve.
  Sin WebGL: el respaldo hecho solo con CSS (avatar-css.js), con el mismo contrato.
*/
import { mountAvatar as montarHolograma } from './avatar-holo.js';
import { mountAvatar as montarCSS } from './avatar-css.js';

const hayWebGL = (() => {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    if (gl) gl.getExtension('WEBGL_lose_context')?.loseContext();
    return !!gl;
  } catch (e) {
    return false;
  }
})();

export function mountAvatar(el, opts = {}) {
  return (hayWebGL ? montarHolograma : montarCSS)(el, opts);
}
