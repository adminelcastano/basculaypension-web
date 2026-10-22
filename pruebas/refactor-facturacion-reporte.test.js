import test from "node:test";
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {readFileSync} from "node:fs";
import {filasExcel,ENCABEZADOS} from "../src/facturacion-reporte-filas.js";
const txt=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
test("Reporte conserva literalmente su mapeo original y el orden de columnas",()=>{
 const old=execFileSync("git",["show","f74ad2d76d9edbe7ceab0e2a5ad42aaa6686e75f:src/worker.js"],{encoding:"utf8"});
 const a=old.indexOf("const ENCABEZADOS = "),b=old.indexOf("// Para el reporte mensual en Sheets",a);
 assert.ok(a>0&&b>a);
 const original=old.slice(a,b).replace("const ENCABEZADOS =","export const ENCABEZADOS =").replace("function filasExcel(results)","export function filasExcel(results)");
 assert.ok(txt("src/facturacion-reporte-filas.js").includes(original));
 assert.match(txt("src/worker.js"),/filasFacturas: filasExcel/);
 assert.equal(ENCABEZADOS.length,24);
});
test("Reporte sintético conserva encabezados, orden, estado, fecha e importe",()=>{
 const filas=filasExcel([{folio:"TEST-01",creado:"2026-10-21T12:00:00Z",estado:"en_revision",servicio:"bascula",
   folio_ticket:"F-123",rfc:"XAXX010101000",nombre:"CLIENTE SINTÉTICO",importe:150.25,
   email:"ensayo@example.invalid",aviso_version:"prueba-sintetica"}]);
 assert.equal(filas.length,2);assert.deepEqual(filas[0],ENCABEZADOS);
 assert.equal(filas[1].length,ENCABEZADOS.length);
 assert.equal(filas[1][0],"TEST-01");assert.equal(filas[1][2],"En revisión");
 assert.equal(filas[1][1],"2026-10-21 06:00");assert.equal(filas[1][18],"$150.25");
 assert.equal(filas[1][23],"prueba-sintetica");
});
