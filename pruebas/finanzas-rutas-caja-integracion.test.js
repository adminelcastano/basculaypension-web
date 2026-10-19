// Ensayo de API real de Caja, sin una petición de producción ni credenciales.
// Ejecuta las rutas de negocio sobre node:sqlite con adaptador de D1.batch.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { cajaPanel, asegurarEsquemaCaja } from "../src/caja.js";
import { asegurarEsquemaCuentas } from "../src/cuentas.js";

const hoy = new Intl.DateTimeFormat("en-CA",{timeZone:"America/Mexico_City"}).format(new Date());
const mes = hoy.slice(0,7);
const actor = {email:"ensayo@invalid.example"};
const TOKEN = ["bba00000-1111-4111-8111-000000000001","bba00000-1111-4111-8111-000000000002",
"bba00000-1111-4111-8111-000000000003","bba00000-1111-4111-8111-000000000004"];

function adaptar(db) {
  const kv = new Map();
  const stmt = (sql, params=[])=>({
    sql,params,
    bind(...values){return stmt(sql,values)},
    async all(){return {results:db.prepare(sql).all(...params)}},
    async first(){return db.prepare(sql).get(...params)||null},
    async run(){const x=db.prepare(sql).run(...params);return {success:true,meta:{changes:Number(x.changes||0)}}}
  });
  const DB={
    prepare:sql=>stmt(sql),
    async batch(statements){
      db.exec("BEGIN IMMEDIATE");
      try{
        const result=statements.map(q=>{
          const command=q.sql.trim().split(/\s+/)[0].toUpperCase();
          if(["SELECT","PRAGMA","WITH"].includes(command))
            return {success:true,results:db.prepare(q.sql).all(...q.params),meta:{changes:0}};
          const r=db.prepare(q.sql).run(...q.params);
          return {success:true,results:[],meta:{changes:Number(r.changes||0)}};
        });
        db.exec("COMMIT");return result;
      }catch(er){db.exec("ROLLBACK");throw er}
    }
  };
  return {DB,FILES:{async get(k){return kv.get(k)??null},async put(k,v){kv.set(k,v)},async delete(k){kv.delete(k)}}};
}

function req(path,datos){
  const url=new URL("https://ensayo.invalid/panel/api/caja/"+path);
  return {url, partes:["caja",...path.split("/")],
    request:new Request(url,{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify(datos)})};
}
async function post(env,path,data){
  const r=req(path,data);
  const out=await cajaPanel(r.request,env,r.url,r.partes,actor,{});
  return {status:out.status,data:await out.json()};
}
function ticket(db,folio,importe,forma="TRANSFERENCIA"){
  db.prepare("INSERT INTO caja_mov(servicio,fecha,dia,turno,folio,matricula,cliente,importe,forma,mes,tipo) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
    .run("bascula",hoy+"T10:00:00",hoy,"MAÑANA",folio,null,"SINTÉTICO",importe,forma,mes,"ticket");
}
function transferencia(uid,ref=null,importe=480){
  return {uid,fecha:hoy,cliente:"Prueba sintética",importe,cuenta:"bbva-pyme",factura:"",
    ...(ref ? {ticket_ref:ref} : {})};
}

test("Rutas reales: reintento, ticket duplicado y enlace de dos sesiones sin doble bitácora",async()=>{
  const db=new DatabaseSync(":memory:");const env=adaptar(db);
  try{
    await asegurarEsquemaCaja(env);await asegurarEsquemaCuentas(env);
    ticket(db,"F101",480);
    ticket(db,"F102",480);
    ticket(db,"F103",480);
    ticket(db,"F104",480);
    ticket(db,"F105",500);
    const uno=await post(env,"transferencias",transferencia(TOKEN[0],"bascula:F101"));
    assert.equal(uno.status,200,JSON.stringify(uno));assert.equal(uno.data.ok,true);
    const repeated=await post(env,"transferencias",transferencia(TOKEN[0],"bascula:F101"));
    assert.equal(repeated.status,200);assert.equal(repeated.data.repetido,true);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM caja_transf").get().n,1);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM fin_bitacora WHERE que = 'Transferencia de cliente'").get().n,1);

    const otro=await post(env,"transferencias",transferencia(TOKEN[1],"bascula:F101"));
    assert.notEqual(otro.status,200,"Otro UID no puede compartir el mismo ticket");
    assert.equal(db.prepare("SELECT COUNT(*) n FROM caja_transf").get().n,1);
    const incompatible=await post(env,"transferencias",transferencia(TOKEN[1],"bascula:F105"));
    assert.equal(incompatible.status,422);
    assert.match(incompatible.data.error,/no coincide/);

    const libre=await post(env,"transferencias",transferencia(TOKEN[2]));
    assert.equal(libre.status,200,JSON.stringify(libre));
    const liga=await post(env,"transferencias/"+libre.data.id+"/ligar",{ticket_ref:"bascula:F102"});
    assert.equal(liga.status,200,JSON.stringify(liga));
    const sinCambios=await post(env,"transferencias/"+libre.data.id+"/ligar",{ticket_ref:"bascula:F102"});
    assert.equal(sinCambios.status,200);
    assert.equal(sinCambios.data.sin_cambios,true);
    const nAntes=db.prepare("SELECT COUNT(*) n FROM fin_bitacora WHERE que = 'Transferencia de cliente'").get().n;
    assert.equal(nAntes,3,"Crear dos y ligar una vez; repetir no deja bitácora falsa");

    // El mismo registro se abre en dos sesiones: el primer vínculo gana.
    const suelta=await post(env,"transferencias",transferencia(TOKEN[3]));
    assert.equal(suelta.status,200);
    const [a,b]=await Promise.all([
      post(env,"transferencias/"+suelta.data.id+"/ligar",{ticket_ref:"bascula:F103"}),
      post(env,"transferencias/"+suelta.data.id+"/ligar",{ticket_ref:"bascula:F104"})
    ]);
    const estatus=[a.status,b.status].sort((x,y)=>x-y);
    assert.deepEqual(estatus,[200,409],JSON.stringify([a,b]));
    const final=db.prepare("SELECT ticket_ref FROM caja_transf WHERE id = ?").get(suelta.data.id);
    assert.ok(["bascula:F103","bascula:F104"].includes(final.ticket_ref));
    assert.equal(db.prepare("SELECT COUNT(*) n FROM fin_bitacora WHERE que='Transferencia de cliente'").get().n,5);

    const prev=db.prepare("SELECT COUNT(*) n FROM fin_bitacora WHERE accion='borrar' AND ref=?").get(libre.data.id).n;
    const [d1,d2]=await Promise.all([
      post(env,"transferencias/"+libre.data.id+"/eliminar",{}),
      post(env,"transferencias/"+libre.data.id+"/eliminar",{})
    ]);
    assert.deepEqual([d1.status,d2.status].sort(),[200,409],JSON.stringify([d1,d2]));
    assert.equal(db.prepare("SELECT COUNT(*) n FROM caja_transf WHERE id=?").get(libre.data.id).n,0);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM fin_bitacora WHERE accion='borrar' AND ref=?").get(libre.data.id).n-prev,1,
      "La transferencia se borra y audita una sola vez");
    const histEliminado=db.prepare("SELECT COUNT(*) n FROM fin_bitacora WHERE ref=?").get(libre.data.id).n;
    const reintentoEliminado=await post(env,"transferencias",transferencia(TOKEN[2]));
    assert.equal(reintentoEliminado.status,409,JSON.stringify(reintentoEliminado));
    assert.match(reintentoEliminado.data.error,/eliminada/);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM caja_transf WHERE id=?").get(libre.data.id).n,0);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM fin_bitacora WHERE ref=?").get(libre.data.id).n,histEliminado);

    const nueva=await post(env,"transferencias",transferencia("bba00000-1111-4111-8111-000000000005"));
    assert.equal(nueva.status,200);
    const success=await post(env,"transferencias/"+nueva.data.id+"/eliminar",{});
    assert.equal(success.status,200);
    assert.equal(success.data.borrados,1);

    // Un banco explícito inválido JAMÁS debe convertirse silenciosamente en BBVA PYME.
    for(const [cuenta,razon] of [
      ["inexistente","cuenta inexistente"],
      ["banorte-credito","tarjeta de crédito"]
    ]) {
      const antes=db.prepare("SELECT COUNT(*) n FROM caja_transf").get().n;
      const rechazo=await post(env,"transferencias",{...transferencia("bba00000-1111-4111-8111-000000000006"),cuenta});
      assert.equal(rechazo.status,422,razon+": "+JSON.stringify(rechazo));
      assert.match(rechazo.data.error,/cuenta.*no está disponible/);
      assert.equal(db.prepare("SELECT COUNT(*) n FROM caja_transf").get().n,antes);
    }

    db.prepare("UPDATE fin_cuentas SET activa = 0 WHERE id='bbva-personal'").run();
    const apagada=await post(env,"transferencias",{...transferencia("bba00000-1111-4111-8111-000000000007"),cuenta:"bbva-personal"});
    assert.equal(apagada.status,422,JSON.stringify(apagada));
    assert.ok(apagada.data.errores.cuenta);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM caja_transf WHERE cuenta='bbva-personal'").get().n,0);

    // Rechazar fechas imposibles o posteriores a hoy aunque tengan el mes válido.
    const fechaImposible=mes+"-99";
    const fechaInvalida=await post(env,"transferencias",{...transferencia("bba00000-1111-4111-8111-000000000008"),fecha:fechaImposible});
    assert.equal(fechaInvalida.status,422,JSON.stringify(fechaInvalida));
    assert.ok(fechaInvalida.data.errores.fecha);
    const ultimaFecha=mes+"-"+new Date(Date.UTC(Number(mes.slice(0,4)),Number(mes.slice(5,7)),0)).getUTCDate();
    if(ultimaFecha>hoy){
      const futura=await post(env,"transferencias",{...transferencia("bba00000-1111-4111-8111-000000000009"),fecha:ultimaFecha});
      assert.equal(futura.status,422,JSON.stringify(futura));
      assert.ok(futura.data.errores.fecha);
    }

    // El mismo UID ya guardado debe seguir siendo repetible incluso si
    // la cuenta utilizada se desactivó después: no crear otro asiento.
    db.prepare("UPDATE fin_cuentas SET activa=0 WHERE id='bbva-pyme'").run();
    const retryConCuentaInactiva=await post(env,"transferencias",transferencia(TOKEN[0],"bascula:F101"));
    assert.equal(retryConCuentaInactiva.status,200,JSON.stringify(retryConCuentaInactiva));
    assert.equal(retryConCuentaInactiva.data.repetido,true);
    db.prepare("UPDATE fin_cuentas SET activa=1 WHERE id='bbva-pyme'").run();

    // Escenario TOCTOU: otra pestaña desactiva la cuenta después de la
    // validación y antes de INSERT. El INSERT condicional debe perder.
    const preBatch=env.DB.batch;
    let interceptada=false;
    env.DB.batch=async statements=>{
      if(!interceptada && statements[0]?.sql.includes("INSERT INTO caja_transf")) {
        interceptada=true;
        db.prepare("UPDATE fin_cuentas SET activa=0 WHERE id='bbva-pyme'").run();
      }
      return preBatch(statements);
    };
    try {
      const antes=db.prepare("SELECT COUNT(*) n FROM caja_transf").get().n;
      const bitAntes=db.prepare("SELECT COUNT(*) n FROM fin_bitacora WHERE que='Transferencia de cliente'").get().n;
      const rival=await post(env,"transferencias",transferencia("bba00000-1111-4111-8111-000000000010"));
      assert.equal(interceptada,true);
      assert.equal(rival.status,409,JSON.stringify(rival));
      assert.equal(db.prepare("SELECT COUNT(*) n FROM caja_transf").get().n,antes);
      assert.equal(db.prepare("SELECT COUNT(*) n FROM fin_bitacora WHERE que='Transferencia de cliente'").get().n,bitAntes);
    } finally {
      env.DB.batch=preBatch;
      db.prepare("UPDATE fin_cuentas SET activa=1 WHERE id='bbva-pyme'").run();
    }
  } finally {db.close()}
});
