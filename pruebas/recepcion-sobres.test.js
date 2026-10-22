import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { anexarRecepcionSobres, registrarRecepcionSobre } from "../src/caja.js";

const dia = "2026-10-20", turno = "TARDE", quien = "admin@ejemplo.test";
const ahora = "2026-10-22T12:00:00.000Z";

// SQLite real en memoria con la misma semántica transaccional de los batch D1.
function fakeD1() {
  const db = new DatabaseSync(":memory:");
  db.exec(
    "CREATE TABLE turno_cortes (dia TEXT NOT NULL, turno TEXT NOT NULL, sobre REAL, PRIMARY KEY(dia, turno));" +
    "CREATE TABLE caja_sobres_recepcion (dia TEXT NOT NULL, turno TEXT NOT NULL, recibido INTEGER NOT NULL CHECK(recibido IN(0,1)), revision INTEGER NOT NULL, actualizado TEXT NOT NULL, por TEXT NOT NULL, PRIMARY KEY(dia,turno));" +
    "CREATE TABLE caja_sobres_recepcion_hist (id INTEGER PRIMARY KEY AUTOINCREMENT, dia TEXT NOT NULL, turno TEXT NOT NULL, recibido INTEGER NOT NULL, revision INTEGER NOT NULL, actualizado TEXT NOT NULL, por TEXT NOT NULL);" +
    "CREATE TABLE fin_bitacora (id INTEGER PRIMARY KEY AUTOINCREMENT, cuando TEXT NOT NULL, quien TEXT, accion TEXT NOT NULL, que TEXT NOT NULL, ref TEXT, mes TEXT, detalle TEXT);"
  );
  const prepare = sql => {
    let params = [];
    return { sql, get params() { return params; }, bind(...values) { params = values; return this; },
      async run() { const r = db.prepare(sql).run(...params); return { meta: { changes: Number(r.changes) } }; },
      async all() { return { results: db.prepare(sql).all(...params) }; },
      async first() { return db.prepare(sql).get(...params) || null; }
    };
  };
  return { db, env: { DB: { prepare, async batch(stmts) {
    db.exec("BEGIN");
    try {
      const r = stmts.map(s => {
        const x = db.prepare(s.sql).run(...s.params);
        return { meta: { changes: Number(x.changes) } };
      });
      db.exec("COMMIT");
      return r;
    } catch (e) { db.exec("ROLLBACK"); throw e; }
  } } } };
}
const estado = db => db.prepare("SELECT * FROM caja_sobres_recepcion WHERE dia=? AND turno=?").get(dia,turno);
const cuenta = (db,t) => db.prepare("SELECT COUNT(*) n FROM " + t).get().n;
const recibido = (revision, valor) => ({ dia, turno, revision, recibido: valor, quien });

test("Recepción es independiente de importes y se refleja en resumen y detalle", async () => {
  const { db, env } = fakeD1();
  try {
    db.prepare("INSERT INTO turno_cortes (dia, turno, sobre) VALUES (?,?,?)").run(dia, turno, 3500);
    const cortes = [{ dia, turno, conteo: { sobre: 3500 } }];
    await anexarRecepcionSobres(env, cortes);
    assert.deepEqual(cortes[0].recepcion_sobre, { recibido: false, revision: 0 });
    const r = await registrarRecepcionSobre(env, recibido(0, true), ahora);
    assert.deepEqual(r, { recibido: true, revision: 1, actualizado: ahora, por: quien });
    assert.equal(estado(db).recibido, 1);
    assert.equal(db.prepare("SELECT sobre FROM turno_cortes WHERE dia=? AND turno=?").get(dia, turno).sobre, 3500);
    await anexarRecepcionSobres(env, cortes);
    assert.equal(cortes[0].recepcion_sobre.recibido, true);
    assert.equal(cortes[0].recepcion_sobre.revision, 1);
    assert.equal(cuenta(db, "caja_sobres_recepcion_hist"), 1);
    assert.equal(cuenta(db, "fin_bitacora"), 1);
    assert.equal(db.prepare("SELECT detalle FROM fin_bitacora").get().detalle.includes('"recibido":true'), true);
  } finally { db.close(); }
});

test("Desmarcar corrige, conserva historial y no duplica contabilidad", async () => {
  const { db, env } = fakeD1();
  try {
    db.prepare("INSERT INTO turno_cortes (dia, turno, sobre) VALUES (?,?,?)").run(dia,turno,1500);
    await registrarRecepcionSobre(env, recibido(0,true), ahora);
    const r = await registrarRecepcionSobre(env, recibido(1,false), "2026-10-22T13:00:00.000Z");
    assert.equal(r.revision, 2);
    assert.equal(estado(db).recibido, 0);
    assert.deepEqual(db.prepare("SELECT recibido FROM caja_sobres_recepcion_hist ORDER BY id").all().map(x=>x.recibido), [1,0]);
    assert.equal(cuenta(db, "fin_bitacora"), 2);
    assert.equal(db.prepare("SELECT sobre FROM turno_cortes").get().sobre, 1500);
  } finally { db.close(); }
});

test("Cambios simultáneos/reintentos con revisión vieja no pisan a otros usuarios", async () => {
  const { db, env } = fakeD1();
  try {
    db.prepare("INSERT INTO turno_cortes (dia, turno, sobre) VALUES (?,?,?)").run(dia,turno,900);
    const [a,b] = await Promise.allSettled([
      registrarRecepcionSobre(env, recibido(0,true), ahora),
      registrarRecepcionSobre(env, { ...recibido(0,true), quien: "otro@ejemplo.test" }, ahora)
    ]);
    assert.equal([a,b].filter(x=>x.status==="fulfilled").length,1);
    assert.equal([a,b].filter(x=>x.status==="rejected" && x.reason.code==="SOBRE_CONFLICTO").length,1);
    await assert.rejects(registrarRecepcionSobre(env, recibido(0,true), ahora), e=>e.code==="SOBRE_CONFLICTO");
    await assert.rejects(registrarRecepcionSobre(env, recibido(1,true), ahora), e=>e.code==="SOBRE_CONFLICTO");
    await registrarRecepcionSobre(env, recibido(1,false), ahora);
    await assert.rejects(registrarRecepcionSobre(env, recibido(1,false), ahora), e=>e.code==="SOBRE_CONFLICTO");
    assert.equal(cuenta(db, "caja_sobres_recepcion_hist"), 2);
    assert.equal(cuenta(db, "fin_bitacora"), 2);
  } finally { db.close(); }
});

test("Sin corte o sin sobre positivo no admite confirmación", async () => {
  const { db, env } = fakeD1();
  try {
    await assert.rejects(registrarRecepcionSobre(env, recibido(0,true), ahora), e=>e.code==="SOBRE_CONFLICTO");
    db.prepare("INSERT INTO turno_cortes (dia, turno, sobre) VALUES (?,?,?)").run(dia,turno,0);
    await assert.rejects(registrarRecepcionSobre(env, recibido(0,true), ahora), e=>e.code==="SOBRE_CONFLICTO");
    assert.equal(cuenta(db,"caja_sobres_recepcion_hist"),0);
    assert.equal(cuenta(db,"fin_bitacora"),0);
    assert.equal(cuenta(db,"caja_sobres_recepcion"),0);
  } finally { db.close(); }
});

test("Validación de estados y revisiones impide escrituras inválidas", async () => {
  const { db, env } = fakeD1();
  try {
    for (const p of [
      recibido(-1,true), recibido(1.5,true), recibido(0,"true"),
      { ...recibido(0,true), turno:"INVALIDO" }, { ...recibido(0,true), dia:"2026-02-30" },
      { ...recibido(0,true), quien:"" }
    ]) await assert.rejects(registrarRecepcionSobre(env,p,ahora),e=>e.code==="SOBRE_INVALIDO");
    await assert.rejects(registrarRecepcionSobre(env,recibido(0,false),ahora),e=>e.code==="SOBRE_CONFLICTO");
    assert.equal(cuenta(db,"caja_sobres_recepcion"),0);
  } finally { db.close(); }
});

test("El Panel expone casillas por turno y resumen en Inicio sin mezclar saldos", () => {
  const caja = readFileSync(new URL("../src/panel/cliente/03-caja.js", import.meta.url), "utf8");
  const inicio = readFileSync(new URL("../src/panel/cliente/06-inicio.js", import.meta.url), "utf8");
  const pagina = readFileSync(new URL("../src/panel/pagina.html", import.meta.url), "utf8");
  const servidor = readFileSync(new URL("../src/caja.js", import.meta.url), "utf8");
  assert.match(caja,/caja\/sobres\/recepcion/);
  assert.match(caja,/data-revision=/);
  assert.match(caja,/const orden = \[\.\.\.cs\]/);
  assert.match(inicio,/recibidos · \$\{pendientes\} pendientes/);
  assert.match(pagina,/id="i-sobres-ir"/);
  assert.match(servidor,/anexarRecepcionSobres\(env, cortes\)/);
  assert.match(servidor,/caja_sobres_recepcion_hist/);
  assert.doesNotMatch(servidor,/UPDATE turno_cortes SET recibido/);
});
