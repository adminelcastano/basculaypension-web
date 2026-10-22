import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { idOperacionCastagram, fotoAvisoPermitida } from "../src/avisos.js";
import { avisoParaEncargado, normalizarPara, pushTablet } from "../src/agenda.js";

const f = path => readFileSync(new URL(path, import.meta.url),"utf8");
const panel=f("../src/panel/cliente/07-agenda.js");
const turno=f("../src/turno.html");
const server=f("../src/turno.js");
const agenda=f("../src/agenda.js");
const avisos=f("../src/avisos.js");
const css=f("../src/panel/estilos.css");

test("El mismo UID conserva exactamente el mismo ID en publicación o comentario", async()=>{
  const uid="reintento-20261018-abc123";
  const a=await idOperacionCastagram("comentar",uid,"JESC","post1");
  assert.match(a,/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
  assert.equal(a,await idOperacionCastagram("comentar",uid,"JESC","post1"));
  assert.notEqual(a,await idOperacionCastagram("comentar",uid,"ERI","post1"));
  assert.notEqual(a,await idOperacionCastagram("comentar",uid,"JESC","post2"));
  assert.notEqual(a,await idOperacionCastagram("publicar",uid,"JESC","post1"));
});

test("El acceso a fotos de una publicación exige permiso y estado activo",()=>{
  const post={autor:"JESC",estado:"activo",para:JSON.stringify({todos:false,admin:true,turnos:[],personas:["ERI"]})};
  assert.equal(avisoParaEncargado(post,"JESC","NOCHE"),true);
  assert.equal(fotoAvisoPermitida(post,"ERI","MAÑANA"),true);
  assert.equal(fotoAvisoPermitida(post,"JOESC","TARDE"),false);
  assert.equal(fotoAvisoPermitida(post,"ERI","MAÑANA",true),false);
  assert.equal(fotoAvisoPermitida({...post,estado:"archivado"},"ERI","MAÑANA"),false);
  assert.equal(normalizarPara(post.para).todos,false);
});

test("Las notificaciones generales no revelan texto privado",()=>{
  const p=pushTablet("aviso",{titulo:"Contenido reservado",detalle:"123 privado",prioridad:"alta",
    para:{todos:false,admin:false,turnos:["TARDE"],personas:[]}},"id-1");
  assert.ok(p);
  assert.doesNotMatch(JSON.stringify(p),/Contenido reservado|123 privado/);
  assert.equal(pushTablet("aviso",{para:{todos:false,admin:true,turnos:[],personas:[]}},"id-2"),null);
});

test("El visor funciona dentro de ambos clientes sin enlaces externos",()=>{
  for(const source of [panel,turno]){
    assert.match(source,/class="casta-foto-abrir"/);
    assert.match(source,/data-casta-foto-url/);
    assert.match(source,/document\.createElement\("dialog"\)/);
    assert.match(source,/history\.pushState\(\{\.\.\.history\.state,casta_layer:"foto"/);
    assert.match(source,/castaFotoCerrar\(true\)/);
    assert.match(source,/castaFotoMover\(dx<0\?1:-1\)/);
    assert.match(source,/e\.isComposing/);
    assert.doesNotMatch(source,/target="_blank" rel="noopener" aria-label="Abrir foto/);
  }
  assert.match(css,/dialog\.casta-visor/);
  assert.match(turno,/dialog\.casta-visor/);
});

test("Fotografía, conversación y archivo tienen estados independientes de Atrás",()=>{
  assert.match(panel,/casta_layer:"archivo"/);
  assert.match(panel,/casta_layer:"archivo-detalle"/);
  assert.match(panel,/casta_layer:"comentarios"/);
  assert.match(turno,/casta_layer:"comentarios"/);
  assert.match(panel,/addEventListener\("popstate",castaRegreso\)/);
  assert.match(turno,/addEventListener\("popstate",castaRegreso\)/);
  assert.match(f("../src/panel/cliente/08-navegacion.js"),/dialog\.casta-visor\[open\]/);
  assert.match(turno,/hojaPrivada\.close\(\)/);
});

test("La lectura no equivale a Enterado; ampliar audiencia requiere consentimiento",()=>{
  const fuente=avisos.slice(avisos.indexOf("export async function marcarVisto"),avisos.indexOf("export async function enterarComentario"));
  assert.match(fuente,/INSERT INTO aviso_vistos/);
  assert.doesNotMatch(fuente,/INSERT OR IGNORE INTO agenda_lecturas/);
  assert.match(avisos,/confirmar_ampliacion !== true/);
  assert.match(agenda,/confirmar_ampliacion: c\.confirmar_ampliacion === true/);
  assert.match(server,/confirmar_ampliacion: c\.confirmar_ampliacion === true/);
  assert.match(panel,/Ampliar destinatarios/);
  assert.match(turno,/Ampliar destinatarios/);
  assert.match(panel,/pendienteEnterado/);
});

test("El feed de turno filtra autorizados ANTES del límite y pagina sin repetir",async()=>{
  const a=server.indexOf("async function paginaAvisosTurno("),b=server.indexOf("// ---------------------------------------------------------------------------\n// Datos que ve el encargado",a);
  assert.ok(a>=0&&b>a);
  const fun=new Function("avisoParaEncargado","normalizarPara","listaFotos","resumenConversaciones",
    server.slice(a,b)+"\nreturn paginaAvisosTurno;")(
      avisoParaEncargado,normalizarPara,()=>[],async (_,list)=>Object.fromEntries(list.map(x=>[x.id,{actividad:x.creado,n:0,nuevos:0}]))
    );
  const rows=Array.from({length:180},(_,i)=>{
    const autorizado=i%3===0;
    return {id:"post-"+String(i).padStart(4,"0")+"-abc",titulo:"Aviso",detalle:"",
      creado:new Date(Date.UTC(2026,9,18,0,0,0)-i*60000).toISOString(),
      estado:"activo",autor:"admin",fecha:null,para:JSON.stringify({todos:false,admin:true,turnos:[],personas:[autorizado?"JESC":"ERI"]})};
  });
  const db={prepare(sql){return{bind(...args){this.args=args;return this;},async all(){
    if(sql.includes("FROM agenda_lecturas"))return {results:[]};
    if(!sql.includes("FROM agenda_items"))throw Error("SQL inesperado: "+sql);
    const creado=this.args.length>2?this.args[1]:null,id=this.args.length>2?this.args[3]:null;
    return {results:rows.filter(x=>!creado||x.creado<creado||(x.creado===creado&&x.id<id)).slice(0,120)};
  }};}};
  const env={DB:db},s={persona:"JESC",turno:"NOCHE"},hoy="2026-10-18";
  const primera=await fun(env,s,hoy,"",50);
  assert.equal(primera.avisos.length,50);
  assert.equal(primera.mas,true);
  assert.ok(primera.avisos.every(x=>x.para.personas.includes("JESC")));
  const segunda=await fun(env,s,hoy,primera.cursor,25);
  assert.equal(segunda.avisos.length,10);
  assert.equal(segunda.mas,false);
  const ids=[...primera.avisos,...segunda.avisos].map(x=>x.id);
  assert.equal(new Set(ids).size,60);
  assert.equal(rows.filter(x=>JSON.parse(x.para).personas.includes("JESC")).length,60);
});

test("Panel y turno tienen API paginada, protección de fotografías y flujo de prueba",()=>{
  assert.match(agenda,/partes\[1\] === "avisos-feed"/);
  assert.match(agenda,/return feedCastagramAdmin\(env, url,/);
  const feed = readFileSync(new URL("../src/agenda-feed.js", import.meta.url), "utf8");
  assert.match(feed,/ORDER BY creado DESC,id DESC LIMIT 26/);
  assert.match(server,/partes\[1\] === "pagina"/);
  assert.match(panel,/data-casta-mas/);
  assert.match(turno,/data-casta-mas/);
  assert.match(server,/private, no-store/);
  assert.match(css,/safe-area-inset/);
  assert.match(css,/prefers-reduced-motion/);
});
