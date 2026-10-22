import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizarFolioTicket, folioTicketValido, claveTicket, mismaOperacion, faltantesParaFacturar } from "../src/facturacion-reglas.js";

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
  assert.equal(normalizarFolioTicket("0017097"), "0017097");
  assert.equal(folioTicketValido(" 001 - 7097 "), true);
  assert.equal(folioTicketValido(""), false);
  assert.equal(folioTicketValido("ABC"), false);
  assert.equal(folioTicketValido("0"), true);
});

test("Exige datos completos antes de registrar factura emitida", () => {
  const c = { regimenes: { "612": "Actividad empresarial" }, usos: { G03: "Gastos generales" } };
  const correcto = { rfc: "RIGM800101ABC", nombre: "CLIENTE DE PRUEBA", cp: "30710", regimen: "612", uso: "G03", folio_ticket: "17097" };
  assert.deepEqual(faltantesParaFacturar(correcto, c), []);
  assert.ok(faltantesParaFacturar({ ...correcto, cp: "", folio_ticket: "" }, c).includes("folio numérico del ticket verificado"));
  assert.ok(faltantesParaFacturar({ ...correcto, regimen: "" }, c).includes("régimen fiscal"));
});

test("Servidor bloquea duplicidad con clave única; permite advertencia sin bloquear por ausencia en ingresos", () => {
  assert.match(worker, /CREATE TABLE IF NOT EXISTS facturas_folios/);
  assert.match(worker, /PRIMARY KEY \(servicio, folio_normalizado\)/);
  assert.match(worker, /INSERT INTO facturas_folios/);
  assert.match(worker, /INSERT OR IGNORE INTO facturas_folios/); // respaldo del índice de facturas anteriores
  assert.match(worker, /env\.DB\.batch\(\[/);
  assert.match(worker, /duplicado: true/);
  assert.match(worker, /contraste\.advertencia/);
  assert.match(worker, /puedes continuar después de aclararlo/);
  assert.match(worker, /estado='enviada'/);
});

test("Facturación exige correo y conserva WhatsApp como contacto opcional", () => {
  assert.match(publico, /if \(!RE_EMAIL\.test\(form\.email\.value\.trim\(\)\)\)/);
  assert.match(publico, /name="email"[^>]*required/);
  assert.match(worker, /if \(!RE_EMAIL\.test\(email\)\)/);
  assert.match(panel, /id="d-email"/);
  assert.match(worker, /errores\.email = "Correo electrónico inválido/);
  assert.match(publico, /if \(tel &&/);
  assert.match(publico, /contáctanos directamente para solicitar tu CFDI/);
  assert.match(publico, /hecho-entrega/);
  assert.match(publico, /\.drop:focus-within \.btn\[for\]/);
  const scripts = [...publico.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(x => x[1]);
  for (const js of scripts) assert.doesNotThrow(() => new Function(js));
});

test("Panel diferencia revisión, factura emitida y entrega confirmada", () => {
  assert.match(panel, /"enviada", "rechazada", "cancelada", "historico"/);
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

test("No permite salir hacia Facturador con un folio corregido pero no guardado", () => {
  assert.match(panel, /id="abrir-facturador"/);
  assert.match(panel, /folioEnPantalla !== s\.folio_ticket/);
  assert.match(panel, /importeEnPantalla/);
  assert.match(panel, /e\.preventDefault\(\)/);
  assert.match(panel, /Primero guarda el folio completo y el importe del ticket/);
  assert.doesNotThrow(() => new Function(panel));
});

test("Los reportes conservan fecha de entrega y número de columnas coherente", () => {
  const reporte = readFileSync(new URL("../src/facturacion-reporte-filas.js", import.meta.url), "utf8");
  assert.match(worker,/filasFacturas: filasExcel/);
  const cab = reporte.match(/^export const ENCABEZADOS = \[[^\n]+\];/m);
  const filas = reporte.match(/function filasExcel\(results\) \{[\s\S]*?\n\}/);
  assert.ok(cab && filas);
  const fn = new Function("SERVICIOS", "REGIMENES", "USOS", "FORMAS_PAGO",
    cab[0].replace(/^export /, "") + "\n" + filas[0] + "\nreturn filasExcel;");
  const filasExcel = fn({ bascula: "Báscula" }, { "612": "Actividad" },
    { G03: "Gastos" }, { "01": "Efectivo" });
  const datos = filasExcel([{
    folio: "EC-PRUEBA", creado: "2026-10-17T13:00:00.000Z", estado: "enviada",
    servicio: "bascula", folio_ticket: "17097", nombre: "CLIENTE FICTICIO",
    regimen: "612", uso: "G03", resuelta_en: "2026-10-17T14:00:00.000Z",
    enviada_en: "2026-10-17T15:00:00.000Z", folio_factura: "CFDI-1"
  }]);
  assert.equal(filasExcel.length, 1);
  assert.equal(datos.length, 2);
  assert.equal(datos[0].length, datos[1].length);
  assert.equal(datos[1][datos[0].indexOf("Fecha entrega manual")], "2026-10-17 09:00");
  assert.equal(datos[1][datos[0].indexOf("Estado")], "Enviada al cliente");
});

test("El panel reduce conteos duplicados sin alterar respuesta de otros clientes", () => {
  assert.match(panel, /i > 0\) p\.set\("solo_lista", "1"\)/);
  assert.match(worker, /url\.searchParams\.get\("solo_lista"\) === "1"/);
  assert.match(worker, /soloLista \? null : await env\.DB\.prepare\(/);
});

test("Servidor y formulario validan folios numéricos; panel bloquea datos fiscales inválidos", () => {
  assert.match(worker, /folioTicketValido\(folioTicket\)/);
  assert.match(publico, /inputmode="numeric"/);
  assert.match(panel, /j\.regimenes\?\.\[s\.regimen\]/);
  assert.match(panel, /j\.usos\?\.\[s\.uso\]/);
  assert.match(panel, /j\.formas_pago\?\.\[s\.forma_pago\]/);
});
