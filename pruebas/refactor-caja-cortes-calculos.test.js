import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {execFileSync} from "node:child_process";
import {calcularCortes,totalesMes} from "../src/caja.js";
import {crearCalculosCortes} from "../src/caja-cortes-calculos.js";
const css = p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
test("CAJA conserva exactamente las funciones de corte y suma del origen",()=>{
 const antes=execFileSync("git",["show","9fad8766ec41a4a494e41a8b4ba640f19bf65333:src/caja.js"],{encoding:"utf8"});
 const a=antes.indexOf("export function calcularCortes("),b=antes.indexOf("// Agrega a cada corte lo que contó el encargado",a);
 assert.ok(a>0&&b>a);
 const original=antes.slice(a,b).replace(/^export function/gm,"function");
 assert.ok(css("src/caja-cortes-calculos.js").includes(original));
 assert.match(css("src/caja.js"),/export function calcularCortes\(\.\.\.args\)/);
 assert.match(css("src/caja.js"),/export function totalesMes\(\.\.\.args\)/);
});
test("CAJA conserva cortes sintéticos, egresos y transferencias al centavo",()=>{
 const movimientos=[
  {dia:"2026-10-21",turno:"MAÑANA",tipo:"ticket",servicio:"bascula",forma:"EFECTIVO",importe:100.20},
  {dia:"2026-10-21",turno:"MAÑANA",tipo:"ticket",servicio:"pension",forma:"TARJETA",importe:40.10},
  {dia:"2026-10-21",turno:"MAÑANA",tipo:"ticket",servicio:"bascula",forma:"TRANSFERENCIA",importe:20.15}];
 const gastos=[{dia:"2026-10-21",turno:"MAÑANA",forma:"EFECTIVO",monto:10.05}];
 const extras=[{dia:"2026-10-21",turno:"MAÑANA",monto:5,ingreso:1}];
 const cortes=calcularCortes(movimientos,gastos,extras);
 assert.equal(cortes.length,1);
 assert.equal(Math.round(cortes[0].efectivo_caja*100),9515);
 const total=totalesMes(cortes);
 assert.equal(Math.round(total.efectivo*100),10020);
 assert.equal(Math.round(total.tarjeta*100),4010);
 assert.equal(Math.round(total.transferencias*100),2015);
 assert.equal(Math.round(total.gastos*100),1005);
 const puros=crearCalculosCortes({esCambio:()=>false,FORMAS_CONTADAS:["EFECTIVO","TARJETA"],TURNOS:["MAÑANA","TARDE","NOCHE"],esTransf:f=>String(f).startsWith("TRANSF")});
 assert.deepEqual(puros.calcularCortes(movimientos,gastos,extras),cortes);
 assert.deepEqual(puros.totalesMes(cortes),total);
});
