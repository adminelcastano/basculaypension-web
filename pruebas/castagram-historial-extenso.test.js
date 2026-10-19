import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { avisoParaEncargado, normalizarPara } from "../src/agenda.js";

const fuente = readFileSync(new URL("../src/turno.js", import.meta.url), "utf8");
const comienzo = fuente.indexOf("async function paginaAvisosTurno(");
const final = fuente.indexOf("// ---------------------------------------------------------------------------\n// Datos que ve el encargado", comienzo);
if (comienzo < 0 || final <= comienzo) throw new Error("No se encontró la paginación real");

const pagina = new Function("avisoParaEncargado", "normalizarPara", "listaFotos", "resumenConversaciones",
  fuente.slice(comienzo, final) + "\nreturn paginaAvisosTurno;")(
    avisoParaEncargado, normalizarPara, () => [],
    async (_env, items) => Object.fromEntries(items.map(it => [it.id, { actividad: it.creado, nuevos: 0, n: 0 }]))
  );

test("A-07: 6000 avisos mezclados se filtran antes de paginar y no se repiten", async () => {
  const total = 6000, vistos = new Set(), filas = [];
  for (let i = 0; i < total; i++) {
    const permitido = i % 80 === 0;
    filas.push({
      id: "post-" + String(i).padStart(6, "0") + "-abc",
      titulo: permitido ? "Autorizado" : "Privado",
      detalle: "", fecha: null, prioridad: "normal",
      creado: new Date(Date.UTC(2026, 9, 18) - i * 60000).toISOString(),
      autor: "admin", estado: "activo",
      para: JSON.stringify({ todos: false, admin: true, turnos: [],
        personas: [permitido ? "ANA" : "LUIS"] })
    });
  }
  let consultas = 0;
  const env = { DB: { prepare(sql) {
    return { bind(...args) {
      return { async all() {
        if (sql.includes("FROM agenda_lecturas")) return { results: [] };
        assert.ok(sql.includes("FROM agenda_items"));
        consultas++;
        const creado = args.length > 2 ? args[1] : null;
        const id = args.length > 2 ? args[3] : null;
        return { results: filas.filter(x => !creado || x.creado < creado ||
          (x.creado === creado && x.id < id)).slice(0, 120) };
      }};
    }};
  }}};
  let cursor = "", mas = true, paginas = 0;
  while (mas && paginas++ < 8) {
    const resultado = await pagina(env, { persona: "ANA", turno: "MAÑANA" }, "2026-10-19", cursor, 25);
    for (const aviso of resultado.avisos) {
      assert.equal(aviso.titulo, "Autorizado");
      assert.ok(!vistos.has(aviso.id));
      vistos.add(aviso.id);
    }
    mas = resultado.mas;
    cursor = resultado.cursor;
  }
  assert.equal(vistos.size, 75);
  assert.equal(mas, false);
  assert.ok(paginas <= 5);
  assert.ok(consultas > 25);
});
