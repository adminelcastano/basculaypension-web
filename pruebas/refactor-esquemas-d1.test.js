import {test} from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {inspeccionar,MODULOS} from "../scripts/refactor-esquemas-d1.mjs";
import {asegurarEsquemaCompras} from "../src/compras.js";
test("Inventario D1: módulos antiguos mantienen tablas, índices y sin DROP",()=>{
 const x=inspeccionar(),tabla=Object.fromEntries(x.map(y=>[y.modulo,y]));
 assert.equal(x.length,MODULOS.length);
 assert.equal(tabla.caja.crear_tablas,14);
 assert.equal(tabla.agenda.crear_tablas,5);
 assert.equal(tabla.personal.crear_tablas,4);
 assert.equal(tabla.compras.crear_tablas,1);
 assert.ok(x.every(y=>y.drop_table===0),"Se introdujo SQL destructivo: revisión obligatoria");
 assert.ok(x.every(y=>y.banderas_inicializacion===1),"Revisar estrategia y compatibilidad de inicialización");
});
test("Compras: inicialización aditiva preserva fila previa e índices en SQLite aislada",async t=>{
 const db=new DatabaseSync(":memory:");t.after(()=>db.close());
 db.exec("CREATE TABLE agenda_items (id TEXT, titulo TEXT, lugar TEXT, cantidad TEXT, importe REAL, gasto_id TEXT, categoria TEXT, creado TEXT, actualizado TEXT, cerrado TEXT, estado TEXT, tipo TEXT)");
 db.prepare("INSERT INTO agenda_items (id,titulo,estado,tipo,creado) VALUES (?,?,?,?,?)").run("antiguo","Papel","comprado","compra","2026-10-01");
 const env={DB:{prepare(sql){const stmt=db.prepare(sql);
  const wrap=vals=>({bind(...v){return wrap(v);},async run(){return {meta:{changes:Number(stmt.run(...vals).changes)}};},
   async first(){return stmt.get(...vals)||null;},async all(){return{results:stmt.all(...vals)}}});
  return wrap([]);},async batch(stmts){const out=[];for(const st of stmts)out.push(await st.run());return out;}}};
 await asegurarEsquemaCompras(env);
 assert.equal(db.prepare("SELECT COUNT(*) n FROM agenda_items").get().n,1);
 assert.equal(db.prepare("SELECT COUNT(*) n FROM compras_historial").get().n,1);
 assert.equal(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name='compras_hist_norm'").get().n,1);
 await asegurarEsquemaCompras(env);
 assert.equal(db.prepare("SELECT COUNT(*) n FROM compras_historial").get().n,1);
});