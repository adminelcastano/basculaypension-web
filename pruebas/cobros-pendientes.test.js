import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { leerHoja, calcularCortes, totalesMes } from "../src/caja.js";
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
