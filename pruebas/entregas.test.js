// Entregas capturadas por la administración y renglones de caja de la hoja: node --test pruebas/*.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { numero, claseHoja, leerTablaEntregas, unirConteos, calcularCortes } from "../src/caja.js";
import { renglonesHoja } from "../src/finanzas.js";
import { flujosMes } from "../src/cuentas.js";

const caja = (dia, turno, folio, importe) => ({ tipo: "caja", servicio: "bascula", folio, cliente: "", matricula: "", fecha: dia + "T10:00:00", dia, turno, importe, forma: "EFECTIVO", mes: dia.slice(0, 7) });

test("importes de la hoja: MENOS y signos", () => {
  assert.equal(numero("MENOS 55"), -55);
  assert.equal(numero("menos 800"), -800);
  assert.equal(numero("-1,500"), -1500);
  assert.equal(numero("$ 200"), 200);
  assert.equal(numero("PRUEBA"), 0);
  assert.equal(numero(""), 0);
});

test("renglones de caja de la hoja: de la administración, gasto o cambio", () => {
  assert.equal(claseHoja(caja("2026-10-06", "MAÑANA", "SE LLEVO", -2300)), "a_admin");
  assert.equal(claseHoja(caja("2026-10-05", "TARDE", "RETIRO", -1000)), "a_admin");
  assert.equal(claseHoja(caja("2026-10-05", "TARDE", "INGRESO DE ADM", 200)), "de_admin");
  assert.equal(claseHoja(caja("2026-10-07", "MAÑANA", "SE AGREGA AL CAMBIO", 120)), "de_admin");
  assert.equal(claseHoja(caja("2026-10-03", "NOCHE", "SUELDO KOKI", -500)), "gasto");
  assert.equal(claseHoja(caja("2026-10-04", "NOCHE", "TIENDA", -55)), "gasto");
  assert.equal(claseHoja(caja("2026-10-06", "TARDE", "CAMBI0 TARDE", 444)), "cambio");
  const r = renglonesHoja([caja("2026-10-03", "NOCHE", "SUELDO KOKI", -500), caja("2026-10-06", "MAÑANA", "SE LLEVO", -2300), caja("2026-10-07", "MAÑANA", "SE AGREGA AL CAMBIO", 120)]);
  assert.deepEqual(r.gastos.map(g => [g.categoria, g.persona, g.monto]), [["Sueldos", "KOKI", 500]]);
  assert.deepEqual(r.admin.map(a => [a.clase, a.monto]), [["a_admin", 2300], ["de_admin", 120]]);
  // En los sobres: lo que se llevó entra, lo que se agregó a la caja sale
  const f = flujosMes({ hojaAdmin: r.admin }, []);
  assert.equal(f.sobres.entradas, 2300);
  assert.equal(f.sobres.salidas, 120);
});

test("tabla de entregas pegada: días, turnos, guiones y ceros", () => {
  const t = "Día\tTurno\tSobre\tTaxi\tSueldo\tCambio\n01/oct\tTarde\t$3,500\t$200\t—\t$130\n07/oct\tMañana\t—\t—\t—\t$239*\n03/oct\tNoche\t$0\t$0\t$500\t$130\nxx\tTarde\t1\t2\t3\t4\n02/oct\tTarde\tabc\t\t\t";
  const { filas, errores } = leerTablaEntregas(t, "2026");
  assert.deepEqual(filas.map(f => [f.dia, f.turno, f.sobre, f.taxi, f.sueldo, f.cambio]), [
    ["2026-10-01", "TARDE", 3500, 200, null, 130], ["2026-10-07", "MAÑANA", null, null, null, 239], ["2026-10-03", "NOCHE", 0, 0, 500, 130]]);
  assert.equal(errores.length, 2);
});

test("entrega de la administración: sin conteo ciego no hay diferencia ni faltante", () => {
  const cortes = calcularCortes([caja("2026-10-01", "TARDE", "CAMBIO TARDE", 170)], []);
  const [c] = unirConteos(cortes, [{ dia: "2026-10-01", turno: "TARDE", persona: "Administración", efectivo: 3830, admin: 1, sobre: 3500, cambio_sig: 130, retiros: '[{"concepto":"Taxi","monto":200}]' }]);
  assert.equal(c.conteo.admin, true);
  assert.equal(c.conteo.dif_efectivo, null);
  assert.deepEqual(c.conteo.retiros, [{ concepto: "Taxi", monto: 200 }]);
});
