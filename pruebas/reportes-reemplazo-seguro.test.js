import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const fuente = readFileSync(new URL("../herramientas/aviso-correo.gs", import.meta.url), "utf8");
const codigo = fuente.split("function hojaMensual(d) {")[1]?.split("\nfunction dentroDeRaiz(")[0]?.replace(/\n}\s*$/, "");
assert.ok(codigo, "Falta hojaMensual");

function ensayo(fallarAlLlenar = false, fallarAlMover = false, fallarAlArchivar = false) {
  const acciones = [];
  const viejo = { getId: () => "hoja-antigua", setTrashed: () => { if (fallarAlArchivar) throw Error("fallo-archivo-sintetico"); acciones.push("borrar-anterior"); } };
  const nuevo = { getId: () => "hoja-nueva", setTrashed: () => acciones.push("borrar-nuevo"), moveTo: () => { if (fallarAlMover) throw Error("fallo-movimiento"); acciones.push("mover-nuevo"); } };
  const carpeta = { getFilesByName: () => { acciones.push("buscar-anteriores"); const a = [viejo, nuevo]; return { hasNext: () => a.length > 0, next: () => a.shift() }; }};
  const sh = {
    setName() { acciones.push("nombre-hoja"); return this; },
    getRange() { if (fallarAlLlenar) throw Error("fallo-sintetico"); return { setValues(){return this;},setFontWeight(){return this;},setBackground(){return this;} }; },
    setFrozenRows(){}, autoResizeColumns(){}
  };
  const ss = { getId: () => "hoja-nueva", getUrl: () => "https://ejemplo.local/nuevo", getSheets: () => [sh], insertSheet: () => sh };
  const fn = new Function("SpreadsheetApp","DriveApp","CARPETAS_REPORTES","carpetaArea","carpetaReportes","d", "const carpeta=undefined;return (function hojaMensual(d) {"+codigo+"\n})(d);");
  const out = () => fn({ create(){acciones.push("crear-nuevo");return ss;}, flush(){acciones.push("confirmar-celdas");} },{ getFileById(){return nuevo;} },{finanzas:"carpeta"},()=>carpeta,()=>carpeta,{nombre:"Ensayo",destino:"finanzas",anio:"2026",hojas:[{nombre:"Resumen",filas:[["A"],["B"]]}]});
  return { out, acciones };
}

test("reporte mensual: mantiene anterior si falla el llenado", () => {
  const {out,acciones}=ensayo(true);
  assert.throws(out,/fallo-sintetico/);
  assert.deepEqual(acciones,["crear-nuevo","nombre-hoja"]);
});
test("reporte mensual: mueve nuevo antes de archivar anterior; nunca borra nuevo", () => {
  const {out,acciones}=ensayo();
  const r=out();
  assert.equal(r.id,"hoja-nueva");
  assert.deepEqual(acciones.slice(-3),["mover-nuevo","buscar-anteriores","borrar-anterior"]);
  assert.equal(acciones.includes("borrar-nuevo"),false);
});

test("reporte mensual: conserva anterior si Google Drive rechaza mover el nuevo", () => {
  const { out, acciones } = ensayo(false, true);
  assert.throws(out, /fallo-movimiento/);
  assert.ok(acciones.includes("crear-nuevo"));
  assert.ok(!acciones.includes("buscar-anteriores"));
  assert.ok(!acciones.includes("borrar-anterior"));
  assert.ok(!acciones.includes("borrar-nuevo"));
});

test("reporte mensual: un fallo al archivar el anterior no invalida el nuevo", () => {
  const {out,acciones}=ensayo(false,false,true);
  const r=out();
  assert.equal(r.id,"hoja-nueva");
  assert.equal(r.pendientes_archivar,1);
  assert.ok(acciones.includes("confirmar-celdas"));
  assert.ok(acciones.includes("mover-nuevo"));
  assert.ok(!acciones.includes("borrar-nuevo"));
});
