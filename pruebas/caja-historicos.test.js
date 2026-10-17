import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  leerTablaHistoricos, evaluarHistorico, esTurnoHistorico
} from "../src/caja-historicos.js";

test("Los 40 turnos históricos terminan en 14/oct mañana", () => {
  let total = 0;
  for (let d = 1; d <= 13; d++) for (const turno of ["MAÑANA", "TARDE", "NOCHE"]) {
    assert.equal(esTurnoHistorico("2026-10-" + String(d).padStart(2,"0"), turno), true);
    total++;
  }
  assert.ok(esTurnoHistorico("2026-10-14", "MAÑANA"));
  total++;
  assert.equal(total, 40);
  assert.equal(esTurnoHistorico("2026-10-14", "TARDE"), false);
  assert.equal(esTurnoHistorico("2026-10-15", "MAÑANA"), false);
});

test("Guion significa desconocido y cero significa valor conocido", () => {
  const a = leerTablaHistoricos("01-oct\tMañana\t—\t—\t—\t—");
  const b = leerTablaHistoricos("01-oct\tTarde\t0\t0\t0\t0");
  assert.equal(a.filas.length,1);
  assert.equal(a.filas[0].estado, "sin_datos");
  assert.equal(a.filas[0].sobre, null);
  assert.equal(b.filas[0].estado, "por_verificar");
  assert.equal(b.filas[0].sobre, 0);
  assert.equal(b.filas[0].reparto, 0);
});

test("Un reparto completo sólo cuadra con total contado independiente", () => {
  const t = "03-oct\tNoche\t0\t0\t500\t130";
  const pendiente = leerTablaHistoricos(t).filas[0];
  assert.equal(pendiente.estado, "por_verificar");
  const exacto = leerTablaHistoricos(t + "\t630").filas[0];
  assert.equal(exacto.estado, "cuadra");
  assert.equal(exacto.diferencia, 0);
  const diferencia = leerTablaHistoricos(t + "\t600").filas[0];
  assert.equal(diferencia.estado, "no_cuadra");
  assert.equal(diferencia.diferencia, 30);
});

test("No inventa ceros donde faltan sueldo o retiro", () => {
  const r = leerTablaHistoricos("01-oct\tTarde\t3500\t200\t—\t130\t3830");
  assert.equal(r.filas[0].estado, "incompleto");
  assert.equal(r.filas[0].sueldo, null);
});

test("Asterisco significa dato por verificar y no cifra confirmada", () => {
  const x = leerTablaHistoricos("07-oct\tMañana\t0\t0\t0\t239*\t239");
  assert.equal(x.filas[0].estado, "por_verificar");
  assert.equal(x.filas[0].dudoso, true);
});

test("No admite turnos duplicados, fechas ajenas ni importes malformados", () => {
  const r = leerTablaHistoricos(
    "01-oct\tMañana\t0\t0\t0\t0\n" +
    "01-oct\tMañana\t0\t0\t0\t0\n" +
    "14-oct\tTarde\t0\t0\t0\t0\n" +
    "05-oct\tNoche\tSI\t0\t0\t0"
  );
  assert.equal(r.filas.length, 1);
  assert.equal(r.errores.length, 3);
});

test("No se escribe en las tablas que alimentan Caja y Dinero", () => {
  const src = readFileSync(new URL("../src/caja-historicos.js", import.meta.url), "utf8");
  for (const t of ["caja_mov", "turno_cortes", "caja_gastos", "fin_saldos", "caja_extra"]) {
    assert.doesNotMatch(src, new RegExp("(INSERT INTO|UPDATE|DELETE FROM)\\s+" + t + "\\b", "i"));
  }
  assert.match(src, /INSERT INTO caja_cortes_historicos_hist/);
  const ui = readFileSync(new URL("../src/panel/cliente/03-caja.js", import.meta.url), "utf8");
  assert.doesNotThrow(() => new Function(ui));
  assert.match(ui, /caja\/historicos/);
  assert.match(ui, /Revisar sin guardar/);
});
