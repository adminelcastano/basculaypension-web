import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Ejecuta los mismos selectores de cola que la tablet, sin tocar D1 ni KV.
const html = readFileSync(new URL("../src/turno.html", import.meta.url), "utf8");
const inicio = html.indexOf("const leerLS = (");
const fin = html.indexOf("async function api(", inicio);
if (inicio < 0 || fin < inicio) throw new Error("No se encontraron los selectores de cola en turno.html");
const fuente = html.slice(inicio, fin);

function tablet(almacen, persona, turno, dia) {
  const E = { persona, turno, dia };
  const localStorage = {
    getItem: k => almacen.has(k) ? almacen.get(k) : null,
    setItem: (k, v) => almacen.set(k, v),
    removeItem: k => almacen.delete(k)
  };
  return new Function("E", "localStorage", fuente + "\nreturn { colaClave, cola, guardarCola, colaAnterior };")(E, localStorage);
}

test("cola offline separada por encargado, turno y día", () => {
  const almacen = new Map();
  const ana = tablet(almacen, "ANA", "MAÑANA", "2026-10-17");
  const mismoNombreOtroTurno = tablet(almacen, "ANA", "TARDE", "2026-10-17");
  const otraPersona = tablet(almacen, "LUIS", "MAÑANA", "2026-10-17");
  assert.equal(ana.colaClave(), "turno:cola:ANA:MAÑANA:2026-10-17");
  assert.equal(ana.guardarCola([{ persona: "ANA", turno: "MAÑANA", dia: "2026-10-17", ruta: "avisos" }]), true);
  assert.equal(ana.cola().length, 1);
  assert.equal(mismoNombreOtroTurno.cola().length, 0);
  assert.equal(otraPersona.cola().length, 0);
});

test("una cola antigua se detecta sin eliminarla", () => {
  const almacen = new Map([["turno:cola", JSON.stringify([{ ruta: "avisos", persona: "ANA" }])]]);
  const ana = tablet(almacen, "ANA", "MAÑANA", "2026-10-17");
  assert.equal(ana.colaAnterior(), 1);
  assert.equal(ana.cola().length, 0);
  assert.equal(almacen.has("turno:cola"), true);
});
