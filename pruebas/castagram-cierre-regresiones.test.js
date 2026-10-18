import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { errorDestinatariosCastagram, normalizarPara } from "../src/agenda.js";
import { idOperacionCastagram } from "../src/avisos.js";

const db = {
  prepare(sql) {
    assert.match(sql, /SELECT clave FROM turno_personas WHERE activo = 1/);
    return { bind(...claves) {
      return { async all() { return { results: claves.filter(x => x === "JESC" || x === "ERI").map(clave => ({ clave })) }; } };
    } };
  }
};
const env = { DB: db };
const p = personas => ({ todos: false, admin: false, turnos: [], personas });

test("Nueva audiencia no se convierte accidentalmente en todos", async () => {
  assert.match(await errorDestinatariosCastagram(env, null), /destinatario/i);
  assert.match(await errorDestinatariosCastagram(env, {}), /destinatario/i);
  assert.match(await errorDestinatariosCastagram(env, p([])), /destinatario/i);
  assert.match(await errorDestinatariosCastagram(env, p(["OTRA"])), /activos|existen/i);
  assert.match(await errorDestinatariosCastagram(env, p(["JESC", "OTRA"])), /activos|existen/i);
  assert.match(await errorDestinatariosCastagram(env, { ...p([]), turnos: ["NOEXISTE"] }), /turno/i);
  assert.match(await errorDestinatariosCastagram(env, { ...p([]), personas: ["JESC", "!"] }), /persona/i);
  assert.equal(await errorDestinatariosCastagram(env, p(["JESC", "ERI"])), null);
  assert.equal(await errorDestinatariosCastagram(env, JSON.stringify(p(["JESC"]))), null);
  assert.equal(await errorDestinatariosCastagram(env, { ...p([]), admin: true }), null);
  assert.equal(await errorDestinatariosCastagram(env, { ...p([]), todos: true }), null);
  assert.equal(await errorDestinatariosCastagram(env, { ...p([]), turnos: ["NOCHE"] }), null);
  // Los antiguos se pueden seguir leyendo con la normalización heredada.
  assert.equal(normalizarPara(null).todos, true);
});

test("El identificador de reintento debe ser válido y estable", async () => {
  assert.equal(await idOperacionCastagram("comentar", "uid-12345678", "JESC", "post"),
    await idOperacionCastagram("comentar", "uid-12345678", "JESC", "post"));
  await assert.rejects(idOperacionCastagram("comentar", "!", "JESC", "post"), /inválido/);
  await assert.rejects(idOperacionCastagram("publicar", "a".repeat(41), "JESC"), /inválido/);
  assert.match(await idOperacionCastagram("publicar", null, "JESC"), /^[0-9a-f-]{36}$/);
});

test("Cambiar PIN invalida las cargas anteriores y el fondo de diálogo respeta Atrás", () => {
  const tablet = readFileSync(new URL("../src/turno.html", import.meta.url), "utf8");
  const panel = readFileSync(new URL("../src/panel/cliente/07-agenda.js", import.meta.url), "utf8");
  const servidor = readFileSync(new URL("../src/turno.js", import.meta.url), "utf8");
  const agenda = readFileSync(new URL("../src/agenda.js", import.meta.url), "utf8");
  assert.match(tablet, /sesionGeneracion\+\+; \/\/ invalida cargas/);
  assert.match(tablet, /if \(generacion !== sesionGeneracion\) throw new Error/);
  assert.match(tablet, /if \(generacion !== sesionGeneracion \|\| !E\) return/);
  for (const src of [tablet, panel]) {
    assert.match(src, /if \(e.target === dlg\) castaHojaCerrar\(dlg\)/);
    assert.match(src, /history\.pushState\(\{\.\.\.history\.state,casta_layer:"comentarios"/);
  }
  assert.match(servidor, /errorDestinatariosCastagram\(env, c\.para\)/);
  assert.match(agenda, /errorDestinatariosCastagram\(env, c\.para\)/);
});
