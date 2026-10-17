import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const turno = readFileSync(new URL("../src/turno.html", import.meta.url), "utf8");
const panel = readFileSync(new URL("../src/panel/cliente/07-agenda.js", import.meta.url), "utf8");

test("Enterado pendiente de sincronización no se presenta como confirmado", () => {
  const evento = turno.slice(turno.indexOf("} else if (en) {"), turno.indexOf("} else if (rp) {"));
  assert.ok(evento.includes("if (r.enCola)"), "la respuesta offline debe comprobarse");
  assert.ok(evento.indexOf("if (r.enCola)") < evento.indexOf("a.leido = true"), "no anticipar Enterado");
  assert.match(evento, /Enterado pendiente: se confirmará cuando vuelva internet/);
});
test("La publicación pendiente indica por enviar y evita duplicados al pulsar", () => {
  assert.match(turno, /cola\(\)\.some\(x => x\.ruta === `avisos\/\$\{a\.id\}\/enterado`/);
  assert.match(turno, /!a\.leido && !pendiente/);
  assert.match(turno, /Enterado por enviar/);
});
test("La administración distingue Enterado de Leído en el mensaje de éxito", () => {
  assert.match(panel, /toast\("Enterado confirmado"\)/);
  assert.doesNotMatch(panel, /toast\("Marcado como leído"\)/);
});
