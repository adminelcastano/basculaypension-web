// Cuentas bancarias y tarjetas de crédito de la administración.
// - Débito: tienen saldo (inicial del mes + entradas − salidas).
// - Crédito: llevan deuda (inicial del mes + cargos − pagos a la tarjeta). Lo que se compra con la tarjeta cuenta como
//   gasto el día de la compra; pagar la tarjeta es un traspaso (no es un gasto nuevo, así no se cuenta dos veces).
// Los cobros con tarjeta de los turnos caen en la cuenta marcada con `tarjeta = 1` (MDO PAGO).
import { mesesAbiertos } from "./caja.js";
import { idFinanciero, centavosIguales } from "./finanzas-idempotencia.js";
import { asegurarEsquemaBitacora, stmtBitacora, stmtBitacoraSiCambio } from "./bitacora.js";
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
// Comisión que cobra la terminal (Mercado Pago) por cada cobro con tarjeta: porcentaje + IVA sobre la comisión
export const IVA = 0.16;
export const COMISION_INICIAL = 3.5; // Mercado Pago: 3.50 % + IVA (confirmado por Manuel el 15 oct 2026)

let listo = false;
export async function asegurarEsquemaCuentas(env) {
  if (listo) return;
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS fin_cuentas (id TEXT PRIMARY KEY, nombre TEXT NOT NULL, tipo TEXT NOT NULL, tarjeta INTEGER NOT NULL DEFAULT 0, def_transf INTEGER NOT NULL DEFAULT 0, def_pago INTEGER NOT NULL DEFAULT 0, activa INTEGER NOT NULL DEFAULT 1, orden INTEGER NOT NULL DEFAULT 99, creado TEXT NOT NULL)").run();
  if (!(await env.DB.prepare("SELECT COUNT(*) n FROM fin_cuentas").first()).n) {
    const ahora = new Date().toISOString();
    await env.DB.batch(CUENTAS_BASE.map(([id, nombre, tipo, tj, dt, dp], i) => env.DB.prepare("INSERT OR IGNORE INTO fin_cuentas (id, nombre, tipo, tarjeta, def_transf, def_pago, orden, creado) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(id, nombre, tipo, tj, dt, dp, i, ahora)));
  }
  // Comisión de la cuenta que recibe los cobros con tarjeta (porcentaje y si se le suma IVA)
  const colsC = new Set((await env.DB.prepare("PRAGMA table_info(fin_cuentas)").all()).results.map(r => r.name));
  if (!colsC.has("comision_pct")) {
    await env.DB.prepare("ALTER TABLE fin_cuentas ADD COLUMN comision_pct REAL").run();
    await env.DB.prepare("UPDATE fin_cuentas SET comision_pct = ? WHERE tarjeta = 1").bind(COMISION_INICIAL).run();
  }
  if (!colsC.has("comision_iva")) await env.DB.prepare("ALTER TABLE fin_cuentas ADD COLUMN comision_iva INTEGER NOT NULL DEFAULT 1").run();
  // La tasa real es 3.50 % + IVA: corrige una sola vez la que se puso al principio (3.49 %)
  if (env.FILES && !(await env.FILES.get("mig:comision350"))) {
    await env.DB.prepare("UPDATE fin_cuentas SET comision_pct = ?, comision_iva = 1 WHERE tarjeta = 1 AND (comision_pct IS NULL OR comision_pct = 3.49)").bind(COMISION_INICIAL).run();
    await env.FILES.put("mig:comision350", "1");
  }
  await asegurarEsquemaBitacora(env);
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS fin_saldos_cuenta (mes TEXT NOT NULL, cuenta TEXT NOT NULL, saldo REAL NOT NULL, actualizado TEXT NOT NULL, PRIMARY KEY (mes, cuenta))").run();
  // Traspasos, pagos de tarjeta, depósitos y retiros de efectivo ("sobres" = efectivo de la administración)
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS fin_movs (id TEXT PRIMARY KEY, mes TEXT NOT NULL, fecha TEXT NOT NULL, tipo TEXT NOT NULL, origen TEXT NOT NULL, destino TEXT NOT NULL, importe REAL NOT NULL, nota TEXT, creado TEXT NOT NULL, creado_por TEXT)").run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS fin_movs_mes ON fin_movs (mes)").run();
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
  return (await env.DB.prepare(`SELECT id, nombre, tipo, tarjeta, def_transf, def_pago, activa, comision_pct, comision_iva FROM fin_cuentas ${todas ? "" : "WHERE activa = 1"} ORDER BY tipo DESC, orden, nombre`).all()).results;
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

// Comisión de un cobro con tarjeta (redondeada por cobro, como la cobra la terminal)
export const comisionDe = (importe, cuenta) => !cuenta || !(cuenta.comision_pct > 0) ? 0 : r2(importe * cuenta.comision_pct / 100 * (cuenta.comision_iva ? 1 + IVA : 1));
// La terminal operativa es Mercado Pago: su 3.50 % + IVA nunca ha cambiado.
// Usar esta función para cobros reales, independientemente de ajustes de cuenta.
export const comisionMercadoPago = (importe, cuenta) =>
  !cuenta ? 0 : r2(importe * COMISION_INICIAL / 100 * (1 + IVA));

// Flujos de un mes por cuenta y en el efectivo de la administración (sobres). Función pura: recibe los registros
// del mes (ver leerFlujos en finanzas.js) y devuelve entradas y salidas, con el detalle de cada una.
//   d.tarjeta:   cobros con tarjeta de los tickets [{dia, importe}]
//   d.transf:    transferencias de clientes que cuentan [{fecha, importe, cuenta}] (hoja + capturadas, ya sin duplicar)
//   d.admin:     pagos, compras y otros gastos de la administración [{dia, forma, cuenta, monto, concepto, ...}]
//   d.movs:      traspasos, pagos de tarjeta, depósitos y retiros de efectivo
//   d.sobres:    sobres entregados en los cortes [{dia, turno, persona, sobre}]
//   d.cambio:    efectivo que la administración puso en la caja para aumentar el cambio [{dia, turno, monto, persona}]
export function flujosMes(d, cuentas) {
  const est = Object.fromEntries(cuentas.map(c => [c.id, { entradas: 0, salidas: 0, detalle: { tarjeta: 0, comision: 0, transferencias: 0, recibido: 0, pagos: 0, enviado: 0 } }]));
  const tj = cuentas.find(c => c.tarjeta);
  const sinCuenta = { transferencias: 0, pagos: 0 };
  let tarjeta = 0, comision = 0;
  for (const t of d.tarjeta || []) { tarjeta += t.importe; comision += comisionMercadoPago(t.importe, tj); }
  if (tj) { est[tj.id].entradas += tarjeta - comision; est[tj.id].detalle.tarjeta = r2(tarjeta); est[tj.id].detalle.comision = r2(comision); }
  for (const x of d.transf || []) {
    if (x.cuenta && est[x.cuenta]) { est[x.cuenta].entradas += x.importe; est[x.cuenta].detalle.transferencias += x.importe; } else sinCuenta.transferencias += x.importe;
  }
  for (const g of d.admin || []) {
    if (g.forma === "EFECTIVO") continue;
    if (g.cuenta && est[g.cuenta]) { est[g.cuenta].salidas += g.monto; est[g.cuenta].detalle.pagos += g.monto; } else sinCuenta.pagos += g.monto;
  }
  for (const m of d.movs || []) {
    if (est[m.origen]) { est[m.origen].salidas += m.importe; est[m.origen].detalle.enviado += m.importe; }
    if (est[m.destino]) { est[m.destino].entradas += m.importe; est[m.destino].detalle.recibido += m.importe; }
  }
  // Efectivo de la administración (sobres): entran los sobres de los cortes y los retiros del banco; salen los pagos
  // y compras en efectivo, los depósitos al banco, los pagos de tarjeta en efectivo y el cambio que se pone en la caja.
  const ef = [];
  for (const c of d.sobres || []) if (c.sobre > 0) ef.push({ dia: c.dia, orden: c.dia + ({ "MAÑANA": "1", TARDE: "2", NOCHE: "3" }[c.turno] || "4"), tipo: "sobre", concepto: `Sobre del turno de la ${({ "MAÑANA": "mañana", TARDE: "tarde", NOCHE: "noche" })[c.turno] || c.turno}`, persona: c.persona, entrada: r2(c.sobre), salida: 0 });
  for (const x of d.admin || []) if (x.forma === "EFECTIVO") ef.push({ dia: x.dia, orden: x.dia + "5" + (x.creado || ""), tipo: x.cat || "otro", concepto: x.concepto, persona: null, entrada: 0, salida: r2(x.monto) });
  // Cobros posteriores de tickets pendientes: efectivo recibido directamente por administración.
  for (const x of d.cobrosAdmin || []) ef.push({
    dia: x.dia, orden: x.dia + "5" + (x.creado || ""), tipo: "cobro-pendiente",
    concepto: "Cobro recuperado · " + (x.servicio === "bascula" ? "Báscula" : "Pensión") + " · folio " + x.folio,
    persona: x.por || null, entrada: r2(x.monto), salida: 0
  });
  // Renglones de la hoja: efectivo que la administración tomó de la caja antes del corte (entra) o puso en ella (sale)
  for (const x of d.hojaAdmin || []) ef.push({ dia: x.dia, orden: x.dia + ({ "MAÑANA": "1", TARDE: "2", NOCHE: "3" }[x.turno] || "4") + "0", tipo: x.clase === "a_admin" ? "llevo" : "cambio", concepto: `${x.concepto} (turno de la ${({ "MAÑANA": "mañana", TARDE: "tarde", NOCHE: "noche" })[x.turno] || x.turno}, hoja)`, persona: null, entrada: x.clase === "a_admin" ? r2(x.monto) : 0, salida: x.clase === "de_admin" ? r2(x.monto) : 0 });
  for (const x of d.cambio || []) ef.push({ dia: x.dia, orden: x.dia + "0" + (x.creado || ""), tipo: "cambio", concepto: `Aumento de cambio a la caja (turno de la ${({ "MAÑANA": "mañana", TARDE: "tarde", NOCHE: "noche" })[x.turno] || x.turno})`, persona: x.persona || null, entrada: 0, salida: r2(x.monto) });
  const nom = id => (cuentas.find(c => c.id === id) || { nombre: id }).nombre;
  for (const m of d.movs || []) {
    if (m.origen === "sobres") ef.push({ dia: m.fecha, orden: m.fecha + "6" + m.creado, tipo: m.tipo, concepto: m.tipo === "pago_tarjeta" ? `Pago en efectivo a ${nom(m.destino)}` : `Depósito a ${nom(m.destino)}`, persona: null, entrada: 0, salida: r2(m.importe) });
    if (m.destino === "sobres") ef.push({ dia: m.fecha, orden: m.fecha + "6" + m.creado, tipo: m.tipo, concepto: `Retiro de ${nom(m.origen)}`, persona: null, entrada: r2(m.importe), salida: 0 });
  }
  ef.sort((a, b) => a.orden.localeCompare(b.orden));
  const cu = Object.fromEntries(Object.entries(est).map(([id, c]) => [id, { entradas: r2(c.entradas), salidas: r2(c.salidas), detalle: Object.fromEntries(Object.entries(c.detalle).map(([k, v]) => [k, r2(v)])) }]));
  return {
    cuentas: cu, tarjeta: r2(tarjeta), comision: r2(comision),
    sobres: { entradas: r2(ef.reduce((a, m) => a + m.entrada, 0)), salidas: r2(ef.reduce((a, m) => a + m.salida, 0)), movimientos: ef },
    sin_cuenta: { transferencias: r2(sinCuenta.transferencias), pagos: r2(sinCuenta.pagos) }
  };
}

// Saldo de un mes encadenado con los anteriores. El saldo inicial de un mes es el que se capturó (conteo real) o,
// si no se capturó, el saldo final calculado del mes anterior. Cuando hay captura y también cálculo, la diferencia
// (ajuste) dice cuánto se desvió la realidad de lo registrado.
//   meses:     meses en orden, del más viejo al que se pide (el último)
//   capturas:  { mes: { clave: saldo } }   (clave = id de la cuenta o "sobres")
//   flujos:    { mes: { clave: { entradas, salidas } } }
//   credito:   Set de claves que son deuda (los cargos suben la deuda y los pagos la bajan)
export function encadenarSaldos(meses, claves, capturas, flujos, credito = new Set()) {
  const out = {};
  for (const k of claves) {
    let final = null, r = null;
    for (const m of meses) {
      const cap = capturas[m] && capturas[m][k] != null ? capturas[m][k] : null;
      const calc = final;
      const ini = cap != null ? cap : calc;
      const f = (flujos[m] && flujos[m][k]) || { entradas: 0, salidas: 0 };
      final = ini == null ? null : r2(credito.has(k) ? ini + f.salidas - f.entradas : ini + f.entradas - f.salidas);
      r = { inicial: ini, capturado: cap != null, calculado: calc, ajuste: cap != null && calc != null ? r2(cap - calc) : null, entradas: f.entradas, salidas: f.salidas, saldo: final };
    }
    out[k] = r;
  }
  return out;
}

// Rutas: /panel/api/finanzas/cuenta, saldo-cuenta, mov, mov/<id>/eliminar
export async function cuentasRutas(request, env, partes, usuario, meses) {
  await asegurarEsquemaCuentas(env);
  let c; try { c = await request.json(); } catch { return json({ ok: false, error: "Datos inválidos." }, 400); }
  const ahora = new Date().toISOString(), quien = usuario && usuario.email || null;
  // Solo los meses abiertos (el actual y, mientras no se cierre, el anterior) aceptan cambios de dinero
  const abiertos = await mesesAbiertos(env);
  if (partes[1] === "cuenta") {
    const nombre = String(c.nombre ?? "").replace(/\s+/g, " ").trim().toUpperCase().slice(0, 40);
    const tipo = c.tipo === "credito" ? "credito" : "debito";
    if (c.id) {
      const f = await env.DB.prepare("SELECT * FROM fin_cuentas WHERE id = ?").bind(c.id).first();
      if (!f) return json({ ok: false, error: "No existe esa cuenta." }, 404);
      const tipoFinal = "tipo" in c ? tipo : f.tipo;
      const rolesRecepcion = ["tarjeta", "def_transf", "def_pago"];
      if (tipoFinal === "credito" && (
        rolesRecepcion.some(rol => c[rol]) ||
        (tipoFinal !== f.tipo && rolesRecepcion.some(rol => f[rol]))
      )) return json({ok:false,error:"Las cuentas para recibir cobros y pagos deben ser de débito. Selecciona una cuenta de débito para esos usos antes de cambiar este tipo."},422);
      // Una cuenta que ya tiene movimientos no puede cambiar de débito a crédito:
      // invierte la fórmula de todo su historial, también el de meses cerrados.
      if ("tipo" in c && tipo !== f.tipo) {
        const actividad = await env.DB.prepare(`SELECT
          EXISTS(SELECT 1 FROM fin_movs WHERE origen = ? OR destino = ?) +
          EXISTS(SELECT 1 FROM fin_saldos_cuenta WHERE cuenta = ?) +
          EXISTS(SELECT 1 FROM caja_gastos WHERE cuenta = ?) +
          EXISTS(SELECT 1 FROM agenda_pagos WHERE cuenta = ?) +
          EXISTS(SELECT 1 FROM caja_transf WHERE cuenta = ?) AS usado`)
          .bind(f.id, f.id, f.id, f.id, f.id, f.id).first();
        const origenes = (f.tarjeta || f.def_transf) ? await env.DB.prepare(`SELECT 1 FROM caja_mov
          WHERE tipo = 'ticket' AND ${f.tarjeta && f.def_transf ? "(forma = 'TARJETA' OR forma LIKE 'TRANSF%')" : f.tarjeta ? "forma = 'TARJETA'" : "forma LIKE 'TRANSF%'"} LIMIT 1`).first() : null;
        if ((actividad && actividad.usado) || origenes)
          return json({ok:false,error:"Esta cuenta ya tiene movimientos, cobros o saldos. Cambiarla entre débito y crédito reinterpretaría meses anteriores. Conserva el tipo y crea una cuenta nueva si corresponde."},409);
      }
      // Los cobros antiguos se asignan según el rol actual de estas cuentas.
      // Impedir un cambio silencioso mientras no exista un historial de asignaciones por fecha.
      for (const rol of ["tarjeta", "def_transf"]) if (c[rol]) {
        const previa = await env.DB.prepare(`SELECT id FROM fin_cuentas WHERE ${rol} = 1 LIMIT 1`).first();
        if (previa?.id !== f.id) {
          const forma = rol === "tarjeta" ? "forma = 'TARJETA'" : "forma LIKE 'TRANSF%'";
          const usados = await env.DB.prepare(`SELECT 1 FROM caja_mov WHERE tipo = 'ticket' AND ${forma} LIMIT 1`).first();
          if (usados) return json({ok:false,error:rol==="tarjeta"
            ? "Hay cobros históricos con tarjeta. Cambiar la cuenta receptora alteraría los saldos anteriores. Mantén la cuenta actual hasta que se incorpore asignación por fecha."
            : "Hay transferencias históricas de tickets. Cambiar su cuenta por defecto alteraría saldos anteriores. Mantén la asignación hasta contar con vigencias por fecha."},409);
        }
      }
      if (f.tarjeta && ("comision_pct" in c || "comision_iva" in c))
        return json({ ok: false, error: "La comisión histórica de Mercado Pago es fija: 3.50 % + IVA." }, 409);
      let pct = f.comision_pct, iva = f.comision_iva;
      if ("comision_pct" in c) {
        const t = String(c.comision_pct ?? "").replace(/[%\s]/g, "");
        if (t === "") pct = null;
        else if (/^\d{1,2}(\.\d{1,3})?$/.test(t) && Number(t) < 20) pct = Number(t);
        else return json({ ok: false, error: "Escribe la comisión como porcentaje (ej. 3.50)." }, 422);
      }
      if ("comision_iva" in c) iva = c.comision_iva ? 1 : 0;
      if ("nombre" in c && nombre.length < 2) return json({ ok: false, error: "Escribe el nombre de la cuenta." }, 422);
      if (nombre && nombre !== f.nombre && await env.DB.prepare("SELECT 1 FROM fin_cuentas WHERE id != ? AND upper(nombre) = ?").bind(c.id, nombre).first()) return json({ ok: false, error: "Ya hay otra cuenta con ese nombre." }, 409);
      const st = [env.DB.prepare("UPDATE fin_cuentas SET nombre = ?, tipo = ?, activa = ?, comision_pct = ?, comision_iva = ? WHERE id = ?").bind(nombre || f.nombre, "tipo" in c ? tipo : f.tipo, "activa" in c ? (c.activa ? 1 : 0) : f.activa, pct, iva, c.id)];
      for (const k of ["def_transf", "def_pago", "tarjeta"]) if (c[k]) st.push(env.DB.prepare(`UPDATE fin_cuentas SET ${k} = 0`), env.DB.prepare(`UPDATE fin_cuentas SET ${k} = 1 WHERE id = ?`).bind(c.id));
      st.push(stmtBitacora(env, { quien, accion: "editar", que: "Cuenta", ref: f.id, detalle: { cuenta: f.nombre, cambios: Object.fromEntries(Object.entries(c).filter(([k]) => k !== "id")) } }));
      await env.DB.batch(st);
      return json({ ok: true });
    }
    if (nombre.length < 2) return json({ ok: false, error: "Escribe el nombre de la cuenta." }, 422);
    const id = nombre.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || crypto.randomUUID();
    if (id === "sobres" || await env.DB.prepare("SELECT 1 FROM fin_cuentas WHERE id = ?").bind(id).first()) return json({ ok: false, error: "Ya existe una cuenta con ese nombre." }, 409);
    await env.DB.batch([
      env.DB.prepare("INSERT INTO fin_cuentas (id, nombre, tipo, orden, creado) VALUES (?, ?, ?, 50, ?)").bind(id, nombre, tipo, ahora),
      stmtBitacora(env, { quien, accion: "crear", que: "Cuenta", ref: id, detalle: { cuenta: nombre, tipo } })
    ]);
    return json({ ok: true, id });
  }
  if (partes[1] === "saldo-cuenta") {
    const mes = String(c.mes || ""), cuenta = String(c.cuenta || "");
    if (!abiertos.includes(mes)) return json({ ok: false, error: "Solo se puede capturar el saldo inicial del mes abierto; los meses anteriores toman el saldo calculado." }, 409);
    const f = await env.DB.prepare("SELECT nombre FROM fin_cuentas WHERE id = ?").bind(cuenta).first();
    if (!f) return json({ ok: false, error: "Cuenta inválida." }, 422);
    const antes = await env.DB.prepare("SELECT saldo FROM fin_saldos_cuenta WHERE mes = ? AND cuenta = ?").bind(mes, cuenta).first();
    const t = String(c.saldo ?? "").replace(/[$,\s]/g, "");
    const log = saldo => stmtBitacoraSiCambio(env, { quien,
      accion: saldo == null ? "borrar" : antes ? "editar" : "crear",
      que: "Saldo inicial de cuenta", ref: cuenta, mes,
      detalle: { cuenta: f.nombre, antes: antes ? antes.saldo : null, ahora: saldo } });
    if (t === "") {
      if (!antes) return json({ok:true,sin_cambios:true});
      const resultado = await env.DB.batch([
        env.DB.prepare("DELETE FROM fin_saldos_cuenta WHERE mes = ? AND cuenta = ? AND saldo = ?").bind(mes, cuenta, antes.saldo),
        log(null)
      ]);
      if (!resultado[0]?.meta?.changes)
        return json({ok:false,error:"El saldo fue modificado en otra sesión. Actualiza la lista antes de borrarlo."},409);
      return json({ok:true});
    }
    if (!/^-?\d{1,10}(\.\d{1,2})?$/.test(t))
      return json({ok:false,error:"Escribe el saldo (solo números)."},422);
    const saldo = Number(t);
    if (antes && centavosIguales(antes.saldo, saldo)) return json({ok:true,sin_cambios:true});
    // Compara con la versión leída: dos pestañas no se pisan al guardar.
    // La inserción por primera vez solo gana si nadie creó el saldo entretanto.
    const resultado = await env.DB.batch([
      env.DB.prepare(`INSERT INTO fin_saldos_cuenta (mes, cuenta, saldo, actualizado) VALUES (?, ?, ?, ?)
        ON CONFLICT(mes, cuenta) DO UPDATE SET saldo = excluded.saldo, actualizado = excluded.actualizado
        WHERE fin_saldos_cuenta.saldo = ?`).bind(mes, cuenta, saldo, ahora, antes ? antes.saldo : null),
      log(saldo)
    ]);
    if (!resultado[0]?.meta?.changes)
      return json({ok:false,error:"El saldo fue modificado en otra sesión. Actualiza la lista para confirmar el valor correcto."},409);
    return json({ok:true});
  }
  if (partes[1] === "mov" && partes.length === 2) {
    const tipo = Object.hasOwn(TIPOS_MOV, c.tipo) ? c.tipo : "";
    const fecha = String(c.fecha || ""), importe = Number(String(c.importe ?? "").replace(/[$,\s]/g, ""));
    // "sobres" (efectivo de la administración) solo sale en un depósito o en un pago de tarjeta en efectivo, y solo entra en un retiro
    const origen = tipo === "deposito" ? "sobres" : String(c.origen || ""), destino = tipo === "retiro" ? "sobres" : String(c.destino || "");
    const cuentas = Object.fromEntries((await listaCuentas(env, true)).map(x => [x.id, x]));
    const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(new Date());
    const errores = {};
    if (!tipo) errores.tipo = "Elige el tipo de movimiento.";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || fecha > hoy) errores.fecha = "Escribe la fecha del movimiento (no futura).";
    else if (!abiertos.includes(fecha.slice(0, 7))) errores.fecha = "Ese mes ya se cerró; usa una fecha del mes abierto.";
    if (!(importe > 0) || importe > 100000000) errores.importe = "Escribe el importe.";
    const okOrigen = origen === "sobres" ? ["deposito", "pago_tarjeta"].includes(tipo) : !!cuentas[origen];
    const okDestino = destino === "sobres" ? tipo === "retiro" : !!cuentas[destino];
    if (!okOrigen) errores.origen = "Elige de qué cuenta sale.";
    if (!okDestino) errores.destino = "Elige a qué cuenta entra.";
    if (origen === destino) errores.destino = "La cuenta de origen y la de destino son la misma.";
    if (tipo === "pago_tarjeta" && cuentas[destino] && cuentas[destino].tipo !== "credito") errores.destino = "El pago de tarjeta va a una tarjeta de crédito.";
    if (tipo === "pago_tarjeta" && cuentas[origen] && cuentas[origen].tipo === "credito") errores.origen = "La tarjeta se paga desde una cuenta de débito o en efectivo.";
    if (tipo === "deposito" && cuentas[destino] && cuentas[destino].tipo === "credito") errores.destino = "Para abonar a una tarjeta de crédito usa «Pago de tarjeta de crédito».";
    if (tipo === "retiro" && cuentas[origen] && cuentas[origen].tipo === "credito") errores.origen = "El retiro de efectivo sale de una cuenta de débito.";
    if (Object.keys(errores).length) return json({ ok: false, error: Object.values(errores).join(" "), errores }, 422);
    let id;
    try { id = await idFinanciero("mov", c.uid, quien); }
    catch (er) { return json({ ok: false, error: er.message }, 422); }
    const imp = Math.round(importe * 100) / 100, nota = String(c.nota || "").trim().slice(0, 200) || null;
    const repetido = async () => {
      const x = c.uid ? await env.DB.prepare("SELECT * FROM fin_movs WHERE id = ?").bind(id).first() : null;
      if (!x) return null;
      const igual = x.tipo === tipo && x.fecha === fecha && x.origen === origen && x.destino === destino
        && centavosIguales(x.importe, imp) && (x.nota || null) === nota;
      return igual ? json({ ok: true, id, repetido: true }) :
        json({ ok: false, error: "Esta operación ya tiene otro importe, fecha o cuenta. Actualiza la lista antes de registrarla otra vez." }, 409);
    };
    const anterior = await repetido(); if (anterior) return anterior;
    try {
      await env.DB.batch([
        env.DB.prepare("INSERT INTO fin_movs (id, mes, fecha, tipo, origen, destino, importe, nota, creado, creado_por) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
          .bind(id, fecha.slice(0, 7), fecha, tipo, origen, destino, imp, nota, ahora, quien),
        stmtBitacora(env, { quien, accion: "crear", que: TIPOS_MOV[tipo], ref: id, mes: fecha.slice(0, 7), detalle: { fecha, de: origen, a: destino, importe: imp, nota } })
      ]);
    } catch (er) {
      // D1 protege la clave primaria incluso si dos sesiones escriben a la vez.
      const ya = await repetido(); if (ya) return ya;
      throw er;
    }
    return json({ ok: true, id });
  }
  if (partes[1] === "mov" && partes[3] === "eliminar") {
    const m = await env.DB.prepare("SELECT * FROM fin_movs WHERE id = ?").bind(partes[2]).first();
    if (!m) return json({ ok: true, borrados: 0 });
    if (!abiertos.includes(m.mes)) return json({ ok: false, error: "Ese movimiento es de un mes ya cerrado; ya no se puede borrar." }, 409);
    const resultado = await env.DB.batch([
      env.DB.prepare("DELETE FROM fin_movs WHERE id = ? AND mes = ?").bind(m.id, m.mes),
      stmtBitacoraSiCambio(env, { quien, accion: "borrar", que: TIPOS_MOV[m.tipo] || m.tipo, ref: m.id, mes: m.mes, detalle: { fecha: m.fecha, de: m.origen, a: m.destino, importe: m.importe, nota: m.nota } })
    ]);
    return json({ ok: true, borrados: Number(resultado[0]?.meta?.changes || 0) });
  }
  return json({ ok: false, error: "Ruta no encontrada." }, 404);
}
