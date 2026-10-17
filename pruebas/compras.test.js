// Pruebas de la memoria de compras y del ticket (sin base de datos): node --test pruebas/
import { test } from "node:test";
import assert from "node:assert/strict";
import { cuentasTicket, resumirMemoria, normCompra } from "../src/compras.js";

test("ticket: total escrito, precios opcionales", () => {
  assert.deepEqual(cuentasTicket(["a", "b"], "$1,250.50", {}), { total: 1250.5, precios: {} });
  assert.deepEqual(cuentasTicket(["a", "b"], "300", { a: "120" }), { total: 300, precios: { a: 120 } });
});
test("ticket: sin total se suman los precios; si falta alguno, error", () => {
  assert.deepEqual(cuentasTicket(["a", "b"], "", { a: "100", b: "50.5" }), { total: 150.5, precios: { a: 100, b: 50.5 } });
  assert.ok(cuentasTicket(["a", "b"], "", { a: "100" }).error);
  assert.ok(cuentasTicket(["a"], "abc", {}).error);
});
test("ticket: un solo artículo toma el total como su precio", () => {
  assert.deepEqual(cuentasTicket(["a"], "89", {}), { total: 89, precios: { a: 89 } });
});
test("memoria: veces, último lugar y último precio conocido", () => {
  const filas = [
    { norm: "toner", titulo: "Tóner", lugar: "office-depot", importe: null, fecha: "2026-10-10" },
    { norm: "toner", titulo: "Tóner", lugar: "office-depot", importe: 950, fecha: "2026-09-01", cantidad: "1" },
    { norm: "gas", titulo: "Gas", lugar: "gasera", importe: 1200, fecha: "2026-10-01" }
  ];
  const m = resumirMemoria(filas);
  assert.equal(m[0].norm, "toner"); assert.equal(m[0].veces, 2);
  assert.equal(m[0].ultimo.fecha, "2026-10-10"); assert.equal(m[0].precio.importe, 950);
  assert.equal(normCompra("  Tóner  Negro "), "toner negro");
});
