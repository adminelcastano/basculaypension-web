import test from "node:test";
import assert from "node:assert/strict";
import {feedCastagramAdmin} from "../src/agenda-feed.js";
import {readFileSync} from "node:fs";
const src=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
test("Feed admin mantiene Access delegado y filtrado previo",()=>{
 const ag=src("src/agenda.js"),feed=src("src/agenda-feed.js");
 assert.match(ag,/partes\[1\] === "avisos-feed" && request.method === "GET"/);
 assert.match(ag,/return feedCastagramAdmin\(env, url,/);
 for(const x of ["LIMIT 26","slice(0,25)","resumenConversaciones","SELECT item_id, persona, at FROM agenda_lecturas","aviso_vistos","mas:rows.length>25"])
   assert.ok(feed.includes(x),x);
 assert.doesNotMatch(feed,/DELETE FROM|UPDATE\s+agenda_items|INSERT INTO/i);
});
test("Feed vacío devuelve JSON original sin alterar D1",async()=>{
 const queries=[];
 const env={DB:{prepare(q){queries.push(q);return{bind(){return this},async all(){return {results:[]}}}}}};
 const json=(body,status=200)=>({status,body});
 const result=await feedCastagramAdmin(env,new URL("https://ejemplo.invalid/panel/api/agenda/avisos-feed"),{
   asegurarEsquemaAvisos:async()=>{}, resumenConversaciones:async()=>({}),normalizarPara:x=>x,json});
 assert.equal(result.status,200);
 assert.deepEqual(result.body,{ok:true,items:[],mas:false,cursor:""});
 assert.equal(queries.length,1);
 assert.match(queries[0],/WHERE tipo = 'aviso'/);
});