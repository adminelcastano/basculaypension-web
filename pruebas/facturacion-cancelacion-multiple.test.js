import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { validarCfdis, asegurarEsquemaCfdis, listarCfdis, emitirMultiples, cancelarRegistro, sustituirRegistro } from "../src/facturas-registro.js";

const ahora = "2026-10-20T17:20:00.000Z";
const id = "11111111-2222-4333-8444-555555555555";
const fake = () => {
  const d = new DatabaseSync(":memory:");
  d.exec("CREATE TABLE solicitudes(id TEXT PRIMARY KEY,estado TEXT,folio_factura TEXT,importe TEXT,folio_ticket TEXT,resuelta_en TEXT,enviada_en TEXT,aviso_cancelacion_en TEXT,motivo TEXT);"
    +"CREATE TABLE facturas_folios(servicio TEXT,folio_normalizado TEXT,solicitud_id TEXT,folio_factura TEXT,creado TEXT,vence TEXT,PRIMARY KEY(servicio,folio_normalizado));");
  d.prepare("INSERT INTO solicitudes(id,estado) VALUES(?,?)").run(id,"pendiente");
  const prep = sql => {
    let args=[];
    return { sql,get args(){return args;},bind(...v){args=v;return this;},
      async first(){return d.prepare(sql).get(...args)||null;},
      async all(){return {results:d.prepare(sql).all(...args)};},
      async run(){let r=d.prepare(sql).run(...args);return {meta:{changes:Number(r.changes)}};} };
  };
  const env={DB:{prepare:prep,async batch(xs){
    d.exec("BEGIN");
    try { const out=xs.map(x=>({meta:{changes:Number(d.prepare(x.sql).run(...x.args).changes)}})); d.exec("COMMIT");return out;}
    catch(e){d.exec("ROLLBACK");throw e;}
  }}};
  const solicitud=(estado="pendiente", extra={})=>({id,servicio:"pension",folio_ticket:"00423",estado,importe:"3200.00",facturas_solicitadas:2,folio_factura:null,...extra});
  return {d,env,solicitud,close(){d.close();}};
};
test("Nunca reparte importes automáticamente ni acepta folios repetidos",()=>{
  assert.equal(validarCfdis([{folio:"A1",importe:"1200.00"},{folio:"A2",importe:"2000.00"}]).suma_centavos,320000);
  assert.ok(validarCfdis([{folio:"A1",importe:"1300"},{folio:"A1",importe:"1700"}]).error);
  assert.ok(validarCfdis([{folio:"A1",importe:"1.234"}]).error);
  assert.ok(validarCfdis([]).error);
  assert.ok(validarCfdis([{folio:"A1",importe:"50"},{folio:"A2",importe:"50"},{folio:"A3",importe:"50"}]).error);
});
test("Dos CFDI comparten una reserva de ticket y se registran con importes manuales",async()=>{
  const e=fake();
  try{
    await asegurarEsquemaCfdis(e.env);
    const s=e.solicitud(),dos=[{folio:"A101",importe:"1600"},{folio:"A102",importe:"1600.00"}];
    assert.equal((await emitirMultiples(e.env,s,{facturas:dos,importe_ticket:"3200",confirmado_facturador:false},"admin",ahora,{normalizado:"00423",original:"00423"})).ok,false);
    assert.equal((await emitirMultiples(e.env,s,{facturas:dos,importe_ticket:"3100",confirmado_facturador:true},"admin",ahora,{normalizado:"00423",original:"00423"})).ok,false);
    const r=await emitirMultiples(e.env,s,{facturas:dos,importe_ticket:"3200",confirmado_facturador:true},"admin",ahora,{normalizado:"00423",original:"00423"});
    assert.equal(r.ok,true);
    assert.equal((await listarCfdis(e.env,e.solicitud("facturada"))).length,2);
    assert.equal(e.d.prepare("SELECT count(*) n FROM facturas_folios").get().n,1);
    assert.equal(e.d.prepare("SELECT estado FROM solicitudes WHERE id=?").get(id).estado,"facturada");
    assert.equal((await emitirMultiples(e.env,s,{facturas:dos,importe_ticket:"3200",confirmado_facturador:true},"admin",ahora,{normalizado:"00423",original:"00423"})).ok,false);
    assert.equal(e.d.prepare("SELECT count(*) n FROM facturas_cfdis").get().n,2);
  }finally{e.close();}
});
test("SQLite bloquea un tercer CFDI vigente aunque se intente fuera de la interfaz", async()=>{
  const e=fake();
  try {
    await asegurarEsquemaCfdis(e.env);
    assert.equal((await emitirMultiples(e.env,e.solicitud(),
      {facturas:[{folio:"CF1",importe:"1600"},{folio:"CF2",importe:"1600"}],
       importe_ticket:"3200",confirmado_facturador:true},"admin",ahora,
       {normalizado:"00423",original:"00423"})).ok,true);
    assert.throws(()=>e.d.prepare("INSERT INTO facturas_cfdis(id,solicitud_id,folio,importe,creado) VALUES (?,?,?,?,?)")
      .run("33333333-2222-4333-8444-555555555555",id,"CF3","10.00",ahora),/LIMITE_DOS_CFDI/);
    assert.equal(e.d.prepare("SELECT count(*) AS n FROM facturas_cfdis WHERE estado='vigente'").get().n,2);
  }finally{e.close();}
});
test("Cancelación manual conserva el CFDI original, referencia y permite sustitución por dos",async()=>{
  const e=fake();
  try{
    await asegurarEsquemaCfdis(e.env);
    await emitirMultiples(e.env,e.solicitud(),{facturas:[{folio:"ORIGINAL",importe:"3200"}],importe_ticket:"3200",confirmado_facturador:true},"admin",ahora,{normalizado:"00423",original:"00423"});
    const item=(await listarCfdis(e.env,e.solicitud("facturada")))[0];
    assert.equal((await cancelarRegistro(e.env,e.solicitud("facturada"),{cfdi_id:item.id,motivo:"Registro incorrecto",confirmado_facturador:false},"admin",ahora)).ok,false);
    assert.equal((await cancelarRegistro(e.env,e.solicitud("facturada"),{cfdi_id:item.id,motivo:"Registro incorrecto",confirmado_facturador:true},"admin",ahora)).ok,true);
    assert.equal(e.d.prepare("SELECT estado FROM solicitudes WHERE id=?").get(id).estado,"cancelada");
    assert.equal(e.d.prepare("SELECT count(*) n FROM facturas_cfdis WHERE estado='cancelada'").get().n,1);
    const v=await sustituirRegistro(e.env,e.solicitud("cancelada"),{cfdi_cancelado_id:item.id,confirmado_facturador:true,
      facturas:[{folio:"NUEVO1",importe:"1600"},{folio:"NUEVO2",importe:"1600"}]},"admin",ahora,"00423");
    assert.equal(v.ok,true);
    const rows=(await listarCfdis(e.env,e.solicitud("facturada"))),viejo=rows.find(x=>x.id===item.id);
    assert.equal(viejo.estado,"cancelada");
    assert.equal(rows.filter(x=>x.estado==="vigente"&&x.sustituye_id===item.id).length,2);
    assert.equal(e.d.prepare("SELECT folio_factura FROM facturas_folios").get().folio_factura,"NUEVO1");
    assert.equal((await sustituirRegistro(e.env,e.solicitud("facturada"),{cfdi_cancelado_id:item.id,confirmado_facturador:true,
      facturas:[{folio:"NUEVO3",importe:"100"}]},"admin",ahora,"00423")).ok,false);
  }finally{e.close();}
});
test("Compatibilidad: factura única histórica pasa al historial al confirmar cancelación",async()=>{
  const e=fake();
  try{
    await asegurarEsquemaCfdis(e.env);
    e.d.prepare("UPDATE solicitudes SET estado='enviada', folio_factura='FOL-ANTIGUO',importe='2200' WHERE id=?").run(id);
    const s=e.solicitud("enviada",{folio_factura:"FOL-ANTIGUO",importe:"2200"});
    const antes=await listarCfdis(e.env,s);
    assert.equal(antes.length,1);assert.equal(antes[0].legacy,true);
    assert.equal(e.d.prepare("SELECT count(*) n FROM facturas_cfdis").get().n,0);
    const r=await cancelarRegistro(e.env,s,{cfdi_id:antes[0].id,motivo:"Corrección autorizada",confirmado_facturador:true},"admin",ahora);
    assert.equal(r.ok,true);
    assert.equal(e.d.prepare("SELECT count(*) n FROM facturas_cfdis").get().n,1);
    assert.equal(e.d.prepare("SELECT estado FROM solicitudes WHERE id=?").get(id).estado,"cancelada");
    assert.equal((await listarCfdis(e.env,e.solicitud("cancelada")))[0].folio,"FOL-ANTIGUO");
  }finally{e.close();}
});
test("Los formularios públicos y el panel distinguen solicitud, cancelación y avisos manuales",()=>{
  const page=readFileSync(new URL("../public/factura/index.html",import.meta.url),"utf8");
  const panel=readFileSync(new URL("../src/panel/cliente/01-facturacion.js",import.meta.url),"utf8");
  const worker=readFileSync(new URL("../src/worker.js",import.meta.url),"utf8") + "\n" + readFileSync(new URL("../src/worker-panel-rutas.js", import.meta.url), "utf8");
  assert.match(page,/name="facturas_solicitadas" value="2"/);
  assert.match(page,/No es necesario calcular importes/);
  assert.match(panel,/registrar-cancelacion/);
  assert.match(panel,/registrar-sustitutos/);
  assert.match(panel,/Confirmar que avisé al cliente/);
  assert.match(worker,/confirmar-aviso-cancelacion/);
  assert.doesNotMatch(worker,/facturador\.com\/api/);
});
