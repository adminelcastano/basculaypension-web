// Contratos de persistencia con datos ficticios. Preparados, NO ejecutados.
import test from "node:test";
import assert from "node:assert/strict";
import { guardarArchivo, leerArchivo } from "../src/fotos.js";

function entorno({ fallaKV = false, fallaD1 = false, conGoogle = false, actual = null,
  resultadoCaducado = false, eliminado = false, publicacionRechazada = false } = {}) {
  const eventos = [], claves = [];
  const DB = {
    async batch(stmts) {
      // La creación del esquema es preparación, no una operación de escritura de archivos.
      if (stmts.every(x => /^(CREATE |UPDATE archivos SET vence)/.test(x.sql)))
        return stmts.map(() => ({ meta: { changes: 1 } }));
      eventos.push("d1-batch");
      if (fallaD1 && stmts.some(x => /INSERT INTO archivos_copias/.test(x.sql))) throw Error("fallo-d1");
      return stmts.map((_, i) => ({ meta: { changes:
        i === 1 && ((resultadoCaducado && stmts.length > 3) || (publicacionRechazada && stmts.length === 3)) ? 0 : 1
      } }));
    },
    prepare(sql) {
      return {
        sql,
        bind(...args) { this.args = args; return this; },
        async first() {
          if (/AS kv_llave/.test(sql) && /AS eliminado_at/.test(sql))
            return { kv_llave: actual?.kv_llave || null, eliminado_at: eliminado ? "2026-10-19T00:00:00Z" : null };
          if (/FROM archivos_actual/.test(sql)) return actual;
          if (/FROM archivos_eliminados/.test(sql)) return eliminado ? { existe: 1 } : null;
          if (/FROM archivos WHERE/.test(sql)) return { drive_id: "drive-anterior", tipo: "image/jpeg", nombre: "foto.jpg" };
          return null;
        },
        async all() { return { results: [] }; },
        async run() { return { meta: { changes: 1 } }; }
      };
    }
  };
  const FILES = {
    async put(llave, bytes, opts) {
      eventos.push("kv-put");
      if (fallaKV) throw Error("fallo-kv");
      claves.push({ llave, bytes, opts });
    },
    async delete() { eventos.push("kv-delete"); },
    async getWithMetadata(llave) {
      eventos.push("kv-get:" + llave);
      if (actual && llave === actual.kv_llave) return { value: new Uint8Array([9, 8]).buffer, metadata: { tipo: "image/jpeg" } };
      if (llave === "f:ensayo:ticket") return { value: new Uint8Array([1, 2]).buffer, metadata: { tipo: "image/jpeg" } };
      return { value: null, metadata: null };
    }
  };
  const env = { DB, FILES, ...(conGoogle ? { AVISO_URL: "https://ejemplo.invalid/exec", AVISO_TOKEN: "simulado" } : {}) };
  return { env, eventos, claves };
}

test("un fallo de KV no publica otra versión ni retira Drive anterior", async () => {
  const x = entorno({ fallaKV: true });
  await assert.rejects(guardarArchivo(x.env, "f:ensayo:ticket", new Uint8Array([1, 2, 3]), { soloKV: true }), /fallo-kv/);
  assert.deepEqual(x.eventos, ["kv-put"]);
});

test("un fallo de D1 conserva la copia inmutable recién escrita en KV", async () => {
  const x = entorno({ fallaD1: true });
  await assert.rejects(guardarArchivo(x.env, "f:ensayo:ticket", new Uint8Array([1, 2, 3]), { soloKV: true }), /fallo-d1/);
  assert.deepEqual(x.eventos, ["kv-put", "d1-batch"]);
  assert.match(x.claves[0].llave, /^fv:f:ensayo:ticket:/);
  assert.ok(!x.eventos.includes("kv-delete"));
});

test("dos escrituras de la misma llave lógica generan versiones físicas distintas", async () => {
  const x = entorno();
  const a = await guardarArchivo(x.env, "f:ensayo:ticket", new Uint8Array([1, 2, 3]), { soloKV: true });
  const b = await guardarArchivo(x.env, "f:ensayo:ticket", new Uint8Array([4, 5, 6]), { soloKV: true });
  assert.equal(a.drive, false);
  assert.equal(b.drive, false);
  assert.notEqual(x.claves[0].llave, x.claves[1].llave);
  assert.deepEqual(x.eventos, ["kv-put", "d1-batch", "kv-put", "d1-batch"]);
});

test("KV no vence una copia pendiente de subir a Drive", async () => {
  const x = entorno();
  await guardarArchivo(x.env, "f:ensayo:ticket", new Uint8Array([1, 2, 3]), { ttlDias: 1, soloKV: true });
  assert.equal(x.claves[0].opts.expirationTtl, undefined);
});

test("Drive puede confirmar sin borrar KV ni Drive anterior", async () => {
  const x = entorno({ conGoogle: true });
  const anterior = globalThis.fetch;
  globalThis.fetch = async () => ({ text: async () => JSON.stringify({ ok: true, id: "drive-nuevo" }) });
  try {
    const r = await guardarArchivo(x.env, "f:ensayo:ticket", new Uint8Array([1, 2, 3]));
    assert.equal(r.drive, true);
    assert.deepEqual(x.eventos, ["kv-put", "d1-batch", "d1-batch"]);
    assert.ok(!x.eventos.includes("kv-delete"));
  } finally { globalThis.fetch = anterior; }
});

test("un reintento viejo no confirma una versión desplazada por otra", async () => {
  const x = entorno({ conGoogle: true, resultadoCaducado: true });
  const anterior = globalThis.fetch;
  globalThis.fetch = async () => ({ text: async () => JSON.stringify({ ok: true, id: "drive-viejo" }) });
  try {
    const r = await guardarArchivo(x.env, "f:ensayo:ticket", new Uint8Array([1, 2, 3]));
    assert.equal(r.drive, false);
    assert.ok(!x.eventos.includes("kv-delete"));
  } finally { globalThis.fetch = anterior; }
});

test("leer prioriza el puntero de versión D1 frente a KV legado", async () => {
  const version = { kv_llave: "fv:f:ensayo:ticket:vigente", drive_id: null, tipo: "image/jpeg", nombre: "vigente.jpg" };
  const x = entorno({ actual: version });
  const r = await leerArchivo(x.env, "f:ensayo:ticket");
  assert.deepEqual([...new Uint8Array(r.value)], [9, 8]);
  assert.equal(r.metadata.nombre, "vigente.jpg");
  assert.ok(!x.eventos.includes("kv-get:f:ensayo:ticket"));
});

test("sin nuevo puntero sigue leyendo archivos legados", async () => {
  const x = entorno();
  const r = await leerArchivo(x.env, "f:ensayo:ticket");
  assert.deepEqual([...new Uint8Array(r.value)], [1, 2]);
});

test("un archivo eliminado no reaparece desde KV legado por consistencia eventual", async () => {
  const x = entorno({ eliminado: true });
  const r = await leerArchivo(x.env, "f:ensayo:ticket");
  assert.equal(r.value, null);
  assert.ok(!x.eventos.includes("kv-get:f:ensayo:ticket"));
});

test("una carga obsoleta rechaza publicar su puntero sin borrar la copia KV", async () => {
  const x = entorno({ publicacionRechazada: true });
  await assert.rejects(
    guardarArchivo(x.env, "f:ensayo:ticket", new Uint8Array([1, 2, 3]), { soloKV: true }),
    /Otra operación modificó/
  );
  assert.equal(x.claves.length, 1);
  assert.ok(!x.eventos.includes("kv-delete"));
});

test("si una eliminación gana la carrera, una carga anterior no la puede reabrir", async () => {
  const x = entorno({ eliminado: true, publicacionRechazada: true });
  await assert.rejects(
    guardarArchivo(x.env, "f:ensayo:ticket", new Uint8Array([1, 2, 3]), { soloKV: true }),
    /Otra operación modificó/
  );
  assert.ok(!x.eventos.includes("kv-delete"));
});
