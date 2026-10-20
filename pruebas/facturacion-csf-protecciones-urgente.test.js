// Seguridad y protección de datos en lectura CSF; NO ejecutado.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const worker = readFileSync(new URL("../src/worker.js", import.meta.url), "utf8");
const panel = readFileSync(new URL("../src/panel/cliente/01-facturacion.js", import.meta.url), "utf8");
const csf = readFileSync(new URL("../src/lectura-csf.js", import.meta.url), "utf8");

test("OCR solo desde rutas autenticadas de panel; límite de imagen y firma", () => {
  assert.match(worker, /request\.headers\.get\("X-Panel"\) !== "1"/);
  assert.match(worker, /partes\[2\] === "leer-csf-imagen"/);
  assert.match(worker, /7 \* 1024 \* 1024/);
  assert.match(worker, /tipo !== "image\/jpeg"/);
  assert.match(worker, /partes\.length === 3 && request\.method === "POST"/);
});
test("los datos sugeridos no se guardan automáticamente", () => {
  assert.doesNotMatch(panel, /await guardarDatos\(\$\("#guardar-datos"\), true\)/);
  assert.match(panel, /dataset\.deCsf = "1"/);
  assert.match(panel, /diferencias\+\+/);
  assert.match(panel, /La lectura difiere de/);
});
test("el modelo no publica datos personales ni admite regímenes desconocidos", () => {
  assert.match(csf, /normalizarCsfSugerido/);
  assert.match(csf, /Object\.hasOwn\(REGIMENES/);
  assert.match(csf, /No inventes números, nombres ni regímenes/);
  assert.doesNotMatch(csf, /console\.log\(/);
});
