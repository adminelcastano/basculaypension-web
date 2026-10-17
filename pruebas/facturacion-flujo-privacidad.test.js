import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizarFolioTicket, claveTicket, mismaOperacion, faltantesParaFacturar } from "../src/facturacion-reglas.js";

const worker = readFileSync(new URL("../src/worker.js", import.meta.url), "utf8");
const panel = readFileSync(new URL("../src/panel/cliente/01-facturacion.js", import.meta.url), "utf8");
const publico = readFileSync(new URL("../public/factura/index.html", import.meta.url), "utf8");
const aviso = readFileSync(new URL("../public/aviso-de-privacidad/index.html", import.meta.url), "utf8");

test("Folio normalizado identifica una operación por servicio sin confundir báscula y pensión", () => {
  assert.equal(normalizarFolioTicket(" 17 - 097 "), "17097");
  assert.equal(claveTicket("bascula", "17-097"), "bascula:17097");
  assert.equal(mismaOperacion({ servicio: "bascula", folio_ticket: "17 097" }, { servicio: "bascula", folio_ticket: "17097" }), true);
  assert.equal(mismaOperacion({ servicio: "bascula", folio_ticket: "17097" }, { servicio: "pension", folio_ticket: "17097" }), false);
  assert.equal(mismaOperacion({ servicio: "bascula", folio_ticket: "" }, { servicio: "bascula", folio_ticket: "" }), false);
});

test("Exige datos completos antes de registrar factura emitida", () => {
  const c = { regimenes: { "612": "Actividad empresarial" }, usos: { G03: "Gastos generales" } };
  const correcto = { rfc: "RIGM800101ABC", nombre: "CLIENTE DE PRUEBA", cp: "30710", regimen: "612", uso: "G03", folio_ticket: "17097" };
  assert.deepEqual(faltantesParaFacturar(correcto, c), []);
  assert.ok(faltantesParaFacturar({ ...correcto, cp: "", folio_ticket: "" }, c).includes("folio del ticket verificado"));
  assert.ok(faltantesParaFacturar({ ...correcto, regimen: "" }, c).includes("régimen fiscal"));
});

test("Servidor bloquea duplicidad con clave única; permite advertencia sin bloquear por ausencia en ingresos", () => {
  assert.match(worker, /CREATE TABLE IF NOT EXISTS facturas_folios/);
  assert.match(worker, /PRIMARY KEY \(servicio, folio_normalizado\)/);
  assert.match(worker, /INSERT INTO facturas_folios/);
  assert.match(worker, /env\.DB\.batch\(\[/);
  assert.match(worker, /duplicado: true/);
  assert.match(worker, /contraste\.advertencia/);
  assert.match(worker, /puedes continuar después de aclararlo/);
  assert.match(worker, /estado='enviada'/);
});

test("Formulario ofrece contacto opcional y una vía de aclaración alternativa", () => {
  assert.match(publico, /form\.email\.value\.trim\(\) &&/);
  assert.match(publico, /if \(tel &&/);
  assert.match(publico, /contáctanos directamente para solicitar tu CFDI/);
  assert.match(publico, /hecho-entrega/);
  assert.match(publico, /\.drop:focus-within \.btn\[for\]/);
  const scripts = [...publico.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(x => x[1]);
  for (const js of scripts) assert.doesNotThrow(() => new Function(js));
});

test("Panel diferencia revisión, factura emitida y entrega confirmada", () => {
  assert.match(panel, /"enviada", "rechazada", "historico"/);
  assert.match(panel, /Confirmar envío al cliente/);
  assert.match(panel, /Iniciar revisión/);
  assert.match(panel, /ya_facturado/);
  assert.doesNotThrow(() => new Function(panel));
});

test("Aviso identifica a persona física y no afirma que se borren los respaldos en 90 días", () => {
  assert.match(aviso, /Oscar Manuel Rincon Gallardo Mendoza/);
  assert.match(aviso, /respaldo en Google Drive no se elimina automáticamente/);
  assert.match(aviso, /derechos ARCO/);
});
