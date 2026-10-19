import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { permisoFotoTurno } from "../src/foto-acceso-turno.js";

const FOTO = "tf:aviso:01234567-89ab-4cde-8fab-0123456789ab";
const COMENTARIO = "tf:inc:11234567-89ab-4cde-8fab-0123456789ab";
const INCIDENCIA = "tf:inc:21234567-89ab-4cde-8fab-0123456789ab";
const sesion = (persona, turno = "MAÑANA") => ({ persona, turno });

function entorno() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE agenda_items (id TEXT PRIMARY KEY, tipo TEXT, estado TEXT, autor TEXT, para TEXT, foto TEXT, fotos TEXT);
    CREATE TABLE aviso_comentarios (id TEXT PRIMARY KEY, item_id TEXT, foto TEXT, borrado TEXT);
  `);
  const p = JSON.stringify({ todos: false, admin: true, turnos: [], personas: ["ANA"] });
  db.prepare("INSERT INTO agenda_items VALUES (?, ?, ?, ?, ?, ?, ?)").run("post1", "aviso", "activo", "admin", p, FOTO, "[]");
  db.prepare("INSERT INTO aviso_comentarios VALUES (?, ?, ?, ?)").run("coment1", "post1", COMENTARIO, null);
  db.prepare("INSERT INTO agenda_items VALUES (?, ?, ?, ?, ?, ?, ?)").run("inc1", "incidencia", "activo", "ANA", null, INCIDENCIA, "[]");
  const env = { DB: {
    prepare(sql) {
      return {
        bind(...args) {
          return { async first() { return db.prepare(sql).get(...args) ?? null; } };
        }
      };
    }
  }};
  return { db, env };
}

test("A-05 SQL: enlace de foto conocido no permite lectura entre encargados", async () => {
  const { env, db } = entorno();
  try {
    for (const llave of [FOTO, COMENTARIO]) {
      assert.equal((await permisoFotoTurno(env, llave, sesion("ANA"))).permitido, true);
      assert.equal((await permisoFotoTurno(env, llave, sesion("LUIS"))).permitido, false);
    }
  } finally { db.close(); }
});

test("A-05 SQL: el cambio de audiencia se evalúa en la lectura de cada fotografía", async () => {
  const { env, db } = entorno();
  try {
    assert.equal((await permisoFotoTurno(env, FOTO, sesion("LUIS", "NOCHE"))).permitido, false);
    const audiencia = JSON.stringify({ todos: false, admin: true, turnos: ["NOCHE"], personas: ["ANA"] });
    db.prepare("UPDATE agenda_items SET para = ? WHERE id = ?").run(audiencia, "post1");
    assert.equal((await permisoFotoTurno(env, FOTO, sesion("LUIS", "NOCHE"))).permitido, true);
    assert.equal((await permisoFotoTurno(env, FOTO, sesion("LUIS", "TARDE"))).permitido, false);
  } finally { db.close(); }
});

test("A-05 SQL: comentario eliminado, post archivado o enlace huérfano deniegan acceso", async () => {
  const { env, db } = entorno();
  try {
    db.prepare("UPDATE aviso_comentarios SET borrado = ? WHERE id = ?").run("2026-10-19T12:00:00Z", "coment1");
    assert.equal((await permisoFotoTurno(env, COMENTARIO, sesion("ANA"))).permitido, false);
    db.prepare("UPDATE agenda_items SET estado = ? WHERE id = ?").run("archivado", "post1");
    assert.equal((await permisoFotoTurno(env, FOTO, sesion("ANA"))).permitido, false);
    db.prepare("DELETE FROM agenda_items WHERE id = ?").run("post1");
    assert.equal((await permisoFotoTurno(env, FOTO, sesion("ANA"))).permitido, false);
    assert.equal((await permisoFotoTurno(env, COMENTARIO, sesion("ANA"))).permitido, false);
  } finally { db.close(); }
});

test("A-05 SQL: incidencia anterior mantiene acceso por ruta prevista", async () => {
  const { env, db } = entorno();
  try {
    assert.deepEqual(await permisoFotoTurno(env, INCIDENCIA, sesion("LUIS")), { permitido: true, castagram: false });
    db.prepare("DELETE FROM agenda_items WHERE id = ?").run("inc1");
    assert.equal((await permisoFotoTurno(env, INCIDENCIA, sesion("LUIS"))).permitido, false);
  } finally { db.close(); }
});

test("A-05 SQL: claves no previstas se rechazan por defecto", async () => {
  const { env, db } = entorno();
  try {
    for (const llave of ["tf:tarea:31234567-89ab-4cde-8fab-0123456789ab", "cualquier-llave", ""]) {
      assert.deepEqual(await permisoFotoTurno(env, llave, sesion("ANA")), { permitido: false, castagram: false });
    }
  } finally { db.close(); }
});
