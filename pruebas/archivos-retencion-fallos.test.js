// Contratos de persistencia. Preparados para la pasada de pruebas final; no ejecutados todavía.
import test from "node:test";
import assert from "node:assert/strict";
import { guardarArchivo } from "../src/fotos.js";

function entorno({ anterior = "drive-previo", fallaKV = false, fallaD1 = false, conGoogle = false } = {}) {
  const acciones = [];
  const db = {
    batch: async () => {},
    prepare(sql) {
      return {
        bind(...params) { this.params = params; return this; },
        async first() { return sql.startsWith("SELECT drive_id FROM archivos")
          ? (anterior ? { drive_id: anterior } : null) : null; },
        async run() {
          if (sql.includes("INSERT INTO archivos")) {
            acciones.push("registrar-drive");
            if (fallaD1) throw Error("fallo-d1");
          } else if (sql.includes("DELETE FROM archivos")) acciones.push("borrar-referencia-anterior");
        }
      };
    }
  };
  const files = {
    async put() { acciones.push("guardar-kv"); if (fallaKV) throw Error("fallo-kv"); },
    async delete() { acciones.push("borrar-kv"); }
  };
  return { env: { DB: db, FILES: files, ...(conGoogle ? {AVISO_URL:"https://ejemplo.invalid/exec",AVISO_TOKEN:"simulado"} : {}) }, acciones };
}
test("respaldo: si KV falla conserva referencia y no manda Drive antiguo a papelera", async () => {
  const {env,acciones}=entorno({fallaKV:true});
  await assert.rejects(guardarArchivo(env,"f:ensayo:ticket",new Uint8Array([1,2,3])),/fallo-kv/);
  assert.deepEqual(acciones,["guardar-kv"]);
});
test("respaldo: confirmar KV mantiene la referencia anterior hasta la migración", async () => {
  const {env,acciones}=entorno();
  const r=await guardarArchivo(env,"f:ensayo:ticket",new Uint8Array([1,2,3]));
  assert.equal(r.drive,false);
  assert.deepEqual(acciones,["guardar-kv"]);
});
test("respaldo: fallo de índice tras subir a Drive no retira copia anterior", async () => {
  const {env,acciones}=entorno({fallaD1:true,conGoogle:true});
  const anteriorFetch=globalThis.fetch;
  globalThis.fetch=async()=>({text:async()=>JSON.stringify({ok:true,id:"drive-nuevo"})});
  try {
    const r=await guardarArchivo(env,"f:ensayo:ticket",new Uint8Array([1,2,3]));
    assert.equal(r.drive,false);
    assert.deepEqual(acciones,["registrar-drive","guardar-kv"]);
  } finally { globalThis.fetch=anteriorFetch; }
});
