import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const fuente = path => readFileSync(new URL("../"+path, import.meta.url), "utf8");
test("Compras pendientes residen en Agenda sin duplicar contenedores", () => {
  const html=fuente("src/panel/pagina.html");
  const fin=html.split('id="mod-finanzas"')[1].split('id="mod-agenda"')[0];
  const ag=html.split('id="mod-agenda"')[1].split('id="mod-config"')[0];
  assert.ok(!fin.includes('id="pg-comp"'));
  assert.ok(ag.includes('id="pg-comp"'));
  assert.equal((html.match(/id="pg-comp"/g)||[]).length,1);
  const script=fuente("src/panel/cliente/07-agenda.js");
  assert.ok(script.includes('compra: ["agenda", "compras", "pg-comp"]'));
  assert.ok(script.includes('EC.bloqueN("agenda", "compras"'));
});
test("Los enlaces antiguos a compras redirigen a Agenda",()=>{
  const base=fuente("src/panel/cliente/00-base.js");
  const navegacion=fuente("src/panel/cliente/02-personal.js");
  assert.ok(base.includes('if (v === "compras") return { mod: "agenda", vista: "compras" }'));
  assert.ok(navegacion.includes('mod === "finanzas" && opciones.vista === "compras"'));
});
