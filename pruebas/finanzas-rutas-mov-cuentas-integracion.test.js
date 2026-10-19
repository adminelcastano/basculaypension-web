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

test.after(()=>db.close());
