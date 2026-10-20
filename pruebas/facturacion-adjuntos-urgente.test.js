// Ensayos sintéticos de carga del cliente, NO ejecutados en esta fase.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const web = readFileSync(new URL("../public/factura/index.html", import.meta.url), "utf8");
const server = readFileSync(new URL("../src/worker.js", import.meta.url), "utf8");
test("no rechaza fotografías por nitidez ni repite clasificación antes de enviarlas",()=>{
  assert.doesNotMatch(web,/rechazarFoto\(/);
  assert.doesNotMatch(web,/FotoTicket\.analizar/);
  assert.match(web,/archivos\[clave\] = listo/);
});
test("selección previa permanece tras errores de red o servidor",()=>{
  assert.match(web,/Un fallo del servidor no obliga a tomar otra foto/);
  assert.match(web,/preparando\.ticket \|\| preparando\.csf/);
});
test("verifica firmas reales antes de aceptar JPG, PNG, WebP, HEIC o PDF",()=>{
  assert.match(server,/async function tipoArchivo\(/);
  assert.match(server,/ascii\(4, 8\) === "ftyp"/);
  assert.match(server,/%PDF-/);
  assert.match(server,/validarArchivo\(ticket, tipoTicket/);
});
test("IA produce avisos, nunca rechaza automáticamente",()=>{
  assert.match(server,/Un modelo puede equivocarse/);
  assert.doesNotMatch(server,/texto\(form, "forzar_ticket"\) !== "1"/);
});
