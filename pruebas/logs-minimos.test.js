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

test("A-11B: log de mantenimiento no copia errores de Google", () => {
  const cron = worker.split("await mantenerArchivos(env).then(")[1]?.split(";")[0] || "";
  assert.ok(cron);
  assert.doesNotMatch(cron, /JSON\.stringify\(r\)/);
  assert.match(cron, /fallo: !!r\.error/);
  assert.match(cron, /tipoErrorSeguro\(e\)/);
  assert.doesNotMatch(worker, /limpieza: respaldo no confirmado, no se borra nada", e && e\.message/);
});

test("A-11B: push no registra respuestas externas ni excepciones con identificadores", () => {
  const push = readFileSync(new URL("../src/push.js", import.meta.url), "utf8");
  assert.doesNotMatch(push, /console\.error\("push", r\.status, \(await r\.text\(\)\)/);
  assert.doesNotMatch(push, /console\.error\("push", e && e\.message\)/);
  assert.match(push, /console\.error\("push", r\.status\)/);
  assert.match(push, /\["AbortError", "TimeoutError", "TypeError"\]\.includes\(e\?\.name\)/);
});
