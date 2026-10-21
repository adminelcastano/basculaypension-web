// Real router execution: no mocks of its routing rules, only its browser shell.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {readFileSync} from "node:fs";
const src=readFileSync(new URL("../src/panel/cliente/00-base.js",import.meta.url),"utf8");
const fin=readFileSync(new URL("../src/panel/cliente/05-finanzas.js",import.meta.url),"utf8");
test("Rutas antiguas reales convergen a CAJA, AGENDA, CONFIG y cuatro vistas de DINERO",()=>{
 const window={fetch:async()=>({ok:true})};
 const document={addEventListener(){},querySelector(){return null},querySelectorAll(){return []}};
 const c={window,document,location:{hash:""},setTimeout,clearTimeout,Intl,Date,console};
 vm.runInNewContext(src,c,{filename:"00-base.js"});
 const ruta=x=>JSON.parse(JSON.stringify(window.EC.ruta(x)));
 const esperado={
  "#dinero/resumen":["finanzas","resumen"],"#dinero/bancos":["finanzas","bancos"],
  "#dinero/obligaciones":["finanzas","obligaciones"],"#dinero/movimientos":["finanzas","movimientos"],
  "#finanzas/cuentas":["finanzas","bancos"],"#dinero/efectivo":["finanzas","bancos"],
  "#finanzas/estados":["finanzas","bancos"],"#finanzas/programados":["finanzas","movimientos"],
  "#dinero/hechos":["finanzas","movimientos"],"#dinero/bitacora":["finanzas","movimientos"],
  "#dinero/compras":["agenda","compras"],"#finanzas/compras":["agenda","compras"],
  "#dinero/transferencias":["caja","transferencias"],"#finanzas/transferencias":["caja","transferencias"],
  "#finanzas/salarios":["config","conexiones"],"#pagos":["finanzas","movimientos"]
 };
 for(const [hash,[mod,vista]] of Object.entries(esperado)){
  const r=ruta(hash);assert.equal(r.mod,mod,hash);assert.equal(r.vista,vista,hash);
 }
 assert.equal(window.EC.hashDe("finanzas","bancos"),"#dinero/bancos");
 assert.equal(window.EC.hashDe("caja","transferencias"),"#caja/transferencias");
});
test("Tarjetas con apertura desconocida no se venden como deuda total",()=>{
 assert.ok(fin.includes('b.deuda_parcial?null:b.deuda'));
 assert.ok(fin.includes('Parcial: falta deuda inicial de alguna tarjeta'));
 assert.ok(!fin.includes('Obligaciones registradas, excluye tarjetas'));
 assert.ok(fin.includes('No se agrega a'));
});
