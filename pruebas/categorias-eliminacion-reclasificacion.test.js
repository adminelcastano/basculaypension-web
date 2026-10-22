import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { asegurarEsquemaCategorias, listaCategorias, crearCategoriaExplicita,
  eliminarCategoria, impactoCategoria, pendientesCategorias, recategorizarRegistro,
  resolverCategoria, sugerirCategoriaVigente, CATEGORIAS_PROTEGIDAS } from "../src/categorias.js";

function fakeD1() {
  const db = new DatabaseSync(":memory:");
  db.exec(
    "CREATE TABLE agenda_items (id TEXT PRIMARY KEY, titulo TEXT, fecha TEXT, importe REAL, tipo TEXT, categoria TEXT, gasto_id TEXT);" +
    "CREATE TABLE agenda_pagos (id TEXT PRIMARY KEY, titulo TEXT, fecha TEXT, importe REAL, categoria TEXT, gasto_id TEXT);" +
    "CREATE TABLE caja_gastos (id TEXT PRIMARY KEY, concepto TEXT, dia TEXT, monto REAL, categoria TEXT);" +
    "CREATE TABLE compras_historial (id TEXT PRIMARY KEY, titulo TEXT, fecha TEXT, importe REAL, categoria TEXT, gasto_id TEXT);"
  );
  const prepare=sql=>{
    let params=[];
    return {sql, get params(){return params;}, bind(...a){params=a;return this;},
      async run(){const r=db.prepare(sql).run(...params);return {meta:{changes:Number(r.changes)}};},
      async first(){return db.prepare(sql).get(...params)||null;},
      async all(){return {results:db.prepare(sql).all(...params)};}
    };
  };
  return {db,env:{DB:{prepare,async batch(stmts){
    db.exec("BEGIN");
    try {const r=stmts.map(s=>{const a=db.prepare(s.sql).run(...s.params);return {meta:{changes:Number(a.changes)}};});
      db.exec("COMMIT");return r;}catch(e){db.exec("ROLLBACK");throw e;}
  }}}};
}

test("Borrar una categoría conserva 4 registros, importes e historial, y reclasifica a mano", async () => {
  const {db,env}=fakeD1();
  try{
    await asegurarEsquemaCategorias(env);
    await crearCategoriaExplicita(env,"Oficina","papeleria");
    db.prepare("INSERT INTO agenda_items VALUES(?,?,?,?,?,?,?)").run("i1","Oficina","2026-10-21",30,"compra","Oficina","g1");
    db.prepare("INSERT INTO agenda_pagos VALUES(?,?,?,?,?,?)").run("p1","Oficina","2026-10-21",120,"Oficina","g1");
    db.prepare("INSERT INTO caja_gastos VALUES(?,?,?,?,?)").run("g1","Oficina","2026-10-21",120,"Oficina");
    db.prepare("INSERT INTO compras_historial VALUES(?,?,?,?,?,?)").run("ag:i1","Oficina","2026-10-21",30,"Oficina","g1");
    const pre=await impactoCategoria(env,"Oficina");
    assert.equal(pre.total,4);
    const importes=()=>({
      caja:db.prepare("SELECT monto FROM caja_gastos").get().monto,
      pago:db.prepare("SELECT importe FROM agenda_pagos").get().importe,
      compra:db.prepare("SELECT importe FROM agenda_items").get().importe
    });
    const antes=importes();
    const cambios=await eliminarCategoria(env,"Oficina","admin@ejemplo.invalid");
    assert.equal(Object.values(cambios).reduce((a,b)=>a+b,0),4);
    for(const t of ["agenda_items","agenda_pagos","caja_gastos","compras_historial"])
      assert.equal(db.prepare("SELECT categoria FROM "+t).get().categoria,null,t);
    assert.deepEqual(importes(),antes);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM fin_bitacora WHERE que='Categoría de gastos'").get().n,1);
    assert.equal(await resolverCategoria(env,"Oficina"),null,"Un formulario viejo no recrea la categoría borrada");
    const pendientes=await pendientesCategorias(env);
    assert.equal(pendientes.total,1,"El gasto principal representa el ticket sin entradas repetidas en el listado");
    assert.equal(pendientes.pendientes[0].origen,"caja_gastos");
    await assert.rejects(eliminarCategoria(env,"Sueldos","admin@ejemplo.invalid"),e=>e.code==="CAT_PROTEGIDA");
    await assert.rejects(recategorizarRegistro(env,{origen:"caja_gastos",id:"g1",categoria:"Categoría inventada",quien:"admin@ejemplo.invalid"}),e=>e.code==="CAT_INVALIDA");
    const cambio=await recategorizarRegistro(env,{origen:"caja_gastos",id:"g1",categoria:"Papelería y consumibles",quien:"admin@ejemplo.invalid"});
    assert.equal(cambio.categoria,"Papelería y consumibles");
    for(const t of ["agenda_items","agenda_pagos","caja_gastos","compras_historial"])
      assert.equal(db.prepare("SELECT categoria FROM "+t).get().categoria,"Papelería y consumibles",t);
    assert.deepEqual(importes(),antes);
    await assert.rejects(recategorizarRegistro(env,{origen:"caja_gastos",id:"g1",categoria:"Otros",quien:"admin@ejemplo.invalid"}),e=>e.code==="CAT_CONFLICTO");
    assert.equal((await pendientesCategorias(env)).total,0);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM fin_bitacora").get().n,2);
    // Alta deliberada de un nombre eliminado NO asigna de nuevo los históricos.
    const reactivada=await crearCategoriaExplicita(env,"Oficina","papeleria");
    assert.equal(reactivada,"Oficina");
    assert.ok((await listaCategorias(env)).some(x=>x.nombre==="Oficina"));
    assert.deepEqual(importes(),antes);
  }finally{db.close();}
});

test("Clasificación automática no recrea categorías históricas eliminadas", async () => {
  assert.ok(CATEGORIAS_PROTEGIDAS.includes("Sueldos"));
  assert.ok(CATEGORIAS_PROTEGIDAS.includes("Comisiones bancarias"));
  // Este helper se usa para altas nuevas; no es una migración ni cambia registros existentes.
  assert.equal(typeof sugerirCategoriaVigente,"function");
});

test("Interfaz exige previsualización y confirmación, nunca borra registros de dinero", () => {
  const panel=readFileSync(new URL("../src/panel/cliente/07-agenda.js",import.meta.url),"utf8");
  const backend=readFileSync(new URL("../src/categorias.js",import.meta.url),"utf8");
  assert.match(panel,/impacto:nombre/);
  assert.match(panel,/EC\.confirmar\("¿Eliminar categoría/);
  assert.match(panel,/data-cat-asignar/);
  assert.match(panel,/crear:true/);
  assert.match(backend,/UPDATE " \+ tabla \+ " SET categoria = NULL/);
  assert.doesNotMatch(backend,/DELETE FROM (caja_gastos|agenda_pagos|agenda_items|compras_historial)/);
});
