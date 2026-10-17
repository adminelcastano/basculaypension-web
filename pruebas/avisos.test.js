// Pruebas de los avisos como publicaciones (sin base de datos): node --test pruebas/
import { test } from "node:test";
import assert from "node:assert/strict";
import { menciones, etiquetasNuevas, contarNuevos, textoLargo, autorDe } from "../src/avisos.js";

test("menciones: solo las claves que existen, sin repetir", () => {
  assert.deepEqual(menciones("Hola @ana y @LUIS, también @nadie y @Ana", ["ANA", "LUIS", "PEDRO"]), ["ANA", "LUIS"]);
  assert.deepEqual(menciones("sin etiquetas", ["ANA"]), []);
});

test("etiquetas nuevas: no repite a quien ya lo ve ni al autor; con «todos» no agrega a nadie", () => {
  const claves = ["ANA", "LUIS", "PEDRO"];
  assert.deepEqual(etiquetasNuevas({ admin: true, personas: ["ANA"] }, ["ana", "LUIS", "ZOE", "PEDRO"], claves, "PEDRO"), ["LUIS"]);
  assert.deepEqual(etiquetasNuevas({ todos: true }, ["LUIS"], claves, "admin"), []);
  assert.deepEqual(etiquetasNuevas(JSON.stringify({ turnos: ["TARDE"] }), ["LUIS"], claves, "admin"), ["LUIS"]);
});

test("comentarios nuevos: de otros, después de la última vista y sin contar los borrados", () => {
  const l = [
    { autor: "admin", creado: "2026-10-16T10:00:00Z" },
    { autor: "ANA", creado: "2026-10-16T11:00:00Z" },
    { autor: "LUIS", creado: "2026-10-16T12:00:00Z", borrado: "2026-10-16T12:05:00Z" },
    { autor: "LUIS", creado: "2026-10-16T13:00:00Z" }
  ];
  assert.equal(contarNuevos(l, "ANA", "2026-10-16T10:30:00Z"), 1);
  assert.equal(contarNuevos(l, "ANA", null), 2);
  assert.equal(contarNuevos(l, "admin", "2026-10-16T09:00:00Z"), 2);
});

test("texto de comentario: conserva saltos de línea y recorta", () => {
  assert.equal(textoLargo("  hola \r\n\n\n\n  mundo  ", 100), "hola\n\nmundo");
  assert.equal(textoLargo("x".repeat(20), 5), "xxxxx");
  assert.equal(autorDe("ADMIN"), "admin");
  assert.equal(autorDe("ana"), "ANA");
});

test("fotografías de Castagram: solo destinatarios y publicaciones activas", async () => {
  const { fotoAvisoPermitida } = await import("../src/avisos.js");
  const privado = { autor: "admin", para: { todos: false, admin: false, turnos: [], personas: ["ANA"] }, estado: "activo" };
  assert.equal(fotoAvisoPermitida(privado, "ANA", "MAÑANA"), true);
  assert.equal(fotoAvisoPermitida(privado, "LUIS", "MAÑANA"), false);
  assert.equal(fotoAvisoPermitida(privado, "ANA", "MAÑANA", true), false);
  assert.equal(fotoAvisoPermitida({ ...privado, estado: "archivado" }, "ANA", "MAÑANA"), false);
  assert.equal(fotoAvisoPermitida(null, "ANA", "MAÑANA"), false);
});
