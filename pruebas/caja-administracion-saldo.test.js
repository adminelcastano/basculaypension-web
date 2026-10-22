import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { calcularCortes, guardarMovimientoAdminCaja, anularMovimientoAdminCaja, movimientosCaja } from "../src/caja.js";
import { flujosMes } from "../src/cuentas.js";

// SQLite real y adaptador D1 mínimo: jamás conecta con producción.
const dia = "2026-10-19", turno = "TARDE", ahora = "2026-10-19T18:30:00.000Z";
const uid1 = "11111111-2222-4333-8444-555555555555", uid2 = "22222222-2222-4333-8444-555555555555";
function fakeD1() {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE turno_cortes (dia TEXT NOT NULL, turno TEXT NOT NULL, PRIMARY KEY(dia, turno));" +
    "CREATE TABLE caja_admin_movs (id TEXT PRIMARY KEY, mes TEXT NOT NULL, dia TEXT NOT NULL, turno TEXT NOT NULL, tipo TEXT NOT NULL CHECK(tipo IN ('entrada','salida')), monto REAL NOT NULL CHECK(monto > 0), detalle TEXT, persona TEXT, creado TEXT NOT NULL, creado_por TEXT NOT NULL, anulado INTEGER NOT NULL DEFAULT 0, anulado_por TEXT, anulado_en TEXT);" +
    "CREATE TABLE fin_bitacora (id INTEGER PRIMARY KEY AUTOINCREMENT, cuando TEXT NOT NULL, quien TEXT, accion TEXT, que TEXT, ref TEXT, mes TEXT, detalle TEXT);");
  const prepare = sql => {
    let params = [];
    return { sql, get params() { return params; },
      bind(...values) { params = values; return this; },
      async first() { return db.prepare(sql).get(...params) || null; },
      async all() { return { results: db.prepare(sql).all(...params) }; },
      async run() { const r = db.prepare(sql).run(...params); return { meta: { changes: Number(r.changes) } }; }
    };
  };
  return { db, env: { DB: { prepare, async batch(stmts) {
    db.exec("BEGIN");
    try {
      const out = stmts.map(x => { const r = db.prepare(x.sql).run(...x.params); return { meta: { changes: Number(r.changes) } }; });
      db.exec("COMMIT");
      return out;
    } catch (e) { db.exec("ROLLBACK"); throw e; }
  } } } };
}
const ventas = () => [
  { dia, turno, servicio: "pension", tipo: "ticket", forma: "EFECTIVO", importe: 200 },
  { dia, turno, servicio: "bascula", tipo: "ticket", forma: "EFECTIVO", importe: 100 }
];
const inicio = [{ dia, turno, cambio: 100 }];
const movimientos = db => db.prepare("SELECT * FROM caja_admin_movs ORDER BY id").all();
const payload = (uid, tipo = "salida", monto = 200) => ({
  dia, turno, tipo, monto, detalle: "Control de administración", persona: "ENSAYO", quien: "tablet:ENSAYO", uid
});

test("Un retiro disminuye la caja y entra a administración, sin gasto", () => {
  const x = [{ dia, turno, tipo: "salida", monto: 200 }];
  const c = calcularCortes(ventas(), [], [], inicio, x)[0];
  assert.equal(c.efectivo, 300);
  assert.equal(c.gastos_total, 0);
  assert.equal(c.efectivo_caja, 200);
  assert.equal(c.adminMovs.salidas, 200);
  const f = flujosMes({ adminCaja: x }, []);
  assert.equal(f.sobres.entradas, 200);
  assert.equal(f.sobres.salidas, 0);
});
test("Entradas y retiros son simétricos, no se convierten en ventas o egresos", () => {
  const x = [{ dia, turno, tipo: "salida", monto: 200 }, { dia, turno, tipo: "entrada", monto: 50 }];
  const c = calcularCortes(ventas(), [], [], inicio, x)[0];
  assert.equal(c.efectivo_caja, 250);
  assert.equal(c.adminMovs.entradas, 50);
  assert.equal(c.adminMovs.salidas, 200);
  const f = flujosMes({ adminCaja: x }, []);
  assert.equal(f.sobres.entradas, 200);
  assert.equal(f.sobres.salidas, 50);
});
test("UID idempotente: no duplica registros y rechaza datos distintos", async () => {
  const { db, env } = fakeD1();
  try {
    const p = payload(uid1), r = await guardarMovimientoAdminCaja(env, p, ahora);
    assert.equal(r.repetido, false);
    assert.equal((await guardarMovimientoAdminCaja(env, p, ahora)).repetido, true);
    assert.equal(movimientos(db).length, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM fin_bitacora").get().n, 1);
    await assert.rejects(guardarMovimientoAdminCaja(env, { ...p, monto: 201 }, ahora), e => e.code === "MOV_ADMIN_CONFLICTO");
    await assert.rejects(guardarMovimientoAdminCaja(env, { ...p, tipo: "entrada" }, ahora), e => e.code === "MOV_ADMIN_CONFLICTO");
  } finally { db.close(); }
});
test("Anular preserva historial y folio, revierte saldo y no resucita el UID", async () => {
  const { db, env } = fakeD1();
  try {
    const p = payload(uid1), { id } = await guardarMovimientoAdminCaja(env, p, ahora);
    await assert.rejects(anularMovimientoAdminCaja(env, { id, dia, turno, persona: "OTRA", quien: "tablet:OTRA" }, ahora),
      e => e.code === "MOV_ADMIN_NO_ENCONTRADO");
    assert.equal((await anularMovimientoAdminCaja(env, { id, dia, turno, persona: "ENSAYO", quien: "tablet:ENSAYO" }, ahora)).repetido, false);
    assert.equal((await anularMovimientoAdminCaja(env, { id, dia, turno, persona: "ENSAYO", quien: "tablet:ENSAYO" }, ahora)).repetido, true);
    const l = movimientos(db);
    assert.equal(l.length, 1);
    assert.equal(l[0].anulado, 1);
    assert.equal(calcularCortes(ventas(), [], [], inicio, l)[0].efectivo_caja, 400);
    assert.equal(flujosMes({ adminCaja: l }, []).sobres.entradas, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM fin_bitacora").get().n, 2);
    assert.equal(movimientosCaja({ adminMovs: [{ ...l[0], mes: "2026-10" }] })[0].monto, 0);
    await assert.rejects(guardarMovimientoAdminCaja(env, p, ahora), e => e.code === "MOV_ADMIN_CONFLICTO");
  } finally { db.close(); }
});
test("Cierre impide en la propia SQL altas y anulaciones", async () => {
  const { db, env } = fakeD1();
  try {
    const { id } = await guardarMovimientoAdminCaja(env, payload(uid1, "entrada", 150), ahora);
    db.prepare("INSERT INTO turno_cortes (dia, turno) VALUES (?, ?)").run(dia, turno);
    await assert.rejects(guardarMovimientoAdminCaja(env, payload(uid2), ahora), e => e.code === "MOV_ADMIN_CERRADO");
    await assert.rejects(anularMovimientoAdminCaja(env, { id, dia, turno, persona: "ENSAYO", quien: "tablet:ENSAYO" }, ahora),
      e => e.code === "MOV_ADMIN_CERRADO");
    assert.equal(movimientos(db).length, 1);
    assert.equal(movimientos(db)[0].anulado, 0);
  } finally { db.close(); }
});
test("Validaciones monetarias y rechazo del corte no escriben bitácora", async () => {
  const { db, env } = fakeD1();
  try {
    for (const monto of [-1, 0, 10.123, 1000001])
      await assert.rejects(guardarMovimientoAdminCaja(env, payload(uid1, "salida", monto), ahora), e => e.code === "MOV_ADMIN_INVALIDO");
    db.prepare("INSERT INTO turno_cortes (dia, turno) VALUES (?, ?)").run(dia, turno);
    await assert.rejects(guardarMovimientoAdminCaja(env, payload(uid1), ahora), e => e.code === "MOV_ADMIN_CERRADO");
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM fin_bitacora").get().n, 0);
  } finally { db.close(); }
});
test("Turno conserva cola por identidad y diferencia entradas/salidas azules", () => {
  const ui = readFileSync(new URL("../src/turno.html", import.meta.url), "utf8").replace("/*__TURNO_CSS__*/", readFileSync(new URL("../src/turno-estilos.css", import.meta.url), "utf8"));
  const server = readFileSync(new URL("../src/turno.js", import.meta.url), "utf8");
  const panel = readFileSync(new URL("../src/panel/cliente/03-caja.js", import.meta.url), "utf8");
  assert.match(ui, /admin-movimientos\|incidencias/);
  assert.match(ui, /data-accion="admin-entrada"/);
  assert.match(ui, /data-accion="admin-salida"/);
  assert.match(ui, /--info: #3d8fd6/);
  assert.match(ui, /Sin internet: movimiento pendiente, aún no incluido en el saldo/);
  assert.match(server, /guardarMovimientoAdminCaja/);
  assert.match(server, /anularMovimientoAdminCaja/);
  assert.match(panel, /caja\/saldo\?dia=/);
  assert.match(panel, /setInterval\(refrescarSaldoActual, 20000\)/);
});
