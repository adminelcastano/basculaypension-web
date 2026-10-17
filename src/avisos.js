// Avisos como publicaciones: quien publica etiqueta a los destinatarios y todos comentan en la misma
// publicación hasta que la administración la archiva.
// - Solo la ven la administración, quien la publicó y los etiquetados (normalizarPara / avisoParaEncargado).
// - Solo la administración edita o borra comentarios; el borrado es lógico y todo queda en el historial.
// - Los avisos archivados no se borran nunca (trazabilidad): quedan en el archivo con su conversación.
import { asegurarEsquemaAgenda, normalizarPara, avisoParaEncargado } from "./agenda.js";

export const MAX_COMENTARIO = 1000;
// Las fotografías de Castagram heredan el acceso y el estado de su publicación.
export const fotoAvisoPermitida = (item, persona, turno, comentarioBorrado = false) =>
  !!item && item.estado === "activo" && !comentarioBorrado && avisoParaEncargado(item, persona, turno);
// Texto de varias líneas: se conservan los saltos (máximo una línea en blanco seguida)
export const textoLargo = (v, n) => String(v ?? "").replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, n);
// Clave con la que se guarda la autoría: "admin" para la administración, la clave del encargado si no
export const autorDe = persona => (persona === "ADMIN" || persona === "admin" ? "admin" : String(persona || "").toUpperCase());
// Clave para vistos y lecturas: "ADMIN" o la del encargado
const personaDe = autor => (autor === "admin" ? "ADMIN" : autor);

// Claves de encargado mencionadas con @ en el texto (solo las que existen)
export function menciones(texto, claves) {
  const ok = new Set((claves || []).map(c => String(c).toUpperCase()));
  const out = new Set();
  for (const m of String(texto || "").matchAll(/@([A-Za-zÑñ0-9_]{2,12})/g)) { const k = m[1].toUpperCase(); if (ok.has(k)) out.add(k); }
  return [...out];
}

// Personas que se agregan al aviso por un comentario (las que todavía no lo podían ver)
export function etiquetasNuevas(para, pedidas, claves, autorAviso) {
  const p = normalizarPara(para), ok = new Set((claves || []).map(c => String(c).toUpperCase()));
  const lista = [...new Set((pedidas || []).map(x => String(x || "").toUpperCase()))].filter(k => ok.has(k) && k !== autorAviso);
  if (p.todos) return [];
  return lista.filter(k => !p.personas.includes(k));
}

// Comentarios nuevos para alguien: de otros y posteriores a la última vez que abrió la conversación
export function contarNuevos(comentarios, autor, vistoAt) {
  return comentarios.filter(c => !c.borrado && c.autor !== autor && (!vistoAt || c.creado > vistoAt)).length;
}

let listo = false;
export async function asegurarEsquemaAvisos(env) {
  if (listo) return;
  await asegurarEsquemaAgenda(env);
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS aviso_comentarios (
      id TEXT PRIMARY KEY, item_id TEXT NOT NULL, autor TEXT NOT NULL, texto TEXT NOT NULL, foto TEXT, etiquetas TEXT,
      creado TEXT NOT NULL, editado TEXT, borrado TEXT)`),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS aviso_com_item ON aviso_comentarios (item_id, creado)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS aviso_vistos (item_id TEXT NOT NULL, persona TEXT NOT NULL, at TEXT NOT NULL, PRIMARY KEY (item_id, persona))"),
    // Historial de cada aviso: publicar, comentar, etiquetar, editar, borrar, archivar, reactivar
    env.DB.prepare("CREATE TABLE IF NOT EXISTS aviso_historial (id TEXT PRIMARY KEY, item_id TEXT NOT NULL, at TEXT NOT NULL, quien TEXT NOT NULL, accion TEXT NOT NULL, detalle TEXT)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS aviso_hist_item ON aviso_historial (item_id, at)")
  ]);
  listo = true;
}

export const stmtHistorial = (env, itemId, quien, accion, detalle = null, at = new Date().toISOString()) =>
  env.DB.prepare("INSERT INTO aviso_historial (id, item_id, at, quien, accion, detalle) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(crypto.randomUUID(), itemId, at, quien || "admin", accion, detalle ? JSON.stringify(detalle) : null);

export async function registrarHistorial(env, itemId, quien, accion, detalle, at) {
  await asegurarEsquemaAvisos(env);
  await stmtHistorial(env, itemId, quien, accion, detalle, at).run();
}

const enLotes = async (env, sql, ids, extra = []) => {
  const out = [];
  for (let i = 0; i < ids.length; i += 90) {
    const l = ids.slice(i, i + 90);
    out.push(...(await env.DB.prepare(sql.replace("(?)", "(" + l.map(() => "?").join(",") + ")")).bind(...extra, ...l).all()).results);
  }
  return out;
};

// Las confirmaciones tienen fecha propia y solo son nuevas tras la última vista.
export function resumenEnterados(recibos, vistoAt) {
  const ultimo = recibos.reduce((at, r) => r.at > at ? r.at : at, "");
  return { nuevosEnterado: recibos.filter(r => !vistoAt || r.at > vistoAt).length, ultimoEnterado: ultimo };
}
// Resumen de la conversación de varios avisos para una persona ("ADMIN" o clave del encargado):
// { [id]: { n, nuevos, ultimo: { autor, texto, creado }, actividad } }
export async function resumenConversaciones(env, avisos, persona) {
  await asegurarEsquemaAvisos(env);
  const ids = avisos.map(a => a.id), out = {};
  if (!ids.length) return out;
  const coms = await enLotes(env, "SELECT item_id, autor, texto, creado, borrado FROM aviso_comentarios WHERE item_id IN (?) ORDER BY creado", ids);
  const vistos = new Map((await enLotes(env, "SELECT item_id, at FROM aviso_vistos WHERE persona = ? AND item_id IN (?)", ids, [persona])).map(v => [v.item_id, v.at]));
  const confirmaciones = persona === "ADMIN"
    ? await enLotes(env, "SELECT item_id, persona, at FROM agenda_lecturas WHERE persona != 'ADMIN' AND item_id IN (?)", ids)
    : [];
  const autor = autorDe(persona);
  for (const a of avisos) {
    const l = coms.filter(c => c.item_id === a.id), vivos = l.filter(c => !c.borrado), u = vivos[vivos.length - 1];
    const recibos = persona === "ADMIN" && (a.autor || "admin") === "admin"
      ? confirmaciones.filter(c => c.item_id === a.id) : [];
    const conf = resumenEnterados(recibos, vistos.get(a.id));
    const ultimoComentario = u && u.creado > a.creado ? u.creado : a.creado;
    out[a.id] = { n: vivos.length, nuevos: contarNuevos(l, autor, vistos.get(a.id)),
      nuevosEnterado: conf.nuevosEnterado,
      ultimo: u ? { autor: u.autor, texto: u.texto.slice(0, 140), creado: u.creado } : null,
      actividad: conf.ultimoEnterado > ultimoComentario ? conf.ultimoEnterado : ultimoComentario };
  }
  return out;
}

// Conversación completa. La administración ve el texto de lo borrado (marcado); la tablet, no.
export async function conversacion(env, item, persona, { historial = false } = {}) {
  await asegurarEsquemaAvisos(env);
  const admin = persona === "ADMIN";
  const coms = (await env.DB.prepare("SELECT id, autor, texto, foto, etiquetas, creado, editado, borrado FROM aviso_comentarios WHERE item_id = ? ORDER BY creado").bind(item.id).all()).results
    .map(c => ({ ...c, etiquetas: (() => { try { return JSON.parse(c.etiquetas || "[]"); } catch { return []; } })(), ...(c.borrado && !admin ? { texto: "", foto: null } : {}) }));
  const out = { comentarios: coms };
  if (historial && admin) out.historial = (await env.DB.prepare("SELECT at, quien, accion, detalle FROM aviso_historial WHERE item_id = ? ORDER BY at").bind(item.id).all()).results
    .map(h => ({ ...h, detalle: (() => { try { return JSON.parse(h.detalle || "null"); } catch { return null; } })() }));
  return out;
}

export async function marcarVisto(env, itemId, persona, ahora = new Date().toISOString()) {
  await asegurarEsquemaAvisos(env);
  // Abrir la conversación solo cuenta como "visto". El "Enterado" de un encargado es aparte (botón Enterado);
  // la administración, al abrirla, sí queda como enterada.
  const st = [env.DB.prepare("INSERT INTO aviso_vistos (item_id, persona, at) VALUES (?, ?, ?) ON CONFLICT (item_id, persona) DO UPDATE SET at = excluded.at").bind(itemId, persona, ahora)];
  if (persona === "ADMIN") st.push(env.DB.prepare("INSERT OR IGNORE INTO agenda_lecturas (item_id, persona, at) VALUES (?, ?, ?)").bind(itemId, persona, ahora));
  await env.DB.batch(st);
}

// ¿Puede esta persona ver (y comentar) el aviso? La administración, siempre.
export const puedeVer = (item, persona, turno) => persona === "ADMIN" || avisoParaEncargado(item, persona, turno);

// Nuevo comentario. autor: "admin" o clave del encargado. foto: llave ya guardada (o null).
// Devuelve { comentario, etiquetadas, notificar: { admin, tablet } }
export async function comentar(env, item, autor, { texto, foto = null, etiquetas = [] }, claves, ahora = new Date().toISOString()) {
  await asegurarEsquemaAvisos(env);
  if (item.tipo !== "aviso") throw new Error("Solo los avisos llevan comentarios.");
  if (item.estado !== "activo") throw new Error("Este aviso ya está archivado. Pide a la administración que lo reactive.");
  const t = textoLargo(texto, MAX_COMENTARIO);
  if (!t && !foto) throw new Error("Escribe tu comentario.");
  const pedidas = [...(Array.isArray(etiquetas) ? etiquetas : []), ...menciones(t, claves)];
  const nuevas = etiquetasNuevas(item.para, pedidas, claves, item.autor);
  const p = normalizarPara(item.para);
  const etqCom = [...new Set(pedidas.map(x => String(x).toUpperCase()).filter(k => (claves || []).map(c => String(c).toUpperCase()).includes(k)))];
  const id = crypto.randomUUID();
  const st = [
    env.DB.prepare("INSERT INTO aviso_comentarios (id, item_id, autor, texto, foto, etiquetas, creado) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(id, item.id, autor, t || "", foto, etqCom.length ? JSON.stringify(etqCom) : null, ahora),
    stmtHistorial(env, item.id, autor, "comentar", { id, texto: t, foto: foto ? 1 : 0 }, ahora),
    env.DB.prepare("INSERT INTO aviso_vistos (item_id, persona, at) VALUES (?, ?, ?) ON CONFLICT (item_id, persona) DO UPDATE SET at = excluded.at").bind(item.id, personaDe(autor), ahora)
  ];
  let para = p;
  if (nuevas.length) {
    para = { ...p, personas: [...p.personas, ...nuevas] };
    st.push(env.DB.prepare("UPDATE agenda_items SET para = ?, actualizado = ? WHERE id = ?").bind(JSON.stringify(para), ahora, item.id));
    st.push(stmtHistorial(env, item.id, autor, "etiquetar", { personas: nuevas }, ahora));
  } else st.push(env.DB.prepare("UPDATE agenda_items SET actualizado = ? WHERE id = ?").bind(ahora, item.id));
  await env.DB.batch(st);
  // A quién avisar: la administración si participa; la tablet si hay encargados en la conversación aparte de quien escribe
  const autorAviso = item.autor || "admin";
  const encargados = para.todos || para.turnos.length || para.personas.some(k => k !== autor) || (autorAviso !== "admin" && autorAviso !== autor);
  const admin = autor !== "admin" && (para.admin || autorAviso === "admin");
  return { comentario: { id, autor, texto: t, foto, etiquetas: etqCom, creado: ahora }, etiquetadas: nuevas, notificar: { admin, tablet: !!encargados } };
}

// Solo la administración: corregir el texto de un comentario (queda el anterior en el historial)
export async function editarComentario(env, item, cid, texto, quien, ahora = new Date().toISOString()) {
  await asegurarEsquemaAvisos(env);
  const c = await env.DB.prepare("SELECT * FROM aviso_comentarios WHERE id = ? AND item_id = ?").bind(cid, item.id).first();
  if (!c) throw new Error("Ese comentario ya no existe.");
  if (c.borrado) throw new Error("Ese comentario está borrado.");
  const t = textoLargo(texto, MAX_COMENTARIO);
  if (!t && !c.foto) throw new Error("Escribe el comentario.");
  if (t === c.texto) return c;
  await env.DB.batch([
    env.DB.prepare("UPDATE aviso_comentarios SET texto = ?, editado = ? WHERE id = ?").bind(t, ahora, cid),
    stmtHistorial(env, item.id, "admin", "editar", { id: cid, autor: c.autor, antes: c.texto, despues: t, por: quien || null }, ahora)
  ]);
  return { ...c, texto: t, editado: ahora };
}

// Solo la administración: borrar un comentario. No se elimina: se oculta y queda en el historial.
export async function borrarComentario(env, item, cid, quien, ahora = new Date().toISOString()) {
  await asegurarEsquemaAvisos(env);
  const c = await env.DB.prepare("SELECT * FROM aviso_comentarios WHERE id = ? AND item_id = ?").bind(cid, item.id).first();
  if (!c) throw new Error("Ese comentario ya no existe.");
  if (c.borrado) return;
  await env.DB.batch([
    env.DB.prepare("UPDATE aviso_comentarios SET borrado = ? WHERE id = ?").bind(ahora, cid),
    stmtHistorial(env, item.id, "admin", "borrar", { id: cid, autor: c.autor, texto: c.texto, foto: c.foto ? 1 : 0, por: quien || null }, ahora)
  ]);
}

// Archivo de avisos (todos los archivados, sin límite de tiempo) con búsqueda en título, detalle y comentarios
export async function archivoAvisos(env, { q = "", persona = "", desde = "", hasta = "", pagina = 0 } = {}) {
  await asegurarEsquemaAvisos(env);
  let sql = "SELECT i.* FROM agenda_items i WHERE i.tipo = 'aviso' AND i.estado = 'archivado'", args = [];
  const t = String(q || "").trim().slice(0, 60);
  if (t) {
    const like = "%" + t.replace(/[!%_]/g, x => "!" + x) + "%";
    sql += " AND (i.titulo LIKE ? ESCAPE '!' OR COALESCE(i.detalle, '') LIKE ? ESCAPE '!' OR EXISTS (SELECT 1 FROM aviso_comentarios c WHERE c.item_id = i.id AND c.texto LIKE ? ESCAPE '!'))"; args.push(like, like, like);
  }
  const per = String(persona || "").toUpperCase().slice(0, 12);
  if (per) { sql += " AND (COALESCE(i.autor, 'admin') = ? OR i.para LIKE ? OR EXISTS (SELECT 1 FROM aviso_comentarios c WHERE c.item_id = i.id AND c.autor = ?))"; args.push(per === "ADMIN" ? "admin" : per, `%"${per}"%`, per === "ADMIN" ? "admin" : per); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(desde)) { sql += " AND substr(COALESCE(i.cerrado, i.actualizado), 1, 10) >= ?"; args.push(desde); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(hasta)) { sql += " AND substr(COALESCE(i.cerrado, i.actualizado), 1, 10) <= ?"; args.push(hasta); }
  const pg = Math.max(0, Math.min(200, Number(pagina) || 0));
  sql += " ORDER BY COALESCE(i.cerrado, i.actualizado) DESC, i.id DESC LIMIT 31 OFFSET ?"; args.push(pg * 30);
  const filas = (await env.DB.prepare(sql).bind(...args).all()).results;
  const items = filas.slice(0, 30).map(a => ({ ...a, para: normalizarPara(a.para), autor: a.autor || "admin" }));
  const res = await resumenConversaciones(env, items, "ADMIN");
  for (const a of items) a.conv = res[a.id];
  return { items, mas: filas.length > 30, pagina: pg };
}

// Al borrar avisos (solo si la administración elimina uno): su conversación también
export async function borrarConversaciones(env, ids, borrarArchivo) {
  if (!ids.length) return;
  await asegurarEsquemaAvisos(env);
  const fotos = await enLotes(env, "SELECT foto FROM aviso_comentarios WHERE item_id IN (?) AND foto IS NOT NULL", ids);
  for (const f of fotos) await borrarArchivo(env, f.foto).catch(() => {});
  for (let i = 0; i < ids.length; i += 90) {
    const l = ids.slice(i, i + 90), q = l.map(() => "?").join(",");
    await env.DB.batch([
      env.DB.prepare(`DELETE FROM aviso_comentarios WHERE item_id IN (${q})`).bind(...l),
      env.DB.prepare(`DELETE FROM aviso_vistos WHERE item_id IN (${q})`).bind(...l),
      env.DB.prepare(`DELETE FROM aviso_historial WHERE item_id IN (${q})`).bind(...l)
    ]);
  }
}
