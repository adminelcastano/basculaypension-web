// Agenda del panel: calendario, por hacer, compras e incidencias.
// Todo vive en una tabla (agenda_items) con un campo "tipo".

const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });

export const TIPOS = ["evento", "tarea", "compra", "incidencia", "aviso"];
const ESTADOS = {
  evento: ["programado", "hecho"],
  tarea: ["pendiente", "hecho"],
  compra: ["pendiente", "comprado"],
  incidencia: ["abierta", "en_proceso", "resuelta"],
  aviso: ["activo", "archivado"]
};
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
    env.DB.prepare("CREATE TABLE IF NOT EXISTS agenda_lecturas (item_id TEXT NOT NULL, persona TEXT NOT NULL, at TEXT NOT NULL, PRIMARY KEY (item_id, persona))")
  ]);
  // Columnas agregadas para la tablet de turno
  const cols = new Set((await env.DB.prepare("PRAGMA table_info(agenda_items)").all()).results.map(r => r.name));
  for (const [c, t] of [["para_turno", "INTEGER"], ["reporto", "TEXT"], ["foto", "TEXT"], ["hecho_por", "TEXT"], ["nota_cierre", "TEXT"], ["area", "TEXT"]])
    if (!cols.has(c)) await env.DB.prepare(`ALTER TABLE agenda_items ADD COLUMN ${c} ${t}`).run();
  listo = true;
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
    area: v("area") ? texto(v("area"), 40) : null
  };
  const e = {};
  if (d.titulo.length < 2) e.titulo = tipo === "compra" ? "Escribe qué hay que comprar." : tipo === "incidencia" ? "Describe la incidencia." : "Escribe un título.";
  if (d.fecha && !RE_DIA.test(d.fecha)) e.fecha = "Fecha inválida.";
  if (tipo === "evento" && !d.fecha) e.fecha = "Elige la fecha del evento.";
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

const ABIERTO = "estado NOT IN ('hecho','comprado','resuelta','archivado')";

export async function insertarItem(env, id, tipo, d, creadoPor, ahora, extra = {}) {
  await env.DB.prepare(`INSERT INTO agenda_items (id, tipo, titulo, detalle, fecha, hora, estado, prioridad, cantidad, turno, gravedad, creado, creado_por, actualizado, aviso, para_turno, area, reporto, foto)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, tipo, d.titulo, d.detalle, d.fecha, d.hora, d.estado, d.prioridad, d.cantidad, d.turno, d.gravedad, ahora, creadoPor, ahora, d.aviso, d.para_turno || 0, d.area || null, extra.reporto || null, extra.foto || null).run();
}
export { validar as validarItem, ABIERTO };

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
  return { hoy, abiertos: c, vencidas, eventos_hoy: eventosHoy, proximos, tareas, compras, incidencias };
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
    const lect = items.some(it => it.tipo === "aviso") ? (await env.DB.prepare("SELECT l.item_id, l.persona, l.at FROM agenda_lecturas l JOIN agenda_items a ON a.id = l.item_id WHERE a.tipo = 'aviso'").all()).results : [];
    for (const it of items) if (it.tipo === "aviso") it.lecturas = lect.filter(l => l.item_id === it.id);
    const conteos = (await env.DB.prepare(`SELECT tipo, COUNT(*) n FROM agenda_items WHERE ${ABIERTO} GROUP BY tipo`).all()).results;
    return json({ ok: true, items, abiertos: Object.fromEntries(conteos.map(r => [r.tipo, r.n])), hoy: hoyMx(), estados: ESTADOS });
  }

  if (partes[1] === "resumen" && request.method === "GET") return json({ ok: true, ...(await resumenAgenda(env)) });

  if (partes.length === 1 && request.method === "POST") {
    let c; try { c = await request.json(); } catch { return json({ ok: false, error: "Datos inválidos." }, 400); }
    const tipo = String(c.tipo || "");
    if (!TIPOS.includes(tipo)) return json({ ok: false, error: "Tipo inválido." }, 422);
    const { d, e } = validar(tipo, c);
    if (Object.keys(e).length) return json({ ok: false, error: "Revisa los datos.", errores: e }, 422);
    const id = crypto.randomUUID();
    await insertarItem(env, id, tipo, d, usuario && usuario.email || null, ahora);
    return json({ ok: true, id });
  }

  const id = partes[1];
  const fila = id ? await env.DB.prepare("SELECT * FROM agenda_items WHERE id = ?").bind(id).first() : null;
  if (!fila) return json({ ok: false, error: "No existe ese registro." }, 404);

  if (partes.length === 2 && request.method === "POST") {
    let c; try { c = await request.json(); } catch { return json({ ok: false, error: "Datos inválidos." }, 400); }
    const { d, e } = validar(fila.tipo, c, fila);
    if (Object.keys(e).length) return json({ ok: false, error: "Revisa los datos.", errores: e }, 422);
    const cerradoAhora = ["hecho", "comprado", "resuelta", "archivado"].includes(d.estado);
    // Si cambia la fecha, la hora o el aviso, el recordatorio se vuelve a programar
    const reprogramar = d.fecha !== fila.fecha || d.hora !== fila.hora || d.aviso !== fila.aviso;
    await env.DB.prepare(`UPDATE agenda_items SET titulo=?, detalle=?, fecha=?, hora=?, estado=?, prioridad=?, cantidad=?, turno=?, gravedad=?, actualizado=?, cerrado=?, aviso=?, avisado=?, para_turno=?, area=?, hecho_por=? WHERE id=?`)
      .bind(d.titulo, d.detalle, d.fecha, d.hora, d.estado, d.prioridad, d.cantidad, d.turno, d.gravedad, ahora, cerradoAhora ? (fila.cerrado || ahora) : null, d.aviso, reprogramar ? null : fila.avisado, d.para_turno, d.area, cerradoAhora ? fila.hecho_por : null, id).run();
    return json({ ok: true });
  }

  if (partes[2] === "eliminar" && request.method === "POST") {
    if (fila.foto) await env.FILES.delete(fila.foto).catch(() => {});
    await env.DB.batch([env.DB.prepare("DELETE FROM agenda_items WHERE id = ?").bind(id), env.DB.prepare("DELETE FROM agenda_lecturas WHERE item_id = ?").bind(id)]);
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
  if (!eventosHoy.length && !tareasHoy.length && !compras.length && !incid.length) return false;
  const sec = (t, filas, f) => filas.length ? `${t}\n${filas.map(x => "• " + f(x)).join("\n")}\n\n` : "";
  const secH = (t, filas, f) => filas.length ? `<h3 style="margin:18px 0 6px">${t}</h3><ul style="margin:0;padding-left:18px">${filas.map(x => `<li>${f(x)}</li>`).join("")}</ul>` : "";
  const ev = x => `${x.hora ? x.hora + " · " : ""}${x.titulo}`;
  const ta = x => `${x.titulo}${x.fecha < hoy ? " (vencida " + x.fecha + ")" : ""}`;
  const co = x => `${x.titulo}${x.cantidad ? " · " + x.cantidad : ""}${x.prioridad === "alta" ? " (urgente)" : ""}`;
  const inc = x => `${x.titulo} · ${x.gravedad}${x.estado === "en_proceso" ? " · en proceso" : ""}`;
  await enviar(env, {
    asunto: `Agenda de hoy · ${diaTxt(hoy)}`,
    texto: `Agenda de hoy, ${diaTxt(hoy)}\n\n` + sec("Eventos de hoy", eventosHoy, ev) + sec("Por hacer (hoy o vencidas)", tareasHoy, ta) + sec("Compras pendientes", compras, co) + sec("Incidencias abiertas", incid, inc) + "Agenda: https://basculaypension.com/panel#agenda",
    html: `<div style="font-family:system-ui,sans-serif;font-size:15px"><h2 style="margin:0 0 4px">Agenda de hoy</h2><p style="color:#666;margin:0">${escHtml(diaTxt(hoy))}</p>`
      + secH("Eventos de hoy", eventosHoy, x => escHtml(ev(x))) + secH("Por hacer (hoy o vencidas)", tareasHoy, x => escHtml(ta(x)))
      + secH("Compras pendientes", compras, x => escHtml(co(x))) + secH("Incidencias abiertas", incid, x => escHtml(inc(x)))
      + `<p style="margin-top:18px"><a href="https://basculaypension.com/panel#agenda">Abrir la agenda</a></p></div>`
  });
  return true;
}
