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
  assert.deepEqual(await lecturaSimulada({ ok: true, bascula: [], pension: [] }), []);
});

test("Caja: respuesta HTTP errónea no autoriza conciliación", async () => {
  await assert.rejects(lecturaSimulada({ ok: true, bascula: [], pension: [] }, 503), /rechazó/);
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
