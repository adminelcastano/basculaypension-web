import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { inventario, caracterizar } from "../scripts/refactor-inventario.mjs";
const BASE="b9973b25b18fbd69892eeb84bbfede9b5c57a14a";
test("Línea base fija: inventario completo desde Git, nunca del árbol mutable",()=>{
 const r=inventario(BASE);
 assert.equal(r.ref,BASE);
 assert.equal(r.tree,"e8cd7015fdeb0e2c7406f5b019595e848c10276f");
 assert.ok(r.archivos.length>30);
 assert.ok(r.totales.bytes>500000);
 const esperados={
  "src/agenda.js":"26b6693cedf75fe9bd3af0c15a7830f050727c14",
  "src/caja.js":"6f8942726d20345071ae8f6a616d3c049fd9862a",
  "src/finanzas.js":"eac5db8dff4988cd17e6266645293a156d21c578",
  "src/worker.js":"b5c75def63099811c8447a8a47b2809a22ec6451",
  "src/personal.js":"9e793f7974190d7a07cb079e38101ada5e3abfad",
  "src/turno.js":"b0a8a48bd0be169b967d3d3f55bd0e15aeb5b90a",
  "src/avisos.js":"c325e8181a3dadd454a1044482792dd38e9306f6",
  "src/panel/cliente/07-agenda.js":"a16e6781706ab3bad28ae5d200edcfd0128c40a8"};
 for(const [ruta,blob] of Object.entries(esperados)){
   const fila=r.archivos.find(x=>x.ruta===ruta);
   assert.ok(fila,ruta);assert.equal(fila.blob,blob,ruta);
   assert.ok(fila.bytes>10000,ruta);
 }
 assert.deepEqual(inventario(BASE),r);
});
test("Inventario registra exports/imports y rutas sin ejecutar Worker ni acceso a datos",()=>{
 const d=caracterizar("src/test.js","sha",Buffer.from("import f from './f.js';\nexport function ruta() { return '/panel/api/x'; }\n"));
 assert.deepEqual(d.exports_candidatos,["ruta"]);
 assert.deepEqual(d.imports_candidatos,["./f.js"]);
 assert.deepEqual(d.rutas_candidatas,["/panel/api/x"]);
});
test("No acepta ramas ni texto malicioso como commit",()=>{
 for(const s of ["main","--help","HEAD","deadbeef","a".repeat(39)]) assert.throws(()=>inventario(s),/SHA-40/);
});
test("Ejecutar el inventario no modifica el árbol y no contacta servicios",()=>{
 const comando=()=>execFileSync(process.execPath,["scripts/refactor-inventario.mjs","--ref",BASE],{encoding:"utf8",maxBuffer:12*1024*1024});
 const antes=execFileSync("git",["status","--porcelain"],{encoding:"utf8"});
 const json=JSON.parse(comando());
 const despues=execFileSync("git",["status","--porcelain"],{encoding:"utf8"});
 assert.equal(antes,despues);assert.equal(json.ref,BASE);
});