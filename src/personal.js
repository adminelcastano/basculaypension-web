import { guardarArchivo, leerArchivo, borrarArchivo } from "./fotos.js";
import { correrIA } from "./neuronas.js";
// ---------------------------------------------------------------------------
// Personal: expediente laboral de colaboradores
// Cada colaborador recibe un enlace personal (/expediente/<token>) para llenar
// sus datos; en el panel se palomean los documentos entregados en físico.
// No se guardan escaneos de documentos: solo si se recibieron y cuándo.
// ---------------------------------------------------------------------------
import EXPEDIENTE_HTML from "./expediente.html";

// Version estable: futuras versiones se registran por separado, sin sobreescribir la primera fecha.
export const VERSION_AVISO_PERSONAL_V1 = "personal-aviso-v1-2026-10-17";
const DOC_AVISO_PERSONAL = "aviso-privacidad-colaboradores";

export const DOCUMENTOS = {
  ine: "INE",
  curp: "CURP",
  solicitud: "Solicitud de empleo",
  acta: "Acta de nacimiento",
  domicilio: "Comprobante de domicilio",
  estudios: "Comprobante de último grado de estudios"
};

// Externos: personas que trabajan dentro de El Castaño sin ser colaboradores (lavado de trailers, venta de ropa o comida)
export const DOCUMENTOS_EXTERNO = { ine: "INE", curp: "CURP", domicilio: "Comprobante de domicilio", foto: "Fotografía" };
export const ACTIVIDADES = ["Lavado de trailers", "Venta de ropa", "Venta de comida", "Otra"];
const TIPOS = ["colaborador", "externo"];
// Los externos se registran con el encargado de turno: a él le llegan el enlace y los cambios de estatus
export const ENCARGADO_CORREO = "entrada@basculaypension.com";
export const ENCARGADO_WA = "9622165453";

// Folio: 001_JPL_010224 (colaboradores, con su fecha de ingreso) o 001_RM (externos)
const PARTICULAS = new Set(["de", "del", "la", "las", "los", "y", "e", "da", "van", "von"]);
function iniciales(nombre) {
  return String(nombre || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").split(/[\s-]+/)
    .filter(w => w && !PARTICULAS.has(w.toLowerCase())).map(w => w[0].toUpperCase()).filter(c => /[A-Z]/.test(c)).join("") || "X";
}
export function folioDe(f) {
  const admin = parse(f.admin);
  const base = `${String(f.num || 0).padStart(3, "0")}_${iniciales(f.nombre)}`;
  if (f.tipo === "externo") return base;
  const m = String(admin.fecha_ingreso || "").match(/^\d{2}(\d{2})-(\d{2})-(\d{2})$/);
  return m ? `${base}_${m[3]}${m[2]}${m[1]}` : base;
}
export const ESCOLARIDAD = ["Primaria", "Secundaria", "Preparatoria o bachillerato", "Carrera técnica", "Licenciatura", "Posgrado", "Sin estudios"];
export const ESTADO_CIVIL = ["Soltero(a)", "Casado(a)", "Unión libre", "Divorciado(a)", "Viudo(a)"];
export const NACIONALIDAD = ["Nacional", "Naturalizado"];
const ID_NATURALIZADO = "Identificación oficial (pasaporte o tarjeta de residente)";
export const PUESTOS = ["Báscula y Pensión", "Administración", "Mantenimiento"];

// Campos que llena el colaborador desde su enlace: [clave, largo máximo, tipo]
export const CAMPOS_COLABORADOR = [
  ["nombre", 120], ["fecha_nacimiento", 10, "fecha"], ["lugar_nacimiento", 80], ["curp", 18, "curp"],
  ["estado_civil", 30, "lista:estado_civil"], ["telefono", 10, "tel"], ["correo", 120, "email"],
  ["calle", 120], ["colonia", 80], ["municipio", 80], ["cp", 5, "cp"],
  ["emerg_nombre", 120], ["emerg_parentesco", 40], ["emerg_telefono", 10, "tel"],
  ["escolaridad", 40, "lista:escolaridad"], ["institucion", 120]
];
const ETIQUETAS = {
  nombre: "Nombre", fecha_nacimiento: "Fecha de nacimiento", lugar_nacimiento: "Lugar de nacimiento", curp: "CURP", estado_civil: "Estado civil",
  telefono: "Teléfono", correo: "Correo", calle: "Calle y número", colonia: "Colonia", municipio: "Municipio", cp: "Código postal",
  emerg_nombre: "Contacto de emergencia", emerg_parentesco: "Parentesco (emergencia)", emerg_telefono: "Teléfono de emergencia",
  escolaridad: "Escolaridad", institucion: "Escuela"
};
export const REQUERIDOS = ["nombre", "fecha_nacimiento", "curp", "telefono", "correo", "calle", "colonia", "municipio", "emerg_nombre", "emerg_parentesco", "emerg_telefono"];

// Campos que solo llena el administrador en el panel
export const CAMPOS_ADMIN = [
  ["nacionalidad", 20, "lista:nacionalidad"], ["puesto", 40, "lista:puestos"], ["actividad", 40, "lista:actividades"], ["fecha_ingreso", 10, "fecha"], ["turno", 60],
  ["fecha_entrevista", 10, "fecha"], ["notas", 2000]
];

const LISTAS = { estado_civil: ESTADO_CIVIL, escolaridad: ESCOLARIDAD, puestos: PUESTOS, nacionalidad: NACIONALIDAD, actividades: ACTIVIDADES };
const RE_CURP = /^[A-Z][AEIOUX][A-Z]{2}\d{6}[HMX][A-Z]{5}[A-Z0-9]\d$/;
const RE_EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/;
const RE_TOKEN = /^[0-9a-f]{32}$/;
const LIMITE_POR_HORA = 20;

let esquemaListo = false;
export async function asegurarEsquemaPersonal(env) {
  if (esquemaListo) return;
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS colaboradores (
    id TEXT PRIMARY KEY,
    token TEXT NOT NULL UNIQUE,
    creado TEXT NOT NULL,
    actualizado TEXT NOT NULL,
    nombre TEXT NOT NULL,
    telefono TEXT,
    datos TEXT NOT NULL DEFAULT '{}',
    admin TEXT NOT NULL DEFAULT '{}',
    docs TEXT NOT NULL DEFAULT '{}',
    llenado_en TEXT
  )`).run();
  // Columnas agregadas después de la primera versión
  const { results: cols } = await env.DB.prepare("PRAGMA table_info(colaboradores)").all();
  const existentes = new Set(cols.map(c => c.name));
  for (const [nombre, tipo] of [["estatus", "TEXT NOT NULL DEFAULT 'activo'"], ["fecha_baja", "TEXT"], ["motivo_baja", "TEXT"], ["correo_enviado", "TEXT"], ["llenado_aviso", "TEXT"], ["recordado", "TEXT"], ["admin_docs", "TEXT NOT NULL DEFAULT '[]'"], ["tipo", "TEXT NOT NULL DEFAULT 'colaborador'"], ["num", "INTEGER"], ["estatus_avisado", "TEXT"]]) {
    if (!existentes.has(nombre)) await env.DB.prepare(`ALTER TABLE colaboradores ADD COLUMN ${nombre} ${tipo}`).run();
  }
  // Número único consecutivo para el folio (se asigna a los registros que no lo tienen, por antigüedad)
  const { results: sinNum } = await env.DB.prepare("SELECT id FROM colaboradores WHERE num IS NULL ORDER BY creado ASC").all();
  if (sinNum.length) {
    const r = await env.DB.prepare("SELECT COALESCE(MAX(num), 0) AS m FROM colaboradores").first();
    let n = r ? r.m : 0;
    for (const f of sinNum) await env.DB.prepare("UPDATE colaboradores SET num = ? WHERE id = ?").bind(++n, f.id).run();
  }
  // Campañas: los enlaces personales solo funcionan mientras la persona está en una campaña activa
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS campanas (
    id TEXT PRIMARY KEY, nombre TEXT NOT NULL, creado TEXT NOT NULL, limite TEXT NOT NULL,
    docs TEXT NOT NULL DEFAULT '[]', estado TEXT NOT NULL DEFAULT 'activa', cerrada TEXT, recordada TEXT
  )`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS campana_personas (
    campana_id TEXT NOT NULL, colaborador_id TEXT NOT NULL, enviado TEXT, PRIMARY KEY (campana_id, colaborador_id)
  )`).run();
  // Constancias digitales vinculadas únicamente al expediente laboral, no a PIN ni CASTAGRAM.
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS personal_constancias (
    colaborador_id TEXT NOT NULL,
    documento TEXT NOT NULL,
    version TEXT NOT NULL,
    aceptado_en TEXT NOT NULL,
    medio TEXT NOT NULL,
    campana_id TEXT,
    PRIMARY KEY (colaborador_id, documento, version)
  )`).run();
  // La fecha límite general de antes se convierte en una campaña (sin volver a mandar correos)
  const cfg = await leerConfig(env);
  if (cfg.fecha_limite) {
    if (cfg.fecha_limite >= hoyLocal()) {
      const { results: inc } = await env.DB.prepare("SELECT * FROM colaboradores WHERE estatus != 'inactivo' AND COALESCE(tipo, 'colaborador') = 'colaborador'").all();
      const ids = inc.filter(f => !estaCompleto(f)).map(f => f.id);
      if (ids.length) await crearCampanaFilas(env, { nombre: "Entrega de expediente laboral", limite: cfg.fecha_limite, docs: [] }, ids, new Date().toISOString());
    }
    delete cfg.fecha_limite;
    await env.FILES.put("cfg:personal", JSON.stringify(cfg));
  }
  esquemaListo = true;
}

function nuevoToken() {
  return [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, "0")).join("");
}

function limpiar(valor, largo, tipo) {
  let v = String(valor ?? "").replace(/\s+/g, " ").trim();
  if (tipo === "tel" || tipo === "cp") v = v.replace(/\D/g, "");
  if (tipo === "tel") v = v.slice(-10);
  if (tipo === "curp") v = v.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (tipo === "email") v = v.toLowerCase();
  return v.slice(0, largo);
}

function validar(v, tipo) {
  if (!v || !tipo) return "";
  if (tipo === "tel" && v.length !== 10) return "Debe tener 10 dígitos.";
  if (tipo === "cp" && v.length !== 5) return "Debe tener 5 dígitos.";
  if (tipo === "curp" && !RE_CURP.test(v)) return "Revisa la CURP: son 18 letras y números.";
  if (tipo === "email" && !RE_EMAIL.test(v)) return "Correo inválido.";
  if (tipo === "fecha" && !/^\d{4}-\d{2}-\d{2}$/.test(v)) return "Fecha inválida.";
  if (tipo.startsWith("lista:") && !LISTAS[tipo.slice(6)].includes(v)) return "Elige una opción.";
  return "";
}

// Lee y valida un conjunto de campos; devuelve { datos, errores }
function leerCampos(cuerpo, campos, requeridos = []) {
  const datos = {}, errores = {};
  for (const [k, largo, tipo] of campos) {
    const v = limpiar(cuerpo[k], largo, tipo);
    if (v) datos[k] = v;
    const e = validar(v, tipo);
    if (e) errores[k] = e;
    else if (!v && requeridos.includes(k)) errores[k] = "Este dato es obligatorio.";
  }
  return { datos, errores };
}

// Fotos que se pueden subir por documento (la INE o identificación lleva frente y reverso)
const ARCHIVOS = { ine: ["ine", "ine2"], curp: ["curp"], solicitud: ["solicitud", "solicitud2"], acta: ["acta"], domicilio: ["domicilio"], estudios: ["estudios"], foto: ["foto"] };
const DOC_DE_ARCHIVO = Object.fromEntries(Object.entries(ARCHIVOS).flatMap(([d, as]) => as.map(a => [a, d])));
const MAX_FOTO = 10 * 1024 * 1024;
const TIPOS_FOTO = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/pdf"];
const TIPOS_LEGIBLES = ["image/jpeg", "image/png", "image/webp"];
const MODELO_VISION = "@cf/meta/llama-3.2-11b-vision-instruct";

// Nombres de los documentos según la nacionalidad elegida en el alta
function nombresDocs(admin, tipo) {
  const n = { ...(tipo === "externo" ? DOCUMENTOS_EXTERNO : DOCUMENTOS) };
  if (admin && admin.nacionalidad === "Naturalizado") n.ine = ID_NATURALIZADO;
  return n;
}
function docsResumen(docs, admin, tipo) {
  const lista = Object.entries(nombresDocs(admin, tipo)).map(([k, nombre]) => ({
    clave: k, nombre, recibido: !!(docs[k] && docs[k].recibido), fecha: docs[k] && docs[k].fecha || null,
    fotos: ARCHIVOS[k].filter(a => docs[k] && docs[k].fotos && docs[k].fotos[a]).map(a => ({ archivo: a, fecha: docs[k].fotos[a] })),
    piezas: ARCHIVOS[k].length
  }));
  return { lista, entregados: lista.filter(d => d.recibido).length, total: lista.length };
}

function parse(s) { try { return JSON.parse(s || "{}") || {}; } catch { return {}; } }

function cabecerasPrivadas(extra = {}) {
  return {
    "Cache-Control": "no-store",
    "X-Robots-Tag": "noindex, nofollow",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",   // el enlace lleva el token: nunca se comparte con otros sitios
    "X-Frame-Options": "DENY",
    ...extra
  };
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...cabecerasPrivadas() } });
}

async function sha256Hex(s) {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, "0")).join("");
}

// ---------------------------------------------------------------------------
// Público: página y API del enlace personal
// ---------------------------------------------------------------------------
export async function expedientePagina(request, env, url) {
  const token = url.pathname.split("/")[2] || "";
  const csp = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";
  if (!RE_TOKEN.test(token)) return new Response("Enlace no válido.", { status: 404, headers: cabecerasPrivadas({ "Content-Type": "text/plain; charset=utf-8" }) });
  return new Response(EXPEDIENTE_HTML, { headers: cabecerasPrivadas({ "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": csp }) });
}

// Aviso a la administración cada vez que un colaborador envía el formulario
function avisoAdmin(nombre, primeraVez, cambios, docs, subidos = [], tipoPersona = "colaborador") {
  const ext = tipoPersona === "externo";
  const tipo = (primeraVez ? (ext ? "Registro nuevo de externo" : "Expediente nuevo") : (ext ? "Actualización de externo" : "Actualización de expediente"));
  const panel = `${SITIO}/panel#personal`;
  const lista = primeraVez ? [] : cambios.map(([k, antes, ahora]) => `${ETIQUETAS[k] || k}: ${antes || "(vacío)"} → ${ahora || "(vacío)"}`);
  const resumenDocs = `${docs.entregados} de ${docs.total} documentos entregados${subidos.length ? ". Subió foto de: " + subidos.join(", ") : ""}`;
  const texto = `${tipo}: ${nombre}\n\n${primeraVez ? "Llenó sus datos por primera vez." : lista.length ? "Cambió:\n" + lista.map(l => "- " + l).join("\n") : "Volvió a enviar sus datos sin cambios."}\n\n${resumenDocs}.\n\nRevísalo en el panel: ${panel}`;
  const html = `<p style="font-family:Arial,sans-serif;font-size:15px"><b>${escH(tipo)}</b>: ${escH(nombre)}</p>
<p style="font-family:Arial,sans-serif;font-size:15px">${primeraVez ? "Llenó sus datos por primera vez (proceso inicial)." : lista.length ? "Cambió:" : "Volvió a enviar sus datos sin cambios."}</p>
${lista.length ? `<ul style="font-family:Arial,sans-serif;font-size:14px">${lista.map(l => `<li>${escH(l)}</li>`).join("")}</ul>` : ""}
<p style="font-family:Arial,sans-serif;font-size:15px;color:#555">${escH(resumenDocs)}.</p>
<p><a href="${panel}" style="display:inline-block;background:#ffcc00;color:#111;padding:10px 18px;border-radius:8px;text-decoration:none;font-family:Arial,sans-serif;font-weight:bold">Abrir Personal en el panel</a></p>`;
  return { asunto: `${tipo} · ${nombre}`, texto, html };
}

// ---------------------------------------------------------------------------
// Lectura de documentos con IA (llena los campos que el colaborador dejó vacíos)
// ---------------------------------------------------------------------------
const INSTRUCCIONES_DOC = {
  ine: `Es una credencial para votar del INE de México (frente). Lee:
"nombre": el nombre completo en este orden: nombre(s) y luego apellido paterno y materno (en la credencial aparecen primero los apellidos);
"curp": la CURP de 18 caracteres; "fecha_nacimiento": la fecha de nacimiento como DD/MM/AAAA;
"calle": calle y número del domicilio; "colonia": la colonia; "cp": el código postal de 5 dígitos; "municipio": el municipio o ciudad.`,
  ine_ext: `Es un pasaporte o una tarjeta de residente. Lee:
"nombre": el nombre completo en este orden: nombre(s) y luego apellidos; "fecha_nacimiento": la fecha de nacimiento como DD/MM/AAAA;
"curp": la CURP de 18 caracteres si aparece.`,
  curp: `Es una constancia de la CURP de México. Lee:
"curp": la clave CURP de 18 caracteres; "nombre": el nombre completo (nombre(s) y luego apellidos);
"fecha_nacimiento": la fecha de nacimiento como DD/MM/AAAA; "lugar_nacimiento": la entidad de nacimiento.`,
  acta: `Es un acta de nacimiento de México. Lee los datos de la persona registrada (no de los padres):
"nombre": su nombre completo (nombre(s) y luego apellidos); "fecha_nacimiento": como DD/MM/AAAA;
"lugar_nacimiento": el lugar de nacimiento (municipio y estado); "curp": su CURP si aparece.`,
  domicilio: `Es un comprobante de domicilio (recibo de luz, agua, teléfono o similar). Lee el domicilio del servicio:
"calle": calle y número; "colonia": la colonia; "cp": el código postal de 5 dígitos; "municipio": el municipio o ciudad.`,
  estudios: `Es un comprobante de estudios (certificado, título o constancia). Lee:
"nivel": el nivel de estudios, uno de: Primaria, Secundaria, Preparatoria o bachillerato, Carrera técnica, Licenciatura, Posgrado;
"institucion": el nombre de la escuela.`
};

function fechaISO(v) {
  const m = String(v || "").match(/(\d{1,2})[\/\-. ](\d{1,2})[\/\-. ](\d{4})/);
  if (!m) return "";
  const [d, mes, a] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (d < 1 || d > 31 || mes < 1 || mes > 12 || a < 1930 || a > new Date().getFullYear()) return "";
  return `${a}-${String(mes).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
function titulo(v) { return String(v || "").toLowerCase().replace(/(^|[\s-])([a-záéíóúñü])/g, (x, a, b) => a + b.toUpperCase()); }

async function leerDocumento(env, archivo, bytes, tipo, admin) {
  if (!env.AI || !TIPOS_LEGIBLES.includes(tipo) || bytes.byteLength > 5 * 1024 * 1024) return {};
  let clave = DOC_DE_ARCHIVO[archivo];
  if (archivo === "ine2" || clave === "solicitud" || clave === "foto") return {};
  if (clave === "ine" && admin && admin.nacionalidad === "Naturalizado") clave = "ine_ext";
  const instr = INSTRUCCIONES_DOC[clave];
  if (!instr) return {};
  if (!(await env.FILES.get("ai:licencia"))) {
    try { await correrIA(env, MODELO_VISION, { prompt: "agree" }); } catch {}
    await env.FILES.put("ai:licencia", "1");
  }
  let bin = ""; const u = new Uint8Array(bytes);
  for (let i = 0; i < u.length; i += 0x8000) bin += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  let r;
  try {
    r = await Promise.race([
      correrIA(env, MODELO_VISION, {
        messages: [{ role: "system", content: "Respondes únicamente con JSON válido." },
          { role: "user", content: `${instr}\nLa foto puede estar girada o inclinada. Copia los datos exactamente como aparecen. Si un dato no se lee con claridad, usa null. No inventes datos.\nResponde SOLO con un objeto JSON con esas claves.` }],
        image: `data:${tipo};base64,${btoa(bin)}`, max_tokens: 300, temperature: 0
      }),
      new Promise((_, rej) => setTimeout(() => rej(new Error("tiempo")), 25000))
    ]);
  } catch (e) { console.log("leer documento", e && e.message); return {}; }
  const t = String((r && (r.response ?? r.result?.response)) || "");
  const m = t.match(/\{[\s\S]*\}/);
  if (!m) return {};
  let d; try { d = JSON.parse(m[0]); } catch { return {}; }
  const v = k => { const x = d[k]; return x === null || x === undefined || /^null$/i.test(String(x).trim()) ? "" : String(x).replace(/\s+/g, " ").trim(); };
  const out = {};
  const curp = v("curp").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (RE_CURP.test(curp)) out.curp = curp;
  const nombre = v("nombre"); if (nombre && nombre.length >= 5 && !/\d/.test(nombre)) out.nombre = titulo(nombre).slice(0, 120);
  const fecha = fechaISO(v("fecha_nacimiento")); if (fecha) out.fecha_nacimiento = fecha;
  if (v("lugar_nacimiento")) out.lugar_nacimiento = titulo(v("lugar_nacimiento")).slice(0, 80);
  if (v("calle")) out.calle = titulo(v("calle")).slice(0, 120);
  if (v("colonia")) out.colonia = titulo(v("colonia").replace(/^col(onia)?\.?\s*/i, "")).slice(0, 80);
  if (v("municipio")) out.municipio = titulo(v("municipio")).slice(0, 80);
  const cp = v("cp").replace(/\D/g, ""); if (cp.length === 5) out.cp = cp;
  const nivel = ESCOLARIDAD.find(n => n.toLowerCase() === v("nivel").toLowerCase()) || ESCOLARIDAD.find(n => v("nivel") && n.toLowerCase().startsWith(v("nivel").toLowerCase().slice(0, 5)));
  if (nivel) out.escolaridad = nivel;
  if (v("institucion")) out.institucion = v("institucion").slice(0, 120);
  return out;
}

// Sube la foto de un documento desde el enlace personal: se guarda y se palomea solo
async function subirFoto(request, env, fila, archivo, ctx) {
  const clave = DOC_DE_ARCHIVO[archivo];
  if (!clave || !nombresDocs(null, fila.tipo)[clave]) return json({ ok: false, error: "Documento desconocido." }, 404);
  const tipo = (request.headers.get("Content-Type") || "").split(";")[0].trim().toLowerCase();
  if (!TIPOS_FOTO.includes(tipo)) return json({ ok: false, error: "Sube una foto (JPG, PNG o HEIC) o un PDF." }, 415);
  if (Number(request.headers.get("Content-Length") || 0) > MAX_FOTO) return json({ ok: false, error: "El archivo pesa más de 10 MB. Toma la foto de nuevo o envía uno más ligero." }, 413);
  const bytes = await request.arrayBuffer();
  if (!bytes.byteLength) return json({ ok: false, error: "El archivo llegó vacío. Intenta de nuevo." }, 400);
  if (bytes.byteLength > MAX_FOTO) return json({ ok: false, error: "El archivo pesa más de 10 MB." }, 413);
  const ahora = new Date().toISOString();
  await guardarArchivo(env, `x:${fila.id}:${archivo}`, bytes, { tipo, metadata: { subido: ahora }, soloKV: true });
  enSegundoPlano(ctx, aDrive(env, fila, "d:" + archivo, bytes, tipo, NOMBRE_ARCHIVO[archivo] || archivo));
  const docs = parse(fila.docs);
  const d = docs[clave] || {};
  d.fotos = { ...(d.fotos || {}), [archivo]: ahora };
  // Se palomea con la foto principal (en la INE, el frente)
  if (archivo === ARCHIVOS[clave][0]) { d.recibido = true; d.fecha = ahora.slice(0, 10); d.origen = "foto"; }
  docs[clave] = d;
  await env.DB.prepare("UPDATE colaboradores SET docs = ?, actualizado = ? WHERE id = ?").bind(JSON.stringify(docs), ahora, fila.id).run();
  const leidos = await leerDocumento(env, archivo, bytes, tipo, parse(fila.admin));
  return json({ ok: true, docs: docsResumen(docs, parse(fila.admin), fila.tipo), leidos });
}

export async function expedienteApi(request, env, url, ctx, avisar, enviarA) {
  const token = url.pathname.split("/")[3] || "";
  if (!RE_TOKEN.test(token)) return json({ ok: false, error: "Enlace no válido." }, 404);
  await asegurarEsquemaPersonal(env);
  const fila = await env.DB.prepare("SELECT * FROM colaboradores WHERE token = ?").bind(token).first();
  if (!fila) return json({ ok: false, error: "Este enlace ya no es válido. Pide uno nuevo a la administración." }, 404);
  if (fila.estatus === "inactivo") return json({ ok: false, error: "Este enlace ya no está activo. Si crees que es un error, comunícate con la administración." }, 403);
  const acceso = await accesoDe(env, fila);
  if (!acceso.abierto) return json({ ok: false, cerrado: true, error: "En este momento no hay una solicitud de documentos abierta. Si necesitas entregar o corregir algo, comunícate con la administración al 962 564 2170." }, 403);

  const resto = url.pathname.split("/").slice(4); // tras /api/expediente/<token>/
  if (resto[0] === "doc" && resto[1]) {
    if (request.method !== "POST") return json({ ok: false, error: "Método no permitido." }, 405);
    const origin = request.headers.get("Origin");
    if (origin && origin !== url.origin) return json({ ok: false, error: "Origen no permitido." }, 403);
    const ip = request.headers.get("CF-Connecting-IP") || "0";
    const llave = "rlf:" + (await sha256Hex(ip)).slice(0, 24) + ":" + new Date().toISOString().slice(0, 13);
    const conteo = Number(await env.FILES.get(llave) || 0);
    if (conteo >= 40) return json({ ok: false, error: "Demasiados archivos en poco tiempo. Espera una hora e intenta de nuevo." }, 429);
    await env.FILES.put(llave, String(conteo + 1), { expirationTtl: 3700 });
    const resp = await subirFoto(request, env, fila, resto[1], ctx);
    if (resp.status === 200) await revisarCompletoExterno(env, fila, fila.id, enviarA, ctx);
    return resp;
  }

  if (resto[0] === "constancia" && request.method === "POST") {
    const origin = request.headers.get("Origin");
    if (origin && origin !== url.origin) return json({ ok: false, error: "Origen no permitido." }, 403);
    if (Number(request.headers.get("Content-Length") || 0) > 2048) return json({ ok: false, error: "Solicitud demasiado grande." }, 413);
    const c = await request.json().catch(() => ({}));
    if (c.version !== VERSION_AVISO_PERSONAL_V1 || c.confirmo !== true)
      return json({ ok: false, error: "Revisa la versión actual y marca la casilla." }, 422);
    const ahora = new Date().toISOString();
    const campanaId = await campanaDeConstanciaV1(env, fila, acceso);
    await env.DB.prepare("INSERT OR IGNORE INTO personal_constancias (colaborador_id, documento, version, aceptado_en, medio, campana_id) VALUES (?, ?, ?, ?, 'expediente-web', ?)")
      .bind(fila.id, DOC_AVISO_PERSONAL, VERSION_AVISO_PERSONAL_V1, ahora, campanaId).run();
    const constancia = await constanciaPersonalV1(env, fila.id);
    return json({ ok: true, constancia });
  }
  if (request.method === "GET") {
    const datos = parse(fila.datos);
    if (!datos.nombre) datos.nombre = fila.nombre;
    if (!datos.telefono && fila.telefono) datos.telefono = fila.telefono;
    const constancia = await constanciaPersonalV1(env, fila.id);
    const solicitud = acceso.campana ? { nombre: acceso.campana.nombre, hasta: acceso.hasta, pide: estadoEnCampana({ ...fila, acuse_v1_en: constancia?.aceptado_en }, acceso.campana).pendientes } : acceso.motivo === "alta" ? { nombre: "", hasta: acceso.hasta, pide: [] } : null;
    return json({ ok: true, tipo: fila.tipo || "colaborador", datos, llenado_en: fila.llenado_en, solicitud,
      constancia_v1: constancia, aviso_version: VERSION_AVISO_PERSONAL_V1,
      docs: docsResumen(parse(fila.docs), parse(fila.admin), fila.tipo), listas: { estado_civil: ESTADO_CIVIL, escolaridad: ESCOLARIDAD } });
  }

  if (request.method !== "POST") return json({ ok: false, error: "Método no permitido." }, 405);
  const origin = request.headers.get("Origin");
  if (origin && origin !== url.origin) return json({ ok: false, error: "Origen no permitido." }, 403);
  if (Number(request.headers.get("Content-Length") || 0) > 32 * 1024) return json({ ok: false, error: "Datos demasiado grandes." }, 413);

  const ip = request.headers.get("CF-Connecting-IP") || "0";
  const llave = "rlx:" + (await sha256Hex(ip)).slice(0, 24) + ":" + new Date().toISOString().slice(0, 13);
  const conteo = Number(await env.FILES.get(llave) || 0);
  if (conteo >= LIMITE_POR_HORA) return json({ ok: false, error: "Demasiados intentos. Espera una hora e intenta de nuevo." }, 429);
  await env.FILES.put(llave, String(conteo + 1), { expirationTtl: 3700 });

  const cuerpo = await request.json().catch(() => null);
  if (!cuerpo || typeof cuerpo !== "object") return json({ ok: false, error: "No pudimos leer tus datos." }, 400);
  const { datos, errores } = leerCampos(cuerpo, CAMPOS_COLABORADOR, fila.tipo === "externo" ? REQUERIDOS.filter(k => k !== "correo" && k !== "telefono") : REQUERIDOS);
  if (cuerpo.acepto !== true && !(await constanciaPersonalV1(env, fila.id))) errores.acepto = "Confirma la recepción del aviso v1 para continuar.";
  if (Object.keys(errores).length) return json({ ok: false, error: "Faltan datos o hay datos por revisar. Están marcados en rojo.", errores }, 422);

  const ahora = new Date().toISOString();
  const campanaId = await campanaDeConstanciaV1(env, fila, acceso);
  const previos = parse(fila.datos);
  const primeraVez = !fila.llenado_en;
  const cambios = CAMPOS_COLABORADOR.map(([k]) => [k, previos[k] || "", datos[k] || ""]).filter(([, a, b]) => a !== b);
  await env.DB.batch([
    env.DB.prepare("UPDATE colaboradores SET datos = ?, nombre = ?, telefono = ?, llenado_en = ?, llenado_aviso = ?, actualizado = ? WHERE id = ?")
      .bind(JSON.stringify(datos), datos.nombre, datos.telefono || fila.telefono, primeraVez ? ahora : fila.llenado_en, ahora, ahora, fila.id),
    env.DB.prepare("INSERT OR IGNORE INTO personal_constancias (colaborador_id, documento, version, aceptado_en, medio, campana_id) VALUES (?, ?, ?, ?, 'expediente-web', ?)")
      .bind(fila.id, DOC_AVISO_PERSONAL, VERSION_AVISO_PERSONAL_V1, ahora, campanaId)
  ]);
  await revisarCompletoExterno(env, fila, fila.id, enviarA, ctx);
  await renombrarSiCambio(env, fila, fila.id, ctx);
  if (avisar && env.AVISO_URL && env.AVISO_TOKEN) {
    const desde = primeraVez ? "" : (fila.llenado_aviso || fila.llenado_en || "");
    const subidos = docsResumen(parse(fila.docs), parse(fila.admin), fila.tipo).lista.filter(x => x.fotos.some(f => f.fecha > desde)).map(x => x.nombre);
    const aviso = avisoAdmin(datos.nombre, primeraVez, cambios, docsResumen(parse(fila.docs), parse(fila.admin), fila.tipo), subidos, fila.tipo);
    const p = avisar(env, aviso).catch(e => console.error("aviso expediente", e && e.message));
    if (ctx && ctx.waitUntil) ctx.waitUntil(p); else await p;
  }
  return json({ ok: true, constancia: await constanciaPersonalV1(env, fila.id) });
}

// ---------------------------------------------------------------------------
// Correo con el enlace personal
// ---------------------------------------------------------------------------
export const SITIO = "https://basculaypension.com";
function escH(s) { return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function correoEnlace(nombre, token, admin, tipoPersona) {
  const enlace = `${SITIO}/expediente/${token}`;
  const primer = String(nombre || "").split(" ")[0];
  const ext = tipoPersona === "externo";
  const docs = Object.values(nombresDocs(admin, tipoPersona));
  const que = ext ? "tu registro para trabajar dentro de El Castaño" : "tu expediente laboral";
  const asunto = ext ? "Tu registro · Báscula y Pensión El Castaño" : "Tu expediente laboral · Báscula y Pensión El Castaño";
  const texto = `Hola ${primer}:\n\nPara ${ext ? "completar" : "actualizar"} ${que}, sube la foto de tus documentos y llena tus datos en tu enlace personal (no lo compartas):\n${enlace}\n${ext ? "" : `El enlace estará abierto ${DIAS_ALTA} días.\n`}\n${ext ? "Documentos que necesitamos" : "También entrega 2 copias de cada documento con Josué"}:\n${docs.map(d => "- " + d).join("\n")}\n\nBáscula y Pensión El Castaño\n962 564 2170`;
  const html = `<div style="background:#000;padding:24px 12px;font-family:-apple-system,BlinkMacSystemFont,'Helvetica Neue',Arial,sans-serif;color:#f5f5f7">
<div style="max-width:520px;margin:0 auto;background:#161617;border-radius:18px;padding:28px 24px">
<img src="${SITIO}/img/logo.png" alt="El Castaño" width="56" style="display:block;margin-bottom:16px">
<p style="margin:0 0 4px;color:#ffcc00;font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase">${ext ? "Registro de externos" : "Expediente laboral"}</p>
<h1 style="margin:0 0 14px;font-size:26px;line-height:1.15;color:#f5f5f7">Hola, ${escH(primer)}.</h1>
<p style="margin:0 0 20px;font-size:16px;line-height:1.5;color:#a1a1a6">Para ${ext ? "completar" : "actualizar"} ${que}, sube la foto de tus documentos y revisa tus datos en tu enlace personal. Toma unos 5 minutos. No lo compartas con nadie.${ext ? "" : ` El enlace estará abierto ${DIAS_ALTA} días.`}</p>
<p style="margin:0 0 24px"><a href="${enlace}" style="display:inline-block;background:#ffcc00;color:#111;padding:14px 24px;border-radius:999px;text-decoration:none;font-weight:700;font-size:16px">${soloAcuse ? "Leer y confirmar aviso v1" : "Subir mis documentos"}</a></p>
<p style="margin:0 0 8px;font-size:15px;color:#f5f5f7"><b>${ext ? "Documentos que necesitamos:" : "Entrega 2 copias de cada documento con Josué:"}</b></p>
<ul style="margin:0 0 20px;padding-left:20px;font-size:15px;line-height:1.6;color:#a1a1a6">${docs.map(d => `<li>${escH(d)}</li>`).join("")}</ul>
<p style="margin:0;font-size:13px;color:#86868b">Si el botón no abre, copia este enlace:<br><span style="color:#a1a1a6;word-break:break-all">${enlace}</span></p>
</div>
<p style="max-width:520px;margin:14px auto 0;font-size:12px;color:#86868b;text-align:center">Báscula y Pensión El Castaño · Carretera Costera km 287, Tapachula, Chiapas · 962 564 2170</p>
</div>`;
  return { asunto, texto, html };
}

// Correos al encargado de turno sobre los externos (todos llevan el enlace del registro)
function marcoCorreo(etiqueta, titulo, cuerpoHtml) {
  return `<div style="background:#000;padding:24px 12px;font-family:-apple-system,BlinkMacSystemFont,'Helvetica Neue',Arial,sans-serif;color:#f5f5f7">
<div style="max-width:520px;margin:0 auto;background:#161617;border-radius:18px;padding:28px 24px">
<img src="${SITIO}/img/logo.png" alt="El Castaño" width="56" style="display:block;margin-bottom:16px">
<p style="margin:0 0 4px;color:#ffcc00;font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase">${escH(etiqueta)}</p>
<h1 style="margin:0 0 14px;font-size:24px;line-height:1.2;color:#f5f5f7">${escH(titulo)}</h1>
${cuerpoHtml}
</div>
<p style="max-width:520px;margin:14px auto 0;font-size:12px;color:#86868b;text-align:center">Báscula y Pensión El Castaño · Panel de personal</p>
</div>`;
}
const boton = (url, t) => `<p style="margin:0 0 18px"><a href="${url}" style="display:inline-block;background:#ffcc00;color:#111;padding:13px 22px;border-radius:999px;text-decoration:none;font-weight:700;font-size:15px">${escH(t)}</a></p>`;
const parrafo = t => `<p style="margin:0 0 16px;font-size:15px;line-height:1.5;color:#a1a1a6">${t}</p>`;

function correoEncargadoAlta(fila) {
  const enlace = `${SITIO}/expediente/${fila.token}`;
  const admin = parse(fila.admin);
  const docs = Object.values(nombresDocs(admin, "externo"));
  const folio = folioDe(fila);
  const asunto = `Registrar externo: ${fila.nombre} · ${folio}`;
  const texto = `Nuevo externo por registrar: ${fila.nombre} (folio ${folio})${admin.actividad ? "\nActividad: " + admin.actividad : ""}\n\nCuando se presente, ábrele su registro y con la persona presente sube la foto de: ${docs.join(", ")}, y llena sus datos:\n${enlace}\n\nNo compartas este enlace con nadie más.`;
  const html = marcoCorreo("Registro de externos", `Registrar a ${fila.nombre}`,
    parrafo(`Folio <b style="color:#f5f5f7">${escH(folio)}</b>${admin.actividad ? ` · ${escH(admin.actividad)}` : ""}.`) +
    parrafo(`Cuando se presente, abre su registro y, con la persona presente, sube la foto de: ${escH(docs.join(", "))}. Luego revisa y envía sus datos.`) +
    boton(enlace, "Abrir registro") + parrafo(`No compartas este enlace. Si el botón no abre: <span style="word-break:break-all">${enlace}</span>`));
  return { asunto, texto, html };
}

const ESTADOS_EXTERNO = {
  completo: ["Registro completo", "ya puede trabajar dentro de El Castaño", "Su registro está completo: datos e identificación verificados."],
  incompleto: ["Registro pendiente", "todavía no completa su registro", "Le falta información para completar su registro."],
  inactivo: ["Baja", "ya NO tiene permitido trabajar dentro de El Castaño", "Se dio de baja."],
  activo: ["Reactivado", "de nuevo puede trabajar dentro de El Castaño", "Se reactivó su registro."]
};
function correoEncargadoEstatus(fila, estado) {
  const enlace = `${SITIO}/expediente/${fila.token}`;
  const [etiqueta, frase, detalle] = ESTADOS_EXTERNO[estado];
  const folio = folioDe(fila);
  const falta = faltantes(fila);
  const pend = [...(falta.datos ? ["llenar sus datos"] : []), ...falta.docs];
  const admin = parse(fila.admin);
  const extra = estado === "inactivo" && fila.motivo_baja ? ` Motivo: ${fila.motivo_baja}.` : "";
  const asunto = `${etiqueta}: ${fila.nombre} · ${folio}`;
  const texto = `${fila.nombre} (folio ${folio}) ${frase}.\n${detalle}${extra}${estado === "incompleto" && pend.length ? "\nFalta: " + pend.join(", ") : ""}\n\nRegistro: ${enlace}`;
  const html = marcoCorreo(`Estatus de externo · ${etiqueta}`, `${fila.nombre} ${frase}.`,
    parrafo(`Folio <b style="color:#f5f5f7">${escH(folio)}</b>${admin.actividad ? ` · ${escH(admin.actividad)}` : ""}. ${escH(detalle + extra)}`) +
    (estado === "incompleto" && pend.length ? parrafo(`Falta: <b style="color:#f5f5f7">${escH(pend.join(", "))}</b>.`) : "") +
    (estado === "inactivo" ? parrafo(`Registro: <span style="word-break:break-all">${enlace}</span>`) : boton(enlace, estado === "incompleto" ? "Completar registro" : "Ver registro")));
  return { asunto, texto, html };
}

async function avisarEncargado(env, fila, estado, enviarA) {
  if (fila.tipo !== "externo" || !enviarA || !env.AVISO_URL || !env.AVISO_TOKEN) return { error: "El envío de correos no está configurado." };
  try { await enviarA(env, { para: ENCARGADO_CORREO, ...(estado === "alta" ? correoEncargadoAlta(fila) : correoEncargadoEstatus(fila, estado)) }); }
  catch (e) { console.error("aviso encargado", e && e.message); return { error: e.desactualizado ? "Falta actualizar el script de correo en Google. El correo no se envió." : "No se pudo enviar el correo al encargado." }; }
  const ahora = new Date().toISOString();
  await env.DB.prepare("UPDATE colaboradores SET estatus_avisado = ? WHERE id = ?").bind(`${estado}|${ahora}`, fila.id).run();
  return { enviado: ahora };
}

function estaCompleto(fila) {
  const d = docsResumen(parse(fila.docs), parse(fila.admin), fila.tipo);
  return !!fila.llenado_en && d.entregados === d.total;
}
// Si un externo acaba de completar su registro, se avisa al encargado (una sola vez por cambio)
async function revisarCompletoExterno(env, antes, id, enviarA, ctx) {
  if (antes.tipo !== "externo" || estaCompleto(antes)) return;
  const despues = await env.DB.prepare("SELECT * FROM colaboradores WHERE id = ?").bind(id).first();
  if (!despues || !estaCompleto(despues) || despues.estatus === "inactivo") return;
  const p = avisarEncargado(env, despues, "completo", enviarA);
  if (ctx && ctx.waitUntil) ctx.waitUntil(p); else await p;
}

// ---------------------------------------------------------------------------
// Copia en Google Drive (vía el mismo Apps Script de los correos)
// Carpeta raíz → COLABORADORES / EXTERNOS → "<folio> <nombre>" → documentos
// Solo se usa cuando la administración activó la conexión desde el panel.
// ---------------------------------------------------------------------------
const NOMBRE_ARCHIVO = { ine: "Identificación (frente)", ine2: "Identificación (reverso)", curp: "CURP", solicitud: "Solicitud de empleo (hoja 1)", solicitud2: "Solicitud de empleo (hoja 2)", acta: "Acta de nacimiento", domicilio: "Comprobante de domicilio", estudios: "Comprobante de estudios", foto: "Fotografía" };
const EXT_DE = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic", "image/heif": "heif", "application/pdf": "pdf" };

function carpetaDrive(fila) { return { id: fila.id, num: String(fila.num || 0).padStart(3, "0"), tipo: fila.tipo === "externo" ? "externo" : "colaborador", carpeta: `${folioDe(fila)} ${fila.nombre}`.replace(/[\\/:*?"<>|]/g, "").slice(0, 120) }; }

async function llamarDrive(env, datos) {
  const r = await fetch(env.AVISO_URL.trim(), { method: "POST", redirect: "follow", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: env.AVISO_TOKEN.trim(), accion: "drive", ...datos }) });
  const t = (await r.text()).slice(0, 200).trim();
  if (t !== "ok-drive") throw new Error("drive: " + t.replace(/\s+/g, " ").slice(0, 120));
}
function aB64(bytes) { let bin = ""; const u = new Uint8Array(bytes); for (let i = 0; i < u.length; i += 0x8000) bin += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(bin); }

// El mismo colaborador, slot y contenido genera el mismo identificador de
// operación, sin exponer información personal en la marca que recibe Drive.
async function idOperacionDrive(fila, slot, bytes) {
  const cuerpo = new Uint8Array(bytes);
  const prefijo = new TextEncoder().encode(fila.id + ":" + slot + ":");
  const mensaje = new Uint8Array(prefijo.length + cuerpo.byteLength);
  mensaje.set(prefijo);
  mensaje.set(cuerpo, prefijo.length);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", mensaje));
  return [...digest].map(n => n.toString(16).padStart(2, "0")).join("");
}

// Sube a Drive un archivo ya guardado en el sitio. slot: "d:<archivo>" (documento) o "a:<docId>" (administrativo)
async function aDrive(env, fila, slot, bytes, tipo, nombreBase) {
  const cfg = await leerConfig(env);
  if (!cfg.drive || !env.AVISO_URL || !env.AVISO_TOKEN) return false;
  await llamarDrive(env, { op: "subir", ...carpetaDrive(fila), slot, nombre: `${nombreBase}.${EXT_DE[tipo] || "bin"}`, tipoArchivo: tipo,
    operacion: await idOperacionDrive(fila, slot, bytes), base64: aB64(bytes) });
  return true;
}
async function borrarDeDrive(env, fila, slot) {
  const cfg = await leerConfig(env);
  if (!cfg.drive || !env.AVISO_URL || !env.AVISO_TOKEN) return;
  await llamarDrive(env, { op: "borrar", ...carpetaDrive(fila), slot });
}
function enSegundoPlano(ctx, promesa) {
  const p = promesa.catch(e => console.error("drive: sincronización pendiente; revisar estado"));
  if (ctx && ctx.waitUntil) ctx.waitUntil(p); return p;
}
// Si cambió el folio (nombre o fecha de ingreso), renombra su carpeta de Drive
async function renombrarSiCambio(env, antes, id, ctx) {
  return; // Las carpetas de Drive las administra la oficina: el sitio no las renombra
  const despues = await env.DB.prepare("SELECT * FROM colaboradores WHERE id = ?").bind(id).first();
  if (!despues || carpetaDrive(despues).carpeta === carpetaDrive(antes).carpeta) return;
  const cfg = await leerConfig(env);
  if (!cfg.drive || !env.AVISO_URL || !env.AVISO_TOKEN) return;
  await enSegundoPlano(ctx, llamarDrive(env, { op: "carpeta", ...carpetaDrive(despues) }));
}
function nombreAdmin(d) { return `${d.fecha} - ${d.descripcion}`.replace(/[\\/:*?"<>|]/g, "").slice(0, 120); }

// Qué le falta a un colaborador para tener su expediente completo
function faltantes(fila) {
  const f = docsResumen(parse(fila.docs), parse(fila.admin), fila.tipo).lista.filter(d => !d.recibido).map(d => d.nombre);
  return { datos: !fila.llenado_en, docs: f };
}

async function leerConfig(env) {
  try { return JSON.parse(await env.FILES.get("cfg:personal") || "{}") || {}; } catch { return {}; }
}

function fechaLarga(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || "")) return "";
  return new Intl.DateTimeFormat("es-MX", { timeZone: "America/Mexico_City", weekday: "long", day: "numeric", month: "long" }).format(new Date(iso + "T12:00:00-06:00"));
}

function correoRecordatorio(fila, falta, fechaLimite) {
  const enlace = `${SITIO}/expediente/${fila.token}`;
  const primer = String(fila.nombre || "").split(" ")[0];
  const lim = fechaLarga(fechaLimite);
  const pendientes = [...(falta.datos ? ["Llenar tus datos"] : []), ...falta.docs];
  const que = fila.tipo === "externo" ? "tu registro" : "tu expediente laboral";
  const asunto = `Recordatorio: completa ${que}${lim ? " antes del " + lim : ""}`;
  const texto = `Hola ${primer}:\n\nTe recordamos completar ${que}${lim ? " a más tardar el " + lim : ""}. Te falta:\n${pendientes.map(x => "- " + x).join("\n")}\n\nSube tus documentos y revisa tus datos en tu enlace personal (no lo compartas):\n${enlace}\n\nBáscula y Pensión El Castaño\n962 564 2170`;
  const html = `<div style="background:#000;padding:24px 12px;font-family:-apple-system,BlinkMacSystemFont,'Helvetica Neue',Arial,sans-serif;color:#f5f5f7">
<div style="max-width:520px;margin:0 auto;background:#161617;border-radius:18px;padding:28px 24px">
<img src="${SITIO}/img/logo.png" alt="El Castaño" width="56" style="display:block;margin-bottom:16px">
<p style="margin:0 0 4px;color:#ffcc00;font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase">Recordatorio</p>
<h1 style="margin:0 0 14px;font-size:26px;line-height:1.15;color:#f5f5f7">Hola, ${escH(primer)}.</h1>
<p style="margin:0 0 14px;font-size:16px;line-height:1.5;color:#a1a1a6">Te recordamos completar ${que}${lim ? ` a más tardar el <b style="color:#f5f5f7">${escH(lim)}</b>` : ""}. Te falta:</p>
<ul style="margin:0 0 22px;padding-left:20px;font-size:15px;line-height:1.6;color:#f5f5f7">${pendientes.map(x => `<li>${escH(x)}</li>`).join("")}</ul>
<p style="margin:0 0 24px"><a href="${enlace}" style="display:inline-block;background:#ffcc00;color:#111;padding:14px 24px;border-radius:999px;text-decoration:none;font-weight:700;font-size:16px">${fila.tipo === "externo" ? "Completar mi registro" : "Completar mi expediente"}</a></p>
<p style="margin:0;font-size:13px;color:#86868b">Si el botón no abre, copia este enlace:<br><span style="color:#a1a1a6;word-break:break-all">${enlace}</span></p>
</div>
<p style="max-width:520px;margin:14px auto 0;font-size:12px;color:#86868b;text-align:center">Báscula y Pensión El Castaño · Carretera Costera km 287, Tapachula, Chiapas · 962 564 2170</p>
</div>`;
  return { asunto, texto, html };
}

async function recordarUno(env, fila, enviar, cfg) {
  const falta = faltantes(fila);
  if (!falta.datos && !falta.docs.length) return { omitido: "completo" };
  if (fila.tipo === "externo") {
    const r = await avisarEncargado(env, fila, "incompleto", enviar);
    if (r.enviado) await env.DB.prepare("UPDATE colaboradores SET recordado = ? WHERE id = ?").bind(r.enviado, fila.id).run();
    return { ...r, falta };
  }
  const correo = parse(fila.datos).correo;
  if (!correo) return { omitido: "sin correo", falta };
  if (!env.AVISO_URL || !env.AVISO_TOKEN) return { error: "El envío de correos no está configurado.", falta };
  try { await enviar(env, { para: correo, ...correoRecordatorio(fila, falta, cfg.fecha_limite) }); }
  catch (e) { console.error("recordatorio", e && e.message); return { error: e.desactualizado ? "Falta actualizar el script de correo en Google. El correo no se envió." : "No se pudo enviar el correo.", falta }; }
  const ahora = new Date().toISOString();
  await env.DB.prepare("UPDATE colaboradores SET recordado = ? WHERE id = ?").bind(ahora, fila.id).run();
  return { enviado: ahora, falta };
}

// Se ejecuta a diario: cierra las campañas vencidas y, dos días antes de su fecha límite, recuerda por correo a quien le falta algo
export async function recordatoriosAutomaticos(env, enviar) {
  await asegurarEsquemaPersonal(env);
  const hoy = hoyLocal();
  await env.DB.prepare("UPDATE campanas SET estado = 'cerrada', cerrada = ? WHERE estado = 'activa' AND limite < ?").bind(new Date().toISOString(), hoy).run();
  const { results } = await env.DB.prepare("SELECT * FROM campanas WHERE estado = 'activa' AND recordada IS NULL AND limite = ?").bind(sumarDias(hoy, 2)).all();
  for (const c of results.map(leerCampana)) {
    await env.DB.prepare("UPDATE campanas SET recordada = ? WHERE id = ?").bind(new Date().toISOString(), c.id).run();
    const filas = (await personasDe(env, c.id)).filter(f => f.estatus !== "inactivo");
    const r = await enviarCampana(env, c, filas, enviar, true);
    console.log("recordatorios de campaña", c.nombre, r.enviados);
  }
}

async function enviarEnlacePorCorreo(env, fila, enviar) {
  if (fila.tipo === "externo") {
    const r = await avisarEncargado(env, fila, "alta", enviar);
    if (r.enviado) await env.DB.prepare("UPDATE colaboradores SET correo_enviado = ? WHERE id = ?").bind(r.enviado, fila.id).run();
    return r;
  }
  const datos = parse(fila.datos);
  const para = datos.correo;
  if (!para) return { error: "Este colaborador no tiene correo registrado." };
  if (!env.AVISO_URL || !env.AVISO_TOKEN) return { error: "El envío de correos no está configurado." };
  try {
    await enviar(env, { para, ...correoEnlace(fila.nombre, fila.token, parse(fila.admin), fila.tipo) });
  } catch (e) {
    console.error("correo colaborador", e && e.message);
    return { error: e.desactualizado ? "Falta actualizar el script de correo en Google (ver instrucciones). El correo no se envió." : "No se pudo enviar el correo. Intenta de nuevo." };
  }
  const ahora = new Date().toISOString();
  await env.DB.prepare("UPDATE colaboradores SET correo_enviado = ? WHERE id = ?").bind(ahora, fila.id).run();
  return { enviado: ahora };
}

// ---------------------------------------------------------------------------
// Campañas de documentos: el enlace personal de un colaborador solo funciona
// - los primeros DIAS_ALTA días después de darlo de alta, o
// - mientras esté en una campaña activa (hasta su fecha límite, inclusive).
// Los externos no usan campañas: su registro sigue abierto mientras estén activos.
// ---------------------------------------------------------------------------
const DIAS_ALTA = 14;
const hoyLocal = () => new Date(Date.now() - 6 * 3600e3).toISOString().slice(0, 10);
const sumarDias = (dia, n) => new Date(new Date(dia + "T12:00:00Z").getTime() + n * 86400e3).toISOString().slice(0, 10);
const diaLocal = iso => new Date(new Date(iso).getTime() - 6 * 3600e3).toISOString().slice(0, 10);
const nuevoIdCampana = () => "c" + [...crypto.getRandomValues(new Uint8Array(8))].map(b => b.toString(16).padStart(2, "0")).join("");
const leerCampana = c => ({ ...c, docs: (() => { try { return JSON.parse(c.docs || "[]"); } catch { return []; } })() });

async function accesoDe(env, fila) {
  if (fila.estatus === "inactivo") return { abierto: false };
  if (fila.tipo === "externo") return { abierto: true, motivo: "externo" };
  const hoy = hoyLocal();
  const c = await env.DB.prepare("SELECT c.* FROM campanas c JOIN campana_personas p ON p.campana_id = c.id WHERE p.colaborador_id = ? AND c.estado = 'activa' AND c.limite >= ? ORDER BY c.limite DESC LIMIT 1").bind(fila.id, hoy).first();
  const altaHasta = sumarDias(diaLocal(fila.creado), DIAS_ALTA);
  if (c) return { abierto: true, motivo: "campana", hasta: c.limite > altaHasta || altaHasta < hoy ? c.limite : altaHasta, campana: leerCampana(c) };
  if (altaHasta >= hoy) return { abierto: true, motivo: "alta", hasta: altaHasta };
  return { abierto: false };
}

// Sólo atribuir la constancia a una campaña que realmente solicite esta versión.
// Otra campaña de documentos puede estar activa simultáneamente.
async function campanaDeConstanciaV1(env, fila, acceso) {
  if (acceso.campana?.docs?.includes("acuse_v1")) return acceso.campana.id;
  const { results } = await env.DB.prepare(`SELECT c.id, c.docs FROM campanas c
    JOIN campana_personas p ON p.campana_id = c.id
    WHERE p.colaborador_id = ? AND c.estado = 'activa' AND c.limite >= ?
    ORDER BY c.creado DESC LIMIT 30`).bind(fila.id, hoyLocal()).all();
  return results.find(c => leerCampana(c).docs.includes("acuse_v1"))?.id || null;
}

// La recepción es una evidencia independiente; un formulario antiguo no equivale a v1.
async function constanciaPersonalV1(env, id) {
  return await env.DB.prepare("SELECT version, aceptado_en, medio, campana_id FROM personal_constancias WHERE colaborador_id = ? AND documento = ? AND version = ?")
    .bind(id, DOC_AVISO_PERSONAL, VERSION_AVISO_PERSONAL_V1).first();
}

// Qué le falta a una persona dentro de una campaña.
// Sin documentos elegidos: todo lo que le falte del expediente. Con documentos elegidos: cuenta lo entregado desde que empezó la campaña.
function estadoEnCampana(fila, camp) {
  if (!camp.docs.length) {
    const f = faltantes(fila);
    const pendientes = [...(f.datos ? ["Llenar sus datos"] : []), ...f.docs];
    return { completo: !pendientes.length, pendientes };
  }
  const nombres = nombresDocs(parse(fila.admin), fila.tipo);
  const docs = parse(fila.docs);
  const desdeDia = diaLocal(camp.creado);
  const pendientes = [];
  for (const k of camp.docs) {
    if (k === "acuse_v1") { if (!fila.acuse_v1_en) pendientes.push("Confirmar recepción del aviso de privacidad v1"); continue; }
    if (k === "datos") { if (!((fila.llenado_aviso || fila.llenado_en || "") >= camp.creado)) pendientes.push("Revisar y actualizar sus datos"); continue; }
    if (!nombres[k]) continue;
    const d = docs[k] || {};
    const hecho = Object.values(d.fotos || {}).some(f => f >= camp.creado) || (d.recibido && d.origen === "panel" && (d.fecha || "") >= desdeDia);
    if (!hecho) pendientes.push(nombres[k]);
  }
  return { completo: !pendientes.length, pendientes };
}

async function crearCampanaFilas(env, camp, ids, ahora) {
  const id = nuevoIdCampana();
  await env.DB.prepare("INSERT INTO campanas (id, nombre, creado, limite, docs) VALUES (?, ?, ?, ?, ?)").bind(id, camp.nombre, ahora, camp.limite, JSON.stringify(camp.docs)).run();
  if (ids.length) await env.DB.batch(ids.map(c => env.DB.prepare("INSERT OR IGNORE INTO campana_personas (campana_id, colaborador_id) VALUES (?, ?)").bind(id, c)));
  return id;
}

function correoCampana(fila, camp, pendientes, recordatorio) {
  const enlace = `${SITIO}/expediente/${fila.token}`;
  const primer = String(fila.nombre || "").split(" ")[0];
  const lim = fechaLarga(camp.limite);
  const soloAcuse = camp.docs.length === 1 && camp.docs[0] === "acuse_v1";
  const asunto = recordatorio ? `Recordatorio: ${camp.nombre} · antes del ${lim}` : `${camp.nombre} · Báscula y Pensión El Castaño`;
  const intro = recordatorio ? `Te recordamos que tu enlace para «${camp.nombre}» se cierra el ${lim}. Te falta:` : `Abrimos «${camp.nombre}». Tienes hasta el ${lim} para ${soloAcuse ? "confirmar" : "entregar"}:`;
  const texto = `Hola ${primer}:\n\n${intro}\n${pendientes.map(x => "- " + x).join("\n")}\n\n${soloAcuse ? "Lee el aviso y confirma su recepción desde tu enlace personal" : "Sube tus documentos y revisa tus datos en tu enlace personal"} (no lo compartas):\n${enlace}\n\nDespués de esa fecha el enlace se cierra.${soloAcuse ? " La confirmación digital no reemplaza la firma de documentos impresos." : " Entrega también las copias físicas con Josué."}\n\nBáscula y Pensión El Castaño\n962 564 2170`;
  const html = `<div style="background:#000;padding:24px 12px;font-family:-apple-system,BlinkMacSystemFont,'Helvetica Neue',Arial,sans-serif;color:#f5f5f7">
<div style="max-width:520px;margin:0 auto;background:#161617;border-radius:18px;padding:28px 24px">
<img src="${SITIO}/img/logo.png" alt="El Castaño" width="56" style="display:block;margin-bottom:16px">
<p style="margin:0 0 4px;color:#ffcc00;font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase">${recordatorio ? "Recordatorio" : soloAcuse ? "Aviso de privacidad" : "Solicitud de documentos"}</p>
<h1 style="margin:0 0 14px;font-size:26px;line-height:1.15;color:#f5f5f7">Hola, ${escH(primer)}.</h1>
<p style="margin:0 0 14px;font-size:16px;line-height:1.5;color:#a1a1a6">${recordatorio ? `Te recordamos que tu enlace para <b style="color:#f5f5f7">${escH(camp.nombre)}</b> se cierra el <b style="color:#f5f5f7">${escH(lim)}</b>. Te falta:` : `Abrimos <b style="color:#f5f5f7">${escH(camp.nombre)}</b>. Tienes hasta el <b style="color:#f5f5f7">${escH(lim)}</b> para ${soloAcuse ? "confirmar" : "entregar"}:`}</p>
<ul style="margin:0 0 22px;padding-left:20px;font-size:15px;line-height:1.6;color:#f5f5f7">${pendientes.map(x => `<li>${escH(x)}</li>`).join("")}</ul>
<p style="margin:0 0 24px"><a href="${enlace}" style="display:inline-block;background:#ffcc00;color:#111;padding:14px 24px;border-radius:999px;text-decoration:none;font-weight:700;font-size:16px">${soloAcuse ? "Leer y confirmar aviso v1" : "Subir mis documentos"}</a></p>
<p style="margin:0 0 10px;font-size:13px;color:#86868b">Después de esa fecha el enlace se cierra. ${soloAcuse ? "La recepción digital no sustituye documentos firmados en papel." : "Entrega también las copias físicas con Josué."} No compartas este enlace.</p>
<p style="margin:0;font-size:13px;color:#86868b">Si el botón no abre, copia este enlace:<br><span style="color:#a1a1a6;word-break:break-all">${enlace}</span></p>
</div>
<p style="max-width:520px;margin:14px auto 0;font-size:12px;color:#86868b;text-align:center">Báscula y Pensión El Castaño · Carretera Costera km 287, Tapachula, Chiapas · 962 564 2170</p>
</div>`;
  return { asunto, texto, html };
}

// Manda el correo de la campaña a quien tenga correo y aún tenga pendientes
async function enviarCampana(env, camp, filas, enviar, recordatorio) {
  const res = { enviados: 0, sin_correo: [], completos: 0, errores: 0, error: "" };
  // Consulta una sola vez la evidencia v1, también para recordatorios de campaña.
  const acuses = camp.docs.includes("acuse_v1") ? new Set((await env.DB.prepare("SELECT colaborador_id FROM personal_constancias WHERE documento = ? AND version = ?").bind(DOC_AVISO_PERSONAL, VERSION_AVISO_PERSONAL_V1).all()).results.map(x => x.colaborador_id)) : new Set();
  for (const f of filas) {
    const { completo, pendientes } = estadoEnCampana({ ...f, acuse_v1_en: f.acuse_v1_en || (acuses.has(f.id) ? "registrado" : null) }, camp);
    if (completo) { res.completos++; continue; }
    const para = parse(f.datos).correo;
    if (!para) { res.sin_correo.push(f.nombre); continue; }
    if (!env.AVISO_URL || !env.AVISO_TOKEN) { res.errores++; res.error = "El envío de correos no está configurado."; continue; }
    try {
      await enviar(env, { para, ...correoCampana(f, camp, pendientes, recordatorio) });
      const ahora = new Date().toISOString();
      res.enviados++;
      await env.DB.prepare("UPDATE campana_personas SET enviado = ? WHERE campana_id = ? AND colaborador_id = ?").bind(ahora, camp.id, f.id).run();
      if (recordatorio) await env.DB.prepare("UPDATE colaboradores SET recordado = ? WHERE id = ?").bind(ahora, f.id).run();
    } catch (e) {
      console.error("correo campaña", e && e.message);
      res.errores++; res.error = e.desactualizado ? "Falta actualizar el script de correo en Google." : "No se pudieron enviar algunos correos.";
    }
  }
  return res;
}

async function personasDe(env, campId) {
  const { results } = await env.DB.prepare(`SELECT c.*, p.enviado AS camp_enviado, a.aceptado_en AS acuse_v1_en
    FROM campana_personas p JOIN colaboradores c ON c.id = p.colaborador_id
    LEFT JOIN personal_constancias a ON a.colaborador_id = c.id AND a.documento = ? AND a.version = ?
    WHERE p.campana_id = ? ORDER BY c.nombre COLLATE NOCASE`).bind(DOC_AVISO_PERSONAL, VERSION_AVISO_PERSONAL_V1, campId).all();
  return results;
}

function vistaCampana(c, filas) {
  const hoy = hoyLocal();
  const abierta = c.estado === "activa" && c.limite >= hoy;
  const personas = filas.map(f => {
    const e = estadoEnCampana(f, c);
    return { id: f.id, nombre: f.nombre, folio: folioDe(f), telefono: f.telefono || "", correo: parse(f.datos).correo || "", token: f.token, enviado: f.camp_enviado || "", acuse_v1_en: f.acuse_v1_en || null, estatus: f.estatus === "inactivo" ? "inactivo" : "activo", completo: e.completo, pendientes: e.pendientes };
  });
  return {
    id: c.id, nombre: c.nombre, creado: c.creado, limite: c.limite, docs: c.docs, recordada: c.recordada || "", cerrada: c.cerrada || "",
    abierta, estado: abierta ? "activa" : "cerrada",
    total: personas.length, completos: personas.filter(p => p.completo).length, personas
  };
}

// Panel: /panel/api/colaboradores/campanas[/<id>[/accion]]
async function campanasPanel(request, env, partes, enviar) {
  const hoy = hoyLocal();
  if (partes.length === 2 && request.method === "GET") {
    const { results } = await env.DB.prepare("SELECT * FROM campanas ORDER BY creado DESC LIMIT 60").all();
    const lista = [];
    for (const c of results.map(leerCampana)) { const v = vistaCampana(c, await personasDe(env, c.id)); delete v.personas; lista.push(v); }
    return json({ ok: true, campanas: lista, hoy, documentos: DOCUMENTOS });
  }
  if (partes.length === 2 && request.method === "POST") {
    const b = await request.json().catch(() => ({}));
    const nombre = limpiar(b.nombre, 80);
    const limite = String(b.limite || "");
    const errores = {};
    if (!nombre) errores.nombre = "Ponle un nombre a la campaña.";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(limite) || limite < hoy) errores.limite = "Elige una fecha de hoy en adelante.";
    else if (limite > sumarDias(hoy, 90)) errores.limite = "Máximo 90 días.";
    const docs = Array.isArray(b.docs) ? [...new Set(b.docs.filter(k => k === "datos" || k === "acuse_v1" || DOCUMENTOS[k]))] : [];
    const { results } = await env.DB.prepare("SELECT * FROM colaboradores WHERE estatus != 'inactivo' AND COALESCE(tipo, 'colaborador') = 'colaborador'").all();
    let filas = results;
    if (b.destino === "incompletos") filas = results.filter(f => !estaCompleto(f));
    else if (b.destino === "elegidos") { const ids = new Set(Array.isArray(b.ids) ? b.ids : []); filas = results.filter(f => ids.has(f.id)); }
    if (!filas.length) errores.destino = b.destino === "elegidos" ? "Elige al menos a una persona." : "No hay colaboradores activos para esta campaña.";
    if (Object.keys(errores).length) return json({ ok: false, error: "Revisa los datos de la campaña.", errores }, 422);
    const id = await crearCampanaFilas(env, { nombre, limite, docs }, filas.map(f => f.id), new Date().toISOString());
    const camp = leerCampana(await env.DB.prepare("SELECT * FROM campanas WHERE id = ?").bind(id).first());
    const envio = b.enviar === false ? null : await enviarCampana(env, camp, filas, enviar, false);
    return json({ ok: true, id, envio, campana: vistaCampana(camp, await personasDe(env, id)) });
  }
  const id = partes[2];
  if (!/^c[0-9a-f]{16}$/.test(id || "")) return json({ ok: false, error: "Campaña no encontrada." }, 404);
  const fila = await env.DB.prepare("SELECT * FROM campanas WHERE id = ?").bind(id).first();
  if (!fila) return json({ ok: false, error: "Campaña no encontrada." }, 404);
  const camp = leerCampana(fila);
  if (partes.length === 3 && request.method === "GET") return json({ ok: true, campana: vistaCampana(camp, await personasDe(env, id)), hoy });
  if (request.method !== "POST" || partes.length !== 4) return json({ ok: false, error: "Ruta no encontrada." }, 404);
  const b = await request.json().catch(() => ({}));
  const abierta = camp.estado === "activa" && camp.limite >= hoy;
  if (partes[3] === "recordar") {
    if (!abierta) return json({ ok: false, error: "La campaña ya está cerrada." }, 409);
    const filas = (await personasDe(env, id)).filter(f => f.estatus !== "inactivo");
    const r = await enviarCampana(env, camp, filas, enviar, true);
    return json({ ok: true, ...r });
  }
  if (partes[3] === "cerrar") {
    await env.DB.prepare("UPDATE campanas SET estado = 'cerrada', cerrada = ? WHERE id = ?").bind(new Date().toISOString(), id).run();
    return json({ ok: true });
  }
  if (partes[3] === "limite") {
    const limite = String(b.limite || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(limite) || limite < hoy || limite > sumarDias(hoy, 90)) return json({ ok: false, error: "Elige una fecha entre hoy y 90 días." }, 422);
    await env.DB.prepare("UPDATE campanas SET limite = ?, estado = 'activa', cerrada = NULL, recordada = NULL WHERE id = ?").bind(limite, id).run();
    return json({ ok: true });
  }
  if (partes[3] === "agregar") {
    const ids = Array.isArray(b.ids) ? b.ids.filter(x => /^[0-9a-f-]{36}$/.test(x)) : [];
    if (!ids.length) return json({ ok: false, error: "Elige a alguien." }, 422);
    await env.DB.batch(ids.map(c => env.DB.prepare("INSERT OR IGNORE INTO campana_personas (campana_id, colaborador_id) VALUES (?, ?)").bind(id, c)));
    let envio = null;
    if (abierta && b.enviar !== false) {
      const marc = ids.map(() => "?").join(",");
      const { results } = await env.DB.prepare(`SELECT * FROM colaboradores WHERE id IN (${marc}) AND estatus != 'inactivo'`).bind(...ids).all();
      envio = await enviarCampana(env, camp, results, enviar, false);
    }
    return json({ ok: true, envio });
  }
  if (partes[3] === "quitar") {
    await env.DB.prepare("DELETE FROM campana_personas WHERE campana_id = ? AND colaborador_id = ?").bind(id, String(b.colaborador || "")).run();
    return json({ ok: true });
  }
  if (partes[3] === "eliminar") {
    await env.DB.batch([env.DB.prepare("DELETE FROM campana_personas WHERE campana_id = ?").bind(id), env.DB.prepare("DELETE FROM campanas WHERE id = ?").bind(id)]);
    return json({ ok: true });
  }
  return json({ ok: false, error: "Ruta no encontrada." }, 404);
}

// ---------------------------------------------------------------------------
// Panel: /panel/api/colaboradores...
// ---------------------------------------------------------------------------
export function resumenFila(f) {
  const docs = docsResumen(parse(f.docs), parse(f.admin), f.tipo);
  const admin = parse(f.admin);
  return {
    id: f.id, folio: folioDe(f), nombre: f.nombre, telefono: f.telefono, puesto: admin.puesto || "", actividad: admin.actividad || "", tipo: f.tipo === "externo" ? "externo" : "colaborador",
    llenado_en: f.llenado_en, creado: f.creado, actualizado: f.actualizado,
    correo: parse(f.datos).correo || "", correo_enviado: f.correo_enviado || "",
    estatus: f.estatus === "inactivo" ? "inactivo" : "activo", fecha_baja: f.fecha_baja || "", motivo_baja: f.motivo_baja || "",
    entregados: docs.entregados, total: docs.total,
    acuse_v1_en: f.acuse_v1_en || null, completo: !!f.llenado_en && docs.entregados === docs.total
  };
}

export async function personalPanel(request, env, url, partes, enviar) {
  await asegurarEsquemaPersonal(env);

  if (partes.length === 1 && request.method === "GET") {
    const filtro = url.searchParams.get("filtro") || "todos";
    const q = (url.searchParams.get("q") || "").trim().toLowerCase().slice(0, 60);
    const { results } = await env.DB.prepare(`SELECT c.*, a.aceptado_en AS acuse_v1_en
      FROM colaboradores c LEFT JOIN personal_constancias a ON a.colaborador_id = c.id AND a.documento = ? AND a.version = ?
      ORDER BY c.nombre COLLATE NOCASE ASC LIMIT 500`).bind(DOC_AVISO_PERSONAL, VERSION_AVISO_PERSONAL_V1).all();
    const estatus = ["activo", "inactivo"].includes(url.searchParams.get("estatus")) ? url.searchParams.get("estatus") : "activo";
    const tipo = url.searchParams.get("tipo") === "externo" ? "externo" : "colaborador";
    const todas = results.map(resumenFila);
    const filas = todas.filter(c => c.tipo === tipo);
    const todos = filas.filter(c => c.estatus === estatus);
    const conteos = {
      colaborador: todas.filter(c => c.tipo === "colaborador" && c.estatus === "activo").length, externo: todas.filter(c => c.tipo === "externo" && c.estatus === "activo").length,
      activo: filas.filter(c => c.estatus === "activo").length, inactivo: filas.filter(c => c.estatus === "inactivo").length,
      todos: todos.length, incompletos: todos.filter(c => !c.completo).length, completos: todos.filter(c => c.completo).length
    };
    let lista = filtro === "incompletos" ? todos.filter(c => !c.completo) : filtro === "completos" ? todos.filter(c => c.completo) : todos;
    if (q) lista = lista.filter(c => [c.nombre, c.telefono, c.puesto, c.actividad, c.folio].join(" ").toLowerCase().includes(q));
    return json({ ok: true, colaboradores: lista, conteos, config: await leerConfig(env) });
  }

  if (partes.length === 1 && request.method === "POST") {
    const cuerpo = await request.json().catch(() => ({}));
    const nombre = limpiar(cuerpo.nombre, 120);
    const telefono = limpiar(cuerpo.telefono, 10, "tel");
    const correo = limpiar(cuerpo.correo, 120, "email");
    const errores = {};
    if (!nombre) errores.nombre = "Escribe el nombre.";
    if (telefono && telefono.length !== 10) errores.telefono = "El WhatsApp debe tener 10 dígitos.";
    if (correo && !RE_EMAIL.test(correo)) errores.correo = "Correo inválido.";
    const tipo = TIPOS.includes(cuerpo.tipo) ? cuerpo.tipo : "colaborador";
    const { datos: admin, errores: eAdmin } = leerCampos(cuerpo, CAMPOS_ADMIN);
    Object.assign(errores, eAdmin);
    if (tipo === "externo") delete admin.puesto; else delete admin.actividad;
    if (Object.keys(errores).length) return json({ ok: false, error: "Revisa los datos.", errores }, 422);
    const id = crypto.randomUUID(), token = nuevoToken(), ahora = new Date().toISOString();
    await env.DB.prepare("INSERT INTO colaboradores (id, token, creado, actualizado, nombre, telefono, datos, admin, docs, tipo, num) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '{}', ?, (SELECT COALESCE(MAX(num), 0) + 1 FROM colaboradores))")
      .bind(id, token, ahora, ahora, nombre, telefono || null, JSON.stringify({ nombre, ...(telefono ? { telefono } : {}), ...(correo ? { correo } : {}) }), JSON.stringify(admin), tipo).run();
    let correoRes = null;
    const filaNueva = await env.DB.prepare("SELECT * FROM colaboradores WHERE id = ?").bind(id).first();
    if (correo || tipo === "externo") correoRes = await enviarEnlacePorCorreo(env, filaNueva, enviar);
    return json({ ok: true, id, token, folio: folioDe(filaNueva), correo: correoRes });
  }

  if (partes[1] === "campanas") return await campanasPanel(request, env, partes, enviar);

  if (partes[1] === "drive-probar" && request.method === "POST") {
    if (!env.AVISO_URL || !env.AVISO_TOKEN) return json({ ok: false, error: "El script de Google no está configurado." }, 503);
    try { await llamarDrive(env, { op: "probar", asunto: "Prueba de conexión con Drive · El Castaño", texto: "Si te llegó este correo, el script de Google todavía es la versión anterior. Actualízalo con el código nuevo (incluye la copia en Drive) y vuelve a tocar «Probar conexión con Drive» en el panel." }); }
    catch (e) { return json({ ok: false, error: /ok/.test(e.message) ? "El script de Google todavía es la versión anterior: actualízalo y vuelve a probar." : "No se pudo conectar con Drive: " + e.message.replace(/^drive: /, "") }, 502); }
    const cfg = { ...(await leerConfig(env)), drive: true };
    await env.FILES.put("cfg:personal", JSON.stringify(cfg));
    return json({ ok: true, config: cfg });
  }

  const id = partes[1];
  if (!id || !/^[0-9a-f-]{36}$/.test(id)) return json({ ok: false, error: "Ruta no encontrada." }, 404);
  const fila = await env.DB.prepare("SELECT * FROM colaboradores WHERE id = ?").bind(id).first();
  if (!fila) return json({ ok: false, error: "No existe ese colaborador." }, 404);

  if (partes.length === 2 && request.method === "GET") {
    return json({
      ok: true,
      colaborador: { ...resumenFila(fila), acuse_v1_en: (await constanciaPersonalV1(env, fila.id))?.aceptado_en || null,
        aviso_version: VERSION_AVISO_PERSONAL_V1, acceso: await accesoDe(env, fila), token: fila.token, datos: parse(fila.datos), admin: parse(fila.admin), docs: docsResumen(parse(fila.docs), parse(fila.admin), fila.tipo).lista, admin_docs: JSON.parse(fila.admin_docs || "[]"), recordado: fila.recordado || "", falta: faltantes(fila) },
      config: await leerConfig(env),
      encargado: { correo: ENCARGADO_CORREO, wa: ENCARGADO_WA, avisado: fila.estatus_avisado || "" },
      listas: { estado_civil: ESTADO_CIVIL, escolaridad: ESCOLARIDAD, puestos: PUESTOS, nacionalidad: NACIONALIDAD, actividades: ACTIVIDADES }
    });
  }

  if (partes[2] === "archivo" && DOC_DE_ARCHIVO[partes[3]] && request.method === "GET") {
    const { value, metadata } = await leerArchivo(env, `x:${id}:${partes[3]}`);
    if (!value) return new Response("Archivo no disponible.", { status: 404, headers: cabecerasPrivadas() });
    const tipo = metadata && TIPOS_FOTO.includes(metadata.tipo) ? metadata.tipo : "application/octet-stream";
    const ext = tipo === "application/pdf" ? "pdf" : (tipo.split("/")[1] || "bin");
    const nombre = String(fila.nombre).normalize("NFD").replace(/[^\w ]/g, "").replace(/\s+/g, "-").slice(0, 40);
    return new Response(value, { headers: cabecerasPrivadas({ "Content-Type": tipo, "Content-Disposition": `inline; filename="${nombre}-${partes[3]}.${ext}"`, "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'self'", "X-Frame-Options": "SAMEORIGIN" }) });
  }

  if (partes[2] === "archivo-admin" && /^[0-9a-f]{16}$/.test(partes[3] || "") && request.method === "GET") {
    const { value, metadata } = await leerArchivo(env, `xa:${id}:${partes[3]}`);
    if (!value) return new Response("Archivo no disponible.", { status: 404, headers: cabecerasPrivadas() });
    const tipo = metadata && TIPOS_FOTO.includes(metadata.tipo) ? metadata.tipo : "application/octet-stream";
    const nombre = String((metadata && metadata.nombre) || "documento").replace(/[^\w.\- ]/g, "").slice(0, 80) || "documento";
    return new Response(value, { headers: cabecerasPrivadas({ "Content-Type": tipo, "Content-Disposition": `inline; filename="${nombre}"`, "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'self'", "X-Frame-Options": "SAMEORIGIN" }) });
  }

  if (partes[2] === "adoc" && request.method === "POST") {
    const tipo = (request.headers.get("Content-Type") || "").split(";")[0].trim().toLowerCase();
    if (!TIPOS_FOTO.includes(tipo)) return json({ ok: false, error: "Sube un PDF o una imagen." }, 415);
    if (Number(request.headers.get("Content-Length") || 0) > MAX_FOTO) return json({ ok: false, error: "El archivo pesa más de 10 MB." }, 413);
    let descripcion = "", nombreArchivo = "";
    try { descripcion = decodeURIComponent(request.headers.get("X-Descripcion") || ""); nombreArchivo = decodeURIComponent(request.headers.get("X-Nombre") || ""); } catch {}
    descripcion = descripcion.replace(/\s+/g, " ").trim().slice(0, 200);
    if (!descripcion) return json({ ok: false, error: "Escribe la descripción del documento." }, 422);
    const fecha = /^\d{4}-\d{2}-\d{2}$/.test(request.headers.get("X-Fecha") || "") ? request.headers.get("X-Fecha") : new Date(Date.now() - 6 * 3600e3).toISOString().slice(0, 10);
    const bytes = await request.arrayBuffer();
    if (!bytes.byteLength || bytes.byteLength > MAX_FOTO) return json({ ok: false, error: "Archivo vacío o de más de 10 MB." }, 413);
    const docId = [...crypto.getRandomValues(new Uint8Array(8))].map(b => b.toString(16).padStart(2, "0")).join("");
    const lista = JSON.parse(fila.admin_docs || "[]");
    if (lista.length >= 60) return json({ ok: false, error: "Este colaborador ya tiene 60 documentos administrativos." }, 409);
    await guardarArchivo(env, `xa:${id}:${docId}`, bytes, { tipo, nombre: nombreArchivo.slice(0, 120), soloKV: true });
    lista.push({ id: docId, descripcion, fecha, tipo, nombre: nombreArchivo.slice(0, 120), tamano: bytes.byteLength, subido: new Date().toISOString() });
    let drive = null;
    try { drive = await aDrive(env, fila, "a:" + docId, bytes, tipo, nombreAdmin({ fecha, descripcion })); } catch (e) { console.error("drive: sincronización pendiente; revisar estado"); drive = "error"; }
    await env.DB.prepare("UPDATE colaboradores SET admin_docs = ?, actualizado = ? WHERE id = ?").bind(JSON.stringify(lista), new Date().toISOString(), id).run();
    return json({ ok: true, admin_docs: lista, drive });
  }

  if (request.method !== "POST" || partes.length !== 3) return json({ ok: false, error: "Ruta no encontrada." }, 404);
  const cuerpo = await request.json().catch(() => ({}));

  if (partes[2] === "adoc-eliminar") {
    const lista = JSON.parse(fila.admin_docs || "[]");
    const nueva = lista.filter(d => d.id !== cuerpo.doc);
    if (nueva.length === lista.length) return json({ ok: false, error: "No existe ese documento." }, 404);
    await borrarArchivo(env, `xa:${id}:${cuerpo.doc}`);
    try { await borrarDeDrive(env, fila, "a:" + cuerpo.doc); } catch (e) { console.error("drive: sincronización pendiente; revisar estado"); }
    await env.DB.prepare("UPDATE colaboradores SET admin_docs = ? WHERE id = ?").bind(JSON.stringify(nueva), id).run();
    return json({ ok: true, admin_docs: nueva });
  }

  if (partes[2] === "recordar") {
    if (fila.estatus === "inactivo") return json({ ok: false, error: "El colaborador está inactivo." }, 409);
    const acc = await accesoDe(env, fila);
    if (!acc.abierto) return json({ ok: false, error: "Su enlace está cerrado. Inclúyelo en una campaña para pedirle documentos." }, 409);
    if (acc.campana) {
      const e = estadoEnCampana(fila, acc.campana);
      if (e.completo) return json({ ok: false, error: "Ya entregó lo que pide la campaña." }, 409);
      const r = await enviarCampana(env, acc.campana, [fila], enviar, true);
      return json({ ok: true, enviado: r.enviados ? new Date().toISOString() : null, error_correo: r.error || (r.sin_correo.length ? "No tiene correo registrado." : null), falta: { datos: false, docs: e.pendientes } });
    }
    const r = await recordarUno(env, fila, enviar, { fecha_limite: acc.hasta });
    if (r.omitido === "completo") return json({ ok: false, error: "Su expediente ya está completo." }, 409);
    return json({ ok: true, enviado: r.enviado || null, error_correo: r.error || (r.omitido === "sin correo" ? "No tiene correo registrado." : null), falta: r.falta });
  }
  const ahora = new Date().toISOString();

  if (partes[2] === "doc") {
    if (!nombresDocs(null, fila.tipo)[cuerpo.clave]) return json({ ok: false, error: "Documento desconocido." }, 422);
    const docs = parse(fila.docs);
    const previo = docs[cuerpo.clave] || {};
    if (cuerpo.recibido) docs[cuerpo.clave] = { ...previo, recibido: true, fecha: /^\d{4}-\d{2}-\d{2}$/.test(cuerpo.fecha || "") ? cuerpo.fecha : ahora.slice(0, 10), origen: "panel" };
    else if (previo.fotos) docs[cuerpo.clave] = { fotos: previo.fotos };
    else delete docs[cuerpo.clave];
    await env.DB.prepare("UPDATE colaboradores SET docs = ?, actualizado = ? WHERE id = ?").bind(JSON.stringify(docs), ahora, id).run();
    await revisarCompletoExterno(env, fila, id, enviar);
    return json({ ok: true, docs: docsResumen(docs, parse(fila.admin), fila.tipo) });
  }

  if (partes[2] === "admin") {
    const { datos: admin, errores } = leerCampos(cuerpo, CAMPOS_ADMIN);
    if (fila.tipo === "externo") delete admin.puesto; else delete admin.actividad;
    if (Object.keys(errores).length) return json({ ok: false, error: "Revisa los datos.", errores }, 422);
    await env.DB.prepare("UPDATE colaboradores SET admin = ?, actualizado = ? WHERE id = ?").bind(JSON.stringify(admin), ahora, id).run();
    await renombrarSiCambio(env, fila, id);
    return json({ ok: true });
  }

  if (partes[2] === "datos") {
    const { datos, errores } = leerCampos(cuerpo, CAMPOS_COLABORADOR, ["nombre"]);
    if (Object.keys(errores).length) return json({ ok: false, error: "Revisa los datos.", errores }, 422);
    await env.DB.prepare("UPDATE colaboradores SET datos = ?, nombre = ?, telefono = ?, actualizado = ? WHERE id = ?")
      .bind(JSON.stringify(datos), datos.nombre, datos.telefono || null, ahora, id).run();
    await renombrarSiCambio(env, fila, id);
    return json({ ok: true });
  }

  if (partes[2] === "estatus") {
    const estatus = cuerpo.estatus === "inactivo" ? "inactivo" : "activo";
    let fechaBaja = null, motivo = null;
    if (estatus === "inactivo") {
      fechaBaja = /^\d{4}-\d{2}-\d{2}$/.test(cuerpo.fecha_baja || "") ? cuerpo.fecha_baja : hoyLocal();
      motivo = limpiar(cuerpo.motivo_baja, 300) || null;
    }
    await env.DB.prepare("UPDATE colaboradores SET estatus = ?, fecha_baja = ?, motivo_baja = ?, actualizado = ? WHERE id = ?").bind(estatus, fechaBaja, motivo, ahora, id).run();
    let aviso = null;
    if (fila.tipo === "externo" && fila.estatus !== estatus) {
      const nueva = await env.DB.prepare("SELECT * FROM colaboradores WHERE id = ?").bind(id).first();
      aviso = await avisarEncargado(env, nueva, estatus, enviar);
    }
    return json({ ok: true, aviso });
  }

  if (partes[2] === "avisar-encargado") {
    if (fila.tipo !== "externo") return json({ ok: false, error: "Solo para externos." }, 409);
    const estado = fila.estatus === "inactivo" ? "inactivo" : estaCompleto(fila) ? "completo" : "incompleto";
    const r = await avisarEncargado(env, fila, estado, enviar);
    if (r.error) return json({ ok: false, error: r.error }, 422);
    return json({ ok: true, enviado: r.enviado, estado });
  }

  if (partes[2] === "enviar-correo") {
    if (fila.estatus === "inactivo") return json({ ok: false, error: "El colaborador está inactivo." }, 409);
    if (!(await accesoDe(env, fila)).abierto) return json({ ok: false, error: "Su enlace está cerrado. Inclúyelo en una campaña para pedirle documentos." }, 409);
    const r = await enviarEnlacePorCorreo(env, fila, enviar);
    if (r.error) return json({ ok: false, error: r.error }, 422);
    return json({ ok: true, enviado: r.enviado });
  }

  if (partes[2] === "nuevo-enlace") {
    const token = nuevoToken();
    await env.DB.prepare("UPDATE colaboradores SET token = ?, actualizado = ? WHERE id = ?").bind(token, ahora, id).run();
    return json({ ok: true, token });
  }

  if (partes[2] === "drive-sync") {
    const cfg = await leerConfig(env);
    if (!cfg.drive) return json({ ok: false, error: "Primero activa la conexión con Drive (botón «Probar conexión con Drive»)." }, 409);
    let n = 0, fallas = 0;
    const docs = parse(fila.docs);
    for (const [clave, d] of Object.entries(docs)) for (const a of Object.keys((d && d.fotos) || {})) {
      const { value, metadata } = await leerArchivo(env, `x:${id}:${a}`);
      if (!value) continue;
      try { await aDrive(env, fila, "d:" + a, value, (metadata && metadata.tipo) || "application/octet-stream", NOMBRE_ARCHIVO[a] || a); n++; } catch (e) { fallas++; console.error("drive: sincronización pendiente; revisar estado"); }
    }
    for (const d of JSON.parse(fila.admin_docs || "[]")) {
      const { value } = await leerArchivo(env, `xa:${id}:${d.id}`);
      if (!value) continue;
      try { await aDrive(env, fila, "a:" + d.id, value, d.tipo, nombreAdmin(d)); n++; } catch (e) { fallas++; console.error("drive: sincronización pendiente; revisar estado"); }
    }
    if (fallas) return json({ ok: false, error: `Se copiaron ${n} archivos y fallaron ${fallas}. Intenta de nuevo.` }, 502);
    return json({ ok: true, copiados: n });
  }

  if (partes[2] === "eliminar") {
    // Las fichas y sus documentos son históricos: la baja siempre es lógica.
    return json({ ok: false, error: "No se eliminan fichas históricas. Usa «Marcar como inactivo»." }, 409);
  }

  return json({ ok: false, error: "Ruta no encontrada." }, 404);
}
