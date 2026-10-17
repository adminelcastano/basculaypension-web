import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const ui = readFileSync(new URL("../src/turno.html", import.meta.url), "utf8");
const server = readFileSync(new URL("../src/turno.js", import.meta.url), "utf8");

// El script de la tablet sigue siendo una aplicación autónoma sin cambiar framework.
const scripts = [...ui.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m => m[1]);

test("Corte tablet: el script sigue siendo JavaScript válido", () => {
  assert.ok(scripts.length >= 1);
  for (const script of scripts) if (script.trim()) assert.doesNotThrow(() => new Function(script));
});

test("Corte tablet: guía diferencia conteo, distribución y entrega", () => {
  for (const texto of [
    "Cuenta el efectivo", "Distribuye lo que contaste", "Revisa y entrega",
    "después de los gastos que ya pagaste durante el turno",
    "antes de separar los retiros del cierre",
    "Sobre: dinero que recibirá la administración",
    "Retiros hechos al repartir el corte",
    "No vuelvas a incluir gastos que ya pagaste y registraste durante el turno",
    "Cambio que quedará físicamente en caja para el siguiente turno"
  ]) assert.ok(ui.includes(texto), texto);
});

test("Corte tablet: el validador no sustituye campos vacíos o inválidos por cero", () => {
  const m = ui.match(/const importe = v => \{([\s\S]*?)\n    \};/);
  assert.ok(m, "No se halló el validador del formulario");
  const importe = new Function("v", m[1]);
  assert.equal(importe(""), null);
  assert.equal(importe("  "), null);
  assert.ok(Number.isNaN(importe("texto")));
  assert.ok(Number.isNaN(importe("-12")));
  assert.ok(Number.isNaN(importe("1.234")));
  assert.ok(Number.isNaN(importe("1e2")));
  assert.equal(importe("0"), 0);
  assert.equal(importe("150"), 150);
  assert.equal(importe("$1,150.00"), 1150);
  assert.equal(importe("1,000"), 1000);
});

test("Corte tablet: sobre y cambio deben ser escritos explícitamente, incluso si son cero", () => {
  assert.match(ui, /sobre === null \|\| cambio === null/);
  assert.match(ui, /Escribe 0 cuando no corresponda/);
  assert.match(ui, /c && c\.sobre != null \? esc\(c\.sobre\)/);
  assert.match(ui, /c && c\.cambio_sig != null \? esc\(c\.cambio_sig\)/);
  assert.match(ui, /revisado-corte/);
  assert.match(ui, /Revisé los movimientos anteriores al conteo/);
});

test("Corte tablet: cuando coincide un gasto y un retiro se pide aclaración", () => {
  assert.match(ui, /E\.gastos\.some\(g =>/);
  assert.match(ui, /Posible pago repetido/);
  assert.match(ui, /Confirmo que son pagos distintos/);
  assert.match(ui, /const c = \$\("#dup-confirmo"\); if \(c\) c\.checked = false/);
  assert.match(ui, /if \(!Number\.isFinite\(dif\)\)/);
});

test("Corte tablet: confirmar entrega muestra el sobre y conserva cola y borradores por identidad", () => {
  assert.match(ui, /Sobre: \$\{dinero\(num\(f\.sobre\.value\)\)\}/);
  assert.match(ui, /turno:borrador:\$\{E\.persona\}:\$\{E\.dia\}:\$\{E\.turno\}/);
  assert.match(ui, /guardarLS\(llaveB, null\)/);
  assert.match(ui, /r\.enCola/);
});

test("Corte tablet: campos de retiro se adaptan a teléfono cerrado", () => {
  assert.match(ui, /@media \(max-width: 460px\)/);
  assert.match(ui, /\.retiro \[data-r="concepto"\] \{ grid-column: 1 \/ -1/);
  assert.match(ui, /\.retiro \.x \{ grid-column: 2; grid-row: 2; width: 44px; height: 44px/);
});

test("Servidor: no trunca retiros ni confunde reparto con pago del turno", () => {
  assert.match(server, /const sinRecortar = Array\.isArray\(c\.retiros\)/);
  assert.match(server, /sinRecortar\.length > 20/);
  assert.match(server, /const repartido = sobre \+ cambioSig \+ retiros\.reduce/);
  assert.match(server, /difRep/);
  assert.match(server, /INSERT INTO turno_cortes_hist/);
});

test("Corte tablet: modificar o quitar un retiro exige revisión nueva y actualiza borrador", () => {
  assert.match(ui, /if \(e\.target\.closest\("\.retiro"\)\)/);
  assert.match(ui, /e\.target\.id !== "revisado-corte"/);
  assert.match(ui, /q\.closest\("\.retiro"\)\.remove\(\)/);
  assert.match(ui, /\$\("#revisado-corte"\)\.checked = false/);
  assert.match(ui, /const llaveB = `turno:borrador/);
  assert.match(ui, /máximo es 20 retiros/);
});
