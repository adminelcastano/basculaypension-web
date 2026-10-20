import test from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {validarEstado,calcularEstado,fechaReal,dineroCentavos,estadosCuentaRuta} from "../src/finanzas-estados.js";

const base={
  cuenta:"cuenta-ficticia",periodo_desde:"2026-09-06",periodo_hasta:"2026-10-05",
  fecha_corte:"2026-10-05",fecha_pago_limite:"",
  saldo_inicial:"1500.00",abonos:"800.00",cargos:"500.00",saldo_final:"1800.00",
  comisiones:"10.00",intereses:"0",iva:"1.60",pago_minimo:"",pago_sin_intereses:"",nota:"Revisión privada"
};
const debito={id:"cuenta-ficticia",tipo:"debito"};
const credito={id:"credito-ficticio",tipo:"credito"};
const entorno=()=>{
  const db=new DatabaseSync(":memory:");
  db.exec("CREATE TABLE fin_cuentas(id TEXT PRIMARY KEY,nombre TEXT,tipo TEXT,activa INTEGER,orden INTEGER);");
  db.prepare("INSERT INTO fin_cuentas VALUES(?,?,?,?,?)").run(debito.id,"CUENTA DE PRUEBA","debito",1,1);
  db.prepare("INSERT INTO fin_cuentas VALUES(?,?,?,?,?)").run(credito.id,"CRÉDITO DE PRUEBA","credito",1,2);
  const prepare=(sql)=>{
    let args=[];
    return{sql,get args(){return args;},bind(...v){args=v;return this;},
      async run(){let r=db.prepare(sql).run(...args);return{meta:{changes:Number(r.changes)}};},
      async first(){return db.prepare(sql).get(...args)||null;},
      async all(){return{results:db.prepare(sql).all(...args)};}
    };
  };
  const env={DB:{prepare,async batch(stmts){db.exec("BEGIN");
    try{const out=stmts.map(q=>({meta:{changes:Number(db.prepare(q.sql).run(...q.args).changes)}}));db.exec("COMMIT");return out;}
    catch(e){db.exec("ROLLBACK");throw e;}
  }}};
  const post=async d=>{const r=await estadosCuentaRuta({method:"POST",json:async()=>d},env,["finanzas","estados-cuenta"],{email:"admin@example.invalid"});
    return{status:r.status,data:await r.json()};};
  const list=async()=>{const r=await estadosCuentaRuta({method:"GET"},env,["finanzas","estados-cuenta"],{email:"admin@example.invalid"});return(await r.json()).estados;};
  return{db,post,list,close:()=>db.close()};
};
test("Fecha de corte y fin de periodo independientes del mes calendario",()=>{
  assert.equal(fechaReal("2026-02-29"),false);
  assert.equal(fechaReal("2024-02-29"),true);
  assert.equal(validarEstado(base,debito).datos.periodo_desde,"2026-09-06");
  assert.equal(validarEstado({...base,periodo_hasta:"2026-08-05"},debito).error!=null,true);
  assert.equal(validarEstado({...base,fecha_corte:"2026-10-06"},debito).error!=null,true);
});
test("Centavos exactos, campos vacíos distinguibles de cero, crédito con signo contrario",()=>{
  assert.equal(dineroCentavos("1,234.56"),123456);
  assert.equal(dineroCentavos("",{opcional:true}),null);
  assert.ok(Number.isNaN(dineroCentavos("30.999")));
  assert.equal(calcularEstado({saldo_inicial:150000,abonos:80000,cargos:50000,saldo_final:180000},"debito").comprobacion,"cuadra");
  assert.equal(calcularEstado({saldo_inicial:150000,abonos:80000,cargos:50000,saldo_final:120000},"credito").comprobacion,"cuadra");
  assert.equal(calcularEstado({saldo_inicial:null,abonos:80000,cargos:50000,saldo_final:120000},"credito").comprobacion,"incompleto");
  assert.ok(validarEstado({...base,pago_minimo:"100"},debito).error);
});
test("Captura bancaria en D1 ficticia, lectura, diferencias e historial de correcciones",async()=>{
 const e=entorno();
 try{
  const first=await e.post(base);assert.equal(first.status,200,JSON.stringify(first));assert.equal(first.data.version,1);
  let list=await e.list();assert.equal(list.length,1);assert.equal(list[0].comprobacion,"cuadra");
  assert.equal(list[0].saldo_final,1800);
  assert.equal(list[0].periodo_desde,"2026-09-06");
  assert.equal(e.db.prepare("SELECT COUNT(*) n FROM fin_estados_cuenta_hist").get().n,1);
  const bad=await e.post({...base, id:first.data.id,version:0,saldo_final:"1900"});
  assert.equal(bad.status,409);
  const revised=await e.post({...base,id:first.data.id,version:1,saldo_final:"1900"});
  assert.equal(revised.status,200,JSON.stringify(revised));assert.equal(revised.data.version,2);
  list=await e.list();assert.equal(list[0].comprobacion,"revisar");assert.equal(list[0].diferencia,100);
  assert.equal(e.db.prepare("SELECT COUNT(*) n FROM fin_estados_cuenta_hist").get().n,2);
  assert.equal(e.db.prepare("SELECT COUNT(*) n FROM fin_bitacora").get().n,2);
  assert.equal((await e.post({...base,id:first.data.id,version:2,saldo_final:"1900"})).data.sin_cambios,true);
 }finally{e.close();}
});
test("Prohíbe solapes de periodos aun si intentan evitar el formulario",async()=>{
 const e=entorno();
 try{
  const first=await e.post(base);assert.equal(first.status,200,JSON.stringify(first));
  assert.equal((await e.post({...base,periodo_desde:"2026-10-01",periodo_hasta:"2026-10-31",fecha_corte:"2026-10-31"})).status,409);
  assert.throws(()=>e.db.prepare("INSERT INTO fin_estados_cuenta(id,cuenta,periodo_desde,periodo_hasta,fecha_corte,version,creado,actualizado) VALUES('bad','cuenta-ficticia','2026-10-03','2026-10-20','2026-10-20',1,'2026-10-20','2026-10-20')").run(),/PERIODO_SUPERPUESTO/);
  assert.equal((await e.list()).length,1);
 }finally{e.close();}
});
test("No registra gastos ni saldo bancario en la captura del estado",async()=>{
 const e=entorno();
 try{
  assert.equal((await e.post({...base,abonos:"",cargos:"",saldo_final:""})).status,200);
  const rows=await e.list();assert.equal(rows[0].comprobacion,"incompleto");
  const tables=e.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(x=>x.name);
  assert.ok(!tables.includes("fin_movs")&&!tables.includes("caja_gastos")&&!tables.includes("fin_saldos_cuenta"));
  assert.ok(tables.includes("fin_estados_cuenta_hist"));
 }finally{e.close();}
});
