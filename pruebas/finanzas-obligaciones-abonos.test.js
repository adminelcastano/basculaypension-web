// Contratos reales de D1 ficticia: una deuda, muchos abonos, un solo gasto por pago.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { agendaPanel, asegurarEsquemaAgenda } from "../src/agenda.js";
import { asegurarEsquemaCaja } from "../src/caja.js";
import { asegurarEsquemaCuentas } from "../src/cuentas.js";
import { obligacionesRuta, asegurarEsquemaObligaciones } from "../src/finanzas-obligaciones.js";
const hoy = new Intl.DateTimeFormat("en-CA",{timeZone:"America/Mexico_City"}).format(new Date());
const dia=String(hoy);
const fechaVenc=new Date(hoy+"T12:00:00Z"); fechaVenc.setUTCDate(fechaVenc.getUTCDate()+15);
const vence=fechaVenc.toISOString().slice(0,10);
const actor={email:"ensayo-obligacion@invalid.example"};
const db=new DatabaseSync(":memory:");
const stmt=(sql,args=[])=>({
 sql,args,bind(...v){return stmt(sql,v);},
 async all(){return {results:db.prepare(sql).all(...args)};},
 async first(){return db.prepare(sql).get(...args)||null;},
 async run(){const r=db.prepare(sql).run(...args);return {meta:{changes:Number(r.changes||0)}};}
});
const env={DB:{prepare:sql=>stmt(sql),async batch(qs){
 db.exec("BEGIN IMMEDIATE");
 try{const rows=qs.map(q=>{const op=q.sql.trim().split(/\s+/)[0].toUpperCase();
   if(["SELECT","PRAGMA","WITH"].includes(op))return{meta:{changes:0},results:db.prepare(q.sql).all(...q.args)};
   const r=db.prepare(q.sql).run(...q.args);return{meta:{changes:Number(r.changes||0)}};
 });db.exec("COMMIT");return rows;}catch(e){db.exec("ROLLBACK");throw e;}
}},FILES:{async get(){return null},async put(){},async delete(){}}};
const req=(m,path,body)=>new Request("https://ensayo.invalid/panel/api/"+path,{method:m,
 ...(body?{headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}:{})});
async function obl(body,path="finanzas/obligaciones",method="POST"){
 const r=await obligacionesRuta(req(method,path,body),env,path.split("/"),actor);
 return {status:r.status,data:await r.json()};
}
async function pago(path,body){
 const full="agenda/"+path,request=req("POST",full,body);
 const r=await agendaPanel(request,env,new URL(request.url),full.split("/"),actor);
 return {status:r.status,data:await r.json()};
}
test("Obligaciones confirmadas: dos abonos atómicos, reintentos, límites y reversión", async()=>{
 try{
  await asegurarEsquemaAgenda(env);
  await asegurarEsquemaCaja(env);
  await asegurarEsquemaCuentas(env);
  await asegurarEsquemaObligaciones(env);
  const c={uid:"obligacion-unica-2026",acreedor:"Proveedor ficticio",concepto:"Reparación sintética",
    total:"200.55",vencimiento:vence,emision:dia,referencia:"S-2026",nota:"Solo prueba"};
  const uno=await obl(c);assert.equal(uno.status,200,JSON.stringify(uno));
  const id=uno.data.id;
  assert.equal((await obl(c)).data.repetido,true);
  let historia=(await obl(null,"finanzas/obligaciones/"+id,"GET")).data;
  assert.equal(historia.historial.length,1);
  assert.equal(historia.historial[0].version,1);
  assert.equal(historia.historial[0].foto.total,200.55);
  assert.equal((await obl({...c,total:"200.56"})).status,409);
  const listar=async()=> (await obl(null,"finanzas/obligaciones","GET")).data;
  let list=await listar();
  assert.equal(list.resumen.pendiente,200.55);
  assert.equal(list.obligaciones[0].situacion,"pendiente");
  assert.equal(db.prepare("SELECT COUNT(*) n FROM caja_gastos").get().n,0,"Crear obligación no genera gasto");
  const base={fecha:dia,forma:"C:bbva-pyme",categoria:"Servicios",titulo:"Abono a proveedor ficticio",nota:"Prueba",obligacion_id:id};
  const primero=await pago("pagos/hecho",{...base,uid:"uid-primer-abono-2026",importe:"80.25"});
  assert.equal(primero.status,200,JSON.stringify(primero));
  assert.equal((await pago("pagos/hecho",{...base,uid:"uid-primer-abono-2026",importe:"80.25"})).data.repetido,true);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM caja_gastos").get().n,1);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM agenda_pagos").get().n,1);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM fin_obl_abonos").get().n,1);
  const excesivo=await pago("pagos/hecho",{...base,uid:"uid-abono-excesivo-2026",importe:"120.31"});
  assert.equal(excesivo.status,409,JSON.stringify(excesivo));
  assert.equal(db.prepare("SELECT COUNT(*) n FROM caja_gastos").get().n,1,"Abono rechazado revierte egreso y pago");
  const segundo=await pago("pagos/hecho",{...base,uid:"uid-segundo-abono-2026",importe:"120.30"});
  assert.equal(segundo.status,200,JSON.stringify(segundo));
  list=await listar();
  assert.deepEqual([list.obligaciones[0].pagado,list.obligaciones[0].saldo,list.obligaciones[0].situacion],[200.55,0,"liquidada"]);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM caja_gastos").get().n,2,"Exactamente un egreso por abono");
  assert.equal((await obl({accion:"cancelar",version:1},"finanzas/obligaciones/"+id)).status,409);
  assert.equal((await obl({...c,accion:"editar",version:1,total:"200.54"},"finanzas/obligaciones/"+id)).status,409);
  const editar=await pago("pagos/"+primero.data.id+"/editar",{...base,importe:"80.26"});
  assert.equal(editar.status,409,JSON.stringify(editar));
  assert.equal(db.prepare("SELECT ROUND(SUM(monto)*100) v FROM caja_gastos").get().v,20055);
  const borrar=await pago("pagos/"+segundo.data.id+"/eliminar",{});
  assert.equal(borrar.status,200,JSON.stringify(borrar));
  assert.equal(db.prepare("SELECT activo FROM fin_obl_abonos WHERE pago_id=?").get(segundo.data.id).activo,0);
  list=await listar();assert.equal(list.obligaciones[0].saldo,120.30);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM caja_gastos").get().n,1);
  const rem=await obl({...c,accion:"editar",version:1,total:"100.00"},"finanzas/obligaciones/"+id);
  assert.equal(rem.status,200,JSON.stringify(rem));
  list=await listar();assert.equal(list.obligaciones[0].saldo,19.75);
  historia=(await obl(null,"finanzas/obligaciones/"+id,"GET")).data;
  assert.deepEqual(historia.historial.map(x=>x.version),[2,1]);
  assert.equal(historia.historial[0].foto.total,100);
  assert.equal(historia.abonos.length,2);
  assert.equal(historia.abonos.filter(x=>x.activo===1).length,1);
  assert.equal(historia.abonos.filter(x=>x.activo===0).length,1);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM fin_bitacora WHERE que='Obligación'").get().n,2);
  // La limpieza ordinaria de pagos de 13 meses NO reabre deudas confirmadas:
  // el vínculo conserva su foto monetaria, aunque agenda_pagos desaparezca.
  db.prepare("DELETE FROM agenda_pagos WHERE id=?").run(primero.data.id);
  list=await listar();assert.equal(list.obligaciones[0].pagado,80.25);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM fin_obl_abonos WHERE activo=1").get().n,1);
  // Paginación: el tablero continúa mostrando todos los importes confirmados.
  const nueva=db.prepare("INSERT INTO fin_obligaciones(id,acreedor,concepto,total_centavos,vencimiento,creado,actualizado) VALUES(?,'Proveedor ficticio','Factura de prueba',100,?,?,?)");
  for(let i=0;i<505;i++)nueva.run("00000000-0000-4000-8000-"+String(i).padStart(12,"0"),vence,"2026-10-21T10:00:00Z","2026-10-21T10:00:00Z");
  list=await listar();
  assert.equal(list.incompleto,true);
  assert.equal(list.obligaciones.length,500);
  assert.equal(list.resumen.cantidad,506);
  assert.equal(list.resumen.pendiente,524.75);
 }finally{db.close();}
});
