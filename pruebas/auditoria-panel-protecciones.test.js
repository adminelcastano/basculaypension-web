import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { leerHoja } from "../src/caja.js";

async function lecturaSimulada(datos, status = 200) {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify(datos), {
    status, headers: { "Content-Type": "application/json" }
  });
  try {
    return await leerHoja({ INGRESOS_URL: "https://example.test/exec", INGRESOS_TOKEN: "simulado" }, "2026-10");
  } finally {
    globalThis.fetch = original;
  }
}

test("Caja: JSON incompleto no se interpreta como tickets borrados", async () => {
  await assert.rejects(lecturaSimulada({ ok: true, bascula: [] }), /incompletos/);
  await assert.rejects(lecturaSimulada({ ok: true, pension: [] }), /incompletos/);
  await assert.rejects(lecturaSimulada({ ok: true, bascula: null, pension: [] }), /incompletos/);
});

test("Caja: hoja vacía pero completa se acepta como fuente definitiva", async () => {
  assert.deepEqual(await lecturaSimulada({ ok: true, mes: "2026-10", bascula: [], pension: [] }), []);
});

test("Caja: no reconcilia un mes distinto o una respuesta sin mes", async () => {
  await assert.rejects(lecturaSimulada({ ok: true, mes: "2026-09", bascula: [], pension: [] }), /mes diferente/);
  await assert.rejects(lecturaSimulada({ ok: true, bascula: [], pension: [] }), /mes diferente/);
});

test("Caja: no reconcilia filas incompletas ni fechas ajenas al mes pedido", async () => {
  const base = { ok: true, mes: "2026-10", pension: [] };
  await assert.rejects(lecturaSimulada({ ...base, bascula: [{ fecha: "mal" }] }), /inválidos/);
  await assert.rejects(lecturaSimulada({ ...base, bascula: [{ fecha: "2026-09-30T21:45:00" }] }), /inválidos/);
  await assert.rejects(lecturaSimulada({ ...base, bascula: [null] }), /inválidos/);
});

test("Caja: respuesta HTTP errónea no autoriza conciliación", async () => {
  await assert.rejects(lecturaSimulada({ ok: true, mes: "2026-10", bascula: [], pension: [] }, 503), /rechazó/);
});

test("Personal: no existe la eliminación definitiva del expediente", () => {
  const backend = readFileSync(new URL("../src/personal.js", import.meta.url), "utf8");
  const cliente = readFileSync(new URL("../src/panel/cliente/02-personal.js", import.meta.url), "utf8");
  assert.doesNotMatch(backend, /DELETE FROM colaboradores WHERE id =/);
  assert.match(backend, /No se eliminan fichas históricas/);
  assert.match(backend, /UPDATE colaboradores SET estatus =/);
  assert.doesNotMatch(cliente, /id="p-eliminar(?:-top)?"/);
  assert.match(cliente, /id="p-baja-abrir"/);
});

test("Facturas: no se escribe contenido de respuestas IA en logs", () => {
  const worker = readFileSync(new URL("../src/worker.js", import.meta.url), "utf8");
  assert.doesNotMatch(worker, /console\.log\("ticket sin json",\s*texto/);
});

test("Hoy: fuentes fallidas no mantienen importes o gráficas anteriores", () => {
  const panel = readFileSync(new URL("../src/panel/cliente/06-inicio.js", import.meta.url), "utf8");
  const inicio = panel.indexOf("function limpiarFuenteHoy(tipo)");
  const fin = panel.indexOf("const tip =", inicio);
  assert.ok(inicio >= 0 && fin > inicio);
  const limpiar = panel.slice(inicio, fin);
  for (const fuente of ["facturas", "personal", "caja", "agenda", "pagos", "finanzas", "calendario"])
    assert.match(limpiar, new RegExp(fuente + ":\\s*\\{"));
  assert.match(panel, /if \(F\.pagos\) pintarPagos\(F\.pagos\); else limpiarFuenteHoy\("pagos"\)/);
  assert.match(panel, /if \(F\.finanzas\) pintarFinanzas\(F\.finanzas\); else limpiarFuenteHoy\("finanzas"\)/);
  assert.match(panel, /if \(F\.calendario\) pintarCalendario\(F\.calendario\); else limpiarFuenteHoy\("calendario"\)/);
  assert.match(panel, /generaciones\.get\(el\) !== gen/);
});

test("Panel administrativo: el JavaScript de las secciones editadas tiene sintaxis válida", () => {
  for (const archivo of ["01-facturacion.js", "02-personal.js", "03-caja.js", "05-finanzas.js", "06-inicio.js"]) {
    const fuente = readFileSync(new URL("../src/panel/cliente/" + archivo, import.meta.url), "utf8");
    assert.doesNotThrow(() => new Function(fuente), archivo);
  }
});
