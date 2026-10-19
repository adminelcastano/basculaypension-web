// Cierre mensual real de Caja con node:sqlite, KV y hoja sintéticos.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { asegurarEsquemaCaja, cierreMensualCaja, leerCobrosAdmin } from "../src/caja.js";

const MES="2026-10", SIG="2026-11";
const CIERRE=new Date("2026-11-01T17:00:00Z"); // 11:00 en Tapachula
const pagado="bascula|2026-10-18T10:00:00|17097";
const parcial="pension|2026-10-30T14:00:00|17098";
const nocturno="bascula|2026-11-01T02:00:00|17099";
const sqlite=new DatabaseSync(":memory:");
const kv=new Map();
const stmt=(sql,args=[])=>({
  sql,args,
  bind(...v){return stmt(sql,v)},
  async first(){return sqlite.prepare(sql).get(...args)||null},
  async all(){return {results:sqlite.prepare(sql).all(...args)}},
  async run(){const v=sqlite.prepare(sql).run(...args);return {success:true,meta:{changes:Number(v.changes||0)}}}
});
const env={
  INGRESOS_URL:"https://example.invalid/exec",INGRESOS_TOKEN:"ficticio",
  DB:{prepare:sql=>stmt(sql),async batch(stmts){
    sqlite.exec("BEGIN IMMEDIATE");
    try {
      const r=stmts.map(q=>{
        const tipo=q.sql.trim().split(/\s+/)[0].toUpperCase();
        if(["SELECT","WITH","PRAGMA"].includes(tipo))
          return {success:true,results:sqlite.prepare(q.sql).all(...q.args),meta:{changes:0}};
        const a=sqlite.prepare(q.sql).run(...q.args);
        return {success:true,results:[],meta:{changes:Number(a.changes||0)}};
      });
      sqlite.exec("COMMIT");return r;
    } catch(err){sqlite.exec("ROLLBACK");throw err}
  }},
  FILES:{
    async get(k,opt){const v=kv.get(k)??null;return opt?.type==="json"&&typeof v==="string"?JSON.parse(v):v},
    async put(k,v){kv.set(k,v)},async delete(k){kv.delete(k)},
    async list(){return {keys:[]}}
  }
};
await asegurarEsquemaCaja(env);
test.after(()=>sqlite.close());
const ingreso=(fecha,folio,importe,pendiente=false,monto_pendiente=0,turno="MAÑANA")=>({
  fecha,folio,matricula:"",cliente:"SINTÉTICO",importe,forma:"EFECTIVO",turno,
  ...(pendiente?{pendiente:true,monto_pendiente}:{})
});
function instalarHoja(porMes){
  const antes=globalThis.fetch;
  globalThis.fetch=async url=>{
    const mes=new URL(url).searchParams.get("mes");
    return new Response(JSON.stringify({
      ok:true,mes,bascula:porMes[mes]?.bascula||[],pension:porMes[mes]?.pension||[]
    }),{headers:{"Content-Type":"application/json"}});
  };
  return ()=>{globalThis.fetch=antes};
}
function pendiente(id,{monto=160,estado="pagado"}={}){
  const [servicio,fecha,folio]=id.split("|");
  sqlite.prepare("INSERT INTO caja_pendientes (id,servicio,fecha,dia,turno,folio,monto,mes,estado,origen_activo,actualizado) "+
    "VALUES (?,?,?,?,?,?,?,?,?,1,?)").run(id,servicio,fecha,fecha.slice(0,10),"MAÑANA",folio,monto,MES,estado,new Date().toISOString());
}
function abonar(id,pendiente,monto){
  sqlite.prepare("INSERT INTO caja_cobros_admin (id,pendiente_id,fecha_pago,mes,monto,forma,creado,por) "+
    "VALUES (?,?,?,?,?,'EFECTIVO',?,?)")
    .run(id,pendiente,"2026-10-31",MES,monto,new Date().toISOString(),"ensayo@invalid.example");
}

test("Cierre final: abono cubierto por hoja no duplica, pendiente parcial y noche se conservan",async()=>{
  await env.FILES.put("caja:mes",MES);
  pendiente(pagado);
  pendiente(parcial,{monto:200,estado:"parcial"});
  abonar("abono-pagado",pagado,160);
  abonar("abono-parcial",parcial,80);
  const quitar=instalarHoja({
    [MES]:{
      bascula:[ingreso("2026-10-18T10:00:00","17097",160)],
      pension:[ingreso("2026-10-30T14:00:00","17098",0,true,250,"TARDE")]
    },
    [SIG]:{bascula:[ingreso("2026-11-01T02:00:00","17099",0,true,75,"NOCHE")]}
  });
  try{
    const x=await cierreMensualCaja(env,{reportes:async()=>{
      assert.equal(sqlite.prepare("SELECT origen_activo FROM caja_pendientes WHERE id=?").get(pagado).origen_activo,0);
      assert.equal(sqlite.prepare("SELECT origen_activo FROM caja_pendientes WHERE id=?").get(parcial).origen_activo,1);
    }},CIERRE);
    assert.deepEqual(x,{cerrado:MES});
    assert.equal(await env.FILES.get("caja:mes"),SIG);
    assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM caja_mov WHERE mes=?").get(MES).n,3);
    assert.equal(sqlite.prepare("SELECT monto FROM caja_pendientes WHERE id=?").get(parcial).monto,250);
    assert.equal(sqlite.prepare("SELECT estado FROM caja_pendientes WHERE id=?").get(parcial).estado,"parcial");
    assert.equal(sqlite.prepare("SELECT mes FROM caja_pendientes WHERE id=?").get(nocturno).mes,MES);
    assert.equal(sqlite.prepare("SELECT origen_activo FROM caja_pendientes WHERE id=?").get(nocturno).origen_activo,1);
    assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM caja_cobros_admin").get().n,2,"Historial no se borra");
    const vigentes=await leerCobrosAdmin(env,{mes:MES});
    assert.deepEqual(vigentes.map(x=>x.monto),[80],"El abono sustituido por la hoja no suma");
  }finally{quitar()}
});

test("Reporte fallido no cierra el periodo, y los cobros ya conciliados siguen consistentes",async()=>{
  await env.FILES.put("caja:mes",MES);
  await env.FILES.delete("caja:cierre_intento");
  const quitar=instalarHoja({[MES]:{bascula:[ingreso("2026-10-18T10:00:00","17097",160)]},[SIG]:{}});
  try{
    const x=await cierreMensualCaja(env,{reportes:async()=>{throw Error("Reporte de prueba rechazado")}},CIERRE);
    assert.match(x.error,/reportes/);
    assert.equal(await env.FILES.get("caja:mes"),MES);
    assert.equal(sqlite.prepare("SELECT origen_activo FROM caja_pendientes WHERE id=?").get(pagado).origen_activo,0);
    assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM caja_cobros_admin").get().n,2);
    assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM caja_mov WHERE mes=?").get(MES).n,1);
  }finally{quitar()}
});

test("Hoja duplicada impide reemplazar tickets durante el cierre",async()=>{
  await env.FILES.delete("caja:cierre_intento");
  const n=sqlite.prepare("SELECT COUNT(*) n FROM caja_mov WHERE mes=?").get(MES).n;
  const quitar=instalarHoja({[MES]:{pension:[
    ingreso("2026-10-30T14:00:00","17098",0,true,250,"TARDE"),
    ingreso("2026-10-30T14:00:00","17098",0,true,250,"TARDE")
  ]},[SIG]:{}});
  try{
    const x=await cierreMensualCaja(env,{reportes:async()=>{throw Error("No debe ejecutarse")}},CIERRE);
    assert.match(x.error,/dos pendientes/);
    assert.equal(await env.FILES.get("caja:mes"),MES);
    assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM caja_mov WHERE mes=?").get(MES).n,n);
  }finally{quitar()}
});
