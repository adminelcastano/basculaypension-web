import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const file = p => readFileSync(new URL(p, import.meta.url), "utf8");
const avisos = file("../src/avisos.js");
const agenda = file("../src/agenda.js");
const turno = file("../src/turno.js");
const panel = file("../src/panel/cliente/07-agenda.js");
const tablet = file("../src/turno.html");

test("Enterado de comentario es un recibo idempotente y confirma el post", async () => {
  const begin = avisos.indexOf("export async function enterarComentario(");
  const end = avisos.indexOf("// ¿Puede esta persona ver", begin);
  assert.ok(begin > 0 && end > begin, "Función de Enterado localizable");
  const enterar = new Function("asegurarEsquemaAvisos",
    avisos.slice(begin,end).replace("export async function","async function") +
    "\nreturn enterarComentario;") (async()=>{});
  const registros = new Set(), post = new Set(), vistos = new Set();
  const sqls = [];
  const db = {
    prepare(sql) {
      return {
        bind(...args) {
          const op = {
            async first() {
              if (sql.includes("FROM aviso_comentarios")) return args[0]==="c-1" && args[1]==="post-1" ? {id:"c-1"} : null;
              if (sql.includes("COUNT(*)")) return {total:[...registros].filter(v=>v.startsWith(args[0]+"|")).length};
              throw Error("Consulta inesperada: "+sql);
            },
            async run() {
              sqls.push(sql);
              if (sql.includes("INSERT OR IGNORE INTO aviso_com_enterados")) registros.add(args[0]+"|"+args[1]);
              if (sql.includes("INSERT OR IGNORE INTO agenda_lecturas")) post.add(args[0]+"|"+args[1]);
              if (sql.includes("INSERT INTO aviso_vistos")) vistos.add(args[0]+"|"+args[1]);
            }
          };
          return op;
        }
      };
    },
    async batch(ops) { for(const op of ops) await op.run(); }
  };
  const env = { DB:db }, item = { id:"post-1", tipo:"aviso", estado:"activo" };
  assert.deepEqual(await enterar(env,item,"c-1","JESC"), {
    comentario_id:"c-1",enterados:1,mi_enterado:true,post_enterado:true
  });
  await enterar(env,item,"c-1","JESC");
  assert.equal(registros.size,1);
  assert.equal(post.size,1);
  assert.equal(vistos.size,1);
  const segunda=await enterar(env,item,"c-1","ERI");
  assert.equal(segunda.enterados,2);
  await assert.rejects(enterar(env,item,"c-ajeno","JESC"),/no está disponible/i);
  await assert.rejects(enterar(env,{...item,estado:"archivado"},"c-1","JESC"),/ya no está disponible/i);
  assert.equal(sqls.filter(x=>x.includes("INSERT OR IGNORE INTO aviso_com_enterados")).length,3);
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
