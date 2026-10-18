// Ensayo aislado de motor SQLite real, compatible con el formato SQL de D1.
// No reemplaza una prueba de concurrencia HTTP en Workers + D1 remoto.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { idFinanciero } from "../src/finanzas-idempotencia.js";
import { validarTicketRef } from "../src/caja.js";

const dbNueva = () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE fin_movs(
      id TEXT PRIMARY KEY,mes TEXT NOT NULL,fecha TEXT NOT NULL,tipo TEXT NOT NULL,
      origen TEXT NOT NULL,destino TEXT NOT NULL,importe REAL NOT NULL,
      nota TEXT,creado TEXT NOT NULL,creado_por TEXT
    );
    CREATE TABLE caja_gastos(
      id TEXT PRIMARY KEY,mes TEXT NOT NULL,dia TEXT NOT NULL,concepto TEXT,
      monto REAL NOT NULL,forma TEXT,origen TEXT
    );
    CREATE TABLE agenda_pagos(
      id TEXT PRIMARY KEY,item_id TEXT,fecha TEXT,importe REAL,forma TEXT,
      gasto_id TEXT, titulo TEXT
    );
    CREATE TABLE caja_mov(
      id INTEGER PRIMARY KEY,mes TEXT,tipo TEXT,servicio TEXT,folio TEXT,forma TEXT,importe REAL
    );
    CREATE TABLE caja_transf(
      id TEXT PRIMARY KEY,mes TEXT,fecha TEXT,cliente TEXT,importe REAL,
      ticket_ref TEXT
    );
  `);
  return db;
};

function d1Adaptador(db) {
  return {DB:{prepare(sql) {
    return {bind(...params) {
      return {
        async all() { return {results:db.prepare(sql).all(...params)}; },
        async first() { return db.prepare(sql).get(...params) || null; },
        async run() { const x=db.prepare(sql).run(...params);return {meta:{changes:x.changes}}; }
      };
    }};
  }}};
}

test("SQLite: dos reenvíos con mismo UID no duplican movimientos y otro UID sí es independiente",async()=>{
  const db=dbNueva();
  try {
    const uid="550e8400-e29b-41d4-a716-446655440000", usuario="admin@example.com";
    const id=await idFinanciero("mov",uid,usuario), fecha="2026-10-18";
    const sql="INSERT INTO fin_movs (id,mes,fecha,tipo,origen,destino,importe,nota,creado,creado_por) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
    const args=[id,"2026-10",fecha,"traspaso","bbva","mercado-pago",500,"Prueba aislada","2026-10-18T00:00:00Z",usuario];
    db.prepare(sql).run(...args);
    const mismo=await idFinanciero("mov",uid,usuario);
    assert.equal(mismo,id);
    assert.throws(()=>db.prepare(sql).run(...args),/UNIQUE constraint failed/);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM fin_movs").get().n,1);
    const distinto=await idFinanciero("mov","770e8400-e29b-41d4-a716-446655440000",usuario);
    assert.notEqual(distinto,id);
    db.prepare(sql).run(distinto,...args.slice(1));
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM fin_movs").get().n,2);
  } finally {db.close();}
});

test("SQLite: gasto y pago en una transacción; un conflicto revierte ambos asientos",async()=>{
  const db=dbNueva();
  try {
    const actor="admin@example.com",uid="550e8400-e29b-41d4-a716-446655440011";
    const gid=await idFinanciero("gasto-pago-suelto",uid,actor);
    const pid=await idFinanciero("pago-suelto",uid,actor);
    const gasto=[gid,"2026-10","2026-10-18","Pago: Luz",1250,"TRANSFERENCIA","admin"];
    const pago=[pid,"","2026-10-18",1250,"TRANSFERENCIA",gid,"Luz"];
    const insG=db.prepare("INSERT INTO caja_gastos(id,mes,dia,concepto,monto,forma,origen) VALUES(?,?,?,?,?,?,?)");
    const insP=db.prepare("INSERT INTO agenda_pagos(id,item_id,fecha,importe,forma,gasto_id,titulo) VALUES(?,?,?,?,?,?,?)");
    const guardar=(a,b)=>{db.exec("BEGIN IMMEDIATE");try{insG.run(...a);insP.run(...b);db.exec("COMMIT");}catch(e){db.exec("ROLLBACK");throw e;}};
    guardar(gasto,pago);
    assert.throws(()=>guardar(gasto,pago),/UNIQUE constraint failed/);
    assert.deepEqual([db.prepare("SELECT COUNT(*) n FROM caja_gastos").get().n,db.prepare("SELECT COUNT(*) n FROM agenda_pagos").get().n],[1,1]);
    const nuevoG=await idFinanciero("gasto-pago-suelto","550e8400-e29b-41d4-a716-446655440022",actor);
    const nuevoP=await idFinanciero("pago-suelto","550e8400-e29b-41d4-a716-446655440022",actor);
    // Falla el segundo asiento: ninguna salida queda contada en caja.
    assert.throws(()=>guardar([nuevoG,...gasto.slice(1)],[pid,...pago.slice(1)]),/UNIQUE constraint failed/);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM caja_gastos").get().n,1);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM agenda_pagos").get().n,1);
    guardar([nuevoG,...gasto.slice(1)],[nuevoP,...pago.slice(1)]);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM caja_gastos").get().n,2);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM agenda_pagos").get().n,2);
  }finally{db.close();}
});

test("SQLite real: no asociar ticket con otro importe ni folio ambiguo o ya ligado",async()=>{
  const db=dbNueva();
  try{
    const env=d1Adaptador(db);
    const agregar=(forma,importe)=>db.prepare("INSERT INTO caja_mov (mes,tipo,servicio,folio,forma,importe) VALUES('2026-10','ticket','bascula','T100',?,?)").run(forma,importe);
    agregar("TRANSFERENCIA",1000);
    assert.deepEqual(await validarTicketRef(env,"bascula:T100","2026-10",null,1000),{ref:"bascula:T100"});
    assert.match((await validarTicketRef(env,"bascula:T100","2026-10",null,900)).error,/no coincide/);
    db.prepare("INSERT INTO caja_transf(id,mes,fecha,cliente,importe,ticket_ref) VALUES('a','2026-10','2026-10-18','Prueba',1000,'bascula:T100')").run();
    assert.match((await validarTicketRef(env,"bascula:T100","2026-10","nuevo",1000)).error,/ya está ligado/);
    assert.deepEqual(await validarTicketRef(env,"bascula:T100","2026-10","a",1000),{ref:"bascula:T100"});
    agregar("EFECTIVO",1000);
    assert.match((await validarTicketRef(env,"bascula:T100","2026-10","a",1000)).error,/varios tickets/);
  }finally{db.close();}
});
