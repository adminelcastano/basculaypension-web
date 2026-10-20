import test from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {readFileSync} from "node:fs";
import {rutaSalarios,validarPagoSalario,candidatosSalariales} from "../src/finanzas-salarios.js";

function envFake(){
  const sqlite=new DatabaseSync(":memory:");
  sqlite.exec("CREATE TABLE caja_gastos(id TEXT PRIMARY KEY,mes TEXT,dia TEXT,concepto TEXT,monto REAL,origen TEXT,categoria TEXT,creado TEXT);");
  sqlite.exec("CREATE TABLE turno_cortes(dia TEXT,turno TEXT,retiros TEXT); CREATE TABLE caja_mov(dia TEXT,turno TEXT,tipo TEXT,folio TEXT,cliente TEXT,matricula TEXT,importe REAL);");
  sqlite.exec("CREATE TABLE fin_bitacora(id INTEGER PRIMARY KEY AUTOINCREMENT,cuando TEXT,quien TEXT,accion TEXT,que TEXT,ref TEXT,mes TEXT,detalle TEXT)");
  sqlite.prepare("INSERT INTO caja_gastos VALUES(?,?,?,?,?,?,?,?)").run("sueldo-prueba-001","2026-10","2026-10-18","Sueldo turno",2200,"admin","Sueldos","2026-10-18T01:00:00Z");
  sqlite.prepare("INSERT INTO caja_gastos VALUES(?,?,?,?,?,?,?,?)").run("gasto-prueba-002","2026-10","2026-10-18","Gasolina",500,"admin","Transporte","2026-10-18T02:00:00Z");
  const prep=sql=>{
    let args=[];
    return {sql,get args(){return args;},bind(...p){args=p;return this;},
      async all(){return{results:sqlite.prepare(sql).all(...args)};},
      async first(){return sqlite.prepare(sql).get(...args)||null;},
      async run(){const r=sqlite.prepare(sql).run(...args);return{meta:{changes:Number(r.changes)}};}
    };
  };
  return {sqlite,env:{DB:{prepare:prep},SALARIOS_SYNC_ACTIVE:"NO"},close:()=>sqlite.close()};
}
test("Solo se considera un movimiento ya registrado con categoría Sueldos",()=>{
  assert.equal(!!validarPagoSalario({id:"a",dia:"2026-10-20",monto:100,categoria:"Sueldos"}),true);
  assert.equal(!!validarPagoSalario({id:"a",dia:"2026-10-20",monto:100,categoria:"Transporte"}),false);
  assert.equal(!!validarPagoSalario({id:"a",dia:"2026-10-20",monto:0,categoria:"Sueldos"}),false);
});
test("Apagado por defecto: lista solo sueldo conocido y rechaza cualquier escritura",async()=>{
  const e=envFake();
  try{
    const r=await rutaSalarios({method:"GET"},e.env,["finanzas","salarios"],{email:"admin@example.invalid"});
    assert.equal(r.status,200);const d=await r.json();
    assert.equal(d.habilitado,false);
    assert.equal(d.pagos.length,1);
    assert.equal(d.pagos[0].id,"sueldo-prueba-001");
    assert.equal(d.empleados.length,0);
    const invalid=await rutaSalarios({method:"POST",json:async()=>({confirmado:true})},e.env,["finanzas","salarios","sincronizar"],{email:"admin@example.invalid"});
    assert.equal(invalid.status,409);
    assert.equal(e.sqlite.prepare("SELECT COUNT(*) n FROM caja_gastos").get().n,2);
    assert.equal(e.sqlite.prepare("SELECT COUNT(*) n FROM fin_nomina_vinculos").get().n,0);
  }finally{e.close();}
});
test("Un sueldo vinculado que luego cambia de categoría queda señalado, sin escritura a SALARIOS",async()=>{
  const e=envFake();
  try{
    await rutaSalarios({method:"GET"},e.env,["finanzas","salarios"],{email:"admin@example.invalid"});
    e.sqlite.prepare("INSERT INTO fin_nomina_vinculos(gasto_id,colaborador_id,revisado_en,importe_centavos,fecha_fuente,concepto_fuente) VALUES(?,?,?,?,?,?)")
      .run("sueldo-prueba-001","001_FICTICIO_202610","2026-10-20",220000,"2026-10-18","Sueldo turno");
    e.sqlite.prepare("UPDATE caja_gastos SET categoria='Transporte' WHERE id='sueldo-prueba-001'").run();
    const r=await rutaSalarios({method:"GET"},e.env,["finanzas","salarios"],{email:"admin@example.invalid"});
    const x=await r.json();
    assert.equal(x.huerfanos,1);
    assert.equal(x.pagos.length,0);
    assert.match(x.aviso,/conciliar/i);
  }finally{e.close();}
});
test("Cortes y hoja se muestran sólo como candidatos, sin vinculación automática",async()=>{
  const e=envFake();
  try{
    const dia=new Date().toISOString().slice(0,10);
    e.sqlite.prepare("INSERT INTO turno_cortes VALUES(?,?,?)")
      .run(dia,"TARDE",JSON.stringify([{concepto:"SUELDO TURNO",monto:2200},{concepto:"TAXI",monto:90}]));
    e.sqlite.prepare("INSERT INTO caja_mov VALUES(?,?,?,?,?,?,?)")
      .run(dia,"MAÑANA","caja","NÓMINA","Pago",null,-500);
    const r=await rutaSalarios({method:"GET"},e.env,["finanzas","salarios"],{email:"admin@example.invalid"});
    const z=await r.json();
    assert.equal(z.candidatos.length,2);
    assert.ok(z.candidatos.every(x=>x.solo_revision===true));
    assert.equal(z.pagos.length,1);
    assert.equal(z.candidatos.some(x=>x.origen==="Retiro de corte"),true);
    assert.equal(z.candidatos.some(x=>x.origen==="Hoja de caja"),true);
    assert.equal(e.sqlite.prepare("SELECT count(*) n FROM fin_nomina_vinculos").get().n,0);
  }finally{e.close();}
});
test("Retiros repetidos o del mismo monto que un gasto se marcan ambiguos",()=>{
  const dia="2026-10-19";
  const v=candidatosSalariales(
    [{dia,turno:"TARDE",retiros:JSON.stringify([{concepto:"SUELDO SEMANAL",monto:200},{concepto:"SALARIO EXTRA",monto:200}])}],
    [{dia,turno:"TARDE",tipo:"caja",folio:"NOMINA",cliente:"",importe:-200}],
    [{dia,monto:200,categoria:"Sueldos"}]
  );
  assert.equal(v.length,3);
  assert.ok(v.every(x=>x.solo_revision&&x.posible_duplicado));
  assert.deepEqual(v.map(x=>x.monto),[200,200,200]);
});
test("Cambio de importe posterior a la vinculación se detecta aunque siga siendo Sueldos",async()=>{
  const e=envFake();
  try{
    await rutaSalarios({method:"GET"},e.env,["finanzas","salarios"],{email:"admin@example.invalid"});
    e.sqlite.prepare("INSERT INTO fin_nomina_vinculos(gasto_id,colaborador_id,revisado_en,importe_centavos,fecha_fuente,concepto_fuente) VALUES(?,?,?,?,?,?)")
      .run("sueldo-prueba-001","001_FICTICIO_202610","2026-10-20",220000,"2026-10-18","Sueldo turno");
    e.sqlite.prepare("UPDATE caja_gastos SET monto=2210 WHERE id='sueldo-prueba-001'").run();
    const r=await rutaSalarios({method:"GET"},e.env,["finanzas","salarios"],{email:"admin@example.invalid"});
    const z=await r.json();
    assert.equal(z.huerfanos,1);
    assert.equal(z.pagos[0].vinculo_actual,false);
  }finally{e.close();}
});
test("La integración Sheets queda separada de identidades, tokens y datos bancarios",()=>{
  const script=readFileSync(new URL("../herramientas/aviso-correo.gs",import.meta.url),"utf8");
  const bridge=readFileSync(new URL("../src/finanzas-salarios.js",import.meta.url),"utf8");
  assert.match(script,/getProperty\('SALARIOS_SHEET_ID'\)/);
  assert.match(script,/getProperty\('SALARIOS_SYNC_ACTIVE'\)!=='SI'/);
  assert.match(script,/getSheetByName\('Hoja 1'\)/);
  assert.match(script,/getSheetByName\('PAGOS WEB'\)/);
  assert.match(script,/getSheetByName\('RESUMEN SALARIAL'\)/);
  assert.match(bridge,/env\.SALARIOS_SYNC_ACTIVE==="SI"/);
  assert.match(bridge,/syncronizado_en|sincronizado_en/);
  assert.doesNotMatch(bridge,/INSERT INTO caja_gastos|UPDATE caja_gastos|DELETE FROM caja_gastos/);
});
