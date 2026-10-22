import {r2, CAT_SUELDOS, diferenciasCaja, resumenSueldos} from "./finanzas-calculos.js";
export { CAT_SUELDOS, diferenciasCaja, resumenSueldos };
// Finanzas: la unión de las dos fuentes de dinero, para llevar un control real.
// - Turnos: tickets (efectivo, tarjeta y transferencia), ingresos extra, gastos de caja, retiros del corte
//   (taxi, compras, sueldos) y diferencias de caja (lo contado contra lo esperado y el cambio entre turnos).
// - Administración: pagos programados y no programados, compras y otros gastos (salen de los sobres o del banco).
// - Comisión de la terminal (Mercado Pago) por cada cobro con tarjeta: es egreso y a la cuenta entra el neto.
// Saldos: el de cada cuenta y el de los sobres pasa solo de un mes al siguiente; capturarlo es opcional (conteo real)
// y, si se captura, se muestra cuánto se desvió de lo calculado.
import { asegurarEsquemaCaja, leerMes, calcularCortes, unirConteos, totalesMes, mesActual, mesesAbiertos, sumarMesesCaja, montoUsuario, leerCobrosAdmin, leerRetiros, transferenciasMes, cambiosEntreTurnos, turnoAnterior, claseHoja, conceptoHoja } from "./caja.js";
import { asegurarEsquemaAgenda } from "./agenda.js";
import { asegurarEsquemaCategorias, listaCategorias, adivinarCategoria } from "./categorias.js";
import { asegurarEsquemaCuentas, listaCuentas, cuentasRutas, TIPOS_MOV, flujosMes, encadenarSaldos, comisionMercadoPago, COMISION_INICIAL } from "./cuentas.js";
import { asegurarEsquemaBitacora, stmtBitacoraSiCambio, listaBitacora, ACCIONES } from "./bitacora.js";
import { centavosIguales } from "./finanzas-idempotencia.js";
import { estadosCuentaRuta, asegurarEsquemaEstados } from "./finanzas-estados.js";
import { cotejarCuentasMes } from "./finanzas-cotejo.js";
import { rutaSalarios } from "./finanzas-salarios.js";
import { resumenPorCobrarCaja } from "./finanzas-cobrar.js";
import { obligacionesRuta } from "./finanzas-obligaciones.js";

const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });

const RE_MES = /^\d{4}-(0[1-9]|1[0-2])$/;
export const CAT_COMISION = "Comisiones bancarias", CAT_FALTANTE = "Faltantes de caja", CAT_TRANSPORTE = "Transporte";

let esquemaListo = false;
export async function asegurarEsquemaFinanzas(env) {
  if (esquemaListo) return;
  await asegurarEsquemaCaja(env);
  await asegurarEsquemaAgenda(env);
  await asegurarEsquemaCategorias(env);
  await asegurarEsquemaCuentas(env);
  await asegurarEsquemaBitacora(env);
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS fin_saldos (mes TEXT PRIMARY KEY, efectivo REAL NOT NULL, actualizado TEXT NOT NULL, por TEXT)").run();
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS fin_config (clave TEXT PRIMARY KEY, valor TEXT, actualizado TEXT NOT NULL)").run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS agenda_pagos_gasto ON agenda_pagos (gasto_id)").run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS caja_gastos_origen ON caja_gastos (origen, mes)").run();
  // Categorías de los egresos que calcula Finanzas
  const ahora = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO categorias (nombre, icono, color, orden, creado) VALUES (?, 'tarjetas', '#6c74e8', 60, ?)").bind(CAT_COMISION, ahora),
    env.DB.prepare("INSERT OR IGNORE INTO categorias (nombre, icono, color, orden, creado) VALUES (?, 'otros', '#ff7a70', 61, ?)").bind(CAT_FALTANTE, ahora),
    env.DB.prepare("INSERT OR IGNORE INTO categorias (nombre, icono, color, orden, creado) VALUES (?, 'transporte', '#3d8fd6', 12, ?)").bind(CAT_TRANSPORTE, ahora)
  ]);
  esquemaListo = true;
}

// Qué es cada gasto de la administración: pago programado, pago sin programar, compra u otro
export async function clasificarAdmin(env, gastos) {
  if (!gastos.length) return [];
  const ids = gastos.map(g => g.id), pagos = new Map(), compras = new Map();
  for (let i = 0; i < ids.length; i += 90) {
    const l = ids.slice(i, i + 90), q = l.map(() => "?").join(",");
    for (const p of (await env.DB.prepare(`SELECT p.id, p.gasto_id, p.item_id, p.nota, p.comprobante, COALESCE(p.titulo, i.titulo) AS titulo FROM agenda_pagos p LEFT JOIN agenda_items i ON i.id = p.item_id WHERE p.gasto_id IN (${q})`).bind(...l).all()).results) pagos.set(p.gasto_id, p);
    for (const c of (await env.DB.prepare(`SELECT id, gasto_id, titulo, cantidad FROM agenda_items WHERE tipo = 'compra' AND gasto_id IN (${q})`).bind(...l).all()).results) {
      if (!compras.has(c.gasto_id)) compras.set(c.gasto_id, []);
      compras.get(c.gasto_id).push(c);
    }
  }
  return gastos.map(g => {
    const p = pagos.get(g.id), c = compras.get(g.id);
    const cat = p ? (p.item_id ? "programado" : "no_programado") : c ? "compra" : "otro";
    // Un egreso puede corresponder a VARIOS artículos comprados con un solo ticket.
    // Mostrar un artículo aislado con el total completo es engañoso.
    const concepto = p ? p.titulo || g.concepto : c
      ? c.length === 1 ? c[0].titulo + (c[0].cantidad ? ` (${c[0].cantidad})` : "")
        : (g.concepto || `Compra agrupada (${c.length} artículos)`)
      : g.concepto;
    return { id: g.id, mes: g.mes, dia: g.dia, concepto, monto: g.monto, forma: g.forma, cuenta: g.cuenta || null, cat, categoria: g.categoria || null, nota: p && p.nota || "", comprobante: p && p.comprobante ? p.id : null, creado: g.creado, por: g.creado_por || "" };
  });
}

export const CAT_TXT = { programado: "Pago programado", no_programado: "Pago no programado", compra: "Compra", otro: "Otro gasto", caja: "Gasto de caja (turnos)", retiro: "Retiro del corte", comision: "Comisión de tarjeta", faltante: "Faltante de caja", cambio: "Aumento de cambio" };
export const FORMA_ADMIN = { EFECTIVO: "Efectivo (sobres)", TRANSFERENCIA: "Transferencia (banco)", TARJETA: "Tarjeta (banco)" };


// Retiros del corte (taxi, compras, sueldos…): egresos del día del corte
export function retirosDeCortes(conteos) {
  const l = [];
  for (const c of conteos) for (const r of leerRetiros(c.retiros)) l.push({ dia: c.dia, turno: c.turno, persona: c.admin ? "Encargado del turno" : c.persona, concepto: r.concepto, monto: r.monto, categoria: adivinarCategoria(r.concepto) });
  return l;
}

// Renglones de caja de la hoja que son gasto del negocio (TIENDA, GARRAFÓN, SUELDO…) o ingreso sin ticket.
// Los que son dinero de la administración (SE LLEVÓ, RETIRO, INGRESO DE ADM) no son egreso ni ingreso: mueven los sobres.
export function renglonesHoja(movs) {
  const gastos = [], ingresos = [], admin = [];
  for (const m of movs) {
    const k = claseHoja(m); if (!k || k === "cambio") continue;
    const concepto = conceptoHoja(m);
    if (k === "gasto") { const t = concepto.toUpperCase(); gastos.push({ dia: m.dia, turno: m.turno, concepto, monto: r2(-m.importe), categoria: adivinarCategoria(concepto), persona: /SUELDO|NOMINA|SALARIO/.test(t) ? concepto.replace(/^(SUELDO|N[OÓ]MINA|SALARIO)\s*(DE\s+)?/i, "").trim() || null : null, hoja: true }); }
    else if (k === "ingreso") ingresos.push({ dia: m.dia, turno: m.turno, concepto, monto: r2(m.importe) });
    else admin.push({ dia: m.dia, turno: m.turno, concepto, clase: k, monto: r2(Math.abs(m.importe)), fecha: m.fecha });
  }
  return { gastos, ingresos, admin };
}


// Registros de dinero de varios meses (para los saldos encadenados), agrupados por mes
async function leerFlujos(env, meses, cuentas) {
  const q = meses.map(() => "?").join(","), todos = sql => env.DB.prepare(sql).bind(...meses).all().then(r => r.results);
  const [tarjeta, ticketsTransf, transf, admin, sobres, cambio, movs, hojaCaja, cobrosAdmin, adminCaja] = await Promise.all([
    todos(`SELECT mes, dia, importe FROM caja_mov WHERE tipo = 'ticket' AND forma = 'TARJETA' AND mes IN (${q})`),
    todos(`SELECT mes, dia, fecha, servicio, folio, importe, forma, tipo FROM caja_mov WHERE tipo = 'ticket' AND forma LIKE 'TRANSF%' AND mes IN (${q})`),
    todos(`SELECT * FROM caja_transf WHERE mes IN (${q})`),
    todos(`SELECT id, mes, dia, forma, cuenta, monto, concepto, creado FROM caja_gastos WHERE origen = 'admin' AND mes IN (${q})`),
    todos(`SELECT mes, dia, turno, persona, sobre FROM turno_cortes WHERE sobre > 0 AND mes IN (${q})`),
    todos(`SELECT mes, dia, turno, monto, persona, creado FROM caja_extra WHERE ingreso = 0 AND mes IN (${q})`),
    todos(`SELECT * FROM fin_movs WHERE mes IN (${q})`),
    todos(`SELECT mes, dia, turno, fecha, folio, cliente, matricula, forma, importe, tipo FROM caja_mov WHERE tipo = 'caja' AND mes IN (${q})`),
    todos(`SELECT a.mes, a.fecha_pago AS dia, a.monto, a.forma, a.creado, a.por, p.servicio, p.folio
      FROM caja_cobros_admin a JOIN caja_pendientes p ON p.id = a.pendiente_id
      WHERE a.anulado = 0 AND p.origen_activo = 1 AND a.mes IN (${q})`),
    todos(`SELECT mes, dia, turno, tipo, monto, detalle, persona, creado, anulado FROM caja_admin_movs WHERE mes IN (${q})`)
  ]);
  const defTransf = (cuentas.find(c => c.def_transf && c.activa) || cuentas.find(c => c.def_transf) || {}).id || null;
  const por = {};
  for (const m of meses) {
    const delMes = l => l.filter(x => x.mes === m);
    por[m] = {
      tarjeta: [...delMes(tarjeta), ...delMes(cobrosAdmin).filter(x => x.forma === "TARJETA")
        .map(x => ({ mes: x.mes, dia: x.dia, importe: x.monto }))],
      transf: [...transfConCuenta(delMes(ticketsTransf), delMes(transf), defTransf),
        ...delMes(cobrosAdmin).filter(x => x.forma === "TRANSFERENCIA")
          .map(x => ({ fecha: x.dia, importe: x.monto, cuenta: defTransf }))],
      cobrosAdmin: delMes(cobrosAdmin).filter(x => x.forma === "EFECTIVO"),
      admin: delMes(admin), sobres: delMes(sobres), cambio: delMes(cambio), adminCaja: delMes(adminCaja), movs: delMes(movs),
      hojaAdmin: renglonesHoja(delMes(hojaCaja)).admin
    };
  }
  return por;
}

// Transferencias que cuentan, cada una con la cuenta a la que llegó: los tickets de la hoja (a la cuenta de su
// transferencia ligada o a la cuenta por defecto) y las capturadas a mano que no son de un ticket de la hoja.
export function transfConCuenta(ticketsHoja, transf, defTransf) {
  const tr = transferenciasMes(ticketsHoja.map(t => ({ ...t, tipo: "ticket" })), transf);
  return [
    ...tr.hoja.map(h => ({ fecha: h.fecha, importe: h.importe, cuenta: (h.ligada && h.ligada.cuenta) || defTransf, ref: h.ref })),
    ...tr.contadas.map(x => ({ fecha: x.fecha, importe: x.importe, cuenta: x.cuenta || null, id: x.id }))
  ];
}

export async function datosFinanzas(env, mes) {
  await asegurarEsquemaFinanzas(env);
  const { movs, gastos, gastosAdmin, transf, conteos, extras, inicios, adminMovs } = await leerMes(env, [mes]);
  // Corte del turno anterior al primero del mes (para comparar el cambio que dejó)
  const pAnt = turnoAnterior(mes + "-01", "MAÑANA");
  const conteoAnt = (await env.DB.prepare("SELECT * FROM turno_cortes WHERE dia = ? AND turno = ?").bind(pAnt.dia, pAnt.turno).all()).results;
  const cortes = unirConteos(calcularCortes(movs, gastos, extras, inicios, adminMovs), conteos);
  const tr = transferenciasMes(movs, transf);
  const t = totalesMes(cortes, tr.contadas);
  const cobrosAdmin = await leerCobrosAdmin(env, { mes });
  for (const x of cobrosAdmin) {
    t.ingresos += x.monto;
    if (x.forma === "EFECTIVO") t.efectivo += x.monto;
    else if (x.forma === "TARJETA") t.tarjeta += x.monto;
    else t.transferencias += x.monto;
    t[x.servicio] += x.monto;
  }
  const admin = await clasificarAdmin(env, gastosAdmin);
  const suma = (l, f = () => true) => r2(l.filter(f).reduce((a, x) => a + (x.monto ?? x.importe ?? 0), 0));
  const cuentas = await listaCuentas(env, true);
  const tj = cuentas.find(c => c.tarjeta) || null;

  // Comisión de la terminal por cada cobro con tarjeta
  const ticketsTarjeta = [
    ...movs.filter(m => m.tipo === "ticket" && m.forma === "TARJETA"),
    ...cobrosAdmin.filter(x => x.forma === "TARJETA").map(x => ({ ...x, importe: x.monto }))
  ];
  const comision = r2(ticketsTarjeta.reduce((a, m) => a + comisionMercadoPago(m.importe, tj), 0));
  const retiros = retirosDeCortes(conteos);
  const hoja = renglonesHoja(movs);
  const gastosCaja = [...gastos, ...hoja.gastos];
  const cambios = [...cambiosEntreTurnos([...conteos, ...conteoAnt], inicios).values()].filter(x => x.dia.slice(0, 7) === mes);
  const dif = diferenciasCaja(cortes, cambios);

  const ingresos = { efectivo: r2(t.efectivo), tarjeta: r2(t.tarjeta), transferencias: r2(t.transferencias), transf_hoja: r2(t.transf_hoja), transf_manual: r2(t.transf_manual), otros: r2(t.otros + suma(hoja.ingresos)), cobros_admin: r2(cobrosAdmin.reduce((a, x) => a + x.monto, 0)), sobrantes: dif.sobrantes, bascula: r2(t.bascula), pension: r2(t.pension) };
  ingresos.total = r2(ingresos.efectivo + ingresos.tarjeta + ingresos.transferencias + ingresos.otros + ingresos.sobrantes);
  const egresos = { caja: suma(gastosCaja), caja_hoja: suma(hoja.gastos), retiros: suma(retiros), programado: suma(admin, x => x.cat === "programado"), no_programado: suma(admin, x => x.cat === "no_programado"), compra: suma(admin, x => x.cat === "compra"), otro: suma(admin, x => x.cat === "otro"), comision, faltantes: dif.faltantes };
  egresos.total = r2(egresos.caja + egresos.retiros + egresos.programado + egresos.no_programado + egresos.compra + egresos.otro + egresos.comision + egresos.faltantes);

  // ---- Saldos encadenados (sobres y cada cuenta) ----
  const meses = mesesFinanzas(mesActual()).filter(m => m <= mes).reverse(); // del más viejo al pedido
  const capSobres = (await env.DB.prepare("SELECT mes, efectivo, actualizado FROM fin_saldos").all()).results;
  const capCuentas = (await env.DB.prepare("SELECT mes, cuenta, saldo, actualizado FROM fin_saldos_cuenta").all()).results;
  const capturas = {};
  for (const r of capSobres) (capturas[r.mes] = capturas[r.mes] || {}).sobres = r.efectivo;
  for (const r of capCuentas) (capturas[r.mes] = capturas[r.mes] || {})[r.cuenta] = r.saldo;
  // Solo se leen los meses desde la primera captura (los anteriores no cambian nada)
  const primero = meses.find(m => capturas[m] && Object.keys(capturas[m]).length) || mes;
  const tramo = meses.filter(m => m >= primero);
  const datos = await leerFlujos(env, tramo, cuentas);
  datos[mes].admin = admin; // el mes pedido con cada gasto ya clasificado (pago, compra u otro)
  const flujos = {}, porMes = {};
  for (const m of tramo) {
    const f = flujosMes(datos[m], cuentas);
    porMes[m] = f;
    flujos[m] = { sobres: { entradas: f.sobres.entradas, salidas: f.sobres.salidas }, ...f.cuentas };
  }
  const credito = new Set(cuentas.filter(c => c.tipo === "credito").map(c => c.id));
  const saldos = encadenarSaldos(tramo, ["sobres", ...cuentas.map(c => c.id)], capturas, flujos, credito);
  const fm = porMes[mes];
  const actualizado = Object.fromEntries([...capSobres.filter(r => r.mes === mes).map(r => ["sobres", r.actualizado]), ...capCuentas.filter(r => r.mes === mes).map(r => [r.cuenta, r.actualizado])]);

  // Efectivo en sobres, con su saldo renglón por renglón
  const s = saldos.sobres;
  let acum = s.inicial;
  const movsEf = fm.sobres.movimientos.map(m => { if (acum != null) acum = r2(acum + m.entrada - m.salida); const { orden, ...x } = m; return { ...x, saldo: acum }; });
  const efectivo = { inicial: s.inicial, capturado: s.capturado, calculado: s.calculado, ajuste: s.ajuste, inicial_actualizado: actualizado.sobres || null, recibido: fm.sobres.entradas, gastado: fm.sobres.salidas, saldo: s.saldo, movimientos: movsEf.reverse() };

  // Cuentas
  const lista = cuentas.map(c => ({ ...c, ...saldos[c.id], inicial_actualizado: actualizado[c.id] || null, detalle: fm.cuentas[c.id].detalle }));
  const nomCuenta = id => id === "sobres" ? "Efectivo (sobres)" : (cuentas.find(c => c.id === id) || { nombre: id }).nombre;
  const deb = lista.filter(c => c.tipo !== "credito" && c.activa), cred = lista.filter(c => c.tipo === "credito" && c.activa);
  const notas = await env.DB.prepare("SELECT valor, actualizado FROM fin_config WHERE clave = 'cuentas'").first();
  const banco = {
    tarjeta: r2(t.tarjeta), comision, tarjeta_neto: r2(t.tarjeta - comision), comision_cuenta: tj ? { id: tj.id, nombre: tj.nombre, pct: COMISION_INICIAL, iva: true } : null,
    transferencias: r2(t.transferencias), entradas: r2(t.transferencias + t.tarjeta - comision), salidas: suma(admin, x => x.forma !== "EFECTIVO"),
    cuentas: notas ? notas.valor || "" : "", cuentas_actualizado: notas ? notas.actualizado : null,
    lista, sin_cuenta: fm.sin_cuenta,
    movs: (await env.DB.prepare("SELECT * FROM fin_movs WHERE mes = ? ORDER BY fecha DESC, creado DESC").bind(mes).all()).results.map(m => ({ ...m, tipo_txt: TIPOS_MOV[m.tipo] || m.tipo, origen_txt: nomCuenta(m.origen), destino_txt: nomCuenta(m.destino) })),
    // Totales de las cuentas que ya tienen saldo (las que no, se listan en faltan_saldo)
    dinero: deb.some(c => c.saldo != null) ? r2(deb.reduce((a, c) => a + (c.saldo || 0), 0)) : null,
    dinero_parcial: deb.some(c => c.saldo == null),
    conciliaciones_pendientes: tr.alertas.length,
    deuda: cred.some(c => c.saldo != null) ? r2(cred.reduce((a, c) => a + (c.saldo || 0), 0)) : null,
    deuda_parcial: cred.some(c => c.saldo == null),
    faltan_saldo: [...deb, ...cred].filter(c => c.saldo == null).map(c => c.nombre)
  };

  // Por día (para la gráfica): ingresos contra egresos
  const dias = {};
  const d = k => (dias[k] = dias[k] || { dia: k, ingresos: 0, egresos: 0 });
  for (const c of cortes) d(c.dia).ingresos += c.efectivo + c.tarjeta + c.extra.ingreso;
  for (const h of tr.hoja) d(h.dia).ingresos += h.importe;
  for (const x of tr.contadas) d(x.fecha).ingresos += x.importe;
  for (const x of cobrosAdmin) d(x.dia).ingresos += x.monto;
  for (const g of gastosCaja) d(g.dia).egresos += g.monto;
  for (const x of hoja.ingresos) d(x.dia).ingresos += x.monto;
  for (const g of admin) d(g.dia).egresos += g.monto;
  for (const r of retiros) d(r.dia).egresos += r.monto;
  for (const m of ticketsTarjeta) d(m.dia).egresos += comisionMercadoPago(m.importe, tj);
  for (const x of dif.lista) { if (x.dif < 0) d(x.dia).egresos -= x.dif; else d(x.dia).ingresos += x.dif; }
  const porDia = Object.values(dias).filter(x => x.dia.slice(0, 7) === mes).map(x => ({ dia: x.dia, ingresos: r2(x.ingresos), egresos: r2(x.egresos) })).sort((a, b) => a.dia.localeCompare(b.dia));

  // Egresos por categoría (caja, retiros del corte, administración, comisiones y faltantes), con icono y color
  const cats = Object.fromEntries((await listaCategorias(env)).map(c => [c.nombre, c]));
  const pc = {};
  const add = (k, v, caja) => { k = k && cats[k] ? k : "Sin categoría"; pc[k] = pc[k] || { nombre: k, total: 0, caja: 0 }; pc[k].total += v; if (caja) pc[k].caja += v; };
  for (const g of gastosCaja) add(g.categoria, g.monto, true);
  for (const r of retiros) add(r.categoria, r.monto, true);
  for (const x of admin) add(x.categoria, x.monto, false);
  if (comision) add(CAT_COMISION, comision, false);
  if (dif.faltantes) add(CAT_FALTANTE, dif.faltantes, true);
  const porCategoria = Object.values(pc).map(x => ({ ...x, total: r2(x.total), caja: r2(x.caja), clave: x.nombre, nombre: (cats[x.nombre] || {}).etiqueta || x.nombre, icono: (cats[x.nombre] || {}).icono || "otros", color: (cats[x.nombre] || {}).color || "#8e8e93" })).sort((a, b) => b.total - a.total);

  return {
    mes, por_categoria: porCategoria, ingresos, egresos, resultado: r2(ingresos.total - egresos.total), efectivo, banco, admin, retiros,
    diferencias: dif, cobros_admin: cobrosAdmin, sueldos: resumenSueldos(gastosCaja, retiros, admin), renglones_hoja: hoja,
    gastos_caja: gastos, transferencias: transf, transf_hoja: tr.hoja, transf_posibles: tr.posibles,
    conciliacion_alertas: tr.alertas, por_dia: porDia, cortes
  };
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
    // Mostrar la frescura real de la fuente: una cifra de hoy puede proceder de
    // la última sincronización de Google, no de una lectura en vivo.
    d.ensayo_finanzas = env.ENSAYO_FINANZAS === "1";
    d.sync = d.ensayo_finanzas ? null : await env.FILES.get("caja:sync", { type:"json" }).catch(() => null);
    delete d.cortes; delete d.gastos_caja;
    d.por_cobrar_caja = await resumenPorCobrarCaja(env);
    d.cuentas_activas = await listaCuentas(env);
    d.abiertos = await mesesAbiertos(env);
    return json({ ok: true, meses, ...d });
  }
  if (partes[1] === "cotejo-estados" && request.method === "GET" && partes.length === 2) {
    const mes = url.searchParams.get("mes") || meses[0];
    if (!RE_MES.test(mes) || !meses.includes(mes))
      return json({ok:false,error:"Mes fuera del historial financiero disponible."},422);
    await asegurarEsquemaEstados(env);
    const cierre = new Date(Date.UTC(Number(mes.slice(0,4)),Number(mes.slice(5,7)),0)).toISOString().slice(0,10);
    const [datos,documentos]=await Promise.all([
      datosFinanzas(env,mes),
      env.DB.prepare(`SELECT cuenta,periodo_desde,periodo_hasta,fecha_corte,saldo_final
        FROM (SELECT cuenta,periodo_desde,periodo_hasta,fecha_corte,saldo_final,
          ROW_NUMBER() OVER(PARTITION BY cuenta ORDER BY fecha_corte DESC,periodo_hasta DESC) AS rn
          FROM fin_estados_cuenta WHERE fecha_corte <= ? AND periodo_hasta <= ?)
        WHERE rn=1`).bind(cierre,cierre).all()
    ]);
    const hoy = new Intl.DateTimeFormat("en-CA",{timeZone:"America/Mexico_City"}).format(new Date());
    const resultados=cotejarCuentasMes(datos.banco.lista,documentos.results,mes,hoy,datos.banco.sin_cuenta);
    return json({ok:true,mes,fecha_calculo:cierre,consultado:new Date().toISOString(),
      cuentas:resultados,aviso:"Solo se compara cuando estado bancario y libro calculado cierran el mismo día; nunca se ajustan saldos ni se crean movimientos."});
  }
  if (partes[1] === "obligaciones") return await obligacionesRuta(request,env,partes,usuario);
  if (partes[1] === "estados-cuenta") return await estadosCuentaRuta(request,env,partes,usuario);
  if (partes[1] === "salarios") return await rutaSalarios(request,env,partes,usuario);
  if (partes[1] === "bitacora" && request.method === "GET") return json({ ok: true, bitacora: await listaBitacora(env, 150), acciones: ACCIONES });
  if (request.method !== "POST") return json({ ok: false, error: "Ruta no encontrada." }, 404);
  if (["cuenta", "saldo-cuenta", "mov"].includes(partes[1])) return await cuentasRutas(request, env, partes, usuario, meses);
  let c; try { c = await request.json(); } catch { return json({ ok: false, error: "Datos inválidos." }, 400); }
  const quien = usuario && usuario.email || null, ahora = new Date().toISOString();
  if (partes[1] === "saldo") {
    const mes = String(c.mes || "");
    if (!(await mesesAbiertos(env)).includes(mes))
      return json({ ok:false, error:"Solo se puede capturar el saldo inicial de un mes abierto." },409);
    const antes = await env.DB.prepare("SELECT efectivo FROM fin_saldos WHERE mes = ?").bind(mes).first();
    const actual = antes ? Number(antes.efectivo) : null;
    // El formulario envía el valor que mostraba al abrir. No permitir que una
    // pestaña antigua reemplace el recuento confirmado por otra sesión.
    if (Object.hasOwn(c, "esperado")) {
      const esperado = c.esperado == null || c.esperado === "" ? null : Number(c.esperado);
      if (esperado !== null && !Number.isFinite(esperado))
        return json({ ok:false, error:"El saldo de referencia no es válido. Actualiza Finanzas." },422);
      if (actual === null ? esperado !== null : esperado === null || !centavosIguales(actual, esperado))
        return json({ ok:false, error:"El saldo de los sobres cambió en otra sesión. Actualiza Finanzas antes de guardar." },409);
    }
    const log = v => stmtBitacoraSiCambio(env, {
      quien, accion:v == null ? "borrar" : antes ? "editar" : "crear",
      que:"Saldo inicial de los sobres", ref:"sobres", mes,
      detalle:{ antes:actual, ahora:v }
    });
    if (c.efectivo === "" || c.efectivo === null) {
      if (!antes) return json({ ok:true, sin_cambios:true });
      const resultado = await env.DB.batch([
        env.DB.prepare(`DELETE FROM fin_saldos WHERE mes = ? AND efectivo = ?
          AND NOT EXISTS (SELECT 1 FROM caja_cierre_lock WHERE mes = ? AND token LIKE 'cerrado:%')`)
          .bind(mes, antes.efectivo, mes),
        log(null)
      ]);
      if (!resultado[0]?.meta?.changes)
        return json({ ok:false, error:"El saldo de los sobres cambió en otra sesión. Actualiza Finanzas." },409);
      return json({ ok:true });
    }
    const v = montoUsuario(c.efectivo);
    if (!(v >= 0) || v > 100000000)
      return json({ ok:false, error:"Escribe el efectivo con el que empezó el mes (solo números)." },422);
    if (antes && centavosIguales(antes.efectivo, v))
      return json({ ok:true, sin_cambios:true });
    const resultado = await env.DB.batch([
      env.DB.prepare(`INSERT INTO fin_saldos (mes, efectivo, actualizado, por)
        SELECT ?, ?, ?, ? WHERE NOT EXISTS (
          SELECT 1 FROM caja_cierre_lock WHERE mes = ? AND token LIKE 'cerrado:%'
        )
        ON CONFLICT(mes) DO UPDATE SET efectivo = excluded.efectivo,
          actualizado = excluded.actualizado, por = excluded.por
        WHERE fin_saldos.efectivo = ? AND NOT EXISTS (
          SELECT 1 FROM caja_cierre_lock WHERE mes = excluded.mes AND token LIKE 'cerrado:%'
        )`).bind(mes, v, ahora, quien, mes, antes ? antes.efectivo : null),
      log(v)
    ]);
    if (!resultado[0]?.meta?.changes)
      return json({ ok:false, error:"El saldo de los sobres fue modificado en otra sesión. Actualiza Finanzas." },409);
    return json({ ok:true });
  }
  if (partes[1] === "cuentas") {
    const texto = String(c.texto ?? "").replace(/\r/g, "").slice(0, 4000);
    const anterior = await env.DB.prepare("SELECT valor FROM fin_config WHERE clave = 'cuentas'").first();
    const actual = anterior?.valor || "";
    const esperado = Object.hasOwn(c,"esperado") ? String(c.esperado ?? "").replace(/\r/g, "").slice(0,4000) : actual;
    if (esperado !== actual)
      return json({ok:false,error:"Las notas de las cuentas cambiaron en otra sesión. Copia tu texto antes de actualizar Finanzas."},409);
    if (texto === actual) return json({ok:true,sin_cambios:true});
    const res = await env.DB.prepare(`INSERT INTO fin_config (clave, valor, actualizado)
      VALUES ('cuentas', ?, ?)
      ON CONFLICT(clave) DO UPDATE SET valor=excluded.valor, actualizado=excluded.actualizado
      WHERE COALESCE(fin_config.valor,'') = ?`).bind(texto, ahora, esperado).run();
    if (!res.meta?.changes)
      return json({ok:false,error:"Las notas cambiaron mientras guardabas. Conserva tu texto y actualiza Finanzas antes de repetir."},409);
    return json({ok:true});
  }
  return json({ ok: false, error: "Ruta no encontrada." }, 404);
}
