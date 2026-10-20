import test from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {readFileSync} from "node:fs";
import {rutaSalarios,validarPagoSalario} from "../src/finanzas-salarios.js";

function envFake(){
  const sqlite=new DatabaseSync(":memory:");
  sqlite.exec("CREATE TABLE caja_gastos(id TEXT PRIMARY KEY,mes TEXT,dia TEXT,concepto TEXT,monto REAL,origen TEXT,categoria TEXT,creado TEXT);");
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
