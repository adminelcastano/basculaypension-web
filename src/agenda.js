import { leerArchivo, borrarArchivo, guardarArchivo } from "./fotos.js";
import { asegurarEsquemaCaja, mesesAbiertos } from "./caja.js";
// Agenda del panel: calendario, por hacer, compras e incidencias.
// Todo vive en una tabla (agenda_items) con un campo "tipo".

const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });

export const TIPOS = ["evento", "tarea", "compra", "incidencia", "aviso", "pago"];
const ESTADOS = {
  evento: ["programado", "hecho"],
  tarea: ["pendiente", "hecho"],
  compra: ["pendiente", "comprado"],
  incidencia: ["abierta", "en_proceso", "resuelta"],
  aviso: ["activo", "archivado"],
  pago: ["pendiente", "pagado"]
};
// Pagos programados (planes de teléfono, suscripciones, tarjetas…): al registrar el pago se crea el gasto
export const FRECUENCIAS = { unica: "Una sola vez", mensual: "Cada mes", bimestral: "Cada 2 meses", trimestral: "Cada 3 meses", semestral: "Cada 6 meses", anual: "Cada año" };
const MESES_FREC = { mensual: 1, bimestral: 2, trimestral: 3, semestral: 6, anual: 12 };
const FORMAS = ["EFECTIVO", "TARJETA", "TRANSFERENCIA"];
// Misma fecha N meses después (si el día no existe, el último del mes: 31 ene → 28/29 feb)
function sumarMeses(dia, n) {
  const [a, m, d] = dia.split("-").map(Number);
  const t = new Date(Date.UTC(a, m - 1 + n, 1));
  const ult = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(d, ult));
  return t.toISOString().slice(0, 10);
}
const leerMonto = v => { const t = String(v ?? "").replace(/[$,\s]/g, ""); return /^\d{1,9}(\.\d{1,2})?$/.test(t) ? Number(t) : NaN; };
// Día y turno de caja en este momento (hora de Tapachula; la noche después de medianoche es del día anterior)
function turnoAhora(ahora = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(ahora).map(x => [x.type, x.value]));
  const h = Number(p.hour), dia = `${p.year}-${p.month}-${p.day}`;
  const turno = h >= 6 && h < 14 ? "MAÑANA" : h >= 14 && h < 22 ? "TARDE" : "NOCHE";
  if (turno === "NOCHE" && h < 6) { const d = new Date(dia + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() - 1); return { dia: d.toISOString().slice(0, 10), turno }; }
  return { dia, turno };
}
export const AREAS = ["Báscula", "Caseta", "Patio", "Pluma / acceso", "Baños", "Iluminación", "Cámaras", "Otro"];
const PRIORIDADES = ["normal", "alta"];
const GRAVEDADES = ["leve", "media", "grave"];
const TURNOS = ["MAÑANA", "TARDE", "NOCHE"];
const texto = (v, n) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const RE_DIA = /^\d{4}-\d{2}-\d{2}$/, RE_HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
const hoyMx = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(new Date());

let listo = false;
export async function asegurarEsquemaAgenda(env) {
  if (listo) return;
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS agenda_items (
      id TEXT PRIMARY KEY, tipo TEXT NOT NULL, titulo TEXT NOT NULL, detalle TEXT, fecha TEXT, hora TEXT,
      estado TEXT NOT NULL, prioridad TEXT, cantidad TEXT, turno TEXT, gravedad TEXT,
      creado TEXT NOT NULL, creado_por TEXT, actualizado TEXT, cerrado TEXT, aviso INTEGER, avisado TEXT)`),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS agenda_tipo ON agenda_items (tipo, estado)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS agenda_fecha ON agenda_items (fecha)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS agenda_lecturas (item_id TEXT NOT NULL, persona TEXT NOT NULL, at TEXT NOT NULL, PRIMARY KEY (item_id, persona))"),
    // Informes de la tablet sobre una tarea: cumplida, parcial o no se pudo, con nota y foto opcional
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS agenda_reportes (
      id TEXT PRIMARY KEY, item_id TEXT NOT NULL, persona TEXT NOT NULL, turno TEXT, dia TEXT, resultado TEXT NOT NULL,
      nota TEXT, foto TEXT, creado TEXT NOT NULL)`),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS agenda_reportes_item ON agenda_reportes (item_id)")
  ]);
  // Columnas agregadas para la tablet de turno
  const cols = new Set((await env.DB.prepare("PRAGMA table_info(agenda_items)").all()).results.map(r => r.name));
  // autor: null o "admin" = administración; si no, la clave del encargado. para: destinatarios del aviso (JSON).
  // quien: quién reporta la incidencia (texto libre en la tablet).
  for (const [c, t] of [["para_turno", "INTEGER"], ["reporto", "TEXT"], ["foto", "TEXT"], ["hecho_por", "TEXT"], ["nota_cierre", "TEXT"], ["area", "TEXT"], ["autor", "TEXT"], ["para", "TEXT"], ["quien", "TEXT"], ["importe", "REAL"], ["gasto_id", "TEXT"], ["frecuencia", "TEXT"], ["forma", "TEXT"]])
    if (!cols.has(c)) await env.DB.prepare(`ALTER TABLE agenda_items ADD COLUMN ${c} ${t}`).run();
  // Historial de pagos hechos de cada pago programado (cada uno con su gasto en Ingresos y gastos)
  // Se conserva 13 meses aunque el pago programado se borre (por eso guarda su propio título)
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS agenda_pagos (id TEXT PRIMARY KEY, item_id TEXT NOT NULL, fecha TEXT NOT NULL, programado TEXT, importe REAL NOT NULL, forma TEXT NOT NULL, gasto_id TEXT, creado TEXT NOT NULL, creado_por TEXT, titulo TEXT)").run();
  const colsP = new Set((await env.DB.prepare("PRAGMA table_info(agenda_pagos)").all()).results.map(r => r.name));
  if (!colsP.has("titulo")) await env.DB.prepare("ALTER TABLE agenda_pagos ADD COLUMN titulo TEXT").run();
  // Pagos hechos sin programar (item_id = ''), comprobante (foto o PDF) y nota
  for (const c of ["comprobante", "nota", "comp_tipo"]) if (!colsP.has(c)) await env.DB.prepare(`ALTER TABLE agenda_pagos ADD COLUMN ${c} TEXT`).run();
  listo = true;
}

// Destinatarios de un aviso: { todos, admin, turnos: [...], personas: [...] }. Sin nada marcado = todos.
export function normalizarPara(p) {
  if (typeof p === "string") { try { p = JSON.parse(p); } catch { p = null; } }
  if (!p || typeof p !== "object") return { todos: true, admin: false, turnos: [], personas: [] };
  const turnos = (Array.isArray(p.turnos) ? p.turnos : []).map(t => String(t).toUpperCase()).filter(t => TURNOS.includes(t));
  const personas = (Array.isArray(p.personas) ? p.personas : []).map(x => texto(x, 12).toUpperCase()).filter(Boolean).slice(0, 30);
  const r = { todos: !!p.todos, admin: !!p.admin, turnos: [...new Set(turnos)], personas: [...new Set(personas)] };
  if (!r.todos && !r.admin && !r.turnos.length && !r.personas.length) r.todos = true;
  return r;
}
// ¿Lo ve el encargado `persona` en el turno `turno`?
export function avisoParaEncargado(it, persona, turno) {
  if (it.autor === persona) return true;
  const p = normalizarPara(it.para);
  return p.todos || p.turnos.includes(turno) || p.personas.includes(persona);
}

function validar(tipo, c, previo = {}) {
  const v = k => (k in c ? c[k] : previo[k]);
  const d = {
    titulo: texto(v("titulo"), 140), detalle: texto(v("detalle"), 1000) || null,
    fecha: v("fecha") ? String(v("fecha")) : null, hora: v("hora") ? String(v("hora")) : null,
    estado: String(v("estado") || ESTADOS[tipo][0]), prioridad: v("prioridad") ? String(v("prioridad")) : null,
    cantidad: texto(v("cantidad"), 40) || null, turno: v("turno") ? String(v("turno")).toUpperCase() : null,
    gravedad: v("gravedad") ? String(v("gravedad")) : null,
    aviso: v("aviso") ? Number(v("aviso")) : null,
    para_turno: v("para_turno") ? 1 : 0,
    area: v("area") ? texto(v("area"), 40) : null,
    para: tipo === "aviso" ? JSON.stringify(normalizarPara(v("para"))) : null,
    quien: tipo === "incidencia" && v("quien") ? texto(v("quien"), 60) : null
  };
  const e = {};
  if (d.titulo.length < 2) e.titulo = tipo === "compra" ? "Escribe qué hay que comprar." : tipo === "incidencia" ? "Describe la incidencia." : "Escribe un título.";
  if (d.fecha && !RE_DIA.test(d.fecha)) e.fecha = "Fecha inválida.";
  if (tipo === "evento" && !d.fecha) e.fecha = "Elige la fecha del evento.";
  if (tipo === "pago") {
    if (!d.fecha) e.fecha = "Elige la fecha del próximo pago.";
    d.frecuencia = Object.hasOwn(FRECUENCIAS, v("frecuencia")) ? v("frecuencia") : "mensual";
    d.forma = FORMAS.includes(v("forma")) ? v("forma") : "TRANSFERENCIA";
    const imp = v("importe");
    d.importe = imp === "" || imp == null ? null : leerMonto(imp);
    if (d.importe !== null && !(d.importe > 0)) e.importe = "Importe inválido.";
    if (e.titulo) e.titulo = "Escribe qué se paga (ej. Plan Telcel).";
  }
  if (tipo === "incidencia" && !d.fecha) d.fecha = hoyMx();
  if (d.hora && !RE_HORA.test(d.hora)) e.hora = "Hora inválida.";
  if (!ESTADOS[tipo].includes(d.estado)) e.estado = "Estado inválido.";
  if (d.prioridad && !PRIORIDADES.includes(d.prioridad)) e.prioridad = "Prioridad inválida.";
  if (d.turno && !TURNOS.includes(d.turno)) e.turno = "Turno inválido.";
  if (d.gravedad && !GRAVEDADES.includes(d.gravedad)) e.gravedad = "Gravedad inválida.";
  if (tipo === "incidencia" && !d.gravedad) d.gravedad = "media";
  if (d.aviso !== null && ![15, 60, 1440].includes(d.aviso)) e.aviso = "Recordatorio inválido.";
  if (d.aviso && !["evento", "tarea"].includes(tipo)) d.aviso = null;
  if (tipo !== "tarea") d.para_turno = tipo === "aviso" ? 1 : 0;
  if (d.aviso && !d.fecha) e.aviso = "Para recordarte, ponle fecha.";
  return { d, e };
}

const ABIERTO = "estado NOT IN ('hecho','comprado','resuelta','archivado','pagado')";

export async function insertarItem(env, id, tipo, d, creadoPor, ahora, extra = {}) {
  await env.DB.prepare(`INSERT INTO agenda_items (id, tipo, titulo, detalle, fecha, hora, estado, prioridad, cantidad, turno, gravedad, creado, creado_por, actualizado, aviso, para_turno, area, reporto, foto, autor, para, quien)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, tipo, d.titulo, d.detalle, d.fecha, d.hora, d.estado, d.prioridad, d.cantidad, d.turno, d.gravedad, ahora, creadoPor, ahora, d.aviso, d.para_turno || 0, d.area || null, extra.reporto || null, extra.foto || null,
      extra.autor || (tipo === "aviso" ? "admin" : null), d.para || null, d.quien || null).run();
}
// Borra registros de la agenda con sus fotos, lecturas e informes
async function borrarItems(env, items) {
  if (!items.length) return;
  const ids = items.map(v => v.id);
  const stmts = [];
  for (let i = 0; i < ids.length; i += 90) {
    const lote = ids.slice(i, i + 90), q = lote.map(() => "?").join(",");
    const fotos = (await env.DB.prepare(`SELECT foto FROM agenda_reportes WHERE item_id IN (${q}) AND foto IS NOT NULL`).bind(...lote).all()).results;
    for (const f of fotos) await borrarArchivo(env, f.foto).catch(() => {});
    stmts.push(env.DB.prepare(`DELETE FROM agenda_lecturas WHERE item_id IN (${q})`).bind(...lote));
    stmts.push(env.DB.prepare(`DELETE FROM agenda_reportes WHERE item_id IN (${q})`).bind(...lote));
    stmts.push(env.DB.prepare(`DELETE FROM agenda_items WHERE id IN (${q})`).bind(...lote));
  }
  for (const v of items) if (v.foto) await borrarArchivo(env, v.foto).catch(() => {});
  await env.DB.batch(stmts);
}
export { validar as validarItem, ABIERTO };

// Limpieza diaria: lo terminado hace más de 30 días se borra por completo (registro, foto y lecturas).
// Lo que sigue abierto no se toca, aunque sea viejo.
export async function limpiarAgenda(env, ahora = new Date()) {
  await asegurarEsquemaAgenda(env);
  // Los avisos que dejan los encargados se archivan solos a los 3 días (los de la administración, cuando ella decida)
  const tresDias = new Date(ahora.getTime() - 3 * 864e5).toISOString();
  await env.DB.prepare("UPDATE agenda_items SET estado = 'archivado', cerrado = ?, actualizado = ? WHERE tipo = 'aviso' AND estado = 'activo' AND autor IS NOT NULL AND autor != 'admin' AND creado < ?")
    .bind(ahora.toISOString(), ahora.toISOString(), tresDias).run();
  // Historial de pagos hechos: 13 meses
  const lim13 = sumarMeses(hoyMx(), -13);
  for (const f of (await env.DB.prepare("SELECT comprobante FROM agenda_pagos WHERE fecha < ? AND comprobante IS NOT NULL LIMIT 50").bind(lim13).all()).results) await borrarArchivo(env, f.comprobante).catch(() => {});
  await env.DB.prepare("DELETE FROM agenda_pagos WHERE fecha < ?").bind(lim13).run();
  // 40 días (y no 30) para que el reporte mensual incluya todo lo cerrado durante el mes
  const limite = new Date(ahora.getTime() - 40 * 864e5).toISOString();
  const diaLimite = limite.slice(0, 10);
  const viejos = (await env.DB.prepare(`SELECT id, foto FROM agenda_items
    WHERE (NOT (${ABIERTO}) AND COALESCE(cerrado, actualizado, creado) < ?)
       OR (tipo = 'evento' AND fecha < ?) LIMIT 500`).bind(limite, diaLimite).all()).results;
  if (!viejos.length) return 0;
  await borrarItems(env, viejos);
  return viejos.length;
}

// Resumen para el Inicio
export async function resumenAgenda(env) {
  await asegurarEsquemaAgenda(env);
  const hoy = hoyMx();
  const conteos = (await env.DB.prepare(`SELECT tipo, COUNT(*) n FROM agenda_items WHERE ${ABIERTO} GROUP BY tipo`).all()).results;
  const c = Object.fromEntries(TIPOS.map(t => [t, 0])); for (const r of conteos) c[r.tipo] = r.n;
  const proximos = (await env.DB.prepare(`SELECT * FROM agenda_items WHERE tipo = 'evento' AND ${ABIERTO} AND fecha >= ? ORDER BY fecha, hora LIMIT 5`).bind(hoy).all()).results;
  const tareas = (await env.DB.prepare(`SELECT * FROM agenda_items WHERE tipo = 'tarea' AND ${ABIERTO} ORDER BY CASE prioridad WHEN 'alta' THEN 0 ELSE 1 END, COALESCE(fecha, '9999'), creado LIMIT 4`).all()).results;
  const compras = (await env.DB.prepare(`SELECT * FROM agenda_items WHERE tipo = 'compra' AND ${ABIERTO} ORDER BY CASE prioridad WHEN 'alta' THEN 0 ELSE 1 END, creado LIMIT 4`).all()).results;
  const incidencias = (await env.DB.prepare(`SELECT * FROM agenda_items WHERE tipo = 'incidencia' AND ${ABIERTO} ORDER BY CASE gravedad WHEN 'grave' THEN 0 WHEN 'media' THEN 1 ELSE 2 END, fecha DESC LIMIT 4`).all()).results;
  const vencidas = (await env.DB.prepare(`SELECT COUNT(*) n FROM agenda_items WHERE tipo = 'tarea' AND ${ABIERTO} AND fecha < ?`).bind(hoy).first()).n;
  const eventosHoy = (await env.DB.prepare(`SELECT COUNT(*) n FROM agenda_items WHERE tipo = 'evento' AND fecha = ?`).bind(hoy).first()).n;
  const pagos = (await env.DB.prepare(`SELECT * FROM agenda_items WHERE tipo = 'pago' AND ${ABIERTO} ORDER BY fecha LIMIT 4`).all()).results;
  return { hoy, abiertos: c, vencidas, eventos_hoy: eventosHoy, proximos, tareas, compras, incidencias, pagos };
}

// ---- Pagos hechos (de un pago programado o sueltos) ----
// Cada pago hecho crea su gasto en Ingresos y gastos; se puede corregir o borrar mientras su mes siga abierto.
async function validarPagoHecho(env, c, fila) {
  const fecha = String(c.fecha || ""), importe = leerMonto(c.importe);
  const forma = FORMAS.includes(c.forma) ? c.forma : (fila && fila.forma) || "TRANSFERENCIA";
  const errores = {};
  await asegurarEsquemaCaja(env);
  const meses = await mesesAbiertos(env);
  if (!RE_DIA.test(fecha) || fecha > hoyMx()) errores.fecha = "Escribe la fecha en que se pagó (no futura).";
  else if (!meses.includes(fecha.slice(0, 7))) errores.fecha = "Ese mes ya se cerró en Ingresos y gastos; usa una fecha del mes abierto.";
  if (!(importe > 0) || importe > 1000000) errores.importe = "Escribe el importe pagado.";
  const titulo = texto(c.titulo, 140);
  if (!fila && titulo.length < 2) errores.titulo = "Escribe qué pagaste (ej. Recibo de luz CFE).";
  const nota = texto(c.nota, 300) || null;
  return { fecha, importe, forma, titulo, nota, errores, meses };
}
const turnoDe = (fecha, pedido) => { const t = turnoAhora(); return TURNOS.includes(pedido) ? pedido : fecha === t.dia ? t.turno : "MAÑANA"; };
const TIPOS_COMP = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/pdf"];

async function pagosHechosRutas(request, env, partes, usuario, ahora) {
  // Pago hecho sin programar
  if (partes[2] === "hecho" && partes.length === 3 && request.method === "POST") {
    let c; try { c = await request.json(); } catch { return json({ ok: false, error: "Datos inválidos." }, 400); }
    const v = await validarPagoHecho(env, c, null);
    if (Object.keys(v.errores).length) return json({ ok: false, error: Object.values(v.errores).join(" "), errores: v.errores }, 422);
    const gid = crypto.randomUUID(), pid = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO caja_gastos (id, mes, dia, turno, concepto, monto, forma, creado, creado_por) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(gid, v.fecha.slice(0, 7), v.fecha, turnoDe(v.fecha, c.turno), ("Pago: " + v.titulo).slice(0, 120), v.importe, v.forma, ahora, usuario && usuario.email || null).run();
    await env.DB.prepare("INSERT INTO agenda_pagos (id, item_id, fecha, programado, importe, forma, gasto_id, creado, creado_por, titulo, nota) VALUES (?, '', ?, NULL, ?, ?, ?, ?, ?, ?, ?)")
      .bind(pid, v.fecha, v.importe, v.forma, gid, ahora, usuario && usuario.email || null, v.titulo, v.nota).run();
    return json({ ok: true, id: pid });
  }
  const pid = partes[2];
  const pago = pid ? await env.DB.prepare("SELECT * FROM agenda_pagos WHERE id = ?").bind(pid).first() : null;
  if (!pago) return json({ ok: false, error: "No existe ese pago." }, 404);
  const accion = partes[3];
  if (accion === "comprobante" && request.method === "GET") {
    if (!pago.comprobante) return new Response("Sin comprobante.", { status: 404 });
    const { value, metadata } = await leerArchivo(env, pago.comprobante);
    if (!value) return new Response("Archivo no disponible.", { status: 404 });
    const tipo = (metadata && metadata.tipo) || pago.comp_tipo || "application/octet-stream";
    return new Response(value, { headers: { "Content-Type": tipo, "Content-Disposition": "inline", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'self'" } });
  }
  if (request.method !== "POST") return json({ ok: false, error: "Ruta no encontrada." }, 404);
  await asegurarEsquemaCaja(env);
  const meses = await mesesAbiertos(env);
  if (!meses.includes(pago.fecha.slice(0, 7))) return json({ ok: false, error: "Ese pago es de un mes ya cerrado en Ingresos y gastos; ya no se puede cambiar." }, 409);

  if (accion === "comprobante") {
    const tipo = (request.headers.get("Content-Type") || "").split(";")[0].trim().toLowerCase();
    if (!TIPOS_COMP.includes(tipo)) return json({ ok: false, error: "Sube una foto (JPG, PNG, HEIC) o un PDF." }, 415);
    const bytes = await request.arrayBuffer();
    if (!bytes.byteLength || bytes.byteLength > 10 * 1024 * 1024) return json({ ok: false, error: "El archivo está vacío o pesa más de 10 MB." }, 413);
    const llave = "pc:" + pago.id;
    const nombre = `${pago.fecha} ${String(pago.titulo || "Pago").replace(/[^\p{L}\p{N} .-]/gu, "").slice(0, 60)}.${tipo === "application/pdf" ? "pdf" : (tipo.split("/")[1] || "jpg").replace("jpeg", "jpg")}`;
    await guardarArchivo(env, llave, bytes, { tipo, nombre, carpeta: ["Comprobantes de pago", pago.fecha.slice(0, 7)] });
    await env.DB.prepare("UPDATE agenda_pagos SET comprobante = ?, comp_tipo = ? WHERE id = ?").bind(llave, tipo, pago.id).run();
    return json({ ok: true });
  }
  if (accion === "quitar-comprobante") {
    if (pago.comprobante) await borrarArchivo(env, pago.comprobante).catch(() => {});
    await env.DB.prepare("UPDATE agenda_pagos SET comprobante = NULL, comp_tipo = NULL WHERE id = ?").bind(pago.id).run();
    return json({ ok: true });
  }
  if (accion === "editar") {
    let c; try { c = await request.json(); } catch { return json({ ok: false, error: "Datos inválidos." }, 400); }
    const v = await validarPagoHecho(env, { ...c, titulo: c.titulo ?? pago.titulo }, pago.item_id ? pago : null);
    if (Object.keys(v.errores).length) return json({ ok: false, error: Object.values(v.errores).join(" "), errores: v.errores }, 422);
    const titulo = pago.item_id ? pago.titulo : v.titulo;
    await env.DB.prepare("UPDATE agenda_pagos SET fecha = ?, importe = ?, forma = ?, nota = ?, titulo = ? WHERE id = ?").bind(v.fecha, v.importe, v.forma, v.nota, titulo, pago.id).run();
    if (pago.gasto_id) await env.DB.prepare("UPDATE caja_gastos SET mes = ?, dia = ?, monto = ?, forma = ?, concepto = ? WHERE id = ?").bind(v.fecha.slice(0, 7), v.fecha, v.importe, v.forma, ("Pago: " + titulo).slice(0, 120), pago.gasto_id).run();
    return json({ ok: true });
  }
  if (accion === "eliminar") {
    if (pago.gasto_id) await env.DB.prepare("DELETE FROM caja_gastos WHERE id = ?").bind(pago.gasto_id).run();
    if (pago.comprobante) await borrarArchivo(env, pago.comprobante).catch(() => {});
    await env.DB.prepare("DELETE FROM agenda_pagos WHERE id = ?").bind(pago.id).run();
    // Si era el último pago de un pago programado, el vencimiento regresa a como estaba antes de registrarlo
    let regreso = null;
    if (pago.item_id && pago.programado) {
      const it = await env.DB.prepare("SELECT * FROM agenda_items WHERE id = ?").bind(pago.item_id).first();
      const otro = await env.DB.prepare("SELECT 1 FROM agenda_pagos WHERE item_id = ? AND creado > ? LIMIT 1").bind(pago.item_id, pago.creado).first();
      if (it && !otro) {
        const n = MESES_FREC[it.frecuencia || "mensual"];
        if (!n && it.estado === "pagado") { await env.DB.prepare("UPDATE agenda_items SET estado = 'pendiente', cerrado = NULL, fecha = ?, actualizado = ? WHERE id = ?").bind(pago.programado, ahora, it.id).run(); regreso = pago.programado; }
        else if (n && it.fecha === sumarMeses(pago.programado, n)) { await env.DB.prepare("UPDATE agenda_items SET fecha = ?, avisado = NULL, actualizado = ? WHERE id = ?").bind(pago.programado, ahora, it.id).run(); regreso = pago.programado; }
      }
    }
    return json({ ok: true, regreso });
  }
  return json({ ok: false, error: "Ruta no encontrada." }, 404);
}

// Rutas: /panel/api/agenda...
export async function agendaPanel(request, env, url, partes, usuario) {
  await asegurarEsquemaAgenda(env);
  const ahora = new Date().toISOString();

  if (partes.length === 1 && request.method === "GET") {
    const tipo = url.searchParams.get("tipo");
    const desde = url.searchParams.get("desde") || "", hasta = url.searchParams.get("hasta") || "";
    let sql = "SELECT * FROM agenda_items WHERE 1=1", args = [];
    if (TIPOS.includes(tipo)) { sql += " AND tipo = ?"; args.push(tipo); }
    if (RE_DIA.test(desde)) { sql += " AND fecha >= ?"; args.push(desde); }
    if (RE_DIA.test(hasta)) { sql += " AND fecha <= ?"; args.push(hasta); }
    // Lo cerrado hace más de 30 días ya no se lista (se conserva en la base)
    const limite = new Date(Date.now() - 30 * 864e5).toISOString();
    sql += ` AND (${ABIERTO} OR cerrado IS NULL OR cerrado >= ?)`; args.push(limite);
    sql += " ORDER BY COALESCE(fecha, '9999-12-31'), COALESCE(hora, '99:99'), creado LIMIT 1000";
    const items = (await env.DB.prepare(sql).bind(...args).all()).results;
    // Lecturas e informes solo de los registros que se listan (no de toda la historia)
    const deIds = async (sql, ids) => { const out = []; for (let i = 0; i < ids.length; i += 90) { const l = ids.slice(i, i + 90); out.push(...(await env.DB.prepare(sql.replace("(?)", "(" + l.map(() => "?").join(",") + ")")).bind(...l).all()).results); } return out; };
    const lect = await deIds("SELECT item_id, persona, at FROM agenda_lecturas WHERE item_id IN (?)", items.filter(it => it.tipo === "aviso").map(it => it.id));
    for (const it of items) if (it.tipo === "aviso") { it.lecturas = lect.filter(l => l.item_id === it.id); it.para = normalizarPara(it.para); it.autor = it.autor || "admin"; }
    // Informes de la tablet sobre las tareas
    const rep = (await deIds("SELECT * FROM agenda_reportes WHERE item_id IN (?)", items.filter(it => it.tipo === "tarea").map(it => it.id))).sort((a, b) => b.creado.localeCompare(a.creado));
    for (const it of items) if (it.tipo === "tarea") it.reportes = rep.filter(r => r.item_id === it.id);
    // Últimos pagos hechos de cada pago programado
    const pg = (await deIds("SELECT * FROM agenda_pagos WHERE item_id IN (?)", items.filter(it => it.tipo === "pago").map(it => it.id))).sort((a, b) => b.fecha.localeCompare(a.fecha) || b.creado.localeCompare(a.creado));
    for (const it of items) if (it.tipo === "pago") it.pagos = pg.filter(x => x.item_id === it.id).slice(0, 6).map(x => ({ id: x.id, fecha: x.fecha, importe: x.importe, forma: x.forma, comprobante: x.comprobante ? 1 : 0 }));
    const conteos = (await env.DB.prepare(`SELECT tipo, COUNT(*) n FROM agenda_items WHERE ${ABIERTO} GROUP BY tipo`).all()).results;
    // Avisos de los encargados para la administración que todavía no se leen en el panel
    const sinLeer = items.filter(it => it.tipo === "aviso" && it.estado === "activo" && it.autor !== "admin" && it.para.admin && !it.lecturas.some(l => l.persona === "ADMIN")).length;
    const pagosHechos = (await env.DB.prepare("SELECT p.id, p.item_id, p.fecha, p.programado, p.importe, p.forma, p.nota, p.comprobante, p.comp_tipo, p.creado, COALESCE(p.titulo, i.titulo) AS titulo, i.frecuencia FROM agenda_pagos p LEFT JOIN agenda_items i ON i.id = p.item_id WHERE p.fecha >= ? ORDER BY p.fecha DESC, p.creado DESC LIMIT 1500").bind(sumarMeses(hoyMx(), -13)).all()).results;
    const abiertosMes = (await mesesAbiertos(env).catch(() => []));
    return json({ ok: true, items, pagos_hechos: pagosHechos, meses_abiertos: abiertosMes, abiertos: Object.fromEntries(conteos.map(r => [r.tipo, r.n])), avisos_sin_leer: sinLeer, hoy: hoyMx(), estados: ESTADOS, frecuencias: FRECUENCIAS });
  }

  if (partes[1] === "resumen" && request.method === "GET") return json({ ok: true, ...(await resumenAgenda(env)) });
  // Pagos programados para el Inicio: próximos, vencidos, totales del mes y pagado por mes
  if (partes[1] === "pagos" && partes.length === 2 && request.method === "GET") {
    const hoy = hoyMx(), mes = hoy.slice(0, 7);
    const finMes = new Date(Date.UTC(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)), 0)).toISOString().slice(0, 10);
    const abiertos = (await env.DB.prepare(`SELECT id, titulo, fecha, importe, frecuencia, forma FROM agenda_items WHERE tipo = 'pago' AND ${ABIERTO} ORDER BY fecha`).all()).results;
    const hechos = (await env.DB.prepare("SELECT p.fecha, p.importe, COALESCE(p.titulo, i.titulo) AS titulo FROM agenda_pagos p LEFT JOIN agenda_items i ON i.id = p.item_id WHERE p.fecha >= ? ORDER BY p.fecha").bind(sumarMeses(mes + "-01", -5)).all()).results;
    const porMes = []; for (let k = 5; k >= 0; k--) { const m = sumarMeses(mes + "-01", -k).slice(0, 7); porMes.push({ mes: m, total: hechos.filter(x => x.fecha.slice(0, 7) === m).reduce((a, x) => a + x.importe, 0) }); }
    const delMes = hechos.filter(x => x.fecha.slice(0, 7) === mes);
    const conceptos = {}; for (const x of delMes) conceptos[x.titulo || "Otro"] = (conceptos[x.titulo || "Otro"] || 0) + x.importe;
    const pendMes = abiertos.filter(x => x.fecha && x.fecha <= finMes);
    return json({ ok: true, hoy, mes, proximos: abiertos.slice(0, 6), vencidos: abiertos.filter(x => x.fecha && x.fecha < hoy).length,
      por_pagar_mes: pendMes.reduce((a, x) => a + (x.importe || 0), 0), n_por_pagar_mes: pendMes.length,
      pagado_mes: delMes.reduce((a, x) => a + x.importe, 0), n_pagado_mes: delMes.length, por_mes: porMes,
      por_concepto: Object.entries(conceptos).map(([titulo, total]) => ({ titulo, total })).sort((a, b) => b.total - a.total) });
  }

  if (partes[1] === "pagos" && partes.length >= 3) return await pagosHechosRutas(request, env, partes, usuario, ahora);

  if (partes.length === 1 && request.method === "POST") {
    let c; try { c = await request.json(); } catch { return json({ ok: false, error: "Datos inválidos." }, 400); }
    const tipo = String(c.tipo || "");
    if (!TIPOS.includes(tipo)) return json({ ok: false, error: "Tipo inválido." }, 422);
    const { d, e } = validar(tipo, c);
    if (Object.keys(e).length) return json({ ok: false, error: "Revisa los datos.", errores: e }, 422);
    const id = crypto.randomUUID();
    await insertarItem(env, id, tipo, d, usuario && usuario.email || null, ahora);
    if (tipo === "pago") await env.DB.prepare("UPDATE agenda_items SET importe = ?, frecuencia = ?, forma = ? WHERE id = ?").bind(d.importe, d.frecuencia, d.forma, id).run();
    return json({ ok: true, id });
  }

  const id = partes[1];
  const fila = id ? await env.DB.prepare("SELECT * FROM agenda_items WHERE id = ?").bind(id).first() : null;
  if (!fila) return json({ ok: false, error: "No existe ese registro." }, 404);

  if (partes.length === 2 && request.method === "POST") {
    let c; try { c = await request.json(); } catch { return json({ ok: false, error: "Datos inválidos." }, 400); }
    const { d, e } = validar(fila.tipo, c, fila);
    if (Object.keys(e).length) return json({ ok: false, error: "Revisa los datos.", errores: e }, 422);
    const cerradoAhora = ["hecho", "comprado", "resuelta", "archivado", "pagado"].includes(d.estado);
    // Si cambia la fecha, la hora o el aviso, el recordatorio se vuelve a programar
    const reprogramar = d.fecha !== fila.fecha || d.hora !== fila.hora || d.aviso !== fila.aviso;
    // Compras: al confirmarla se captura el importe y se registra como gasto en Ingresos y gastos;
    // si se regresa a pendiente, ese gasto se borra.
    if (fila.tipo === "compra" && d.estado === "comprado" && fila.estado !== "comprado" && !fila.gasto_id) {
      const t = String(c.importe ?? "").replace(/[$,\s]/g, ""), importe = /^\d{1,9}(\.\d{1,2})?$/.test(t) ? Number(t) : NaN;
      const forma = ["EFECTIVO", "TARJETA", "TRANSFERENCIA"].includes(c.forma) ? c.forma : "EFECTIVO";
      if (!(importe > 0)) return json({ ok: false, error: "Escribe el importe de la compra.", errores: { importe: "Importe inválido." } }, 422);
      await asegurarEsquemaCaja(env);
      const { dia, turno } = turnoAhora();
      const gid = crypto.randomUUID();
      const concepto = ("Compra: " + d.titulo + (d.cantidad ? ` (${d.cantidad})` : "")).slice(0, 120);
      await env.DB.prepare("INSERT INTO caja_gastos (id, mes, dia, turno, concepto, monto, forma, creado, creado_por) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(gid, dia.slice(0, 7), dia, turno, concepto, importe, forma, ahora, usuario && usuario.email || null).run();
      await env.DB.prepare("UPDATE agenda_items SET importe = ?, gasto_id = ? WHERE id = ?").bind(importe, gid, id).run();
    } else if (fila.tipo === "compra" && d.estado !== "comprado" && fila.gasto_id) {
      await env.DB.prepare("DELETE FROM caja_gastos WHERE id = ?").bind(fila.gasto_id).run();
      await env.DB.prepare("UPDATE agenda_items SET importe = NULL, gasto_id = NULL WHERE id = ?").bind(id).run();
    }
    await env.DB.prepare(`UPDATE agenda_items SET titulo=?, detalle=?, fecha=?, hora=?, estado=?, prioridad=?, cantidad=?, turno=?, gravedad=?, actualizado=?, cerrado=?, aviso=?, avisado=?, para_turno=?, area=?, hecho_por=?, para=COALESCE(?, para) WHERE id=?`)
      .bind(d.titulo, d.detalle, d.fecha, d.hora, d.estado, d.prioridad, d.cantidad, d.turno, d.gravedad, ahora, cerradoAhora ? (fila.cerrado || ahora) : null, d.aviso, reprogramar ? null : fila.avisado, d.para_turno, d.area, cerradoAhora ? fila.hecho_por : null, fila.tipo === "aviso" && "para" in c ? d.para : null, id).run();
    if (fila.tipo === "pago") await env.DB.prepare("UPDATE agenda_items SET importe = ?, frecuencia = ?, forma = ? WHERE id = ?").bind(d.importe, d.frecuencia, d.forma, id).run();
    return json({ ok: true });
  }

  // Registrar un pago programado: fecha en que se pagó, importe y forma → gasto; el pago se mueve al siguiente periodo
  if (partes[2] === "pagar" && request.method === "POST" && fila.tipo === "pago") {
    let c; try { c = await request.json(); } catch { return json({ ok: false, error: "Datos inválidos." }, 400); }
    const v = await validarPagoHecho(env, c, fila);
    if (Object.keys(v.errores).length) return json({ ok: false, error: Object.values(v.errores).join(" "), errores: v.errores }, 422);
    const { fecha, importe, forma } = v;
    // Evita registrar dos veces el mismo periodo (por ejemplo, al corregir la fecha y volver a confirmar)
    if (!c.forzar) {
      const mesP = (fila.fecha || fecha).slice(0, 7);
      const dup = await env.DB.prepare("SELECT fecha, importe FROM agenda_pagos WHERE item_id = ? AND (substr(fecha, 1, 7) = ? OR substr(COALESCE(programado, ''), 1, 7) = ?) ORDER BY creado DESC LIMIT 1").bind(fila.id, fecha.slice(0, 7), mesP).first();
      if (dup) return json({ ok: false, duplicado: dup, error: `Ya registraste un pago de «${fila.titulo}» el ${dup.fecha} por $${Number(dup.importe).toFixed(2)}.` }, 409);
    }
    const gid = crypto.randomUUID(), pid = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO caja_gastos (id, mes, dia, turno, concepto, monto, forma, creado, creado_por) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(gid, fecha.slice(0, 7), fecha, turnoDe(fecha, c.turno), ("Pago: " + fila.titulo).slice(0, 120), importe, forma, ahora, usuario && usuario.email || null).run();
    await env.DB.prepare("INSERT INTO agenda_pagos (id, item_id, fecha, programado, importe, forma, gasto_id, creado, creado_por, titulo, nota) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(pid, fila.id, fecha, fila.fecha, importe, forma, gid, ahora, usuario && usuario.email || null, fila.titulo, v.nota).run();
    const meses_ = MESES_FREC[fila.frecuencia || "mensual"];
    if (!meses_) await env.DB.prepare("UPDATE agenda_items SET estado = 'pagado', cerrado = ?, actualizado = ? WHERE id = ?").bind(ahora, ahora, fila.id).run();
    else {
      // Siguiente vencimiento a partir de la fecha programada (si se pagó tarde no se recorre el calendario)
      const sig = sumarMeses(fila.fecha || fecha, meses_);
      await env.DB.prepare("UPDATE agenda_items SET fecha = ?, avisado = NULL, actualizado = ? WHERE id = ?").bind(sig, ahora, fila.id).run();
    }
    return json({ ok: true, gasto_id: gid, id: pid });
  }

  if (partes[2] === "eliminar" && request.method === "POST") {
    await borrarItems(env, [fila]);
    return json({ ok: true });
  }

  // La administración marca como leído un aviso de un encargado
  if (partes[2] === "enterado" && request.method === "POST" && fila.tipo === "aviso") {
    await env.DB.prepare("INSERT OR IGNORE INTO agenda_lecturas (item_id, persona, at) VALUES (?, 'ADMIN', ?)").bind(id, ahora).run();
    return json({ ok: true });
  }

  return json({ ok: false, error: "Ruta no encontrada." }, 404);
}

// ---------------------------------------------------------------------------
// Recordatorios por correo
// ---------------------------------------------------------------------------
// Hora de México (sin horario de verano desde 2022): UTC-6
const aUtc = (fecha, hora) => new Date(`${fecha}T${hora || "08:00"}:00-06:00`);
const fmtDia = new Intl.DateTimeFormat("es-MX", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
const diaTxt = f => fmtDia.format(new Date(f + "T12:00:00Z"));
const escHtml = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Cada 10 minutos: avisa de eventos y tareas cuya hora de aviso ya llegó
export async function recordatoriosAgenda(env, enviar, ahora = new Date()) {
  await asegurarEsquemaAgenda(env);
  const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(ahora);
  const manana = new Date(Date.parse(hoy + "T12:00:00Z") + 2 * 864e5).toISOString().slice(0, 10);
  const { results } = await env.DB.prepare(`SELECT * FROM agenda_items WHERE aviso > 0 AND avisado IS NULL AND tipo IN ('evento','tarea') AND ${ABIERTO} AND fecha <= ?`).bind(manana).all();
  let enviados = 0;
  for (const it of results) {
    const momento = aUtc(it.fecha, it.hora);
    const avisar = new Date(momento.getTime() - it.aviso * 60000);
    if (ahora < avisar) continue;
    // Si ya pasó más de una hora del evento, no se avisa tarde: se marca como avisado
    if (ahora.getTime() - momento.getTime() > 3600000) { await env.DB.prepare("UPDATE agenda_items SET avisado = ? WHERE id = ?").bind(ahora.toISOString(), it.id).run(); continue; }
    const cuando = `${diaTxt(it.fecha)}${it.hora ? " a las " + it.hora : ""}`;
    const que = it.tipo === "evento" ? "Evento" : "Tarea";
    try {
      await enviar(env, {
        asunto: `Recordatorio: ${it.titulo}`.slice(0, 180),
        texto: `${que}: ${it.titulo}\nCuándo: ${cuando}${it.detalle ? "\n\n" + it.detalle : ""}\n\nAgenda: https://basculaypension.com/panel#agenda`,
        html: `<div style="font-family:system-ui,sans-serif;font-size:15px"><p style="color:#666;margin:0">Recordatorio · ${que}</p><h2 style="margin:4px 0 8px">${escHtml(it.titulo)}</h2><p style="margin:0 0 12px"><b>${escHtml(cuando)}</b></p>${it.detalle ? `<p>${escHtml(it.detalle)}</p>` : ""}<p><a href="https://basculaypension.com/panel#agenda">Abrir la agenda</a></p></div>`
      });
      await env.DB.prepare("UPDATE agenda_items SET avisado = ? WHERE id = ?").bind(ahora.toISOString(), it.id).run();
      enviados++;
    } catch (e) { console.error("recordatorio agenda", e && e.message); }
  }
  return enviados;
}

// Cada mañana: resumen del día (solo si hay algo)
export async function resumenDiarioAgenda(env, enviar) {
  const r = await resumenAgenda(env);
  const hoy = r.hoy;
  const eventosHoy = (await env.DB.prepare(`SELECT * FROM agenda_items WHERE tipo = 'evento' AND fecha = ? AND ${ABIERTO} ORDER BY hora`).bind(hoy).all()).results;
  const tareasHoy = (await env.DB.prepare(`SELECT * FROM agenda_items WHERE tipo = 'tarea' AND ${ABIERTO} AND fecha <= ? ORDER BY fecha`).bind(hoy).all()).results;
  const compras = (await env.DB.prepare(`SELECT * FROM agenda_items WHERE tipo = 'compra' AND ${ABIERTO} ORDER BY CASE prioridad WHEN 'alta' THEN 0 ELSE 1 END, creado`).all()).results;
  const incid = (await env.DB.prepare(`SELECT * FROM agenda_items WHERE tipo = 'incidencia' AND ${ABIERTO} ORDER BY CASE gravedad WHEN 'grave' THEN 0 WHEN 'media' THEN 1 ELSE 2 END`).all()).results;
  const en3 = new Date(Date.parse(hoy + "T12:00:00Z") + 3 * 864e5).toISOString().slice(0, 10);
  const pagos = (await env.DB.prepare(`SELECT * FROM agenda_items WHERE tipo = 'pago' AND ${ABIERTO} AND fecha <= ? ORDER BY fecha`).bind(en3).all()).results;
  if (!eventosHoy.length && !tareasHoy.length && !compras.length && !incid.length && !pagos.length) return false;
  const sec = (t, filas, f) => filas.length ? `${t}\n${filas.map(x => "• " + f(x)).join("\n")}\n\n` : "";
  const secH = (t, filas, f) => filas.length ? `<h3 style="margin:18px 0 6px">${t}</h3><ul style="margin:0;padding-left:18px">${filas.map(x => `<li>${f(x)}</li>`).join("")}</ul>` : "";
  const ev = x => `${x.hora ? x.hora + " · " : ""}${x.titulo}`;
  const ta = x => `${x.titulo}${x.fecha < hoy ? " (vencida " + x.fecha + ")" : ""}`;
  const co = x => `${x.titulo}${x.cantidad ? " · " + x.cantidad : ""}${x.prioridad === "alta" ? " (urgente)" : ""}`;
  const inc = x => `${x.titulo} · ${x.gravedad}${x.estado === "en_proceso" ? " · en proceso" : ""}`;
  const pa = x => `${x.titulo}${x.importe ? " · aprox. $" + Number(x.importe).toLocaleString("es-MX", { minimumFractionDigits: 2 }) : ""} · ${x.fecha < hoy ? "vencido desde " + x.fecha : x.fecha === hoy ? "vence hoy" : "vence " + x.fecha}`;
  await enviar(env, {
    asunto: `Agenda de hoy · ${diaTxt(hoy)}`,
    texto: `Agenda de hoy, ${diaTxt(hoy)}\n\n` + sec("Eventos de hoy", eventosHoy, ev) + sec("Por hacer (hoy o vencidas)", tareasHoy, ta) + sec("Pagos por hacer (vencidos o en los próximos 3 días)", pagos, pa) + sec("Compras pendientes", compras, co) + sec("Incidencias abiertas", incid, inc) + "Agenda: https://basculaypension.com/panel#agenda",
    html: `<div style="font-family:system-ui,sans-serif;font-size:15px"><h2 style="margin:0 0 4px">Agenda de hoy</h2><p style="color:#666;margin:0">${escHtml(diaTxt(hoy))}</p>`
      + secH("Eventos de hoy", eventosHoy, x => escHtml(ev(x))) + secH("Por hacer (hoy o vencidas)", tareasHoy, x => escHtml(ta(x)))
      + secH("Pagos por hacer (vencidos o en los próximos 3 días)", pagos, x => escHtml(pa(x))) + secH("Compras pendientes", compras, x => escHtml(co(x))) + secH("Incidencias abiertas", incid, x => escHtml(inc(x)))
      + `<p style="margin-top:18px"><a href="https://basculaypension.com/panel#agenda">Abrir la agenda</a></p></div>`
  });
  return true;
}
