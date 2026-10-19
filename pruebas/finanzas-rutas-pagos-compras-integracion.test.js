// Integración de rutas reales de pagos y compras, con motor SQLite de D1 y sin credenciales.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { agendaPanel, asegurarEsquemaAgenda } from "../src/agenda.js";
import { asegurarEsquemaCaja } from "../src/caja.js";
import { asegurarEsquemaCuentas } from "../src/cuentas.js";

const hoy=new Intl.DateTimeFormat("en-CA",{timeZone:"America/Mexico_City"}).format(new Date());
const actor={email:"ensayo@invalid.example"};
function entorno() {
  const db=new DatabaseSync(":memory:");
  const kv=new Map();
  const stmt=(sql,args=[])=>({
    sql,args,
    bind(...values){return stmt(sql,values)},
    async all(){return {results:db.prepare(sql).all(...args)}},
    async first(){return db.prepare(sql).get(...args)||null},
    async run(){const r=db.prepare(sql).run(...args);return {success:true,meta:{changes:Number(r.changes||0)}}}
  });
  const DB={prepare:sql=>stmt(sql),async batch(sentencias){
    db.exec("BEGIN IMMEDIATE");
    try {
      const out=sentencias.map(s=>{
        const cmd=s.sql.trim().split(/\s+/)[0].toUpperCase();
        if(["SELECT","PRAGMA","WITH"].includes(cmd))return {success:true,results:db.prepare(s.sql).all(...s.args),meta:{changes:0}};
        const r=db.prepare(s.sql).run(...s.args);
        return {success:true,results:[],meta:{changes:Number(r.changes||0)}};
      });
      db.exec("COMMIT");return out;
    }catch(err){db.exec("ROLLBACK");throw err}
  }};
  const env={DB,FILES:{async get(k){return kv.get(k)||null},async put(k,v){kv.set(k,v)},async delete(k){kv.delete(k)}}};
  return {db,env};
}
async function iniciar(env) {
  await asegurarEsquemaAgenda(env);
  await asegurarEsquemaCaja(env);
  await asegurarEsquemaCuentas(env);
}
async function post(env,path,datos){
  const url=new URL("https://ensayo.invalid/panel/api/agenda/"+path);
  const p=["agenda",...path.split("/")];
  const req=new Request(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(datos)});
  const response=await agendaPanel(req,env,url,p,actor);
  return {status:response.status,data:await response.json()};
}
const shared=entorno();
await iniciar(shared.env);
after(()=>shared.db.close());

test("Ruta real de pago suelto: un reintento no duplica egreso, cuenta ni bitácora",async()=>{
  const {db,env}=shared;
  try {
    const uid="cc000001-2222-4333-8444-555555555555";
    const p={uid,fecha:hoy,importe:"345.60",titulo:"Recibo sintético",forma:"C:bbva-pyme",categoria:"Servicios",nota:"Ensayo"};
    const primero=await post(env,"pagos/hecho",p);
    assert.equal(primero.status,200,JSON.stringify(primero));
    assert.ok(primero.data.id);
    const segundo=await post(env,"pagos/hecho",p);
    assert.equal(segundo.status,200,JSON.stringify(segundo));
    assert.equal(segundo.data.repetido,true);
    assert.equal(segundo.data.id,primero.data.id);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM agenda_pagos").get().n,1);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM caja_gastos").get().n,1);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM fin_bitacora WHERE que='Pago no programado'").get().n,1);
    const gasto=db.prepare("SELECT cuenta,forma,monto,origen FROM caja_gastos").get();
    assert.deepEqual({...gasto},{cuenta:"bbva-pyme",forma:"TRANSFERENCIA",monto:345.6,origen:"admin"});
    const distinto=await post(env,"pagos/hecho",{...p,importe:"445.60"});
    assert.equal(distinto.status,409);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM caja_gastos").get().n,1);
  }finally{}
});
test("Ruta real de pago programado: reintento tras avanzar el vencimiento",async()=>{
  const {db,env}=shared;
  try {
    db.prepare("INSERT INTO agenda_items(id,tipo,titulo,fecha,estado,frecuencia,forma,importe,creado) VALUES(?,?,?,?,?,?,?,?,?)")
      .run("ensayo-programado","pago","Teléfono sintético",hoy,"pendiente","mensual","TRANSFERENCIA",399,"2026-10-18T01:00:00Z");
    const uid="cc000002-2222-4333-8444-555555555555";
    const pago={uid,fecha:hoy,importe:"399",forma:"C:bbva-pyme",nota:"SINTETICO",categoria:"Servicios"};
    const primero=await post(env,"ensayo-programado/pagar",pago);
    assert.equal(primero.status,200,JSON.stringify(primero));
    const anterior=db.prepare("SELECT fecha FROM agenda_items WHERE id='ensayo-programado'").get().fecha;
    assert.notEqual(anterior,hoy,"El vencimiento mensual debe avanzar");
    const repetido=await post(env,"ensayo-programado/pagar",pago);
    assert.equal(repetido.status,200,JSON.stringify(repetido));
    assert.equal(repetido.data.repetido,true);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM agenda_pagos WHERE item_id = 'ensayo-programado'").get().n,1);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM caja_gastos WHERE concepto = 'Pago: Teléfono sintético'").get().n,1);
    assert.equal(db.prepare("SELECT fecha FROM agenda_items WHERE id='ensayo-programado'").get().fecha,anterior);
    const cambio=await post(env,"ensayo-programado/pagar",{...pago,importe:"450"});
    assert.equal(cambio.status,409);
  }finally{}
});
test("Ruta real de carrito: dos UIDs no compran los mismos artículos y mantienen la cuenta",async()=>{
  const {db,env}=shared;
  try {
    for(const id of ["ensayo-compra-1","ensayo-compra-2"])
      db.prepare("INSERT INTO agenda_items(id,tipo,titulo,estado,creado) VALUES(?, 'compra',?, 'pendiente',?)")
        .run(id,id,"2026-10-18T01:00:00Z");
    const compra={ids:["ensayo-compra-1","ensayo-compra-2"],total:"175.00",
      precios:{"ensayo-compra-1":"100","ensayo-compra-2":"75"},
      forma:"C:bbva-pyme",fecha_compra:hoy};
    const a=await post(env,"compras/terminar",{...compra,uid:"cc000003-2222-4333-8444-555555555555"});
    assert.equal(a.status,200,JSON.stringify(a));
    const retry=await post(env,"compras/terminar",{...compra,uid:"cc000003-2222-4333-8444-555555555555"});
    assert.equal(retry.status,200,JSON.stringify(retry));
    assert.equal(retry.data.repetido,true);
    assert.equal(db.prepare("SELECT cuenta FROM caja_gastos WHERE id=?").get(a.data.gasto_id).cuenta,"bbva-pyme");
    const otro=await post(env,"compras/terminar",{...compra,uid:"cc000004-2222-4333-8444-555555555555"});
    assert.equal(otro.status,409,JSON.stringify(otro));
    assert.equal(db.prepare("SELECT COUNT(*) n FROM caja_gastos WHERE id = ?").get(a.data.gasto_id).n,1);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM compras_historial").get().n,2);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM agenda_items WHERE estado='comprado'").get().n,2);
  }finally{}
});

test("Corrección de pago ya hecho modifica el recibo y su egreso juntos, sin doble gasto",async()=>{
  const {db,env}=shared;
  const viejo=db.prepare("SELECT * FROM agenda_pagos WHERE item_id='' AND titulo='Recibo sintético'").get();
  assert.ok(viejo);
  const resp=await post(env,"pagos/"+viejo.id+"/editar",{
    fecha:hoy,importe:"410.25",titulo:"Recibo sintético revisado",
    forma:"C:mdo-pago",nota:"Corrección de prueba",categoria:"Servicios"
  });
  assert.equal(resp.status,200,JSON.stringify(resp));
  const pago=db.prepare("SELECT * FROM agenda_pagos WHERE id=?").get(viejo.id);
  const gasto=db.prepare("SELECT * FROM caja_gastos WHERE id=?").get(viejo.gasto_id);
  assert.equal(pago.importe,410.25);
  assert.equal(gasto.monto,410.25);
  assert.equal(pago.titulo,"Recibo sintético revisado");
  assert.equal(gasto.concepto,"Pago: Recibo sintético revisado");
  assert.equal(pago.cuenta,"mdo-pago");
  assert.equal(gasto.cuenta,"mdo-pago");
  assert.equal(db.prepare("SELECT COUNT(*) n FROM agenda_pagos WHERE id=?").get(viejo.id).n,1);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM caja_gastos WHERE id=?").get(viejo.gasto_id).n,1);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM fin_bitacora WHERE ref=? AND accion='editar'").get(viejo.id).n,1);
});

test("Eliminación de pago hecho retira un único recibo y su gasto, conservando bitácora",async()=>{
  const {db,env}=shared;
  const p=db.prepare("SELECT * FROM agenda_pagos WHERE item_id='' AND titulo='Recibo sintético revisado'").get();
  assert.ok(p);
  const resp=await post(env,"pagos/"+p.id+"/eliminar",{});
  assert.equal(resp.status,200,JSON.stringify(resp));
  assert.equal(db.prepare("SELECT COUNT(*) n FROM agenda_pagos WHERE id=?").get(p.id).n,0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM caja_gastos WHERE id=?").get(p.gasto_id).n,0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM fin_bitacora WHERE ref=? AND accion='borrar'").get(p.id).n,1);
  const repeated=await post(env,"pagos/"+p.id+"/eliminar",{});
  assert.equal(repeated.status,404);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM fin_bitacora WHERE ref=? AND accion='borrar'").get(p.id).n,1);
});

test("Anular el último pago programado restituye el vencimiento y suprime su egreso",async()=>{
  const {db,env}=shared;
  const p=db.prepare("SELECT * FROM agenda_pagos WHERE item_id='ensayo-programado'").get();
  assert.ok(p && p.programado);
  const fechaAnterior=p.programado;
  const resp=await post(env,"pagos/"+p.id+"/eliminar",{});
  assert.equal(resp.status,200,JSON.stringify(resp));
  assert.equal(db.prepare("SELECT COUNT(*) n FROM agenda_pagos WHERE id=?").get(p.id).n,0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM caja_gastos WHERE id=?").get(p.gasto_id).n,0);
  assert.equal(db.prepare("SELECT fecha FROM agenda_items WHERE id='ensayo-programado'").get().fecha,fechaAnterior);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM fin_bitacora WHERE ref=? AND accion='borrar'").get(p.id).n,1);
});
