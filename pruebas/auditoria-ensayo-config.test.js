import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const leer = path => readFileSync(new URL(path, import.meta.url), "utf8");
const ensayo = leer("../wrangler.auditoria-ensayo.jsonc");
const prod = leer("../wrangler.jsonc");
const financiero = leer("../wrangler.finanzas-ensayo.jsonc");
const worker = leer("../src/worker.js");
const push = leer("../src/push.js");

test("Ensayo adversarial: bases y Worker únicos; sin cron, IA ni rutas productivas", () => {
  assert.match(ensayo, /"ENSAYO_AUDITORIA": "1"/);
  assert.match(ensayo, /"name": "castano-auditoria-privada-20261019"/);
  assert.match(ensayo, /"database_name": "castano-auditoria-privada-d1-20261019"/);
  assert.match(ensayo, /"crons": \[\]/);
  assert.match(ensayo, /"preview_urls": false/);
  assert.doesNotMatch(ensayo, /"ai":\s*\{/);
  for (const forbidden of ["AVISO_URL", "INGRESOS_URL", "AVISO_TOKEN", "INGRESOS_TOKEN", "CF_API_TOKEN", "ENSAYO_FINANZAS"])
    assert.doesNotMatch(ensayo, new RegExp('"' + forbidden + '"'));
  assert.doesNotMatch(prod, /ENSAYO_AUDITORIA/);
  assert.doesNotMatch(financiero, /ENSAYO_AUDITORIA/);
  assert.doesNotMatch(ensayo, /castano-facturas|castano-finanzas-integral-ensayo|06093f14870a4df89ab81b0246dec74a/);
});

test("Ensayo adversarial: se rechazan servicios externos y las rutas públicas", () => {
  assert.match(worker, /env\.ENSAYO_AUDITORIA === "1"\) && \[/);
  assert.match(worker, /ruta\.startsWith\("\/api\/"\) \|\| ruta\.startsWith\("\/expediente\/"\)/);
  assert.match(worker, /!ruta\.startsWith\("\/panel\/api\/"\) && !ruta\.startsWith\("\/turno\/api\/"\)/);
  assert.match(worker, /if \(env\.ENSAYO_AUDITORIA === "1"\) return;/);
  assert.match(push, /env\.ENSAYO_AUDITORIA === "1"\) return 0/);
});

test("Ensayo adversarial: Access administrativo dedicado y cero bypass", () => {
  assert.match(ensayo, /"ACCESS_AUD": "[a-f0-9]{64}"/);
  assert.match(ensayo, /"TURNO_EMAILS": ""/);
  assert.match(ensayo, /"ADMIN_EMAILS": "administracion@basculaypension.com"/);
});
