import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { calcularCortes, unirConteos, conciliarGastosConRetiros, totalesMes } from "../src/caja.js";
import { retirosDeCortes } from "../src/finanzas.js";

// Cantidades ficticias: prueba de una distribución registrada dos veces.
const dia = "2026-10-16", turno = "NOCHE";
const g = (id, monto=100, concepto="Sueldo", creado="2026-10-17T11:52:00Z") =>
  ({id, dia, turno, mes:"2026-10", monto, concepto, forma:"EFECTIVO", creado, origen:"caja"});
const c = (retiros, actualizado="2026-10-17T12:07:00Z") =>
  ({dia, turno, mes:"2026-10", efectivo:115, con_cambio:1, sobre:0, cambio_sig:15,
    retiros:JSON.stringify(retiros), actualizado, persona:"EJEMPLO"});
const mov = {dia, turno, servicio:"bascula", importe:95, forma:"EFECTIVO", tipo:"ticket"};
const ini = {dia, turno, cambio:20, persona:"EJEMPLO"};

test("Un gasto repetido en el retiro se contabiliza una sola vez", () => {
  const corte = c([{concepto:"Sueldo",monto:100}]);
  const gasto = g("g-1");
  const {gastos,duplicados}=conciliarGastosConRetiros([gasto],[corte]);
  assert.deepEqual(gastos,[]);
  assert.deepEqual(duplicados,[gasto]);
  const calculado=unirConteos(calcularCortes([mov], gastos, [], [ini]),[corte])[0];
  assert.equal(calculado.efectivo,95);
  assert.equal(calculado.cambio.importe,20);
  assert.equal(calculado.efectivo_caja,115);
  assert.equal(calculado.conteo.efectivo,115);
  assert.equal(calculado.conteo.dif_efectivo,0);
  assert.equal(calculado.conteo.retiros[0].monto,100);
  assert.equal(totalesMes([calculado]).gastos,0);
  assert.equal(retirosDeCortes([corte]).reduce((sum,x)=>sum+x.monto,0),100);
});

test("Retiro y gasto con nombres diferentes siguen siendo pagos separados", () => {
  const d=conciliarGastosConRetiros([g("x")],[c([{concepto:"Taxi",monto:100}])]);
  assert.equal(d.gastos.length,1);assert.equal(d.duplicados.length,0);
});

test("Dos gastos de igual importe no se anulan por un solo retiro", () => {
  const d=conciliarGastosConRetiros([g("a"),g("b")],[c([{concepto:"Sueldo",monto:100}])]);
  assert.equal(d.gastos.length,1);
  assert.equal(d.duplicados.length,1);
});

test("Los gastos registrados después del corte no se vinculan retroactivamente", () => {
  const d=conciliarGastosConRetiros(
    [g("tarde",100,"Sueldo","2026-10-17T12:25:00Z")],
    [c([{concepto:"Sueldo",monto:100}])]
  );
  assert.equal(d.gastos.length,1);assert.equal(d.duplicados.length,0);
});

test("La conciliación no equipara formas distintas ni turnos distintos", () => {
  const gastoTarjeta={...g("tarjeta"),forma:"TARJETA"};
  const gastoOtroTurno={...g("otro"),turno:"TARDE"};
  const d=conciliarGastosConRetiros([gastoTarjeta,gastoOtroTurno],
    [c([{concepto:"Sueldo",monto:100}])]);
  assert.equal(d.gastos.length,2);assert.equal(d.duplicados.length,0);
});

test("Todas las pantallas y reportes principales reciben el gasto conciliado", () => {
  const src=readFileSync(new URL("../src/caja.js",import.meta.url),"utf8");
  const turno=readFileSync(new URL("../src/turno.js",import.meta.url),"utf8");
  const fin=readFileSync(new URL("../src/finanzas.js",import.meta.url),"utf8");
  const reporte=readFileSync(new URL("../src/reporte.js",import.meta.url),"utf8");
  const ui=readFileSync(new URL("../src/panel/cliente/03-caja.js",import.meta.url),"utf8");
  assert.match(src,/const \{ gastos, duplicados: gastosDuplicados \} = conciliarGastosConRetiros/);
  assert.match(src,/calcularCortes\(movs, conciliacion\.gastos, extras, inicios\)/);
  assert.match(turno,/conciliarGastosConRetiros\(gastos, conteos\)\.gastos/);
  assert.match(fin,/await leerMes\(env, \[mes\]\)/);
  assert.match(reporte,/await leerMes\(env, \[mes\]\)/);
  assert.match(ui,/Incluido en retiro · no suma dos veces/);
  assert.doesNotThrow(()=>new Function(ui));
});
