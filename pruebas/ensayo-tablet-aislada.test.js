import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { permitirRutaTabletEnsayo } from "../src/ensayo-tablet.js";

const fuente = p => readFileSync(new URL(p, import.meta.url), "utf8");

test("Tableta ficticia: solo se habilitan capturas y lecturas privadas", () => {
  for (const ruta of ["/turno", "/turno/sw.js", "/turno/api/personas",
    "/turno/api/estado", "/turno/api/foto/ejemplo"]) {
    assert.equal(permitirRutaTabletEnsayo(ruta, "GET"), true, ruta);
  }
  for (const accion of ["entrar", "salir", "inicio", "gastos", "extras", "corte",
    "gastos/abcd1234/eliminar", "extras/abcd1234/eliminar"]) {
    assert.equal(permitirRutaTabletEnsayo("/turno/api/" + accion, "POST"), true, accion);
  }
  for (const accion of ["push", "perfil", "avisos", "compras", "incidencias",
    "tareas", "avisos/12345678/comentar", "personas", "corte/eliminar"]) {
    assert.equal(permitirRutaTabletEnsayo("/turno/api/" + accion, "POST"), false, accion);
  }
  assert.equal(permitirRutaTabletEnsayo("/turno/api/corte", "DELETE"), false);
  assert.equal(permitirRutaTabletEnsayo("/panel/api/turno/personas/ENSAYO", "POST"), false);
  assert.equal(permitirRutaTabletEnsayo("/turno/archivo", "POST"), false);
});

test("Worker: ensayo exige doble bandera, sin abrir producción ni notificaciones", () => {
  const w=fuente("../src/worker.js");
  assert.match(w,/env\.ENSAYO_FINANZAS === "1" && env\.ENSAYO_TABLET === "1"/);
  assert.match(w,/esTurno && \(!tabletEnsayo \|\| !permitirRutaTabletEnsayo\(ruta, request\.method\)\)/);
  assert.match(w,/partes\[1\] === "personas" && partes\[2\] === "ENSAYO"/);
  assert.match(w,/TABLETA DE ENSAYO PRIVADO/);
  assert.match(w,/env\.ENSAYO_FINANZAS === "1"\) return;/);
  assert.match(w,/env\.INGRESOS_URL, env\.INGRESOS_TOKEN, env\.AVISO_URL, env\.AVISO_TOKEN/);
});

test("Tableta ensayo: Access y PIN obligatorios, solo persona ficticia", () => {
  const s=fuente("../src/turno.js");
  assert.match(s,/h\.verificarAcceso\(request, env, "turno"\)/);
  assert.match(s,/modoEnsayo && clave !== "ENSAYO"/);
  assert.match(s,/modoEnsayo && s\.persona !== "ENSAYO"/);
  assert.match(s,/AND clave = 'ENSAYO'/);
  assert.match(s,/if \(!p\.pin_hash\)/);
  assert.match(s,/!\(await pinCorrecto\(pin, p\.pin_sal, p\.pin_hash\)\)/);
  assert.match(s,/const cookie = \(valor, maxAge\).*HttpOnly; Secure; SameSite=Strict/);
});

test("Configuración: el PIN de ensayo solo se habilita en Worker aislado", () => {
  const cfg=fuente("../wrangler.finanzas-ensayo.jsonc");
  const prod=fuente("../wrangler.jsonc");
  assert.match(cfg,/"ENSAYO_FINANZAS": "1"/);
  assert.match(cfg,/"ENSAYO_TABLET": "1"/);
  assert.doesNotMatch(prod,/"ENSAYO_TABLET"/);
  assert.doesNotMatch(prod,/"ENSAYO_FINANZAS"/);
  assert.match(cfg,/"TURNO_EMAILS": ""/);
  assert.match(cfg,/"crons": \[\]/);
  assert.match(cfg,/"preview_urls": false/);
});
