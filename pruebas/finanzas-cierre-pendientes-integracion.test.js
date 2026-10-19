// Cierre mensual real de Caja con node:sqlite, KV y hoja sintéticos.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { asegurarEsquemaCaja, cierreMensualCaja, leerCobrosAdmin, leerHoja, sincronizarCaja } from "../src/caja.js";

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
  // Este ensayo simula un cierre independiente tras el cierre exitoso anterior.
  sqlite.prepare("DELETE FROM caja_cierre_lock WHERE mes=?").run(MES);
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
  sqlite.prepare("DELETE FROM caja_cierre_lock WHERE mes=?").run(MES);
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


test("Dos ejecuciones simultáneas no cierran dos veces ni generan reportes dobles",async()=>{
  sqlite.prepare("DELETE FROM caja_cierre_lock WHERE mes=?").run(MES);
  await env.FILES.put("caja:mes",MES);
  await env.FILES.delete("caja:cierre_intento");
  const retirar=instalarHoja({[MES]:{bascula:[ingreso("2026-10-18T10:00:00","17097",160)]},[SIG]:{}});
  const getOriginal=env.FILES.get;
  let lecturas=0,soltar;
  const barrera=new Promise(done=>{soltar=done});
  env.FILES.get=async (key,opt)=>{
    const valor=await getOriginal(key,opt);
    if(key==="caja:cierre_intento" && ++lecturas<=2){
      if(lecturas===2)soltar();
      await barrera;
      return null; // ambas sesiones ven KV aparentemente libre
    }
    return valor;
  };
  let reportes=0;
  try{
    const resultados=await Promise.all([
      cierreMensualCaja(env,{reportes:async()=>{reportes++}},CIERRE),
      cierreMensualCaja(env,{reportes:async()=>{reportes++}},CIERRE)
    ]);
    assert.equal(lecturas,2);
    assert.deepEqual(resultados.map(x=>x.cerrado?"cerrado":x.esperando?"esperando":"otro").sort(),
      ["cerrado","esperando"],JSON.stringify(resultados));
    assert.equal(reportes,1,"Solo un Worker puede generar los reportes");
    assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM caja_cierre_lock WHERE mes=?").get(MES).n,1);
    assert.equal(await getOriginal("caja:mes"),SIG);
    assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM caja_mov WHERE mes=?").get(MES).n,1);
  }finally{env.FILES.get=getOriginal;retirar()}
});

test("Llave vieja se recupera; reporte fallido libera el bloqueo D1 para reintento",async()=>{
  const ahoraViejo="2026-10-31T22:00:00Z";
  sqlite.prepare("INSERT INTO caja_cierre_lock(mes,token,tomado) VALUES (?, ?, ?) ON CONFLICT(mes) DO UPDATE SET token=excluded.token,tomado=excluded.tomado")
    .run(MES,"lease-abandonado",ahoraViejo);
  await env.FILES.put("caja:mes",MES);
  await env.FILES.delete("caja:cierre_intento");
  const retirar=instalarHoja({[MES]:{bascula:[ingreso("2026-10-18T10:00:00","17097",160)]},[SIG]:{}});
  try{
    const salida=await cierreMensualCaja(env,{reportes:async()=>{throw Error("Google rechazó informe de ensayo")}},CIERRE);
    assert.match(salida.error,/reportes/);
    assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM caja_cierre_lock WHERE mes=?").get(MES).n,0,
      "La llave tras un fallo no retiene un cierre que puede reintentarse");
    assert.equal(await env.FILES.get("caja:mes"),MES);
  }finally{retirar()}
});

test("Google con importe inválido nunca reemplaza tickets ni los convierte en cero",async()=>{
  await env.FILES.put("caja:mes",MES);
  const guardados=sqlite.prepare("SELECT id,importe FROM caja_mov WHERE mes=? ORDER BY id").all(MES).map(x=>({...x}));
  const casos=["importe no numérico","1e5","99.999",null];
  for(const importe of casos){
    const quitar=instalarHoja({[MES]:{bascula:[
      ingreso("2026-10-18T10:00:00","17097",importe)
    ]},[SIG]:{}});
    try{
      await assert.rejects(()=>leerHoja(env,MES),/importe no válido/);
      const estado=await sincronizarCaja(env);
      assert.match(estado.error,/importe no válido/,String(importe));
      assert.deepEqual(sqlite.prepare("SELECT id,importe FROM caja_mov WHERE mes=? ORDER BY id").all(MES).map(x=>({...x})),
        guardados,"No reemplazar ni borrar la última foto válida de la hoja");
    }finally{quitar()}
  }
  const quitar=instalarHoja({[MES]:{pension:[
    ingreso("2026-10-18T10:00:00","17097",0,true,"monto inventado")
  ]},[SIG]:{}});
  try{
    await assert.rejects(()=>leerHoja(env,MES),/pendiente con importe no válido/);
  }finally{quitar()}
});

test("Google con cantidades válidas preserva ceros, centavos y devoluciones negativas",async()=>{
  const quitar=instalarHoja({[MES]:{bascula:[
    ingreso("2026-10-18T10:00:00","17097","$1,250.25"),
    ingreso("2026-10-18T11:00:00","17098","MENOS 55"),
    ingreso("2026-10-18T12:00:00","17099",0),
    ingreso("2026-10-18T13:00:00","17100",0,true,"65.75")
  ]},[SIG]:{}});
  try{
    const filas=await leerHoja(env,MES);
    assert.deepEqual(filas.map(x=>x.importe),[1250.25,-55,0,0]);
    assert.equal(filas[3].pendiente,true);
    assert.equal(filas[3].monto_pendiente,65.75);
  }finally{quitar()}
});

test("La hoja con calendario u horario imposible no reescribe los tickets del mes",async()=>{
  for(const fecha of [
    "2026-10-00T10:00:00","2026-10-32T10:00:00",
    "2026-10-18T25:00:00","2026-10-18T10:61:00",
    "2026-10-18T10:00:60","2026-10-18T10:00"
  ]){
    const desinstalar=instalarHoja({[MES]:{bascula:[ingreso(fecha,"17097",20)]},[SIG]:{}});
    try{
      await assert.rejects(()=>leerHoja(env,MES),/movimientos inválidos/,fecha);
    }finally{desinstalar()}
  }
  const retirar=instalarHoja({[MES]:{bascula:[ingreso("2026-10-18T10:00:00","17097",12.25)]},[SIG]:{}});
  try{
    const filas=await leerHoja(env,MES);
    assert.equal(filas.length,1);
    assert.equal(filas[0].importe,12.25);
  }finally{retirar()}
});

test("Dos sincronizaciones simultáneas no pisan la hoja; una llave antigua se recupera",async()=>{
  await env.FILES.put("caja:mes",MES);
  sqlite.prepare("INSERT INTO caja_sync_lock (nombre,token,tomado) VALUES ('hoja','abandonada','2026-01-01T00:00:00Z') ON CONFLICT(nombre) DO UPDATE SET token=excluded.token,tomado=excluded.tomado").run();
  let liberar,avisar,consultas=0,abierta=false;
  const bloqueada=new Promise(resolve=>{liberar=resolve});
  const iniciada=new Promise(resolve=>{avisar=resolve});
  const antes=globalThis.fetch;
  globalThis.fetch=async url=>{
    consultas++;
    if(!abierta){abierta=true;avisar();await bloqueada;}
    const m=new URL(url).searchParams.get("mes");
    return new Response(JSON.stringify({ok:true,mes:m,
      bascula:m===MES?[ingreso("2026-10-18T10:00:00","17097",160)]:[],
      pension:[]}),{headers:{"Content-Type":"application/json"}});
  };
  let primera;
  try{
    primera=sincronizarCaja(env);
    await iniciada; // la primera ya tomó la llave, pero Google no respondió
    const segunda=await sincronizarCaja(env);
    assert.equal(segunda.ocupado,true,"La lectura más vieja no ejecuta ningún INSERT/DELETE");
    assert.equal(consultas,1,"No se consulta Google una segunda vez");
    liberar();
    const estado=await primera;
    assert.ok(estado.at && !estado.error,JSON.stringify(estado));
    assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM caja_sync_lock").get().n,0,
      "Al terminar se libera la llave de sincronización");
    const nueva=await sincronizarCaja(env);
    assert.ok(nueva.at && !nueva.ocupado,JSON.stringify(nueva));
    assert.equal(consultas,2,"Después del cierre normal se permite una nueva lectura");
  }finally{
    liberar();
    globalThis.fetch=antes;
    if(primera)await primera.catch(()=>{});
  }
});
