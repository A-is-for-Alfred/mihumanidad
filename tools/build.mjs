// Prepara dist/ con los archivos públicos del sitio, para Hostinger.
// Sin dependencias: el sitio es HTML, CSS y JS escritos a mano; el "build" solo copia.
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = fileURLToPath(new URL("..", import.meta.url));
const salida = join(raiz, "dist");

// Subpáginas que llegan ya construidas desde otro repositorio: se copian byte por byte, sin tocarlas,
// y el build falla si les falta algo o si la copia no quedó idéntica.
//   hablo-unam/ → Hablo UNAM, herramienta interna del CCOIA-UNAM (lenguaje-unam/app/tools/publicar-en-mihumanidad.mjs).
//   orbe/       → prueba de realidad aumentada con una orbe que habla (orbe-ra/publicar-en-mihumanidad.mjs).
const subpaginas = {
  "hablo-unam": ["index.html", "kb.json"],
  orbe: ["index.html", "orbe.js", "voz.mp3", "subtitulos.json", "three.module.min.js", "qrcode.min.js"],
};

// Lo que vive en el repositorio pero nunca se publica.
const excluir = new Set([
  "dist",
  "node_modules",
  "tools",
  "lab",
  "README.md",
  "package.json",
  "package-lock.json",
  "en-construccion.html",
]);
const excluirRutas = ["assets/src", "assets/img/avatar.png"];

const publico = (origen) => {
  const rel = relative(raiz, origen).split(sep).join("/");
  if (rel.split("/").some((parte) => parte.startsWith("."))) return false;
  return !excluirRutas.some((ruta) => rel === ruta || rel.startsWith(ruta + "/"));
};

rmSync(salida, { recursive: true, force: true });
mkdirSync(salida);

for (const nombre of readdirSync(raiz)) {
  if (nombre.startsWith(".") || excluir.has(nombre) || Object.hasOwn(subpaginas, nombre)) continue;
  cpSync(join(raiz, nombre), join(salida, nombre), { recursive: true, filter: publico });
}

const huella = (ruta) => createHash("sha256").update(readFileSync(ruta)).digest("hex");
for (const [carpeta, requeridos] of Object.entries(subpaginas)) {
  const origen = join(raiz, carpeta);
  const faltan = requeridos.filter((archivo) => !existsSync(join(origen, archivo)));
  if (faltan.length) {
    console.error(`✗ ${carpeta}/ no tiene: ${faltan.join(", ")}. No se publica el sitio.`);
    process.exit(1);
  }
  mkdirSync(join(salida, carpeta));
  for (const archivo of readdirSync(origen)) {
    const de = join(origen, archivo);
    if (archivo.startsWith(".") || !statSync(de).isFile()) continue;
    const a = join(salida, carpeta, archivo);
    copyFileSync(de, a);
    if (huella(de) !== huella(a)) {
      console.error(`✗ ${carpeta}/${archivo}: la copia en dist/ no quedó idéntica.`);
      process.exit(1);
    }
  }
}

// Hostinger guarda en caché los .js y .css por días: en las páginas que lo necesitan, cada referencia
// local a un .js o .css se sella con ?v=<huella> para que un cambio llegue en cuanto se publica.
//   entrevista/ → chat del entrevistador de IA (el servicio vive en el VPS, ver S:\Trabajo\Claude\entrevistas).
const sellar = ["entrevista/index.html"];
for (const pagina of sellar) {
  const ruta = join(salida, pagina);
  const dir = join(ruta, "..");
  const html = readFileSync(ruta, "utf8").replace(/(src|href)="([\w./-]+\.(?:js|css))"/g, (todo, attr, archivo) => {
    const local = join(dir, archivo);
    return existsSync(local) ? `${attr}="${archivo}?v=${huella(local).slice(0, 10)}"` : todo;
  });
  writeFileSync(ruta, html);
}

console.log("dist/ listo:", readdirSync(salida).join(", "));
