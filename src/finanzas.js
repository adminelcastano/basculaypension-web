// Finanzas: la unión de las dos fuentes de dinero.
// - Turnos: tickets (efectivo y tarjeta), ingresos extra y gastos de caja.
// - Administración: pagos programados y no programados, compras y otros gastos (salen de los sobres o del banco).
// Efectivo en sobres: saldo inicial que escribe la administración cada mes + sobres que entregan los turnos
// en el corte ciego − pagos y compras en efectivo. Banco: texto libre con las cuentas (por ahora).
import { asegurarEsquemaCaja, leerMes, calcularCortes, unirConteos, totalesMes, mesActual, sumarMesesCaja, montoUsuario } from "./caja.js";
import { asegurarEsquemaAgenda } from "./agenda.js";

const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
const r2 = v => Math.round(v * 100) / 100;
const RE_MES = /^\d{4}-(0[1-9]|1[0-2])$/;

let esquemaListo = false;
export async function asegurarEsquemaFinanzas(env) {
  if (esquemaListo) return;
  await asegurarEsquemaCaja(env);
  await asegurarEsquemaAgenda(env);
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS fin_saldos (mes TEXT PRIMARY KEY, efectivo REAL NOT NULL, actualizado TEXT NOT NULL, por TEXT)").run();
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS fin_config (clave TEXT PRIMARY KEY, valor TEXT, actualizado TEXT NOT NULL)").run();
  esquemaListo = true;
}

// Qué es cada gasto de la administración: pago programado, pago sin programar, compra u otro
async function clasificarAdmin(env, gastos) {
  if (!gastos.length) return [];
  const ids = gastos.map(g => g.id), pagos = new Map(), compras = new Map();
  for (let i = 0; i < ids.length; i += 90) {
    const l = ids.slice(i, i + 90), q = l.map(() => "?").join(",");
    for (const p of (await env.DB.prepare(`SELECT p.id, p.gasto_id, p.item_id, p.nota, p.comprobante, COALESCE(p.titulo, i.titulo) AS titulo FROM agenda_pagos p LEFT JOIN agenda_items i ON i.id = p.item_id WHERE p.gasto_id IN (${q})`).bind(...l).all()).results) pagos.set(p.gasto_id, p);
    for (const c of (await env.DB.prepare(`SELECT id, gasto_id, titulo, cantidad FROM agenda_items WHERE tipo = 'compra' AND gasto_id IN (${q})`).bind(...l).all()).results) compras.set(c.gasto_id, c);
  }
  return gastos.map(g => {
    const p = pagos.get(g.id), c = compras.get(g.id);
    const cat = p ? (p.item_id ? "programado" : "no_programado") : c ? "compra" : "otro";
    const concepto = p ? p.titulo || g.concepto : c ? c.titulo + (c.cantidad ? ` (${c.cantidad})` : "") : g.concepto;
    return { id: g.id, dia: g.dia, concepto, monto: g.monto, forma: g.forma, cat, nota: p && p.nota || "", comprobante: p && p.comprobante ? p.id : null, creado: g.creado, por: g.creado_por || "" };
  });
}

export const CAT_TXT = { programado: "Pago programado", no_programado: "Pago no programado", compra: "Compra", otro: "Otro gasto", caja: "Gasto de caja (turnos)" };
export const FORMA_ADMIN = { EFECTIVO: "Efectivo (sobres)", TRANSFERENCIA: "Transferencia (banco)", TARJETA: "Tarjeta (banco)" };

export async function datosFinanzas(env, mes) {
  await asegurarEsquemaFinanzas(env);
  const { movs, gastos, gastosAdmin, transf, conteos, extras, inicios } = await leerMes(env, [mes]);
  const cortes = unirConteos(calcularCortes(movs, gastos, extras, inicios), conteos);
  const t = totalesMes(cortes, transf);
  const admin = await clasificarAdmin(env, gastosAdmin);
  const suma = (l, f = () => true) => r2(l.filter(f).reduce((a, x) => a + (x.monto ?? x.importe ?? 0), 0));

  const ingresos = { efectivo: r2(t.efectivo), tarjeta: r2(t.tarjeta), transferencias: r2(t.transferencias), otros: r2(t.otros), bascula: r2(t.bascula), pension: r2(t.pension), total: r2(t.ingresos) };
  const egresos = { caja: suma(gastos), programado: suma(admin, x => x.cat === "programado"), no_programado: suma(admin, x => x.cat === "no_programado"), compra: suma(admin, x => x.cat === "compra"), otro: suma(admin, x => x.cat === "otro") };
  egresos.total = r2(egresos.caja + egresos.programado + egresos.no_programado + egresos.compra + egresos.otro);

  // Efectivo en sobres
  const ini = await env.DB.prepare("SELECT efectivo, actualizado, por FROM fin_saldos WHERE mes = ?").bind(mes).first();
  const TURNO = { "MAÑANA": "mañana", TARDE: "tarde", NOCHE: "noche" };
  const movsEf = [
    ...conteos.filter(c => c.sobre > 0).map(c => ({ dia: c.dia, orden: c.dia + ({ "MAÑANA": "1", TARDE: "2", NOCHE: "3" }[c.turno] || "4"), tipo: "sobre", concepto: `Sobre del turno de la ${TURNO[c.turno] || c.turno}`, persona: c.persona, entrada: r2(c.sobre), salida: 0 })),
    ...admin.filter(x => x.forma === "EFECTIVO").map(x => ({ dia: x.dia, orden: x.dia + "5" + x.creado, tipo: x.cat, concepto: x.concepto, persona: null, entrada: 0, salida: r2(x.monto) }))
  ].sort((a, b) => a.orden.localeCompare(b.orden));
  let acum = ini ? ini.efectivo : 0;
  for (const m of movsEf) { acum = r2(acum + m.entrada - m.salida); m.saldo = ini ? acum : null; delete m.orden; }
  const recibido = r2(movsEf.reduce((a, m) => a + m.entrada, 0)), gastado = r2(movsEf.reduce((a, m) => a + m.salida, 0));
  const efectivo = { inicial: ini ? ini.efectivo : null, inicial_actualizado: ini ? ini.actualizado : null, recibido, gastado, saldo: ini ? r2(ini.efectivo + recibido - gastado) : null, movimientos: movsEf.reverse() };

  // Banco: entradas (transferencias de clientes) y salidas (pagos con transferencia o tarjeta)
  const cuentas = await env.DB.prepare("SELECT valor, actualizado FROM fin_config WHERE clave = 'cuentas'").first();
  const banco = { entradas: r2(t.transferencias), salidas: suma(admin, x => x.forma !== "EFECTIVO"), cuentas: cuentas ? cuentas.valor || "" : "", cuentas_actualizado: cuentas ? cuentas.actualizado : null };

  // Por día (para la gráfica): ingresos contra egresos
  const dias = {};
  const d = k => (dias[k] = dias[k] || { dia: k, ingresos: 0, egresos: 0 });
  for (const c of cortes) d(c.dia).ingresos += c.efectivo + c.tarjeta + c.extra.ingreso;
  for (const x of transf) d(x.fecha).ingresos += x.importe;
  for (const g of gastos) d(g.dia).egresos += g.monto;
  for (const g of admin) d(g.dia).egresos += g.monto;
  const porDia = Object.values(dias).map(x => ({ dia: x.dia, ingresos: r2(x.ingresos), egresos: r2(x.egresos) })).sort((a, b) => a.dia.localeCompare(b.dia));

  return { mes, ingresos, egresos, resultado: r2(ingresos.total - egresos.total), efectivo, banco, admin, gastos_caja: gastos, transferencias: transf, por_dia: porDia, cortes };
}

export function mesesFinanzas(actual = mesActual()) {
  const l = []; for (let k = 0; k < 13; k++) l.push(sumarMesesCaja(actual, -k)); return l;
}

// Rutas: /panel/api/finanzas...
export async function finanzasPanel(request, env, url, partes, usuario) {
  await asegurarEsquemaFinanzas(env);
  const meses = mesesFinanzas();
  if (partes.length === 1 && request.method === "GET") {
    const mes = RE_MES.test(url.searchParams.get("mes") || "") && meses.includes(url.searchParams.get("mes")) ? url.searchParams.get("mes") : meses[0];
    const d = await datosFinanzas(env, mes);
    delete d.cortes; delete d.gastos_caja;
    return json({ ok: true, meses, ...d });
  }
  if (request.method !== "POST") return json({ ok: false, error: "Ruta no encontrada." }, 404);
  let c; try { c = await request.json(); } catch { return json({ ok: false, error: "Datos inválidos." }, 400); }
  const quien = usuario && usuario.email || null, ahora = new Date().toISOString();
  if (partes[1] === "saldo") {
    const mes = String(c.mes || "");
    if (!meses.includes(mes)) return json({ ok: false, error: "Elige un mes de los últimos 13." }, 422);
    if (c.efectivo === "" || c.efectivo === null) { await env.DB.prepare("DELETE FROM fin_saldos WHERE mes = ?").bind(mes).run(); return json({ ok: true }); }
    const v = montoUsuario(c.efectivo);
    if (!(v >= 0) || v > 100000000) return json({ ok: false, error: "Escribe el efectivo con el que empezó el mes (solo números)." }, 422);
    await env.DB.prepare("INSERT INTO fin_saldos (mes, efectivo, actualizado, por) VALUES (?, ?, ?, ?) ON CONFLICT(mes) DO UPDATE SET efectivo = excluded.efectivo, actualizado = excluded.actualizado, por = excluded.por").bind(mes, v, ahora, quien).run();
    return json({ ok: true });
  }
  if (partes[1] === "cuentas") {
    const texto = String(c.texto ?? "").replace(/\r/g, "").slice(0, 4000);
    await env.DB.prepare("INSERT INTO fin_config (clave, valor, actualizado) VALUES ('cuentas', ?, ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor, actualizado = excluded.actualizado").bind(texto, ahora).run();
    return json({ ok: true });
  }
  return json({ ok: false, error: "Ruta no encontrada." }, 404);
}
