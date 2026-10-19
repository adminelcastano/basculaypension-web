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

test.after(()=>db.close());
