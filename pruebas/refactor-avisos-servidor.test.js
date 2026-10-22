import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {execFileSync} from "node:child_process";
import {rutaArchivoCastagramAdmin,rutaConversacionCastagramAdmin} from "../src/agenda-avisos-rutas.js";
const src=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
test("Archivo y conversación conservan literalmente privacidad, reintentos y Enterado",()=>{
 const before=execFileSync("git",["show","433fe5260f2dc16e427200cbd7b17abd72e94229:src/agenda.js"],{encoding:"utf8"});
 const markers=[
  ["  // Archivo de avisos: todos los archivados con su conversación (no se borran)","  const id = partes[1];"],
  ["  // ---- Conversación de un aviso ----","  // Agregar o quitar fotos de una incidencia ya registrada"]];
 const helper=src("src/agenda-avisos-rutas.js");
 for(const [start,stop] of markers){const a=before.indexOf(start),b=before.indexOf(stop,a);assert.ok(a>0&&b>a&&helper.includes(before.slice(a,b)));}
 const agenda=src("src/agenda.js");
 assert.match(agenda,/rutaArchivoCastagramAdmin\(request, env, url, partes/);
 assert.match(agenda,/rutaConversacionCastagramAdmin\(request, env, url, partes, usuario, ahora, fila/);
 assert.match(helper,/Nueva actividad en Castagram/);
 assert.doesNotMatch(helper,/cuerpo:\s*c\.texto/);
});
test("Rutas desconocidas de conversación no afectan otros datos",async()=>{
 const json=(b,status=200)=>({body:b,status});
 const datos={json,guardarFotosInc:async()=>[],normalizarPara:x=>x,listaFotos:()=>[]};
 const response=await rutaConversacionCastagramAdmin({method:"GET"},null,new URL("https://ensayo.invalid"),
  ["agenda","item","irrelevante"],null,"2026-10-21T12:00:00Z",{tipo:"tarea"},datos);
 assert.equal(response,null);
 const archivo=await rutaArchivoCastagramAdmin({method:"GET"},null,new URL("https://ensayo.invalid"),["agenda","noarchivo"],{json});
 assert.equal(archivo,null);
});
