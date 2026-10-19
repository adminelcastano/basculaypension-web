// Reportes mensuales en Google Sheets, uno por área y cada uno en su carpeta de Drive (cuenta administracion@):
//   - Turnos: cortes, tickets, movimientos de caja con folio, entregas, incidencias, tareas, avisos, eventos y personal.
//   - Finanzas: resumen, efectivo en sobres, transferencias de clientes, pagos, pagos programados y compras.
//   - Facturación: solicitudes de factura del mes.
// Los crea el script de Google (acción "archivos", op "hoja", con "destino"). Se generan solos al cerrar el mes
// y a demanda desde el panel. Los reportes de antes (un solo archivo) se quedan donde estaban.
import { asegurarEsquemaCaja, calcularCortes, unirConteos, totalesMes, leerRetiros, leerMes, movimientosCaja, conFolios, FORMAS_CONTADAS, esCambio, firmaMov, cambiosEntreTurnos } from "./caja.js";
import { asegurarEsquemaAgenda } from "./agenda.js";
import { asegurarEsquemaPersonal, resumenFila } from "./personal.js";
import { datosFinanzas, CAT_TXT, FORMA_ADMIN } from "./finanzas.js";
import { etiquetasCategorias } from "./categorias.js";
import { listaBitacora, ACCIONES } from "./bitacora.js";

export const TIPOS_REPORTE = { turnos: "Turnos", finanzas: "Finanzas", facturacion: "Facturación" };
const TZ_HORAS = -6; // Tapachula (sin horario de verano)
const local = iso => iso ? new Date(new Date(iso).getTime() + TZ_HORAS * 3600e3).toISOString().slice(0, 16).replace("T", " ") : "";
const mesLocal = iso => local(iso).slice(0, 7);
const TURNO = { "MAÑANA": "Mañana", TARDE: "Tarde", NOCHE: "Noche" };
const nombreMes = mes => new Date(mes + "-15T12:00:00Z").toLocaleDateString("es-MX", { month: "long", year: "numeric", timeZone: "UTC" });
const TIPO_MOV = { gasto: "Gasto de caja", ingreso: "Ingreso extra", retiro: "Retiro en el corte", hoja: "Renglón de la hoja" };

// Texto que Sheets podría tomar como fórmula (=, +, -, @) se guarda como texto
function celda(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return Number.isFinite(v) ? Math.round(v * 100) / 100 : "";
  if (typeof v === "boolean") return v ? "Sí" : "No";
  const s = String(v);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}
const hoja = (nombre, encabezados, filas) => ({ nombre, filas: [encabezados, ...filas].map(f => f.map(celda)) });
const q = (env, sql, ...a) => env.DB.prepare(sql).bind(...a).all().then(r => r.results);

// ---------------- Turnos ----------------
async function hojasTurnos(env, mes) {
  await asegurarEsquemaCaja(env); await asegurarEsquemaAgenda(env); await asegurarEsquemaPersonal(env);
  const { movs, gastos, conteos, extras, inicios } = await leerMes(env, [mes]);
  const et = await etiquetasCategorias(env);
  const hist = await q(env, "SELECT * FROM turno_cortes_hist WHERE mes = ? ORDER BY creado", mes);
  const cortes = unirConteos(calcularCortes(movs, gastos, extras, inicios), conteos).slice().reverse();
  const t = totalesMes(cortes, []);
  const lista = await conFolios(env, movimientosCaja({ movs, gastos, extras, conteos }));
  const folio = Object.fromEntries(lista.map(x => [x.ref, x.folio]));

  // Folio de los renglones de la hoja sin ticket (mismo orden que movimientosCaja)
  const folioHoja = new Map();
  for (const x of lista.filter(x => x.tipo === "hoja")) folioHoja.set(x.ref, x.folio);
  const vistos = new Map();
  for (const m of movs.filter(m => m.tipo === "caja" && !esCambio(m)).sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)) || (a.id || 0) - (b.id || 0))) {
    const f = firmaMov(m), k = vistos.get(f) || 0; vistos.set(f, k + 1); m.folio_mc = folioHoja.get("m:" + f + "#" + k) || "";
  }

  const agenda = (await q(env, "SELECT * FROM agenda_items ORDER BY creado")).filter(i => mesLocal(i.creado) === mes || (i.cerrado && mesLocal(i.cerrado) === mes) || (i.fecha && i.fecha.slice(0, 7) === mes));
  const de = tipo => agenda.filter(i => i.tipo === tipo);
  const quien = i => i.reporto ? i.reporto + " (tablet)" : i.autor && i.autor !== "admin" ? i.autor + " (tablet)" : i.creado_por || "Administración";
  const informes = (await q(env, "SELECT r.*, i.titulo FROM agenda_reportes r LEFT JOIN agenda_items i ON i.id = r.item_id ORDER BY r.creado")).filter(r => mesLocal(r.creado) === mes);
  const personal = (await q(env, "SELECT * FROM colaboradores ORDER BY tipo, num")).map(resumenFila);
  const sobres = conteos.reduce((a, c) => a + (c.sobre || 0), 0);
  const retiros = conteos.reduce((a, c) => a + leerRetiros(c.retiros).reduce((x, r) => x + r.monto, 0), 0);

  return [
    hoja("Resumen", ["Concepto", "Valor"], [
      ["Mes", nombreMes(mes)], ["Generado", local(new Date().toISOString())],
      ["Tickets en efectivo", t.efectivo], ["Tickets con tarjeta", t.tarjeta], ["Tickets por transferencia (hoja)", t.transf_hoja], ["Báscula", t.bascula], ["Pensión", t.pension],
      ["Ingresos extra (incluye aumento de cambio)", t.extras], ["Otros ingresos (rentas)", t.otros],
      ["Gastos de caja", t.gastos], ["Renglones de caja de la hoja", t.caja],
      ["Cortes de turno con datos", cortes.length], ["Cortes entregados en la tablet", conteos.length],
      ["Suma de diferencias de efectivo (contado − sistema)", cortes.reduce((a, c) => a + (c.conteo && c.conteo.dif_efectivo != null ? c.conteo.dif_efectivo : 0), 0)],
      ["Sobres entregados a la administración", sobres], ["Retiros en el corte", retiros],
      ["Movimientos de caja con folio", lista.length],
      ["Incidencias reportadas", de("incidencia").filter(i => mesLocal(i.creado) === mes).length],
      ["Tareas cerradas", de("tarea").filter(i => i.estado === "hecho" && i.cerrado && mesLocal(i.cerrado) === mes).length]
    ]),
    hoja("Cortes", ["Día", "Turno", "Báscula efectivo", "Báscula tarjeta", "Pensión efectivo", "Pensión tarjeta", "Total efectivo", "Total tarjeta", "Gastos de caja", "Cambio inicial", "Ingresos extra", "Renglones de caja", "Efectivo en caja", "Prepago y otros (no suman)", "Entregó", "Efectivo contado", "Diferencia efectivo", "Tarjeta (vouchers)", "Diferencia tarjeta", "Efectivo en sobre", "Retiros", "Cambio para el siguiente turno"],
      cortes.map(c => [c.dia, TURNO[c.turno] || c.turno, c.bascula.EFECTIVO, c.bascula.TARJETA, c.pension.EFECTIVO, c.pension.TARJETA, c.efectivo, c.tarjeta, c.gastos_total, c.cambio.importe, c.extra.importe, c.caja.importe, c.efectivo_caja, c.fuera.importe,
        c.conteo ? c.conteo.persona : "", c.conteo ? c.conteo.efectivo : "", c.conteo ? c.conteo.dif_efectivo : "", c.conteo && c.conteo.tarjeta != null ? c.conteo.tarjeta : "", c.conteo && c.conteo.dif_tarjeta != null ? c.conteo.dif_tarjeta : "",
        c.conteo && c.conteo.sobre != null ? c.conteo.sobre : "", c.conteo ? c.conteo.retiros.reduce((a, r) => a + r.monto, 0) || "" : "", c.conteo && c.conteo.cambio_sig != null ? c.conteo.cambio_sig : ""])),
    hoja("Movimientos de caja", ["Folio", "Día", "Turno", "Hora", "Tipo", "Concepto", "Detalle", "Monto", "Quién", "Foto"],
      lista.slice().reverse().map(x => [x.folio || "", x.dia, TURNO[x.turno] || x.turno, String(x.cuando || "").slice(11, 16), TIPO_MOV[x.tipo], x.concepto, x.detalle || "", x.monto, x.persona ? x.persona + " (tablet)" : x.por || "", x.foto ? "Sí" : ""])),
    ...["bascula", "pension"].map(sv => hoja(sv === "bascula" ? "Báscula" : "Pensión", ["Fecha y hora", "Día del corte", "Turno", "Folio", "Matrícula", "Cliente", sv === "bascula" ? "Tarifa" : "Recibido", "Forma de pago", "En el corte", "Folio de movimiento"],
      movs.filter(m => m.servicio === sv).slice().reverse().map(m => [String(m.fecha).replace("T", " "), m.dia, TURNO[m.turno] || m.turno, m.folio, m.matricula, m.cliente, m.importe, m.forma, m.tipo === "caja" ? (esCambio(m) ? "Cambio inicial" : "Movimiento de caja") : FORMAS_CONTADAS.includes(m.forma) ? "Sí" : "No", m.folio_mc || ""]))),
    hoja("Gastos de caja", ["Folio", "Día", "Turno", "Categoría", "Concepto", "Monto", "Capturado por", "Foto"], gastos.slice().reverse().map(g => [folio["g:" + g.id] || "", g.dia, TURNO[g.turno] || g.turno, et(g.categoria) || "", g.concepto, g.monto, g.persona ? g.persona + " (tablet)" : g.creado_por || "", g.foto ? "Sí" : ""])),
    hoja("Ingresos extra", ["Folio", "Día", "Turno", "Concepto", "Detalle", "Monto", "Cuenta como ingreso", "Capturado por"], extras.slice().reverse().map(x => [folio["x:" + x.id] || "", x.dia, TURNO[x.turno] || x.turno, x.concepto, x.detalle || "", x.monto, x.ingreso ? "Sí" : "No (solo caja)", x.persona ? x.persona + " (tablet)" : x.creado_por || ""])),
    hoja("Cambio inicial", ["Día", "Turno", "Encargado", "Cambio inicial", "Capturado"], inicios.slice().sort((a, b) => a.dia.localeCompare(b.dia)).map(i => [i.dia, TURNO[i.turno] || i.turno, i.persona, i.cambio, local(i.actualizado)])),
    hoja("Entregas", ["Día", "Turno", "Entregó", "Efectivo contado", "Sobre para la administración", "Retiros", "Detalle de retiros", "Cambio para el siguiente turno"],
      conteos.slice().sort((a, b) => a.dia.localeCompare(b.dia)).map(c => { const r = leerRetiros(c.retiros); return [c.dia, TURNO[c.turno] || c.turno, c.persona, c.efectivo, c.sobre ?? "", r.reduce((a, x) => a + x.monto, 0) || "", r.map((x, i) => `${folio[`r:${c.dia}|${c.turno}|${i}`] || ""} ${x.concepto} ${x.monto}`.trim()).join("; "), c.cambio_sig ?? ""]; })),
    hoja("Cambio entre turnos", ["Día", "Turno que recibe", "Dejó", "Cambio dejado", "Recibió", "Cambio recibido", "Diferencia"],
      [...cambiosEntreTurnos(conteos, inicios).values()].sort((a, b) => a.dia.localeCompare(b.dia)).map(x => [x.dia, TURNO[x.turno] || x.turno, x.de.persona, x.dejado, x.recibio, x.recibido, x.dif])),
    hoja("Historial de cortes", ["Día", "Turno", "Entregó", "Cuándo", "Efectivo contado", "Sobre", "Retiros", "Cambio siguiente", "Notas"],
      hist.map(x => { let d = {}; try { d = JSON.parse(x.datos); } catch {} return [x.dia, TURNO[x.turno] || x.turno, x.persona, local(x.creado), d.efectivo ?? "", d.sobre ?? "", leerRetiros(d.retiros).reduce((a, r) => a + r.monto, 0) || "", d.cambio_sig ?? "", d.notas || ""]; })),
    hoja("Incidencias", ["Fecha", "Turno", "Qué pasó", "Dónde", "Gravedad", "Estado", "Reportó", "Capturó", "Detalle", "Resuelta"], de("incidencia").map(i => [i.fecha || "", TURNO[i.turno] || i.turno || "", i.titulo, i.area || "", i.gravedad || "", i.estado, i.quien || "", quien(i), i.detalle || "", i.estado === "resuelta" ? local(i.cerrado) : ""])),
    hoja("Tareas", ["Creada", "Tarea", "Fecha límite", "Prioridad", "Tablet", "Turno", "Estado", "Hecha por", "Cerrada", "Nota"], de("tarea").map(i => [local(i.creado), i.titulo, i.fecha || "", i.prioridad || "", i.para_turno ? "Sí" : "No", TURNO[i.turno] || "", i.estado, i.hecho_por || "", local(i.cerrado), i.nota_cierre || i.detalle || ""])),
    hoja("Informes de tareas", ["Cuándo", "Tarea", "Encargado", "Turno", "Resultado", "Nota"], informes.map(r => [local(r.creado), r.titulo || "", r.persona, TURNO[r.turno] || r.turno || "", { cumplida: "Cumplida", parcial: "En parte", no: "No se pudo" }[r.resultado] || r.resultado, r.nota || ""])),
    hoja("Avisos", ["Creado", "De", "Aviso", "Detalle", "Importante", "Estado"], de("aviso").map(i => [local(i.creado), i.autor && i.autor !== "admin" ? i.autor : "Administración", i.titulo, i.detalle || "", i.prioridad === "alta", i.estado])),
    hoja("Eventos", ["Fecha", "Hora", "Evento", "Detalle"], de("evento").map(i => [i.fecha || "", i.hora || "", i.titulo, i.detalle || ""])),
    hoja("Personal", ["Folio", "Nombre", "Tipo", "Puesto o actividad", "Estatus", "Teléfono", "Correo", "Documentos", "Expediente completo", "Alta", "Baja", "Motivo de baja"],
      personal.map(p => [p.folio, p.nombre, p.tipo === "externo" ? "Externo" : "Colaborador", p.puesto || p.actividad, p.estatus === "activo" ? "Activo" : "Inactivo", p.telefono || "", p.correo, `${p.entregados}/${p.total}`, p.completo, local(p.creado).slice(0, 10), p.fecha_baja || "", p.motivo_baja || ""]))
  ];
}

// ---------------- Finanzas ----------------
async function hojasFinanzas(env, mes) {
  const d = await datosFinanzas(env, mes);
  const et = await etiquetasCategorias(env);
  const pagos = await q(env, "SELECT p.*, COALESCE(p.titulo, i.titulo) AS concepto FROM agenda_pagos p LEFT JOIN agenda_items i ON i.id = p.item_id WHERE substr(p.fecha, 1, 7) = ? ORDER BY p.fecha", mes);
  const programados = await q(env, "SELECT * FROM agenda_items WHERE tipo = 'pago' ORDER BY COALESCE(fecha, '9999')");
  const compras = (await q(env, "SELECT a.*, g.forma AS forma_gasto FROM agenda_items a LEFT JOIN caja_gastos g ON g.id = a.gasto_id WHERE a.tipo = 'compra' ORDER BY a.creado")).filter(i => mesLocal(i.creado) === mes || (i.cerrado && mesLocal(i.cerrado) === mes));
  const FREC = { unica: "Una vez", mensual: "Mensual", bimestral: "Bimestral", trimestral: "Trimestral", semestral: "Semestral", anual: "Anual" };
  const e = d.efectivo, i = d.ingresos, g = d.egresos;
  return [
    hoja("Resumen", ["Concepto", "Valor"], [
      ["Mes", nombreMes(mes)], ["Generado", local(new Date().toISOString())],
      ["INGRESOS", ""], ["Tickets en efectivo", i.efectivo], ["Tickets con tarjeta", i.tarjeta], ["Transferencias (tickets de la hoja)", i.transf_hoja], ["Transferencias capturadas sin ticket", i.transf_manual], ["Otros ingresos (rentas)", i.otros], ["Sobrantes de caja", i.sobrantes], ["Total de ingresos", i.total],
      ["EGRESOS", ""], ["Gastos de caja (turnos)", g.caja], ["Retiros del corte", g.retiros], ["Pagos programados", g.programado], ["Pagos no programados", g.no_programado], ["Compras", g.compra], ["Otros gastos", g.otro], ["Comisión de tarjeta (Mercado Pago)", g.comision], ["Faltantes de caja", g.faltantes], ["Total de egresos", g.total],
      ["RESULTADO (ingresos − egresos)", d.resultado],
      ["SUELDOS", ""], ["Cobrados del turno", d.sueldos.total_caja], ["Pagados por la administración", d.sueldos.total_admin], ["Total de sueldos", d.sueldos.total],
      ["EFECTIVO EN SOBRES", ""], ["Saldo inicial del mes", e.inicial ?? "Sin saldo"], ["Saldo inicial", e.capturado ? "Contado (capturado)" : "Calculado del mes anterior"], ["Ajuste contra lo calculado", e.ajuste ?? ""], ["Recibido", e.recibido], ["Salió", e.gastado], ["Saldo final", e.saldo ?? "Sin saldo inicial"],
      ["BANCO", ""], ["Cobros con tarjeta (bruto)", d.banco.tarjeta], ["Comisión de Mercado Pago", d.banco.comision], ["Cobros con tarjeta (neto)", d.banco.tarjeta_neto], ["Transferencias de clientes", d.banco.transferencias], ["Total de entradas", d.banco.entradas], ["Salidas (pagos con transferencia o tarjeta)", d.banco.salidas],
      ["Dinero en cuentas al final del mes", d.banco.dinero ?? "Faltan saldos"], ["Total bancario parcial", d.banco.dinero_parcial ? "Sí: faltan saldos iniciales" : "No"], ["Conciliaciones de transferencias por revisar", d.banco.conciliaciones_pendientes || 0], ["Deuda en tarjetas al final del mes", d.banco.deuda ?? "Faltan saldos"], ["Deuda parcial", d.banco.deuda_parcial ? "Sí: faltan saldos iniciales" : "No"], ["Cuentas", d.banco.cuentas || ""]
    ]),
    hoja("Cuentas", ["Cuenta", "Tipo", "Saldo inicial", "Inicial", "Ajuste", "Entró", "Salió", "Saldo o deuda final"],
      d.banco.lista.map(c => [c.nombre, c.tipo === "credito" ? "Crédito" : "Débito", c.inicial ?? "", c.inicial == null ? "" : c.capturado ? "Contado" : "Calculado", c.ajuste ?? "", c.tipo === "credito" ? c.salidas : c.entradas, c.tipo === "credito" ? c.entradas : c.salidas, c.saldo ?? ""])),
    hoja("Retiros del corte", ["Día", "Turno", "Encargado", "Concepto", "Categoría", "Monto"], d.retiros.slice().sort((a, b) => a.dia.localeCompare(b.dia)).map(r => [r.dia, TURNO[r.turno] || r.turno, r.persona, r.concepto, et(r.categoria), r.monto])),
    hoja("Diferencias de caja", ["Día", "Turno", "Encargado", "Qué", "Diferencia (− faltó, + sobró)"], d.diferencias.lista.map(x => [x.dia, TURNO[x.turno] || x.turno, x.persona, x.concepto, x.dif])),
    hoja("Sueldos", ["Quién o concepto", "De dónde", "Pagos", "Total"], [...d.sueldos.caja.map(x => [x.persona, "Cobrado del turno", x.n, x.total]), ...d.sueldos.admin.map(x => [x.concepto, "Pagado por la administración", x.n, x.total])]),
    hoja("Efectivo en sobres", ["Día", "Movimiento", "Concepto", "Encargado", "Entrada", "Salida", "Saldo"],
      [["", "Saldo inicial", "", "", e.inicial ?? "", "", e.inicial ?? ""], ...e.movimientos.slice().reverse().map(m => [m.dia, ({ sobre: "Sobre recibido", deposito: "Depósito al banco", retiro: "Retiro del banco", pago_tarjeta: "Pago de tarjeta", traspaso: "Traspaso" })[m.tipo] || CAT_TXT[m.tipo] || "Gasto", m.concepto, m.persona || "", m.entrada || "", m.salida || "", m.saldo ?? ""])]),
    hoja("Egresos de administración", ["Día", "Tipo", "Categoría", "Concepto", "Monto", "Pagado con", "Nota", "Comprobante", "Registró"],
      d.admin.slice().sort((a, b) => a.dia.localeCompare(b.dia)).map(x => [x.dia, CAT_TXT[x.cat], et(x.categoria), x.concepto, x.monto, FORMA_ADMIN[x.forma] || x.forma, x.nota, x.comprobante ? "Sí (Drive: Comprobantes de pago)" : "", x.por])),
    hoja("Transferencias de clientes", ["Fecha", "Origen", "Cliente", "Ticket", "Importe", "Factura", "Capturado por"], [
      ...d.transf_hoja.map(h => [h.fecha, "Ticket de la hoja", h.ligada ? h.ligada.cliente : h.cliente, `${h.servicio === "bascula" ? "Báscula" : "Pensión"} ${h.folio}`, h.importe, h.ligada && h.ligada.factura || "", ""]),
      ...d.transferencias.filter(x => !x.ticket_ref || !d.transf_hoja.some(h => h.ref === x.ticket_ref)).map(x => [x.fecha, "Capturada en el panel", x.cliente, "", x.importe, x.factura || "", x.creado_por || ""])
    ].sort((a, b) => String(a[0]).localeCompare(String(b[0])))),
    hoja("Pagos hechos", ["Fecha de pago", "Concepto", "Tipo", "Importe", "Pagado con", "Vencimiento programado", "Nota", "Comprobante", "Registró"], pagos.map(p => [p.fecha, p.concepto || "", p.item_id ? "Programado" : "No programado", p.importe, FORMA_ADMIN[p.forma] || p.forma, p.programado || "", p.nota || "", p.comprobante ? "Sí" : "No", p.creado_por || ""])),
    hoja("Pagos programados", ["Concepto", "Próximo pago", "Importe aproximado", "Se repite", "Se paga con", "Estado"], programados.map(p => [p.titulo, p.fecha || "", p.importe ?? "", FREC[p.frecuencia] || p.frecuencia || "", FORMA_ADMIN[p.forma] || p.forma || "", p.estado === "pagado" ? "Pagado" : "Activo"])),
    hoja("Compras", ["Creada", "Qué", "Cantidad", "Estado", "Importe", "Pagada con", "Comprada"], compras.map(c => [local(c.creado), c.titulo, c.cantidad || "", c.estado === "comprado" ? "Comprada" : "Pendiente", c.importe ?? "", c.forma_gasto ? FORMA_ADMIN[c.forma_gasto] || c.forma_gasto : "", local(c.cerrado)])),
    hoja("Egresos por categoría", ["Categoría", "Total", "De caja (turnos)", "De administración"], d.por_categoria.map(x => [x.nombre, x.total, x.caja, Math.round((x.total - x.caja) * 100) / 100])),
    hoja("Por día", ["Día", "Ingresos", "Egresos", "Diferencia"], d.por_dia.map(x => [x.dia, x.ingresos, x.egresos, Math.round((x.ingresos - x.egresos) * 100) / 100])),
    hoja("Bitácora de cambios", ["Cuándo", "Quién", "Acción", "Qué", "Detalle"], (await listaBitacora(env, 2000)).filter(b => b.mes === mes || mesLocal(b.cuando) === mes).reverse().map(b => [local(b.cuando), b.quien || "", ACCIONES[b.accion] || b.accion, b.que, b.detalle ? JSON.stringify(b.detalle) : ""]))
  ];
}

// ---------------- Facturación ----------------
async function hojasFacturacion(env, mes, filasFacturas) {
  const facturas = (await q(env, "SELECT * FROM solicitudes ORDER BY creado")).filter(s => mesLocal(s.creado) === mes || (s.resuelta_en && mesLocal(s.resuelta_en) === mes));
  const n = f => facturas.filter(f).length;
  return [
    hoja("Resumen", ["Concepto", "Valor"], [
      ["Mes", nombreMes(mes)], ["Generado", local(new Date().toISOString())],
      ["Solicitudes recibidas en el mes", n(s => mesLocal(s.creado) === mes)],
      ["Facturadas en el mes", n(s => ["facturada", "enviada"].includes(s.estado) && s.resuelta_en && mesLocal(s.resuelta_en) === mes)],
      ["Rechazadas en el mes", n(s => s.estado === "rechazada" && s.resuelta_en && mesLocal(s.resuelta_en) === mes)],
      ["Pendientes al generar", n(s => ["pendiente", "en_revision"].includes(s.estado))]
    ]),
    { nombre: "Facturas", filas: filasFacturas(facturas).map(f => f.map(celda)) }
  ];
}

// Crea (o reemplaza) el reporte de un área para un mes y guarda su enlace
export async function reporteArea(env, tipo, mes, h) {
  if (!TIPOS_REPORTE[tipo]) throw new Error("Tipo de reporte inválido");
  const hojas = tipo === "turnos" ? await hojasTurnos(env, mes) : tipo === "finanzas" ? await hojasFinanzas(env, mes) : await hojasFacturacion(env, mes, h.filasFacturas);
  const r = await h.script(env, { op: "hoja", destino: tipo, anio: mes.slice(0, 4), nombre: `${TIPOS_REPORTE[tipo]} ${mes} · El Castaño`, hojas }, 280000);
  if (!r || !r.ok) throw new Error((r && r.error) || "El script de Google no creó la hoja");
  // El script anterior no conoce las carpetas por área: dejaría el archivo en otra carpeta
  if (r.destino !== tipo) throw new Error("Actualiza el script de Google (versión con carpetas de Turnos, Finanzas y Facturación).");
  // No ocultar duplicados históricos si Drive no permitió archivarlos.
  const info = { tipo, mes, url: r.url, id: r.id, at: new Date().toISOString(),
    hojas: hojas.length, pendientes_archivar: Math.max(0, Number(r.pendientes_archivar) || 0) };
  try {
    await env.FILES.put(`rep:${tipo}:${mes}`, JSON.stringify(info));
  } catch {
    // El Google Sheet ya existe y está confirmado. No informar "falló crear"
    // porque reintentar podría sustituir un reporte generado correctamente.
    info.indice_pendiente = true;
    console.error("reportes: generado en Sheets, índice KV no confirmado");
  }
  return info;
}
// Los tres reportes del mes (al cerrarlo): si alguno falla, se avisa con el error
export async function reportesMes(env, mes, h) {
  const hechos = [], errores = [];
  for (const tipo of Object.keys(TIPOS_REPORTE)) {
    try { hechos.push(await reporteArea(env, tipo, mes, h)); } catch (e) { errores.push(`${TIPOS_REPORTE[tipo]}: ${e && e.message || e}`); }
  }
  if (errores.length) throw new Error(errores.join(" · "));
  return hechos;
}
// Lista de reportes creados (los nuevos por área y los anteriores de un solo archivo)
export async function listaReportes(env, tipo) {
  const out = [];
  const l = await env.FILES.list({ prefix: tipo ? `rep:${tipo}:` : "rep:" });
  for (const k of l.keys) { const v = await env.FILES.get(k.name, { type: "json" }); if (v) out.push(v); }
  if (!tipo || tipo !== "facturacion") {
    const v = await env.FILES.list({ prefix: "reporte:" });
    for (const k of v.keys) { const x = await env.FILES.get(k.name, { type: "json" }); if (x) out.push({ ...x, tipo: "anterior" }); }
  }
  return out.sort((a, b) => b.mes.localeCompare(a.mes) || String(a.tipo).localeCompare(String(b.tipo)));
}
