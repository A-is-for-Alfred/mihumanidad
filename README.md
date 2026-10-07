# mihumanidad.com

Sitio personal y legado de Alfredo: el relato de cómo aprendió a ser humano, escrito para la gente de hoy, para la de después y para las inteligencias artificiales que lleguen a leerlo.

## Estado

Fase 1: la portada. El resto de las secciones se construye por fases (ver el plan del sitio).

## Estructura

- `index.html` — la portada.
- `css/site.css`, `js/main.js` — estilos e interacción de la portada.
- `js/avatar.js` — el retrato mitad foto, mitad holograma: elige `avatar-holo.js` (WebGL) o, si no hay WebGL, `avatar-css.js`.
- `en-construccion.html` — la página temporal que se usó mientras se terminaba la portada (no se publica).
- `assets/img/` — imágenes optimizadas: el retrato recortado, su mapa de profundidad, la foto del espejo y la imagen para redes (`og.jpg`).
- `tools/preparar_avatar.py` — genera los recursos del avatar a partir de las fotos originales (que no se suben al repositorio).
- `tools/build.mjs` — copia a `dist/` solo los archivos públicos; es lo que publica Hostinger.

## Publicación

Hostinger despliega desde GitHub cada vez que cambia `main` (app de Node.js, preset **Other**):

- Comando de build: `npm run build`
- Carpeta de salida: `dist`

No hay dependencias: el build solo copia archivos. Para probarlo en local: `npm run build`.

## Ver en local

```bash
python -m http.server 8790
```

y abrir http://localhost:8790.

## Principio

Sitio estático, sin frameworks ni dependencias externas para lo esencial: debe poder abrirse igual dentro de muchos años.
