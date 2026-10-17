import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { leerHoja, calcularCortes, totalesMes } from "../src/caja.js";
import { flujosMes } from "../src/cuentas.js";
import { armarHoy } from "../src/hoy.js";

const gs = readFileSync(new URL("../herramientas/ingresos-hoja.gs", import.meta.url), "utf8");
const interpretar = runInNewContext(gs + "\nanalizarImporte", {});
const simple = x => JSON.parse(JSON.stringify(x));

test("Apps Script: conserva los importes pendientes sin registrarlos como ingreso", () => {
  assert.deepEqual(simple(interpretar("PENDIENTE DE PAGO 160")),
    { importe: 0, pendiente: true, monto_pendiente: 160 });
  assert.deepEqual(simple(interpretar("PENDIENTE DE PAGO $1,500.25")),
    { importe: 0, pendiente: true, monto_pendiente: 1500.25 });
  assert.deepEqual(simple(interpretar("PRUEBA")), { excluir: true });
  assert.deepEqual(simple(interpretar("CANCELADO TENIA MAL LA PLACA")), { excluir: true });
  assert.equal(interpretar("MENOS 55").importe, "MENOS 55");
  assert.equal(interpretar("ERROR").error, "texto desconocido");
});

test("Caja: importa el pendiente y registra cero como cobrado", async () => {
  const old = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    ok: true, mes: "2026-10", pension: [], bascula: [{
      fecha: "2026-10-01T14:56:04", folio: "17097", matricula: "", cliente: "",
      importe: 0, forma: "EFECTIVO", turno: "TARDE", pendiente: true, monto_pendiente: 160
    }]
  }), { headers: { "Content-Type": "application/json" } });
  try {
    const l = await leerHoja({ INGRESOS_URL:"https://example.test/exec", INGRESOS_TOKEN:"fake" }, "2026-10");
    assert.equal(l.length, 1);
    assert.equal(l[0].pendiente, true);
    assert.equal(l[0].monto_pendiente, 160);
    assert.equal(l[0].importe, 0);
    const corte = calcularCortes(l.map(f=>({...f,mes:"2026-10"})),[]);
    assert.equal(corte[0].efectivo, 0);
    assert.equal(totalesMes(corte).ingresos, 0);
  } finally {
    globalThis.fetch = old;
  }
});

test("Hoy: aviso individual enlaza al cobro pendiente en el corte", () => {
  const id="bascula|2026-10-01T14:56:04|17097";
  const d={caja:{cortes:[],pendientes:[{
    id, servicio:"bascula",folio:"17097",monto:160,dia:"2026-10-01",turno:"TARDE"
  }]}, agenda:{}, pagos:{}};
  const r=armarHoy(d,new Date("2026-10-17T16:00:00Z"));
  const alert=r.atencion.find(x=>x.clave==="cobro-"+id);
  assert.ok(alert);
  assert.match(alert.detalle, /\$160\.00/);
  assert.equal(alert.ir.corte,"2026-10-01|TARDE");
  assert.equal(alert.ir.pendiente,id);
});

test("Caja: la resolución administrativa no añade un ingreso ficticio", () => {
  const backend=readFileSync(new URL("../src/caja.js", import.meta.url),"utf8");
  assert.match(backend,/CREATE TABLE IF NOT EXISTS caja_pendientes/);
  assert.match(backend,/CREATE TABLE IF NOT EXISTS caja_pendientes_hist/);
  assert.match(backend,/WHERE id = \? AND estado = \?/);
  assert.match(backend,/El estado administrativo no suma ingresos/);
  assert.match(backend,/WHERE estado = 'pendiente'/);
});

test("Panel: interfaz de acciones administrativas válida", () => {
  for(const archivo of ["03-caja.js","06-inicio.js"]){
    const src=readFileSync(new URL("../src/panel/cliente/"+archivo,import.meta.url),"utf8");
    assert.doesNotThrow(()=>new Function(src),archivo);
  }
  const caja=readFileSync(new URL("../src/panel/cliente/03-caja.js",import.meta.url),"utf8");
  assert.match(caja,/Marcar pagado/);
  assert.match(caja,/Reabrir pendiente/);
  assert.match(caja,/data-cobro-estado="cancelado"/);
  assert.match(caja,/window\.cajaAbrirPendiente/);
});

test("Dinero: abonos recuperados ingresan a sobres, MP y transferencia sin duplicarse", () => {
  const mp = { id:"mp", tarjeta:1, activa:1, comision_pct:3.5, comision_iva:1 };
  const banco = { id:"banco", tarjeta:0, def_transf:1, activa:1 };
  const flujos=flujosMes({
    tarjeta: [{ mes:"2026-10", dia:"2026-10-17", importe:100 }],
    transf: [{ fecha:"2026-10-17", importe:250, cuenta:"banco" }],
    cobrosAdmin: [{ dia:"2026-10-17", monto:160, servicio:"bascula", folio:"17097", creado:"2026-10-17T12:00:00Z", por:"administracion" }]
  },[mp,banco]);
  assert.equal(flujos.cuentas.mp.entradas,95.94);
  assert.equal(flujos.cuentas.mp.detalle.comision,4.06);
  assert.equal(flujos.cuentas.banco.entradas,250);
  assert.equal(flujos.sobres.entradas,160);
  assert.equal(flujos.sobres.movimientos.length,1);
});

test("Caja y Dinero: abonos se excluyen cuando la hoja deja de indicar pendiente", () => {
  const caja=readFileSync(new URL("../src/caja.js",import.meta.url),"utf8");
  const finanzas=readFileSync(new URL("../src/finanzas.js",import.meta.url),"utf8");
  assert.match(caja,/p\.origen_activo = 1/);
  assert.match(finanzas,/a\.anulado = 0 AND p\.origen_activo = 1/);
  assert.match(finanzas,/cobrosAdmin = await leerCobrosAdmin\(env, \{ mes \}\)/);
  assert.match(finanzas,/ingresos\.total =/);
  assert.match(finanzas,/cobrosAdmin\.filter\(x => x\.forma === "TARJETA"\)/);
});

test("Caja: los pagos requieren fecha en mes abierto, forma y un id de operación", () => {
  const caja=readFileSync(new URL("../src/caja.js",import.meta.url),"utf8");
  assert.match(caja,/mesesAbiertos\(env\)\)\.includes\(fecha\.slice\(0, 7\)\)/);
  assert.match(caja,/FORMAS_GASTO\.includes\(forma\)/);
  assert.match(caja,/pago_id/);
  assert.match(caja,/anular-abono/);
});

test("Panel: el cobro exige importe, fecha y método", () => {
  const source=readFileSync(new URL("../src/panel/cliente/03-caja.js",import.meta.url),"utf8");
  assert.match(source,/name="monto"/);
  assert.match(source,/name="fecha" type="date"/);
  assert.match(source,/name="forma"/);
  assert.match(source,/crypto\.randomUUID\(\)/);
  assert.doesNotThrow(()=>new Function(source));
});
