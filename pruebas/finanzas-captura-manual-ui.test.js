import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const leer = ruta => readFileSync(new URL(ruta, import.meta.url), "utf8");
test("DINERO usa captura manual y no expone lector PDF", () => {
  const panel = leer("../src/panel-app.js");
  const estados = leer("../src/panel/cliente/05b-estados.js");
  const paquete = JSON.parse(leer("../package.json"));
  assert.ok(!existsSync(new URL("../src/panel/cliente/05d-estados-pdf.js", import.meta.url)));
  for (const fuente of [panel, estados]) {
    assert.doesNotMatch(fuente, /pdfjs|f-est-pdf|extraerEstadoPDF|05d-estados-pdf|panel\\/vendor\\/pdfjs/i);
  }
  assert.equal(paquete.dependencies?.["pdfjs-dist"], undefined);
  assert.match(estados, /EC\\.post\\("finanzas\\/estados-cuenta"/);
  for (const nombre of ["saldo_inicial", "abonos", "cargos", "saldo_final", "fecha_corte", "pago_minimo", "pago_sin_intereses"])
    assert.ok(estados.includes(nombre), nombre);
});
test("Etiquetas manuales se adaptan a débito y crédito sin cambiar contratos", () => {
  const estados = leer("../src/panel/cliente/05b-estados.js");
  assert.match(estados, /Deuda al inicio/);
  assert.match(estados, /Deuda al corte/);
  assert.match(estados, /Depósitos y abonos/);
  assert.match(estados, /Retiros y cargos/);
  assert.match(estados, /\[data-estado-campo/);
  assert.match(estados, /actual=\{id:r\.id,version:r\.version\}/);
});
