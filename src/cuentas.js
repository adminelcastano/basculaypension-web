// Cuentas bancarias y tarjetas de crédito de la administración.
// - Débito: tienen saldo (inicial del mes + entradas − salidas).
// - Crédito: llevan deuda (inicial del mes + cargos − pagos a la tarjeta). Lo que se compra con la tarjeta cuenta como
//   gasto el día de la compra; pagar la tarjeta es un traspaso (no es un gasto nuevo, así no se cuenta dos veces).
// Los cobros con tarjeta de los turnos caen en la cuenta marcada con `tarjeta = 1` (MDO PAGO).
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });

export const CUENTAS_BASE = [
  // [id, nombre, tipo, recibe cobros con tarjeta, por defecto para transferencias de clientes, por defecto para pagos]
  ["mdo-pago", "MDO PAGO", "debito", 1, 0, 0],
  ["bbva-pyme", "BBVA PYME", "debito", 0, 1, 1],
  ["bbva-personal", "BBVA PERSONAL", "debito", 0, 0, 0],
  ["banorte-debito", "BANORTE DEBITO", "debito", 0, 0, 0],
  ["klar-manu", "KLAR MANU", "debito", 0, 0, 0],
  ["nu", "NÚ", "debito", 0, 0, 0],
  ["banorte-credito", "BANORTE CREDITO", "credito", 0, 0, 0],
  ["banamex-credito", "BANAMEX CREDITO", "credito", 0, 0, 0],
  ["liverpool-credito", "LIVERPOOL CREDITO", "credito", 0, 0, 0],
  ["klar-itzel", "KLAR ITZEL", "credito", 0, 0, 0]
];
export const TIPOS_MOV = { traspaso: "Traspaso entre cuentas", pago_tarjeta: "Pago de tarjeta de crédito", deposito: "Depósito en efectivo", retiro: "Retiro de efectivo" };

let listo = false;
export async function asegurarEsquemaCuentas(env) {
  if (listo) return;
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS fin_cuentas (id TEXT PRIMARY KEY, nombre TEXT NOT NULL, tipo TEXT NOT NULL, tarjeta INTEGER NOT NULL DEFAULT 0, def_transf INTEGER NOT NULL DEFAULT 0, def_pago INTEGER NOT NULL DEFAULT 0, activa INTEGER NOT NULL DEFAULT 1, orden INTEGER NOT NULL DEFAULT 99, creado TEXT NOT NULL)").run();
  if (!(await env.DB.prepare("SELECT COUNT(*) n FROM fin_cuentas").first()).n) {
    const ahora = new Date().toISOString();
    await env.DB.batch(CUENTAS_BASE.map(([id, nombre, tipo, tj, dt, dp], i) => env.DB.prepare("INSERT OR IGNORE INTO fin_cuentas (id, nombre, tipo, tarjeta, def_transf, def_pago, orden, creado) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(id, nombre, tipo, tj, dt, dp, i, ahora)));
  }
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS fin_saldos_cuenta (mes TEXT NOT NULL, cuenta TEXT NOT NULL, saldo REAL NOT NULL, actualizado TEXT NOT NULL, PRIMARY KEY (mes, cuenta))").run();
  // Traspasos, pagos de tarjeta, depósitos y retiros de efectivo ("sobres" = efectivo de la administración)
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS fin_movs (id TEXT PRIMARY KEY, mes TEXT NOT NULL, fecha TEXT NOT NULL, tipo TEXT NOT NULL, origen TEXT NOT NULL, destino TEXT NOT NULL, importe REAL NOT NULL, nota TEXT, creado TEXT NOT NULL, creado_por TEXT)").run();
  // Cuenta en la que entra o de la que sale cada movimiento
  let faltan = false;
  for (const t of ["caja_gastos", "agenda_pagos", "agenda_items", "caja_transf"]) {
    let cols;
    try { cols = new Set((await env.DB.prepare(`PRAGMA table_info(${t})`).all()).results.map(r => r.name)); } catch { faltan = true; continue; }
    if (!cols.size) { faltan = true; continue; }
    if (!cols.has("cuenta")) await env.DB.prepare(`ALTER TABLE ${t} ADD COLUMN cuenta TEXT`).run();
  }
  listo = !faltan;
}

export async function listaCuentas(env, todas = false) {
  await asegurarEsquemaCuentas(env);
  return (await env.DB.prepare(`SELECT id, nombre, tipo, tarjeta, def_transf, def_pago, activa FROM fin_cuentas ${todas ? "" : "WHERE activa = 1"} ORDER BY tipo DESC, orden, nombre`).all()).results;
}

// "Pagado con": EFECTIVO (sobres) o C:<cuenta>. También acepta TRANSFERENCIA/TARJETA de antes (sin cuenta).
export async function leerMedio(env, valor, porDefecto = null) {
  const v = String(valor ?? "").trim();
  if (v === "EFECTIVO") return { forma: "EFECTIVO", cuenta: null };
  if (v.startsWith("C:")) {
    await asegurarEsquemaCuentas(env);
    const c = await env.DB.prepare("SELECT id, tipo FROM fin_cuentas WHERE id = ?").bind(v.slice(2)).first();
    if (c) return { forma: c.tipo === "credito" ? "TARJETA" : "TRANSFERENCIA", cuenta: c.id };
  }
  if (v === "TRANSFERENCIA" || v === "TARJETA") return { forma: v, cuenta: null };
  return porDefecto;
}
export async function cuentaDefecto(env, campo) {
  await asegurarEsquemaCuentas(env);
  const c = await env.DB.prepare(`SELECT id FROM fin_cuentas WHERE ${campo === "transf" ? "def_transf" : "def_pago"} = 1 AND activa = 1 ORDER BY orden LIMIT 1`).first();
  return c ? c.id : null;
}

const r2 = v => Math.round(v * 100) / 100;
// Estado de cada cuenta en el mes: inicial, entradas, salidas y saldo (débito) o deuda (crédito)
export async function estadoCuentas(env, mes, { tarjetaMes = 0, transf = [], gastosAdmin = [] }) {
  const cuentas = await listaCuentas(env, true);
  const ini = Object.fromEntries((await env.DB.prepare("SELECT cuenta, saldo FROM fin_saldos_cuenta WHERE mes = ?").bind(mes).all()).results.map(r => [r.cuenta, r.saldo]));
  const movs = (await env.DB.prepare("SELECT * FROM fin_movs WHERE mes = ? ORDER BY fecha DESC, creado DESC").bind(mes).all()).results;
  const est = Object.fromEntries(cuentas.map(c => [c.id, { ...c, inicial: ini[c.id] ?? null, entradas: 0, salidas: 0, detalle: { tarjeta: 0, transferencias: 0, recibido: 0, pagos: 0, enviado: 0 } }]));
  const tj = cuentas.find(c => c.tarjeta);
  if (tj) { est[tj.id].entradas += tarjetaMes; est[tj.id].detalle.tarjeta = r2(tarjetaMes); }
  let sinCuenta = { transferencias: 0, pagos: 0 };
  for (const x of transf) { if (x.cuenta && est[x.cuenta]) { est[x.cuenta].entradas += x.importe; est[x.cuenta].detalle.transferencias += x.importe; } else sinCuenta.transferencias += x.importe; }
  for (const g of gastosAdmin) {
    if (g.forma === "EFECTIVO") continue;
    if (g.cuenta && est[g.cuenta]) { est[g.cuenta].salidas += g.monto; est[g.cuenta].detalle.pagos += g.monto; } else sinCuenta.pagos += g.monto;
  }
  for (const m of movs) {
    if (est[m.origen]) { est[m.origen].salidas += m.importe; est[m.origen].detalle.enviado += m.importe; }
    if (est[m.destino]) { est[m.destino].entradas += m.importe; est[m.destino].detalle.recibido += m.importe; }
  }
  const lista = Object.values(est).map(c => {
    const e = r2(c.entradas), s = r2(c.salidas);
    // Crédito: los cargos (salidas) suben la deuda y los pagos a la tarjeta (entradas) la bajan
    const saldo = c.inicial == null ? null : c.tipo === "credito" ? r2(c.inicial + s - e) : r2(c.inicial + e - s);
    return { ...c, entradas: e, salidas: s, saldo, detalle: Object.fromEntries(Object.entries(c.detalle).map(([k, v]) => [k, r2(v)])) };
  });
  // Efectivo en sobres: depósitos al banco (salen) y retiros de efectivo (entran)
  const sobres = { depositos: r2(movs.filter(m => m.origen === "sobres").reduce((a, m) => a + m.importe, 0)), retiros: r2(movs.filter(m => m.destino === "sobres").reduce((a, m) => a + m.importe, 0)) };
  return { cuentas: lista, movs, sobres, sin_cuenta: { transferencias: r2(sinCuenta.transferencias), pagos: r2(sinCuenta.pagos) } };
}

// Rutas: /panel/api/finanzas/cuenta, saldo-cuenta, mov, mov/<id>/eliminar
export async function cuentasRutas(request, env, partes, usuario, meses) {
  await asegurarEsquemaCuentas(env);
  let c; try { c = await request.json(); } catch { return json({ ok: false, error: "Datos inválidos." }, 400); }
  const ahora = new Date().toISOString();
  if (partes[1] === "cuenta") {
    const nombre = String(c.nombre ?? "").replace(/\s+/g, " ").trim().toUpperCase().slice(0, 40);
    const tipo = c.tipo === "credito" ? "credito" : "debito";
    if (c.id) {
      const f = await env.DB.prepare("SELECT * FROM fin_cuentas WHERE id = ?").bind(c.id).first();
      if (!f) return json({ ok: false, error: "No existe esa cuenta." }, 404);
      await env.DB.prepare("UPDATE fin_cuentas SET nombre = ?, tipo = ?, activa = ? WHERE id = ?").bind(nombre || f.nombre, "tipo" in c ? tipo : f.tipo, "activa" in c ? (c.activa ? 1 : 0) : f.activa, c.id).run();
      for (const k of ["def_transf", "def_pago", "tarjeta"]) if (c[k]) await env.DB.batch([env.DB.prepare(`UPDATE fin_cuentas SET ${k} = 0`), env.DB.prepare(`UPDATE fin_cuentas SET ${k} = 1 WHERE id = ?`).bind(c.id)]);
      return json({ ok: true });
    }
    if (nombre.length < 2) return json({ ok: false, error: "Escribe el nombre de la cuenta." }, 422);
    const id = nombre.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || crypto.randomUUID();
    if (await env.DB.prepare("SELECT 1 FROM fin_cuentas WHERE id = ?").bind(id).first()) return json({ ok: false, error: "Ya existe una cuenta con ese nombre." }, 409);
    await env.DB.prepare("INSERT INTO fin_cuentas (id, nombre, tipo, orden, creado) VALUES (?, ?, ?, 50, ?)").bind(id, nombre, tipo, ahora).run();
    return json({ ok: true, id });
  }
  if (partes[1] === "saldo-cuenta") {
    const mes = String(c.mes || ""), cuenta = String(c.cuenta || "");
    if (!meses.includes(mes)) return json({ ok: false, error: "Elige un mes de los últimos 13." }, 422);
    if (!(await env.DB.prepare("SELECT 1 FROM fin_cuentas WHERE id = ?").bind(cuenta).first())) return json({ ok: false, error: "Cuenta inválida." }, 422);
    const t = String(c.saldo ?? "").replace(/[$,\s]/g, "");
    if (t === "") { await env.DB.prepare("DELETE FROM fin_saldos_cuenta WHERE mes = ? AND cuenta = ?").bind(mes, cuenta).run(); return json({ ok: true }); }
    if (!/^-?\d{1,10}(\.\d{1,2})?$/.test(t)) return json({ ok: false, error: "Escribe el saldo (solo números)." }, 422);
    await env.DB.prepare("INSERT INTO fin_saldos_cuenta (mes, cuenta, saldo, actualizado) VALUES (?, ?, ?, ?) ON CONFLICT(mes, cuenta) DO UPDATE SET saldo = excluded.saldo, actualizado = excluded.actualizado").bind(mes, cuenta, Number(t), ahora).run();
    return json({ ok: true });
  }
  if (partes[1] === "mov" && partes.length === 2) {
    const tipo = TIPOS_MOV[c.tipo] ? c.tipo : "";
    const fecha = String(c.fecha || ""), importe = Number(String(c.importe ?? "").replace(/[$,\s]/g, ""));
    const origen = tipo === "deposito" ? "sobres" : String(c.origen || ""), destino = tipo === "retiro" ? "sobres" : String(c.destino || "");
    const cuentas = Object.fromEntries((await listaCuentas(env, true)).map(x => [x.id, x]));
    const errores = {};
    if (!tipo) errores.tipo = "Elige el tipo de movimiento.";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !meses.includes(fecha.slice(0, 7))) errores.fecha = "Elige una fecha de los últimos 13 meses.";
    if (!(importe > 0) || importe > 100000000) errores.importe = "Escribe el importe.";
    if (origen !== "sobres" && !cuentas[origen]) errores.origen = "Elige de qué cuenta sale.";
    if (destino !== "sobres" && !cuentas[destino]) errores.destino = "Elige a qué cuenta entra.";
    if (origen === destino) errores.destino = "La cuenta de origen y la de destino son la misma.";
    if (tipo === "pago_tarjeta" && cuentas[destino] && cuentas[destino].tipo !== "credito") errores.destino = "El pago de tarjeta va a una tarjeta de crédito.";
    if (Object.keys(errores).length) return json({ ok: false, error: Object.values(errores).join(" "), errores }, 422);
    const id = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO fin_movs (id, mes, fecha, tipo, origen, destino, importe, nota, creado, creado_por) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(id, fecha.slice(0, 7), fecha, tipo, origen, destino, Math.round(importe * 100) / 100, String(c.nota || "").trim().slice(0, 200) || null, ahora, usuario && usuario.email || null).run();
    return json({ ok: true, id });
  }
  if (partes[1] === "mov" && partes[3] === "eliminar") {
    const r = await env.DB.prepare("DELETE FROM fin_movs WHERE id = ?").bind(partes[2]).run();
    return json({ ok: true, borrados: r.meta && r.meta.changes || 0 });
  }
  return json({ ok: false, error: "Ruta no encontrada." }, 404);
}
