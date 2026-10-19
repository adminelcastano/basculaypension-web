import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const worker = readFileSync(new URL("../src/worker.js", import.meta.url), "utf8");
const archivos = readFileSync(new URL("../src/fotos.js", import.meta.url), "utf8");

test("A-11B: no enviar folios ni datos extraídos de IA al registro", () => {
  assert.doesNotMatch(worker, /console\.log\("aviso enviado",\s*d\.folio/);
  assert.match(worker, /console\.log\("aviso enviado"\);/);
  const registro = worker.split("console.log(\"revision ticket\",")[1]?.split(";")[0] || "";
  assert.ok(registro);
  assert.doesNotMatch(registro, /folio|datos\.|texto|response/);
  assert.match(registro, /clasificado: !!clase/);
  assert.match(worker, /ticket sin json: respuesta IA sin formato esperado/);
});

test("A-11B: mensajes externos y stack no se copian a logs de solicitudes", () => {
  assert.match(worker, /const tipoErrorSeguro = e =>/);
  assert.doesNotMatch(worker, /console\.error\("error",\s*err\s*&&\s*err\.stack/);
  assert.doesNotMatch(worker, /console\.error\("aviso",\s*e\)/);
  assert.match(worker, /console\.error\("aviso", tipoErrorSeguro\(e\)\)/);
  assert.match(worker, /console\.error\("clasificar", tipoErrorSeguro\(e\)\)/);
  assert.match(worker, /console\.error\("leer", tipoErrorSeguro\(e\)\)/);
});

test("A-11B: los fallos de Drive no imprimen claves de archivos", () => {
  assert.match(archivos, /console\.error\("archivos: Drive no disponible, se guarda en KV"\)/);
  assert.match(archivos, /console\.error\("archivos: no se pudo leer de Drive"\)/);
  assert.doesNotMatch(archivos, /console\.error\("archivos: Drive no disponible, se guarda en KV", llave/);
  assert.doesNotMatch(archivos, /console\.error\("archivos: no se pudo leer de Drive", llave/);
});
