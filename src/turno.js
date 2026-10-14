// Tablet del encargado de turno (/turno).
// Doble candado: Cloudflare Access (cuenta entrada@ o la de administración) y, encima,
// cada encargado entra con su PIN de 4 dígitos. Todo lo que captura queda a su nombre.
//
// Secciones: avisos de la administración, tareas del turno, incidencias, gastos de caja chica
// (con foto) y corte ciego (el encargado no ve cuánto debería haber; solo captura lo que contó).

import { asegurarEsquemaAgenda, insertarItem, validarItem, ABIERTO, AREAS } from "./agenda.js";
import { asegurarEsquemaCaja, mesActual, TURNOS, unirConteos, calcularCortes } from "./caja.js";

const TZ = "America/Mexico_City";
const PERSONAS_INICIALES = ["JDOM", "JESC", "JOESC", "JURB", "ERI"];
const SESION_HORAS = 14;
const MAX_FALLAS = 5, BLOQUEO_MIN = 15;
const FOTO_MAX = 1_500_000, FOTO_TTL = 200 * 86400;
const CONCEPTOS = ["Agua", "Limpieza", "Papelería", "Refacción", "Comida de turno", "Gasolina", "Otro"];

const json = (obj, status = 200, extra = {}) => new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...extra } });
const texto = (v, n) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const numero = v => { const t = String(v ?? "").replace(/[$,\s]/g, ""); const n = t === "" ? NaN : Number(t); return isFinite(n) ? Math.round(n * 100) / 100 : NaN; };
const enc = new TextEncoder();
const hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
const b64u = s => btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const deB64u = s => atob(s.replace(/-/g, "+").replace(/_/g, "/"));

// Hora local en México (sin horario de verano)
function local(ahora = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(ahora).map(x => [x.type, x.value]));
  return { dia: `${p.year}-${p.month}-${p.day}`, h: Number(p.hour) + Number(p.minute) / 60 };
}
const sumaDias = (dia, n) => { const d = new Date(dia + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

// Turno sugerido al entrar: el que empieza en los próximos 30 minutos ya cuenta
export function turnoSugerido(ahora = new Date()) {
  const { h } = local(ahora);
  const x = (h + 0.5) % 24;
  return x >= 6 && x < 14 ? "MAÑANA" : x >= 14 && x < 22 ? "TARDE" : "NOCHE";
}
// Día del corte para el turno elegido (la noche que pasa de medianoche es del día anterior)
export function diaDeTurno(turno, ahora = new Date()) {
  const { dia, h } = local(ahora);
  if (turno === "NOCHE" && h < 12) return sumaDias(dia, -1);
  return dia;
}

// ---------------------------------------------------------------------------
// Esquema
// ---------------------------------------------------------------------------
let listo = false;
export async function asegurarEsquemaTurno(env) {
  if (listo) return;
  await asegurarEsquemaAgenda(env);
  await asegurarEsquemaCaja(env);
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS turno_personas (
    clave TEXT PRIMARY KEY, nombre TEXT, pin_hash TEXT, pin_sal TEXT, activo INTEGER NOT NULL DEFAULT 1,
    fallas INTEGER NOT NULL DEFAULT 0, bloqueado_hasta TEXT, ultimo_acceso TEXT, creado TEXT NOT NULL)`).run();
  const n = (await env.DB.prepare("SELECT COUNT(*) n FROM turno_personas").first()).n;
  if (!n) {
    const ahora = new Date().toISOString();
    await env.DB.batch(PERSONAS_INICIALES.map(c => env.DB.prepare("INSERT OR IGNORE INTO turno_personas (clave, nombre, creado) VALUES (?, ?, ?)").bind(c, c, ahora)));
  }
  listo = true;
}

// ---------------------------------------------------------------------------
// PIN y sesión
// ---------------------------------------------------------------------------
async function hashPin(pin, sal) {
  const llave = await crypto.subtle.importKey("raw", enc.encode(pin), "PBKDF2", false, ["deriveBits"]);
  return hex(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: enc.encode(sal), iterations: 20000 }, llave, 256));
}
function igual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
async function secreto(env) {
  let s = await env.FILES.get("turno:secreto");
  if (!s) { s = hex(crypto.getRandomValues(new Uint8Array(32))); await env.FILES.put("turno:secreto", s); }
  return s;
}
async function firmar(env, datos) {
  const llave = await crypto.subtle.importKey("raw", enc.encode(await secreto(env)), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", llave, enc.encode(datos)));
}
async function crearSesion(env, persona, turno, dia) {
  // La sal del PIN va en la sesión: si se cambia el PIN, las sesiones abiertas dejan de valer
  const datos = b64u(JSON.stringify({ p: persona.clave, t: turno, d: dia, s: persona.pin_sal.slice(0, 8), e: Date.now() + SESION_HORAS * 3600e3 }));
  return datos + "." + await firmar(env, datos);
}
function leerCookie(cab, nombre) {
  for (const p of (cab || "").split(/;\s*/)) { const i = p.indexOf("="); if (i > 0 && p.slice(0, i) === nombre) return p.slice(i + 1); }
  return "";
}
async function sesionActual(request, env) {
  const v = leerCookie(request.headers.get("Cookie"), "turno_ses");
  const [datos, firma] = v.split(".");
  if (!datos || !firma || !igual(firma, await firmar(env, datos))) return null;
  let s; try { s = JSON.parse(deB64u(datos)); } catch { return null; }
  if (!s.e || s.e < Date.now() || !TURNOS.includes(s.t)) return null;
  const persona = await env.DB.prepare("SELECT clave, nombre, pin_sal, activo FROM turno_personas WHERE clave = ?").bind(s.p).first();
  if (!persona || !persona.activo || !persona.pin_sal || persona.pin_sal.slice(0, 8) !== s.s) return null;
  return { persona: persona.clave, nombre: persona.nombre || persona.clave, turno: s.t, dia: s.d };
}
const cookie = (valor, maxAge) => `turno_ses=${valor}; Path=/turno; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;

// ---------------------------------------------------------------------------
// Fotos (llegan como data URL JPEG ya comprimido en la tablet)
// ---------------------------------------------------------------------------
async function guardarFoto(env, dataUrl, prefijo) {
  if (!dataUrl) return null;
  const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl));
  if (!m) throw new Error("foto");
  const bin = atob(m[2]);
  if (bin.length > FOTO_MAX || bin.length < 500) throw new Error("foto");
  const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const llave = `tf:${prefijo}:${crypto.randomUUID()}`;
  await env.FILES.put(llave, bytes, { expirationTtl: FOTO_TTL, metadata: { tipo: "image/" + m[1] } });
  return llave;
}
export async function servirFoto(env, llave) {
  try { llave = decodeURIComponent(llave || ""); } catch { llave = ""; }
  if (!/^tf:[a-z]+:[0-9a-f-]{36}$/.test(llave || "")) return new Response("No encontrado", { status: 404 });
  const r = await env.FILES.getWithMetadata(llave, { type: "arrayBuffer" });
  if (!r || !r.value) return new Response("La foto ya no está disponible.", { status: 404 });
  return new Response(r.value, { headers: { "Content-Type": (r.metadata && r.metadata.tipo) || "image/jpeg", "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff" } });
}

// ---------------------------------------------------------------------------
// Datos que ve el encargado
// ---------------------------------------------------------------------------
async function estado(env, s) {
  const hoy = local().dia;
  const avisos = (await env.DB.prepare("SELECT id, titulo, detalle, fecha, prioridad, creado FROM agenda_items WHERE tipo = 'aviso' AND estado = 'activo' AND (fecha IS NULL OR fecha <= ?) ORDER BY creado DESC LIMIT 30").bind(hoy).all()).results;
  const leidos = new Set((await env.DB.prepare("SELECT item_id FROM agenda_lecturas WHERE persona = ?").bind(s.persona).all()).results.map(r => r.item_id));
  for (const a of avisos) a.leido = leidos.has(a.id);
  const tareas = (await env.DB.prepare(`SELECT id, titulo, detalle, fecha, hora, prioridad, turno FROM agenda_items
    WHERE tipo = 'tarea' AND para_turno = 1 AND ${ABIERTO} AND (turno IS NULL OR turno = ?) AND (fecha IS NULL OR fecha <= ?)
    ORDER BY CASE prioridad WHEN 'alta' THEN 0 ELSE 1 END, COALESCE(fecha, '9999'), creado LIMIT 50`).bind(s.turno, hoy).all()).results;
  const hechas = (await env.DB.prepare(`SELECT id, titulo, hecho_por, nota_cierre, cerrado FROM agenda_items WHERE tipo = 'tarea' AND para_turno = 1 AND estado = 'hecho' AND cerrado >= ? ORDER BY cerrado DESC LIMIT 10`)
    .bind(new Date(Date.now() - 864e5).toISOString()).all()).results;
  const incidencias = (await env.DB.prepare(`SELECT id, titulo, detalle, area, gravedad, estado, fecha, reporto, turno, creado, foto IS NOT NULL AS con_foto FROM agenda_items
    WHERE tipo = 'incidencia' AND (${ABIERTO} OR cerrado >= ?) ORDER BY CASE estado WHEN 'resuelta' THEN 1 ELSE 0 END, creado DESC LIMIT 20`).bind(new Date(Date.now() - 3 * 864e5).toISOString()).all()).results;
  const gastos = (await env.DB.prepare("SELECT id, concepto, monto, persona, creado, foto IS NOT NULL AS con_foto FROM caja_gastos WHERE dia = ? AND turno = ? ORDER BY creado").bind(s.dia, s.turno).all()).results;
  const corte = await env.DB.prepare("SELECT persona, efectivo, tarjeta, notas, actualizado, veces FROM turno_cortes WHERE dia = ? AND turno = ?").bind(s.dia, s.turno).first();
  return { ...s, hoy, avisos, tareas, hechas, incidencias, gastos, corte: corte || null, areas: AREAS, conceptos: CONCEPTOS };
}

// ---------------------------------------------------------------------------
// Rutas de la tablet: /turno y /turno/api/...
// ---------------------------------------------------------------------------
export async function turnoRuta(request, env, url, h) {
  const acceso = await h.verificarAcceso(request, env, "turno");
  if (acceso.error) return new Response(h.paginaBloqueada(acceso.error), { status: acceso.status, headers: { "Content-Type": "text/html; charset=utf-8", ...h.cabeceras() } });

  const ruta = url.pathname.replace(/\/+$/, "") || "/turno";
  if (ruta === "/turno" && request.method === "GET") return new Response(h.html, { headers: { "Content-Type": "text/html; charset=utf-8", ...h.cabeceras() } });
  if (ruta === "/turno/manifest.webmanifest") return new Response(JSON.stringify(MANIFIESTO), { headers: { "Content-Type": "application/manifest+json", "Cache-Control": "no-store" } });
  if (!ruta.startsWith("/turno/api/")) return new Response("No encontrado", { status: 404, headers: h.cabeceras() });

  if (request.method !== "GET") {
    const origin = request.headers.get("Origin");
    if ((origin && origin !== url.origin) || request.headers.get("X-Turno") !== "1") return json({ ok: false, error: "Solicitud no permitida." }, 403);
  }
  await asegurarEsquemaTurno(env);
  const partes = ruta.split("/").slice(3);

  if (partes[0] === "personas" && request.method === "GET") {
    const filas = (await env.DB.prepare("SELECT clave, nombre, pin_hash IS NOT NULL AS tiene_pin FROM turno_personas WHERE activo = 1 ORDER BY clave").all()).results;
    return json({ ok: true, personas: filas.map(p => ({ clave: p.clave, nombre: p.nombre || p.clave, tiene_pin: !!p.tiene_pin })), turnos: TURNOS, sugerido: turnoSugerido() });
  }

  if (partes[0] === "entrar" && request.method === "POST") {
    let c; try { c = await request.json(); } catch { return json({ ok: false, error: "Datos inválidos." }, 400); }
    const clave = String(c.clave || ""), pin = String(c.pin || ""), turno = String(c.turno || "");
    if (!TURNOS.includes(turno)) return json({ ok: false, error: "Elige tu turno." }, 422);
    const p = await env.DB.prepare("SELECT * FROM turno_personas WHERE clave = ? AND activo = 1").bind(clave).first();
    if (!p) return json({ ok: false, error: "Elige tu nombre." }, 422);
    if (!p.pin_hash) return json({ ok: false, error: "Todavía no tienes PIN. Pídeselo a la administración." }, 422);
    const ahora = new Date();
    if (p.bloqueado_hasta && p.bloqueado_hasta > ahora.toISOString()) {
      const min = Math.ceil((Date.parse(p.bloqueado_hasta) - ahora) / 60000);
      return json({ ok: false, error: `Demasiados intentos. Espera ${min} min o pide ayuda a la administración.`, bloqueado: true }, 429);
    }
    if (!/^\d{4}$/.test(pin) || !igual(await hashPin(pin, p.pin_sal), p.pin_hash)) {
      const fallas = (p.fallas || 0) + 1;
      const bloquear = fallas >= MAX_FALLAS;
      await env.DB.prepare("UPDATE turno_personas SET fallas = ?, bloqueado_hasta = ? WHERE clave = ?")
        .bind(bloquear ? 0 : fallas, bloquear ? new Date(ahora.getTime() + BLOQUEO_MIN * 60000).toISOString() : null, clave).run();
      return json({ ok: false, error: bloquear ? `PIN incorrecto. Se bloqueó ${BLOQUEO_MIN} minutos.` : `PIN incorrecto. Te quedan ${MAX_FALLAS - fallas} intentos.`, bloqueado: bloquear }, 401);
    }
    await env.DB.prepare("UPDATE turno_personas SET fallas = 0, bloqueado_hasta = NULL, ultimo_acceso = ? WHERE clave = ?").bind(ahora.toISOString(), clave).run();
    const ses = await crearSesion(env, p, turno, diaDeTurno(turno, ahora));
    return json({ ok: true }, 200, { "Set-Cookie": cookie(ses, SESION_HORAS * 3600) });
  }

  if (partes[0] === "salir" && request.method === "POST") return json({ ok: true }, 200, { "Set-Cookie": cookie("", 0) });

  const s = await sesionActual(request, env);
  if (!s) return json({ ok: false, error: "Tu sesión terminó. Vuelve a entrar con tu PIN.", sesion: false }, 401, { "Set-Cookie": cookie("", 0) });

  if (partes[0] === "estado" && request.method === "GET") return json({ ok: true, ...(await estado(env, s)) });

  if (partes[0] === "foto" && request.method === "GET") return servirFoto(env, partes[1]);

  let c = {};
  if (request.method === "POST") { try { c = await request.json(); } catch { return json({ ok: false, error: "Datos inválidos." }, 400); } }
  const ahora = new Date().toISOString();

  // Aviso leído
  if (partes[0] === "avisos" && partes[2] === "enterado" && request.method === "POST") {
    const a = await env.DB.prepare("SELECT id FROM agenda_items WHERE id = ? AND tipo = 'aviso'").bind(partes[1]).first();
    if (!a) return json({ ok: false, error: "Ese aviso ya no existe." }, 404);
    await env.DB.prepare("INSERT OR IGNORE INTO agenda_lecturas (item_id, persona, at) VALUES (?, ?, ?)").bind(a.id, s.persona, ahora).run();
    return json({ ok: true });
  }

  // Tarea terminada (con nota y foto opcionales)
  if (partes[0] === "tareas" && partes[2] === "hecho" && request.method === "POST") {
    const t = await env.DB.prepare(`SELECT id, foto FROM agenda_items WHERE id = ? AND tipo = 'tarea' AND para_turno = 1 AND ${ABIERTO}`).bind(partes[1]).first();
    if (!t) return json({ ok: false, error: "Esa tarea ya no está pendiente." }, 404);
    let foto = null;
    try { foto = await guardarFoto(env, c.foto, "tarea"); } catch { return json({ ok: false, error: "La foto no es válida. Tómala otra vez." }, 422); }
    await env.DB.prepare("UPDATE agenda_items SET estado = 'hecho', cerrado = ?, actualizado = ?, hecho_por = ?, nota_cierre = ?, foto = COALESCE(?, foto) WHERE id = ?")
      .bind(ahora, ahora, s.persona, texto(c.nota, 500) || null, foto, t.id).run();
    return json({ ok: true });
  }

  // Incidencia nueva
  if (partes[0] === "incidencias" && partes.length === 1 && request.method === "POST") {
    const area = AREAS.includes(c.area) ? c.area : null;
    const { d, e } = validarItem("incidencia", { titulo: c.titulo, detalle: c.detalle, gravedad: c.gravedad, turno: s.turno, area });
    if (!area) e.area = "Elige dónde pasó.";
    if (Object.keys(e).length) return json({ ok: false, error: "Revisa los datos.", errores: e }, 422);
    d.fecha = local().dia;
    let foto = null;
    try { foto = await guardarFoto(env, c.foto, "incid"); } catch { return json({ ok: false, error: "La foto no es válida. Tómala otra vez." }, 422); }
    const id = crypto.randomUUID();
    await insertarItem(env, id, "incidencia", d, `tablet:${s.persona}`, ahora, { reporto: s.persona, foto });
    let avisado = false;
    if (d.gravedad === "grave" && h.llamarScript && env.AVISO_URL && env.AVISO_TOKEN) {
      try { await h.llamarScript(env, correoIncidencia(d, s)); avisado = true; } catch (err) { console.error("incidencia grave: correo", err && err.message); }
    }
    return json({ ok: true, id, avisado });
  }

  // Gasto de caja chica (siempre en efectivo, con foto del comprobante)
  if (partes[0] === "gastos" && partes.length === 1 && request.method === "POST") {
    const concepto = texto(c.concepto, 120), monto = numero(c.monto);
    const errores = {};
    if (concepto.length < 2) errores.concepto = "Escribe en qué se gastó.";
    if (!(monto > 0) || monto > 20000) errores.monto = "Escribe un monto válido.";
    if (!c.foto) errores.foto = "Toma la foto del ticket o comprobante.";
    if (Object.keys(errores).length) return json({ ok: false, error: "Revisa los datos del gasto.", errores }, 422);
    let foto;
    try { foto = await guardarFoto(env, c.foto, "gasto"); } catch { return json({ ok: false, error: "La foto no es válida. Tómala otra vez.", errores: { foto: "Foto inválida." } }, 422); }
    const id = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO caja_gastos (id, mes, dia, turno, concepto, monto, forma, creado, creado_por, foto, persona) VALUES (?, ?, ?, ?, ?, ?, 'EFECTIVO', ?, ?, ?, ?)")
      .bind(id, mesActual(), s.dia, s.turno, concepto, monto, ahora, `tablet:${s.persona}`, foto, s.persona).run();
    return json({ ok: true, id });
  }
  // Borrar un gasto propio mientras el turno sigue abierto (antes del corte)
  if (partes[0] === "gastos" && partes[2] === "eliminar" && request.method === "POST") {
    const corte = await env.DB.prepare("SELECT 1 FROM turno_cortes WHERE dia = ? AND turno = ?").bind(s.dia, s.turno).first();
    if (corte) return json({ ok: false, error: "El corte ya se entregó. Pide a la administración que lo corrija." }, 409);
    const g = await env.DB.prepare("SELECT id, foto FROM caja_gastos WHERE id = ? AND persona = ? AND dia = ? AND turno = ?").bind(partes[1], s.persona, s.dia, s.turno).first();
    if (!g) return json({ ok: false, error: "Solo puedes borrar tus gastos de este turno." }, 404);
    await env.DB.prepare("DELETE FROM caja_gastos WHERE id = ?").bind(g.id).run();
    if (g.foto) await env.FILES.delete(g.foto).catch(() => {});
    return json({ ok: true });
  }

  // Corte ciego
  if (partes[0] === "corte" && request.method === "POST") {
    const efectivo = numero(c.efectivo), tarjeta = c.tarjeta === "" || c.tarjeta == null ? null : numero(c.tarjeta);
    const errores = {};
    if (!(efectivo >= 0) || efectivo > 1000000) errores.efectivo = "Escribe el efectivo que contaste.";
    if (tarjeta !== null && (!(tarjeta >= 0) || tarjeta > 1000000)) errores.tarjeta = "Monto inválido.";
    if (Object.keys(errores).length) return json({ ok: false, error: "Revisa el corte.", errores }, 422);
    await env.DB.prepare(`INSERT INTO turno_cortes (dia, turno, mes, persona, efectivo, tarjeta, notas, creado, actualizado, veces) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
      ON CONFLICT (dia, turno) DO UPDATE SET persona = excluded.persona, efectivo = excluded.efectivo, tarjeta = excluded.tarjeta, notas = excluded.notas, actualizado = excluded.actualizado, veces = turno_cortes.veces + 1`)
      .bind(s.dia, s.turno, mesActual(), s.persona, efectivo, tarjeta, texto(c.notas, 500) || null, ahora, ahora).run();
    return json({ ok: true });
  }

  return json({ ok: false, error: "Ruta no encontrada." }, 404);
}

const escHtml = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function correoIncidencia(d, s) {
  return {
    asunto: `Incidencia grave: ${d.titulo}`.slice(0, 180),
    texto: `Incidencia grave reportada desde la tablet.\n\n${d.titulo}\nDónde: ${d.area}\nReportó: ${s.nombre} · turno ${s.turno}${d.detalle ? "\n\n" + d.detalle : ""}\n\nAgenda: https://basculaypension.com/panel#agenda`,
    html: `<div style="font-family:system-ui,sans-serif;font-size:15px"><p style="color:#b42318;margin:0;font-weight:600">Incidencia grave · tablet de turno</p><h2 style="margin:4px 0 8px">${escHtml(d.titulo)}</h2><p style="margin:0 0 4px"><b>Dónde:</b> ${escHtml(d.area)}</p><p style="margin:0 0 12px"><b>Reportó:</b> ${escHtml(s.nombre)} · turno ${escHtml(s.turno)}</p>${d.detalle ? `<p>${escHtml(d.detalle)}</p>` : ""}<p><a href="https://basculaypension.com/panel#agenda">Abrir la agenda</a></p></div>`
  };
}

const MANIFIESTO = {
  name: "Turno · El Castaño", short_name: "Turno", start_url: "/turno", scope: "/turno", display: "standalone",
  background_color: "#111214", theme_color: "#111214", orientation: "any",
  icons: [{ src: "/icon-192.png", sizes: "192x192", type: "image/png" }, { src: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }]
};

// ---------------------------------------------------------------------------
// Administración desde el panel: /panel/api/turno/...
// ---------------------------------------------------------------------------
export async function turnoAdmin(request, env, url, partes) {
  await asegurarEsquemaTurno(env);

  if (partes.length === 1 && request.method === "GET") {
    const ahora = new Date().toISOString();
    const personas = (await env.DB.prepare("SELECT clave, nombre, activo, pin_hash IS NOT NULL AS tiene_pin, bloqueado_hasta, ultimo_acceso FROM turno_personas ORDER BY activo DESC, clave").all()).results
      .map(p => ({ clave: p.clave, nombre: p.nombre || p.clave, activo: !!p.activo, tiene_pin: !!p.tiene_pin, bloqueado: !!(p.bloqueado_hasta && p.bloqueado_hasta > ahora), ultimo_acceso: p.ultimo_acceso }));
    // Últimos cortes entregados con su comparación
    const conteos = (await env.DB.prepare("SELECT * FROM turno_cortes ORDER BY dia DESC, actualizado DESC LIMIT 12").all()).results;
    let cortes = [];
    if (conteos.length) {
      const dias = [...new Set(conteos.map(x => x.dia))];
      const q = dias.map(() => "?").join(",");
      const movs = (await env.DB.prepare(`SELECT * FROM caja_mov WHERE dia IN (${q})`).bind(...dias).all()).results;
      const gastos = (await env.DB.prepare(`SELECT * FROM caja_gastos WHERE dia IN (${q})`).bind(...dias).all()).results;
      const claves = new Set(conteos.map(x => x.dia + "|" + x.turno));
      cortes = unirConteos(calcularCortes(movs, gastos), conteos).filter(c => claves.has(c.dia + "|" + c.turno));
    }
    return json({ ok: true, personas, cortes });
  }

  if (partes[1] === "foto" && request.method === "GET") return servirFoto(env, partes[2]);

  if (partes[1] === "personas" && partes[3] === "eliminar" && request.method === "POST") {
    await env.DB.prepare("DELETE FROM turno_personas WHERE clave = ?").bind(partes[2]).run();
    return json({ ok: true });
  }

  if (partes[1] === "personas" && partes.length <= 3 && request.method === "POST") {
    let c; try { c = await request.json(); } catch { return json({ ok: false, error: "Datos inválidos." }, 400); }
    const clave = texto(partes[2] || c.clave, 12).toUpperCase();
    if (!/^[A-ZÑ0-9]{2,12}$/.test(clave)) return json({ ok: false, error: "La clave debe tener de 2 a 12 letras o números.", errores: { clave: "Clave inválida." } }, 422);
    const previa = await env.DB.prepare("SELECT * FROM turno_personas WHERE clave = ?").bind(clave).first();
    if (!partes[2] && previa) return json({ ok: false, error: "Ya existe esa clave.", errores: { clave: "Ya existe." } }, 409);
    if (partes[2] && !previa) return json({ ok: false, error: "No existe esa persona." }, 404);
    const nombre = "nombre" in c ? texto(c.nombre, 60) || clave : previa ? previa.nombre : clave;
    const activo = "activo" in c ? (c.activo ? 1 : 0) : previa ? previa.activo : 1;
    let pinHash = previa ? previa.pin_hash : null, sal = previa ? previa.pin_sal : null;
    if (c.pin != null && c.pin !== "") {
      const pin = String(c.pin);
      if (!/^\d{4}$/.test(pin)) return json({ ok: false, error: "El PIN debe ser de 4 números.", errores: { pin: "4 números." } }, 422);
      if (/^(\d)\1{3}$/.test(pin) || "0123456789".includes(pin) || "9876543210".includes(pin)) return json({ ok: false, error: "Ese PIN es muy fácil de adivinar. Usa otro.", errores: { pin: "Muy fácil." } }, 422);
      // Que no se repita entre encargados
      const otros = (await env.DB.prepare("SELECT clave, pin_hash, pin_sal FROM turno_personas WHERE clave != ? AND pin_hash IS NOT NULL").bind(clave).all()).results;
      for (const o of otros) if (igual(await hashPin(pin, o.pin_sal), o.pin_hash)) return json({ ok: false, error: `Ese PIN ya lo usa ${o.clave}. Elige otro.`, errores: { pin: "Repetido." } }, 422);
      sal = hex(crypto.getRandomValues(new Uint8Array(16)));
      pinHash = await hashPin(pin, sal);
    }
    const ahora = new Date().toISOString();
    if (previa) {
      await env.DB.prepare("UPDATE turno_personas SET nombre = ?, activo = ?, pin_hash = ?, pin_sal = ?, fallas = CASE WHEN ? THEN 0 ELSE fallas END, bloqueado_hasta = CASE WHEN ? THEN NULL ELSE bloqueado_hasta END WHERE clave = ?")
        .bind(nombre, activo, pinHash, sal, c.desbloquear || c.pin ? 1 : 0, c.desbloquear || c.pin ? 1 : 0, clave).run();
    } else {
      await env.DB.prepare("INSERT INTO turno_personas (clave, nombre, activo, pin_hash, pin_sal, creado) VALUES (?, ?, ?, ?, ?, ?)").bind(clave, nombre, activo, pinHash, sal, ahora).run();
    }
    return json({ ok: true, clave });
  }

  return json({ ok: false, error: "Ruta no encontrada." }, 404);
}
