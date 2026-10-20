// Ensayos ficticios de documentos de personal; no ejecutados en esta fase.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../herramientas/aviso-correo.gs", import.meta.url), "utf8");
const body = source.split("function drive(d) {")[1]?.split("\nfunction respuesta(")[0]?.replace(/\n}\s*$/, "");
assert.ok(body, "No se encontró el controlador de Drive");

function ensayo({ fallaCarga = false, fallaIndice = false, existente = false,
  vigenteMasNuevo = false, operacion = "a".repeat(64) } = {}) {
  const acciones = [], properties = new Map([["f_01234567-89ab-4cde-8fab-0123456789ab_ine", "antiguo"]]);
  const marca = "castano-personal-v1:" + operacion;
  const viejo = {
    getId: () => "antiguo", isTrashed: () => false,
    getDateCreated: () => new Date(vigenteMasNuevo ? "2026-10-20T12:00:00Z" : "2026-10-18T12:00:00Z"),
    setTrashed() { acciones.push("borrar-anterior"); }
  };
  const recuperado = {
    getId: () => "recuperado", isTrashed: () => false, getDescription: () => marca,
    getDateCreated: () => new Date("2026-10-19T12:00:00Z")
  };
  const nuevo = {
    getId: () => "nuevo",
    setDescription(v) { acciones.push("marcar-nuevo"); assert.equal(v, marca); },
    setTrashed() { acciones.push("retirar-nuevo"); }
  };
  const carpeta = {
    getFilesByName() {
      acciones.push("buscar-operacion");
      const pendientes = existente ? [recuperado] : [];
      return { hasNext: () => pendientes.length > 0, next: () => pendientes.shift() };
    },
    createFile() { acciones.push("crear-nuevo"); if (fallaCarga) throw Error("fallo-carga"); return nuevo; }
  };
  const props = {
    getProperty(k) { return properties.get(k) || null; },
    setProperty(k, v) { acciones.push("registrar-nuevo"); if (fallaIndice) throw Error("fallo-indice"); properties.set(k, v); },
    deleteProperty(k) { properties.delete(k); }
  };
  const lock = { waitLock() { acciones.push("bloquear"); }, releaseLock() { acciones.push("liberar"); } };
  const fn = new Function("PropertiesService", "DriveApp", "Utilities", "carpetaDePersona", "LockService",
    "CARPETA_COLABORADORES", "CARPETA_EXTERNOS", "return function drive(d) {" + body + "\n}")(
      { getScriptProperties: () => props },
      { getFolderById: () => carpeta, getFileById: () => viejo },
      { base64Decode: () => new Uint8Array([1]), newBlob: () => ({}) },
      () => carpeta,
      { getScriptLock: () => lock },
      "c", "e");
  const d = { op: "subir", id: "01234567-89ab-4cde-8fab-0123456789ab",
    slot: "ine", base64: "AQ==", nombre: "ficticio.jpg", operacion };
  return { run: () => fn(d), acciones, properties };
}

test("un fallo al crear conserva el documento previo", () => {
  const x = ensayo({ fallaCarga: true });
  assert.throws(x.run, /fallo-carga/);
  assert.equal(x.properties.get("f_01234567-89ab-4cde-8fab-0123456789ab_ine"), "antiguo");
  assert.ok(!x.acciones.includes("borrar-anterior"));
});

test("el índice nuevo se confirma sin borrar la referencia anterior durante el reemplazo", () => {
  const x = ensayo();
  assert.equal(x.run(), "ok-drive");
  assert.deepEqual(x.acciones, ["bloquear", "buscar-operacion", "crear-nuevo", "marcar-nuevo", "registrar-nuevo", "liberar"]);
  assert.equal(x.properties.get("f_01234567-89ab-4cde-8fab-0123456789ab_ine"), "nuevo");
  assert.ok(!x.acciones.includes("borrar-anterior"));
});

test("un reintento con la misma operación recupera el archivo sin crear otro", () => {
  const x = ensayo({ existente: true });
  assert.equal(x.run(), "ok-drive");
  assert.ok(x.acciones.includes("buscar-operacion"));
  assert.ok(!x.acciones.includes("crear-nuevo"));
  assert.equal(x.properties.get("f_01234567-89ab-4cde-8fab-0123456789ab_ine"), "recuperado");
});

test("fallo del índice conserva el documento anterior y retira sólo la copia recién creada", () => {
  const x = ensayo({ fallaIndice: true });
  assert.throws(x.run, /fallo-indice/);
  assert.ok(x.acciones.includes("retirar-nuevo"));
  assert.equal(x.properties.get("f_01234567-89ab-4cde-8fab-0123456789ab_ine"), "antiguo");
  assert.ok(!x.acciones.includes("borrar-anterior"));
});

test("reintento antiguo no rebobina una versión más nueva", () => {
  const x = ensayo({ existente: true, vigenteMasNuevo: true });
  assert.equal(x.run(), "ok-drive");
  assert.equal(x.properties.get("f_01234567-89ab-4cde-8fab-0123456789ab_ine"), "antiguo");
  assert.ok(!x.acciones.includes("registrar-nuevo"));
  assert.ok(!x.acciones.includes("borrar-anterior"));
});
