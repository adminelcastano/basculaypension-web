import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
const fuente = p => readFileSync(new URL("../"+p, import.meta.url),"utf8");
test("Compra separada sin alterar rutas y empaquetado",()=>{
  const app=fuente("src/panel-app.js"), ag=fuente("src/panel/cliente/07-agenda.js"), comp=fuente("src/panel/cliente/07-compras-controlador.js");
  assert.ok(app.indexOf("J07C, J07")>=0);
  assert.ok(ag.includes("window.CastaComprasControlador({"));
  assert.ok(ag.includes("window.agendaAbrir"));
  assert.ok(!ag.includes("function ventanaTerminar()"));
  assert.ok(comp.includes("function ventanaTerminar()"));
  for(const p of ['post("agenda/compras/terminar"','post("agenda/compras/carrito"','post("agenda/compras/regresar-ticket"','crypto.randomUUID()'])assert.ok(comp.includes(p),p);
  assert.doesNotThrow(()=>new vm.Script(ag));
  assert.doesNotThrow(()=>new vm.Script(comp));
});
test("Controlador crea la misma vista vacía sin datos adicionales",()=>{
  const window={catChip:()=>"",medioTxt:()=>"",opcionesMedio:()=>""};
  vm.runInNewContext(fuente("src/panel/cliente/07-compras-controlador.js"),{window});
  const st={items:[],memoria:[],lugares:[],tienda:null,lugarFiltro:""};
  const api=window.CastaComprasControlador({st,abierto:()=>true,esc:String,ico:()=>"",formEditar:()=>"",avP:()=>"",selLugar:()=>"",MXN:v=>"$"+v,post:async()=>({}),toast:()=>{},cargar:async()=>{},pintar:()=>{},formulario:()=>"<form/>",$:()=>null});
  assert.match(api.vistaCompras(),/No hay compras pendientes/);
  assert.match(api.vistaCompras(),/id="cl-add"/);
  assert.equal(typeof api.conectarCompras,"function");
  assert.equal(typeof api.agregarCompra,"function");
  assert.equal(st.items.length,0);
});
