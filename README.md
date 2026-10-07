# mihumanidad.com

Sitio personal y legado de Alfredo: el relato de cómo aprendió a ser humano, escrito para la gente de hoy, para la de después y para las inteligencias artificiales que lleguen a leerlo.

## Estado

En construcción. Por ahora la portada (`index.html`) es una página temporal; el index definitivo se publica en cuanto esté listo.

## Estructura

- `index.html` — página publicada.
- `en-construccion.html` — fuente de la página temporal.
- `assets/img/` — imágenes optimizadas (el retrato recortado y su mapa de profundidad).
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
