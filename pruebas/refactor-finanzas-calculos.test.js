import test from "node:test";
import assert from "node:assert/strict";
import {diferenciasCaja,resumenSueldos,r2,CAT_SUELDOS} from "../src/finanzas-calculos.js";
import {diferenciasCaja as viaFinanzas,resumenSueldos as sueldosPublicos,CAT_SUELDOS as nombrePublico} from "../src/finanzas.js";
test("Corte con centavos, sobrante, faltante y cambio conserva contrato",()=>{
 const cortes=[{dia:"2026-10-01",turno:"MAÑANA",conteo:{dif_efectivo:-0.01,persona:"P1"}},{dia:"2026-10-02",turno:"TARDE",conteo:{dif_efectivo:2.34,persona:"P2"}}];
 const cambios=[{dia:"2026-10-02",turno:"NOCHE",dif:-1.20,recibio:"P3",de:{persona:"P2"},dejado:100.20,recibido:99.00}];
 const a=diferenciasCaja(cortes,cambios);
 assert.equal(a.faltantes,1.21);assert.equal(a.sobrantes,2.34);assert.equal(a.lista.length,3);
 assert.deepEqual(viaFinanzas(cortes,cambios),a);
});
test("Sueldos de caja, retiros y administración no se suman dos veces",()=>{
 const a=resumenSueldos([{categoria:"Sueldos",persona:"A",monto:50.10}],[{categoria:"Sueldos",persona:"A",monto:25.20}],
  [{categoria:"Sueldos",concepto:"Pago: B",monto:100.05},{categoria:"Otros",concepto:"No",monto:999}]);
 assert.equal(a.total_caja,75.3);assert.equal(a.total_admin,100.05);assert.equal(a.total,175.35);
 assert.deepEqual(sueldosPublicos([{categoria:"Sueldos",persona:"A",monto:50.10}],[{categoria:"Sueldos",persona:"A",monto:25.20}],[{categoria:"Sueldos",concepto:"Pago: B",monto:100.05}]),a);
 assert.equal(CAT_SUELDOS,nombrePublico);assert.equal(r2(0.1+0.2),0.3);
});
