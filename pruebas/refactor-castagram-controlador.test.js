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


test("Visto de administración NO equivale a Enterado y no amplía destinatarios",()=>{
 const window={};const ctx={window,document:{addEventListener(){}},setTimeout(){},
   EC:{nombreAdmin:()=>"Administración"},avP:()=>'<span class="avatar">A</span>'};
 vm.runInNewContext(fuente("src/panel/cliente/07-castagram-controlador.js"),ctx);
 const st={items:[],personas:[{clave:"JESC",activo:true,nombre:"Encargado"}],hoy:"2026-10-21",avisosSinLeer:0};
 const nop=()=>{},deps={st,$:()=>null,esc:String,toast:nop,api:nop,post:nop,ico:()=>"",abierto:it=>it.estado==="activo",
   formEditar:nop,fotosDe:()=>[],urlFoto:nop,comprimirFoto:nop,cuando:()=>"",cargar:nop,pintar:nop,
   conectar:nop,foto:nop,diaTxt:nop,contadores:nop};
 const vista=window.CastaCastagramControlador(deps);
 const sinPublicaciones=vista.vistaAvisos();
 assert.match(sinPublicaciones,/Elige destinatarios \(obligatorio\)/);
 assert.doesNotMatch(sinPublicaciones,/data-para="todos"\s+checked/);
 const p={id:"aviso-sintetico",tipo:"aviso",titulo:"Contenido privado sintético",estado:"activo",
   creado:"2026-10-21T12:00:00Z",autor:"JESC",
   para:{todos:false,admin:true,turnos:[],personas:[]},lecturas:[],visto_admin:true,
   conv:{n:0,nuevos:0,nuevosEnterado:0}};
 st.items=[p];
 const visto=vista.vistaAvisos();
 assert.match(visto,/Visto · Enterado pendiente/);
 assert.doesNotMatch(visto,/>✓ Enterado<\/span>/);
 p.lecturas=[{persona:"ADMIN",at:"2026-10-21T13:00:00Z"}];
 const enterado=vista.vistaAvisos();
 assert.match(enterado,/✓ Enterado/);
 assert.doesNotMatch(enterado,/Visto · Enterado pendiente/);
 assert.equal(p.para.todos,false);
});
