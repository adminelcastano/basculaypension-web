import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
// Extraer la función real sin importar HTML empaquetado por Wrangler en Node.
const fuente = readFileSync(new URL("../src/reporte.js", import.meta.url), "utf8");
const cuerpo = fuente.split("export async function reporteArea(env, tipo, mes, h) {")[1]
  ?.split("\n// Los tres reportes")[0]?.replace(/\n}\s*$/, "");
assert.ok(cuerpo, "No se encontró reporteArea");
const reporteArea = new Function("TIPOS_REPORTE", "hojasTurnos", "hojasFinanzas", "hojasFacturacion",
  "return async function reporteArea(env, tipo, mes, h) {" + cuerpo + "\n}")(
    {facturacion:"Facturación"},
    async()=>[], async()=>[], async()=>[{nombre:"Resumen",filas:[["dato"]]}]
  );

const panel = readFileSync(new URL("../src/panel/cliente/06-inicio.js", import.meta.url), "utf8");

function falsoEntorno(guardar) {
  const DB = { prepare: () => ({ bind: () => ({ all: async () => ({ results: [] }) }) }) };
  return { DB, FILES: { put: guardar } };
}
const script = async () => ({
  ok: true, destino: "facturacion", id: "sintetico-sheets",
  url: "https://ejemplo.invalid/reporte", pendientes_archivar: 2
});
const handler = { script, filasFacturas: () => [] };

test("si la hoja de Sheets se creó pero KV falla, no ordenar crear otra hoja por error", async () => {
  const env = falsoEntorno(async () => { throw Error("fallo-kv-sintetico"); });
  const anterior = console.error;
  console.error = () => {};
  try {
    const r = await reporteArea(env,"facturacion","2026-10",handler);
    assert.equal(r.id,"sintetico-sheets");
    assert.equal(r.indice_pendiente,true);
    assert.equal(r.pendientes_archivar,2);
  } finally { console.error = anterior; }
});

test("si el índice KV funciona, no informa un fallo inexistente", async () => {
  let clave = null, datos = null;
  const env = falsoEntorno(async (k,v) => { clave=k; datos=JSON.parse(v); });
  const r = await reporteArea(env,"facturacion","2026-10",handler);
  assert.equal(clave,"rep:facturacion:2026-10");
  assert.equal(datos.pendientes_archivar,2);
  assert.equal(r.indice_pendiente,undefined);
});

test("si Apps Script no creó la hoja, continúa siendo un error de creación", async () => {
  const env = falsoEntorno(async () => {});
  await assert.rejects(
    reporteArea(env,"facturacion","2026-10",{...handler,script:async()=>({ok:false,error:"hoja no creada"})}),
    /hoja no creada/
  );
});

test("el Panel diferencia copias KV, versiones pendientes y archivos sin índice", () => {
  assert.match(panel,/versiones_conservadas/);
  assert.match(panel,/versiones_pendientes/);
  assert.match(panel,/versiones_sin_indice/);
  assert.match(panel,/pendientes_borrar/);
  assert.match(panel,/en_kv_truncado/);
  assert.doesNotMatch(panel,/a\.en_kv \? .*esperando para subir/);
});
