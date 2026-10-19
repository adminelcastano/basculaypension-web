// Finanzas reales contra node:sqlite; usa las rutas de negocio, sin Access ni producción.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { finanzasPanel } from "../src/finanzas.js";

const hoy=new Intl.DateTimeFormat("en-CA",{timeZone:"America/Mexico_City"}).format(new Date());
const mes=hoy.slice(0,7);
const actor={email:"ensayo@invalid.example"};
const db=new DatabaseSync(":memory:"),kv=new Map();
const stmt=(sql,args=[])=>({
  sql,args,
  bind(...x){return stmt(sql,x)},
  async all(){return {results:db.prepare(sql).all(...args)}},
  async first(){return db.prepare(sql).get(...args)||null},
  async run(){const x=db.prepare(sql).run(...args);return {success:true,meta:{changes:Number(x.changes||0)}}}
});
const env={
  DB:{prepare:s=>stmt(s),async batch(statements){
    db.exec("BEGIN IMMEDIATE");
    try {
      const res=statements.map(q=>{
        const command=q.sql.trim().split(/\s+/)[0].toUpperCase();
        if(["SELECT","PRAGMA","WITH"].includes(command))return {results:db.prepare(q.sql).all(...q.args),success:true,meta:{changes:0}};
        const r=db.prepare(q.sql).run(...q.args);
        return {results:[],success:true,meta:{changes:Number(r.changes||0)}};
      });
      db.exec("COMMIT");return res;
    }catch(err){db.exec("ROLLBACK");throw err}
  }},
  FILES:{async get(k){return kv.get(k)??null},async put(k,v){kv.set(k,v)},async delete(k){kv.delete(k)}}
};
const request=async (path,body)=>{
  const url=new URL("https://ensayo.invalid/panel/api/finanzas/"+path);
  const req=new Request(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
  const res=await finanzasPanel(req,env,url,["finanzas",...path.split("/")],actor);
  return {status:res.status,data:await res.json()};
};

test("Finanzas/mov: reintento idéntico y cambio de monto con igual UID",async()=>{
  const uid="fd550000-5500-4500-8500-000000000001";
  const data={uid,fecha:hoy,tipo:"traspaso",origen:"bbva-pyme",destino:"mdo-pago",importe:"1234.50",nota:"Ensayo aislado"};
  const r1=await request("mov",data);
  assert.equal(r1.status,200,JSON.stringify(r1));
  const r2=await request("mov",data);
  assert.equal(r2.status,200,JSON.stringify(r2));
  assert.equal(r2.data.repetido,true);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM fin_movs").get().n,1);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM fin_bitacora WHERE que='Traspaso entre cuentas'").get().n,1);
  const r3=await request("mov",{...data,importe:"1234.51"});
  assert.equal(r3.status,409,JSON.stringify(r3));
  assert.equal(db.prepare("SELECT SUM(importe) total FROM fin_movs").get().total,1234.5);
});

test("Movimiento bancario rechaza días imposibles y cantidades sin centavos exactos",async()=>{
  const base={fecha:hoy,tipo:"traspaso",origen:"bbva-pyme",destino:"mdo-pago",
    importe:"10.00",nota:"Validación adversarial"};
  const antes=db.prepare("SELECT COUNT(*) n FROM fin_movs").get().n;
  const bitAntes=db.prepare("SELECT COUNT(*) n FROM fin_bitacora").get().n;
  for(const [cambio,razon] of [
    [{fecha:mes+"-00"},"día cero"],
    [{importe:"0.001"},"fracción de centavo"],
    [{importe:"1e3"},"notación científica"],
    [{importe:"12.345"},"más de dos decimales"]
  ]){
    const r=await request("mov",{...base,...cambio,uid:crypto.randomUUID()});
    assert.equal(r.status,422,razon+": "+JSON.stringify(r));
    assert.equal(db.prepare("SELECT COUNT(*) n FROM fin_movs").get().n,antes,razon);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM fin_bitacora").get().n,bitAntes,razon);
  }
});

test("Cuenta usada sin roles de recepción: no reinterpretar su tipo histórico",async()=>{
  // BBVA PYME ya tiene rol receptor y se bloquea antes por esa razón.
  // Usar cuenta sin roles permite verificar de manera independiente la protección histórica.
  db.prepare("INSERT INTO fin_movs(id,mes,fecha,tipo,origen,destino,importe,creado,creado_por) VALUES(?,?,?,?,?,?,?,?,?)")
    .run("ensayo-historico-cuenta-sin-rol",mes,hoy,"traspaso","bbva-personal","bbva-pyme",15,"2026-10-18T00:00:00Z",actor.email);
  const change=await request("cuenta",{id:"bbva-personal",tipo:"credito"});
  assert.equal(change.status,409,JSON.stringify(change));
  assert.match(change.data.error,/reinterpretaría meses anteriores/);
  assert.equal(db.prepare("SELECT tipo FROM fin_cuentas WHERE id='bbva-personal'").get().tipo,"debito");
});

test("Cuenta receptora de tarjeta o transferencia histórica no se reasigna silenciosamente",async()=>{
  // La protección usa tickets almacenados, no el nombre del banco.
  db.prepare("INSERT INTO caja_mov(servicio,fecha,dia,turno,folio,importe,forma,mes,tipo) VALUES('bascula',?,?,?,?,?,?,?,'ticket')")
    .run(hoy+"T10:00:00",hoy,"MAÑANA","F-ENSAYO",150,"TARJETA",mes);
  const tarjeta=await request("cuenta",{id:"bbva-pyme",tarjeta:1});
  assert.equal(tarjeta.status,409,JSON.stringify(tarjeta));
  assert.equal(db.prepare("SELECT id FROM fin_cuentas WHERE tarjeta=1").get().id,"mdo-pago");
  db.prepare("INSERT INTO caja_mov(servicio,fecha,dia,turno,folio,importe,forma,mes,tipo) VALUES('pension',?,?,?,?,?,?,?,'ticket')")
    .run(hoy+"T11:00:00",hoy,"MAÑANA","P-ENSAYO",155,"TRANSFERENCIA",mes);
  const transf=await request("cuenta",{id:"bbva-personal",def_transf:1});
  assert.equal(transf.status,409,JSON.stringify(transf));
  assert.equal(db.prepare("SELECT id FROM fin_cuentas WHERE def_transf=1").get().id,"bbva-pyme");
});

test("No asignar cuentas de crédito como receptoras de cobros o pagos",async()=>{
  for(const rol of ["tarjeta","def_transf","def_pago"]){
    const res=await request("cuenta",{id:"banorte-credito",[rol]:1});
    assert.equal(res.status,422,rol+" no debe aceptar crédito");
    assert.match(res.data.error,/de débito/);
    assert.equal(db.prepare("SELECT "+rol+" AS activo FROM fin_cuentas WHERE id='banorte-credito'").get().activo,0);
  }
  const nueva=await request("cuenta",{nombre:"ENSAYO BANCO NUEVO",tipo:"debito"});
  assert.equal(nueva.status,200,JSON.stringify(nueva));
  const uso=await request("cuenta",{id:nueva.data.id,def_pago:1});
  assert.equal(uso.status,200,JSON.stringify(uso));
  const cambio=await request("cuenta",{id:nueva.data.id,tipo:"credito"});
  assert.equal(cambio.status,422,"Una cuenta de débito con rol receptor no puede cambiar a crédito sin reasignación previa");
  assert.equal(db.prepare("SELECT tipo FROM fin_cuentas WHERE id=?").get(nueva.data.id).tipo,"debito");
});

test("Eliminar el mismo movimiento simultáneamente registra una sola baja real",async()=>{
  const mov=db.prepare("SELECT id FROM fin_movs WHERE nota = ?").get("Ensayo aislado");
  assert.ok(mov?.id,"Movimiento de la prueba anterior disponible");
  const prev=db.prepare("SELECT COUNT(*) AS n FROM fin_bitacora WHERE accion='borrar' AND ref=?").get(mov.id).n;
  const [a,b]=await Promise.all([
    request("mov/"+mov.id+"/eliminar",{}),
    request("mov/"+mov.id+"/eliminar",{})
  ]);
  assert.deepEqual([a.data.borrados,b.data.borrados].sort(),[0,1],JSON.stringify([a,b]));
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM fin_movs WHERE id=?").get(mov.id).n,0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM fin_bitacora WHERE accion='borrar' AND ref=?").get(mov.id).n-prev,1,
    "Un borrado repetido no deja dos eventos de bitácora");
});

test("Saldo inicial: crear, repetir y corregir no produce bitácora duplicada",async()=>{
  const payload={mes,cuenta:"bbva-personal",saldo:"1234.56"};
  const primera=await request("saldo-cuenta",payload);
  assert.equal(primera.status,200,JSON.stringify(primera));
  const otra=await request("saldo-cuenta",payload);
  assert.equal(otra.status,200);
  assert.equal(otra.data.sin_cambios,true);
  const cambio=await request("saldo-cuenta",{...payload,saldo:"1300.25"});
  assert.equal(cambio.status,200,JSON.stringify(cambio));
  assert.equal(db.prepare("SELECT saldo FROM fin_saldos_cuenta WHERE mes=? AND cuenta=?").get(mes,payload.cuenta).saldo,1300.25);
  const acciones=db.prepare("SELECT accion,COUNT(*) AS n FROM fin_bitacora WHERE que='Saldo inicial de cuenta' AND ref=? GROUP BY accion").all(payload.cuenta);
  assert.deepEqual(acciones.map(x=>[x.accion,x.n]).sort(),[["crear",1],["editar",1]]);
});

test("Dos pestañas con el saldo antiguo: solo una corrección gana",async()=>{
  const originalPrepare=env.DB.prepare;
  let lecturas=0,resolver;
  const ambas=new Promise(done=>resolver=done);
  env.DB.prepare=sql=>{
    const q=originalPrepare(sql);
    if(sql!=="SELECT saldo FROM fin_saldos_cuenta WHERE mes = ? AND cuenta = ?")return q;
    return {bind(...args){
      const st=q.bind(...args);
      if(args[0]!==mes||args[1]!=="bbva-personal")return st;
      return {...st,async first(){
        const prev=await st.first();
        if(prev){lecturas++;if(lecturas===2)resolver();await ambas;}
        return prev;
      }};
    }};
  };
  let respuestas;
  try{
    respuestas=await Promise.all([
      request("saldo-cuenta",{mes,cuenta:"bbva-personal",saldo:"1350.25"}),
      request("saldo-cuenta",{mes,cuenta:"bbva-personal",saldo:"1450.25"})
    ]);
  }finally{env.DB.prepare=originalPrepare}
  assert.equal(lecturas,2);
  assert.deepEqual(respuestas.map(x=>x.status).sort((a,b)=>a-b),[200,409],JSON.stringify(respuestas));
  const saldo=db.prepare("SELECT saldo FROM fin_saldos_cuenta WHERE mes=? AND cuenta=?").get(mes,"bbva-personal").saldo;
  assert.ok([1350.25,1450.25].includes(saldo));
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM fin_bitacora WHERE que='Saldo inicial de cuenta' AND ref='bbva-personal' AND accion='editar'").get().n,2);
});

test("Borrar saldo ya vacío no inventa una baja; borrar valor existente se audita una vez",async()=>{
  const salida=await request("saldo-cuenta",{mes,cuenta:"bbva-personal",saldo:""});
  assert.equal(salida.status,200,JSON.stringify(salida));
  assert.equal(db.prepare("SELECT COUNT(*) n FROM fin_saldos_cuenta WHERE mes=? AND cuenta=?").get(mes,"bbva-personal").n,0);
  const repetido=await request("saldo-cuenta",{mes,cuenta:"bbva-personal",saldo:""});
  assert.equal(repetido.status,200);
  assert.equal(repetido.data.sin_cambios,true);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM fin_bitacora WHERE que='Saldo inicial de cuenta' AND ref='bbva-personal' AND accion='borrar'").get().n,1);
});

test("Una pantalla vieja no puede sobrescribir un saldo guardado después",async()=>{
  const cuenta="klar-manu";
  const escribir=(saldo,esperado)=>request("saldo-cuenta",{mes,cuenta,saldo,esperado});
  const primero=await escribir("1000",null);
  assert.equal(primero.status,200,JSON.stringify(primero));
  const viejo=await escribir("1500",null);
  assert.equal(viejo.status,409,"Otra pestaña abrió el saldo antes de la primera captura");
  const correcto=await escribir("1200","1000");
  assert.equal(correcto.status,200,JSON.stringify(correcto));
  const repetidoAntiguo=await escribir("1200","1000");
  assert.equal(repetidoAntiguo.status,409,"No tratar un formulario viejo como guardado sin cambios");
  const borrarAntiguo=await escribir("","1000");
  assert.equal(borrarAntiguo.status,409,"Tampoco puede borrar el nuevo saldo");
  assert.equal(db.prepare("SELECT saldo FROM fin_saldos_cuenta WHERE mes=? AND cuenta=?").get(mes,cuenta).saldo,1200);
  const borrarActual=await escribir("","1200");
  assert.equal(borrarActual.status,200,JSON.stringify(borrarActual));
  assert.equal(db.prepare("SELECT COUNT(*) n FROM fin_saldos_cuenta WHERE mes=? AND cuenta=?").get(mes,cuenta).n,0);
  const bajas=db.prepare("SELECT accion,COUNT(*) AS n FROM fin_bitacora WHERE ref=? AND que='Saldo inicial de cuenta' GROUP BY accion").all(cuenta);
  assert.deepEqual(bajas.map(x=>[x.accion,x.n]).sort(),[["borrar",1],["crear",1],["editar",1]]);
});

test("Saldo de sobres: pestañas viejas y reintentos no alteran dinero ni bitácora",async()=>{
  const escribir = (efectivo,esperado)=>request("saldo",{mes,efectivo,esperado});
  const bit = ()=>db.prepare("SELECT accion, COUNT(*) n FROM fin_bitacora WHERE que='Saldo inicial de los sobres' AND mes=? GROUP BY accion ORDER BY accion").all(mes);
  const primero=await escribir("1000.25",null);
  assert.equal(primero.status,200,JSON.stringify(primero));
  const original=await escribir("1500.25",null);
  assert.equal(original.status,409,"La pestaña sin captura no puede sobrescribir el primer conteo");
  const repetido=await escribir("1000.25","1000.25");
  assert.equal(repetido.status,200);
  assert.equal(repetido.data.sin_cambios,true);
  const nuevo=await escribir("1250.50","1000.25");
  assert.equal(nuevo.status,200,JSON.stringify(nuevo));
  const obsoleto=await escribir("1300.75","1000.25");
  assert.equal(obsoleto.status,409);
  const mismoObsoleto=await escribir("1250.50","1000.25");
  assert.equal(mismoObsoleto.status,409,"No confirmar datos de una versión obsoleta");
  const borrarObsoleto=await escribir("","1000.25");
  assert.equal(borrarObsoleto.status,409);
  assert.equal(db.prepare("SELECT efectivo FROM fin_saldos WHERE mes=?").get(mes).efectivo,1250.50);
  const borrar=await escribir("","1250.50");
  assert.equal(borrar.status,200);
  const vacio=await escribir("",null);
  assert.equal(vacio.status,200);
  assert.equal(vacio.data.sin_cambios,true);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM fin_saldos WHERE mes=?").get(mes).n,0);
  assert.deepEqual(bit().map(x=>[x.accion,x.n]),[["borrar",1],["crear",1],["editar",1]]);
});

test("Saldo de sobres: dos envíos simultáneos con la misma versión dejan un ganador",async()=>{
  const preparar=await request("saldo",{mes,efectivo:"250.10",esperado:null});
  assert.equal(preparar.status,200,JSON.stringify(preparar));
  const bitAntes=db.prepare("SELECT COUNT(*) n FROM fin_bitacora WHERE que='Saldo inicial de los sobres' AND mes=?").get(mes).n;
  const [a,b]=await Promise.all([
    request("saldo",{mes,efectivo:"300.10",esperado:"250.10"}),
    request("saldo",{mes,efectivo:"350.10",esperado:"250.10"})
  ]);
  assert.deepEqual([a.status,b.status].sort((x,y)=>x-y),[200,409],JSON.stringify([a,b]));
  const final=db.prepare("SELECT efectivo FROM fin_saldos WHERE mes=?").get(mes).efectivo;
  assert.ok([300.10,350.10].includes(final));
  assert.equal(db.prepare("SELECT COUNT(*) n FROM fin_bitacora WHERE que='Saldo inicial de los sobres' AND mes=?").get(mes).n,bitAntes+1);
  const limpiar=await request("saldo",{mes,efectivo:"",esperado:String(final)});
  assert.equal(limpiar.status,200);
});


test("Movimiento con cuenta desactivada se rechaza y su reintento legítimo sigue disponible",async()=>{
  const data={uid:"fd550000-5500-4500-8500-000000000091",fecha:hoy,
    tipo:"traspaso",origen:"klar-manu",destino:"mdo-pago",importe:"89.25",nota:"Movimientos con bancos activos"};
  const prev=()=>({
    movs:db.prepare("SELECT COUNT(*) n FROM fin_movs").get().n,
    bit:db.prepare("SELECT COUNT(*) n FROM fin_bitacora").get().n
  });
  const antes=prev();
  db.prepare("UPDATE fin_cuentas SET activa=0 WHERE id='klar-manu'").run();
  const invalido=await request("mov",data);
  assert.equal(invalido.status,422,JSON.stringify(invalido));
  assert.deepEqual(prev(),antes);
  db.prepare("UPDATE fin_cuentas SET activa=1 WHERE id='klar-manu'").run();
  const bien=await request("mov",data);
  assert.equal(bien.status,200,JSON.stringify(bien));
  db.prepare("UPDATE fin_cuentas SET activa=0 WHERE id='mdo-pago'").run();
  try{
    const reintento=await request("mov",data);
    assert.equal(reintento.status,200,JSON.stringify(reintento));
    assert.equal(reintento.data.repetido,true);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM fin_movs WHERE id=?").get(bien.data.id).n,1);
  }finally{ db.prepare("UPDATE fin_cuentas SET activa=1 WHERE id='mdo-pago'").run(); }
});

test("Desactivar cuenta justo al escribir movimiento no crea asiento ni auditoría",async()=>{
  const data={uid:"fd550000-5500-4500-8500-000000000092",fecha:hoy,
    tipo:"traspaso",origen:"klar-manu",destino:"bbva-pyme",importe:"33.15",nota:"Carrera financiera"};
  const antesMov=db.prepare("SELECT COUNT(*) n FROM fin_movs").get().n;
  const antesBit=db.prepare("SELECT COUNT(*) n FROM fin_bitacora").get().n;
  const batch=env.DB.batch;
  let inyectado=false;
  env.DB.batch=async statements=>{
    if(!inyectado && statements[0]?.sql.includes("INSERT INTO fin_movs")){
      inyectado=true;
      db.prepare("UPDATE fin_cuentas SET activa=0 WHERE id='klar-manu'").run();
    }
    return batch(statements);
  };
  try{
    const resultado=await request("mov",data);
    assert.equal(inyectado,true);
    assert.equal(resultado.status,409,JSON.stringify(resultado));
    assert.equal(db.prepare("SELECT COUNT(*) n FROM fin_movs").get().n,antesMov);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM fin_bitacora").get().n,antesBit);
  }finally{
    env.DB.batch=batch;
    db.prepare("UPDATE fin_cuentas SET activa=1 WHERE id='klar-manu'").run();
  }
});


test("Ocultar cuentas con saldos, operaciones o roles no puede alterar total visible",async()=>{
  const roles=await request("cuenta",{id:"bbva-pyme",activa:false});
  assert.equal(roles.status,409,JSON.stringify(roles));
  assert.equal(db.prepare("SELECT activa FROM fin_cuentas WHERE id='bbva-pyme'").get().activa,1);
  const movimientos=await request("cuenta",{id:"klar-manu",activa:false});
  assert.equal(movimientos.status,409,JSON.stringify(movimientos));
  assert.equal(db.prepare("SELECT activa FROM fin_cuentas WHERE id='klar-manu'").get().activa,1);
  const creada=await request("cuenta",{nombre:"ENSAYO CUENTA SIN USAR",tipo:"debito"});
  assert.equal(creada.status,200,JSON.stringify(creada));
  const id=creada.data.id;
  const ocultar=await request("cuenta",{id,activa:false});
  assert.equal(ocultar.status,200,JSON.stringify(ocultar));
  assert.equal(db.prepare("SELECT activa FROM fin_cuentas WHERE id=?").get(id).activa,0);
  const repetir=await request("cuenta",{id,activa:false});
  assert.equal(repetir.status,200);
  assert.equal(repetir.data.sin_cambios,true);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM fin_bitacora WHERE que='Cuenta' AND ref=? AND detalle LIKE '%activa%'").get(id).n,1);
});

test("Si entra un saldo durante el ocultamiento la cuenta queda visible y no se audita la baja",async()=>{
  const nueva=await request("cuenta",{nombre:"ENSAYO CUENTA CARRERA",tipo:"debito"});
  assert.equal(nueva.status,200,JSON.stringify(nueva));
  const id=nueva.data.id, batch=env.DB.batch;
  const antes=db.prepare("SELECT COUNT(*) n FROM fin_bitacora WHERE que='Cuenta' AND ref=? AND accion='editar'").get(id).n;
  let inyectado=false;
  env.DB.batch=async stmts=>{
    if(!inyectado && stmts[0]?.sql.includes("UPDATE fin_cuentas SET activa = 0")){
      inyectado=true;
      db.prepare("INSERT INTO fin_saldos_cuenta (mes,cuenta,saldo,actualizado) VALUES (?,?,?,?)")
        .run(mes,id,0,new Date().toISOString());
    }
    return batch(stmts);
  };
  try{
    const ocultar=await request("cuenta",{id,activa:false});
    assert.equal(inyectado,true);
    assert.equal(ocultar.status,409,JSON.stringify(ocultar));
    assert.equal(db.prepare("SELECT activa FROM fin_cuentas WHERE id=?").get(id).activa,1);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM fin_bitacora WHERE que='Cuenta' AND ref=? AND accion='editar'").get(id).n,antes);
  }finally{
    env.DB.batch=batch;
    db.prepare("DELETE FROM fin_saldos_cuenta WHERE cuenta=?").run(id);
  }
});


test("Saldo de cuenta oculta no se crea ni siquiera si se ocultó durante el guardado",async()=>{
  const inicial=await request("cuenta",{nombre:"ENSAYO CUENTA SIN SALDO INVISIBLE",tipo:"debito"});
  assert.equal(inicial.status,200,JSON.stringify(inicial));
  const cuenta=inicial.data.id, saldo={mes,cuenta,saldo:"800.25",esperado:null};
  const ocultar=await request("cuenta",{id:cuenta,activa:false});
  assert.equal(ocultar.status,200);
  const viejo=await request("saldo-cuenta",saldo);
  assert.equal(viejo.status,409,JSON.stringify(viejo));
  assert.equal(db.prepare("SELECT COUNT(*) n FROM fin_saldos_cuenta WHERE cuenta=?").get(cuenta).n,0);
  const activar=await request("cuenta",{id:cuenta,activa:true});
  assert.equal(activar.status,200);
  const before=db.prepare("SELECT COUNT(*) n FROM fin_bitacora WHERE que='Saldo inicial de cuenta' AND ref=?").get(cuenta).n;
  const batch=env.DB.batch;
  let intercalado=false;
  env.DB.batch=async statements=>{
    if(!intercalado && statements[0]?.sql.includes("INSERT INTO fin_saldos_cuenta")){
      intercalado=true;
      db.prepare("UPDATE fin_cuentas SET activa=0 WHERE id=?").run(cuenta);
    }
    return batch(statements);
  };
  try{
    const x=await request("saldo-cuenta",saldo);
    assert.equal(intercalado,true);
    assert.equal(x.status,409,JSON.stringify(x));
    assert.equal(db.prepare("SELECT COUNT(*) n FROM fin_saldos_cuenta WHERE cuenta=?").get(cuenta).n,0);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM fin_bitacora WHERE que='Saldo inicial de cuenta' AND ref=?").get(cuenta).n,before);
  }finally{
    env.DB.batch=batch;
    db.prepare("UPDATE fin_cuentas SET activa=1 WHERE id=?").run(cuenta);
  }
});


test("Cambiar débito/crédito durante un movimiento no reinterpreta actividad nueva",async()=>{
  const nueva=await request("cuenta",{nombre:"CUENTA TIPO CARRERA ENSAYO",tipo:"debito"});
  assert.equal(nueva.status,200,JSON.stringify(nueva));
  const id=nueva.data.id;
  const prevTipo=db.prepare("SELECT tipo FROM fin_cuentas WHERE id=?").get(id).tipo;
  const prevBit=db.prepare("SELECT COUNT(*) n FROM fin_bitacora WHERE que='Cuenta' AND ref=?").get(id).n;
  const batch=env.DB.batch;
  let intercalado=false;
  env.DB.batch=async stmts=>{
    if(!intercalado && stmts[0]?.sql.includes("UPDATE fin_cuentas SET tipo = ?")){
      intercalado=true;
      db.prepare("INSERT INTO fin_movs (id,mes,fecha,tipo,origen,destino,importe,creado,creado_por) VALUES(?,?,?,?,?,?,?,?,?)")
        .run("mov-tipo-race",mes,hoy,"traspaso",id,"bbva-pyme",17.25,new Date().toISOString(),actor.email);
    }
    return batch(stmts);
  };
  try {
    const respuesta=await request("cuenta",{id,tipo:"credito"});
    assert.equal(intercalado,true);
    assert.equal(respuesta.status,409,JSON.stringify(respuesta));
    assert.equal(db.prepare("SELECT tipo FROM fin_cuentas WHERE id=?").get(id).tipo,prevTipo);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM fin_bitacora WHERE que='Cuenta' AND ref=?").get(id).n,prevBit);
  }finally{env.DB.batch=batch}
  const otro=await request("cuenta",{nombre:"CUENTA TIPO LIBRE ENSAYO",tipo:"debito"});
  assert.equal(otro.status,200);
  const cambiar=await request("cuenta",{id:otro.data.id,tipo:"credito"});
  assert.equal(cambiar.status,200,JSON.stringify(cambiar));
  assert.equal(db.prepare("SELECT tipo FROM fin_cuentas WHERE id=?").get(otro.data.id).tipo,"credito");
  assert.equal(db.prepare("SELECT COUNT(*) n FROM fin_bitacora WHERE que='Cuenta' AND ref=? AND accion='editar'").get(otro.data.id).n,1);
  const mixto=await request("cuenta",{id:otro.data.id,tipo:"debito",nombre:"NUEVO NOMBRE"});
  assert.equal(mixto.status,422,"Un cambio de tipo no combina otros ajustes en una operación");
});


test("Dos administradores no reasignan el mismo rol bancario desde pantallas viejas",async()=>{
  const uno=await request("cuenta",{nombre:"CUENTA PARA ROL A ENSAYO",tipo:"debito"});
  const dos=await request("cuenta",{nombre:"CUENTA PARA ROL B ENSAYO",tipo:"debito"});
  assert.equal(uno.status,200);assert.equal(dos.status,200);
  const antes=db.prepare("SELECT id FROM fin_cuentas WHERE def_pago=1").get();
  const prev=db.prepare("SELECT COUNT(*) n FROM fin_bitacora WHERE que='Cuenta' AND accion='editar'").get().n;
  const original=env.DB.batch;
  let llegadas=0,soltar;
  const barrera=new Promise(done=>soltar=done);
  env.DB.batch=async queries=>{
    if(queries[0]?.sql.includes("UPDATE fin_cuentas") &&
       queries[0]?.sql.includes("AND nombre = ?") &&
       queries.some(q=>q.sql.includes("SET def_pago = 0"))){
      if(++llegadas===2)soltar();
      await barrera;
    }
    return original(queries);
  };
  let respuestas;
  try{
    respuestas=await Promise.all([
      request("cuenta",{id:uno.data.id,def_pago:1}),
      request("cuenta",{id:dos.data.id,def_pago:1})
    ]);
  }finally{env.DB.batch=original}
  assert.equal(llegadas,2);
  assert.deepEqual(respuestas.map(x=>x.status).sort((a,b)=>a-b),[200,409],JSON.stringify(respuestas));
  const resultado=db.prepare("SELECT id FROM fin_cuentas WHERE def_pago=1").all();
  assert.equal(resultado.length,1);
  assert.ok([uno.data.id,dos.data.id].includes(resultado[0].id));
  assert.notEqual(resultado[0].id,antes.id);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM fin_bitacora WHERE que='Cuenta' AND accion='editar'").get().n,prev+1);
});

test("Sincronizar un ticket justo al reasignar el banco receptor no reinterpreta cobros",async()=>{
  const nuevo=await request("cuenta",{nombre:"CUENTA SIN TICKETS PREVIOS",tipo:"debito"});
  assert.equal(nuevo.status,200);
  // Aislar exclusivamente los tickets sintéticos de otros tests de este archivo.
  const historicos=db.prepare("SELECT * FROM caja_mov WHERE tipo='ticket'").all();
  db.prepare("DELETE FROM caja_mov WHERE tipo='ticket'").run();
  const original=env.DB.batch;
  const titularAntes=db.prepare("SELECT id FROM fin_cuentas WHERE tarjeta=1").get().id;
  const cambiosAntes=db.prepare("SELECT COUNT(*) n FROM fin_bitacora WHERE que='Cuenta' AND accion='editar' AND ref=?").get(nuevo.data.id).n;
  let insertado=null;
  env.DB.batch=async queries=>{
    if(!insertado && queries[0]?.sql.includes("UPDATE fin_cuentas") &&
      queries[0]?.sql.includes("AND nombre = ?")){
      insertado=Number(db.prepare("INSERT INTO caja_mov(servicio,fecha,dia,turno,folio,importe,forma,mes,tipo) VALUES ('bascula',?,?,'MAÑANA','BANCO-RACE',100,'TARJETA',?,'ticket')")
        .run(hoy+"T10:00:00",hoy,mes).lastInsertRowid);
    }
    return original(queries);
  };
  try{
    const cambio=await request("cuenta",{id:nuevo.data.id,tarjeta:1});
    assert.ok(insertado);
    assert.equal(cambio.status,409,JSON.stringify(cambio));
    assert.equal(db.prepare("SELECT id FROM fin_cuentas WHERE tarjeta=1").get().id,titularAntes);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM fin_bitacora WHERE que='Cuenta' AND accion='editar' AND ref=?").get(nuevo.data.id).n,cambiosAntes);
  }finally{
    env.DB.batch=original;
    if(insertado)db.prepare("DELETE FROM caja_mov WHERE id=?").run(insertado);
    const st=db.prepare("INSERT INTO caja_mov(id,servicio,fecha,dia,turno,folio,matricula,cliente,importe,forma,mes,tipo) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)");
    for(const t of historicos)st.run(t.id,t.servicio,t.fecha,t.dia,t.turno,t.folio,t.matricula,t.cliente,t.importe,t.forma,t.mes,t.tipo);
  }
});

test.after(()=>db.close());
