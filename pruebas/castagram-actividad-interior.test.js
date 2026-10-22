import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const panel = readFileSync(new URL("../src/panel/cliente/07-agenda.js",import.meta.url),"utf8") + "\n" + readFileSync(new URL("../src/panel/cliente/07-castagram-controlador.js",import.meta.url),"utf8");
const turno = readFileSync(new URL("../src/turno.html",import.meta.url),"utf8");
const css = readFileSync(new URL("../src/panel/estilos.css",import.meta.url),"utf8");
function helpers(fuente,inicio,fin,dependencias,cuerpo) {
  const a=fuente.indexOf(inicio),b=fuente.indexOf(fin,a);
  assert.ok(a>=0&&b>a,"Helpers Castagram disponibles");
  return new Function(...dependencias,fuente.slice(a,b)+"\n"+cuerpo);
}
const escape = s=>String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
const adminHelper=helpers(panel,"function castaActividadAdmin()","function vistaAvisos(",["st","abierto","nomDe","esc","ico"],
  "return {eventos:castaActividadAdmin,html:castaActividadVistaAdmin};");
const turnoHelper=helpers(turno,"function castaActividadTurno()","function verAvisos(",["E","nombreDe","esc","svg","cola"],
  "return {eventos:castaActividadTurno,html:castaActividadVistaTurno};");
test("Actividad de administración: publicación, comentario y Enterado son eventos distintos",()=>{
  const items=[
    {id:"a",tipo:"aviso",estado:"activo",autor:"JESC",para:{admin:true},
      titulo:"Nuevo encargo",creado:"2026-10-17T10:00:00Z",lecturas:[],
      conv:{nuevos:1,ultimo:{autor:"JESC",texto:"Aviso",creado:"2026-10-17T11:00:00Z"}}},
    {id:"b",tipo:"aviso",estado:"activo",autor:"admin",para:{personas:["JESC"]},
      titulo:"Llegada importante",creado:"2026-10-17T09:00:00Z",
      lecturas:[{persona:"JESC",at:"2026-10-17T12:00:00Z"}],
      conv:{nuevosEnterado:1,actividad:"2026-10-17T12:00:00Z"}},
    {id:"c",tipo:"tarea",estado:"activo",titulo:"No es Castagram",creado:"2026-10-17T13:00:00Z",conv:{nuevos:4}},
    {id:"d",tipo:"aviso",estado:"archivado",titulo:"Archivada",creado:"2026-10-17T14:00:00Z",conv:{nuevos:5}}
  ];
  const h=adminHelper({items},x=>x.estado==="activo",n=>n,escape,()=>'<svg></svg>');
  const events=h.eventos();
  assert.equal(events.length,3);
  assert.deepEqual(events.map(e=>e.tipo),["enterado","comentario","publicacion"]);
  assert.match(events[0].mensaje,/JESC confirmó Enterado/);
  assert.match(events[1].mensaje,/JESC comentó/);
  assert.ok(events.every(x=>x.id==="a"||x.id==="b"));
  assert.match(h.html(),/data-casta-evento="b"/);
});
test("Actividad en tablet: solo publicaciones autorizadas de la sesión PIN",()=>{
  const lista=[
    {id:"1",titulo:"Publicación privada",creado:"2026-10-17T08:00:00Z",leido:false,propio:false,conv:{nuevos:2,ultimo:{autor:"admin",creado:"2026-10-17T09:00:00Z"}}},
    {id:"2",titulo:"Publicación propia",creado:"2026-10-17T07:00:00Z",leido:false,propio:true,conv:{nuevos:0}}
  ];
  const h=turnoHelper({persona:"JESC",avisos:lista},x=>x,escape,()=>"<svg></svg>",()=>[]);
  assert.equal(h.eventos().length,2);
  assert.deepEqual(h.eventos().map(x=>x.id),["1","1"]);
  assert.match(h.html(),/Pendiente de Enterado/);
  assert.doesNotMatch(h.html(),/Publicación propia/);
  assert.doesNotMatch(h.html(),/data-casta-evento="2"/);
});
test("Lista de actividad escapa texto privado y no usa push general",()=>{
  const h=turnoHelper({persona:"JESC",avisos:[{id:"x",titulo:'<img src=x onerror="alert(1)">',leido:false,propio:false,creado:"2026-10-17T07:00:00Z"}]},x=>x,escape,()=>"<svg></svg>",()=>[]);
  const view=h.html();
  assert.ok(view.includes("&lt;img"));
  assert.ok(!view.includes('onerror="alert(1)"'));
  assert.match(view,/aria-label=".*Abrir conversación"/);
});
test("Tocar una actividad abre la conversación, pero no marca Enterado",()=>{
  assert.match(panel,/if \(d\.castaEvento\)[\s\S]{0,500}await abrirHilo\(it\.id, true\)/);
  assert.match(turno,/if \(actividad\)[\s\S]{0,300}mostrarSheetTurno\(id\);[\s\S]{0,100}await abrirHilo\(id\)/);
  const segmento=turno.slice(turno.indexOf("if (actividad) {"),turno.indexOf("if (hb) {",turno.indexOf("if (actividad) {")));
  assert.doesNotMatch(segmento,/enterado|a\.leido\s*=/);
});
test("Contador de actividad en formulario nativo y sin nuevos recursos productivos",()=>{
  assert.match(panel,/<details class="casta-actividad">/);
  assert.match(turno,/<details class="casta-actividad">/);
  assert.match(css,/\.casta-actividad-list/);
  assert.match(turno,/\.casta-actividad-list/);
});
test("Tablet: el contador se actualiza al leer conversación, sin cambiar Enterado",()=>{
  const start=turno.indexOf("async function abrirHilo(id)"),end=turno.indexOf("function repintarPost(",start);
  const section=turno.slice(start,end);
  assert.match(section,/repintarPost\(id\);\s*castaRefrescarActividadTurno\(\)/);
  assert.match(turno,/const abierto = anterior\.open/);
  assert.match(turno,/nuevo\.open = abierto/);
  assert.doesNotMatch(section,/\.leido\s*=\s*true/);
});

test("Actividad de tablet: Enterado confirmado desaparece al actualizar la lista",()=>{
  const inicio=turno.indexOf('} else if (en) {'), fin=turno.indexOf('} else if (rp) {',inicio);
  assert.ok(inicio>=0&&fin>inicio);
  const bloque=turno.slice(inicio,fin);
  const confirmado=bloque.indexOf('if (a) a.leido = true;');
  const refresco=bloque.indexOf('castaRefrescarActividadTurno();', confirmado);
  assert.ok(confirmado>=0&&refresco>confirmado, "la actividad se refresca después de confirmar Enterado");
  assert.ok(bloque.indexOf('if (r.enCola)') < confirmado, "en cola no se presenta como confirmado");
  assert.match(bloque,/repintarPost\(en\.dataset\.enterado\)/);
});

test("Actividad en tablet distingue Enterado en cola de Enterado confirmado",()=>{
  const fuente=turno.slice(turno.indexOf("function castaActividadTurno()"),turno.indexOf("function castaActividadVistaTurno()"));
  assert.match(fuente,/pendiente \? "Enterado pendiente de conexión" : "Pendiente de Enterado"/);
  const lista=[{id:"a",titulo:"Mensaje",creado:"2026-10-17T08:00:00Z",leido:false,propio:false,conv:{nuevos:0}}];
  const estado={persona:"JESC",turno:"MAÑANA",dia:"2026-10-17",avisos:lista};
  const f=new Function("E","cola","nombreDe",fuente+"\nreturn castaActividadTurno();");
  assert.equal(f(estado,()=>[],x=>x)[0].mensaje,"Pendiente de Enterado");
  const otraSesion=[{ruta:"avisos/a/enterado",persona:"OTRA",turno:"MAÑANA",dia:"2026-10-17"}];
  assert.equal(f(estado,()=>otraSesion,x=>x)[0].mensaje,"Pendiente de Enterado");
  const pendiente=[{ruta:"avisos/a/enterado",persona:"JESC",turno:"MAÑANA",dia:"2026-10-17"}];
  assert.equal(f(estado,()=>pendiente,x=>x)[0].mensaje,"Enterado pendiente de conexión");
  estado.avisos[0].leido=true;
  assert.equal(f(estado,()=>pendiente,x=>x).length,0);
  const bloque=turno.slice(turno.indexOf('} else if (en) {'),turno.indexOf('} else if (rp) {'));
  assert.match(bloque,/if \(r\.enCola\)[^\n]+castaRefrescarActividadTurno\(\)/);
});

test("Respuesta fallida conserva la etiqueta Responder en tablet",()=>{
  const inicio=turno.indexOf('const r = await api(\`avisos/\${id}/comentar\`');
  const final=turno.indexOf('sec().addEventListener("keydown"',inicio);
  assert.ok(inicio>=0 && final>inicio);
  const bloque=turno.slice(inicio,final);
  assert.match(bloque,/b\.textContent = h\.responderA \? "Responder" : "Comentar"/);
  assert.match(bloque,/b\.disabled = false/);
});
