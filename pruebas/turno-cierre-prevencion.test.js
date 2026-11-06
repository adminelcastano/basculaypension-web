import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { turnoPrevioSinCorte, cierreAnticipado } from "../src/turno-cierre-prevencion.js";

const hoy = "2026-11-05";
function ensayo() {
  const db = new DatabaseSync(":memory:");
  db.exec([
    "CREATE TABLE turno_cortes(dia TEXT, turno TEXT);",
    "CREATE TABLE turno_inicio(dia TEXT, turno TEXT, cambio REAL);",
    "CREATE TABLE caja_mov(dia TEXT, turno TEXT, importe REAL);",
    "CREATE TABLE caja_gastos(dia TEXT, turno TEXT, monto REAL, origen TEXT);",
    "CREATE TABLE caja_extra(dia TEXT, turno TEXT, monto REAL);",
    "CREATE TABLE caja_admin_movs(dia TEXT, turno TEXT, monto REAL, anulado INTEGER);"
  ].join("\n"));
  return {
    db,
    env: { DB: {
      prepare(sql) {
        let params = [];
        return {
          bind(...p) { params=p; return this; },
          async first(){ return db.prepare(sql).get(...params) || null; }
        };
      }
    }}
  };
}
const pen = (d,t)=>({dia:d,turno:t});

test("Incidente 5 nov: Mañana con ventas y sin corte avisa antes de cerrar Tarde", async()=>{
  const {db,env}=ensayo();
  try {
    db.prepare("INSERT INTO caja_mov VALUES(?,?,?)").run(hoy,"MAÑANA",2060);
    assert.deepEqual(await turnoPrevioSinCorte(env,hoy,"TARDE"),pen(hoy,"MAÑANA"));
    // No hacer ninguna modificación al registro de origen ni sumar importes.
    assert.equal(db.prepare("SELECT importe FROM caja_mov").get().importe,2060);
    db.prepare("INSERT INTO turno_cortes VALUES(?,?)").run(hoy,"MAÑANA");
    assert.equal(await turnoPrevioSinCorte(env,hoy,"TARDE"),null,"Un corte previo válido libera el cierre siguiente");
  } finally { db.close(); }
});

test("Si el turno anterior no tiene operaciones, no se bloquea el siguiente", async()=>{
  const {db,env}=ensayo();
  try{
    assert.equal(await turnoPrevioSinCorte(env,hoy,"TARDE"),null);
    db.prepare("INSERT INTO caja_gastos VALUES(?,?,?,?)").run(hoy,"MAÑANA",10,"admin");
    db.prepare("INSERT INTO caja_admin_movs VALUES(?,?,?,?)").run(hoy,"MAÑANA",20,1);
    assert.equal(await turnoPrevioSinCorte(env,hoy,"TARDE"),null,
      "Los movimientos de administración y anulados no prueban un turno de caja pendiente");
    db.prepare("INSERT INTO caja_gastos VALUES(?,?,?,?)").run(hoy,"MAÑANA",1,"caja");
    assert.deepEqual(await turnoPrevioSinCorte(env,hoy,"TARDE"),pen(hoy,"MAÑANA"));
  } finally { db.close(); }
});

test("Funciona al cambiar a Noche y a Mañana del día siguiente", async()=>{
  const {db,env}=ensayo();
  try{
    db.prepare("INSERT INTO turno_inicio VALUES(?,?,?)").run(hoy,"TARDE",200);
    assert.deepEqual(await turnoPrevioSinCorte(env,hoy,"NOCHE"),pen(hoy,"TARDE"));
    db.prepare("INSERT INTO caja_extra VALUES(?,?,?)").run(hoy,"NOCHE",100);
    assert.deepEqual(await turnoPrevioSinCorte(env,"2026-11-06","MAÑANA"),pen(hoy,"NOCHE"));
    db.prepare("INSERT INTO turno_cortes VALUES(?,?)").run(hoy,"NOCHE");
    assert.equal(await turnoPrevioSinCorte(env,"2026-11-06","MAÑANA"),null);
  } finally { db.close(); }
});

test("El cierre anticipado se detecta por hora de Tapachula, incluida Noche",()=>{
  assert.equal(cierreAnticipado("TARDE",new Date("2026-11-05T20:53:45Z")),true,
    "Las 14:53 locales deben requerir una segunda confirmación");
  assert.equal(cierreAnticipado("TARDE",new Date("2026-11-06T03:15:00Z")),false);
  assert.equal(cierreAnticipado("MAÑANA",new Date("2026-11-05T13:00:00Z")),true);
  assert.equal(cierreAnticipado("MAÑANA",new Date("2026-11-05T19:30:00Z")),false);
  assert.equal(cierreAnticipado("NOCHE",new Date("2026-11-06T05:00:00Z")),true);
  assert.equal(cierreAnticipado("NOCHE",new Date("2026-11-06T11:30:00Z")),false);
  assert.equal(cierreAnticipado("SIN TURNO",new Date()),false);
});

test("Servidor comprueba la falta también al cerrar, conserva PIN y no revela el efectivo esperado",()=>{
  const worker=readFileSync(new URL("../src/turno.js",import.meta.url),"utf8");
  const html=readFileSync(new URL("../src/turno.html",import.meta.url),"utf8");
  const bloque=worker.slice(worker.indexOf('if (partes[0] === "corte" && request.method === "POST")'));
  assert.match(worker,/turnoPrevioSinCorte\(env, diaNuevo, turno\)/);
  assert.match(worker,/requiere_confirmacion_anterior: true/);
  assert.match(bloque,/turnoPrevioSinCorte\(env, s.dia, s.turno\)/);
  assert.match(bloque,/No puedes entregar este corte/);
  assert.match(bloque,/requiere_confirmacion_anticipada: true/);
  assert.match(bloque,/confirmar_cierre_anticipado/);
  assert.match(worker,/pinCorrecto\(pin, p.pin_sal, p.pin_hash\)/);
  assert.match(html,/¿Qué turno estás abriendo\?/);
  assert.match(html,/Corte del turno anterior pendiente/);
  assert.match(html,/¡Verifica el turno y el día!/);
  assert.match(html,/confirmar_cierre_anticipado: anticipado/);
  assert.match(html,/E\.corte_previo_pendiente/);
  assert.match(html,/const colaClave = \(\) => E && E\.persona && E\.turno && E\.dia/);
  assert.doesNotMatch(worker,/UPDATE caja_mov SET turno/);
});

test("Ningún cambio presupone valores contables de las personas reales",()=>{
  const helper=readFileSync(new URL("../src/turno-cierre-prevencion.js",import.meta.url),"utf8");
  assert.doesNotMatch(helper,/SUM\(|importe|efectivo|cliente|folio|matricula|SELECT \*/i);
  assert.match(helper,/EXISTS \(SELECT 1 FROM caja_mov/);
  assert.match(helper,/EXISTS \(SELECT 1 FROM turno_cortes/);
});
