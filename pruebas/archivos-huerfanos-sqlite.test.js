// Pruebas de integración locales, con SQLite en memoria y KV simulado.
// No acceden a Cloudflare, Drive ni datos de clientes.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { guardarArchivo, leerArchivo, borrarArchivo, reconciliarVersionesKV, estadoArchivos } from "../src/fotos.js";

const sql = new DatabaseSync(":memory:");
const archivos = new Map();
const SQL = {
  prepare(query) {
    return {
      sql: query, args: [],
      bind(...args) { this.args = args; return this; },
      async run() { const r = sql.prepare(query).run(...this.args); return { meta: { changes: r.changes } }; },
      async first() { return sql.prepare(query).get(...this.args) || null; },
      async all() { return { results: sql.prepare(query).all(...this.args) }; }
    };
  },
  async batch(statements) {
    sql.exec("BEGIN IMMEDIATE");
    try {
      const resultados = statements.map(s => {
        const r = sql.prepare(s.sql).run(...(s.args || []));
        return { meta: { changes: r.changes } };
      });
      sql.exec("COMMIT");
      return resultados;
    } catch(e) { sql.exec("ROLLBACK"); throw e; }
  }
};
const kv = {
  async put(k, value, op) {
    archivos.set(k, { value: value instanceof Uint8Array ? value.slice().buffer :
      value instanceof ArrayBuffer ? value.slice(0) : value, metadata: op?.metadata || {} });
  },
  async get(k, opts) { return archivos.get(k)?.value || null; },
  async delete(k) { archivos.delete(k); },
  async getWithMetadata(k) { const v = archivos.get(k); return v || { value:null, metadata:null }; },
  async list({prefix="", limit=1000, cursor}={}) {
    const keys = [...archivos.keys()].filter(k=>k.startsWith(prefix)).sort();
    const start = cursor ? keys.findIndex(k => k > cursor) : 0;
    const desde = start < 0 ? keys.length : start;
    const pagina = keys.slice(desde, desde+limit);
    const fin = desde+limit >= keys.length;
    return { keys: pagina.map(name=>({name})), list_complete:fin, cursor:fin?null:pagina.at(-1) };
  }
};
const env = { DB: SQL, FILES:kv };
const llave = "f:ensayo:ticket";
const contenido = (...numeros)=>new Uint8Array(numeros);
const vigente = ()=>sql.prepare("SELECT * FROM archivos_actual WHERE llave=?").get(llave);
const sinIndice = ()=>sql.prepare("SELECT COUNT(*) n FROM archivos_huerfanos").get().n;

test("si D1 falla tras guardar KV, no se pierde la versión vigente y el huérfano es detectable", async ()=>{
  await guardarArchivo(env,llave,contenido(1,2,3),{soloKV:true});
  const anterior = vigente();
  const original=SQL.batch;
  let fallado=false;
  SQL.batch=async stmts=>{
    if(!fallado && stmts.some(s=>/INSERT INTO archivos_copias/.test(s.sql))){
      fallado=true;
      throw Error("fallo-d1-intencional");
    }
    return original(stmts);
  };
  try {
    await assert.rejects(guardarArchivo(env,llave,contenido(4,5,6),{soloKV:true}),/fallo-d1-intencional/);
  }finally{SQL.batch=original;}
  assert.equal(vigente().kv_llave,anterior.kv_llave);
  assert.equal((await reconciliarVersionesKV(env)).nuevos,1);
  assert.equal(sinIndice(),1);
  assert.equal((await reconciliarVersionesKV(env)).nuevos,0);
  const estado=await estadoArchivos(env);
  assert.equal(estado.versiones_sin_indice,1);
  assert.deepEqual([...new Uint8Array((await leerArchivo(env,llave)).value)],[1,2,3]);
});

test("una escritura atrasada no reemplaza la versión posterior y conserva la copia para conciliación",async()=>{
  const original=kv.put;
  let traslapado=false;
  kv.put=async(k,b,opts)=>{
    await original(k,b,opts);
    if(!traslapado && b[0]===7) {
      traslapado=true;
      await guardarArchivo(env,llave,contenido(8),{soloKV:true});
    }
  };
  try{
    await assert.rejects(guardarArchivo(env,llave,contenido(7),{soloKV:true}),/Otra operación modificó/);
  }finally{kv.put=original;}
  assert.deepEqual([...new Uint8Array((await leerArchivo(env,llave)).value)],[8]);
  assert.equal((await reconciliarVersionesKV(env)).nuevos,0); // copia indexada, aunque no publicada
});

test("un borrado deja marca persistente y bloquea copias huérfanas antiguas",async()=>{
  await borrarArchivo(env,llave);
  assert.equal(vigente(),undefined);
  assert.ok(sql.prepare("SELECT at FROM archivos_eliminados WHERE llave=?").get(llave)?.at);
  const resultado=await leerArchivo(env,llave);
  assert.equal(resultado.value,null);
  assert.equal((await reconciliarVersionesKV(env)).nuevos,0);
  assert.equal((await estadoArchivos(env)).versiones_sin_indice,0);
});
