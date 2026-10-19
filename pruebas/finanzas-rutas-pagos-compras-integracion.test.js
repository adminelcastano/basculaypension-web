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
  const same=await post(env,"pagos/"+viejo.id+"/editar",{
    fecha:hoy,importe:"410.25",titulo:"Recibo sintético revisado",
    forma:"C:mdo-pago",nota:"Corrección de prueba",categoria:"Servicios"
  });
  assert.equal(same.status,200,JSON.stringify(same));
  assert.equal(same.data.sin_cambios,true,"No asentar corrección duplicada sin cambios");
  assert.equal(db.prepare("SELECT COUNT(*) n FROM fin_bitacora WHERE ref=? AND accion='editar'").get(viejo.id).n,1);
});

test("Eliminación de pago hecho retira un único recibo y su gasto, conservando bitácora",async()=>{
  const {db,env}=shared;
  const p=db.prepare("SELECT * FROM agenda_pagos WHERE item_id='' AND titulo='Recibo sintético revisado'").get();
  assert.ok(p);
  const [primera,segunda]=await Promise.all([
    post(env,"pagos/"+p.id+"/eliminar",{}),
    post(env,"pagos/"+p.id+"/eliminar",{})
  ]);
  const estados=[primera.status,segunda.status].sort((a,b)=>a-b);
  assert.equal(estados[0],200,JSON.stringify([primera,segunda]));
  assert.ok([404,409].includes(estados[1]),JSON.stringify([primera,segunda]));
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

test("Regresar un ticket comprado devuelve artículos a pendiente y retira su gasto",async()=>{
  const {db,env}=shared;
  for(const id of ["ensayo-revertir-a","ensayo-revertir-b"]){
    db.prepare("INSERT INTO agenda_items(id,tipo,titulo,estado,creado) VALUES(?,'compra',?,'pendiente',?)")
      .run(id,"Artículo ficticio "+id,"2026-10-18T00:00:00Z");
  }
  const datos={ids:["ensayo-revertir-a","ensayo-revertir-b"],total:"120",
    precios:{"ensayo-revertir-a":"50","ensayo-revertir-b":"70"},
    forma:"C:bbva-pyme",fecha_compra:hoy,uid:"cc000005-2222-4333-8444-555555555555"};
  const registrado=await post(env,"compras/terminar",datos);
  assert.equal(registrado.status,200,JSON.stringify(registrado));
  const gastoId=registrado.data.gasto_id;
  assert.equal(db.prepare("SELECT COUNT(*) n FROM compras_historial WHERE gasto_id=?").get(gastoId).n,2);
  const deshacer=await post(env,"compras/regresar-ticket",{gasto_id:gastoId});
  assert.equal(deshacer.status,200,JSON.stringify(deshacer));
  assert.equal(deshacer.data.n,2);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM caja_gastos WHERE id=?").get(gastoId).n,0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM compras_historial WHERE gasto_id=?").get(gastoId).n,0);
  const filas=db.prepare("SELECT estado,gasto_id,importe FROM agenda_items WHERE id IN (?,?)")
    .all(...datos.ids);
  assert.equal(filas.length,2);
  assert.ok(filas.every(x=>x.estado==="pendiente"&&x.gasto_id===null&&x.importe===null));
  assert.equal(db.prepare("SELECT COUNT(*) n FROM fin_bitacora WHERE ref=? AND accion='borrar'").get(gastoId).n,1);
  const nuevo=await post(env,"compras/terminar",{...datos,uid:"cc000006-2222-4333-8444-555555555555"});
  assert.equal(nuevo.status,200,JSON.stringify(nuevo));
  assert.notEqual(nuevo.data.gasto_id,gastoId);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM caja_gastos WHERE id=?").get(nuevo.data.gasto_id).n,1);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM compras_historial WHERE gasto_id=?").get(nuevo.data.gasto_id).n,2);
});

test("Dos sesiones corrigen la misma versión de pago: solo una gana, sin gasto incoherente",async()=>{
  const {db,env}=shared;
  const creado=await post(env,"pagos/hecho",{
    uid:"cc000007-2222-4333-8444-555555555555",
    fecha:hoy,importe:"215",titulo:"ENSAYO ediciones simultáneas",
    forma:"C:bbva-pyme",nota:"registro nuevo",categoria:"Servicios"
  });
  assert.equal(creado.status,200,JSON.stringify(creado));
  const id=creado.data.id;
  const originalPrepare=env.DB.prepare;
  let lecturas=0, liberar;
  const ambosLeidos=new Promise(ok=>{liberar=ok});
  env.DB.prepare = sql=>{
    const prepared=originalPrepare(sql);
    if(sql!=="SELECT * FROM agenda_pagos WHERE id = ?")return prepared;
    return {
      bind(...args){
        const st=prepared.bind(...args);
        if(args[0]!==id)return st;
        return {...st,async first(){
          const pago=await st.first();
          if(pago){lecturas++;if(lecturas===2)liberar();await ambosLeidos;}
          return pago;
        }};
      }
    };
  };
  let respuestas;
  try{
    const datos={fecha:hoy,forma:"C:bbva-pyme",titulo:"ENSAYO ediciones simultáneas",nota:"registro nuevo",categoria:"Servicios"};
    respuestas=await Promise.all([
      post(env,"pagos/"+id+"/editar",{...datos,importe:"216.10"}),
      post(env,"pagos/"+id+"/editar",{...datos,importe:"217.20"})
    ]);
  }finally{env.DB.prepare=originalPrepare}
  assert.equal(lecturas,2);
  assert.deepEqual(respuestas.map(x=>x.status).sort((a,b)=>a-b),[200,409],JSON.stringify(respuestas));
  const pago=db.prepare("SELECT * FROM agenda_pagos WHERE id=?").get(id);
  const gasto=db.prepare("SELECT * FROM caja_gastos WHERE id=?").get(pago.gasto_id);
  assert.ok([216.10,217.20].includes(pago.importe));
  assert.equal(gasto.monto,pago.importe,"Recibo y gasto deben quedar en la misma versión");
  assert.equal(db.prepare("SELECT COUNT(*) n FROM fin_bitacora WHERE ref=? AND accion='editar'").get(id).n,1);
});

test("Dos sesiones devuelven el mismo ticket: una sola baja y no afecta recompra posterior",async()=>{
  const {db,env}=shared;
  const ids=["ensayo-cas-volver-a","ensayo-cas-volver-b"];
  for(const id of ids)
    db.prepare("INSERT INTO agenda_items(id,tipo,titulo,estado,creado) VALUES(?,'compra',?,'pendiente',?)")
      .run(id,"ENSAYO CAS "+id,"2026-10-18T00:00:00Z");
  const datos={ids,total:"90.00",precios:{[ids[0]]:"35",[ids[1]]:"55"},
    forma:"C:bbva-pyme",fecha_compra:hoy,uid:"cc000008-2222-4333-8444-555555555555"};
  const compra=await post(env,"compras/terminar",datos);
  assert.equal(compra.status,200,JSON.stringify(compra));
  const gid=compra.data.gasto_id;
  // Ambas solicitudes leen una misma versión inicial, como dos pestañas.
  const prepare=env.DB.prepare;
  let leidas=0,resolver;
  const barrier=new Promise(ok=>resolver=ok);
  env.DB.prepare=sql=>{
    const stmt=prepare(sql);
    if(!sql.includes("SELECT id, titulo, estado FROM agenda_items WHERE tipo = 'compra' AND gasto_id = ?"))return stmt;
    return {bind(...p){
      const q=stmt.bind(...p);
      if(p[0]!==gid)return q;
      return {...q,async all(){
        const result=await q.all();
        leidas++;
        if(leidas===2)resolver();
        await barrier;
        return result;
      }};
    }};
  };
  let r1,r2;
  try {
    [r1,r2]=await Promise.all([
      post(env,"compras/regresar-ticket",{gasto_id:gid}),
      post(env,"compras/regresar-ticket",{gasto_id:gid})
    ]);
  }finally{env.DB.prepare=prepare}
  assert.equal(leidas,2);
  assert.deepEqual([r1.status,r2.status].sort((a,b)=>a-b),[200,409],JSON.stringify([r1,r2]));
  assert.equal(db.prepare("SELECT COUNT(*) n FROM caja_gastos WHERE id=?").get(gid).n,0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM compras_historial WHERE gasto_id=?").get(gid).n,0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM agenda_items WHERE gasto_id=?").get(gid).n,0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM fin_bitacora WHERE ref=? AND accion='borrar'").get(gid).n,1);
  const compraNueva=await post(env,"compras/terminar",{...datos,uid:"cc000009-2222-4333-8444-555555555555"});
  assert.equal(compraNueva.status,200,JSON.stringify(compraNueva));
  const nuevoGid=compraNueva.data.gasto_id;
  const viejo=await post(env,"compras/regresar-ticket",{gasto_id:gid});
  assert.equal(viejo.status,409,"El antiguo ticket nunca puede devolver una nueva compra");
  assert.equal(db.prepare("SELECT COUNT(*) n FROM caja_gastos WHERE id=?").get(nuevoGid).n,1);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM compras_historial WHERE gasto_id=?").get(nuevoGid).n,2);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM agenda_items WHERE gasto_id=? AND estado='comprado'").get(nuevoGid).n,2);
});


test("Cuenta bancaria desactivada o de tipo incorrecto no registra pago ni compra",async()=>{
  // El proyecto inicializa esquemas una vez por isolate: reutilizar su DB
  // evita que el caché global de esquemas omita tablas en una DB nueva.
  const {db,env}=shared;
  try{
    db.prepare("UPDATE fin_cuentas SET activa=0 WHERE id='bbva-personal'").run();
    const antes={g:db.prepare("SELECT COUNT(*) n FROM caja_gastos").get().n,
      p:db.prepare("SELECT COUNT(*) n FROM agenda_pagos").get().n,
      b:db.prepare("SELECT COUNT(*) n FROM fin_bitacora").get().n};
    const base={fecha:hoy,importe:"101.25",titulo:"Pago de prueba",categoria:"Servicios"};
    for(const [forma,motivo] of [
      ["C:bbva-personal","inactiva"],
      ["C:banco-que-no-existe","inexistente"],
      ["TRANSFERENCIA","tipo equivocado con cuenta explícita"]
    ]){
      const datos={...base,uid:crypto.randomUUID(),forma};
      if(forma==="TRANSFERENCIA")datos.cuenta="banorte-credito";
      const res=await post(env,"pagos/hecho",datos);
      assert.equal(res.status,422,motivo+": "+JSON.stringify(res));
    }
    db.prepare("INSERT INTO agenda_items (id,tipo,titulo,estado,creado) VALUES ('compra-no-cuenta','compra','Ensayo compras','pendiente',?)").run(new Date().toISOString());
    for(const forma of ["C:bbva-personal","C:banco-que-no-existe"]){
      const res=await post(env,"compras/terminar",{ids:["compra-no-cuenta"],
        total:"70.50",forma,fecha_compra:hoy,uid:crypto.randomUUID()});
      assert.equal(res.status,422,JSON.stringify(res));
      assert.equal(db.prepare("SELECT estado FROM agenda_items WHERE id='compra-no-cuenta'").get().estado,"pendiente");
    }
    assert.equal(db.prepare("SELECT COUNT(*) n FROM caja_gastos").get().n,antes.g);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM agenda_pagos").get().n,antes.p);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM fin_bitacora").get().n,antes.b);

    // Un pago ya guardado con un UID sí debe recuperarse después de desactivar
    // su banco; reintentar una respuesta perdida no crea otro gasto.
    const guardado={fecha:hoy,importe:"99.25",titulo:"Pago UID tras desactivar",
      forma:"C:bbva-pyme",uid:"50000000-0000-4000-8000-000000000099"};
    const pago=await post(env,"pagos/hecho",guardado);
    assert.equal(pago.status,200,JSON.stringify(pago));
    db.prepare("UPDATE fin_cuentas SET activa=0 WHERE id='bbva-pyme'").run();
    const reintento=await post(env,"pagos/hecho",guardado);
    assert.equal(reintento.status,200,JSON.stringify(reintento));
    assert.equal(reintento.data.repetido,true);
    assert.equal(reintento.data.id,pago.data.id);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM agenda_pagos WHERE id=?").get(pago.data.id).n,1);
    db.prepare("UPDATE fin_cuentas SET activa=1 WHERE id='bbva-pyme'").run();
  }finally{
    db.prepare("UPDATE fin_cuentas SET activa=1 WHERE id='bbva-personal'").run();
    db.prepare("UPDATE fin_cuentas SET activa=1 WHERE id='bbva-pyme'").run();
  }
});

test("Cuenta desactivada entre validación y D1.batch revierte pagos y compras",async()=>{
  const {db,env}=shared, previoBatch=env.DB.batch;
  const antes=()=>({
    gastos:db.prepare("SELECT COUNT(*) n FROM caja_gastos").get().n,
    pagos:db.prepare("SELECT COUNT(*) n FROM agenda_pagos").get().n,
    historiales:db.prepare("SELECT COUNT(*) n FROM compras_historial").get().n,
    bitacora:db.prepare("SELECT COUNT(*) n FROM fin_bitacora").get().n
  });
  try{
    const cuenta="bbva-pyme", resumen=antes();
    const disputar=async (ruta,datos)=>{
      // Otra sesión desactiva la cuenta en la ventana entre la lectura
      // validada y el primer INSERT del lote transaccional.
      let inyectado=false;
      env.DB.batch=async sentencias=>{
        if(!inyectado && sentencias.some(x=>x.sql.includes("INSERT INTO caja_gastos"))){
          inyectado=true;
          db.prepare("UPDATE fin_cuentas SET activa = 0 WHERE id = ?").run(cuenta);
        }
        return previoBatch(sentencias);
      };
      try{
        const resp=await post(env,ruta,datos);
        assert.equal(inyectado,true,JSON.stringify(resp));
        assert.equal(resp.status,409,JSON.stringify(resp));
        assert.deepEqual(antes(),resumen,"Un banco desactivado no deja asientos parciales ni bitácora falsa");
      }finally{
        env.DB.batch=previoBatch;
        db.prepare("UPDATE fin_cuentas SET activa = 1 WHERE id = ?").run(cuenta);
      }
    };
    await disputar("pagos/hecho",{
      uid:"70000000-0000-4000-8000-000000000001",fecha:hoy,importe:"211.25",
      titulo:"Pago de carrera de banco",forma:"C:bbva-pyme",nota:"ensayo"
    });
    const programado="pago-ensayo-banco-race";
    db.prepare("INSERT INTO agenda_items (id,tipo,titulo,fecha,estado,frecuencia,forma,importe,creado) VALUES (?, 'pago', ?, ?, 'pendiente', 'mensual', 'TRANSFERENCIA', 200, ?)")
      .run(programado,"Servicio de carrera",hoy,new Date().toISOString());
    await disputar(programado+"/pagar",{
      uid:"70000000-0000-4000-8000-000000000002",fecha:hoy,importe:"200",
      forma:"C:bbva-pyme",nota:"ensayo"
    });
    assert.equal(db.prepare("SELECT estado FROM agenda_items WHERE id=?").get(programado).estado,"pendiente");
    assert.equal(db.prepare("SELECT fecha FROM agenda_items WHERE id=?").get(programado).fecha,hoy);

    const compra="compra-ensayo-banco-race";
    db.prepare("INSERT INTO agenda_items(id,tipo,titulo,estado,creado) VALUES (?, 'compra', 'Artículo sintético', 'pendiente', ?)")
      .run(compra,new Date().toISOString());
    await disputar("compras/terminar",{
      uid:"70000000-0000-4000-8000-000000000003",ids:[compra],total:"150.30",
      precios:{[compra]:"150.30"},forma:"C:bbva-pyme",fecha_compra:hoy
    });
    assert.equal(db.prepare("SELECT estado FROM agenda_items WHERE id=?").get(compra).estado,"pendiente");
  } finally {
    env.DB.batch=previoBatch;
    db.prepare("UPDATE fin_cuentas SET activa=1 WHERE id='bbva-pyme'").run();
  }
});

test("Cuenta desactivada durante la edición y compra individual no altera asientos",async()=>{
  const {db,env}=shared;
  const original=env.DB.batch;
  const bloquearEnBatch=async (ruta,datos,inicia)=>{
    let intercalado=false;
    env.DB.batch=async stmts=>{
      if(!intercalado && stmts.some(x=>x.sql.includes(inicia))){
        intercalado=true;
        db.prepare("UPDATE fin_cuentas SET activa=0 WHERE id='mdo-pago'").run();
      }
      return original(stmts);
    };
    try{
      const res=await post(env,ruta,datos);
      assert.equal(intercalado,true,JSON.stringify(res));
      assert.equal(res.status,409,JSON.stringify(res));
    }finally{
      env.DB.batch=original;
      db.prepare("UPDATE fin_cuentas SET activa=1 WHERE id='mdo-pago'").run();
    }
  };
  try{
    const creado=await post(env,"pagos/hecho",{
      uid:"70000000-0000-4000-8000-000000000011",
      fecha:hoy,importe:"100.20",titulo:"Pago protegido al editar",forma:"C:bbva-pyme"
    });
    assert.equal(creado.status,200,JSON.stringify(creado));
    const originalPago=db.prepare("SELECT * FROM agenda_pagos WHERE id=?").get(creado.data.id);
    const antesBit=db.prepare("SELECT COUNT(*) n FROM fin_bitacora WHERE ref=?").get(creado.data.id).n;
    await bloquearEnBatch("pagos/"+creado.data.id+"/editar",{
      fecha:hoy,importe:"102.50",titulo:"Pago protegido al editar",
      forma:"C:mdo-pago"
    },"UPDATE agenda_pagos SET fecha=");
    assert.equal(db.prepare("SELECT importe FROM agenda_pagos WHERE id=?").get(creado.data.id).importe,100.20);
    assert.equal(db.prepare("SELECT monto FROM caja_gastos WHERE id=?").get(originalPago.gasto_id).monto,100.20);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM fin_bitacora WHERE ref=?").get(creado.data.id).n,antesBit);

    const individual="compra-individual-cuenta-race";
    db.prepare("INSERT INTO agenda_items(id,tipo,titulo,estado,creado) VALUES (?, 'compra', 'Pieza ensayo', 'pendiente', ?)")
      .run(individual,new Date().toISOString());
    const gAntes=db.prepare("SELECT COUNT(*) n FROM caja_gastos").get().n;
    const hAntes=db.prepare("SELECT COUNT(*) n FROM compras_historial").get().n;
    await bloquearEnBatch(individual,{
      titulo:"Pieza ensayo",estado:"comprado",importe:"70.25",
      forma:"C:mdo-pago",fecha_compra:hoy
    },"INSERT INTO caja_gastos");
    assert.equal(db.prepare("SELECT COUNT(*) n FROM caja_gastos").get().n,gAntes);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM compras_historial").get().n,hAntes);
    assert.equal(db.prepare("SELECT estado FROM agenda_items WHERE id=?").get(individual).estado,"pendiente");
  } finally {
    env.DB.batch=original;
    db.prepare("UPDATE fin_cuentas SET activa=1 WHERE id='mdo-pago'").run();
  }
});

test("Dos UIDs pagan simultáneamente el mismo vencimiento: un gasto, un pago, una bitácora",async()=>{
  const {db,env}=shared;
  const id="pago-programado-dos-sesiones";
  db.prepare("INSERT INTO agenda_items(id,tipo,titulo,fecha,estado,frecuencia,forma,importe,creado) VALUES (?, 'pago', ?, ?, 'pendiente', 'mensual', 'TRANSFERENCIA', 95.75, ?)")
    .run(id,"Servicio simultáneo ficticio",hoy,new Date().toISOString());
  const cuentaAntes=db.prepare("SELECT COUNT(*) n FROM caja_gastos").get().n;
  const bitAntes=db.prepare("SELECT COUNT(*) n FROM fin_bitacora").get().n;
  const originalPrepare=env.DB.prepare;
  let lecturas=0,soltar;
  const barrier=new Promise(resolve=>soltar=resolve);
  env.DB.prepare=sql=>{
    const stmt=originalPrepare(sql);
    if(!sql.startsWith("SELECT fecha, importe FROM agenda_pagos WHERE item_id = ?"))return stmt;
    return {bind(...args){
      const ligado=stmt.bind(...args);
      if(args[0]!==id)return ligado;
      return {...ligado,async first(){
        const r=await ligado.first();
        if(++lecturas===2)soltar();
        await barrier;
        return r;
      }};
    }};
  };
  let respuestas;
  try{
    const base={fecha:hoy,importe:"95.75",forma:"C:bbva-pyme",nota:"prueba dos sesiones"};
    respuestas=await Promise.all([
      post(env,id+"/pagar",{...base,uid:"70000000-0000-4000-8000-000000000021"}),
      post(env,id+"/pagar",{...base,uid:"70000000-0000-4000-8000-000000000022"})
    ]);
  }finally{env.DB.prepare=originalPrepare}
  assert.ok(lecturas >= 2,"Ambas sesiones pasaron la consulta inicial; una tercera lectura confirma el conflicto");
  assert.deepEqual(respuestas.map(x=>x.status).sort((a,b)=>a-b),[200,409],JSON.stringify(respuestas));
  assert.equal(db.prepare("SELECT COUNT(*) n FROM agenda_pagos WHERE item_id=?").get(id).n,1);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM caja_gastos").get().n,cuentaAntes+1);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM fin_bitacora").get().n,bitAntes+1);
  assert.notEqual(db.prepare("SELECT fecha FROM agenda_items WHERE id=?").get(id).fecha,hoy);
});

test("Fechas imposibles y fechas explícitas inválidas no crean egresos",async()=>{
  const {db,env}=shared;
  const mes=hoy.slice(0,7);
  const conteos=()=>({
    gastos:db.prepare("SELECT COUNT(*) n FROM caja_gastos").get().n,
    pagos:db.prepare("SELECT COUNT(*) n FROM agenda_pagos").get().n,
    historial:db.prepare("SELECT COUNT(*) n FROM compras_historial").get().n,
    bitacora:db.prepare("SELECT COUNT(*) n FROM fin_bitacora").get().n
  });
  const antes=conteos();
  for(const fecha of [mes+"-00",mes+"-32","no-es-fecha"]){
    const pago=await post(env,"pagos/hecho",{
      uid:crypto.randomUUID(),fecha,importe:"17.25",titulo:"Fecha inválida de ensayo",forma:"EFECTIVO"
    });
    assert.equal(pago.status,422,fecha+": "+JSON.stringify(pago));
    assert.deepEqual(conteos(),antes,"Una fecha inválida nunca crea un pago");
  }
  const id="ensayo-fecha-inexistente-compra";
  db.prepare("INSERT INTO agenda_items(id,tipo,titulo,estado,creado) VALUES(?,'compra','Material sintético','pendiente',?)")
    .run(id,new Date().toISOString());
  for(const fecha_compra of [mes+"-00",mes+"-32","no-es-fecha"]){
    const compra=await post(env,"compras/terminar",{
      uid:crypto.randomUUID(),ids:[id],total:"17.25",forma:"EFECTIVO",fecha_compra
    });
    assert.equal(compra.status,422,JSON.stringify(compra));
    assert.deepEqual(conteos(),antes,"No genera asientos, pagos ni bitácora");
    assert.equal(db.prepare("SELECT estado FROM agenda_items WHERE id=?").get(id).estado,"pendiente");
    const individual=await post(env,id,{
      titulo:"Material sintético",estado:"comprado",importe:"17.25",forma:"EFECTIVO",fecha_compra
    });
    assert.equal(individual.status,422,JSON.stringify(individual));
    assert.deepEqual(conteos(),antes,"No registra compra individual con fecha inválida");
    assert.equal(db.prepare("SELECT estado FROM agenda_items WHERE id=?").get(id).estado,"pendiente");
  }
});
