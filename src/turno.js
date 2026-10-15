import { leerArchivo, borrarArchivo } from "./fotos.js";
import AV1 from "./avatares/a1.webp";
import AV2 from "./avatares/a2.webp";
import AV3 from "./avatares/a3.webp";
import AV4 from "./avatares/a4.webp";
import AV5 from "./avatares/a5.webp";
// Tablet del encargado de turno (/turno).
// Doble candado: Cloudflare Access (cuenta entrada@ o la de administración) y, encima,
// cada encargado entra con su PIN de 4 dígitos. Todo lo que captura queda a su nombre.
//
// Secciones: inicio (resumen y acciones rápidas: gasto, ingreso extra, incidencia, aviso, corte),
// avisos y tareas (avisos de ida y vuelta con la administración y entre encargados; tareas con informe),
// incidencias abiertas de todos los turnos y corte ciego (el encargado no ve cuánto debería haber).

import { asegurarEsquemaAgenda, insertarItem, validarItem, ABIERTO, AREAS, normalizarPara, avisoParaEncargado } from "./agenda.js";
import { asegurarEsquemaCaja, mesActual, TURNOS, unirConteos, calcularCortes, CONCEPTOS_EXTRA, cuentaComoIngreso, leerRetiros } from "./caja.js";

const TZ = "America/Mexico_City";
const PERSONAS_INICIALES = ["JDOM", "JESC", "JOESC", "JURB", "ERI"];
const SESION_HORAS = 14;
const MAX_FALLAS = 5, BLOQUEO_MIN = 15;
// Las fotos se guardan 100 días como máximo (KV incluye 1 GB; lo que pase de ahí se cobra aparte)
const FOTO_MAX = 1_500_000, FOTO_TTL = 100 * 86400;
// Avatares que la administración asigna a cada encargado (Agenda › Tablet de turno)
const AVATARES = { a1: AV1, a2: AV2, a3: AV3, a4: AV4, a5: AV5 };
const avatarValido = v => (Object.hasOwn(AVATARES, v) || v === "foto" ? v : null);
// Personalización que cada encargado elige en "Mi perfil" (se guarda en su registro y lo sigue en cualquier tablet)
export const ACENTOS = { amarillo: "#ffcc00", naranja: "#ff9f0a", rosa: "#ff8fc7", morado: "#b69cff", azul: "#64d2ff", turquesa: "#2dd4bf" };
const LETRAS = ["normal", "grande", "muy-grande"];
const FOTO_PERFIL_MAX = 200_000;
function leerPrefs(v) {
  let p = {}; try { p = JSON.parse(v || "{}") || {}; } catch {}
  return { acento: Object.hasOwn(ACENTOS, p.acento) ? p.acento : "amarillo", letra: LETRAS.includes(p.letra) ? p.letra : "normal", apodo: texto(p.apodo, 20) };
}
// Dirección de la imagen de perfil (galería o foto propia); base distinta para la tablet y el panel
function urlAvatar(p, panel) {
  const a = avatarValido(p.avatar);
  if (!a) return null;
  if (a === "foto") return p.foto_ver ? (panel ? `/panel/api/turno/avatar/p/${encodeURIComponent(p.clave)}/${p.foto_ver}` : `/turno/avatar/p/${encodeURIComponent(p.clave)}/${p.foto_ver}.jpg`) : null;
  return panel ? `/panel/api/turno/avatar/${a}` : `/turno/avatar/${a}.webp`;
}
// Imagen de perfil por clave (para acompañar avisos, incidencias, cortes...). "admin" usa el logo de la pensión;
// sin imagen asignada se dibuja un círculo con las iniciales.
async function servirAvatarDe(env, clave, urlBase) {
  clave = String(clave || "").toUpperCase();
  if (clave === "ADMIN") return Response.redirect(new URL("/img/logo.png", urlBase).toString(), 302);
  if (!/^[A-ZÑ0-9]{1,12}$/.test(clave)) return new Response("No encontrado", { status: 404 });
  const p = await env.DB.prepare("SELECT clave, avatar, foto_ver FROM turno_personas WHERE clave = ?").bind(clave).first();
  const a = p && avatarValido(p.avatar);
  let r;
  if (a === "foto" && p.foto_ver) r = await servirFotoPerfil(env, clave);
  else if (a && a !== "foto") r = servirAvatar(a);
  if (r && r.ok) { const h = new Headers(r.headers); h.set("Cache-Control", "private, max-age=300"); return new Response(r.body, { headers: h }); }
  const ini = clave.slice(0, 2);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="32" fill="#2a2a2d"/><text x="32" y="40" text-anchor="middle" font-family="system-ui,sans-serif" font-size="22" font-weight="800" fill="#d2d2d7">${ini}</text></svg>`;
  return new Response(svg, { headers: { "Content-Type": "image/svg+xml", "Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff" } });
}
async function servirFotoPerfil(env, clave) {
  const v = await env.FILES.get("perfil:" + String(clave || "").toUpperCase(), { type: "arrayBuffer" });
  if (!v) return new Response("No encontrado", { status: 404 });
  return new Response(v, { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=2592000, immutable", "X-Content-Type-Options": "nosniff" } });
}
export function servirAvatar(id) {
  const datos = Object.hasOwn(AVATARES, id) ? AVATARES[id] : null;
  if (!datos) return new Response("No encontrado", { status: 404 });
  return new Response(datos, { headers: { "Content-Type": "image/webp", "Cache-Control": "private, max-age=2592000, immutable", "X-Content-Type-Options": "nosniff" } });
}
const CONCEPTOS = ["Agua", "Limpieza", "Papelería", "Refacción", "Comida de turno", "Gasolina", "Otro"];

const json = (obj, status = 200, extra = {}) => new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...extra } });
const texto = (v, n) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);
// Montos capturados: solo dígitos con hasta 2 decimales (no "1e4" ni negativos)
const numero = v => { const t = String(v ?? "").replace(/[$,\s]/g, ""); return /^\d{1,9}(\.\d{1,2})?$/.test(t) ? Number(t) : NaN; };
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
  const colsP = new Set((await env.DB.prepare("PRAGMA table_info(turno_personas)").all()).results.map(c => c.name));
  for (const col of ["avatar", "avatar_base", "foto_ver", "prefs", "colaborador"]) if (!colsP.has(col)) await env.DB.prepare(`ALTER TABLE turno_personas ADD COLUMN ${col} TEXT`).run();
  // Avatares asignados antes de existir el "avatar base"
  await env.DB.prepare("UPDATE turno_personas SET avatar_base = avatar WHERE avatar_base IS NULL AND avatar IN ('a1','a2','a3','a4','a5')").run();
  // Turno abierto sin corte: mientras exista, nadie más puede entrar a otro turno (una sola fila)
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS turno_abierto (id INTEGER PRIMARY KEY CHECK (id = 1), persona TEXT NOT NULL, dia TEXT NOT NULL, turno TEXT NOT NULL, desde TEXT NOT NULL)").run();
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
// Con el plan Workers Paid hay hasta 30 s de CPU por petición, así que el PIN se deriva con
// 100 000 iteraciones de PBKDF2 (el máximo que admite Workers).
// Formatos guardados: "v3$" (100 000, actual), "v2$" (2 000, plan gratuito) y sin prefijo (20 000).
// Los v2 y sin prefijo se siguen aceptando y se convierten a v3 al entrar con el PIN correcto.
const ITER_V3 = 100000;
async function derivar(pin, sal, iteraciones) {
  const llave = await crypto.subtle.importKey("raw", enc.encode(pin), "PBKDF2", false, ["deriveBits"]);
  return hex(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: enc.encode(sal), iterations: iteraciones }, llave, 256));
}
const hashPin = async (pin, sal) => "v3$" + await derivar(pin, sal, ITER_V3);
const pinViejo = guardado => !String(guardado || "").startsWith("v3$");
async function pinCorrecto(pin, sal, guardado) {
  if (!guardado) return false;
  const calculado = guardado.startsWith("v3$") ? await hashPin(pin, sal)
    : guardado.startsWith("v2$") ? "v2$" + await derivar(pin, sal, 2000)
    : await derivar(pin, sal, 20000);
  return igual(calculado, guardado);
}
function igual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
let secretoCache = null;
async function secreto(env) {
  if (secretoCache) return secretoCache;
  let s = await env.FILES.get("turno:secreto");
  if (!s) { s = hex(crypto.getRandomValues(new Uint8Array(32))); await env.FILES.put("turno:secreto", s); }
  return (secretoCache = s);
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
  const persona = await env.DB.prepare("SELECT clave, nombre, pin_sal, activo, avatar, avatar_base, foto_ver, prefs FROM turno_personas WHERE clave = ?").bind(s.p).first();
  if (!persona || !persona.activo || !persona.pin_sal || persona.pin_sal.slice(0, 8) !== s.s) return null;
  return { persona: persona.clave, nombre: persona.nombre || persona.clave, avatar: avatarValido(persona.avatar), avatar_base: Object.hasOwn(AVATARES, persona.avatar_base) ? persona.avatar_base : null, avatar_url: urlAvatar(persona), tiene_foto: !!persona.foto_ver, prefs: leerPrefs(persona.prefs), turno: s.t, dia: s.d };
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
  const r = await leerArchivo(env, llave);
  if (!r || !r.value) return new Response("La foto ya no está disponible.", { status: 404 });
  return new Response(r.value, { headers: { "Content-Type": (r.metadata && r.metadata.tipo) || "image/jpeg", "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff" } });
}

// ---------------------------------------------------------------------------
// Datos que ve el encargado
// ---------------------------------------------------------------------------
async function estado(env, s) {
  const hoy = local().dia;
  const personas = (await env.DB.prepare("SELECT clave, nombre, avatar, foto_ver FROM turno_personas WHERE activo = 1 ORDER BY clave").all()).results.map(p => ({ clave: p.clave, nombre: p.nombre || p.clave, avatar_url: urlAvatar(p) }));
  // Avisos: de la administración y de los encargados, solo los dirigidos a esta persona o a su turno (más los propios)
  const todos = (await env.DB.prepare("SELECT id, titulo, detalle, fecha, prioridad, creado, autor, para FROM agenda_items WHERE tipo = 'aviso' AND estado = 'activo' AND (fecha IS NULL OR fecha <= ?) ORDER BY creado DESC LIMIT 150").bind(hoy).all()).results;
  const leidos = new Set((await env.DB.prepare("SELECT item_id FROM agenda_lecturas WHERE persona = ?").bind(s.persona).all()).results.map(r => r.item_id));
  const avisos = todos.filter(a => avisoParaEncargado(a, s.persona, s.turno)).slice(0, 50)
    .map(a => ({ ...a, autor: a.autor || "admin", para: normalizarPara(a.para), propio: a.autor === s.persona, leido: a.autor === s.persona || leidos.has(a.id) }));
  // Tareas del turno, urgentes primero, con los informes que ya se mandaron
  const tareas = (await env.DB.prepare(`SELECT id, titulo, detalle, fecha, hora, prioridad, turno FROM agenda_items
    WHERE tipo = 'tarea' AND para_turno = 1 AND ${ABIERTO} AND (turno IS NULL OR turno = ?) AND (fecha IS NULL OR fecha <= ?)
    ORDER BY CASE prioridad WHEN 'alta' THEN 0 ELSE 1 END, COALESCE(fecha, '9999'), creado LIMIT 50`).bind(s.turno, hoy).all()).results;
  if (tareas.length) {
    const q = tareas.map(() => "?").join(",");
    const reps = (await env.DB.prepare(`SELECT item_id, persona, turno, resultado, nota, creado FROM agenda_reportes WHERE item_id IN (${q}) ORDER BY creado DESC`).bind(...tareas.map(t => t.id)).all()).results;
    for (const t of tareas) t.reportes = reps.filter(r => r.item_id === t.id).slice(0, 3);
  }
  const hechas = (await env.DB.prepare(`SELECT id, titulo, hecho_por, nota_cierre, cerrado FROM agenda_items WHERE tipo = 'tarea' AND para_turno = 1 AND estado = 'hecho' AND cerrado >= ? ORDER BY cerrado DESC LIMIT 10`)
    .bind(new Date(Date.now() - 864e5).toISOString()).all()).results;
  // Incidencias abiertas de todos los turnos, hasta que la administración las resuelva
  const incidencias = (await env.DB.prepare(`SELECT id, titulo, detalle, area, gravedad, estado, fecha, reporto, quien, turno, creado, foto FROM agenda_items
    WHERE tipo = 'incidencia' AND ${ABIERTO} ORDER BY CASE gravedad WHEN 'grave' THEN 0 WHEN 'media' THEN 1 ELSE 2 END, creado DESC LIMIT 100`).all()).results;
  const gastos = (await env.DB.prepare("SELECT id, concepto, monto, persona, creado, foto IS NOT NULL AS con_foto FROM caja_gastos WHERE dia = ? AND turno = ? ORDER BY creado").bind(s.dia, s.turno).all()).results;
  const extras = (await env.DB.prepare("SELECT id, concepto, detalle, monto, ingreso, persona, creado, foto IS NOT NULL AS con_foto FROM caja_extra WHERE dia = ? AND turno = ? ORDER BY creado").bind(s.dia, s.turno).all()).results;
  const corte = await env.DB.prepare("SELECT persona, efectivo, tarjeta, notas, actualizado, veces, con_cambio, sobre, cambio_sig, retiros FROM turno_cortes WHERE dia = ? AND turno = ?").bind(s.dia, s.turno).first();
  const inicio = await env.DB.prepare("SELECT cambio, persona, actualizado FROM turno_inicio WHERE dia = ? AND turno = ?").bind(s.dia, s.turno).first();
  // Lo que dejó de cambio el turno anterior (referencia para el cambio inicial)
  const anterior = inicio ? null : await env.DB.prepare("SELECT persona, dia, turno, cambio_sig FROM turno_cortes WHERE NOT (dia = ? AND turno = ?) AND cambio_sig IS NOT NULL ORDER BY actualizado DESC LIMIT 1").bind(s.dia, s.turno).first();
  if (corte) {
    corte.retiros = leerRetiros(corte.retiros);
    // Gastos o ingresos capturados después de entregar el corte: hay que volver a entregarlo
    corte.cambios_despues = [...gastos, ...extras].filter(x => x.creado > corte.actualizado).length;
  }
  return { ...s, hoy, personas, acentos: ACENTOS, inicio: inicio || null, cambio_anterior: anterior || null, avisos, tareas, hechas, incidencias, gastos, extras, corte: corte || null, areas: AREAS, conceptos: CONCEPTOS, conceptos_extra: CONCEPTOS_EXTRA, turnos: TURNOS };
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
  // Service worker: abre la tablet aunque no haya internet (la página y el logo quedan guardados)
  if (ruta === "/turno/sw.js") return new Response(SW, { headers: { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-cache", "Service-Worker-Allowed": "/turno" } });
  const av = /^\/turno\/avatar\/(a\d)\.webp$/.exec(ruta);
  if (av && request.method === "GET") return servirAvatar(av[1]);
  const ac = /^\/turno\/avatar\/c\/([^/]{1,40})$/.exec(ruta);
  if (ac && request.method === "GET") { let cl = ""; try { cl = decodeURIComponent(ac[1]); } catch {} return servirAvatarDe(env, cl, url); }
  const fp = /^\/turno\/avatar\/p\/([A-ZÑ0-9%]{2,40})\/[a-z0-9]{4,16}\.jpg$/.exec(ruta);
  if (fp && request.method === "GET") { let cl = ""; try { cl = decodeURIComponent(fp[1]); } catch {} return servirFotoPerfil(env, cl); }
  if (!ruta.startsWith("/turno/api/")) return new Response("No encontrado", { status: 404, headers: h.cabeceras() });

  if (request.method !== "GET") {
    const origin = request.headers.get("Origin");
    if ((origin && origin !== url.origin) || request.headers.get("X-Turno") !== "1") return json({ ok: false, error: "Solicitud no permitida." }, 403);
  }
  await asegurarEsquemaTurno(env);
  const partes = ruta.split("/").slice(3);

  if (partes[0] === "personas" && request.method === "GET") {
    const filas = (await env.DB.prepare("SELECT clave, nombre, avatar, foto_ver, pin_hash IS NOT NULL AS tiene_pin FROM turno_personas WHERE activo = 1 ORDER BY clave").all()).results;
    let ab = await env.DB.prepare("SELECT persona, dia, turno FROM turno_abierto WHERE id = 1").first();
    if (ab && await env.DB.prepare("SELECT 1 FROM turno_cortes WHERE dia = ? AND turno = ?").bind(ab.dia, ab.turno).first()) ab = null;
    return json({ ok: true, personas: filas.map(p => ({ clave: p.clave, nombre: p.nombre || p.clave, avatar_url: urlAvatar(p), tiene_pin: !!p.tiene_pin })), turnos: TURNOS, sugerido: ab ? ab.turno : turnoSugerido(), abierto: ab || null });
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
    if (!/^\d{4}$/.test(pin) || !(await pinCorrecto(pin, p.pin_sal, p.pin_hash))) {
      const fallas = (p.fallas || 0) + 1;
      const bloquear = fallas >= MAX_FALLAS;
      await env.DB.prepare("UPDATE turno_personas SET fallas = ?, bloqueado_hasta = ? WHERE clave = ?")
        .bind(bloquear ? 0 : fallas, bloquear ? new Date(ahora.getTime() + BLOQUEO_MIN * 60000).toISOString() : null, clave).run();
      return json({ ok: false, error: bloquear ? `PIN incorrecto. Se bloqueó ${BLOQUEO_MIN} minutos.` : `PIN incorrecto. Te quedan ${MAX_FALLAS - fallas} intentos.`, bloqueado: bloquear }, 401);
    }
    await env.DB.prepare("UPDATE turno_personas SET fallas = 0, bloqueado_hasta = NULL, ultimo_acceso = ? WHERE clave = ?").bind(ahora.toISOString(), clave).run();
    // PIN guardado con el formato anterior: se vuelve a guardar con 100 000 iteraciones (misma sal, la sesión no cambia)
    if (pinViejo(p.pin_hash)) await env.DB.prepare("UPDATE turno_personas SET pin_hash = ? WHERE clave = ?").bind(await hashPin(pin, p.pin_sal), clave).run();
    // Se puede salir sin entregar el corte, pero nadie más entra (ni a otro turno) hasta que se entregue
    const diaNuevo = diaDeTurno(turno, ahora);
    const ab = await env.DB.prepare("SELECT * FROM turno_abierto WHERE id = 1").first();
    if (ab) {
      const cerrado = await env.DB.prepare("SELECT 1 FROM turno_cortes WHERE dia = ? AND turno = ?").bind(ab.dia, ab.turno).first();
      if (cerrado) await env.DB.prepare("DELETE FROM turno_abierto WHERE id = 1").run();
      else if (ab.persona !== clave || ab.dia !== diaNuevo || ab.turno !== turno) {
        const cual = `del turno de la ${String(ab.turno).toLowerCase()} del ${ab.dia.slice(8, 10)}/${ab.dia.slice(5, 7)}`;
        return json({ ok: false, error: ab.persona === clave
          ? `Primero entrega el corte ${cual}: entra eligiendo ese turno.`
          : `Falta el corte ${cual}, que abrió ${ab.persona}. ${ab.persona} debe entrar y entregarlo, o la administración puede liberarlo desde el panel.`, turno_abierto: { persona: ab.persona, dia: ab.dia, turno: ab.turno } }, 409);
      }
    }
    if (!(await env.DB.prepare("SELECT 1 FROM turno_cortes WHERE dia = ? AND turno = ?").bind(diaNuevo, turno).first()))
      await env.DB.prepare("INSERT INTO turno_abierto (id, persona, dia, turno, desde) VALUES (1, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET persona = excluded.persona, dia = excluded.dia, turno = excluded.turno, desde = CASE WHEN turno_abierto.dia = excluded.dia AND turno_abierto.turno = excluded.turno THEN turno_abierto.desde ELSE excluded.desde END")
        .bind(clave, diaNuevo, turno, ahora.toISOString()).run();
    const ses = await crearSesion(env, p, turno, diaNuevo);
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

  // Envíos repetidos (modo sin conexión o red inestable): el mismo uid devuelve la misma respuesta
  let llaveUid = null;
  if (request.method === "POST" && /^[a-z0-9-]{8,40}$/i.test(String(c.uid || ""))) {
    llaveUid = `uid:${s.persona}:${c.uid}`;
    const previo = await env.FILES.get(llaveUid);
    if (previo) return new Response(previo, { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
  }
  const recordar = async r => { if (llaveUid && r.status < 300) await env.FILES.put(llaveUid, await r.clone().text(), { expirationTtl: 3 * 86400 }); return r; };
  const sinCorte = async () => !(await env.DB.prepare("SELECT 1 FROM turno_cortes WHERE dia = ? AND turno = ?").bind(s.dia, s.turno).first());
  const errFoto = () => json({ ok: false, error: "La foto no es válida. Tómala otra vez.", errores: { foto: "Foto inválida." } }, 422);

  // ---- Mi perfil: imagen (avatar de la galería o foto propia) y personalización ----
  if (partes[0] === "perfil" && request.method === "POST") {
    const p = c.prefs || {};
    if (p.acento && !Object.hasOwn(ACENTOS, p.acento)) return json({ ok: false, error: "Color no válido." }, 422);
    if (p.letra && !LETRAS.includes(p.letra)) return json({ ok: false, error: "Tamaño no válido." }, 422);
    const prefs = leerPrefs(JSON.stringify(p));
    const fila = await env.DB.prepare("SELECT foto_ver FROM turno_personas WHERE clave = ?").bind(s.persona).first();
    let avatar = c.avatar === "" || c.avatar == null ? null : avatarValido(String(c.avatar));
    // Cada quien solo puede usar su avatar base (el que le asignó la administración), su foto o sus iniciales
    if (c.avatar && (!avatar || (avatar !== "foto" && avatar !== s.avatar_base))) return json({ ok: false, error: "Imagen no válida." }, 422);
    let fotoVer = fila && fila.foto_ver;
    if (c.foto) {
      const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(String(c.foto));
      if (!m) return errFoto();
      const bin = atob(m[1]);
      if (bin.length > FOTO_PERFIL_MAX || bin.length < 500) return errFoto();
      const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      await env.FILES.put("perfil:" + s.persona, bytes);
      fotoVer = Date.now().toString(36);
      avatar = "foto";
    } else if (avatar === "foto" && !fotoVer) return json({ ok: false, error: "Primero sube tu foto." }, 422);
    if (avatar !== "foto" && fotoVer) { await env.FILES.delete("perfil:" + s.persona); fotoVer = null; }
    await env.DB.prepare("UPDATE turno_personas SET avatar = ?, foto_ver = ?, prefs = ? WHERE clave = ?").bind(avatar, fotoVer, JSON.stringify(prefs), s.persona).run();
    return json({ ok: true, avatar, avatar_url: urlAvatar({ clave: s.persona, avatar, foto_ver: fotoVer }), prefs });
  }

  // ---- Avisos ----
  if (partes[0] === "avisos" && partes.length === 1 && request.method === "POST") {
    const { d, e } = validarItem("aviso", { titulo: c.titulo, detalle: c.detalle, prioridad: c.prioridad === "alta" ? "alta" : "normal", para: c.para });
    if (Object.keys(e).length) return json({ ok: false, error: "Escribe el aviso.", errores: e }, 422);
    const id = crypto.randomUUID();
    await insertarItem(env, id, "aviso", d, `tablet:${s.persona}`, ahora, { autor: s.persona });
    return recordar(json({ ok: true, id }));
  }
  if (partes[0] === "avisos" && partes[2] && request.method === "POST") {
    const a = await env.DB.prepare("SELECT id, autor, para FROM agenda_items WHERE id = ? AND tipo = 'aviso'").bind(partes[1]).first();
    if (!a || !avisoParaEncargado(a, s.persona, s.turno)) return json({ ok: false, error: "Ese aviso ya no existe." }, 404);
    if (partes[2] === "enterado") {
      await env.DB.prepare("INSERT OR IGNORE INTO agenda_lecturas (item_id, persona, at) VALUES (?, ?, ?)").bind(a.id, s.persona, ahora).run();
      return json({ ok: true });
    }
    if (partes[2] === "archivar") {
      if (a.autor !== s.persona) return json({ ok: false, error: "Solo puedes quitar tus propios avisos." }, 403);
      await env.DB.prepare("UPDATE agenda_items SET estado = 'archivado', cerrado = ?, actualizado = ? WHERE id = ?").bind(ahora, ahora, a.id).run();
      return json({ ok: true });
    }
  }

  // ---- Informe de una tarea: cumplida (se cierra), parcial o no se pudo (sigue abierta) ----
  if (partes[0] === "tareas" && partes[2] === "reporte" && request.method === "POST") {
    const t = await env.DB.prepare(`SELECT id, titulo, turno FROM agenda_items WHERE id = ? AND tipo = 'tarea' AND para_turno = 1 AND ${ABIERTO}`).bind(partes[1]).first();
    if (!t) return json({ ok: false, error: "Esa tarea ya no está pendiente." }, 404);
    if (t.turno && t.turno !== s.turno) return json({ ok: false, error: "Esa tarea es de otro turno." }, 403);
    const resultado = ["cumplida", "parcial", "no"].includes(c.resultado) ? c.resultado : "";
    const nota = texto(c.nota, 800);
    const errores = {};
    if (!resultado) errores.resultado = "Elige cómo quedó la tarea.";
    if (resultado && resultado !== "cumplida" && nota.length < 3) errores.nota = "Explica qué faltó o por qué no se pudo.";
    if (Object.keys(errores).length) return json({ ok: false, error: "Revisa el informe.", errores }, 422);
    let foto = null;
    try { foto = await guardarFoto(env, c.foto, "tarea"); } catch { return errFoto(); }
    await env.DB.prepare("INSERT INTO agenda_reportes (id, item_id, persona, turno, dia, resultado, nota, foto, creado) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(crypto.randomUUID(), t.id, s.persona, s.turno, s.dia, resultado, nota || null, foto, ahora).run();
    if (resultado === "cumplida")
      await env.DB.prepare("UPDATE agenda_items SET estado = 'hecho', cerrado = ?, actualizado = ?, hecho_por = ?, nota_cierre = ?, foto = COALESCE(?, foto) WHERE id = ?")
        .bind(ahora, ahora, s.persona, nota || null, foto, t.id).run();
    else await env.DB.prepare("UPDATE agenda_items SET actualizado = ? WHERE id = ?").bind(ahora, t.id).run();
    let avisado = false;
    if (h.llamarScript && env.AVISO_URL && env.AVISO_TOKEN) {
      try { await h.llamarScript(env, correoTarea(t, resultado, nota, !!foto, s)); avisado = true; } catch (err) { console.error("informe tarea: correo", err && err.message); }
    }
    return recordar(json({ ok: true, avisado }));
  }

  // ---- Incidencia nueva ----
  if (partes[0] === "incidencias" && partes.length === 1 && request.method === "POST") {
    const area = AREAS.includes(c.area) ? c.area : null;
    const quien = texto(c.quien, 60) || s.nombre;
    const { d, e } = validarItem("incidencia", { titulo: c.titulo, detalle: c.detalle, gravedad: c.gravedad, turno: s.turno, area, quien });
    if (!area) e.area = "Elige dónde pasó.";
    if (Object.keys(e).length) return json({ ok: false, error: "Revisa los datos.", errores: e }, 422);
    d.fecha = local().dia;
    let foto = null;
    try { foto = await guardarFoto(env, c.foto, "incid"); } catch { return errFoto(); }
    const id = crypto.randomUUID();
    await insertarItem(env, id, "incidencia", d, `tablet:${s.persona}`, ahora, { reporto: s.persona, foto });
    let avisado = false;
    if (d.gravedad === "grave" && h.llamarScript && env.AVISO_URL && env.AVISO_TOKEN) {
      try { await h.llamarScript(env, correoIncidencia(d, s)); avisado = true; } catch (err) { console.error("incidencia grave: correo", err && err.message); }
    }
    return recordar(json({ ok: true, id, avisado }));
  }

  // ---- Gasto de caja (en efectivo; la foto del comprobante es opcional) ----
  if (partes[0] === "gastos" && partes.length === 1 && request.method === "POST") {
    const concepto = texto(c.concepto, 120), monto = numero(c.monto);
    const errores = {};
    if (concepto.length < 2) errores.concepto = "Escribe en qué se gastó.";
    if (!(monto > 0) || monto > 20000) errores.monto = "Escribe un monto válido.";
    if (Object.keys(errores).length) return json({ ok: false, error: "Revisa los datos del gasto.", errores }, 422);
    let foto = null;
    try { foto = await guardarFoto(env, c.foto, "gasto"); } catch { return errFoto(); }
    const id = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO caja_gastos (id, mes, dia, turno, concepto, monto, forma, creado, creado_por, foto, persona) VALUES (?, ?, ?, ?, ?, ?, 'EFECTIVO', ?, ?, ?, ?)")
      .bind(id, s.dia.slice(0, 7), s.dia, s.turno, concepto, monto, ahora, `tablet:${s.persona}`, foto, s.persona).run();
    return recordar(json({ ok: true, id }));
  }
  // ---- Ingreso extra (renta, aumento de cambio, otro) ----
  if (partes[0] === "extras" && partes.length === 1 && request.method === "POST") {
    const concepto = CONCEPTOS_EXTRA.includes(c.concepto) ? c.concepto : "", detalle = texto(c.detalle, 120), monto = numero(c.monto);
    const errores = {};
    if (!concepto) errores.concepto = "Elige qué tipo de ingreso es.";
    if (concepto !== "Aumento de cambio" && detalle.length < 2) errores.detalle = "Escribe de quién o de qué es.";
    if (!(monto > 0) || monto > 200000) errores.monto = "Escribe un monto válido.";
    if (Object.keys(errores).length) return json({ ok: false, error: "Revisa los datos del ingreso.", errores }, 422);
    let foto = null;
    try { foto = await guardarFoto(env, c.foto, "extra"); } catch { return errFoto(); }
    const id = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO caja_extra (id, mes, dia, turno, concepto, detalle, monto, ingreso, foto, persona, creado, creado_por) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(id, s.dia.slice(0, 7), s.dia, s.turno, concepto, detalle || null, monto, cuentaComoIngreso(concepto) ? 1 : 0, foto, s.persona, ahora, `tablet:${s.persona}`).run();
    return recordar(json({ ok: true, id }));
  }
  // Borrar un gasto o ingreso propio mientras el turno sigue abierto (antes del corte)
  if ((partes[0] === "gastos" || partes[0] === "extras") && partes[2] === "eliminar" && request.method === "POST") {
    if (!(await sinCorte())) return json({ ok: false, error: "El corte ya se entregó. Pide a la administración que lo corrija." }, 409);
    const tabla = partes[0] === "gastos" ? "caja_gastos" : "caja_extra";
    const g = await env.DB.prepare(`SELECT id, foto FROM ${tabla} WHERE id = ? AND persona = ? AND dia = ? AND turno = ?`).bind(partes[1], s.persona, s.dia, s.turno).first();
    if (!g) return json({ ok: false, error: "Solo puedes borrar lo que tú capturaste en este turno." }, 404);
    await env.DB.prepare(`DELETE FROM ${tabla} WHERE id = ?`).bind(g.id).run();
    if (g.foto) await borrarArchivo(env, g.foto).catch(() => {});
    return json({ ok: true });
  }

  // ---- Corte ciego: efectivo físico de la caja, incluido el cambio inicial ----
  // ---- Cambio inicial: lo primero que se captura al empezar el turno (se puede corregir hasta entregar el corte) ----
  if (partes[0] === "inicio" && request.method === "POST") {
    const cambio = numero(c.cambio);
    if (!(cambio >= 0) || cambio > 1000000) return json({ ok: false, error: "Escribe con cuánto cambio empiezas (puede ser 0).", errores: { cambio: "Monto inválido." } }, 422);
    if (!(await sinCorte())) return json({ ok: false, error: "El corte de este turno ya se entregó; el cambio inicial ya no se puede cambiar." }, 409);
    await env.DB.prepare(`INSERT INTO turno_inicio (dia, turno, mes, persona, cambio, creado, actualizado) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (dia, turno) DO UPDATE SET persona = excluded.persona, cambio = excluded.cambio, actualizado = excluded.actualizado`)
      .bind(s.dia, s.turno, s.dia.slice(0, 7), s.persona, cambio, ahora, ahora).run();
    return recordar(json({ ok: true, inicio: { cambio, persona: s.persona, actualizado: ahora } }));
  }

  if (partes[0] === "corte" && request.method === "POST") {
    const efectivo = numero(c.efectivo), tarjeta = c.tarjeta === "" || c.tarjeta == null ? null : numero(c.tarjeta);
    const opcional = v => v === "" || v == null ? 0 : numero(v);
    const sobre = opcional(c.sobre), cambioSig = opcional(c.cambio_sig);
    const retiros = (Array.isArray(c.retiros) ? c.retiros : []).slice(0, 20).map(r => ({ concepto: texto(r && r.concepto, 80), monto: numero(r && r.monto) }));
    const errores = {};
    if (!(efectivo >= 0) || efectivo > 1000000) errores.efectivo = "Escribe el efectivo que contaste.";
    if (tarjeta !== null && (!(tarjeta >= 0) || tarjeta > 1000000)) errores.tarjeta = "Monto inválido.";
    if (!(sobre >= 0) || sobre > 1000000) errores.sobre = "Monto del sobre inválido.";
    if (!(cambioSig >= 0) || cambioSig > 1000000) errores.cambio_sig = "Monto del cambio inválido.";
    if (retiros.some(r => r.concepto.length < 2 || !(r.monto > 0) || r.monto > 1000000)) errores.retiros = "Cada retiro necesita concepto y monto.";
    const repartido = sobre + cambioSig + retiros.reduce((a, r) => a + (r.monto || 0), 0);
    if (!errores.efectivo && repartido - efectivo > 0.5) errores.sobre = `Repartiste ${(repartido - efectivo).toFixed(2)} más de lo que contaste. Revisa el sobre, los retiros y el cambio.`;
    if (Object.keys(errores).length) return json({ ok: false, error: "Revisa el corte.", errores }, 422);
    await env.DB.prepare(`INSERT INTO turno_cortes (dia, turno, mes, persona, efectivo, tarjeta, notas, creado, actualizado, veces, con_cambio, sobre, cambio_sig, retiros) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?, ?)
      ON CONFLICT (dia, turno) DO UPDATE SET persona = excluded.persona, efectivo = excluded.efectivo, tarjeta = excluded.tarjeta, notas = excluded.notas, actualizado = excluded.actualizado, veces = turno_cortes.veces + 1, con_cambio = 1,
        sobre = excluded.sobre, cambio_sig = excluded.cambio_sig, retiros = excluded.retiros`)
      .bind(s.dia, s.turno, s.dia.slice(0, 7), s.persona, efectivo, tarjeta, texto(c.notas, 500) || null, ahora, ahora, sobre, cambioSig, JSON.stringify(retiros)).run();
    await env.DB.prepare("INSERT INTO turno_cortes_hist (dia, turno, mes, persona, datos, creado) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(s.dia, s.turno, s.dia.slice(0, 7), s.persona, JSON.stringify({ efectivo, tarjeta, sobre, cambio_sig: cambioSig, retiros, notas: texto(c.notas, 500) || null }), ahora).run();
    await env.DB.prepare("DELETE FROM turno_abierto WHERE dia = ? AND turno = ?").bind(s.dia, s.turno).run();
    return recordar(json({ ok: true }));
  }

  return json({ ok: false, error: "Ruta no encontrada." }, 404);
}

const escHtml = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function correoIncidencia(d, s) {
  return {
    asunto: `Incidencia grave: ${d.titulo}`.slice(0, 180),
    texto: `Incidencia grave reportada desde la tablet.\n\n${d.titulo}\nDónde: ${d.area}\nReportó: ${d.quien || s.nombre} (capturó ${s.nombre}) · turno ${s.turno}${d.detalle ? "\n\n" + d.detalle : ""}\n\nAgenda: https://basculaypension.com/panel#agenda`,
    html: `<div style="font-family:system-ui,sans-serif;font-size:15px"><p style="color:#b42318;margin:0;font-weight:600">Incidencia grave · tablet de turno</p><h2 style="margin:4px 0 8px">${escHtml(d.titulo)}</h2><p style="margin:0 0 4px"><b>Dónde:</b> ${escHtml(d.area)}</p><p style="margin:0 0 12px"><b>Reportó:</b> ${escHtml(d.quien || s.nombre)} · capturó ${escHtml(s.nombre)} · turno ${escHtml(s.turno)}</p>${d.detalle ? `<p>${escHtml(d.detalle)}</p>` : ""}<p><a href="https://basculaypension.com/panel#agenda">Abrir la agenda</a></p></div>`
  };
}

const RES_TXT = { cumplida: "Cumplida", parcial: "Cumplida en parte", no: "No se pudo" };
function correoTarea(t, resultado, nota, conFoto, s) {
  const r = RES_TXT[resultado];
  return {
    asunto: `Tarea ${r.toLowerCase()}: ${t.titulo}`.slice(0, 180),
    texto: `Informe de tarea desde la tablet.\n\n${t.titulo}\nResultado: ${r}\nEncargado: ${s.nombre} · turno ${s.turno}${nota ? "\nObservaciones: " + nota : ""}${conFoto ? "\nCon foto de evidencia (en el panel)." : ""}\n\nAgenda: https://basculaypension.com/panel#agenda`,
    html: `<div style="font-family:system-ui,sans-serif;font-size:15px"><p style="color:${resultado === "cumplida" ? "#1a7f37" : "#9a6700"};margin:0;font-weight:600">Tarea · ${escHtml(r)}</p><h2 style="margin:4px 0 8px">${escHtml(t.titulo)}</h2><p style="margin:0 0 12px"><b>Encargado:</b> ${escHtml(s.nombre)} · turno ${escHtml(s.turno)}</p>${nota ? `<p><b>Observaciones:</b> ${escHtml(nota)}</p>` : ""}${conFoto ? "<p>Con foto de evidencia (en el panel).</p>" : ""}<p><a href="https://basculaypension.com/panel#agenda">Abrir la agenda</a></p></div>`
  };
}

const SW = `const C = "turno-v2";
self.addEventListener("install", e => { e.waitUntil(caches.open(C).then(c => c.addAll(["/turno", "/img/logo.png", "/img/turno-192.png"])).catch(() => {})); self.skipWaiting(); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== C).map(x => caches.delete(x))))); self.clients.claim(); });
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return;
  // La página: primero internet; sin conexión, la copia guardada
  if (e.request.mode === "navigate" && u.pathname === "/turno") {
    e.respondWith(fetch(e.request).then(r => { if (r.ok && r.type === "basic") { const c = r.clone(); caches.open(C).then(x => x.put("/turno", c)); } return r; }).catch(() => caches.match("/turno")));
  } else if (u.pathname.startsWith("/img/") || u.pathname.startsWith("/turno/avatar/")) {
    e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
  }
});`;

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
    const personas = (await env.DB.prepare("SELECT clave, nombre, activo, avatar, avatar_base, foto_ver, colaborador, pin_hash IS NOT NULL AS tiene_pin, bloqueado_hasta, ultimo_acceso FROM turno_personas ORDER BY activo DESC, clave").all()).results
      .map(p => ({ clave: p.clave, nombre: p.nombre || p.clave, activo: !!p.activo, colaborador: p.colaborador || null, avatar: avatarValido(p.avatar), avatar_base: p.avatar_base || null, avatar_url: urlAvatar(p, true), foto_url: p.foto_ver ? urlAvatar({ ...p, avatar: "foto" }, true) : null, tiene_pin: !!p.tiene_pin, bloqueado: !!(p.bloqueado_hasta && p.bloqueado_hasta > ahora), ultimo_acceso: p.ultimo_acceso }));
    // Últimos cortes entregados con su comparación
    const conteos = (await env.DB.prepare("SELECT * FROM turno_cortes ORDER BY dia DESC, actualizado DESC LIMIT 12").all()).results;
    let cortes = [];
    if (conteos.length) {
      const dias = [...new Set(conteos.map(x => x.dia))];
      const q = dias.map(() => "?").join(",");
      const movs = (await env.DB.prepare(`SELECT * FROM caja_mov WHERE dia IN (${q})`).bind(...dias).all()).results;
      const gastos = (await env.DB.prepare(`SELECT * FROM caja_gastos WHERE dia IN (${q})`).bind(...dias).all()).results;
      const extras = (await env.DB.prepare(`SELECT * FROM caja_extra WHERE dia IN (${q})`).bind(...dias).all()).results;
      const inicios = (await env.DB.prepare(`SELECT * FROM turno_inicio WHERE dia IN (${q})`).bind(...dias).all()).results;
      const claves = new Set(conteos.map(x => x.dia + "|" + x.turno));
      cortes = unirConteos(calcularCortes(movs, gastos, extras, inicios), conteos).filter(c => claves.has(c.dia + "|" + c.turno));
    }
    let abierto = await env.DB.prepare("SELECT persona, dia, turno, desde FROM turno_abierto WHERE id = 1").first();
    if (abierto && await env.DB.prepare("SELECT 1 FROM turno_cortes WHERE dia = ? AND turno = ?").bind(abierto.dia, abierto.turno).first()) abierto = null;
    return json({ ok: true, personas, cortes, abierto: abierto || null, avatares: Object.keys(AVATARES) });
  }

  // La administración libera la tablet cuando un turno quedó sin corte (por ejemplo, el encargado ya no regresa)
  if (partes[1] === "liberar" && request.method === "POST") {
    await env.DB.prepare("DELETE FROM turno_abierto WHERE id = 1").run();
    return json({ ok: true });
  }

  if (partes[1] === "avatar" && partes[2] === "c" && request.method === "GET") return servirAvatarDe(env, partes[3], url);
  if (partes[1] === "vinculos" && request.method === "GET") {
    const filas = (await env.DB.prepare("SELECT clave, colaborador FROM turno_personas WHERE colaborador IS NOT NULL").all()).results;
    return json({ ok: true, vinculos: Object.fromEntries(filas.map(f => [f.colaborador, f.clave])) });
  }
  if (partes[1] === "avatar" && partes[2] === "p" && request.method === "GET") return servirFotoPerfil(env, partes[3]);
  if (partes[1] === "avatar" && request.method === "GET") return servirAvatar(partes[2]);

  if (partes[1] === "foto" && request.method === "GET") return servirFoto(env, partes[2]);

  if (partes[1] === "personas" && partes[3] === "eliminar" && request.method === "POST") {
    await env.DB.prepare("DELETE FROM turno_personas WHERE clave = ?").bind(partes[2]).run();
    await env.FILES.delete("perfil:" + String(partes[2] || "").toUpperCase());
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
    // Avatar base: el de la galería que asigna la administración. La persona elige en la tablet entre ese,
    // su foto o sus iniciales; si no usa foto, al cambiar el base se le muestra el nuevo.
    if (c.avatar_base && !Object.hasOwn(AVATARES, c.avatar_base)) return json({ ok: false, error: "Avatar no válido." }, 422);
    const baseAntes = previa && Object.hasOwn(AVATARES, previa.avatar_base) ? previa.avatar_base : null;
    const avatarBase = "avatar_base" in c ? (c.avatar_base || null) : baseAntes;
    let avatar = previa ? avatarValido(previa.avatar) : avatarBase;
    if ("avatar_base" in c && avatar !== "foto" && (avatar === baseAntes || !avatar)) avatar = avatarBase;
    if (c.quitar_foto && avatar === "foto") avatar = avatarBase;
    let fotoVer = previa ? previa.foto_ver : null;
    let colaborador = previa ? previa.colaborador : null;
    if ("colaborador" in c) {
      colaborador = c.colaborador ? String(c.colaborador).slice(0, 60) : null;
      if (colaborador && !(await env.DB.prepare("SELECT 1 FROM colaboradores WHERE id = ?").bind(colaborador).first().catch(() => null))) return json({ ok: false, error: "Ese expediente no existe." }, 422);
      if (colaborador) await env.DB.prepare("UPDATE turno_personas SET colaborador = NULL WHERE colaborador = ? AND clave != ?").bind(colaborador, clave).run();
    }
    if (avatar === "foto" && !fotoVer) avatar = null;
    if (avatar !== "foto" && fotoVer) { await env.FILES.delete("perfil:" + clave); fotoVer = null; }
    let pinHash = previa ? previa.pin_hash : null, sal = previa ? previa.pin_sal : null;
    if (c.pin != null && c.pin !== "") {
      const pin = String(c.pin);
      if (!/^\d{4}$/.test(pin)) return json({ ok: false, error: "El PIN debe ser de 4 números.", errores: { pin: "4 números." } }, 422);
      if (/^(\d)\1{3}$/.test(pin) || "0123456789".includes(pin) || "9876543210".includes(pin)) return json({ ok: false, error: "Ese PIN es muy fácil de adivinar. Usa otro.", errores: { pin: "Muy fácil." } }, 422);
      // Que no se repita entre encargados
      const otros = (await env.DB.prepare("SELECT clave, pin_hash, pin_sal FROM turno_personas WHERE clave != ? AND pin_hash IS NOT NULL").bind(clave).all()).results;
      for (const o of otros) if (await pinCorrecto(pin, o.pin_sal, o.pin_hash)) return json({ ok: false, error: `Ese PIN ya lo usa ${o.clave}. Elige otro.`, errores: { pin: "Repetido." } }, 422);
      sal = hex(crypto.getRandomValues(new Uint8Array(16)));
      pinHash = await hashPin(pin, sal);
    }
    const ahora = new Date().toISOString();
    if (previa) {
      await env.DB.prepare("UPDATE turno_personas SET nombre = ?, activo = ?, avatar = ?, avatar_base = ?, foto_ver = ?, colaborador = ?, pin_hash = ?, pin_sal = ?, fallas = CASE WHEN ? THEN 0 ELSE fallas END, bloqueado_hasta = CASE WHEN ? THEN NULL ELSE bloqueado_hasta END WHERE clave = ?")
        .bind(nombre, activo, avatar, avatarBase, fotoVer, colaborador, pinHash, sal, c.desbloquear || c.pin ? 1 : 0, c.desbloquear || c.pin ? 1 : 0, clave).run();
    } else {
      await env.DB.prepare("INSERT INTO turno_personas (clave, nombre, activo, avatar, avatar_base, colaborador, pin_hash, pin_sal, creado) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(clave, nombre, activo, avatarBase, avatarBase, colaborador, pinHash, sal, ahora).run();
    }
    return json({ ok: true, clave });
  }

  return json({ ok: false, error: "Ruta no encontrada." }, 404);
}
