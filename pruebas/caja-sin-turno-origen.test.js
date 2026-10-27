import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { calcularCortes, totalesMes } from "../src/caja.js";

// Ensayo puramente sintético; simula la estructura de Caja del 26 de octubre
// sin utilizar ningún folio, expediente ni movimiento real.
const dia = "2026-10-26";
const movimientos = [
  {dia,turno:"MAÑANA",tipo:"ticket",servicio:"pension",forma:"EFECTIVO",importe:4720},
  {dia,turno:"TARDE",tipo:"ticket",servicio:"bascula",forma:"EFECTIVO",importe:600},
  {dia,turno:"SIN TURNO",tipo:"ticket",servicio:"pension",forma:"EFECTIVO",importe:0}
];
const vigentes = new Set(["MAÑANA","TARDE","NOCHE"]);
const leer = path => readFileSync(new URL("../"+path,import.meta.url),"utf8");

test("Movimiento sin turno no crea una entrega en tablet ni altera ingresos",()=>{
  const cortes=calcularCortes(movimientos,[]);
  assert.equal(cortes.length,3,"Conservar los tres grupos antes de clasificarlos para la pantalla");
  const reales=cortes.filter(x=>vigentes.has(x.turno));
  const advertencias=cortes.filter(x=>!vigentes.has(x.turno));
  assert.equal(reales.length,2);
  assert.equal(advertencias.length,1);
  assert.equal(advertencias[0].registros,1);
  assert.equal(advertencias[0].efectivo,0);
  assert.equal(totalesMes(cortes).efectivo,5320);
  assert.equal(reales.reduce((n,x)=>n+x.efectivo,0),5320);
  assert.equal(cortes.some(x=>x.conteo),false);
});

test("Caja no ofrece SIN TURNO como corte ni lo oculta sin advertencia",()=>{
  const ui=leer("src/panel/cliente/03-caja.js");
  assert.match(ui,/const cortesOperativos = j\.cortes\.filter\(x => TURNOS_ORDEN\.includes\(x\.turno\)\)/);
  assert.match(ui,/const cortesSinTurno = j\.cortes\.filter\(x => !TURNOS_ORDEN\.includes\(x\.turno\)\)/);
  assert.match(ui,/Registros de origen sin turno asignado/);
  assert.match(ui,/sus importes permanecen en los totales/);
  assert.match(ui,/for \(const c of cortesOperativos\)/);
  assert.match(ui,/lista\.innerHTML = avisoSinTurno \+ grupos\.map/);
  assert.match(ui,/EC\.bloqueN\("caja", "cortes", cortesOperativos\.length/);
});

test("Detalle de turno no válido responde 422 antes de consultar D1, no 500",()=>{
  const s=leer("src/caja.js");
  const inicio=s.indexOf('if (partes[1] === "corte" && request.method === "GET")');
  assert.ok(inicio>0);
  const trozo=s.slice(inicio,s.indexOf('  if (partes[1] === "gastos"',inicio));
  assert.ok(trozo.indexOf("if (!TURNOS.includes(turno))") < trozo.indexOf('const get = (sql,'));
  assert.match(trozo,/Este registro de la hoja no tiene un turno válido/);
  assert.match(trozo,/const ant = turnoAnterior\(dia, turno\), sig = turnoSiguiente\(dia, turno\)/);
  assert.match(trozo,/corte\.cambio_siguiente = sig \?/);
});
