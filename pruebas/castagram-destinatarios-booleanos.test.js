import test from "node:test";
import assert from "node:assert/strict";
import { errorDestinatariosCastagram, normalizarPara, avisoParaEncargado } from "../src/agenda.js";

const env = { DB: { prepare() { return {
  bind(...claves) { return { async all() {
    return { results: claves.filter(k => ["AUDITA", "AUDITB"].includes(k)).map(clave => ({ clave })) };
  }}; }
}; }}};

test("A-06: rechazar cadena false que se interpretaría como difusión general", async () => {
  const p = { todos: "false", admin: false, turnos: [], personas: ["AUDITA"] };
  assert.equal(normalizarPara(p).todos, true); // Compatibilidad de lecturas antiguas; NO admitir como nueva.
  assert.match(await errorDestinatariosCastagram(env, p), /verdaderos o falsos/);
  assert.match(await errorDestinatariosCastagram(env, JSON.stringify(p)), /verdaderos o falsos/);
});

test("A-06: rechazar admin textual, números y valores no booleanos", async () => {
  for (const valor of ["false", "true", 0, 1, [], {}]) {
    const p = { todos: false, admin: valor, turnos: [], personas: ["AUDITA"] };
    assert.match(await errorDestinatariosCastagram(env, p), /verdaderos o falsos/);
  }
});

test("A-06: audiencia booleana válida mantiene exclusividad individual", async () => {
  const p = { todos: false, admin: true, turnos: [], personas: ["AUDITA"] };
  assert.equal(await errorDestinatariosCastagram(env, p), null);
  const post = { autor: "admin", para: JSON.stringify(p) };
  assert.equal(avisoParaEncargado(post, "AUDITA", "MAÑANA"), true);
  assert.equal(avisoParaEncargado(post, "AUDITB", "MAÑANA"), false);
  assert.match(await errorDestinatariosCastagram(env, { ...p, personas: ["DESCONOCIDO"] }), /no existen/);
});

test("A-06: sin audiencia explícita se sigue rechazando", async () => {
  assert.match(await errorDestinatariosCastagram(env,
    { todos: false, admin: false, turnos: [], personas: [] }), /destinatario/);
});
