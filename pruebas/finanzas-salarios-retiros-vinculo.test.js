import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { rutaSalarios, candidatosSalariales, validarVinculoRetiro } from "../src/finanzas-salarios.js";
import { leerRetiros } from "../src/caja.js";

const uuid="00000000-0000-4000-8000-0000000000aa";
const dia=new Date().toISOString().slice(0,10);
const rSueldo=()=>({id:uuid,concepto:"Sueldo semanal",monto:1200.50});
function entorno(){
  const db=new DatabaseSync(":memory:");
  db.exec("CREATE TABLE caja_gastos(id TEXT PRIMARY KEY,mes TEXT,dia TEXT,concepto TEXT,monto REAL,origen TEXT,forma TEXT,cuenta TEXT,categoria TEXT,creado TEXT)");
  db.exec("CREATE TABLE turno_cortes(dia TEXT,turno TEXT,retiros TEXT,PRIMARY KEY(dia,turno))");
  db.exec("CREATE TABLE caja_mov(dia TEXT,turno TEXT,tipo TEXT,folio TEXT,cliente TEXT,matricula TEXT,importe REAL)");
  db.exec("CREATE TABLE fin_bitacora(id INTEGER PRIMARY KEY AUTOINCREMENT,cuando TEXT,quien TEXT,accion TEXT,que TEXT,ref TEXT,mes TEXT,detalle TEXT)");
  const prepare=(sql)=>{
    let args=[];
    return{sql,get args(){return args;},bind(...a){args=a;return this;},
      async first(){return db.prepare(sql).get(...args)||null;},
      async all(){return{results:db.prepare(sql).all(...args)};},
      async run(){const r=db.prepare(sql).run(...args);return{meta:{changes:Number(r.changes)}};}
    };
  };
  const env={DB:{prepare,async batch(stmts){db.exec("BEGIN");try{
    const out=stmts.map(x=>({meta:{changes:Number(db.prepare(x.sql).run(...x.args).changes)}}));
    db.exec("COMMIT");return out;
  }catch(e){db.exec("ROLLBACK");throw e;}}},SALARIOS_SYNC_ACTIVE:"SI",
    AVISO_URL:"https://example.invalid/hoja-ficticia",AVISO_TOKEN:"TEST-NO-REAL"};
  const recibidos=new Map(), solicitudes=[];
  const previousFetch=globalThis.fetch;
  globalThis.fetch=async (url,options)=>{
    assert.equal(url,env.AVISO_URL);
    const input=JSON.parse(options.body);solicitudes.push(input.op);
    if(input.op==="catalogo")
      return new Response(JSON.stringify({ok:true,colaboradores:[{id:"001_FICTICIO_A",nombre:"FICTICIO A"},{id:"002_FICTICIO_B",nombre:"FICTICIO B"}]}));
    if(input.op==="pagos") {
      for(const row of input.filas){
        const actual=recibidos.get(row.id);
        if(actual&&JSON.stringify(actual)!==JSON.stringify(row))
          return new Response(JSON.stringify({ok:false,error:"Una fila ya existe con otros datos"}));
      }
      for(const row of input.filas)recibidos.set(row.id,row);
      return new Response(JSON.stringify({ok:true,aceptados:input.filas.map(x=>x.id)}));
    }
    throw Error("Operación inesperada");
  };
  db.prepare("INSERT INTO turno_cortes VALUES(?,?,?)").run(dia,"TARDE",JSON.stringify([rSueldo()]));
  const post=async(op,body)=>{const r=await rutaSalarios({method:"POST",json:async()=>body},env,["finanzas","salarios",op],{email:"admin@example.invalid"});return{status:r.status,data:await r.json()};};
  const get=async()=>{const r=await rutaSalarios({method:"GET"},env,["finanzas","salarios"],{email:"admin@example.invalid"});return await r.json();};
  return{env,db,recibidos,solicitudes,post,get,close(){globalThis.fetch=previousFetch;db.close();}};
}
test("Un retiro nuevo conserva ID en JSON; uno antiguo no se identifica por la posición",()=>{
  const actuales=leerRetiros(JSON.stringify([rSueldo(),{concepto:"Sueldo sin ID",monto:200}]));
  assert.equal(actuales[0].id,uuid);
  assert.equal(actuales[1].id,undefined);
  const c=candidatosSalariales([{dia,turno:"TARDE",retiros:JSON.stringify(actuales)}],[],[]);
  assert.equal(c.length,2);
  assert.equal(c.find(x=>x.retiro_id===uuid).identificador_estable,true);
  assert.equal(c.find(x=>!x.retiro_id).identificador_estable,false);
  const tablet=readFileSync(new URL("../src/turno.html",import.meta.url),"utf8");
  const server=readFileSync(new URL("../src/turno.js",import.meta.url),"utf8");
  assert.match(tablet,/data-retiro-id/);
  assert.match(tablet,/id: x\.dataset\.retiroId/);
  assert.match(server,/crypto\.randomUUID\(\)/);
  assert.match(server,/new Set\(retiroIDs\)\.size/);
});
test("Vinculación de retiro requiere confirmación, identificador real y catálogo",async()=>{
  const e=entorno();
  try{
    const antes=await e.get();
    assert.equal(antes.candidatos[0].identificador_estable,true);
    const form={retiro_id:uuid,colaborador_id:"001_FICTICIO_A"};
    assert.equal((await e.post("vincular-retiro",form)).status,422);
    assert.equal((await e.post("vincular-retiro",{...form,confirmado:true,colaborador_id:"999_FAKE"})).status,409);
    assert.equal((await e.post("vincular-retiro",{...form,confirmado:true})).status,200);
    assert.equal(e.db.prepare("SELECT COUNT(*) n FROM fin_nomina_retiros").get().n,1);
    assert.equal(e.db.prepare("SELECT COUNT(*) n FROM caja_gastos").get().n,0);
    const despues=await e.get();
    assert.equal(despues.candidatos[0].vinculo.colaborador_id,"001_FICTICIO_A");
    assert.equal(despues.candidatos[0].vinculo_actual,true);
  }finally{e.close();}
});
test("Dos confirmaciones del mismo retiro jamás crean dos pagos en la hoja simulada",async()=>{
  const e=entorno();
  try{
    const a={retiro_id:uuid,colaborador_id:"001_FICTICIO_A",confirmado:true};
    assert.equal((await e.post("vincular-retiro",a)).status,200);
    assert.equal((await e.post("vincular-retiro",a)).data.sin_cambios,true);
    assert.equal((await e.post("sincronizar",{confirmado:true})).status,200);
    assert.equal(e.recibidos.size,1);
    const row=e.recibidos.get("ret-"+uuid);
    assert.equal(row.origen,"turno_cortes");
    assert.equal(row.fecha,dia);
    assert.equal(row.forma,"EFECTIVO");
    assert.equal(row.importe,1200.50);
    assert.equal(row.colaborador_id,"001_FICTICIO_A");
    assert.equal((await e.post("sincronizar",{confirmado:true})).data.sin_cambios,true);
    assert.equal(e.recibidos.size,1);
    assert.equal((await e.post("vincular-retiro",{...a,colaborador_id:"002_FICTICIO_B"})).status,409);
  }finally{e.close();}
});
test("Si se corrige el retiro vinculado, no se sincroniza el importe antiguo",async()=>{
  const e=entorno();
  try{
    assert.equal((await e.post("vincular-retiro",{retiro_id:uuid,colaborador_id:"001_FICTICIO_A",confirmado:true})).status,200);
    e.db.prepare("UPDATE turno_cortes SET retiros=? WHERE dia=? AND turno=?").run(JSON.stringify([{...rSueldo(),monto:1250}]),dia,"TARDE");
    const d=await e.get();
    assert.equal(d.huerfanos_retiros,1);
    assert.equal(d.candidatos[0].vinculo_actual,false);
    const sync=await e.post("sincronizar",{confirmado:true});
    assert.equal(sync.status,409);
    assert.equal(e.recibidos.size,0);
    assert.equal(validarVinculoRetiro({retiro_id:uuid,dia,turno:"TARDE",concepto_fuente:"Sueldo semanal",importe_centavos:120050},
      [{dia,turno:"TARDE",retiros:JSON.stringify([{...rSueldo(),monto:1250}])}]),false);
  }finally{e.close();}
});
test("Dos retiros con mismo importe son ambiguos y necesitan confirmación adicional",async()=>{
  const e=entorno();
  try{
    e.db.prepare("UPDATE turno_cortes SET retiros=? WHERE dia=? AND turno=?").run(JSON.stringify([
      rSueldo(),{id:"00000000-0000-4000-8000-0000000000bb",concepto:"Otro sueldo",monto:1200.50}
    ]),dia,"TARDE");
    const c=(await e.get()).candidatos.find(x=>x.retiro_id===uuid);
    assert.equal(c.posible_duplicado,true);
    const body={retiro_id:uuid,colaborador_id:"001_FICTICIO_A",confirmado:true};
    assert.equal((await e.post("vincular-retiro",body)).status,409);
    assert.equal((await e.post("vincular-retiro",{...body,confirmado_distinto:true})).status,200);
  }finally{e.close();}
});
