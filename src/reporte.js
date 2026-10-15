// Reporte mensual detallado en Google Sheets (Drive de administracion@, carpeta "El Castaño · Reportes mensuales/AAAA").
// Lo crea el script de Google (acción "archivos", op "hoja"). Se genera solo al cerrar el mes y a demanda desde el panel.
import { asegurarEsquemaCaja, calcularCortes, unirConteos, totalesMes, hojasExcel, leerRetiros } from "./caja.js";
import { asegurarEsquemaAgenda } from "./agenda.js";
import { asegurarEsquemaPersonal, resumenFila } from "./personal.js";

const RAIZ = "El Castaño · Reportes mensuales";
const TZ_HORAS = -6; // Tapachula (sin horario de verano)
const local = iso => iso ? new Date(new Date(iso).getTime() + TZ_HORAS * 3600e3).toISOString().slice(0, 16).replace("T", " ") : "";
const mesLocal = iso => local(iso).slice(0, 7);
const TURNO = { "MAÑANA": "Mañana", TARDE: "Tarde", NOCHE: "Noche" };
const nombreMes = mes => new Date(mes + "-15T12:00:00Z").toLocaleDateString("es-MX", { month: "long", year: "numeric", timeZone: "UTC" });

// Texto que Sheets podría tomar como fórmula (=, +, -, @) se guarda como texto
function celda(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return Number.isFinite(v) ? Math.round(v * 100) / 100 : "";
  if (typeof v === "boolean") return v ? "Sí" : "No";
  const s = String(v);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}
const hoja = (nombre, encabezados, filas) => ({ nombre, filas: [encabezados, ...filas].map(f => f.map(celda)) });

export async function hojasReporte(env, mes, { filasFacturas }) {
  await asegurarEsquemaCaja(env);
  await asegurarEsquemaAgenda(env);
  await asegurarEsquemaPersonal(env);
  const q = (sql, ...a) => env.DB.prepare(sql).bind(...a).all().then(r => r.results);

  // ---- Caja ----
  const movs = await q("SELECT * FROM caja_mov WHERE mes = ? ORDER BY fecha DESC", mes);
  const gastos = await q("SELECT * FROM caja_gastos WHERE mes = ? ORDER BY dia DESC, creado DESC", mes);
  const transf = await q("SELECT * FROM caja_transf WHERE mes = ? ORDER BY fecha DESC, creado DESC", mes);
  const conteos = await q("SELECT * FROM turno_cortes WHERE mes = ?", mes);
  const extras = await q("SELECT * FROM caja_extra WHERE mes = ? ORDER BY dia DESC, creado DESC", mes);
  const inicios = await q("SELECT * FROM turno_inicio WHERE mes = ? ORDER BY dia, turno", mes);
  const hist = await q("SELECT * FROM turno_cortes_hist WHERE mes = ? ORDER BY creado", mes);
  const cortes = unirConteos(calcularCortes(movs, gastos, extras, inicios), conteos);
  const t = totalesMes(cortes, transf);
  const caja = hojasExcel(mes, movs, gastos, transf, conteos, extras, inicios).map(h => ({ nombre: h.nombre, filas: h.filas.map(f => f.map(celda)) }));

  const retiros = [];
  for (const c of conteos) for (const r of leerRetiros(c.retiros)) retiros.push([c.dia, TURNO[c.turno] || c.turno, c.persona, r.concepto, r.monto]);
  retiros.sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  const historial = hist.map(x => { let d = {}; try { d = JSON.parse(x.datos); } catch {} return [x.dia, TURNO[x.turno] || x.turno, x.persona, local(x.creado), d.efectivo ?? "", d.sobre ?? "", (leerRetiros(d.retiros)).reduce((a, r) => a + r.monto, 0) || "", d.cambio_sig ?? "", d.notas || ""]; });

  // ---- Agenda (lo creado, cerrado o con fecha en el mes) ----
  const agenda = (await q("SELECT * FROM agenda_items ORDER BY creado")).filter(i => mesLocal(i.creado) === mes || (i.cerrado && mesLocal(i.cerrado) === mes) || (i.fecha && i.fecha.slice(0, 7) === mes));
  const de = tipo => agenda.filter(i => i.tipo === tipo);
  const quien = i => i.reporto ? i.reporto + " (tablet)" : i.autor && i.autor !== "admin" ? i.autor + " (tablet)" : i.creado_por || "Administración";
  const pagos = await q("SELECT p.*, COALESCE(p.titulo, i.titulo) AS concepto FROM agenda_pagos p LEFT JOIN agenda_items i ON i.id = p.item_id WHERE substr(p.fecha, 1, 7) = ? ORDER BY p.fecha", mes);
  const informes = (await q("SELECT r.*, i.titulo FROM agenda_reportes r LEFT JOIN agenda_items i ON i.id = r.item_id ORDER BY r.creado")).filter(r => mesLocal(r.creado) === mes);

  // ---- Facturas (recibidas o resueltas en el mes) ----
  const facturas = (await q("SELECT * FROM solicitudes ORDER BY creado")).filter(s => mesLocal(s.creado) === mes || (s.resuelta_en && mesLocal(s.resuelta_en) === mes));
  const ff = filasFacturas(facturas);

  // ---- Personal (cómo está al generar el reporte) ----
  const personal = (await q("SELECT * FROM colaboradores ORDER BY tipo, num")).map(resumenFila);

  const n = (arr, f) => arr.filter(f).length;
  const resumen = hoja("Resumen", ["Concepto", "Valor"], [
    ["Mes", nombreMes(mes)], ["Generado", local(new Date().toISOString())],
    ["Ingresos en efectivo", t.efectivo], ["Ingresos con tarjeta", t.tarjeta], ["Ingresos por transferencia", t.transferencias],
    ["Otros ingresos (rentas)", t.otros], ["Ingresos totales", t.ingresos], ["Báscula", t.bascula], ["Pensión", t.pension],
    ["Gastos", t.gastos], ["Movimientos de caja (cambio, retiros)", t.caja], ["Ingresos extra (incluye aumento de cambio)", t.extras],
    ["Cortes de turno con datos", cortes.length], ["Cortes entregados en la tablet", conteos.length],
    ["Suma de diferencias de efectivo (contado − sistema)", cortes.reduce((a, c) => a + (c.conteo && c.conteo.dif_efectivo != null ? c.conteo.dif_efectivo : 0), 0)],
    ["Retiros extra", retiros.reduce((a, r) => a + r[4], 0)],
    ["Pagos realizados (programados y no programados)", pagos.reduce((a, p) => a + p.importe, 0)],
    ["Compras confirmadas", de("compra").filter(i => i.estado === "comprado").reduce((a, i) => a + (i.importe || 0), 0)],
    ["Solicitudes de factura recibidas", n(facturas, s => mesLocal(s.creado) === mes)],
    ["Facturadas en el mes", n(facturas, s => s.estado === "facturada" && s.resuelta_en && mesLocal(s.resuelta_en) === mes)],
    ["Rechazadas en el mes", n(facturas, s => s.estado === "rechazada" && s.resuelta_en && mesLocal(s.resuelta_en) === mes)],
    ["Incidencias reportadas", n(de("incidencia"), i => mesLocal(i.creado) === mes)],
    ["Tareas cerradas", n(de("tarea"), i => i.estado === "hecho" && i.cerrado && mesLocal(i.cerrado) === mes)],
    ["Personal activo", n(personal, p => p.tipo === "colaborador" && p.estatus === "activo")],
    ["Externos activos", n(personal, p => p.tipo === "externo" && p.estatus === "activo")]
  ]);

  return [
    resumen,
    ...caja,
    hoja("Cambio inicial", ["Día", "Turno", "Encargado", "Cambio inicial", "Capturado"], inicios.map(i => [i.dia, TURNO[i.turno] || i.turno, i.persona, i.cambio, local(i.actualizado)])),
    hoja("Retiros extra", ["Día", "Turno", "Encargado", "Concepto", "Monto"], retiros),
    hoja("Historial de cortes", ["Día", "Turno", "Entregó", "Cuándo", "Efectivo contado", "Sobre", "Retiros", "Cambio siguiente", "Notas"], historial),
    hoja("Pagos", ["Fecha de pago", "Concepto", "Tipo", "Importe", "Forma", "Vencimiento programado", "Nota", "Comprobante", "Registró"], pagos.map(p => [p.fecha, p.concepto || "", p.item_id ? "Programado" : "No programado", p.importe, p.forma, p.programado || "", p.nota || "", p.comprobante ? "Sí (Drive: Comprobantes de pago)" : "No", p.creado_por || ""])),
    hoja("Compras", ["Creada", "Qué", "Cantidad", "Estado", "Importe", "Comprada"], de("compra").map(i => [local(i.creado), i.titulo, i.cantidad || "", i.estado === "comprado" ? "Comprada" : "Pendiente", i.importe ?? "", local(i.cerrado)])),
    hoja("Incidencias", ["Fecha", "Turno", "Qué pasó", "Dónde", "Gravedad", "Estado", "Reportó", "Capturó", "Detalle", "Resuelta"], de("incidencia").map(i => [i.fecha || "", TURNO[i.turno] || i.turno || "", i.titulo, i.area || "", i.gravedad || "", i.estado, i.quien || "", quien(i), i.detalle || "", i.estado === "resuelta" ? local(i.cerrado) : ""])),
    hoja("Tareas", ["Creada", "Tarea", "Fecha límite", "Prioridad", "Tablet", "Turno", "Estado", "Hecha por", "Cerrada", "Nota"], de("tarea").map(i => [local(i.creado), i.titulo, i.fecha || "", i.prioridad || "", i.para_turno ? "Sí" : "No", TURNO[i.turno] || "", i.estado, i.hecho_por || "", local(i.cerrado), i.nota_cierre || i.detalle || ""])),
    hoja("Informes de tareas", ["Cuándo", "Tarea", "Encargado", "Turno", "Resultado", "Nota"], informes.map(r => [local(r.creado), r.titulo || "", r.persona, TURNO[r.turno] || r.turno || "", { cumplida: "Cumplida", parcial: "En parte", no: "No se pudo" }[r.resultado] || r.resultado, r.nota || ""])),
    hoja("Avisos", ["Creado", "De", "Aviso", "Detalle", "Importante", "Estado"], de("aviso").map(i => [local(i.creado), i.autor && i.autor !== "admin" ? i.autor : "Administración", i.titulo, i.detalle || "", i.prioridad === "alta", i.estado])),
    hoja("Eventos", ["Fecha", "Hora", "Evento", "Detalle"], de("evento").map(i => [i.fecha || "", i.hora || "", i.titulo, i.detalle || ""])),
    { nombre: "Facturas", filas: ff.map(f => f.map(celda)) },
    hoja("Personal", ["Folio", "Nombre", "Tipo", "Puesto o actividad", "Estatus", "Teléfono", "Correo", "Documentos", "Expediente completo", "Alta", "Baja", "Motivo de baja"],
      personal.map(p => [p.folio, p.nombre, p.tipo === "externo" ? "Externo" : "Colaborador", p.puesto || p.actividad, p.estatus === "activo" ? "Activo" : "Inactivo", p.telefono || "", p.correo, `${p.entregados}/${p.total}`, p.completo, local(p.creado).slice(0, 10), p.fecha_baja || "", p.motivo_baja || ""]))
  ];
}

// Crea (o reemplaza) la hoja del mes en Drive y guarda su enlace
export async function reporteMes(env, mes, h) {
  const hojas = await hojasReporte(env, mes, h);
  const r = await h.script(env, { op: "hoja", raiz: RAIZ, carpeta: [mes.slice(0, 4)], nombre: `El Castaño · Reporte ${mes}`, hojas }, 280000);
  if (!r || !r.ok) throw new Error((r && r.error) || "El script de Google no creó la hoja");
  const info = { mes, url: r.url, id: r.id, at: new Date().toISOString(), hojas: hojas.length };
  await env.FILES.put("reporte:" + mes, JSON.stringify(info));
  return info;
}
