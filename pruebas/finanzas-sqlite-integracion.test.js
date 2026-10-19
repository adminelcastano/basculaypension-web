// Ensayo aislado de motor SQLite real, compatible con el formato SQL de D1.
// No reemplaza una prueba de concurrencia HTTP en Workers + D1 remoto.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { idFinanciero } from "../src/finanzas-idempotencia.js";
import { validarTicketRef } from "../src/caja.js";
import { stmtHistorialCompra, stmtQuitarHistorialCompra } from "../src/compras.js";
import { stmtBitacoraSiCambio } from "../src/bitacora.js";

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

test("SQLite: dos compradores del mismo artículo (UID diferentes) nunca generan dos egresos",async()=>{
  const db=dbNueva();
  try{
    db.exec(`CREATE TABLE agenda_items(id TEXT PRIMARY KEY,estado TEXT,gasto_id TEXT);
      CREATE TABLE compras_historial (
        id TEXT PRIMARY KEY, norm TEXT NOT NULL,titulo TEXT NOT NULL,lugar TEXT,cantidad TEXT,
        importe REAL,fecha TEXT NOT NULL,gasto_id TEXT,categoria TEXT,creado TEXT NOT NULL
      );`);
    db.prepare("INSERT INTO agenda_items(id,estado) VALUES('articulo-1','pendiente')").run();
    const actor="admin@example.com",articulo={id:"articulo-1",titulo:"Papel",lugar:null,cantidad:"2",categoria:"Papelería"};
    const env=d1Adaptador(db);
    async function comprar(uid) {
      const gid=await idFinanciero("compra-ticket",uid,actor);
      db.exec("BEGIN IMMEDIATE");
      try {
        db.prepare("INSERT INTO caja_gastos(id,mes,dia,concepto,monto,forma,origen) VALUES(?,?,?,?,?,?,?)")
          .run(gid,"2026-10","2026-10-18","Compra: Papel",120,"EFECTIVO","admin");
        db.prepare("UPDATE agenda_items SET estado='comprado',gasto_id=? WHERE id='articulo-1'").run(gid);
        await stmtHistorialCompra(env,articulo,{importe:120,fecha:"2026-10-18",gasto_id:gid,exclusiva:true}).run();
        db.exec("COMMIT");
        return gid;
      }catch(e){db.exec("ROLLBACK");throw e;}
    }
    const primero=await comprar("550e8400-e29b-41d4-a716-446655440001");
    await assert.rejects(comprar("550e8400-e29b-41d4-a716-446655440002"),/UNIQUE constraint failed/);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM caja_gastos").get().n,1);
    assert.equal(db.prepare("SELECT gasto_id FROM agenda_items WHERE id='articulo-1'").get().gasto_id,primero);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM compras_historial").get().n,1);
    // Un regreso autorizado devuelve el artículo a pendiente y libera la clave.
    db.exec("BEGIN IMMEDIATE");
    db.prepare("DELETE FROM caja_gastos WHERE id=?").run(primero);
    db.prepare("UPDATE agenda_items SET estado='pendiente',gasto_id=NULL WHERE id='articulo-1'").run();
    await stmtQuitarHistorialCompra(env,"articulo-1").run();
    db.exec("COMMIT");
    await comprar("550e8400-e29b-41d4-a716-446655440002");
    assert.equal(db.prepare("SELECT COUNT(*) n FROM caja_gastos").get().n,1);
  }finally{db.close();}
});

test("SQLite: ligar un ticket único es atómico por mes y no inventa cambios de bitácora", async () => {
  const db=dbNueva();
  try {
    db.exec(`CREATE TABLE fin_bitacora(id INTEGER PRIMARY KEY AUTOINCREMENT,cuando TEXT NOT NULL,
      quien TEXT,accion TEXT NOT NULL,que TEXT NOT NULL,ref TEXT,mes TEXT,detalle TEXT)`);
    const ins=db.prepare("INSERT INTO caja_transf(id,mes,fecha,cliente,importe,ticket_ref) VALUES(?,?,?,?,?,NULL)");
    ins.run("t-a","2026-10","2026-10-18","Cliente A",350);
    ins.run("t-b","2026-10","2026-10-18","Cliente B",350);
    ins.run("t-c","2026-11","2026-11-02","Cliente C",350);
    const env=d1Adaptador(db);
    const sql="UPDATE caja_transf SET ticket_ref = ? WHERE id = ? AND mes = ? AND NOT EXISTS (SELECT 1 FROM caja_transf WHERE mes = ? AND ticket_ref = ? AND id != ?)";
    async function ligar(id,mes,ref) {
      db.exec("BEGIN IMMEDIATE");
      try{
        const resultado=db.prepare(sql).run(ref,id,mes,mes,ref,id);
        const bit=stmtBitacoraSiCambio(env,{quien:"ENSAYO",accion:"editar",que:"Transferencia de cliente",ref:id,mes,detalle:{ticket:ref}});
        await bit.run();
        db.exec("COMMIT");
        return resultado.changes;
      } catch(er) {db.exec("ROLLBACK");throw er;}
    }
    assert.equal(await ligar("t-a","2026-10","bascula:T-1"),1);
    assert.equal(await ligar("t-b","2026-10","bascula:T-1"),0);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM caja_transf WHERE mes='2026-10' AND ticket_ref='bascula:T-1'").get().n,1);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM fin_bitacora").get().n,1,"No registrar intentos rechazados como cambios");
    assert.equal(await ligar("t-c","2026-11","bascula:T-1"),1,"Otro mes puede reutilizar folio");
    assert.equal(db.prepare("SELECT COUNT(*) n FROM fin_bitacora").get().n,2);
  } finally {db.close();}
});

test("SQLite: al crear transferencia vinculada, condición de unicidad conserva bitácora",async()=>{
  const db=dbNueva();
  try {
    db.exec(`CREATE TABLE fin_bitacora(id INTEGER PRIMARY KEY AUTOINCREMENT,cuando TEXT NOT NULL,
      quien TEXT,accion TEXT NOT NULL,que TEXT NOT NULL,ref TEXT,mes TEXT,detalle TEXT)`);
    const sql="INSERT INTO caja_transf(id,mes,fecha,cliente,importe,ticket_ref) SELECT ?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM caja_transf WHERE mes = ? AND ticket_ref = ?)";
    const env=d1Adaptador(db);
    async function crear(id) {
      db.exec("BEGIN IMMEDIATE");
      try{
        const x=db.prepare(sql).run(id,"2026-10","2026-10-18","Cliente sintético",700,"pension:P100","2026-10","pension:P100");
        await stmtBitacoraSiCambio(env,{quien:"ENSAYO",accion:"crear",que:"Transferencia de cliente",ref:id,mes:"2026-10"}).run();
        db.exec("COMMIT");return x.changes;
      } catch(er) {db.exec("ROLLBACK");throw er;}
    }
    assert.equal(await crear("id-a"),1);
    assert.equal(await crear("id-b"),0);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM caja_transf").get().n,1);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM fin_bitacora").get().n,1);
  }finally{db.close();}
});
