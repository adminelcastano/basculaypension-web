// Ensayo de migración del esquema previo: ninguna fila histórica debe borrarse.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { asegurarEsquemaObligaciones } from "../src/finanzas-obligaciones.js";

test("Migración aditiva conserva filas de abonos anteriores y no fabrica metadatos",async()=>{
 const db=new DatabaseSync(":memory:");
 const stm=(sql,args=[])=>({
  sql,args,
  bind(...a){return stm(sql,a);},
  async first(){return db.prepare(sql).get(...args)||null;},
  async all(){return {results:db.prepare(sql).all(...args)};},
  async run(){const r=db.prepare(sql).run(...args);return {meta:{changes:Number(r.changes||0)}};}
 });
 const env={DB:{prepare:sql=>stm(sql)}};
 try{
  db.exec("CREATE TABLE agenda_pagos(id TEXT PRIMARY KEY,item_id TEXT,importe REAL,gasto_id TEXT,fecha TEXT,forma TEXT,titulo TEXT)");
  db.exec("CREATE TABLE caja_gastos(id TEXT PRIMARY KEY,origen TEXT,monto REAL)");
  // Tabla original publicada solo en Preview sintética, sin campos de referencia.
  db.exec("CREATE TABLE fin_obl_abonos(pago_id TEXT PRIMARY KEY,obligacion_id TEXT NOT NULL,importe_centavos INTEGER NOT NULL CHECK(importe_centavos>0),activo INTEGER NOT NULL DEFAULT 1,creado TEXT NOT NULL,creado_por TEXT,anulado_en TEXT)");
  db.prepare("INSERT INTO fin_obl_abonos(pago_id,obligacion_id,importe_centavos,creado) VALUES(?,?,?,?)")
    .run("00000000-0000-4000-8000-000000000005","00000000-0000-4000-8000-000000000006",125,"2026-10-20T12:00:00Z");
  await asegurarEsquemaObligaciones(env);
  await asegurarEsquemaObligaciones(env);
  const columns=db.prepare("PRAGMA table_info(fin_obl_abonos)").all().map(x=>x.name);
  for(const k of ["fecha_pago","forma_pago","concepto_pago"])assert.ok(columns.includes(k),k);
  const row=db.prepare("SELECT * FROM fin_obl_abonos WHERE pago_id=?").get("00000000-0000-4000-8000-000000000005");
  assert.equal(row.importe_centavos,125);
  assert.equal(row.activo,1);
  assert.equal(row.fecha_pago,null);
  assert.equal(row.forma_pago,null);
  assert.equal(row.concepto_pago,null);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM fin_obl_abonos").get().n,1);
 }finally{db.close();}
});
