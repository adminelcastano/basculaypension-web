import { REGIMENES, USOS, SERVICIOS } from "./catalogos.js";
import PANEL_HTML from "./panel.html";

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

// ---------------------------------------------------------------------------
// Entrada
// ---------------------------------------------------------------------------
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/api/solicitud") return await crearSolicitud(request, env, ctx);
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
  // Columnas agregadas después de la primera versión
  const { results: cols } = await env.DB.prepare("PRAGMA table_info(solicitudes)").all();
  const existentes = new Set(cols.map(c => c.name));
  for (const [nombre, tipo] of [["importe", "TEXT"]]) {
    if (!existentes.has(nombre)) await env.DB.prepare(`ALTER TABLE solicitudes ADD COLUMN ${nombre} ${tipo}`).run();
  }
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
  if (telefono.length !== 10) errores.telefono = "Escribe tu WhatsApp a 10 dígitos para avisarte de tu factura.";
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

  if (ctx && env.AVISO_URL && env.AVISO_TOKEN) {
    ctx.waitUntil(enviarAviso(env, url.origin, { folio, servicio, modo, rfc, nombre, email }).catch(e => console.error("aviso", e)));
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

// ---------------------------------------------------------------------------
// Exportar a Excel (.xlsx mínimo, sin librerías)
// ---------------------------------------------------------------------------
const ENCABEZADOS = ["Folio solicitud", "Recibida", "Estado", "Servicio", "Folio ticket", "RFC", "Nombre o razón social", "Código postal", "Régimen fiscal", "Uso CFDI", "Correo", "WhatsApp", "Importe", "Folio factura", "Fecha resolución", "Motivo rechazo"];
function filasExcel(results) {
  const local = iso => iso ? new Date(new Date(iso).getTime() - 6 * 3600e3).toISOString().slice(0, 16).replace("T", " ") : "";
  const est = { pendiente: "Pendiente", facturada: "Facturada", rechazada: "Rechazada" };
  const filas = [ENCABEZADOS];
  for (const r of results) {
    filas.push([r.folio, local(r.creado), est[r.estado] || r.estado, SERVICIOS[r.servicio] || r.servicio || "", r.folio_ticket || "",
      r.rfc || "", r.nombre || "", r.cp || "", r.regimen ? `${r.regimen} ${REGIMENES[r.regimen] || ""}` : "",
      r.uso ? `${r.uso} ${USOS[r.uso] || ""}` : "", r.email || "", r.telefono || "", r.importe ? "$" + Number(r.importe).toLocaleString("es-MX", { minimumFractionDigits: 2 }) : "", r.folio_factura || "", local(r.resuelta_en), r.motivo || ""]);
  }
  return filas;
}

async function exportarXlsx(env, url) {
  const estado = url.searchParams.get("estado") || "facturada";
  const mes = /^\d{4}-\d{2}$/.test(url.searchParams.get("mes") || "") ? url.searchParams.get("mes") : null;
  let sql = "SELECT * FROM solicitudes WHERE 1=1";
  const args = [];
  if (["pendiente", "facturada", "rechazada"].includes(estado)) { sql += " AND estado = ?"; args.push(estado); }
  if (estado === "historico") { sql += " AND estado IN ('facturada','rechazada') AND resuelta_en < ?"; args.push(limiteHistorico()); }
  if (mes) {
    // Mes en hora de Tapachula (UTC-6): de día 1 a las 06:00 UTC al día 1 del mes siguiente
    const [a, m] = mes.split("-").map(Number);
    const desde = new Date(Date.UTC(a, m - 1, 1, 6)).toISOString();
    const hasta = new Date(Date.UTC(a, m, 1, 6)).toISOString();
    const campo = ["facturada", "rechazada", "historico"].includes(estado) ? "resuelta_en" : "creado";
    sql += ` AND ${campo} >= ? AND ${campo} < ?`; args.push(desde, hasta);
  }
  sql += " ORDER BY creado ASC LIMIT 5000";
  const { results } = await env.DB.prepare(sql).bind(...args).all();
  const filas = filasExcel(results);
  const nombre = `facturas-${estado}${mes ? "-" + mes : ""}.xlsx`;
  return new Response(crearXlsx(filas), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${nombre}"`,
      ...cabecerasPanel()
    }
  });
}

function crearXlsx(filas) {
  const col = i => { let s = ""; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
  const xml = v => String(v).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
  const anchos = [16, 17, 11, 16, 14, 16, 36, 13, 40, 26, 30, 13, 13, 22, 17, 30];
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${anchos.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols><sheetData>${filas.map((f, r) => `<row r="${r + 1}">${f.map((v, c) => `<c r="${col(c)}${r + 1}" t="inlineStr"${r === 0 ? ' s="1"' : ""}><is><t xml:space="preserve">${xml(v)}</t></is></c>`).join("")}</row>`).join("")}</sheetData>${filas.length > 1 ? `<autoFilter ref="A1:${col(filas[0].length - 1)}${filas.length}"/>` : ""}</worksheet>`;
  const archivos = {
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    "_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Facturas" sheetId="1" r:id="rId1"/></sheets>${filas.length > 1 ? `<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">Facturas!$A$1:$${col(filas[0].length - 1)}$${filas.length}</definedName></definedNames>` : ""}</workbook>`,
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    "xl/styles.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF3EBE5"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`,
    "xl/worksheets/sheet1.xml": sheet
  };
  return zipSinCompresion(archivos);
}

function zipSinCompresion(archivos) {
  const enc = new TextEncoder();
  const tabla = crc32Tabla();
  const partes = [], central = [];
  let desplazamiento = 0;
  for (const [nombre, contenido] of Object.entries(archivos)) {
    const n = enc.encode(nombre), datos = enc.encode(contenido);
    let crc = 0xffffffff;
    for (const b of datos) crc = tabla[(crc ^ b) & 0xff] ^ (crc >>> 8);
    crc = (crc ^ 0xffffffff) >>> 0;
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true);
    local.setUint16(8, 0, true); local.setUint32(14, crc, true); local.setUint32(18, datos.length, true);
    local.setUint32(22, datos.length, true); local.setUint16(26, n.length, true);
    partes.push(new Uint8Array(local.buffer), n, datos);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true);
    c.setUint32(16, crc, true); c.setUint32(20, datos.length, true); c.setUint32(24, datos.length, true);
    c.setUint16(28, n.length, true); c.setUint32(42, desplazamiento, true);
    central.push(new Uint8Array(c.buffer), n);
    desplazamiento += 30 + n.length + datos.length;
  }
  const tamCentral = central.reduce((s, p) => s + p.length, 0);
  const fin = new DataView(new ArrayBuffer(22));
  fin.setUint32(0, 0x06054b50, true); fin.setUint16(8, Object.keys(archivos).length, true);
  fin.setUint16(10, Object.keys(archivos).length, true); fin.setUint32(12, tamCentral, true); fin.setUint32(16, desplazamiento, true);
  const todo = [...partes, ...central, new Uint8Array(fin.buffer)];
  const out = new Uint8Array(todo.reduce((s, p) => s + p.length, 0));
  let o = 0; for (const p of todo) { out.set(p, o); o += p.length; }
  return out;
}
let _crcTabla;
function crc32Tabla() {
  if (_crcTabla) return _crcTabla;
  _crcTabla = new Uint32Array(256);
  for (let i = 0; i < 256; i++) { let c = i; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; _crcTabla[i] = c >>> 0; }
  return _crcTabla;
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
  if (partes[0] === "exportar" && request.method === "GET") return await exportarXlsx(env, url);

  if (partes[0] === "solicitudes" && partes.length === 1 && request.method === "GET") {
    const estado = ["pendiente", "facturada", "rechazada", "historico"].includes(url.searchParams.get("estado")) ? url.searchParams.get("estado") : "pendiente";
    const q = (url.searchParams.get("q") || "").trim().slice(0, 60);
    const lim = limiteHistorico();
    let sql = "SELECT id, folio, creado, estado, servicio, folio_ticket, modo, rfc, nombre, email, folio_factura, resuelta_en FROM solicitudes WHERE ";
    const args = [];
    if (estado === "pendiente") sql += "estado = 'pendiente'";
    else if (estado === "historico") { sql += "estado IN ('facturada','rechazada') AND resuelta_en < ?"; args.push(lim); }
    else { sql += "estado = ? AND resuelta_en >= ?"; args.push(estado, lim); }
    if (q) {
      sql += " AND (rfc LIKE ? OR nombre LIKE ? OR folio LIKE ? OR email LIKE ? OR folio_ticket LIKE ? OR folio_factura LIKE ?)";
      const like = "%" + q.replace(/[%_]/g, "") + "%";
      args.push(like, like, like, like, like, like);
    }
    sql += estado === "pendiente" ? " ORDER BY creado ASC LIMIT 300" : " ORDER BY resuelta_en DESC LIMIT 300";
    const { results } = await env.DB.prepare(sql).bind(...args).all();
    const conteos = await env.DB.prepare(
      "SELECT CASE WHEN estado != 'pendiente' AND resuelta_en < ? THEN 'historico' ELSE estado END AS grupo, COUNT(*) AS n FROM solicitudes GROUP BY grupo"
    ).bind(lim).all();
    return json({ ok: true, solicitudes: results, conteos: Object.fromEntries(conteos.results.map(r => [r.grupo, r.n])), dias_retencion: DIAS_RETENCION });
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
        const importe = normalizarImporte(cuerpo.importe);
        if (importe === null) return json({ ok: false, error: "El importe no es válido. Escríbelo como 350 o 1250.50" }, 422);
        const folioTicket = String(cuerpo.folio_ticket ?? fila.folio_ticket ?? "").trim().slice(0, 40);
        await env.DB.prepare("UPDATE solicitudes SET estado='facturada', folio_factura=?, importe=?, folio_ticket=?, resuelta_en=?, motivo=NULL WHERE id=?")
          .bind(folioFactura, importe || null, folioTicket || null, ahora, id).run();
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
      if (partes[2] === "eliminar") {
        if (fila.estado !== "rechazada") return json({ ok: false, error: "Solo se pueden eliminar solicitudes rechazadas." }, 409);
        await env.FILES.delete(`f:${id}:ticket`);
        await env.FILES.delete(`f:${id}:csf`);
        await env.DB.prepare("DELETE FROM solicitudes WHERE id = ?").bind(id).run();
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
        const importe = "importe" in cuerpo ? normalizarImporte(cuerpo.importe) : (fila.importe || "");
        if (importe === null) errores.importe = "Importe inválido.";
        const telefono = "telefono" in cuerpo ? String(cuerpo.telefono || "").replace(/\D/g, "").slice(-10) : (fila.telefono || "");
        if (telefono && telefono.length !== 10) errores.telefono = "El WhatsApp debe tener 10 dígitos.";
        const folioTicket = "folio_ticket" in cuerpo ? String(cuerpo.folio_ticket || "").trim().slice(0, 40) : (fila.folio_ticket || "");
        if (Object.keys(errores).length) return json({ ok: false, error: "Revisa los datos.", errores }, 422);
        await env.DB.prepare("UPDATE solicitudes SET rfc=?, nombre=?, regimen=?, cp=?, datos_de_csf=?, importe=?, telefono=?, folio_ticket=? WHERE id=?")
          .bind(rfc || null, nombre || null, regimen || null, cp || null, cuerpo.de_csf ? 1 : 0, importe || null, telefono || null, folioTicket || null, id).run();
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
// Limpieza diaria: 90 días después de facturar o rechazar se envía un respaldo
// en Excel al correo del negocio y, solo si el envío se confirma, se borra el
// registro completo (datos, ticket y constancia).
// ---------------------------------------------------------------------------
function limiteHistorico() { return new Date(Date.now() - DIAS_A_HISTORICO * 86400e3).toISOString(); }

async function limpiarArchivos(env) {
  await asegurarEsquema(env);
  const limite = new Date(Date.now() - DIAS_RETENCION * 86400e3).toISOString();
  const { results } = await env.DB.prepare(
    "SELECT * FROM solicitudes WHERE estado IN ('facturada','rechazada') AND resuelta_en < ? ORDER BY resuelta_en ASC LIMIT 500"
  ).bind(limite).all();
  if (!results.length) { console.log("limpieza: nada que borrar"); return { borradas: 0 }; }
  if (!env.AVISO_URL || !env.AVISO_TOKEN) { console.error("limpieza: sin script de correo configurado; no se borra nada sin respaldo"); return { borradas: 0, error: "sin respaldo" }; }

  const hoy = new Date(Date.now() - 6 * 3600e3).toISOString().slice(0, 10);
  const xlsx = crearXlsx(filasExcel(results));
  const nombre = `respaldo-facturas-${hoy}.xlsx`;
  try {
    await llamarScript(env, {
      asunto: `Respaldo: ${results.length} solicitud(es) de factura eliminadas el ${hoy}`,
      texto: `Se adjunta el respaldo en Excel de ${results.length} solicitud(es) facturadas o rechazadas hace más de ${DIAS_RETENCION} días. Estos registros, sus tickets y constancias se eliminan hoy del panel.`,
      html: `<p style="font-family:Arial,sans-serif;font-size:15px">Se adjunta el respaldo en Excel de <b>${results.length}</b> solicitud(es) facturadas o rechazadas hace más de ${DIAS_RETENCION} días.</p><p style="font-family:Arial,sans-serif;font-size:15px">Estos registros, sus tickets y constancias se eliminan hoy del panel. Guarda este correo como respaldo.</p>`,
      adjunto: { nombre, tipo: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", base64: aBase64(xlsx) }
    });
  } catch (e) {
    console.error("limpieza: respaldo no confirmado, no se borra nada", e && e.message);
    return { borradas: 0, error: "respaldo no confirmado" };
  }
  for (const r of results) {
    await env.FILES.delete(`f:${r.id}:ticket`);
    await env.FILES.delete(`f:${r.id}:csf`);
    await env.DB.prepare("DELETE FROM solicitudes WHERE id = ?").bind(r.id).run();
  }
  console.log("limpieza: borradas", results.length);
  return { borradas: results.length };
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
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, "0")).join("");
}
function escaparHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
