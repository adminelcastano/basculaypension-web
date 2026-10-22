import test from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {resumenPorCobrarCaja} from "../src/finanzas-cobrar.js";
function preparar(){
 const db=new DatabaseSync(":memory:");
 db.exec("CREATE TABLE caja_pendientes(id TEXT PRIMARY KEY,dia TEXT,monto REAL,estado TEXT,origen_activo INTEGER,actualizado TEXT)");
 db.exec("CREATE TABLE caja_cobros_admin(id TEXT PRIMARY KEY,pendiente_id TEXT,monto REAL,anulado INTEGER)");
 const env={DB:{prepare:sql=>({async first(){return db.prepare(sql).get() || null;}})}};
 return {db,env,pendiente:(id,monto,estado="pendiente",activo=1)=>{
  db.prepare("INSERT INTO caja_pendientes VALUES (?,?,?,?,?,?)").run(id,"2026-10-10",monto,estado,activo,"2026-10-21T12:00:00Z");
 },abono:(id,ref,monto,anulado=0)=>{
  db.prepare("INSERT INTO caja_cobros_admin VALUES (?,?,?,?)").run(id,ref,monto,anulado);
 }};
}
test("DINERO consulta solo los saldos pendientes activos; no cuenta abonos anulados",async()=>{
 const x=preparar();
 try {
  x.pendiente("uno",125.30);
  x.pendiente("dos",90.20,"parcial");
  x.abono("abono-valido","dos",40.10);
  x.abono("abono-anulado","dos",10,1);
  x.pendiente("cancelado",500,"cancelado");
  x.pendiente("ya-cobrado",300,"pagado");
  x.pendiente("origen-rectificado",700,"pendiente",0);
  const r=await resumenPorCobrarCaja(x.env);
  assert.deepEqual([r.total,r.operaciones,r.mas_antiguo],[175.40,2,"2026-10-10"]);
  assert.equal(r.origen,"caja_pendientes");
  assert.equal(r.revisar_pagados,1,"Pagados sin abonos trazables deben revisarse en CAJA");
  assert.equal(r.revisar_total,300);
  assert.equal(r.total,175.40,"La alerta no debe sumar la discrepancia como deuda real");
  assert.match(r.advertencia,/no es ingreso realizado/i);
  assert.equal(x.db.prepare("SELECT COUNT(*) n FROM caja_cobros_admin").get().n,2,"No escribe abonos");
 } finally {x.db.close();}
});
test("Variaciones en el monto de un ticket pagado requieren revisión sin crear deuda ficticia",async()=>{
 const x=preparar();
 try{
   x.pendiente("t1",75.50,"pagado");
   x.abono("a1","t1",75.50);
   let r=await resumenPorCobrarCaja(x.env);
   assert.equal(r.revisar_pagados,0);
   assert.equal(r.total,0);
   x.db.prepare("UPDATE caja_pendientes SET monto=95.50 WHERE id='t1'").run();
   r=await resumenPorCobrarCaja(x.env);
   assert.equal(r.total,0,"El estado «pagado» no se altera automáticamente");
   assert.deepEqual([r.revisar_pagados,r.revisar_total],[1,20]);
   assert.equal(x.db.prepare("SELECT estado FROM caja_pendientes WHERE id='t1'").get().estado,"pagado");
 }finally{x.db.close();}
});
test("El saldo es cero sin pendientes y se ajusta al abonar sin crear asiento en DINERO",async()=>{
 const x=preparar();
 try {
  assert.equal((await resumenPorCobrarCaja(x.env)).total,0);
  x.pendiente("uno",25.01);
  assert.equal((await resumenPorCobrarCaja(x.env)).total,25.01);
  x.abono("a","uno",15);
  assert.equal((await resumenPorCobrarCaja(x.env)).total,10.01);
  x.abono("b","uno",10.01);
  assert.deepEqual([ (await resumenPorCobrarCaja(x.env)).total,(await resumenPorCobrarCaja(x.env)).operaciones],[0,0]);
 } finally {x.db.close();}
});
