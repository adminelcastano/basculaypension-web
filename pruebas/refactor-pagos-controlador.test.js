import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
const src=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
test("Controlador Pagos mantiene rutas, UID, comprobantes y acceso previo",()=>{
 const app=src("src/panel-app.js"), ag=src("src/panel/cliente/07-agenda.js"), pagos=src("src/panel/cliente/07-pagos-controlador.js");
 assert.match(app,/J07C, J07P, J07, J08/);
 assert.match(ag,/window\.CastaPagosControlador\(\{/);
 assert.match(ag,/window\.agendaPagarObligacion/);
 for(const p of ['crypto.randomUUID()','post("agenda/pagos/hecho"','post("agenda", { tipo: "pago"','/panel/api/agenda/','quitar-comprobante','obligaciones-actualizadas'])assert.ok(pagos.includes(p),p);
 assert.doesNotThrow(()=>new vm.Script(pagos));
 assert.doesNotThrow(()=>new vm.Script(ag));
});
test("Pagos vacíos conservan etiqueta existente",()=>{
 const window={};vm.runInNewContext(src("src/panel/cliente/07-pagos-controlador.js"),{window});
 const pagos=window.CastaPagosControlador({st:{pagosHechos:[]},ico:()=>"",esc:String,MXN:String,diaTxt:String,mayus:String,fMes:{format:String},post:()=>{},cargar:()=>{},toast:()=>{}});
 assert.match(pagos.listaPagosHechos(),/Todavía no hay pagos registrados/);
 assert.equal(typeof pagos.ventanaPago,"function");
});
