// Capturas reproducibles de respuestas HTTP/JSON del enrutador real con SQLite aislada.
// No abre conexiones Cloudflare, archivos personales ni datos productivos.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { agendaPanel } from "../src/agenda.js";

function ficticio(t) {
 const sqlite=new DatabaseSync(":memory:"); t.after(()=>sqlite.close());
 const sql=(q,p=[])=>({sql:q,args:p,bind(...v){return sql(q,v);},
  async all(){return {results:sqlite.prepare(q).all(...p)};},
  async first(){return sqlite.prepare(q).get(...p)||null;},
  async run(){const r=sqlite.prepare(q).run(...p);return {meta:{changes:Number(r.changes||0)},success:true};}});
 const DB={prepare:q=>sql(q),async batch(s){
  sqlite.exec("BEGIN IMMEDIATE");
  try {const out=[];for(const x of s)out.push(await x.run());sqlite.exec("COMMIT");return out;}
  catch(e){sqlite.exec("ROLLBACK");throw e;}
 }};
 return {sqlite,env:{DB,FILES:{async get(){return null},async put(){throw Error("Prohibido escribir KV en contrato de lectura");}}}};
}
async function consulta(env,path) {
 const url=new URL("https://ensayo.invalid/panel/api/agenda"+path);
 const res=await agendaPanel(new Request(url),env,url,["agenda",...url.pathname.slice("/panel/api/agenda/".length).split("/").filter(Boolean)],{email:"admin@invalid.example"});
 const tipo=res.headers.get("Content-Type");
 return {status:res.status,tipo:tipo?.split(";")[0],body:await res.json()};
}
test("CASTAGRAM: feed vacío captura contrato HTTP/JSON real, sin escrituras",async t=>{
 const {sqlite,env}=ficticio(t);
 const x=await consulta(env,"/avisos-feed");
 assert.deepEqual(x,{status:200,tipo:"application/json",body:{ok:true,items:[],mas:false,cursor:""}});
 assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM agenda_items").get().n,0);
});
test("CASTAGRAM: archivo nunca aparece en feed activo aunque el registro exista",async t=>{
 const {sqlite,env}=ficticio(t);
 await consulta(env,"/avisos-feed"); // Inicializar el esquema en memoria
 sqlite.prepare("INSERT INTO agenda_items(id,tipo,titulo,estado,creado,autor,para) VALUES (?,?,?,?,?,?,?)")
   .run("archivado-test","aviso","No publicar","archivado","2026-10-01T12:00:00Z","admin",'{"todos":false,"admin":true,"turnos":[],"personas":[]}');
 const x=await consulta(env,"/avisos-feed");
 assert.deepEqual(x,{status:200,tipo:"application/json",body:{ok:true,items:[],mas:false,cursor:""}});
 assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM agenda_items").get().n,1);
});
