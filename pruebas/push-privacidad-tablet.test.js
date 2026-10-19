import test from "node:test";
import assert from "node:assert/strict";
import { datosPush } from "../src/push.js";

test("A-01: notificaciones compartidas sin textos originales", () => {
  const original = { titulo: "Marcador Alfa", cuerpo: "Marcador Beta", url: "/turno?dato=MarcadorGamma", etiqueta: "tarea-MarcadorDelta", sec: "avisos", grave: true };
  const resultado = datosPush("tablet", original);
  for (const marca of ["Alfa", "Beta", "Gamma", "Delta"]) {
    assert.equal(JSON.stringify(resultado).includes(marca), false);
  }
  assert.equal(resultado.url, "/turno?sec=avisos");
  assert.equal(resultado.etiqueta, null);
  assert.equal(resultado.grave, true);
  assert.match(resultado.cuerpo, /PIN/);
});

test("A-01: los avisos del administrador mantienen su texto", () => {
  const original = { titulo: "Ejemplo", cuerpo: "Detalle", url: "/panel", etiqueta: "uno", sec: "tarea", grave: false };
  assert.deepEqual(datosPush("admin", original), original);
});

test("A-01: las secciones desconocidas no se transmiten", () => {
  const resultado = datosPush("tablet", { sec: "MarcadorExtra", url: "/turno?dato=MarcadorExtra" });
  assert.equal(resultado.sec, null);
  assert.equal(resultado.url, "/turno");
});
