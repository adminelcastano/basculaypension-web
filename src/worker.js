import { permitirRutaTabletEnsayo } from "./ensayo-tablet.js";
import { revisarConsumo, enAhorro, estadoConsumo } from "./consumo.js";
import { normalizarFolioTicket, folioTicketValido, faltantesParaFacturar } from "./facturacion-reglas.js";
import { leerArchivo, borrarArchivo, mantenerArchivos, estadoArchivos, scriptArchivos } from "./fotos.js";
import { correrIA } from "./neuronas.js";
// La IA solo revisa la foto del cliente (que sea un ticket de El Castaño, legible y el de salida en pensión).
// Los datos del ticket ya no se leen con IA: el administrador los captura a mano viendo la foto.
const REVISAR_FOTO_IA = true;
const LEER_TICKET_IA = false;
import { REGIMENES, USOS, SERVICIOS, FORMAS_PAGO } from "./catalogos.js";
import { paginaPanel, recursoPanel } from "./panel-app.js";
import { expedientePagina, expedienteApi, personalPanel, recordatoriosAutomaticos } from "./personal.js";
import { cajaPanel, sincronizarCaja, cierreMensualCaja } from "./caja.js";
import { agendaPanel, recordatoriosAgenda, resumenDiarioAgenda, limpiarAgenda } from "./agenda.js";
import TURNO_HTML from "./turno.html";
import { turnoRuta, turnoAdmin } from "./turno.js";
import { rutaPerfilAdmin } from "./perfil-admin.js";
import { reporteArea, reportesMes, listaReportes, TIPOS_REPORTE } from "./reporte.js";
import { finanzasPanel } from "./finanzas.js";
import { categoriasPanel } from "./categorias.js";
import { limpiarBitacora } from "./bitacora.js";
import { hoyPanel } from "./hoy.js";
import { clavePublica, suscribir, desuscribir, aparatos, enviarPush } from "./push.js";

// ---------------------------------------------------------------------------
// Configuración
// ---------------------------------------------------------------------------
const MAX_ARCHIVO = 10 * 1024 * 1024;          // 10 MB por archivo
const MAX_PETICION = 22 * 1024 * 1024;         // 22 MB por envío
const LIMITE_POR_HORA = 8;                     // envíos por IP por hora
const DIAS_RETENCION = 90;                     // días tras facturar o rechazar: se borra el registro completo
const DIAS_A_HISTORICO = 7;                    // días tras facturar o rechazar: pasa a Histórico
const TIPOS_IMAGEN = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
const TIPO_PDF = "application/pdf";

const RE_RFC = /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/;
const RE_CP = /^\d{5}$/;
const RE_EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/;

// Las URL de Apps Script de cuentas de empresa vienen como /a/macros/<dominio>/s/...,
// que piden iniciar sesión; la forma /macros/s/... funciona sin sesión con acceso "Cualquiera".
function urlScript(u) {
  return typeof u === "string" ? u.trim().replace(/^https:\/\/script\.google\.com\/a\/macros\/[^/]+\/s\//, "https://script.google.com/macros/s/") : u;
}
function normalizarScripts(env) {
  if (!env || (!/\/a\/macros\//.test(env.AVISO_URL || "") && !/\/a\/macros\//.test(env.INGRESOS_URL || ""))) return env;
  return Object.assign(Object.create(Object.getPrototypeOf(env)), env, { AVISO_URL: urlScript(env.AVISO_URL), INGRESOS_URL: urlScript(env.INGRESOS_URL) });
}

// ---------------------------------------------------------------------------
// Entrada
// ---------------------------------------------------------------------------
export default {
  async fetch(request, env, ctx) {
    env = normalizarScripts(env);
    // Tareas en segundo plano (notificaciones push) sin retrasar la respuesta
    env = Object.assign(Object.create(Object.getPrototypeOf(env)), env, { enFondo: p => ctx.waitUntil(p) });
    const url = new URL(request.url);
    if (env.ENSAYO_FINANZAS === "1" && [
      env.INGRESOS_URL, env.INGRESOS_TOKEN, env.AVISO_URL, env.AVISO_TOKEN,
      env.CF_API_TOKEN, env.SENDGRID_API_KEY, env.RESEND_API_KEY,
      env.GOOGLE_CLIENT_SECRET, env.GOOGLE_REFRESH_TOKEN
    ].some(Boolean)) {
      return json({ok:false,error:"Configuración insegura del ensayo: hay servicios externos activos."},503);
    }
    // Ensayo aislado: la tableta se habilita SOLO con segunda bandera.
    // La producción carece de ambas y mantiene sus rutas habituales.
    const tabletEnsayo = env.ENSAYO_FINANZAS === "1" && env.ENSAYO_TABLET === "1";
    if (env.ENSAYO_FINANZAS === "1") {
      const ruta = url.pathname, esTurno = ruta === "/turno" || ruta.startsWith("/turno/");
      if (ruta.startsWith("/api/") || ruta.startsWith("/expediente/") ||
          (esTurno && (!tabletEnsayo || !permitirRutaTabletEnsayo(ruta, request.method))) ||
          (request.method !== "GET" && request.method !== "HEAD" &&
           !ruta.startsWith("/panel/api/") && !esTurno)) {
        return json({ok:false,error:"Ruta no habilitada en el ensayo."},403);
      }
    }
    try {
      // Modo ahorro (consumo cerca del límite incluido): se pausan los formularios públicos
      if (request.method === "POST" && (url.pathname === "/api/solicitud" || url.pathname === "/api/revisar-ticket" || url.pathname.startsWith("/api/expediente/")) && await enAhorro(env))
        return json({ ok: false, error: "Por ahora no podemos recibir archivos en línea. Escríbenos por WhatsApp al 962 564 2170 y te ayudamos." }, 503);
      if (url.pathname === "/api/solicitud") return await crearSolicitud(request, env, ctx);
      if (url.pathname === "/api/revisar-ticket") return REVISAR_FOTO_IA ? await revisarTicketApi(request, env) : json({ ok: false, desactivado: true });
      if (url.pathname.startsWith("/api/expediente/")) return await expedienteApi(request, env, url, ctx, llamarScript, enviarCorreoA);
      if (url.pathname.startsWith("/expediente/")) return await expedientePagina(request, env, url);
      if (url.pathname === "/panel" || url.pathname.startsWith("/panel/")) return await panel(request, env, url);
      if (url.pathname === "/turno" || url.pathname.startsWith("/turno/")) {
        const html = tabletEnsayo ? TURNO_HTML.replace("<body>",
          '<body><div role="status" style="position:relative;z-index:9999;background:#fef3c7;color:#663c00;padding:12px;text-align:center;font:700 14px system-ui">TABLETA DE ENSAYO PRIVADO · SOLO DATOS FICTICIOS · NO ES PRODUCCIÓN</div>') : TURNO_HTML;
        return await turnoRuta(request, env, url, { verificarAcceso, paginaBloqueada, cabeceras: cabecerasPanel, html, llamarScript });
      }
      return env.ASSETS.fetch(request);
    } catch (err) {
      console.error("error", err && err.stack || err);
      return json({ ok: false, error: "Ocurrió un error. Intenta de nuevo o escríbenos por WhatsApp." }, 500);
    }
  },

  async scheduled(event, env, ctx) {
    // Nunca procesar tareas ni sincronizaciones si se disparara accidentalmente
    // una ejecución programada del Worker de ensayo.
    if (env.ENSAYO_FINANZAS === "1") return;
    env = normalizarScripts(env);
    // 14:47 UTC = 8:47 en Tapachula: recordatorios del expediente laboral
    if (event.cron === "47 14 * * *") {
      ctx.waitUntil(recordatoriosAutomaticos(env, enviarCorreoA));
      ctx.waitUntil(resumenDiarioAgenda(env, llamarScript).catch(e => console.error("resumen agenda", e && e.message)));
      return;
    }
    // Cada 10 minutos: ingresos del mes desde la hoja de Google (y cierre al cambiar de mes)
    if (event.cron === "*/10 * * * *") {
      ctx.waitUntil((async () => {
        await recordatoriosAgenda(env, llamarScript).catch(e => console.error("recordatorios agenda", e && e.message));
        // Fotos y PDFs: de KV a la carpeta dedicada de Google Drive
        await mantenerArchivos(env).then(r => (r.subidos || r.vencidos || r.error) && console.log("archivos", JSON.stringify(r))).catch(e => console.error("archivos", e && e.message));
        const enPuntoDeHora = new Date(event.scheduledTime).getUTCMinutes() < 10;
        // Cada hora: revisar el consumo del mes (avisos y modo ahorro)
        if (enPuntoDeHora) await revisarConsumo(env, llamarScript).catch(e => console.error("consumo", e && e.message));
        if (!env.INGRESOS_URL) return;
        await cierreMensualCaja(env, { reportes: (e, mes) => reportesMes(e, mes, hReporte) }).catch(e => console.error("cierre caja", e && e.message));
        // En modo ahorro la hoja se lee cada hora en vez de cada 10 minutos
        if (!enPuntoDeHora && await enAhorro(env)) return;
        await sincronizarCaja(env);
      })());
      return;
    }
    ctx.waitUntil(limpiarAgenda(env).then(n => n && console.log("agenda: borrados", n)).catch(e => console.error("limpiar agenda", e && e.message)));
    ctx.waitUntil(limpiarArchivos(env));
    // Bitácora de dinero: se conservan 13 meses, igual que los turnos
    ctx.waitUntil(limpiarBitacora(env, new Date(Date.now() - 400 * 86400e3).toISOString()).catch(e => console.error("bitacora", e && e.message)));
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
  // Columnas agregadas después de la primera versión
  const { results: cols } = await env.DB.prepare("PRAGMA table_info(solicitudes)").all();
  const existentes = new Set(cols.map(c => c.name));
  for (const [nombre, tipo] of [["importe", "TEXT"], ["placas", "TEXT"], ["descripcion", "TEXT"], ["tarifa", "TEXT"], ["anotacion", "TEXT"], ["cliente", "TEXT"], ["aviso_ticket", "TEXT"], ["forma_pago", "TEXT"], ["ticket_leido", "INTEGER NOT NULL DEFAULT 0"], ["enviada_en", "TEXT"], ["aviso_version", "TEXT"]]) {
    if (!existentes.has(nombre)) await env.DB.prepare(`ALTER TABLE solicitudes ADD COLUMN ${nombre} ${tipo}`).run();
  }
  // Sólo retiene servicio y folio normalizado para prevenir un CFDI duplicado
  // después de borrar el expediente a los 90 días. Sin RFC, correo ni fotos.
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS facturas_folios (
    servicio TEXT NOT NULL, folio_normalizado TEXT NOT NULL, solicitud_id TEXT NOT NULL,
    folio_factura TEXT NOT NULL, creado TEXT NOT NULL, vence TEXT NOT NULL,
    PRIMARY KEY (servicio, folio_normalizado))`).run();
  esquemaListo = true;
}

// ---------------------------------------------------------------------------
// Formulario público: crear solicitud
// ---------------------------------------------------------------------------
async function crearSolicitud(request, env, ctx) {
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
  let servicio = texto(form, "servicio");
  const folioTicket = texto(form, "folio_ticket").slice(0, 40);
  const rfc = texto(form, "rfc").toUpperCase().replace(/[\s-]/g, "");
  const nombre = texto(form, "nombre").replace(/\s+/g, " ").slice(0, 254);
  const regimen = texto(form, "regimen");
  const cp = texto(form, "cp").replace(/\s/g, "");
  const uso = texto(form, "uso");
  const formaPago = texto(form, "forma_pago");
  const email = texto(form, "email").toLowerCase();
  const telefono = texto(form, "telefono").replace(/\D/g, "").slice(-10);
  const comentario = texto(form, "comentario").slice(0, 500);

  if (!SERVICIOS[servicio] || servicio === "ambos") errores.servicio = "Elige el servicio: báscula o pensión.";
  if (folioTicket && !folioTicketValido(folioTicket)) errores.folio_ticket = "El folio del ticket debe contener sólo números.";
  if (!USOS[uso]) errores.uso = "Elige el uso del CFDI.";
  if (!FORMAS_PAGO[formaPago]) errores.forma_pago = "Elige cómo pagaste.";
  if (email && !RE_EMAIL.test(email)) errores.email = "Escribe un correo válido.";
  if (telefono && telefono.length !== 10) errores.telefono = "Escribe tu WhatsApp a 10 dígitos para avisarte de tu factura.";
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
  await env.FILES.put(llaveLimite, String(conteo + 1), { expirationTtl: 3700 });

  // Revisar el ticket con IA antes de guardar (se reutiliza la revisión hecha al tomar la foto)
  let lectura = null, avisoTicket = null;
  if (REVISAR_FOTO_IA && env.AI && TIPOS_LEGIBLES.includes(ticket.type)) {
    let rev = null;
    try { rev = await conLimite(revisarTicket(env, ticketBuf, ticket.type, servicio), 20000); }
    catch (e) { console.error("revisar ticket", e && e.message); rev = null; }
    if (rev && !rev.error) {
      if (rev.clase === "otro") {
        if (texto(form, "forzar_ticket") !== "1") {
          return json({ ok: false, error: "La foto no parece un ticket de Báscula y Pensión El Castaño.",
            errores: { ticket: "Esta foto no parece un ticket de El Castaño. Toma la foto de tu ticket." } }, 422);
        }
        avisoTicket = "La revisión automática no reconoció un ticket de El Castaño en la foto. Revísala antes de facturar.";
      } else if (rev.clase && rev.clase !== servicio) {
        avisoTicket = `El cliente eligió ${SERVICIOS[servicio]}, pero la foto es de un ticket de ${SERVICIOS[rev.clase].toLowerCase()}. Se registró como ${SERVICIOS[rev.clase].toLowerCase()}.`;
        servicio = rev.clase;
      }
      lectura = rev.lectura || null;
    }
    if (servicio === "pension" && esTicketDeEntrada(lectura)) {
      return json({ ok: false, error: "Enviaste el ticket de ENTRADA. Para facturar necesitamos el ticket de SALIDA: el que entregan al salir y trae el TOTAL pagado.",
        errores: { ticket: "Este es el ticket de entrada. Toma la foto del ticket de salida (el que tiene el total)." } }, 422);
    }
  }

  // El cliente envió la foto aunque la revisión de su teléfono dijo que no se ve bien
  const calidad = texto(form, "aviso_calidad").slice(0, 300);
  if (calidad) avisoTicket = [avisoTicket, "El cliente envió la foto aunque la revisión de calidad marcó: " + calidad].filter(Boolean).join(" ");
  await env.FILES.put(`f:${id}:ticket`, ticketBuf, { metadata: { tipo: ticket.type } });
  let csfTipo = null;
  if (modo === "csf" && csf) {
    const csfBuf = await csf.arrayBuffer();
    await env.FILES.put(`f:${id}:csf`, csfBuf, { metadata: { tipo: csf.type } });
    csfTipo = csf.type;
  }

  try {
  await env.DB.prepare(`INSERT INTO solicitudes
    (id, folio, creado, estado, servicio, folio_ticket, modo, rfc, nombre, regimen, cp, uso, email, telefono, comentario, ticket_tipo, csf_tipo, aviso_ticket, forma_pago, aviso_version)
    VALUES (?, ?, ?, 'pendiente', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, folio, ahora, servicio, folioTicket || null, modo,
      rfc || null, modo === "manual" ? nombre : (nombre || null),
      modo === "manual" ? regimen : (REGIMENES[regimen] ? regimen : null),
      modo === "manual" ? cp : (RE_CP.test(cp) ? cp : null),
      uso, email, telefono || null, comentario || null, ticket.type, csfTipo, avisoTicket, formaPago, "2026-10-17")
    .run();
  } catch (e) {
    // Base de datos no disponible (p. ej. límite diario): no dejar fotos huérfanas y avisar claro
    console.error("guardar solicitud", e && e.message);
    await borrarArchivo(env, `f:${id}:ticket`).catch(() => {});
    if (csfTipo) await borrarArchivo(env, `f:${id}:csf`).catch(() => {});
    return json({ ok: false, error: "No pudimos registrar tu solicitud en este momento. Intenta de nuevo en unas horas o escríbenos por WhatsApp." }, 503);
  }

  if (LEER_TICKET_IA && lectura && !lectura.error) {
    try { await guardarLecturaTicket(env, { id, folio_ticket: folioTicket }, lectura.datos, false); }
    catch (e) { console.error("guardar lectura", e && e.message); }
  }

  if (ctx && env.AVISO_URL && env.AVISO_TOKEN) {
    ctx.waitUntil(enviarAviso(env, url.origin, { folio, servicio, modo, rfc, nombre, email }).catch(e => console.error("aviso", e)));
  }
  if (LEER_TICKET_IA && ctx && env.AI && TIPOS_LEGIBLES.includes(ticket.type) && (!lectura || lectura.error)) {
    // Si la lectura falló o tardó, se reintenta en segundo plano
    ctx.waitUntil(leerTicket(env, id).catch(e => console.error("leer ticket", e && e.message)));
  }

  return json({ ok: true, folio });
}

// Acepta "350", "$1,250.50", "1250,5" y devuelve "1250.50"; null si no es válido
function normalizarImporte(v) {
  let t = String(v ?? "").trim().replace(/[$\s]|MXN/gi, "");
  if (!t) return "";
  if (/^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(t)) t = t.replace(/,/g, "");
  else if (/^\d+,\d{1,2}$/.test(t)) t = t.replace(",", ".");
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(t)) return null;
  return Number(t).toFixed(2);
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
// Aviso por correo de nueva solicitud (vía Google Apps Script del propio negocio)
// ---------------------------------------------------------------------------
async function enviarAviso(env, origen, d) {
  const quien = d.nombre || (d.modo === "csf" ? "Constancia por revisar" : "Sin nombre");
  const servicio = SERVICIOS[d.servicio] || d.servicio;
  const panel = origen + "/panel";
  const texto = `Nueva solicitud de factura ${d.folio}\n\nCliente: ${quien}\nRFC: ${d.rfc || "por revisar en la constancia"}\nServicio: ${servicio}\nCorreo del cliente: ${d.email}\n\nRevísala en el panel: ${panel}`;
  const html = `<p style="font-family:Arial,sans-serif;font-size:15px">Nueva solicitud de factura <b>${escaparHtml(d.folio)}</b></p>
<table style="font-family:Arial,sans-serif;font-size:15px;border-collapse:collapse">
<tr><td style="padding:4px 12px 4px 0;color:#666">Cliente</td><td><b>${escaparHtml(quien)}</b></td></tr>
<tr><td style="padding:4px 12px 4px 0;color:#666">RFC</td><td>${escaparHtml(d.rfc || "por revisar en la constancia")}</td></tr>
<tr><td style="padding:4px 12px 4px 0;color:#666">Servicio</td><td>${escaparHtml(servicio)}</td></tr>
<tr><td style="padding:4px 12px 4px 0;color:#666">Correo</td><td>${escaparHtml(d.email)}</td></tr>
</table>
<p><a href="${panel}" style="display:inline-block;background:#f0a00a;color:#241a10;padding:10px 18px;border-radius:8px;text-decoration:none;font-family:Arial,sans-serif;font-weight:bold">Abrir panel de facturas</a></p>`;
  await llamarScript(env, { asunto: `Nueva solicitud de factura ${d.folio} · ${quien}`, texto, html });
  console.log("aviso enviado", d.folio);
}

// Apps Script ejecuta doPost y luego redirige a una URL que entrega la respuesta;
// se sigue la redirección para leer "ok", "no autorizado" o una página de error.
async function llamarScript(env, datos) {
  const r = await fetch(env.AVISO_URL.trim(), {
    method: "POST",
    redirect: "follow",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: env.AVISO_TOKEN.trim(), ...datos })
  });
  const cuerpo = (await r.text()).slice(0, 300);
  if (cuerpo.trim() !== "ok") throw new Error(`script no confirmó: HTTP ${r.status} ${r.url.slice(0, 80)} · ${cuerpo.replace(/\s+/g, " ").slice(0, 200)}`);
}

// Correo a otra persona (enlace del expediente laboral). El script solo envía a terceros
// correos que contienen un enlace /expediente/; responde "ok-para" al hacerlo.
// Si responde "ok" a secas, es la versión anterior del script, que solo envía a la administración.
async function enviarCorreoA(env, datos) {
  const r = await fetch(env.AVISO_URL.trim(), {
    method: "POST",
    redirect: "follow",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: env.AVISO_TOKEN.trim(), ...datos })
  });
  const cuerpo = (await r.text()).slice(0, 300).trim();
  if (cuerpo === "ok-para") return;
  const e = new Error(`script no confirmó envío a tercero: ${cuerpo.replace(/\s+/g, " ").slice(0, 120)}`);
  if (cuerpo === "ok") e.desactualizado = true;
  throw e;
}

// ---------------------------------------------------------------------------
// Filas de solicitudes de factura para los reportes y respaldos en Google Sheets
// ---------------------------------------------------------------------------
const ENCABEZADOS = ["Folio solicitud", "Recibida", "Estado", "Servicio", "Folio ticket", "Cliente en ticket", "Placas", "Descripción auto", "Tarifa", "Anotación a mano", "RFC", "Nombre o razón social", "Código postal", "Régimen fiscal", "Uso CFDI", "Forma de pago", "Correo", "WhatsApp", "Importe", "Folio factura", "Fecha resolución", "Fecha entrega manual", "Motivo rechazo", "Versión aviso de privacidad"];
function filasExcel(results) {
  const local = iso => iso ? new Date(new Date(iso).getTime() - 6 * 3600e3).toISOString().slice(0, 16).replace("T", " ") : "";
  const est = { pendiente: "Recibida", en_revision: "En revisión", facturada: "Facturada", enviada: "Enviada al cliente", rechazada: "Rechazada" };
  const filas = [ENCABEZADOS];
  for (const r of results) {
    filas.push([r.folio, local(r.creado), est[r.estado] || r.estado, SERVICIOS[r.servicio] || r.servicio || "", r.folio_ticket || "", r.cliente || "",
      r.placas || "", r.descripcion || "", r.tarifa || "", r.anotacion || "",
      r.rfc || "", r.nombre || "", r.cp || "", r.regimen ? `${r.regimen} ${REGIMENES[r.regimen] || ""}` : "",
      r.uso ? `${r.uso} ${USOS[r.uso] || ""}` : "", r.forma_pago ? `${r.forma_pago} ${FORMAS_PAGO[r.forma_pago] || ""}` : "", r.email || "", r.telefono || "", r.importe ? "$" + Number(r.importe).toLocaleString("es-MX", { minimumFractionDigits: 2 }) : "", r.folio_factura || "", local(r.resuelta_en), local(r.enviada_en), r.motivo || "", r.aviso_version || ""]);
  }
  return filas;
}

// Para el reporte mensual en Sheets
const hReporte = { script: scriptArchivos, filasFacturas: filasExcel };
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
  if (env.ENSAYO_FINANZAS === "1" && ruta === "/panel/api/ensayo/estado" && request.method === "GET") {
    const esquema = await env.DB.prepare("SELECT COUNT(*) AS total FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'").first();
    const kv = await env.FILES.get("ensayo:finanzas:prueba-kv-20261018", {type:"json"});
    return json({ok:true,entorno:"FINANZAS_INTEGRAL_ENSAYO",tablas:Number(esquema?.total||0),kv_aislada:kv?.entorno==="KV-FINANZAS-ENSAYO",servicios_productivos:false});
  }
  if (ruta === "/panel" && request.method === "GET") {
    let documento = await paginaPanel();
    if (env.ENSAYO_FINANZAS === "1") {
      // Señal permanente: nunca confundir un ensayo sintético con las cifras reales.
      const aviso = '<div role="status" style="background:#fef3c7;color:#663c00;padding:12px 16px;text-align:center;font:700 15px system-ui,sans-serif;position:relative;z-index:9999">ENTORNO DE ENSAYO FINANCIERO · SOLO DATOS SINTÉTICOS · NO ES PRODUCCIÓN</div>';
      documento = documento.replace(/<body>/, "<body>" + aviso);
    }
    return new Response(documento, { headers: { "Content-Type": "text/html; charset=utf-8", ...cabecerasPanel() } });
  }
  // Estilos y código del panel (con versión en la URL, se guardan en el navegador)
  if (request.method === "GET") { const r = await recursoPanel(ruta, url); if (r) return r; }

  if (!ruta.startsWith("/panel/api/")) return new Response("No encontrado", { status: 404, headers: cabecerasPanel() });

  // Las acciones que modifican datos solo se aceptan desde el propio panel
  if (request.method !== "GET") {
    const origin = request.headers.get("Origin");
    if ((origin && origin !== url.origin) || request.headers.get("X-Panel") !== "1") {
      return json({ ok: false, error: "Solicitud no permitida." }, 403);
    }
  }

  return await rutasPanel(request, env, url, usuario);
}

// Rutas de /panel/api/... (ya verificado el inicio de sesión). "hoy" las usa por dentro para armar el tablero.
async function rutasPanel(request, env, url, usuario) {
  const ruta = url.pathname.replace(/\/+$/, "");
  await asegurarEsquema(env);
  const partes = ruta.split("/").slice(3); // tras /panel/api/

  // En el ensayo: ningún formulario ajeno al flujo financiero puede escribir.
  if (env.ENSAYO_FINANZAS === "1" && request.method !== "GET" && request.method !== "HEAD") {
    const financiero = ["finanzas", "caja", "categorias"].includes(partes[0]);
    const agendaDinero = partes[0] === "agenda" && (
      partes[1] === "pagos" || partes[1] === "compras" ||
      (partes.length === 3 && partes[2] === "pagar") ||
      (partes.length === 3 && partes[2] === "lugar") ||
      (partes.length === 3 && partes[2] === "posponer")
    );
    // Solo la cuenta ficticia ENSAYO puede recibir su PIN desde el panel privado.
    const pinEnsayo = env.ENSAYO_TABLET === "1" && partes[0] === "turno" &&
      partes[1] === "personas" && partes[2] === "ENSAYO" && partes.length === 3;
    if (!financiero && !agendaDinero && !pinEnsayo)
      return json({ok:false,error:"Solo se permiten operaciones financieras sintéticas en el ensayo."},403);
  }

  if (partes[0] === "yo") return json({ ok: true, email: usuario.email });
  if (partes[0] === "perfil-admin") return await rutaPerfilAdmin(request, env, partes[1] || "");
  // Notificaciones push del celular del administrador
  if (partes[0] === "push") {
    if (partes.length === 1 && request.method === "GET") return json({ ok: true, clave: await clavePublica(env), aparatos: await aparatos(env, "admin") });
    const c = request.method === "POST" ? await request.json().catch(() => ({})) : {};
    if (partes.length === 1 && request.method === "POST") {
      try { await suscribir(env, "admin", c.sub, c.aparato); } catch (e) { return json({ ok: false, error: e.message }, 422); }
      return json({ ok: true });
    }
    if (partes[1] === "quitar" && request.method === "POST") { await desuscribir(env, c.endpoint); return json({ ok: true }); }
    if (partes[1] === "prueba" && request.method === "POST") {
      const n = await enviarPush(env, "admin", { titulo: "Notificaciones activadas", cuerpo: "Así te llegarán las incidencias, avisos y tareas de la tablet.", sec: "incidencia", etiqueta: "prueba" });
      return json({ ok: true, enviados: n });
    }
  }
  // Tablero de Hoy: una sola llamada que junta lo que pide atención (las demás rutas se consultan aquí mismo)
  if (partes[0] === "hoy" && request.method === "GET") {
    const interno = async r => { const u = new URL("/panel/api/" + r, url.origin); return (await rutasPanel(new Request(u, { method: "GET" }), env, u, usuario)).json(); };
    return json(await hoyPanel(env, interno));
  }
  if (partes[0] === "colaboradores") return await personalPanel(request, env, url, partes, enviarCorreoA);
  // Reportes mensuales en Google Sheets (Turnos, Finanzas y Facturación): lista y generación a demanda
  if (partes[0] === "reportes") {
    const tipo = TIPOS_REPORTE[url.searchParams.get("tipo")] ? url.searchParams.get("tipo") : null;
    if (request.method === "GET") return json({ ok: true, reportes: await listaReportes(env, tipo), script: !!(env.AVISO_URL && env.AVISO_TOKEN) });
    if (request.method === "POST") {
      const c = await request.json().catch(() => ({}));
      const mes = String(c.mes || ""), t = String(c.tipo || "");
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) return json({ ok: false, error: "Elige el mes." }, 422);
      if (!TIPOS_REPORTE[t]) return json({ ok: false, error: "Elige el reporte." }, 422);
      if (!env.AVISO_URL || !env.AVISO_TOKEN) return json({ ok: false, error: "Falta conectar el script de Google." }, 503);
      try { return json({ ok: true, ...(await reporteArea(env, t, mes, hReporte)) }); }
      catch (e) { return json({ ok: false, error: String(e && e.message || e).slice(0, 300) }, 502); }
    }
  }
  if (partes[0] === "finanzas") return await finanzasPanel(request, env, url, partes, usuario);
  if (partes[0] === "categorias" && partes.length === 1) return await categoriasPanel(request, env);
  if (partes[0] === "caja") return await cajaPanel(request, env, url, partes, usuario, {});
  if (partes[0] === "agenda") return await agendaPanel(request, env, url, partes, usuario);
  if (partes[0] === "turno") return await turnoAdmin(request, env, url, partes);
  if (partes[0] === "consumo" && request.method === "GET") {
    const [consumo, archivos] = await Promise.all([estadoConsumo(env), estadoArchivos(env).catch(e => ({ error: e.message }))]);
    return json({ ok: true, consumo, archivos });
  }

  if (partes[0] === "solicitudes" && partes.length === 1 && request.method === "GET") {
    const estado = ["pendiente", "facturada", "enviada", "rechazada", "historico"].includes(url.searchParams.get("estado")) ? url.searchParams.get("estado") : "pendiente";
    const q = (url.searchParams.get("q") || "").trim().slice(0, 60);
    const lim = limiteHistorico();
    let sql = "SELECT id, folio, creado, estado, servicio, folio_ticket, modo, rfc, nombre, email, folio_factura, resuelta_en, importe, tarifa, cliente FROM solicitudes WHERE ";
    const args = [];
    if (estado === "pendiente") sql += "estado IN ('pendiente','en_revision')";
    else if (estado === "historico") { sql += "estado IN ('facturada','enviada','rechazada') AND resuelta_en < ?"; args.push(lim); }
    else { sql += "estado = ? AND resuelta_en >= ?"; args.push(estado, lim); }
    if (q) {
      sql += " AND (rfc LIKE ? OR nombre LIKE ? OR folio LIKE ? OR email LIKE ? OR folio_ticket LIKE ? OR folio_factura LIKE ?)";
      const like = "%" + q.replace(/[%_]/g, "") + "%";
      args.push(like, like, like, like, like, like);
    }
    // Por páginas: el panel pide más con "Ver más" (antes se cortaba en 300 sin avisar)
    const limite = Math.min(2000, Math.max(50, Number(url.searchParams.get("limite")) || 200));
    sql += (estado === "pendiente" ? " ORDER BY creado ASC" : " ORDER BY resuelta_en DESC") + ` LIMIT ${limite + 1}`;
    const { results: todos } = await env.DB.prepare(sql).bind(...args).all();
    const hayMas = todos.length > limite, results = todos.slice(0, limite);
    // Las pantallas de Facturación cargan cinco grupos a la vez. Sólo la primera
    // necesita los conteos; otros clientes mantienen la respuesta completa por defecto.
    const soloLista = url.searchParams.get("solo_lista") === "1";
    const conteos = soloLista ? null : await env.DB.prepare(
      "SELECT CASE WHEN estado IN ('facturada','enviada','rechazada') AND resuelta_en < ? THEN 'historico' WHEN estado = 'en_revision' THEN 'pendiente' ELSE estado END AS grupo, COUNT(*) AS n FROM solicitudes GROUP BY grupo"
    ).bind(lim).all();
    return json({ ok: true, solicitudes: results, hay_mas: hayMas, limite,
      conteos: conteos ? Object.fromEntries(conteos.results.map(r => [r.grupo, r.n])) : {},
      dias_retencion: DIAS_RETENCION });
  }

  const id = partes[1];
  if (partes[0] === "solicitudes" && id && /^[0-9a-f-]{36}$/.test(id)) {
    const fila = await env.DB.prepare("SELECT * FROM solicitudes WHERE id = ?").bind(id).first();
    if (!fila) return json({ ok: false, error: "No existe esa solicitud." }, 404);

    if (partes.length === 2 && request.method === "GET") {
      let duplicados = [];
      if (fila.folio_ticket) {
        const r = await env.DB.prepare("SELECT folio, estado, folio_factura, creado FROM solicitudes WHERE REPLACE(REPLACE(UPPER(TRIM(folio_ticket)), ' ', ''), '-', '') = ? AND id != ? AND (servicio = ? OR servicio = 'ambos' OR ? = 'ambos') ORDER BY creado DESC LIMIT 5")
          .bind(normalizarFolioTicket(fila.folio_ticket), id, fila.servicio, fila.servicio).all();
        duplicados = r.results;
      }
      const normalizado = normalizarFolioTicket(fila.folio_ticket);
      let yaFacturado = null, contraste = null;
      if (normalizado) {
        yaFacturado = await env.DB.prepare("SELECT solicitud_id, folio_factura FROM facturas_folios WHERE servicio = ? AND folio_normalizado = ?")
          .bind(fila.servicio, normalizado).first();
        if (!yaFacturado) {
          // Registros históricos todavía presentes, antes de la nueva reserva única.
          yaFacturado = await env.DB.prepare("SELECT id AS solicitud_id, folio_factura FROM solicitudes WHERE id != ? AND servicio=? AND estado IN ('facturada','enviada') AND REPLACE(REPLACE(UPPER(TRIM(folio_ticket)), ' ', ''), '-', '') = ? LIMIT 1")
            .bind(fila.id, fila.servicio, normalizado).first();
        }
        // La hoja de ingresos es una referencia para aclaraciones, no una autorización
        // automática para facturar ni una prueba concluyente de pago.
        try {
          const movimientos = (await env.DB.prepare("SELECT folio, importe, forma, fecha FROM caja_mov WHERE servicio = ? AND tipo = 'ticket' AND REPLACE(REPLACE(UPPER(TRIM(folio)), ' ', ''), '-', '') = ? ORDER BY fecha DESC LIMIT 3")
            .bind(fila.servicio, normalizado).all()).results;
          const pend = (await env.DB.prepare("SELECT estado, monto FROM caja_pendientes WHERE servicio = ? AND REPLACE(REPLACE(UPPER(TRIM(folio)), ' ', ''), '-', '') = ? AND origen_activo = 1 LIMIT 1")
            .bind(fila.servicio, normalizado).first());
          contraste = movimientos.length
            ? { encontrado: true, registros: movimientos, advertencia: null }
            : { encontrado: false, registros: [], advertencia: "El folio no aparece entre los tickets de ingresos sincronizados. Verifica el número en la foto; puedes continuar después de aclararlo." };
          if (pend && ["pendiente", "parcial"].includes(pend.estado))
            contraste.advertencia = "El folio aparece con un cobro pendiente o parcialmente abonado. Verifica antes de emitir.";
          else if (pend && pend.estado === "cancelado")
            contraste.advertencia = "El registro de cobro pendiente fue cancelado. Comprueba la situación del ticket antes de emitir.";
          if (movimientos.length && fila.importe && !movimientos.some(m => Math.abs(Number(m.importe) - Number(fila.importe)) < 0.01))
            contraste.advertencia = "El importe capturado no coincide con el registrado en ingresos. Comprueba la foto del ticket.";
        } catch (e) {
          contraste = { encontrado: null, registros: [], advertencia: "No se pudo consultar ingresos. Verifica manualmente el folio del ticket." };
        }
      }
      return json({ ok: true, solicitud: fila, duplicados, ya_facturado: yaFacturado, contraste, regimenes: REGIMENES, usos: USOS, servicios: SERVICIOS, formas_pago: FORMAS_PAGO });
    }

    if (partes[2] === "archivo" && ["ticket", "csf"].includes(partes[3]) && request.method === "GET") {
      const { value, metadata } = await leerArchivo(env, `f:${id}:${partes[3]}`);
      if (!value) return new Response("Archivo no disponible (pudo haberse borrado por antigüedad).", { status: 404, headers: cabecerasPanel() });
      const tipo = metadata && (TIPOS_IMAGEN.includes(metadata.tipo) || metadata.tipo === TIPO_PDF) ? metadata.tipo : "application/octet-stream";
      const ext = tipo === TIPO_PDF ? "pdf" : (tipo.split("/")[1] || "bin");
      // Se permite mostrar el archivo dentro del propio panel (mismo sitio), nunca en otros sitios
      return new Response(value, {
        headers: {
          "Content-Type": tipo,
          "Content-Disposition": `inline; filename="${fila.folio}-${partes[3]}.${ext}"`,
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
          "X-Robots-Tag": "noindex, nofollow",
          "Referrer-Policy": "no-referrer",
          "X-Frame-Options": "SAMEORIGIN",
          "Content-Security-Policy": "frame-ancestors 'self'"
        }
      });
    }

    if (request.method === "POST" && partes.length === 3) {
      const cuerpo = await request.json().catch(() => ({}));
      const ahora = new Date().toISOString();

      if (partes[2] === "en-revision") {
        if (fila.estado !== "pendiente") return json({ ok: false, error: "Sólo puedes iniciar revisión de una solicitud recibida." }, 409);
        await env.DB.prepare("UPDATE solicitudes SET estado='en_revision' WHERE id=?").bind(id).run();
        return json({ ok: true });
      }
      if (partes[2] === "enviada") {
        if (fila.estado !== "facturada") return json({ ok: false, error: "Primero registra el CFDI emitido en Facturador." }, 409);
        await env.DB.prepare("UPDATE solicitudes SET estado='enviada', enviada_en=? WHERE id=?").bind(ahora, id).run();
        return json({ ok: true });
      }
      if (partes[2] === "facturar") {
        if (![ "pendiente", "en_revision", "rechazada" ].includes(fila.estado)) return json({ ok: false, error: "Esta solicitud ya está facturada o enviada." }, 409);
        const folioFactura = String(cuerpo.folio_factura || "").trim().slice(0, 60);
        if (!folioFactura) return json({ ok: false, error: "Escribe el folio o UUID de la factura." }, 422);
        const importe = normalizarImporte(cuerpo.importe);
        if (importe === null || !importe || Number(importe) <= 0) return json({ ok: false, error: "Indica un importe válido mayor a cero antes de marcar facturada." }, 422);
        const folioTicket = String(cuerpo.folio_ticket ?? fila.folio_ticket ?? "").trim().slice(0, 40);
        const incompletos = faltantesParaFacturar({ ...fila, folio_ticket: folioTicket }, { regimenes: REGIMENES, usos: USOS });
        if (incompletos.length) return json({ ok: false, error: "Antes de marcar facturada verifica: " + incompletos.join(", ") + ".", faltantes: incompletos }, 422);
        const n = normalizarFolioTicket(folioTicket);
        const ya = await env.DB.prepare("SELECT folio_factura FROM facturas_folios WHERE servicio=? AND folio_normalizado=?")
          .bind(fila.servicio, n).first();
        if (ya) return json({ ok: false, error: "Este ticket ya está facturado con el folio " + ya.folio_factura + ". Revisa y rechaza esta solicitud duplicada.", duplicado: true }, 409);
        // Incluye facturas recientes previas a la introducción del índice.
        const anterior = await env.DB.prepare("SELECT folio_factura FROM solicitudes WHERE id != ? AND servicio=? AND estado IN ('facturada','enviada') AND REPLACE(REPLACE(UPPER(TRIM(folio_ticket)), ' ', ''), '-', '') = ? LIMIT 1")
          .bind(id, fila.servicio, n).first();
        if (anterior) return json({ ok: false, error: "El ticket ya se facturó en otra solicitud (" + anterior.folio_factura + "). No se permite una segunda factura.", duplicado: true }, 409);
        const vence = new Date();
        vence.setFullYear(vence.getFullYear() + 5);
        try {
          // D1 ejecuta batch transaccional: una segunda petición simultánea
          // no puede reservar el mismo ticket dos veces.
          await env.DB.batch([
            env.DB.prepare("INSERT INTO facturas_folios (servicio, folio_normalizado, solicitud_id, folio_factura, creado, vence) VALUES (?, ?, ?, ?, ?, ?)")
              .bind(fila.servicio, n, id, folioFactura, ahora, vence.toISOString()),
            env.DB.prepare("UPDATE solicitudes SET estado='facturada', folio_factura=?, importe=?, folio_ticket=?, resuelta_en=?, motivo=NULL WHERE id=?")
              .bind(folioFactura, importe, folioTicket, ahora, id)
          ]);
        } catch (e) {
          if (/UNIQUE|constraint/i.test(String(e?.message || ""))) return json({ ok: false, error: "El folio ya quedó reservado como facturado. No se permite duplicarlo.", duplicado: true }, 409);
          throw e;
        }
        return json({ ok: true });
      }
      if (partes[2] === "rechazar") {
        if (![ "pendiente", "en_revision" ].includes(fila.estado)) return json({ ok: false, error: "Sólo pueden rechazarse solicitudes no facturadas." }, 409);
        const motivo = String(cuerpo.motivo || "").trim().slice(0, 300);
        if (!motivo) return json({ ok: false, error: "Escribe el motivo." }, 422);
        await env.DB.prepare("UPDATE solicitudes SET estado='rechazada', motivo=?, resuelta_en=? WHERE id=?").bind(motivo, ahora, id).run();
        return json({ ok: true });
      }
      if (partes[2] === "reabrir") {
        if (fila.estado !== "rechazada") return json({ ok: false, error: "Una factura emitida no se reabre sin gestionar antes su cancelación en Facturador." }, 409);
        if (fila.archivos_borrados) return json({ ok: false, error: "Los archivos de esta solicitud ya se borraron; pide al cliente que la envíe de nuevo." }, 409);
        await env.DB.prepare("UPDATE solicitudes SET estado='pendiente', resuelta_en=NULL WHERE id=?").bind(id).run();
        return json({ ok: true });
      }
      if (partes[2] === "leer-ticket") {
        if (!LEER_TICKET_IA || !env.AI) return json({ ok: false, error: "La lectura automática del ticket está desactivada: captura los datos a mano." }, 410);
        const r = await leerTicket(env, id, true);
        if (r.error) return json({ ok: false, error: r.error }, 422);
        return json({ ok: true, datos: r.datos });
      }
      if (partes[2] === "eliminar") {
        if (fila.estado !== "rechazada") return json({ ok: false, error: "Solo se pueden eliminar solicitudes rechazadas." }, 409);
        await borrarArchivo(env, `f:${id}:ticket`);
        await borrarArchivo(env, `f:${id}:csf`);
        await env.DB.prepare("DELETE FROM solicitudes WHERE id = ?").bind(id).run();
        return json({ ok: true });
      }
      if (partes[2] === "datos") {
        if (![ "pendiente", "en_revision", "rechazada" ].includes(fila.estado)) return json({ ok: false, error: "Los datos de un CFDI ya emitido no se pueden alterar desde la solicitud." }, 409);
        const rfc = String(cuerpo.rfc || "").toUpperCase().replace(/[\s-]/g, "");
        const nombre = String(cuerpo.nombre || "").replace(/\s+/g, " ").trim().slice(0, 254);
        const regimen = String(cuerpo.regimen || "");
        const cp = String(cuerpo.cp || "").trim();
        const errores = {};
        if (rfc && !RE_RFC.test(rfc)) errores.rfc = "RFC con formato inválido.";
        if (regimen && !REGIMENES[regimen]) errores.regimen = "Régimen inválido.";
        if (cp && !RE_CP.test(cp)) errores.cp = "Código postal inválido.";
        const importe = "importe" in cuerpo ? normalizarImporte(cuerpo.importe) : (fila.importe || "");
        if (importe === null) errores.importe = "Importe inválido.";
        const telefono = "telefono" in cuerpo ? String(cuerpo.telefono || "").replace(/\D/g, "").slice(-10) : (fila.telefono || "");
        if (telefono && telefono.length !== 10) errores.telefono = "El WhatsApp debe tener 10 dígitos.";
        const folioTicket = "folio_ticket" in cuerpo ? String(cuerpo.folio_ticket || "").trim().slice(0, 40) : (fila.folio_ticket || "");
        if (folioTicket && !folioTicketValido(folioTicket)) errores.folio_ticket = "Escribe únicamente el número del ticket.";
        const placas = "placas" in cuerpo ? limpiarPlacas(cuerpo.placas) : (fila.placas || "");
        const descripcion = "descripcion" in cuerpo ? String(cuerpo.descripcion || "").replace(/\s+/g, " ").trim().slice(0, 120) : (fila.descripcion || "");
        const tarifa = "tarifa" in cuerpo ? String(cuerpo.tarifa || "").replace(/\s+/g, " ").trim().slice(0, 60) : (fila.tarifa || "");
        const cliente = "cliente" in cuerpo ? String(cuerpo.cliente || "").replace(/\s+/g, " ").trim().slice(0, 120) : (fila.cliente || "");
        const formaPago = "forma_pago" in cuerpo ? String(cuerpo.forma_pago || "") : (fila.forma_pago || "");
        if (formaPago && !FORMAS_PAGO[formaPago]) errores.forma_pago = "Forma de pago inválida.";
        const anotacion = "anotacion" in cuerpo ? String(cuerpo.anotacion || "").replace(/\s+/g, " ").trim().slice(0, 80) : (fila.anotacion || "");
        if (Object.keys(errores).length) return json({ ok: false, error: "Revisa los datos.", errores }, 422);
        await env.DB.prepare("UPDATE solicitudes SET rfc=?, nombre=?, regimen=?, cp=?, datos_de_csf=?, importe=?, telefono=?, folio_ticket=?, placas=?, descripcion=?, tarifa=?, anotacion=?, cliente=?, forma_pago=? WHERE id=?")
          .bind(rfc || null, nombre || null, regimen || null, cp || null, cuerpo.de_csf ? 1 : 0, importe || null, telefono || null, folioTicket || null, placas || null, descripcion || null, tarifa || null, anotacion || null, cliente || null, formaPago || null, id).run();
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
<meta name="color-scheme" content="dark"><style>body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:-apple-system,BlinkMacSystemFont,"Helvetica Neue","Segoe UI",Roboto,Arial,sans-serif;background:#000;color:#f5f5f7;padding:24px;box-sizing:border-box;-webkit-font-smoothing:antialiased}main{max-width:30rem;text-align:center}img{height:72px;width:auto;margin:0 auto 18px;display:block}h1{font-size:1.8rem;letter-spacing:-0.025em;margin:0 0 8px}p{color:#a1a1a6;line-height:1.5}</style></head>
<body><main><img src="/img/logo.png" alt=""><h1>Acceso restringido</h1><p>${escaparHtml(mensaje)}</p></main></body></html>`;
}

// ---------------------------------------------------------------------------
// Verificación del inicio de sesión de Cloudflare Access (JWT RS256)
// ---------------------------------------------------------------------------
let cacheCerts = { en: 0, llaves: null, equipo: "" };

// zona "turno": además de la administración, entra la cuenta de la tablet (TURNO_EMAILS)
async function verificarAcceso(request, env, zona = "panel") {
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
  if (!aud.split(",").map(x => x.trim()).some(x => x && auds.includes(x))) return { error: "Sesión no válida para este panel.", status: 401 };
  if (!datos.exp || datos.exp < ahora) return { error: "Tu sesión expiró. Vuelve a iniciar sesión.", status: 401 };
  if (datos.iss !== `https://${equipo}`) return { error: "Sesión inválida.", status: 401 };

  const lista = v => (v || "").toLowerCase().split(",").map(s => s.trim()).filter(Boolean);
  const admins = lista(env.ADMIN_EMAILS);
  const permitidos = zona === "turno" ? [...admins, ...lista(env.TURNO_EMAILS)] : admins;
  const email = String(datos.email || "").toLowerCase();
  if (!email || !permitidos.includes(email)) return { error: zona === "turno" ? "Esta cuenta no tiene permiso para la tablet de turno." : "Tu cuenta no tiene permiso para ver el panel.", status: 403 };
  return { email, admin: admins.includes(email) };
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
// Limpieza diaria: 90 días después de facturar o rechazar se guarda un respaldo
// en Google Sheets (carpeta de Facturación en Drive) y, solo si se confirma, se borra
// el registro completo (datos, ticket y constancia).
// ---------------------------------------------------------------------------
function limiteHistorico() { return new Date(Date.now() - DIAS_A_HISTORICO * 86400e3).toISOString(); }

async function limpiarArchivos(env) {
  await asegurarEsquema(env);
  const limite = new Date(Date.now() - DIAS_RETENCION * 86400e3).toISOString();
  // Controles mínimos de duplicidad: cinco años, sin RFC ni copia de documentos.
  await env.DB.prepare("DELETE FROM facturas_folios WHERE vence < ?").bind(new Date().toISOString()).run();
  const { results } = await env.DB.prepare(
    "SELECT * FROM solicitudes WHERE estado IN ('facturada','enviada','rechazada') AND resuelta_en < ? ORDER BY resuelta_en ASC LIMIT 500"
  ).bind(limite).all();
  if (!results.length) { console.log("limpieza: nada que borrar"); return { borradas: 0 }; }
  if (!env.AVISO_URL || !env.AVISO_TOKEN) { console.error("limpieza: sin script de correo configurado; no se borra nada sin respaldo"); return { borradas: 0, error: "sin respaldo" }; }

  const hoy = new Date(Date.now() - 6 * 3600e3).toISOString().slice(0, 10);
  try {
    const celda = v => { const t = String(v ?? ""); return /^[=+\-@]/.test(t) ? "'" + t : t; };
    const r = await scriptArchivos(env, { op: "hoja", destino: "facturacion", anio: hoy.slice(0, 4), nombre: `Respaldo de facturas borradas ${hoy} · El Castaño`, hojas: [{ nombre: "Facturas", filas: filasExcel(results).map(f => f.map(celda)) }] }, 120000);
    if (!r || r.destino !== "facturacion") throw new Error("el script de Google no tiene la versión con carpetas por área");
  } catch (e) {
    console.error("limpieza: respaldo no confirmado, no se borra nada", e && e.message);
    return { borradas: 0, error: "respaldo no confirmado" };
  }
  for (const r of results) {
    // También registrar las facturas emitidas ANTES de crear el índice,
    // antes de borrar la solicitud. No altera importes ni registros contables.
    if (["facturada", "enviada"].includes(r.estado) && r.folio_factura && normalizarFolioTicket(r.folio_ticket) && ["bascula", "pension"].includes(r.servicio)) {
      const venceFolio = new Date(r.resuelta_en);
      venceFolio.setFullYear(venceFolio.getFullYear() + 5);
      await env.DB.prepare("INSERT OR IGNORE INTO facturas_folios (servicio, folio_normalizado, solicitud_id, folio_factura, creado, vence) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(r.servicio, normalizarFolioTicket(r.folio_ticket), r.id, r.folio_factura, r.resuelta_en, venceFolio.toISOString()).run();
    }
    await borrarArchivo(env, `f:${r.id}:ticket`);
    await borrarArchivo(env, `f:${r.id}:csf`);
    await env.DB.prepare("DELETE FROM solicitudes WHERE id = ?").bind(r.id).run();
  }
  console.log("limpieza: borradas", results.length);
  return { borradas: results.length };
}


// ---------------------------------------------------------------------------
// Lectura de la foto del ticket con Workers AI (modelo de visión)
// ---------------------------------------------------------------------------
const MODELO_VISION = "@cf/meta/llama-3.2-11b-vision-instruct";
const TIPOS_LEGIBLES = ["image/jpeg", "image/png", "image/webp"];

function limpiarPlacas(v) {
  return String(v ?? "").toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 12);
}

async function aceptarLicenciaModelo(env) {
  if (await env.FILES.get("ai:licencia")) return;
  try { await correrIA(env, MODELO_VISION, { prompt: "agree" }); } catch (e) { console.log("licencia", e && e.message); }
  await env.FILES.put("ai:licencia", "1");
}

// ¿Qué es la foto? "pension", "bascula" u "otro" (no es un ticket de El Castaño)
const INSTRUCCIONES_CLASE = `Mira la imagen y di qué es. Opciones:
- "pension": ticket de la PENSIÓN de El Castaño. Encabezado "BASCULA Y PENSION EL CASTAÑO" sin logo; trae "Folio:", "PLACAS", "DESCRIPCIÓN AUTO", "TARIFA" con un código de tarifa, y al final "TICKET DE SALIDA" o "TICKET DE ENTRADA".
- "bascula": ticket de PESAJE de la báscula. Encabezado "BASCULA EL CASTAÑO" junto a un logo de escudo; secciones "DATOS DEL CLIENTE", "DATOS DEL VEHICULO" y "PESAJE" con pesos en kg (PESO BRUTO, PESO TARA, PESO NETO); al final "PESAJE DE SALIDA" o "PESAJE DE ENTRADA".
- "otro": cualquier otra cosa. Por ejemplo personas, animales, paisajes, vehículos, pantallas, capturas de pantalla, papel en blanco, documentos, comprobantes de pago con tarjeta, o tickets y recibos de otros negocios.
Para que sea "pension" o "bascula" tienes que LEER en la imagen texto impreso de ese ticket (el encabezado, "Folio" o los campos). Si no hay texto impreso legible (telas, mallas, texturas, objetos, fotos oscuras o sin letras), es "otro". No adivines.
La foto puede estar girada, inclinada o arrugada; si lees el texto de uno de los dos tickets, no es "otro".
Responde SOLO con JSON: {"clase": "pension" | "bascula" | "otro"}`;

async function clasificarTicket(env, bytes, tipo) {
  const r = await correrIA(env, MODELO_VISION, {
    messages: [{ role: "system", content: "Respondes únicamente con JSON válido." }, { role: "user", content: INSTRUCCIONES_CLASE }],
    image: `data:${tipo};base64,${aBase64(new Uint8Array(bytes))}`,
    max_tokens: 30,
    temperature: 0
  });
  const t = String((r && (r.response ?? r.result?.response)) || "").toLowerCase();
  const m = t.match(/"clase"\s*:\s*"([a-zñáó]+)"/) || t.match(/\b(pension|pensión|bascula|báscula|otro)\b/);
  if (!m) return null;
  const c = m[1].normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return ["pension", "bascula", "otro"].includes(c) ? c : null;
}

// Clasifica y lee el ticket. Se guarda 2 horas por huella de la imagen para no repetir la IA al enviar.
async function revisarTicket(env, bytes, tipo, servicioElegido) {
  if (!TIPOS_LEGIBLES.includes(tipo) || bytes.byteLength > 5 * 1024 * 1024) return { error: "no legible" };
  const llave = "rv:" + await sha256Hex(new Uint8Array(bytes));
  const guardado = await env.FILES.get(llave, { type: "json" });
  if (guardado) return guardado;
  await aceptarLicenciaModelo(env);
  let clase = null, fallo = false;
  try { clase = await clasificarTicket(env, bytes, tipo); } catch (e) { fallo = true; console.error("clasificar", e && e.message); }
  let lectura = null;
  if (clase !== "otro") {
    const servicio = clase || (servicioElegido === "bascula" ? "bascula" : "pension");
    try { lectura = await analizarTicketImagen(env, bytes, tipo, servicio); } catch (e) { fallo = true; console.error("leer", e && e.message); }
    // Solo es ticket si la IA leyó datos reales del ticket (folio o importe). Sin eso, no se acepta.
    const d = lectura && !lectura.error ? lectura.datos : null;
    const conDatos = !!(d && (/\d{3,}/.test(d.folio_ticket || "") || d.importe));
    if (conDatos) clase = clase || servicio;
    else if (!fallo) clase = "otro";
  }
  console.log("revision ticket", JSON.stringify({ clase, fallo, folio: lectura && lectura.datos && lectura.datos.folio_ticket || null }));
  const res = { clase, lectura: lectura && !lectura.error ? lectura : null };
  if (clase) await env.FILES.put(llave, JSON.stringify(res), { expirationTtl: 7200 });
  return res;
}

// Revisión al tomar la foto (no guarda nada de la solicitud)
async function revisarTicketApi(request, env) {
  if (request.method !== "POST") return json({ ok: false, error: "Método no permitido." }, 405);
  const url = new URL(request.url);
  const origin = request.headers.get("Origin");
  if (origin && origin !== url.origin) return json({ ok: false, error: "Origen no permitido." }, 403);
  if (Number(request.headers.get("Content-Length") || 0) > MAX_ARCHIVO + 100000) return json({ ok: false, error: "La foto es demasiado grande." }, 413);
  if (!env.AI) return json({ ok: true, clase: null });
  const ip = request.headers.get("CF-Connecting-IP") || "0";
  const llaveLimite = "rr:" + (await sha256Hex(ip)).slice(0, 24) + ":" + new Date().toISOString().slice(0, 13);
  const conteo = Number(await env.FILES.get(llaveLimite) || 0);
  if (conteo >= 25) return json({ ok: true, clase: null }); // sin revisión previa; se revisa al enviar
  await env.FILES.put(llaveLimite, String(conteo + 1), { expirationTtl: 3700 });
  let form;
  try { form = await request.formData(); } catch { return json({ ok: false, error: "No se pudo leer la foto." }, 400); }
  const ticket = archivo(form, "ticket");
  if (!ticket || !TIPOS_LEGIBLES.includes(ticket.type)) return json({ ok: true, clase: null });
  const rev = await conLimite(revisarTicket(env, await ticket.arrayBuffer(), ticket.type, texto(form, "servicio")), 20000).catch(() => null);
  if (!rev || rev.error) return json({ ok: true, clase: null });
  return json({ ok: true, clase: rev.clase, entrada: rev.clase === "pension" && esTicketDeEntrada(rev.lectura) });
}

// Ticket de la BÁSCULA: folio, cliente y tarifa (la tarifa es lo cobrado por el pesaje)
const INSTRUCCIONES_BASCULA = `Lee el ticket de la imagen. Es un ticket de pesaje impreso de "BASCULA EL CASTAÑO", con logo arriba.
Campos del ticket:
- "FOLIO:" seguido de un número
- En la sección "DATOS DEL CLIENTE": "CLIENTE:" seguido de un nombre, y "TARIFA:" seguido de una cantidad en pesos
- Al final dice "PESAJE DE SALIDA" o "PESAJE DE ENTRADA". Los dos tipos sirven; lee los mismos datos en cualquiera.
La foto puede estar girada, de lado o inclinada: lee el texto en la orientación que tenga.
No confundas el CLIENTE con el CONDUCTOR ni la TARIFA con los pesos en kg.
Si alguien tachó la tarifa impresa y escribió otra cantidad a mano, en "tarifa" pon SIEMPRE la cantidad IMPRESA y copia lo escrito a mano en "anotacion".
Responde SOLO con un objeto JSON, sin texto adicional, con estas claves:
"folio": el número que sigue a "FOLIO",
"cliente": el texto que sigue a "CLIENTE",
"tarifa": el número IMPRESO que sigue a "TARIFA", sin signo de pesos,
"anotacion": cualquier texto o cantidad escrita a mano con pluma sobre el ticket, tal cual; null si no hay nada escrito a mano.
Copia los datos exactamente como aparecen en esta imagen. Si un dato no aparece, está tapado o no se lee con claridad, usa null. No inventes datos.`;

// Analiza la imagen del ticket y devuelve { datos, tipoTicket } o { error }
async function analizarTicketImagen(env, bytes, tipo, servicio) {
  if (!TIPOS_LEGIBLES.includes(tipo)) return { error: "Solo se pueden leer fotos JPG, PNG o WebP. Captura los datos viendo el ticket." };
  if (bytes.byteLength > 5 * 1024 * 1024) return { error: "La foto es demasiado grande para leerla automáticamente." };
  await aceptarLicenciaModelo(env);
  const imagen = `data:${tipo};base64,${aBase64(new Uint8Array(bytes))}`;
  const bascula = servicio === "bascula";
  const instrucciones = bascula ? INSTRUCCIONES_BASCULA : `Lee el ticket de la imagen. Es un ticket impreso de "BASCULA Y PENSION EL CASTAÑO". Hay dos tipos:
- TICKET DE SALIDA (el que sirve para facturar): al final dice "TICKET DE SALIDA" y contiene "FECHA Y HORA DE SALIDA", "TIEMPO COBRADO", "IMPORTE DE ESTACIONAMIENTO" y "TOTAL:" con una cantidad en pesos.
- TICKET DE ENTRADA: al final dice "TICKET DE ENTRADA", solo trae "HORA ENTRADA", tiene código de barras abajo y no tiene TOTAL ni importe. (Aunque mencione "FACTURACIÓN www.basculaypension.com", sigue siendo de entrada.)
La foto puede estar girada, de lado o inclinada: lee el texto en la orientación que tenga.
Campos del ticket:
- Arriba a la izquierda: "Folio:" seguido de un número
- "PLACAS:" seguido de la matrícula
- "DESCRIPCIÓN AUTO:" seguido de una descripción del vehículo
- "TARIFA:" seguida de un código de tarifa y un precio
- "TOTAL:" seguido de una cantidad en pesos
A veces alguien tacha el TOTAL impreso y escribe otra cantidad a mano. En "total" pon SIEMPRE el número IMPRESO, aunque esté tachado, y copia lo escrito a mano en "anotacion".
Puede haber otro papel encima, como un comprobante de pago con tarjeta (Mercado Pago u otro banco). Ignóralo: lee solo el ticket de la báscula y nunca tomes el total del comprobante de pago.
Responde SOLO con un objeto JSON, sin texto adicional, con estas claves:
"tipo": "salida", "entrada" o "desconocido",
"folio": el número que sigue a "Folio",
"placas": el texto que sigue a "PLACAS",
"descripcion": el texto que sigue a "DESCRIPCIÓN AUTO",
"tarifa": el texto completo que sigue a "TARIFA",
"total": el número IMPRESO que sigue a "TOTAL" en el ticket de la báscula, sin signo de pesos,
"anotacion": cualquier texto o cantidad escrita a mano con pluma sobre el ticket, tal cual; null si no hay nada escrito a mano.
Copia los datos exactamente como aparecen en esta imagen. Si un dato no aparece, está tapado o no se lee con claridad, usa null. No inventes datos.`;
  const r = await correrIA(env, MODELO_VISION, {
    messages: [{ role: "system", content: "Respondes únicamente con JSON válido." }, { role: "user", content: instrucciones }],
    image: imagen,
    max_tokens: 350,
    temperature: 0
  });
  const texto = String((r && (r.response ?? r.result?.response)) || "");
  const m = texto.match(/\{[\s\S]*\}/);
  if (!m) { console.warn("ticket sin json: respuesta IA sin formato esperado"); return { error: "No se pudieron leer datos del ticket. Captúralos viendo la foto." }; }
  let d;
  try { d = JSON.parse(m[0]); } catch { return { error: "No se pudieron leer datos del ticket. Captúralos viendo la foto." }; }
  const valor = v => (v === null || v === undefined || String(v).trim() === "" || /^null$/i.test(String(v).trim())) ? "" : String(v).trim();
  const folioLeido = valor(d.folio).replace(/^(folio|no\.?|n[uú]m(ero)?)[:\s#]*/i, "").slice(0, 40);
  const anotacion = valor(d.anotacion).replace(/\s+/g, " ").slice(0, 80);
  if (bascula) {
    return {
      datos: {
        folio_ticket: folioLeido,
        cliente: valor(d.cliente).replace(/^cliente[:\s]*/i, "").replace(/\s+/g, " ").slice(0, 120),
        importe: normalizarImporte(valor(d.tarifa)) || "",
        anotacion
      },
      tipoTicket: "bascula"
    };
  }
  const datos = {
    folio_ticket: folioLeido,
    placas: limpiarPlacas(valor(d.placas)),
    descripcion: valor(d.descripcion).replace(/^descripci[oó]n( auto)?[:\s]*/i, "").replace(/\s+/g, " ").slice(0, 120),
    tarifa: valor(d.tarifa).replace(/^tarifa[:\s]*/i, "").replace(/\s+/g, " ").slice(0, 60),
    importe: normalizarImporte(valor(d.total)) || "",
    anotacion
  };
  const t = valor(d.tipo).toLowerCase();
  const tipoTicket = t.startsWith("entrada") ? "entrada" : t.startsWith("salida") ? "salida" : "desconocido";
  return { datos, tipoTicket };
}

// Es de entrada solo si el modelo lo dice y además no encontró total (evita rechazar por error)
function esTicketDeEntrada(a) {
  return a && !a.error && a.tipoTicket === "entrada" && !a.datos.importe;
}

async function leerTicket(env, id, forzar = false) {
  await asegurarEsquema(env);
  const fila = await env.DB.prepare("SELECT * FROM solicitudes WHERE id = ?").bind(id).first();
  if (!fila) return { error: "No existe esa solicitud." };
  const { value, metadata } = await leerArchivo(env, `f:${id}:ticket`);
  if (!value) return { error: "La foto del ticket ya no está disponible." };
  const a = await analizarTicketImagen(env, value, metadata && metadata.tipo, fila.servicio);
  if (a.error) return a;
  await guardarLecturaTicket(env, fila, a.datos, forzar);
  return { datos: a.datos, tipoTicket: a.tipoTicket };
}

const CAMPOS_TICKET = ["folio_ticket", "cliente", "placas", "descripcion", "tarifa", "importe", "anotacion"];
async function guardarLecturaTicket(env, fila, datos, forzar) {
  // Solo se llenan campos vacíos, salvo que se pida leer de nuevo desde el panel
  const final = {};
  const columnas = Object.keys(datos).filter(k => CAMPOS_TICKET.includes(k));
  for (const k of columnas) final[k] = forzar ? (datos[k] || fila[k] || "") : (fila[k] || datos[k] || "");
  await env.DB.prepare(`UPDATE solicitudes SET ${columnas.map(k => k + "=?").join(", ")}${columnas.length ? ", " : ""}ticket_leido=1 WHERE id=?`)
    .bind(...columnas.map(k => final[k] || null), fila.id).run();
  return final;
}

function conLimite(promesa, ms) {
  return Promise.race([promesa, new Promise(res => setTimeout(() => res({ error: "tiempo agotado" }), ms))]);
}

function aBase64(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
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
  const h = await crypto.subtle.digest("SHA-256", typeof s === "string" ? new TextEncoder().encode(s) : s);
  return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, "0")).join("");
}
function escaparHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
