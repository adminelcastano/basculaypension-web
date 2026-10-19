// Pruebas adversariales de anulación de abonos de Caja.
// Ejecuta la ruta real sin credenciales ni datos productivos, usando node:sqlite.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { cajaPanel, asegurarEsquemaCaja } from "../src/caja.js";

const hoy = new Intl.DateTimeFormat("en-CA", {timeZone:"America/Mexico_City"}).format(new Date());
const mes = hoy.slice(0, 7);
const actor = {email:"auditoria@invalid.example"};

function adaptar(db) {
  const kv = new Map();
  const stmt = (sql, parametros = []) => ({
    sql, parametros,
    bind(...v) { return stmt(sql, v); },
    async all() { return {results:db.prepare(sql).all(...parametros)}; },
    async first() { return db.prepare(sql).get(...parametros) || null; },
    async run() {
      const r = db.prepare(sql).run(...parametros);
      return {success:true,meta:{changes:Number(r.changes || 0)}};
    }
  });
  return {
    DB: {
      prepare: sql => stmt(sql),
      async batch(consultas) {
        db.exec("BEGIN IMMEDIATE");
        try {
          const result = consultas.map(q => {
            const comando = q.sql.trim().split(/\s+/)[0].toUpperCase();
            if (["SELECT","PRAGMA","WITH"].includes(comando))
              return {success:true,results:db.prepare(q.sql).all(...q.parametros),meta:{changes:0}};
            const r = db.prepare(q.sql).run(...q.parametros);
            return {success:true,results:[],meta:{changes:Number(r.changes || 0)}};
          });
          db.exec("COMMIT");
          return result;
        } catch (e) { db.exec("ROLLBACK"); throw e; }
      }
    },
    FILES: {
      async get(k) { return kv.get(k) ?? null; },
      async put(k,v) { kv.set(k,v); },
      async delete(k) { kv.delete(k); }
    }
  };
}

async function accion(env, pendiente, pago) {
  const u = new URL("https://ensayo.invalid/panel/api/caja/pendiente/" + pendiente + "/resolver");
  const req = new Request(u, {method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({estado:"anular-abono",pago_id:pago})});
  const r = await cajaPanel(req,env,u,["caja","pendiente",pendiente,"resolver"],actor,{});
  return {status:r.status,datos:await r.json()};
}

test("Dos sesiones anulan una vez; la entrada tardía recalcula importe y estado", async () => {
  const db = new DatabaseSync(":memory:");
  const env = adaptar(db);
  try {
    await asegurarEsquemaCaja(env);
    const ahora = new Date().toISOString();
    const pendiente = (id, monto, estado) =>
      db.prepare("INSERT INTO caja_pendientes (id,servicio,fecha,dia,turno,folio,monto,mes,estado,actualizado) VALUES (?,'bascula',?,?,'MAÑANA',?,?,?,?,?)")
        .run(id,hoy+"T10:00:00",hoy,id,monto,mes,estado,ahora);
    const abono = (id, ref, monto) =>
      db.prepare("INSERT INTO caja_cobros_admin (id,pendiente_id,fecha_pago,mes,monto,forma,creado,por) VALUES (?,?,?,?,?,'EFECTIVO',?,?)")
        .run(id,ref,hoy,mes,monto,ahora,actor.email);

    pendiente("p-concurrente",250,"pagado");
    abono("abono-concurrente", "p-concurrente",100);
    abono("abono-restante", "p-concurrente",150);
    const dos = await Promise.all([
      accion(env,"p-concurrente","abono-concurrente"),
      accion(env,"p-concurrente","abono-concurrente")
    ]);
    assert.equal(dos.filter(x => x.status === 200).length,1,JSON.stringify(dos));
    assert.equal(dos.filter(x => x.status >= 400 && x.status < 500).length,1,JSON.stringify(dos));
    assert.equal(db.prepare("SELECT COUNT(*) n FROM caja_cobros_admin WHERE id='abono-concurrente' AND anulado=1").get().n,1);
    const prim = db.prepare("SELECT estado FROM caja_pendientes WHERE id='p-concurrente'").get();
    assert.equal(prim.estado,"parcial");
    const hist = db.prepare("SELECT anterior,nuevo FROM caja_pendientes_hist WHERE pendiente_id='p-concurrente'").all();
    assert.equal(hist.length,1,"No hay dos anotaciones de una única anulación");
    assert.deepEqual(hist[0],{anterior:"pagado",nuevo:"parcial"});

    // El nuevo abono llega DESPUÉS de que el servidor leyó el saldo previo,
    // pero ANTES de ejecutar el lote que anula el pago antiguo.
    pendiente("p-intercalado",100,"parcial");
    abono("abono-viejo","p-intercalado",70);
    const batchOriginal = env.DB.batch;
    let intercalado = false;
    env.DB.batch = async consultas => {
      if (!intercalado && consultas[0]?.sql.includes("UPDATE caja_cobros_admin SET anulado")) {
        intercalado = true;
        abono("abono-nuevo","p-intercalado",20);
      }
      return batchOriginal(consultas);
    };
    const resp = await accion(env,"p-intercalado","abono-viejo");
    assert.equal(intercalado,true);
    assert.equal(resp.status,200,JSON.stringify(resp));
    assert.equal(resp.datos.estado,"parcial","Queda un abono vivo: no puede quedar pendiente sin abonos");
    assert.equal(resp.datos.abonado,20);
    assert.equal(db.prepare("SELECT estado FROM caja_pendientes WHERE id='p-intercalado'").get().estado,"parcial");
    assert.equal(db.prepare("SELECT COUNT(*) n FROM caja_pendientes_hist WHERE pendiente_id='p-intercalado'").get().n,1);
    env.DB.batch = batchOriginal;
  } finally { db.close(); }
});
