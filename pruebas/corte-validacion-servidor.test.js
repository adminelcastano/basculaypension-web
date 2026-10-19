import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const server=readFileSync(new URL("../src/turno.js",import.meta.url),"utf8");
const tablet=readFileSync(new URL("../src/turno.html",import.meta.url),"utf8");

test("La tablet envía confirmación expresa de pagos distintos",()=>{
  assert.match(tablet,/pagos_distintos_confirmados:\s*!!\$\("#dup-confirmo"\)\?\.checked/);
  assert.match(tablet,/Confirmo que son pagos distintos/);
  const scripts=[...tablet.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(x=>x[1]);
  scripts.filter(s=>s.trim()).forEach(s=>assert.doesNotThrow(()=>new Function(s)));
});

test("El servidor bloquea la coincidencia salvo confirmación expresa",()=>{
  assert.match(server,/const gastosPrevios = \(await env\.DB\.prepare/);
  assert.match(server,/WHERE dia = \? AND turno = \?/);
  assert.match(server,/AND forma = 'EFECTIVO'/);
  assert.match(server,/coinciden\.length && c\.pagos_distintos_confirmados !== true/);
  assert.match(server,/Posible gasto duplicado al repartir/);
  assert.match(server,/INSERT INTO turno_cortes_hist/);
});

test("No descarta gastos ni retiros ni sobres y mantiene la igualdad del reparto",()=>{
  assert.match(server,/const repartido = sobre \+ cambioSig \+ retiros\.reduce/);
  assert.match(server,/const difRep = Math\.round/);
  assert.match(server,/JSON\.stringify\(retiros\)/);
  assert.doesNotMatch(server,/DELETE FROM caja_gastos WHERE dia = \? AND turno = \?/);
});

test("SQLite real: un corte entregado impide gastos e ingresos tardíos",()=>{
  const signo=String.fromCharCode(36)+"{tabla}";
  const extraer=inicio=>{
    const pos=server.indexOf(inicio);
    assert.ok(pos>=0,"Falta SQL: "+inicio);
    return server.slice(pos,server.indexOf(String.fromCharCode(96),pos));
  };
  const insertarGasto=extraer("INSERT INTO caja_gastos\n        (id, mes, dia, turno, concepto, monto");
  const insertarExtra=extraer("INSERT INTO caja_extra\n        (id, mes, dia, turno, concepto, detalle");
  const deleteSql=extraer("DELETE FROM "+signo+"\n      WHERE id = ? AND persona = ? AND dia = ? AND turno = ?");
  for(const sql of [insertarGasto,insertarExtra,deleteSql])
    assert.match(sql,/NOT EXISTS \(SELECT 1 FROM turno_cortes WHERE dia = \? AND turno = \?\)/);
  assert.match(server,/if \(!guardado\.meta\?\.changes\)[\s\S]*?borrarArchivo\(env, foto\)/);
  assert.match(server,/if \(!borrado\.meta\?\.changes\)[\s\S]*?no se borró nada/i);
  const db=new DatabaseSync(":memory:");
  try{
    db.exec([
      "CREATE TABLE turno_cortes (dia TEXT, turno TEXT, PRIMARY KEY(dia,turno))",
      "CREATE TABLE caja_gastos (id TEXT PRIMARY KEY,mes TEXT,dia TEXT,turno TEXT,concepto TEXT,monto REAL,forma TEXT,creado TEXT,creado_por TEXT,foto TEXT,persona TEXT,categoria TEXT)",
      "CREATE TABLE caja_extra (id TEXT PRIMARY KEY,mes TEXT,dia TEXT,turno TEXT,concepto TEXT,detalle TEXT,monto REAL,ingreso INTEGER,foto TEXT,persona TEXT,creado TEXT,creado_por TEXT)"
    ].join(";"));
    const dia="2026-10-18",turno="MAÑANA",persona="PRUEBA";
    const gastoArgs=id=>[id,"2026-10",dia,turno,"Herramienta sintética",32.5,dia+"T10:00:00Z","tablet:PRUEBA",null,persona,"Otros",dia,turno];
    const extraArgs=id=>[id,"2026-10",dia,turno,"Renta","ficticia",15,1,null,persona,dia+"T10:05:00Z","tablet:PRUEBA",dia,turno];
    assert.equal(Number(db.prepare(insertarGasto).run(...gastoArgs("g1")).changes),1);
    assert.equal(Number(db.prepare(insertarExtra).run(...extraArgs("e1")).changes),1);
    db.prepare("INSERT INTO turno_cortes (dia,turno) VALUES (?,?)").run(dia,turno);
    assert.equal(Number(db.prepare(insertarGasto).run(...gastoArgs("g2")).changes),0);
    assert.equal(Number(db.prepare(insertarExtra).run(...extraArgs("e2")).changes),0);
    for(const tabla of ["caja_gastos","caja_extra"]){
      const clave=tabla==="caja_gastos"?"g1":"e1";
      const sql=deleteSql.replace(signo,tabla);
      assert.equal(Number(db.prepare(sql).run(clave,persona,dia,turno,dia,turno).changes),0,
        "No borrar después del corte "+tabla);
      assert.equal(db.prepare("SELECT COUNT(*) n FROM "+tabla).get().n,1);
    }
    db.prepare("DELETE FROM turno_cortes WHERE dia=? AND turno=?").run(dia,turno);
    assert.equal(Number(db.prepare(deleteSql.replace(signo,"caja_gastos")).run("g1",persona,dia,turno,dia,turno).changes),1);
    assert.equal(Number(db.prepare(deleteSql.replace(signo,"caja_extra")).run("e1",persona,dia,turno,dia,turno).changes),1);
  }finally{db.close()}
});
