// Contratos HTTP/JSON ejecutados directamente sobre las funciones reales.
// Contexto exclusivamente sintético: ninguna llamada de red, D1 o KV productivo.
import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {rutasComprasAgenda} from "../src/agenda-compras-rutas.js";

const src=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
const json=(body,status=200)=>({status,body});
function extraer(p,firma) {
 const s=src(p),a=s.indexOf(firma),b=s.indexOf("\n}\n",a);
 assert.ok(a>=0&&b>a,"Función fuente faltante: "+firma);
 return s.slice(a,b+2).replace(/^export /,"");
}
const instancia=(codigo,nombres,valores,nombre)=>new Function(...nombres,codigo+"\nreturn "+nombre+";")(...valores);

test("CAJA: turno y fecha inválidos conservan HTTP 422, sin D1",async()=>{
 const c=extraer("src/caja.js","export async function cajaPanel(");
 const ruta=instancia(c,["asegurarEsquemaCaja","asegurarEsquemaCategorias","mesesAbiertos","TZ","fechaCalendarioCaja","normTurno","json"],
  [async()=>{},async()=>{},async()=>["2026-10"],"America/Mexico_City",()=>false,()=>"",json],"cajaPanel");
 const result=await ruta({method:"GET"},{},new URL("https://ensayo.invalid/panel/api/caja/saldo?dia=no&turno=no"),
  ["caja","saldo"],{email:"actor@invalid.example"},null);
 assert.deepEqual(result,{status:422,body:{ok:false,error:"Turno inválido."}});
});

test("DINERO: cotejo de mes imposible conserva HTTP 422 y mensaje",async()=>{
 const c=extraer("src/finanzas.js","export async function finanzasPanel(");
 const ruta=instancia(c,["asegurarEsquemaFinanzas","mesesFinanzas","RE_MES","json"],
  [async()=>{},()=>["2026-10"],/^\d{4}-(0[1-9]|1[0-2])$/,json],"finanzasPanel");
 const result=await ruta({method:"GET"},{},new URL("https://ensayo.invalid/panel/api/finanzas/cotejo-estados?mes=1890-13"),
  ["finanzas","cotejo-estados"],{email:"actor@invalid.example"});
 assert.deepEqual(result,{status:422,body:{ok:false,error:"Mes fuera del historial financiero disponible."}});
});

test("AGENDA: carrito sin artículos conserva HTTP 422 y no escribe D1",async()=>{
 const result=await rutasComprasAgenda({method:"POST",json:async()=>({ids:[]})},null,
  ["agenda","compras","carrito"],null,"2026-10-21T12:00:00Z",{json});
 assert.deepEqual(await Promise.resolve(result),{status:422,body:{ok:false,error:"No hay artículos."}});
});

test("FACTURACIÓN: ruta API no registrada conserva HTTP 404",async()=>{
 const c=extraer("src/worker-panel-rutas.js","async function rutasPanel(request, env, url, usuario) {");
 const ruta=instancia(c,["asegurarEsquema","json"],[async()=>{},json],"rutasPanel");
 const url=new URL("https://ensayo.invalid/panel/api/ruta-inexistente");
 const result=await ruta({method:"GET"}, {}, url, {email:"actor@invalid.example"});
 assert.deepEqual(result,{status:404,body:{ok:false,error:"Ruta no encontrada."}});
});

test("PERSONAL: listado vacío conserva HTTP 200, campos y contadores sin PII",async()=>{
 const c=extraer("src/personal.js","export async function personalPanel(");
 const ruta=instancia(c,["asegurarEsquemaPersonal","DOC_AVISO_PERSONAL","VERSION_AVISO_PERSONAL_V1","resumenFila","leerConfig","json"],
  [async()=>{},"aviso-privacidad-colaboradores","personal-aviso-v1-2026-10-17",x=>x,async()=>({}),json],"personalPanel");
 const env={DB:{prepare(){return{bind(){return{all:async()=>({results:[]})}}}}}};
 const url=new URL("https://ensayo.invalid/panel/api/colaboradores");
 const result=await ruta({method:"GET"},env,url,["colaboradores"],async()=>{});
 assert.deepEqual(result,{status:200,body:{ok:true,colaboradores:[],conteos:{colaborador:0,externo:0,activo:0,inactivo:0,todos:0,incompletos:0,completos:0},config:{}}});
});
