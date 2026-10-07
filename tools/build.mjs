// Prepara dist/ con los archivos públicos del sitio, para Hostinger.
// Sin dependencias: el sitio es HTML, CSS y JS escritos a mano; el "build" solo copia.
import { cpSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = fileURLToPath(new URL("..", import.meta.url));
const salida = join(raiz, "dist");

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
  if (nombre.startsWith(".") || excluir.has(nombre)) continue;
  cpSync(join(raiz, nombre), join(salida, nombre), { recursive: true, filter: publico });
}

console.log("dist/ listo:", readdirSync(salida).join(", "));
