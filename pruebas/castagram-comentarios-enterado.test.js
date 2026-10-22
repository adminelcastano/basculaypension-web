import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const file = p => readFileSync(new URL(p, import.meta.url), "utf8");
const avisos = file("../src/avisos.js");
const agenda = file("../src/agenda.js");
const turno = file("../src/turno.js");
const panel = file("../src/panel/cliente/07-agenda.js") + "\n" + file("../src/panel/cliente/07-castagram-controlador.js");
const tablet = file("../src/turno.html");

test("Me gusta es reversible, idempotente y conserva el Enterado del post", async () => {
  const begin = avisos.indexOf("export async function enterarComentario(");
  const end = avisos.indexOf("// ¿Puede esta persona ver", begin);
  assert.ok(begin > 0 && end > begin, "Función de Me gusta localizable");
  const historial = [];
  const stubHistorial = (_env, post, persona, accion, detalle) =>
    ({ async run() { historial.push({post, persona, accion, detalle}); } });
  const enterar = new Function("asegurarEsquemaAvisos","stmtHistorial",
    avisos.slice(begin,end).replace("export async function","async function") +
    "\nreturn enterarComentario;") (async()=>{},stubHistorial);
  const registros = new Map(), post = new Set(), vistos = new Set();
  const sqls = [];
  const db = {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async first() {
              if (sql.includes("FROM aviso_comentarios"))
                return args[0]==="c-1" && args[1]==="post-1" ? {id:"c-1"} : null;
              if (sql.includes("SELECT at, quitado FROM aviso_com_enterados"))
                return registros.get(args[0]+"|"+args[1]) || null;
              if (sql.includes("COUNT(*)"))
                return {total:[...registros].filter(([k,v])=>k.startsWith(args[0]+"|") && !v.quitado).length};
              throw Error("Consulta inesperada: "+sql);
            },
            async run() {
              sqls.push(sql);
              if (sql.includes("INSERT INTO aviso_com_enterados")) {
                const clave=args[0]+"|"+args[1];
                if (registros.has(clave)) registros.get(clave).quitado=null;
                else registros.set(clave,{at:args[2],quitado:null});
              }
              if (sql.includes("UPDATE aviso_com_enterados SET quitado")) {
                const prev=registros.get(args[1]+"|"+args[2]);
                if(prev && !prev.quitado)prev.quitado=args[0];
              }
              if (sql.includes("INSERT OR IGNORE INTO agenda_lecturas")) post.add(args[0]+"|"+args[1]);
              if (sql.includes("INSERT INTO aviso_vistos")) vistos.add(args[0]+"|"+args[1]);
            }
          };
        }
      };
    },
    async batch(ops) { for(const op of ops) await op.run(); }
  };
  const env = { DB:db }, item = { id:"post-1", tipo:"aviso", estado:"activo" };
  assert.deepEqual(await enterar(env,item,"c-1","JESC"), {
    comentario_id:"c-1",enterados:1,mi_enterado:true,post_enterado:true
  });
  assert.equal((await enterar(env,item,"c-1","JESC")).enterados,1);
  assert.equal(historial.length,1,"Repetir la misma petición no registra doble");
  const sinLike=await enterar(env,item,"c-1","JESC",new Date().toISOString(),false);
  assert.deepEqual(sinLike,{comentario_id:"c-1",enterados:0,mi_enterado:false,post_enterado:false});
  assert.equal(post.size,1,"Quitar like no revoca constancia Enterado del post");
  assert.equal(registros.size,1,"Like retirado no borra la fila histórica");
  assert.ok(registros.get("c-1|JESC").quitado);
  assert.equal((await enterar(env,item,"c-1","JESC",new Date().toISOString(),false)).enterados,0);
  assert.equal(historial.length,2);
  assert.equal((await enterar(env,item,"c-1","JESC")).enterados,1);
  assert.equal(registros.size,1);
  assert.equal(historial.length,3);
  assert.equal((await enterar(env,item,"c-1","ERI")).enterados,2);
  assert.equal(post.size,2);
  assert.equal(vistos.size,2);
  assert.deepEqual(historial.map(x=>x.accion),
    ["like-comentario","quitar-like-comentario","like-comentario","like-comentario"]);
  await assert.rejects(enterar(env,item,"c-ajeno","JESC"),/no está disponible/i);
  await assert.rejects(enterar(env,{...item,estado:"archivado"},"c-1","JESC"),/ya no está disponible/i);
  await assert.rejects(enterar(env,item,"c-1","JESC",new Date().toISOString(),"false"),/Reacción inválida/);
  assert.ok(!sqls.some(x=>/DELETE FROM agenda_lecturas|DELETE FROM aviso_com_enterados/.test(x)));
});

test("Al comentar se genera Enterado servidor; abrir solo escribe Visto",()=>{
  assert.match(avisos,/INSERT OR IGNORE INTO agenda_lecturas \(item_id, persona, at\)/);
  const leer=avisos.slice(avisos.indexOf("export async function marcarVisto("),avisos.indexOf("export async function enterarComentario("));
  assert.doesNotMatch(leer,/INSERT OR IGNORE INTO agenda_lecturas/);
  for(const server of [agenda,turno]){
    assert.match(server,/enterarComentario\(/);
    assert.match(server,/post_enterado:\s*true/);
    assert.match(server,/comentarios/);
  }
  assert.match(avisos,/CREATE TABLE IF NOT EXISTS aviso_com_enterados/);
});

test("Ambos clientes muestran Enterado por comentario sin afirmarlo en fallos de red",()=>{
  for(const ui of [panel,tablet]){
    assert.match(ui,/data-com-enterado=/);
    assert.match(ui,/c\.mi_enterado/);
    assert.match(ui,/c\.enterados/);
    assert.match(ui,/aria-pressed/);
    assert.match(ui,/post_enterado/);
    assert.match(ui,/casta-com-enterado/);
  }
  assert.match(tablet,/cola:false/);
  assert.match(tablet,/if\(E!==sesion \|\| hilos\[id\]!==h\)return/);
  const css=file("../src/panel/estilos.css");
  assert.match(css,/\.casta-com-enterado/);
  assert.match(tablet,/min-height:44px/);
});
