import { REGIMENES, USOS, SERVICIOS } from "./catalogos.js";
import PANEL_HTML from "./panel.html";

// ---------------------------------------------------------------------------
// Configuración
// ---------------------------------------------------------------------------
const MAX_ARCHIVO = 10 * 1024 * 1024;          // 10 MB por archivo
const MAX_PETICION = 22 * 1024 * 1024;         // 22 MB por envío
const LIMITE_POR_HORA = 8;                     // envíos por IP por hora
const DIAS_RETENCION = 90;                     // días tras facturar o rechazar
const TIPOS_IMAGEN = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
const TIPO_PDF = "application/pdf";

const RE_RFC = /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/;
const RE_CP = /^\d{5}$/;
const RE_EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/;

// ---------------------------------------------------------------------------
// Entrada
// ---------------------------------------------------------------------------
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/api/solicitud") return await crearSolicitud(request, env);
      if (url.pathname === "/panel" || url.pathname.startsWith("/panel/")) return await panel(request, env, url);
      return env.ASSETS.fetch(request);
    } catch (err) {
      console.error("error", err && err.stack || err);
      return json({ ok: false, error: "Ocurrió un error. Intenta de nuevo o escríbenos por WhatsApp." }, 500);
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(limpiarArchivos(env));
  }
};

// ---------------------------------------------------------------------------
// Base de datos
// ---------------------------------------------------------------------------
let esquemaListo = false;
async function asegurarEsquema(env) {
  if (esquemaListo) return;
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS solicitudes (
    id TEXT PRIMARY KEY,
    folio TEXT NOT NULL UNIQUE,
    creado TEXT NOT NULL,
    estado TEXT NOT NULL DEFAULT 'pendiente',
    servicio TEXT,
    folio_ticket TEXT,
    modo TEXT NOT NULL,
    rfc TEXT,
    nombre TEXT,
    regimen TEXT,
    cp TEXT,
    uso TEXT NOT NULL,
    email TEXT NOT NULL,
    telefono TEXT,
    comentario TEXT,
    ticket_tipo TEXT,
    csf_tipo TEXT,
    datos_de_csf INTEGER NOT NULL DEFAULT 0,
    folio_factura TEXT,
    motivo TEXT,
    resuelta_en TEXT,
    archivos_borrados INTEGER NOT NULL DEFAULT 0
  )`).run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_estado_creado ON solicitudes (estado, creado)").run();
  esquemaListo = true;
}

// ---------------------------------------------------------------------------
// Formulario público: crear solicitud
// ---------------------------------------------------------------------------
async function crearSolicitud(request, env) {
  if (request.method !== "POST") return json({ ok: false, error: "Método no permitido." }, 405);

  const url = new URL(request.url);
  const origin = request.headers.get("Origin");
  if (origin && origin !== url.origin) return json({ ok: false, error: "Origen no permitido." }, 403);

  const largo = Number(request.headers.get("Content-Length") || 0);
  if (largo > MAX_PETICION) return json({ ok: false, error: "Los archivos son demasiado grandes. Envía fotos más ligeras (máximo 10 MB cada una)." }, 413);

  // Límite de envíos por IP
  const ip = request.headers.get("CF-Connecting-IP") || "0";
  const llaveLimite = "rl:" + (await sha256Hex(ip)).slice(0, 24) + ":" + new Date().toISOString().slice(0, 13);
  const conteo = Number(await env.FILES.get(llaveLimite) || 0);
  if (conteo >= LIMITE_POR_HORA) return json({ ok: false, error: "Recibimos muchos envíos desde tu conexión. Intenta en una hora o escríbenos por WhatsApp." }, 429);

  let form;
  try { form = await request.formData(); }
  catch { return json({ ok: false, error: "No pudimos leer el formulario. Intenta de nuevo." }, 400); }

  // Trampa para robots: este campo va oculto y debe llegar vacío
  if (texto(form, "sitio")) return json({ ok: true, folio: "EC-OK" });

  const errores = {};
  const modo = texto(form, "modo") === "csf" ? "csf" : "manual";
  const servicio = texto(form, "servicio");
  const folioTicket = texto(form, "folio_ticket").slice(0, 40);
  const rfc = texto(form, "rfc").toUpperCase().replace(/[\s-]/g, "");
  const nombre = texto(form, "nombre").replace(/\s+/g, " ").slice(0, 254);
  const regimen = texto(form, "regimen");
  const cp = texto(form, "cp").replace(/\s/g, "");
  const uso = texto(form, "uso");
  const email = texto(form, "email").toLowerCase();
  const telefono = texto(form, "telefono").replace(/\D/g, "").slice(-10);
  const comentario = texto(form, "comentario").slice(0, 500);

  if (!SERVICIOS[servicio]) errores.servicio = "Elige el servicio.";
  if (!USOS[uso]) errores.uso = "Elige el uso del CFDI.";
  if (!RE_EMAIL.test(email)) errores.email = "Escribe un correo válido.";
  if (telefono && telefono.length !== 10) errores.telefono = "El WhatsApp debe tener 10 dígitos.";
  if (texto(form, "aviso") !== "si") errores.aviso = "Debes aceptar el aviso de privacidad.";

  if (modo === "manual" || rfc) {
    if (!RE_RFC.test(rfc)) errores.rfc = "El RFC no tiene un formato válido (12 o 13 caracteres).";
  }
  if (modo === "manual") {
    if (nombre.length < 3) errores.nombre = "Escribe tu nombre o razón social.";
    if (!REGIMENES[regimen]) errores.regimen = "Elige tu régimen fiscal.";
    if (!RE_CP.test(cp)) errores.cp = "El código postal debe tener 5 dígitos.";
  }

  const ticket = archivo(form, "ticket");
  const csf = archivo(form, "csf");
  const errTicket = validarArchivo(ticket, true, "la foto del ticket");
  if (errTicket) errores.ticket = errTicket;
  if (modo === "csf") {
    const errCsf = validarArchivo(csf, true, "tu Constancia de Situación Fiscal");
    if (errCsf) errores.csf = errCsf;
  }

  if (Object.keys(errores).length) return json({ ok: false, error: "Revisa los campos marcados.", errores }, 422);

  await asegurarEsquema(env);
  const id = crypto.randomUUID();
  const folio = crearFolio();
  const ahora = new Date().toISOString();

  const ticketBuf = await ticket.arrayBuffer();
  await env.FILES.put(`f:${id}:ticket`, ticketBuf, { metadata: { tipo: ticket.type } });
  let csfTipo = null;
  if (modo === "csf" && csf) {
    const csfBuf = await csf.arrayBuffer();
    await env.FILES.put(`f:${id}:csf`, csfBuf, { metadata: { tipo: csf.type } });
    csfTipo = csf.type;
  }

  await env.DB.prepare(`INSERT INTO solicitudes
    (id, folio, creado, estado, servicio, folio_ticket, modo, rfc, nombre, regimen, cp, uso, email, telefono, comentario, ticket_tipo, csf_tipo)
    VALUES (?, ?, ?, 'pendiente', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, folio, ahora, servicio, folioTicket || null, modo,
      rfc || null, modo === "manual" ? nombre : (nombre || null),
      modo === "manual" ? regimen : (REGIMENES[regimen] ? regimen : null),
      modo === "manual" ? cp : (RE_CP.test(cp) ? cp : null),
      uso, email, telefono || null, comentario || null, ticket.type, csfTipo)
    .run();

  await env.FILES.put(llaveLimite, String(conteo + 1), { expirationTtl: 3700 });

  return json({ ok: true, folio });
}

function texto(form, nombre) {
  const v = form.get(nombre);
  return typeof v === "string" ? v.trim() : "";
}
function archivo(form, nombre) {
  const v = form.get(nombre);
  return v && typeof v === "object" && typeof v.arrayBuffer === "function" && v.size > 0 ? v : null;
}
function validarArchivo(f, requerido, que) {
  if (!f) return requerido ? `Adjunta ${que}.` : null;
  if (f.size > MAX_ARCHIVO) return `El archivo de ${que} pesa más de 10 MB.`;
  if (!(TIPOS_IMAGEN.includes(f.type) || f.type === TIPO_PDF)) return `Para ${que} usa una foto (JPG o PNG) o un PDF.`;
  return null;
}
function crearFolio() {
  const fecha = new Date(Date.now() - 6 * 3600 * 1000).toISOString().slice(2, 10).replace(/-/g, "");
  const letras = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const rnd = crypto.getRandomValues(new Uint8Array(4));
  let s = "";
  for (const b of rnd) s += letras[b % letras.length];
  return `EC-${fecha}-${s}`;
}

// ---------------------------------------------------------------------------
// Panel privado (protegido con Cloudflare Access)
// ---------------------------------------------------------------------------
async function panel(request, env, url) {
  const usuario = await verificarAcceso(request, env);
  if (usuario.error) {
    return new Response(paginaBloqueada(usuario.error), {
      status: usuario.status, headers: { "Content-Type": "text/html; charset=utf-8", ...cabecerasPanel() }
    });
  }

  const ruta = url.pathname.replace(/\/+$/, "") || "/panel";
  if (ruta === "/panel" && request.method === "GET") {
    return new Response(PANEL_HTML, { headers: { "Content-Type": "text/html; charset=utf-8", ...cabecerasPanel() } });
  }

  if (!ruta.startsWith("/panel/api/")) return new Response("No encontrado", { status: 404, headers: cabecerasPanel() });

  // Las acciones que modifican datos solo se aceptan desde el propio panel
  if (request.method !== "GET") {
    const origin = request.headers.get("Origin");
    if ((origin && origin !== url.origin) || request.headers.get("X-Panel") !== "1") {
      return json({ ok: false, error: "Solicitud no permitida." }, 403);
    }
  }

  await asegurarEsquema(env);
  const partes = ruta.split("/").slice(3); // tras /panel/api/

  if (partes[0] === "yo") return json({ ok: true, email: usuario.email });

  if (partes[0] === "solicitudes" && partes.length === 1 && request.method === "GET") {
    const estado = ["pendiente", "facturada", "rechazada"].includes(url.searchParams.get("estado")) ? url.searchParams.get("estado") : "pendiente";
    const q = (url.searchParams.get("q") || "").trim().slice(0, 60);
    let sql = "SELECT id, folio, creado, estado, servicio, folio_ticket, modo, rfc, nombre, email, folio_factura, resuelta_en FROM solicitudes WHERE estado = ?";
    const args = [estado];
    if (q) {
      sql += " AND (rfc LIKE ? OR nombre LIKE ? OR folio LIKE ? OR email LIKE ? OR folio_ticket LIKE ? OR folio_factura LIKE ?)";
      const like = "%" + q.replace(/[%_]/g, "") + "%";
      args.push(like, like, like, like, like, like);
    }
    sql += estado === "pendiente" ? " ORDER BY creado ASC LIMIT 300" : " ORDER BY resuelta_en DESC LIMIT 300";
    const { results } = await env.DB.prepare(sql).bind(...args).all();
    const conteos = await env.DB.prepare("SELECT estado, COUNT(*) AS n FROM solicitudes GROUP BY estado").all();
    return json({ ok: true, solicitudes: results, conteos: Object.fromEntries(conteos.results.map(r => [r.estado, r.n])) });
  }

  const id = partes[1];
  if (partes[0] === "solicitudes" && id && /^[0-9a-f-]{36}$/.test(id)) {
    const fila = await env.DB.prepare("SELECT * FROM solicitudes WHERE id = ?").bind(id).first();
    if (!fila) return json({ ok: false, error: "No existe esa solicitud." }, 404);

    if (partes.length === 2 && request.method === "GET") {
      return json({ ok: true, solicitud: fila, regimenes: REGIMENES, usos: USOS, servicios: SERVICIOS });
    }

    if (partes[2] === "archivo" && ["ticket", "csf"].includes(partes[3]) && request.method === "GET") {
      const { value, metadata } = await env.FILES.getWithMetadata(`f:${id}:${partes[3]}`, { type: "arrayBuffer" });
      if (!value) return new Response("Archivo no disponible (pudo haberse borrado por antigüedad).", { status: 404, headers: cabecerasPanel() });
      const tipo = metadata && (TIPOS_IMAGEN.includes(metadata.tipo) || metadata.tipo === TIPO_PDF) ? metadata.tipo : "application/octet-stream";
      const ext = tipo === TIPO_PDF ? "pdf" : (tipo.split("/")[1] || "bin");
      return new Response(value, {
        headers: {
          "Content-Type": tipo,
          "Content-Disposition": `inline; filename="${fila.folio}-${partes[3]}.${ext}"`,
          ...cabecerasPanel()
        }
      });
    }

    if (request.method === "POST" && partes.length === 3) {
      const cuerpo = await request.json().catch(() => ({}));
      const ahora = new Date().toISOString();

      if (partes[2] === "facturar") {
        const folioFactura = String(cuerpo.folio_factura || "").trim().slice(0, 60);
        if (!folioFactura) return json({ ok: false, error: "Escribe el folio o UUID de la factura." }, 422);
        await env.DB.prepare("UPDATE solicitudes SET estado='facturada', folio_factura=?, resuelta_en=?, motivo=NULL WHERE id=?").bind(folioFactura, ahora, id).run();
        return json({ ok: true });
      }
      if (partes[2] === "rechazar") {
        const motivo = String(cuerpo.motivo || "").trim().slice(0, 300);
        if (!motivo) return json({ ok: false, error: "Escribe el motivo." }, 422);
        await env.DB.prepare("UPDATE solicitudes SET estado='rechazada', motivo=?, resuelta_en=? WHERE id=?").bind(motivo, ahora, id).run();
        return json({ ok: true });
      }
      if (partes[2] === "reabrir") {
        if (fila.archivos_borrados) return json({ ok: false, error: "Los archivos de esta solicitud ya se borraron; pide al cliente que la envíe de nuevo." }, 409);
        await env.DB.prepare("UPDATE solicitudes SET estado='pendiente', resuelta_en=NULL WHERE id=?").bind(id).run();
        return json({ ok: true });
      }
      if (partes[2] === "datos") {
        const rfc = String(cuerpo.rfc || "").toUpperCase().replace(/[\s-]/g, "");
        const nombre = String(cuerpo.nombre || "").replace(/\s+/g, " ").trim().slice(0, 254);
        const regimen = String(cuerpo.regimen || "");
        const cp = String(cuerpo.cp || "").trim();
        const errores = {};
        if (rfc && !RE_RFC.test(rfc)) errores.rfc = "RFC con formato inválido.";
        if (regimen && !REGIMENES[regimen]) errores.regimen = "Régimen inválido.";
        if (cp && !RE_CP.test(cp)) errores.cp = "Código postal inválido.";
        if (Object.keys(errores).length) return json({ ok: false, error: "Revisa los datos.", errores }, 422);
        await env.DB.prepare("UPDATE solicitudes SET rfc=?, nombre=?, regimen=?, cp=?, datos_de_csf=? WHERE id=?")
          .bind(rfc || null, nombre || null, regimen || null, cp || null, cuerpo.de_csf ? 1 : 0, id).run();
        return json({ ok: true });
      }
    }
  }
  return json({ ok: false, error: "Ruta no encontrada." }, 404);
}

function cabecerasPanel() {
  return {
    "Cache-Control": "no-store",
    "X-Robots-Tag": "noindex, nofollow",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "DENY",
    "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com; worker-src 'self' blob: https://cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self'; connect-src 'self' https://cdnjs.cloudflare.com; object-src 'self'; frame-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
  };
}

function paginaBloqueada(mensaje) {
  return `<!doctype html><html lang="es-MX"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Panel de facturas</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:system-ui,sans-serif;background:#f5f3f1;color:#211b18;padding:24px;box-sizing:border-box}main{max-width:30rem}h1{font-size:1.6rem;margin:0 0 8px}p{color:#5e5450;line-height:1.5}</style></head>
<body><main><h1>Acceso restringido</h1><p>${escaparHtml(mensaje)}</p></main></body></html>`;
}

// ---------------------------------------------------------------------------
// Verificación del inicio de sesión de Cloudflare Access (JWT RS256)
// ---------------------------------------------------------------------------
let cacheCerts = { en: 0, llaves: null, equipo: "" };

async function verificarAcceso(request, env) {
  const equipo = (env.ACCESS_TEAM_DOMAIN || "").replace(/^https?:\/\//, "").replace(/\/+$/, "");
  const aud = env.ACCESS_AUD || "";
  if (!equipo || !aud) return { error: "El panel todavía no tiene configurado el inicio de sesión. Termina la configuración de Cloudflare Access.", status: 503 };

  const token = request.headers.get("Cf-Access-Jwt-Assertion") || leerCookie(request.headers.get("Cookie") || "", "CF_Authorization");
  if (!token) return { error: "Inicia sesión para entrar al panel.", status: 401 };

  const partes = token.split(".");
  if (partes.length !== 3) return { error: "Sesión inválida.", status: 401 };
  let cabecera, datos;
  try {
    cabecera = JSON.parse(b64urlTexto(partes[0]));
    datos = JSON.parse(b64urlTexto(partes[1]));
  } catch { return { error: "Sesión inválida.", status: 401 }; }
  if (cabecera.alg !== "RS256") return { error: "Sesión inválida.", status: 401 };

  const llaves = await obtenerCerts(equipo);
  const jwk = llaves.find(k => k.kid === cabecera.kid);
  if (!jwk) { cacheCerts.en = 0; return { error: "Sesión inválida. Vuelve a iniciar sesión.", status: 401 }; }
  const llave = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const valido = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", llave, b64urlBytes(partes[2]), new TextEncoder().encode(partes[0] + "." + partes[1]));
  if (!valido) return { error: "Sesión inválida.", status: 401 };

  const ahora = Math.floor(Date.now() / 1000);
  const auds = Array.isArray(datos.aud) ? datos.aud : [datos.aud];
  if (!auds.includes(aud)) return { error: "Sesión no válida para este panel.", status: 401 };
  if (!datos.exp || datos.exp < ahora) return { error: "Tu sesión expiró. Vuelve a iniciar sesión.", status: 401 };
  if (datos.iss !== `https://${equipo}`) return { error: "Sesión inválida.", status: 401 };

  const permitidos = (env.ADMIN_EMAILS || "").toLowerCase().split(",").map(s => s.trim()).filter(Boolean);
  const email = String(datos.email || "").toLowerCase();
  if (!email || !permitidos.includes(email)) return { error: "Tu cuenta no tiene permiso para ver el panel.", status: 403 };
  return { email };
}

async function obtenerCerts(equipo) {
  if (cacheCerts.llaves && cacheCerts.equipo === equipo && Date.now() - cacheCerts.en < 3600 * 1000) return cacheCerts.llaves;
  const r = await fetch(`https://${equipo}/cdn-cgi/access/certs`);
  if (!r.ok) throw new Error("No se pudieron obtener las llaves de Access");
  const j = await r.json();
  cacheCerts = { en: Date.now(), llaves: j.keys || [], equipo };
  return cacheCerts.llaves;
}

// ---------------------------------------------------------------------------
// Limpieza diaria: borra ticket y CSF 90 días después de facturar o rechazar
// ---------------------------------------------------------------------------
async function limpiarArchivos(env) {
  await asegurarEsquema(env);
  const limite = new Date(Date.now() - DIAS_RETENCION * 86400 * 1000).toISOString();
  const { results } = await env.DB.prepare(
    "SELECT id FROM solicitudes WHERE estado IN ('facturada','rechazada') AND resuelta_en < ? AND archivos_borrados = 0 LIMIT 200"
  ).bind(limite).all();
  for (const { id } of results) {
    await env.FILES.delete(`f:${id}:ticket`);
    await env.FILES.delete(`f:${id}:csf`);
    await env.DB.prepare("UPDATE solicitudes SET archivos_borrados = 1 WHERE id = ?").bind(id).run();
  }
  console.log("limpieza", results.length);
}

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }
  });
}
function leerCookie(cookies, nombre) {
  for (const parte of cookies.split(";")) {
    const [k, ...v] = parte.trim().split("=");
    if (k === nombre) return v.join("=");
  }
  return "";
}
function b64urlBytes(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function b64urlTexto(s) { return new TextDecoder().decode(b64urlBytes(s)); }
async function sha256Hex(s) {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, "0")).join("");
}
function escaparHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
