// Simulación ejecutable del formulario de transferencias en móvil.
// Valida el comportamiento real del listener sin navegador ni datos productivos.
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const source=readFileSync(new URL("../src/panel/cliente/05-finanzas.js",import.meta.url),"utf8");
const inicio=source.indexOf('ft.ticket_ref.addEventListener("change", () => {');
const fin=source.indexOf("\n      });",inicio);
assert.ok(inicio>=0 && fin>inicio,"El evento de selección de ticket existe");
const evento=source.slice(inicio,fin+"\n      });".length);
function formulario(){
  let cambio;
  const ft={
    ticket_ref:{selectedOptions:[],addEventListener:(name,listener)=>{assert.equal(name,"change");cambio=listener}},
    cliente:{value:""},importe:{value:""},fecha:{value:"2026-10-19"},dataset:{}
  };
  new Function("ft","hoyMx",evento)(ft,()=>"2026-10-19");
  return {ft,elegir:(value,data={})=>{ft.ticket_ref.selectedOptions=[{value,dataset:data}];cambio()}};
}
test("Seleccionar otro ticket sustituye exclusivamente el cliente autocompletado",()=>{
  const {ft,elegir}=formulario();
  elegir("bascula:A",{cli:"Cliente A",imp:"100.50",f:"2026-10-18"});
  assert.deepEqual([ft.cliente.value,ft.importe.value,ft.fecha.value],["Cliente A","100.50","2026-10-18"]);
  elegir("pension:B",{cli:"Cliente B",imp:"210",f:"2026-10-17"});
  assert.deepEqual([ft.cliente.value,ft.importe.value,ft.fecha.value],["Cliente B","210","2026-10-17"]);
  assert.equal(ft.dataset.ticketCliente,"Cliente B");
});
test("Nombre escrito manualmente no se reemplaza al cambiar de ticket",()=>{
  const {ft,elegir}=formulario();
  elegir("bascula:A",{cli:"Cliente A",imp:"100.50",f:"2026-10-18"});
  ft.cliente.value="Nombre que confirmó administración";
  elegir("bascula:C",{cli:"Cliente C",imp:"300",f:"2026-10-16"});
  assert.equal(ft.cliente.value,"Nombre que confirmó administración");
  assert.equal(ft.importe.value,"300");
  assert.equal(ft.fecha.value,"2026-10-16");
  assert.ok(!ft.dataset.ticketCliente);
});
test("Volver a Sin ticket retira importes/fechas automáticos y respeta valores manuales",()=>{
  const {ft,elegir}=formulario();
  elegir("bascula:A",{cli:"Cliente A",imp:"100.50",f:"2026-10-18"});
  elegir("");
  assert.deepEqual([ft.cliente.value,ft.importe.value,ft.fecha.value],["","","2026-10-19"]);
  assert.deepEqual(Object.keys(ft.dataset),[]);
  elegir("pension:B",{cli:"Cliente B",imp:"200",f:"2026-10-15"});
  ft.importe.value="205.25";
  ft.fecha.value="2026-10-14";
  elegir("");
  assert.equal(ft.importe.value,"205.25","Conservar importe modificado por el administrador");
  assert.equal(ft.fecha.value,"2026-10-14","Conservar fecha modificada manualmente");
  assert.equal(ft.cliente.value,"");
});
