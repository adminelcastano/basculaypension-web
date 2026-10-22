import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {execFileSync} from "node:child_process";
import {crearControladorCampanas} from "../src/personal-campanas.js";
test("Campañas mantiene lógica original y adaptadores de Personal",()=>{
 const old=execFileSync("git",["show","ff5b539462ea1aed3e39ed926c4eb3817975ffc2:src/personal.js"],{encoding:"utf8"});
 const a=old.indexOf("async function crearCampanaFilas("),b=old.indexOf("// Panel: /panel/api/colaboradores...",a);
 const mod=readFileSync(new URL("../src/personal-campanas.js",import.meta.url),"utf8");
 const main=readFileSync(new URL("../src/personal.js",import.meta.url),"utf8");
 assert.ok(a>0&&b>a&&mod.includes(old.slice(a,b)));
 assert.match(main,/crearControladorCampanas\(\{/);
 assert.match(main,/export async function personalPanel\(/);
});
test("Crear campaña con participantes sintéticos conserva instrucciones D1 y claves",async()=>{
 const calls=[];
 const env={DB:{prepare(sql){return{bind(...args){return{async run(){calls.push({sql,args})},sql,args}}}}},async batch(items){for(const p of items)calls.push({sql:p.sql,args:p.args});}}};
 const deps={VERSION_AVISO_PERSONAL_V1:"personal-aviso-v1-2026-10-17",DOC_AVISO_PERSONAL:"aviso-privacidad-colaboradores",DOCUMENTOS:{},folioDe:()=>"",
  parse:()=>({}),json:x=>x,SITIO:"https://invalid.example",escH:String,estaCompleto:()=>false,fechaLarga:String,hoyLocal:()=>"2026-10-22",
  sumarDias:()=>"",nuevoIdCampana:()=>"campana-sintetica",leerCampana:x=>x,estadoEnCampana:()=>({})};
 const api=crearControladorCampanas(deps);
 const id=await api.crearCampanaFilas(env,{nombre:"Prueba aislada",limite:"2026-11-01",docs:[]},["persona-1","persona-2"],"2026-10-22T12:00:00Z");
 assert.equal(id,"campana-sintetica");
 assert.equal(calls.length,3);
 assert.match(calls[0].sql,/INSERT INTO campanas/);
 assert.equal(calls[1].args[1],"persona-1");
 assert.equal(calls[2].args[1],"persona-2");
});
