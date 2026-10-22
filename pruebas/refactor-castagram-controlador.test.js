import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {readFileSync} from "node:fs";
import {execFileSync} from "node:child_process";
const fuente=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
test("CASTAGRAM conserva exactamente el cuerpo anterior, sin alterar comentarios o destinatarios",()=>{
 const anterior=execFileSync("git",["show","b4427c0901691b0bacc19f344a46ecc09ec8cc66:src/panel/cliente/07-agenda.js"],{encoding:"utf8"});
 const inicio="  // ---- Avisos: muro de publicaciones con conversación ----",fin="  // ---- Turno: turno activo, encargados de la tablet";
 const original=anterior.slice(anterior.indexOf(inicio),anterior.indexOf(fin));
 const controlador=fuente("src/panel/cliente/07-castagram-controlador.js");
 assert.ok(controlador.includes(original),"Se cambió lógica interna de CASTAGRAM en extracción");
 for(const ruta of ["avisos-archivo","comentarios","conversacion","avisos-feed"]) assert.ok((controlador+fuente("src/panel/cliente/07-agenda.js")).includes(ruta),ruta);
 assert.match(fuente("src/panel-app.js"),/J07P, J07A, J07, J08/);
 assert.doesNotThrow(()=>new vm.Script(controlador));
 assert.doesNotThrow(()=>new vm.Script(fuente("src/panel/cliente/07-agenda.js")));
});
test("CASTAGRAM reusa el estado y mantiene funciones de render público",()=>{
 const window={};const ctx={window,document:{addEventListener(){}},setTimeout(){}};
 vm.runInNewContext(fuente("src/panel/cliente/07-castagram-controlador.js"),ctx);
 const st={items:[],personas:[],hoy:"2026-10-21",avisosSinLeer:0};
 const noop=()=>{},deps={st,$:()=>null,esc:String,toast:noop,api:noop,post:noop,ico:()=>"",abierto:()=>true,formEditar:noop,fotosDe:()=>[],urlFoto:noop,comprimirFoto:noop,cuando:noop,cargar:noop,pintar:noop,conectar:noop,foto:noop,diaTxt:noop,contadores:noop};
 const ui=window.CastaCastagramControlador(deps);
 assert.equal(typeof ui.vistaAvisos,"function");assert.equal(typeof ui.pintarAvisos,"function");
 assert.equal(ui.pintarAvisos(),undefined);
 assert.equal(st.items.length,0);
});
