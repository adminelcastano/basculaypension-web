import { leerArchivo, borrarArchivo, guardarArchivo } from "./fotos.js";
import { asegurarEsquemaCaja, mesesAbiertos } from "./caja.js";
import { asegurarEsquemaCategorias, resolverCategoria, adivinarCategoria, listaCategorias } from "./categorias.js";
import { asegurarEsquemaCuentas, leerMedio, cuentaDefecto, listaCuentas } from "./cuentas.js";
import { stmtBitacora } from "./bitacora.js";
import { notificar, enviarPush } from "./push.js";
const enviarPushSeguro = (env, msg) => enviarPush(env, "admin", msg).catch(e => { console.error("push", e && e.message); return 0; });
// "Pagado con" llega como EFECTIVO o C:<cuenta>: se separa en forma (EFECTIVO/TRANSFERENCIA/TARJETA) y cuenta
async function normalizarMedio(env, c) {
  if (!c || typeof c.forma !== "string") return;
  const m = await leerMedio(env, c.forma, null);
  if (m) { c.forma = m.forma; c.cuenta = m.cuenta; }
}
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
  for (const [c, t] of [["para_turno", "INTEGER"], ["reporto", "TEXT"], ["foto", "TEXT"], ["hecho_por", "TEXT"], ["nota_cierre", "TEXT"], ["area", "TEXT"], ["autor", "TEXT"], ["para", "TEXT"], ["quien", "TEXT"], ["importe", "REAL"], ["gasto_id", "TEXT"], ["frecuencia", "TEXT"], ["forma", "TEXT"], ["fotos", "TEXT"], ["repetir", "TEXT"], ["sig_id", "TEXT"], ["lugar", "TEXT"], ["pospuesta", "INTEGER"]])
    if (!cols.has(c)) await env.DB.prepare(`ALTER TABLE agenda_items ADD COLUMN ${c} ${t}`).run();
  // Historial de pagos hechos de cada pago programado (cada uno con su egreso de administración)
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
    quien: tipo === "incidencia" && v("quien") ? texto(v("quien"), 60) : null,
    repetir: tipo === "tarea" && REPETIR[v("repetir")] ? v("repetir") : null
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
  if (d.repetir && !d.fecha) e.fecha = "Para repetirla, elige el día en que empieza.";
  return { d, e };
}

// Lugares donde se compra (los define la administración; la tablet no elige). Se crean los más comunes la primera vez.
const LUGARES_INICIALES = ["Office Depot", "Home Depot", "Compusistemas", "Fix", "Liverpool", "Gasolinera", "Gasera", "Supermercado"];
let lugaresListos = false;
export async function asegurarLugares(env) {
  if (lugaresListos) return;
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS compra_lugares (id TEXT PRIMARY KEY, nombre TEXT NOT NULL, orden INTEGER DEFAULT 0, creado TEXT)").run();
  const n = await env.DB.prepare("SELECT COUNT(*) n FROM compra_lugares").first();
  if (!n || !n.n) {
    const ahora = new Date().toISOString();
    await env.DB.batch(LUGARES_INICIALES.map((x, i) => env.DB.prepare("INSERT OR IGNORE INTO compra_lugares (id, nombre, orden, creado) VALUES (?, ?, ?, ?)").bind(claveLugar(x), x, i + 1, ahora)));
  }
  lugaresListos = true;
}
const claveLugar = n => String(n).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
export async function listaLugares(env) {
  await asegurarLugares(env);
  return (await env.DB.prepare("SELECT id, nombre, orden FROM compra_lugares ORDER BY orden, nombre").all()).results;
}
// Si lo mismo ya se compró antes en un lugar, la compra nueva va a ese lugar
const normTitulo = t => String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
export async function lugarSugerido(env, titulo) {
  await asegurarLugares(env);
  const previas = (await env.DB.prepare("SELECT titulo, lugar FROM agenda_items WHERE tipo = 'compra' AND lugar IS NOT NULL ORDER BY actualizado DESC LIMIT 400").all()).results;
  const t = normTitulo(titulo), f = previas.find(x => normTitulo(x.titulo) === t);
  return f ? f.lugar : null;
}

// Tareas que se repiten: al cumplirse se crea la siguiente (un día, una semana o un mes después, nunca en el pasado)
export const REPETIR = { diaria: "Diario", semanal: "Cada semana", mensual: "Cada mes" };
export function siguienteFecha(fecha, repetir, hoy) {
  const sumar = f => {
    const d = new Date(f + "T12:00:00Z");
    if (repetir === "diaria") d.setUTCDate(d.getUTCDate() + 1);
    else if (repetir === "semanal") d.setUTCDate(d.getUTCDate() + 7);
    else { const dia = +fecha.slice(8, 10); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + 1); const fin = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate(); d.setUTCDate(Math.min(dia, fin)); }
    return d.toISOString().slice(0, 10);
  };
  let f = sumar(fecha);
  for (let i = 0; f <= hoy && i < 400; i++) f = sumar(f);
  return f;
}
export async function repetirTarea(env, id, ahora = new Date().toISOString()) {
  const t = await env.DB.prepare("SELECT * FROM agenda_items WHERE id = ? AND tipo = 'tarea'").bind(id).first();
  if (!t || !REPETIR[t.repetir] || !t.fecha || t.sig_id) return null;
  const nid = crypto.randomUUID(), fecha = siguienteFecha(t.fecha, t.repetir, hoyMx());
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO agenda_items (id, tipo, titulo, detalle, fecha, hora, estado, prioridad, turno, creado, creado_por, actualizado, aviso, para_turno, repetir)
      VALUES (?, 'tarea', ?, ?, ?, ?, 'pendiente', ?, ?, ?, ?, ?, ?, ?, ?)`).bind(nid, t.titulo, t.detalle, fecha, t.hora, t.prioridad, t.turno, ahora, t.creado_por, ahora, t.aviso, t.para_turno || 0, t.repetir),
    env.DB.prepare("UPDATE agenda_items SET sig_id = ? WHERE id = ?").bind(nid, id)
  ]);
  return { id: nid, fecha };
}

const ABIERTO = "estado NOT IN ('hecho','comprado','resuelta','archivado','pagado')";

// Notificación a la tablet por un aviso o una tarea del turno creados en el panel (null si no va a los encargados)
const TURNO_TXT = { "MAÑANA": "la mañana", TARDE: "la tarde", NOCHE: "la noche" };
export function pushTablet(tipo, d, id) {
  const urgente = d.prioridad === "alta";
  const det = d.detalle ? "\n" + d.detalle : "";
  if (tipo === "aviso") {
    const p = normalizarPara(d.para);
    if (!p.todos && !p.turnos.length && !p.personas.length) return null; // solo para la administración
    const para = p.todos ? "" : "\nPara: " + [...p.turnos.map(t => "turno de " + (TURNO_TXT[t] || t.toLowerCase())), ...p.personas].join(", ");
    return { titulo: urgente ? "Aviso urgente de la administración" : "Aviso de la administración", cuerpo: d.titulo + det + para, sec: "avisos", url: "/turno?sec=avisos", etiqueta: "aviso-" + id, grave: urgente };
  }
  if (tipo === "tarea" && d.para_turno) {
    const futura = d.fecha && d.fecha > hoyMx();
    return { titulo: `${futura ? `Tarea programada para el ${d.fecha.slice(8, 10)}/${d.fecha.slice(5, 7)}` : urgente ? "Tarea urgente" : "Nueva tarea"}${d.turno ? " · turno de " + (TURNO_TXT[d.turno] || d.turno.toLowerCase()) : ""}`, cuerpo: d.titulo + det + (d.repetir ? "\n🔁 " + REPETIR[d.repetir] : ""), sec: futura ? "calendario" : "avisos", url: "/turno?sec=" + (futura ? "calendario" : "avisos"), etiqueta: "tarea-" + id, grave: urgente };
  }
  return null;
}

export async function insertarItem(env, id, tipo, d, creadoPor, ahora, extra = {}) {
  await env.DB.prepare(`INSERT INTO agenda_items (id, tipo, titulo, detalle, fecha, hora, estado, prioridad, cantidad, turno, gravedad, creado, creado_por, actualizado, aviso, para_turno, area, reporto, foto, autor, para, quien)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, tipo, d.titulo, d.detalle, d.fecha, d.hora, d.estado, d.prioridad, d.cantidad, d.turno, d.gravedad, ahora, creadoPor, ahora, d.aviso, d.para_turno || 0, d.area || null, extra.reporto || null, extra.foto || null,
      extra.autor || (tipo === "aviso" ? "admin" : null), d.para || null, d.quien || null).run();
}
// Fotos de una incidencia (varias): llegan como data URL ya comprimidas en el navegador.
// foto = la primera (la que ve la tablet); fotos = todas (JSON con las llaves).
const FOTO_INC_MAX = 1_500_000, FOTOS_INC_MAX = 8;
export const listaFotos = it => { let l = []; try { l = JSON.parse(it.fotos || "[]"); } catch {} if (!Array.isArray(l)) l = []; if (it.foto && !l.includes(it.foto)) l.unshift(it.foto); return l; };
async function guardarFotosInc(env, lista, titulo) {
  const llaves = [];
  for (const [i, u] of (Array.isArray(lista) ? lista : []).entries()) {
    const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(u || ""));
    if (!m) throw new Error("Una de las fotos no es válida (usa JPG o PNG).");
    const bin = atob(m[2]);
    if (bin.length > FOTO_INC_MAX || bin.length < 500) throw new Error("Una de las fotos es demasiado grande o está vacía.");
    const bytes = new Uint8Array(bin.length); for (let k = 0; k < bin.length; k++) bytes[k] = bin.charCodeAt(k);
    const llave = `tf:inc:${crypto.randomUUID()}`;
    // Igual que las fotos de la tablet: primero en KV; la tarea programada las pasa a Drive
    await env.FILES.put(llave, bytes, { metadata: { tipo: "image/" + m[1], nombre: `Incidencia ${String(titulo || "").slice(0, 60)} ${i + 1}.${m[1] === "jpeg" ? "jpg" : m[1]}` } });
    llaves.push(llave);
  }
  return llaves;
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
  for (const v of items) for (const f of listaFotos(v)) await borrarArchivo(env, f).catch(() => {});
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
  const viejos = (await env.DB.prepare(`SELECT id, foto, fotos FROM agenda_items
    WHERE (NOT (${ABIERTO}) AND COALESCE(cerrado, actualizado, creado) < ?)
       OR (tipo = 'evento' AND fecha < ?) LIMIT 500`).bind(limite, diaLimite).all()).results;
  if (!viejos.length) return 0;
  await borrarItems(env, viejos);
  return viejos.length;
}

// Resumen para el Inicio
// Avisos de los encargados para la administración que todavía no se leen en el panel (para Hoy)
export async function avisosSinLeer(env) {
  await asegurarEsquemaAgenda(env);
  const filas = (await env.DB.prepare(`SELECT i.id, i.titulo, i.autor, i.para, i.creado, i.prioridad FROM agenda_items i WHERE i.tipo = 'aviso' AND i.estado = 'activo' AND COALESCE(i.autor, 'admin') != 'admin'
    AND NOT EXISTS (SELECT 1 FROM agenda_lecturas l WHERE l.item_id = i.id AND l.persona = 'ADMIN') ORDER BY i.creado DESC LIMIT 50`).all()).results;
  return filas.filter(f => normalizarPara(f.para).admin).map(({ para, ...f }) => f);
}

export async function resumenAgenda(env) {
  await asegurarEsquemaAgenda(env);
  const hoy = hoyMx();
  const conteos = (await env.DB.prepare(`SELECT tipo, COUNT(*) n FROM agenda_items WHERE ${ABIERTO} GROUP BY tipo`).all()).results;
  const c = Object.fromEntries(TIPOS.map(t => [t, 0])); for (const r of conteos) c[r.tipo] = r.n;
  const proximos = (await env.DB.prepare(`SELECT * FROM agenda_items WHERE tipo = 'evento' AND ${ABIERTO} AND fecha >= ? ORDER BY fecha, hora LIMIT 5`).bind(hoy).all()).results;
  const tareas = (await env.DB.prepare(`SELECT * FROM agenda_items WHERE tipo = 'tarea' AND ${ABIERTO} ORDER BY CASE prioridad WHEN 'alta' THEN 0 ELSE 1 END, COALESCE(fecha, '9999'), creado LIMIT 4`).all()).results;
  const compras = (await env.DB.prepare(`SELECT * FROM agenda_items WHERE tipo = 'compra' AND ${ABIERTO} ORDER BY CASE prioridad WHEN 'alta' THEN 0 ELSE 1 END, creado LIMIT 4`).all()).results;
  // Compras que pidieron los encargados desde la tablet (con quién y cuándo)
  const comprasTablet = (await env.DB.prepare(`SELECT id, titulo, cantidad, prioridad, reporto, turno, creado FROM agenda_items WHERE tipo = 'compra' AND reporto IS NOT NULL AND ${ABIERTO} ORDER BY CASE prioridad WHEN 'alta' THEN 0 ELSE 1 END, creado LIMIT 20`).all()).results;
  const incidencias = (await env.DB.prepare(`SELECT * FROM agenda_items WHERE tipo = 'incidencia' AND ${ABIERTO} ORDER BY CASE gravedad WHEN 'grave' THEN 0 WHEN 'media' THEN 1 ELSE 2 END, fecha DESC LIMIT 4`).all()).results;
  const vencidas = (await env.DB.prepare(`SELECT COUNT(*) n FROM agenda_items WHERE tipo = 'tarea' AND ${ABIERTO} AND fecha < ?`).bind(hoy).first()).n;
  const eventosHoy = (await env.DB.prepare(`SELECT COUNT(*) n FROM agenda_items WHERE tipo = 'evento' AND fecha = ?`).bind(hoy).first()).n;
  const pagos = (await env.DB.prepare(`SELECT * FROM agenda_items WHERE tipo = 'pago' AND ${ABIERTO} ORDER BY fecha LIMIT 4`).all()).results;
  const avisos = (await env.DB.prepare(`SELECT * FROM agenda_items WHERE tipo = 'aviso' AND ${ABIERTO} ORDER BY creado DESC LIMIT 4`).all()).results.map(a => ({ ...a, autor: a.autor || "admin" }));
  return { hoy, abiertos: c, vencidas, eventos_hoy: eventosHoy, proximos, tareas, compras, compras_tablet: comprasTablet, incidencias, pagos, avisos };
}

// ---- Pagos hechos (de un pago programado o sueltos) ----
// Cada pago hecho crea su egreso de administración (origen 'admin', sin turno); se puede corregir o borrar mientras su mes siga abierto.
async function validarPagoHecho(env, c, fila) {
  const fecha = String(c.fecha || ""), importe = leerMonto(c.importe);
  const forma = FORMAS.includes(c.forma) ? c.forma : (fila && fila.forma) || "TRANSFERENCIA";
  const errores = {};
  await asegurarEsquemaCaja(env);
  const meses = await mesesAbiertos(env);
  if (!RE_DIA.test(fecha) || fecha > hoyMx()) errores.fecha = "Escribe la fecha en que se pagó (no futura).";
  else if (!meses.includes(fecha.slice(0, 7))) errores.fecha = "Ese mes ya se cerró; usa una fecha del mes abierto.";
  if (!(importe > 0) || importe > 1000000) errores.importe = "Escribe el importe pagado.";
  const titulo = texto(c.titulo, 140);
  if (!fila && titulo.length < 2) errores.titulo = "Escribe qué pagaste (ej. Recibo de luz CFE).";
  const nota = texto(c.nota, 300) || null;
  return { fecha, importe, forma, titulo, nota, errores, meses };
}
// Pagos, compras y otros gastos de la administración: salen de los sobres (efectivo) o del banco, no de la caja
// de ningún turno, así que no llevan turno y no cuentan en los cortes (origen = 'admin').
const GASTO_ADMIN = "INSERT INTO caja_gastos (id, mes, dia, turno, concepto, monto, forma, creado, creado_por, origen, categoria, cuenta) VALUES (?, ?, ?, '', ?, ?, ?, ?, ?, 'admin', ?, ?)";
// Cuenta del pago: la elegida; si no se eligió y no es en efectivo, la de antes o la cuenta por defecto para pagos
// Con tarjeta sin elegir cuál, no se adivina: queda "sin cuenta" y Finanzas lo avisa (antes caía en la cuenta de débito por defecto)
const cuentaDe = async (env, c, previo, forma) => forma === "EFECTIVO" ? null : ("cuenta" in c ? c.cuenta : null) || previo || (forma === "TARJETA" ? null : await cuentaDefecto(env, "pago"));
const TIPOS_COMP = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/pdf"];

async function pagosHechosRutas(request, env, partes, usuario, ahora) {
  // Pago hecho sin programar
  if (partes[2] === "hecho" && partes.length === 3 && request.method === "POST") {
    let c; try { c = await request.json(); } catch { return json({ ok: false, error: "Datos inválidos." }, 400); }
    await normalizarMedio(env, c);
    const v = await validarPagoHecho(env, c, null);
    if (Object.keys(v.errores).length) return json({ ok: false, error: Object.values(v.errores).join(" "), errores: v.errores }, 422);
    const gid = crypto.randomUUID(), pid = crypto.randomUUID();
    const cat = (await resolverCategoria(env, c.categoria)) || adivinarCategoria(v.titulo);
    const cta = await cuentaDe(env, c, null, v.forma), quien = usuario && usuario.email || null;
    // Egreso y pago en una sola operación: o quedan los dos o ninguno
    await env.DB.batch([
      env.DB.prepare(GASTO_ADMIN).bind(gid, v.fecha.slice(0, 7), v.fecha, ("Pago: " + v.titulo).slice(0, 120), v.importe, v.forma, ahora, quien, cat, cta),
      env.DB.prepare("INSERT INTO agenda_pagos (id, item_id, fecha, programado, importe, forma, gasto_id, creado, creado_por, titulo, nota, categoria, cuenta) VALUES (?, '', ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(pid, v.fecha, v.importe, v.forma, gid, ahora, quien, v.titulo, v.nota, cat, cta),
      stmtBitacora(env, { quien, accion: "crear", que: "Pago no programado", ref: pid, mes: v.fecha.slice(0, 7), detalle: { fecha: v.fecha, concepto: v.titulo, importe: v.importe, forma: v.forma, cuenta: cta, categoria: cat } })
    ]);
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
  if (!meses.includes(pago.fecha.slice(0, 7))) return json({ ok: false, error: "Ese pago es de un mes ya cerrado; ya no se puede cambiar." }, 409);

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
    await normalizarMedio(env, c);
    const v = await validarPagoHecho(env, { ...c, titulo: c.titulo ?? pago.titulo }, pago.item_id ? pago : null);
    if (Object.keys(v.errores).length) return json({ ok: false, error: Object.values(v.errores).join(" "), errores: v.errores }, 422);
    const titulo = pago.item_id ? pago.titulo : v.titulo;
    const cat = (await resolverCategoria(env, c.categoria)) || pago.categoria || adivinarCategoria(titulo);
    const cta = await cuentaDe(env, c, pago.cuenta, v.forma);
    const st = [env.DB.prepare("UPDATE agenda_pagos SET fecha = ?, importe = ?, forma = ?, nota = ?, titulo = ?, categoria = ?, cuenta = ? WHERE id = ?").bind(v.fecha, v.importe, v.forma, v.nota, titulo, cat, cta, pago.id)];
    if (pago.gasto_id) st.push(env.DB.prepare("UPDATE caja_gastos SET mes = ?, dia = ?, monto = ?, forma = ?, concepto = ?, categoria = ?, cuenta = ? WHERE id = ?").bind(v.fecha.slice(0, 7), v.fecha, v.importe, v.forma, ("Pago: " + titulo).slice(0, 120), cat, cta, pago.gasto_id));
    st.push(stmtBitacora(env, { quien: usuario && usuario.email, accion: "editar", que: pago.item_id ? "Pago programado" : "Pago no programado", ref: pago.id, mes: v.fecha.slice(0, 7),
      detalle: { concepto: titulo, antes: { fecha: pago.fecha, importe: pago.importe, forma: pago.forma, cuenta: pago.cuenta, categoria: pago.categoria }, ahora: { fecha: v.fecha, importe: v.importe, forma: v.forma, cuenta: cta, categoria: cat } } }));
    await env.DB.batch(st);
    return json({ ok: true });
  }
  if (accion === "eliminar") {
    // Pago, su egreso y (si era el último de un pago programado) el regreso del vencimiento, en una sola operación
    const st = [];
    if (pago.gasto_id) st.push(env.DB.prepare("DELETE FROM caja_gastos WHERE id = ?").bind(pago.gasto_id));
    st.push(env.DB.prepare("DELETE FROM agenda_pagos WHERE id = ?").bind(pago.id));
    let regreso = null;
    if (pago.item_id && pago.programado) {
      const it = await env.DB.prepare("SELECT * FROM agenda_items WHERE id = ?").bind(pago.item_id).first();
      const otro = await env.DB.prepare("SELECT 1 FROM agenda_pagos WHERE item_id = ? AND creado > ? LIMIT 1").bind(pago.item_id, pago.creado).first();
      if (it && !otro) {
        const n = MESES_FREC[it.frecuencia || "mensual"];
        if (!n && it.estado === "pagado") { st.push(env.DB.prepare("UPDATE agenda_items SET estado = 'pendiente', cerrado = NULL, fecha = ?, actualizado = ? WHERE id = ?").bind(pago.programado, ahora, it.id)); regreso = pago.programado; }
        else if (n && it.fecha === sumarMeses(pago.programado, n)) { st.push(env.DB.prepare("UPDATE agenda_items SET fecha = ?, avisado = NULL, actualizado = ? WHERE id = ?").bind(pago.programado, ahora, it.id)); regreso = pago.programado; }
      }
    }
    st.push(stmtBitacora(env, { quien: usuario && usuario.email, accion: "borrar", que: pago.item_id ? "Pago programado" : "Pago no programado", ref: pago.id, mes: pago.fecha.slice(0, 7), detalle: { concepto: pago.titulo, fecha: pago.fecha, importe: pago.importe, forma: pago.forma, cuenta: pago.cuenta } }));
    await env.DB.batch(st);
    if (pago.comprobante) await borrarArchivo(env, pago.comprobante).catch(() => {});
    return json({ ok: true, regreso });
  }
  return json({ ok: false, error: "Ruta no encontrada." }, 404);
}

// Rutas: /panel/api/agenda...
export async function agendaPanel(request, env, url, partes, usuario) {
  await asegurarEsquemaAgenda(env);
  await asegurarEsquemaCaja(env);
  await asegurarEsquemaCategorias(env);
  await asegurarEsquemaCuentas(env);
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
    const pagosHechos = (await env.DB.prepare("SELECT p.id, p.item_id, p.fecha, p.programado, p.importe, p.forma, p.nota, p.comprobante, p.comp_tipo, p.creado, p.categoria, p.cuenta, COALESCE(p.titulo, i.titulo) AS titulo, i.frecuencia FROM agenda_pagos p LEFT JOIN agenda_items i ON i.id = p.item_id WHERE p.fecha >= ? ORDER BY p.fecha DESC, p.creado DESC LIMIT 1500").bind(sumarMeses(hoyMx(), -13)).all()).results;
    const abiertosMes = (await mesesAbiertos(env).catch(() => []));
    // Forma de pago de las compras ya compradas (está en su egreso)
    const gc = await deIds("SELECT id, forma, cuenta FROM caja_gastos WHERE id IN (?)", items.filter(it => it.tipo === "compra" && it.gasto_id).map(it => it.gasto_id));
    for (const it of items) if (it.tipo === "compra" && it.gasto_id) { const g = gc.find(x => x.id === it.gasto_id); it.forma_gasto = g ? g.forma : null; it.cuenta_gasto = g ? g.cuenta : null; }
    return json({ ok: true, items, pagos_hechos: pagosHechos, categorias: await listaCategorias(env), cuentas: await listaCuentas(env), meses_abiertos: abiertosMes, abiertos: Object.fromEntries(conteos.map(r => [r.tipo, r.n])), avisos_sin_leer: sinLeer, hoy: hoyMx(), estados: ESTADOS, frecuencias: FRECUENCIAS, lugares: await listaLugares(env) });
  }

  // Lugares de compra: agregar, renombrar, quitar (las compras de un lugar quitado quedan "sin lugar")
  if (partes[1] === "lugares" && request.method === "POST") {
    let c; try { c = await request.json(); } catch { return json({ ok: false, error: "Datos inválidos." }, 400); }
    await asegurarLugares(env);
    const nombre = texto(c.nombre, 40);
    if (partes.length === 2) {
      const id = claveLugar(nombre);
      if (nombre.length < 2 || !id) return json({ ok: false, error: "Escribe el nombre del lugar." }, 422);
      if (await env.DB.prepare("SELECT 1 FROM compra_lugares WHERE id = ?").bind(id).first()) return json({ ok: false, error: "Ese lugar ya existe." }, 409);
      const ord = await env.DB.prepare("SELECT COALESCE(MAX(orden), 0) + 1 o FROM compra_lugares").first();
      await env.DB.prepare("INSERT INTO compra_lugares (id, nombre, orden, creado) VALUES (?, ?, ?, ?)").bind(id, nombre, ord.o, ahora).run();
      return json({ ok: true, id, lugares: await listaLugares(env) });
    }
    const l = await env.DB.prepare("SELECT * FROM compra_lugares WHERE id = ?").bind(partes[2]).first();
    if (!l) return json({ ok: false, error: "Ese lugar ya no existe." }, 404);
    if (partes[3] === "quitar") {
      await env.DB.batch([env.DB.prepare("UPDATE agenda_items SET lugar = NULL WHERE tipo = 'compra' AND lugar = ?").bind(l.id), env.DB.prepare("DELETE FROM compra_lugares WHERE id = ?").bind(l.id)]);
      return json({ ok: true, lugares: await listaLugares(env) });
    }
    if (partes[3] === "nombre") {
      if (nombre.length < 2) return json({ ok: false, error: "Escribe el nombre del lugar." }, 422);
      await env.DB.prepare("UPDATE compra_lugares SET nombre = ? WHERE id = ?").bind(nombre, l.id).run();
      return json({ ok: true, lugares: await listaLugares(env) });
    }
  }
  // Cambiar el lugar de una compra
  if (partes.length === 3 && partes[2] === "lugar" && request.method === "POST") {
    let c; try { c = await request.json(); } catch { return json({ ok: false, error: "Datos inválidos." }, 400); }
    const it = await env.DB.prepare("SELECT id FROM agenda_items WHERE id = ? AND tipo = 'compra'").bind(partes[1]).first();
    if (!it) return json({ ok: false, error: "Esa compra ya no existe." }, 404);
    const lugar = c.lugar ? String(c.lugar) : null;
    if (lugar && !(await listaLugares(env)).some(l => l.id === lugar)) return json({ ok: false, error: "Lugar inválido." }, 422);
    await env.DB.prepare("UPDATE agenda_items SET lugar = ?, actualizado = ? WHERE id = ?").bind(lugar, ahora, it.id).run();
    return json({ ok: true });
  }

  // Compra dejada para otra ocasión: sigue pendiente en su lugar, pero aparte de lo que hay que comprar en esta visita
  if (partes.length === 3 && partes[2] === "posponer" && request.method === "POST") {
    let c; try { c = await request.json(); } catch { return json({ ok: false, error: "Datos inválidos." }, 400); }
    const it = await env.DB.prepare(`SELECT id FROM agenda_items WHERE id = ? AND tipo = 'compra' AND ${ABIERTO}`).bind(partes[1]).first();
    if (!it) return json({ ok: false, error: "Esa compra ya no está pendiente." }, 404);
    await env.DB.prepare("UPDATE agenda_items SET pospuesta = ?, actualizado = ? WHERE id = ?").bind(c.v ? 1 : null, ahora, it.id).run();
    return json({ ok: true });
  }

  if (partes[1] === "resumen" && request.method === "GET") return json({ ok: true, ...(await resumenAgenda(env)) });
  // Pagos programados para el Inicio: próximos, vencidos, totales del mes y pagado por mes
  if (partes[1] === "pagos" && partes.length === 2 && request.method === "GET") {
    const hoy = hoyMx(), mes = hoy.slice(0, 7);
    const finMes = new Date(Date.UTC(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)), 0)).toISOString().slice(0, 10);
    const abiertos = (await env.DB.prepare(`SELECT id, titulo, fecha, importe, frecuencia, forma, categoria FROM agenda_items WHERE tipo = 'pago' AND ${ABIERTO} ORDER BY fecha`).all()).results;
    const hechos = (await env.DB.prepare("SELECT p.fecha, p.importe, COALESCE(p.titulo, i.titulo) AS titulo FROM agenda_pagos p LEFT JOIN agenda_items i ON i.id = p.item_id WHERE p.fecha >= ? ORDER BY p.fecha").bind(sumarMeses(mes + "-01", -5)).all()).results;
    const porMes = []; for (let k = 5; k >= 0; k--) { const m = sumarMeses(mes + "-01", -k).slice(0, 7); porMes.push({ mes: m, total: hechos.filter(x => x.fecha.slice(0, 7) === m).reduce((a, x) => a + x.importe, 0) }); }
    const delMes = hechos.filter(x => x.fecha.slice(0, 7) === mes);
    const conceptos = {}; for (const x of delMes) conceptos[x.titulo || "Otro"] = (conceptos[x.titulo || "Otro"] || 0) + x.importe;
    // Egresos de la administración del mes por categoría (pagos y compras), con su icono y color
    const cats = Object.fromEntries((await listaCategorias(env)).map(c => [c.nombre, c]));
    const porCat = {};
    for (const g of (await env.DB.prepare("SELECT categoria, monto FROM caja_gastos WHERE origen = 'admin' AND mes = ?").bind(mes).all()).results) { const k = g.categoria || "Otros"; porCat[k] = (porCat[k] || 0) + g.monto; }
    // Pagos no programados del mes (concepto e importe)
    const noProg = (await env.DB.prepare("SELECT id, titulo, fecha, importe, categoria FROM agenda_pagos WHERE item_id = '' AND substr(fecha, 1, 7) = ? ORDER BY fecha DESC, creado DESC").bind(mes).all()).results;
    const pendMes = abiertos.filter(x => x.fecha && x.fecha <= finMes);
    return json({ ok: true, hoy, mes, proximos: abiertos.slice(0, 6), vencidos: abiertos.filter(x => x.fecha && x.fecha < hoy).length,
      por_pagar_mes: pendMes.reduce((a, x) => a + (x.importe || 0), 0), n_por_pagar_mes: pendMes.length,
      pagado_mes: delMes.reduce((a, x) => a + x.importe, 0), n_pagado_mes: delMes.length, por_mes: porMes,
      por_concepto: Object.entries(conceptos).map(([titulo, total]) => ({ titulo, total })).sort((a, b) => b.total - a.total),
      por_categoria: Object.entries(porCat).map(([nombre, total]) => ({ nombre, total: Math.round(total * 100) / 100, icono: (cats[nombre] || {}).icono || "otros", color: (cats[nombre] || {}).color || "#8e8e93" })).sort((a, b) => b.total - a.total),
      no_programados: noProg, n_no_programados: noProg.length, total_no_programados: noProg.reduce((a, x) => a + x.importe, 0) });
  }

  if (partes[1] === "pagos" && partes.length >= 3) return await pagosHechosRutas(request, env, partes, usuario, ahora);

  if (partes.length === 1 && request.method === "POST") {
    let c; try { c = await request.json(); } catch { return json({ ok: false, error: "Datos inválidos." }, 400); }
    await normalizarMedio(env, c);
    const tipo = String(c.tipo || "");
    if (!TIPOS.includes(tipo)) return json({ ok: false, error: "Tipo inválido." }, 422);
    const { d, e } = validar(tipo, c);
    if (Object.keys(e).length) return json({ ok: false, error: "Revisa los datos.", errores: e }, 422);
    const id = crypto.randomUUID();
    // Incidencia desde el panel: fotos tomadas o subidas (opcional, varias)
    let fotos = [];
    if (tipo === "incidencia" && Array.isArray(c.fotos) && c.fotos.length) {
      if (c.fotos.length > FOTOS_INC_MAX) return json({ ok: false, error: `Máximo ${FOTOS_INC_MAX} fotos por incidencia.` }, 422);
      try { fotos = await guardarFotosInc(env, c.fotos, d.titulo); } catch (er) { return json({ ok: false, error: er.message, errores: { fotos: er.message } }, 422); }
    }
    await insertarItem(env, id, tipo, d, usuario && usuario.email || null, ahora, fotos.length ? { foto: fotos[0] } : {});
    if (fotos.length) await env.DB.prepare("UPDATE agenda_items SET fotos = ? WHERE id = ?").bind(JSON.stringify(fotos), id).run();
    if (tipo === "pago") await env.DB.prepare("UPDATE agenda_items SET importe = ?, frecuencia = ?, forma = ?, cuenta = ? WHERE id = ?").bind(d.importe, d.frecuencia, d.forma, await cuentaDe(env, c, null, d.forma), id).run();
    if (tipo === "pago" || tipo === "compra") await env.DB.prepare("UPDATE agenda_items SET categoria = ? WHERE id = ?").bind((await resolverCategoria(env, c.categoria)) || adivinarCategoria(d.titulo), id).run();
    if (d.repetir) await env.DB.prepare("UPDATE agenda_items SET repetir = ? WHERE id = ?").bind(d.repetir, id).run();
    if (tipo === "compra") {
      const lugares = await listaLugares(env);
      const lugar = lugares.some(l => l.id === c.lugar) ? c.lugar : await lugarSugerido(env, d.titulo);
      if (lugar) await env.DB.prepare("UPDATE agenda_items SET lugar = ? WHERE id = ?").bind(lugar, id).run();
    }
    const push = pushTablet(tipo, d, id);
    if (push) await notificar(env, "tablet", push);
    return json({ ok: true, id });
  }

  const id = partes[1];
  const fila = id ? await env.DB.prepare("SELECT * FROM agenda_items WHERE id = ?").bind(id).first() : null;
  if (!fila) return json({ ok: false, error: "No existe ese registro." }, 404);

  // Agregar o quitar fotos de una incidencia ya registrada
  if (partes[2] === "fotos" && request.method === "POST" && fila.tipo === "incidencia") {
    let c; try { c = await request.json(); } catch { return json({ ok: false, error: "Datos inválidos." }, 400); }
    let l = listaFotos(fila);
    if (c.quitar) {
      if (!l.includes(String(c.quitar))) return json({ ok: false, error: "Esa foto no es de esta incidencia." }, 404);
      l = l.filter(x => x !== c.quitar);
      await borrarArchivo(env, String(c.quitar)).catch(() => {});
    } else {
      const nuevas = Array.isArray(c.fotos) ? c.fotos : [];
      if (!nuevas.length) return json({ ok: false, error: "Elige al menos una foto." }, 422);
      if (l.length + nuevas.length > FOTOS_INC_MAX) return json({ ok: false, error: `Máximo ${FOTOS_INC_MAX} fotos por incidencia (ya tiene ${l.length}).` }, 422);
      try { l = l.concat(await guardarFotosInc(env, nuevas, fila.titulo)); } catch (er) { return json({ ok: false, error: er.message }, 422); }
    }
    await env.DB.prepare("UPDATE agenda_items SET foto = ?, fotos = ?, actualizado = ? WHERE id = ?").bind(l[0] || null, JSON.stringify(l), ahora, fila.id).run();
    return json({ ok: true, fotos: l });
  }

  if (partes.length === 2 && request.method === "POST") {
    let c; try { c = await request.json(); } catch { return json({ ok: false, error: "Datos inválidos." }, 400); }
    await normalizarMedio(env, c);
    const { d, e } = validar(fila.tipo, c, fila);
    if (Object.keys(e).length) return json({ ok: false, error: "Revisa los datos.", errores: e }, 422);
    const cerradoAhora = ["hecho", "comprado", "resuelta", "archivado", "pagado"].includes(d.estado);
    // Si cambia la fecha, la hora o el aviso, el recordatorio se vuelve a programar
    const reprogramar = d.fecha !== fila.fecha || d.hora !== fila.hora || d.aviso !== fila.aviso;
    // Compras: al confirmarla se captura el importe y se registra como egreso de la administración (Finanzas);
    // si se regresa a pendiente, ese gasto se borra.
    // Lo que se escribe junto con el cambio del registro (compra ↔ egreso), en una sola operación
    const junto = [];
    if (fila.tipo === "compra" && d.estado === "comprado" && fila.estado !== "comprado" && !fila.gasto_id) {
      const t = String(c.importe ?? "").replace(/[$,\s]/g, ""), importe = /^\d{1,9}(\.\d{1,2})?$/.test(t) ? Number(t) : NaN;
      const forma = ["EFECTIVO", "TARJETA", "TRANSFERENCIA"].includes(c.forma) ? c.forma : "EFECTIVO";
      if (!(importe > 0)) return json({ ok: false, error: "Escribe el importe de la compra.", errores: { importe: "Importe inválido." } }, 422);
      await asegurarEsquemaCaja(env);
      // Día en que se compró (por defecto hoy); tiene que ser de un mes abierto y no futuro
      const dia = RE_DIA.test(String(c.fecha_compra || "")) ? String(c.fecha_compra) : hoyMx();
      if (dia > hoyMx() || !(await mesesAbiertos(env)).includes(dia.slice(0, 7))) return json({ ok: false, error: "La fecha de la compra tiene que ser del mes abierto y no futura.", errores: { fecha_compra: "Fecha inválida." } }, 422);
      const gid = crypto.randomUUID();
      const concepto = ("Compra: " + d.titulo + (d.cantidad ? ` (${d.cantidad})` : "")).slice(0, 120);
      const catC = (await resolverCategoria(env, c.categoria)) || fila.categoria || adivinarCategoria(d.titulo);
      const cta = await cuentaDe(env, c, null, forma);
      junto.push(env.DB.prepare(GASTO_ADMIN).bind(gid, dia.slice(0, 7), dia, concepto, importe, forma, ahora, usuario && usuario.email || null, catC, cta),
        env.DB.prepare("UPDATE agenda_items SET importe = ?, gasto_id = ?, pospuesta = NULL WHERE id = ?").bind(importe, gid, id),
        stmtBitacora(env, { quien: usuario && usuario.email, accion: "crear", que: "Compra", ref: id, mes: dia.slice(0, 7), detalle: { dia, concepto, importe, forma, cuenta: cta, categoria: catC } }));
    } else if (fila.tipo === "compra" && d.estado !== "comprado" && fila.gasto_id) {
      const g = await env.DB.prepare("SELECT * FROM caja_gastos WHERE id = ?").bind(fila.gasto_id).first();
      if (g && !(await mesesAbiertos(env)).includes(g.mes)) return json({ ok: false, error: "Esa compra es de un mes ya cerrado; ya no se puede regresar a pendiente." }, 409);
      junto.push(env.DB.prepare("DELETE FROM caja_gastos WHERE id = ?").bind(fila.gasto_id),
        env.DB.prepare("UPDATE agenda_items SET importe = NULL, gasto_id = NULL WHERE id = ?").bind(id),
        stmtBitacora(env, { quien: usuario && usuario.email, accion: "borrar", que: "Compra", ref: id, mes: g ? g.mes : null, detalle: g ? { dia: g.dia, concepto: g.concepto, importe: g.monto, forma: g.forma, cuenta: g.cuenta } : { concepto: fila.titulo } }));
    }
    if (junto.length) await env.DB.batch(junto);
    await env.DB.prepare(`UPDATE agenda_items SET titulo=?, detalle=?, fecha=?, hora=?, estado=?, prioridad=?, cantidad=?, turno=?, gravedad=?, actualizado=?, cerrado=?, aviso=?, avisado=?, para_turno=?, area=?, hecho_por=?, para=COALESCE(?, para), repetir=? WHERE id=?`)
      .bind(d.titulo, d.detalle, d.fecha, d.hora, d.estado, d.prioridad, d.cantidad, d.turno, d.gravedad, ahora, cerradoAhora ? (fila.cerrado || ahora) : null, d.aviso, reprogramar ? null : fila.avisado, d.para_turno, d.area, cerradoAhora ? fila.hecho_por : null, fila.tipo === "aviso" && "para" in c ? d.para : null, d.repetir, id).run();
    if (fila.tipo === "tarea" && d.estado === "hecho" && fila.estado !== "hecho") await repetirTarea(env, id, ahora);
    // Compra que pidió un encargado desde la tablet: al comprarla, la tablet se entera
    if (fila.tipo === "compra" && fila.reporto && d.estado === "comprado" && fila.estado !== "comprado")
      await notificar(env, "tablet", { titulo: "Ya se compró: " + d.titulo, cuerpo: `La pidió ${fila.reporto}${d.cantidad ? " · " + d.cantidad : ""}`, sec: "inicio", url: "/turno", etiqueta: "compra-" + id });
    if (fila.tipo === "compra" && "lugar" in c) {
      const lugar = c.lugar && (await listaLugares(env)).some(l => l.id === c.lugar) ? c.lugar : null;
      await env.DB.prepare("UPDATE agenda_items SET lugar = ? WHERE id = ?").bind(lugar, id).run();
    }
    if (fila.tipo === "pago") await env.DB.prepare("UPDATE agenda_items SET importe = ?, frecuencia = ?, forma = ?, cuenta = ? WHERE id = ?").bind(d.importe, d.frecuencia, d.forma, await cuentaDe(env, c, fila.cuenta, d.forma), id).run();
    if ((fila.tipo === "pago" || fila.tipo === "compra") && "categoria" in c) {
      const cat = await resolverCategoria(env, c.categoria);
      if (cat) {
        await env.DB.prepare("UPDATE agenda_items SET categoria = ? WHERE id = ?").bind(cat, id).run();
        const g = await env.DB.prepare("SELECT gasto_id FROM agenda_items WHERE id = ?").bind(id).first();
        if (fila.tipo === "compra" && g && g.gasto_id) await env.DB.prepare("UPDATE caja_gastos SET categoria = ? WHERE id = ?").bind(cat, g.gasto_id).run();
      }
    }
    return json({ ok: true });
  }

  // Registrar un pago programado: fecha en que se pagó, importe y forma → gasto; el pago se mueve al siguiente periodo
  if (partes[2] === "pagar" && request.method === "POST" && fila.tipo === "pago") {
    let c; try { c = await request.json(); } catch { return json({ ok: false, error: "Datos inválidos." }, 400); }
    await normalizarMedio(env, c);
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
    const cat = (await resolverCategoria(env, c.categoria)) || fila.categoria || adivinarCategoria(fila.titulo);
    const cta = await cuentaDe(env, c, fila.forma === forma ? fila.cuenta : null, forma), quien = usuario && usuario.email || null;
    const meses_ = MESES_FREC[fila.frecuencia || "mensual"];
    // Egreso, pago y siguiente vencimiento en una sola operación (o se guarda todo o nada)
    await env.DB.batch([
      env.DB.prepare(GASTO_ADMIN).bind(gid, fecha.slice(0, 7), fecha, ("Pago: " + fila.titulo).slice(0, 120), importe, forma, ahora, quien, cat, cta),
      env.DB.prepare("INSERT INTO agenda_pagos (id, item_id, fecha, programado, importe, forma, gasto_id, creado, creado_por, titulo, nota, categoria, cuenta) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(pid, fila.id, fecha, fila.fecha, importe, forma, gid, ahora, quien, fila.titulo, v.nota, cat, cta),
      // Siguiente vencimiento a partir de la fecha programada (si se pagó tarde no se recorre el calendario)
      !meses_ ? env.DB.prepare("UPDATE agenda_items SET estado = 'pagado', cerrado = ?, actualizado = ? WHERE id = ?").bind(ahora, ahora, fila.id)
        : env.DB.prepare("UPDATE agenda_items SET fecha = ?, avisado = NULL, actualizado = ? WHERE id = ?").bind(sumarMeses(fila.fecha || fecha, meses_), ahora, fila.id),
      stmtBitacora(env, { quien, accion: "crear", que: "Pago programado", ref: pid, mes: fecha.slice(0, 7), detalle: { concepto: fila.titulo, fecha, importe, forma, cuenta: cta, categoria: cat, vencimiento: fila.fecha } })
    ]);
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
    // Llega al celular (push) y al correo; si uno falla, el otro sigue y ya no se repite
    const push = await enviarPushSeguro(env, { titulo: `${que}: ${it.titulo}`.slice(0, 120), cuerpo: cuando + (it.detalle ? "\n" + it.detalle : ""), sec: it.tipo === "evento" ? "calendario" : "tarea", url: "/panel?abrir=" + (it.tipo === "evento" ? "calendario" : "tarea"), etiqueta: "rec-" + it.id });
    let correo = false;
    try {
      await enviar(env, {
        asunto: `Recordatorio: ${it.titulo}`.slice(0, 180),
        texto: `${que}: ${it.titulo}\nCuándo: ${cuando}${it.detalle ? "\n\n" + it.detalle : ""}\n\nAgenda: https://basculaypension.com/panel#agenda`,
        html: `<div style="font-family:system-ui,sans-serif;font-size:15px"><p style="color:#666;margin:0">Recordatorio · ${que}</p><h2 style="margin:4px 0 8px">${escHtml(it.titulo)}</h2><p style="margin:0 0 12px"><b>${escHtml(cuando)}</b></p>${it.detalle ? `<p>${escHtml(it.detalle)}</p>` : ""}<p><a href="https://basculaypension.com/panel#agenda">Abrir la agenda</a></p></div>`
      });
      correo = true;
    } catch (e) { console.error("recordatorio agenda", e && e.message); }
    if (correo || push) { await env.DB.prepare("UPDATE agenda_items SET avisado = ? WHERE id = ?").bind(ahora.toISOString(), it.id).run(); enviados++; }
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
