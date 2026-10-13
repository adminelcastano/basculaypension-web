// ---------------------------------------------------------------------------
// Personal: expediente laboral de colaboradores
// Cada colaborador recibe un enlace personal (/expediente/<token>) para llenar
// sus datos; en el panel se palomean los documentos entregados en físico.
// No se guardan escaneos de documentos: solo si se recibieron y cuándo.
// ---------------------------------------------------------------------------
import EXPEDIENTE_HTML from "./expediente.html";

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
  for (const [nombre, tipo] of [["estatus", "TEXT NOT NULL DEFAULT 'activo'"], ["fecha_baja", "TEXT"], ["motivo_baja", "TEXT"], ["correo_enviado", "TEXT"], ["llenado_aviso", "TEXT"], ["recordado", "TEXT"], ["admin_docs", "TEXT NOT NULL DEFAULT '[]'"], ["tipo", "TEXT NOT NULL DEFAULT 'colaborador'"]]) {
    if (!existentes.has(nombre)) await env.DB.prepare(`ALTER TABLE colaboradores ADD COLUMN ${nombre} ${tipo}`).run();
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
    try { await env.AI.run(MODELO_VISION, { prompt: "agree" }); } catch {}
    await env.FILES.put("ai:licencia", "1");
  }
  let bin = ""; const u = new Uint8Array(bytes);
  for (let i = 0; i < u.length; i += 0x8000) bin += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  let r;
  try {
    r = await Promise.race([
      env.AI.run(MODELO_VISION, {
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
async function subirFoto(request, env, fila, archivo) {
  const clave = DOC_DE_ARCHIVO[archivo];
  if (!clave || !nombresDocs(null, fila.tipo)[clave]) return json({ ok: false, error: "Documento desconocido." }, 404);
  const tipo = (request.headers.get("Content-Type") || "").split(";")[0].trim().toLowerCase();
  if (!TIPOS_FOTO.includes(tipo)) return json({ ok: false, error: "Sube una foto (JPG, PNG o HEIC) o un PDF." }, 415);
  if (Number(request.headers.get("Content-Length") || 0) > MAX_FOTO) return json({ ok: false, error: "El archivo pesa más de 10 MB. Toma la foto de nuevo o envía uno más ligero." }, 413);
  const bytes = await request.arrayBuffer();
  if (!bytes.byteLength) return json({ ok: false, error: "El archivo llegó vacío. Intenta de nuevo." }, 400);
  if (bytes.byteLength > MAX_FOTO) return json({ ok: false, error: "El archivo pesa más de 10 MB." }, 413);
  const ahora = new Date().toISOString();
  await env.FILES.put(`x:${fila.id}:${archivo}`, bytes, { metadata: { tipo, subido: ahora } });
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

export async function expedienteApi(request, env, url, ctx, avisar) {
  const token = url.pathname.split("/")[3] || "";
  if (!RE_TOKEN.test(token)) return json({ ok: false, error: "Enlace no válido." }, 404);
  await asegurarEsquemaPersonal(env);
  const fila = await env.DB.prepare("SELECT * FROM colaboradores WHERE token = ?").bind(token).first();
  if (!fila) return json({ ok: false, error: "Este enlace ya no es válido. Pide uno nuevo a la administración." }, 404);
  if (fila.estatus === "inactivo") return json({ ok: false, error: "Este enlace ya no está activo. Si crees que es un error, comunícate con la administración." }, 403);

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
    return await subirFoto(request, env, fila, resto[1]);
  }

  if (request.method === "GET") {
    const datos = parse(fila.datos);
    if (!datos.nombre) datos.nombre = fila.nombre;
    if (!datos.telefono && fila.telefono) datos.telefono = fila.telefono;
    return json({ ok: true, tipo: fila.tipo || "colaborador", datos, llenado_en: fila.llenado_en, docs: docsResumen(parse(fila.docs), parse(fila.admin), fila.tipo), listas: { estado_civil: ESTADO_CIVIL, escolaridad: ESCOLARIDAD } });
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
  const { datos, errores } = leerCampos(cuerpo, CAMPOS_COLABORADOR, fila.tipo === "externo" ? REQUERIDOS.filter(k => k !== "correo") : REQUERIDOS);
  if (!cuerpo.acepto) errores.acepto = "Marca esta casilla para continuar.";
  if (Object.keys(errores).length) return json({ ok: false, error: "Faltan datos o hay datos por revisar. Están marcados en rojo.", errores }, 422);

  const ahora = new Date().toISOString();
  const previos = parse(fila.datos);
  const primeraVez = !fila.llenado_en;
  const cambios = CAMPOS_COLABORADOR.map(([k]) => [k, previos[k] || "", datos[k] || ""]).filter(([, a, b]) => a !== b);
  await env.DB.prepare("UPDATE colaboradores SET datos = ?, nombre = ?, telefono = ?, llenado_en = ?, llenado_aviso = ?, actualizado = ? WHERE id = ?")
    .bind(JSON.stringify(datos), datos.nombre, datos.telefono || fila.telefono, primeraVez ? ahora : fila.llenado_en, ahora, ahora, fila.id).run();
  if (avisar && env.AVISO_URL && env.AVISO_TOKEN) {
    const desde = primeraVez ? "" : (fila.llenado_aviso || fila.llenado_en || "");
    const subidos = docsResumen(parse(fila.docs), parse(fila.admin), fila.tipo).lista.filter(x => x.fotos.some(f => f.fecha > desde)).map(x => x.nombre);
    const aviso = avisoAdmin(datos.nombre, primeraVez, cambios, docsResumen(parse(fila.docs), parse(fila.admin), fila.tipo), subidos, fila.tipo);
    const p = avisar(env, aviso).catch(e => console.error("aviso expediente", e && e.message));
    if (ctx && ctx.waitUntil) ctx.waitUntil(p); else await p;
  }
  return json({ ok: true });
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
  const texto = `Hola ${primer}:\n\nPara ${ext ? "completar" : "actualizar"} ${que}, sube la foto de tus documentos y llena tus datos en tu enlace personal (no lo compartas):\n${enlace}\n\n${ext ? "Documentos que necesitamos" : "También entrega 2 copias de cada documento con Josué"}:\n${docs.map(d => "- " + d).join("\n")}\n\nBáscula y Pensión El Castaño\n962 564 2170`;
  const html = `<div style="background:#000;padding:24px 12px;font-family:-apple-system,BlinkMacSystemFont,'Helvetica Neue',Arial,sans-serif;color:#f5f5f7">
<div style="max-width:520px;margin:0 auto;background:#161617;border-radius:18px;padding:28px 24px">
<img src="${SITIO}/img/logo.png" alt="El Castaño" width="56" style="display:block;margin-bottom:16px">
<p style="margin:0 0 4px;color:#ffcc00;font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase">${ext ? "Registro de externos" : "Expediente laboral"}</p>
<h1 style="margin:0 0 14px;font-size:26px;line-height:1.15;color:#f5f5f7">Hola, ${escH(primer)}.</h1>
<p style="margin:0 0 20px;font-size:16px;line-height:1.5;color:#a1a1a6">Para ${ext ? "completar" : "actualizar"} ${que}, sube la foto de tus documentos y revisa tus datos en tu enlace personal. Toma unos 5 minutos. No lo compartas con nadie.</p>
<p style="margin:0 0 24px"><a href="${enlace}" style="display:inline-block;background:#ffcc00;color:#111;padding:14px 24px;border-radius:999px;text-decoration:none;font-weight:700;font-size:16px">Subir mis documentos</a></p>
<p style="margin:0 0 8px;font-size:15px;color:#f5f5f7"><b>${ext ? "Documentos que necesitamos:" : "Entrega 2 copias de cada documento con Josué:"}</b></p>
<ul style="margin:0 0 20px;padding-left:20px;font-size:15px;line-height:1.6;color:#a1a1a6">${docs.map(d => `<li>${escH(d)}</li>`).join("")}</ul>
<p style="margin:0;font-size:13px;color:#86868b">Si el botón no abre, copia este enlace:<br><span style="color:#a1a1a6;word-break:break-all">${enlace}</span></p>
</div>
<p style="max-width:520px;margin:14px auto 0;font-size:12px;color:#86868b;text-align:center">Báscula y Pensión El Castaño · Carretera Costera km 287, Tapachula, Chiapas · 962 564 2170</p>
</div>`;
  return { asunto, texto, html };
}

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
  const correo = parse(fila.datos).correo;
  if (!correo) return { omitido: "sin correo", falta };
  if (!env.AVISO_URL || !env.AVISO_TOKEN) return { error: "El envío de correos no está configurado.", falta };
  try { await enviar(env, { para: correo, ...correoRecordatorio(fila, falta, cfg.fecha_limite) }); }
  catch (e) { console.error("recordatorio", e && e.message); return { error: e.desactualizado ? "Falta actualizar el script de correo en Google. El correo no se envió." : "No se pudo enviar el correo.", falta }; }
  const ahora = new Date().toISOString();
  await env.DB.prepare("UPDATE colaboradores SET recordado = ? WHERE id = ?").bind(ahora, fila.id).run();
  return { enviado: ahora, falta };
}

// Se ejecuta a diario: dos días antes de la fecha límite, recuerda por correo a los activos incompletos
export async function recordatoriosAutomaticos(env, enviar) {
  await asegurarEsquemaPersonal(env);
  const cfg = await leerConfig(env);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cfg.fecha_limite || "")) return;
  const hoy = new Date(Date.now() - 6 * 3600e3).toISOString().slice(0, 10);
  const objetivo = new Date(new Date(cfg.fecha_limite + "T12:00:00Z").getTime() - 2 * 86400e3).toISOString().slice(0, 10);
  if (hoy !== objetivo) return;
  if (await env.FILES.get(`rec:${cfg.fecha_limite}`)) return;
  await env.FILES.put(`rec:${cfg.fecha_limite}`, "1", { expirationTtl: 30 * 86400 });
  const { results } = await env.DB.prepare("SELECT * FROM colaboradores WHERE estatus != 'inactivo'").all();
  let n = 0;
  for (const f of results) { const r = await recordarUno(env, f, enviar, cfg); if (r.enviado) n++; }
  console.log("recordatorios automáticos", n);
}

async function enviarEnlacePorCorreo(env, fila, enviar) {
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
// Panel: /panel/api/colaboradores...
// ---------------------------------------------------------------------------
function resumenFila(f) {
  const docs = docsResumen(parse(f.docs), parse(f.admin), f.tipo);
  const admin = parse(f.admin);
  return {
    id: f.id, nombre: f.nombre, telefono: f.telefono, puesto: admin.puesto || "", actividad: admin.actividad || "", tipo: f.tipo === "externo" ? "externo" : "colaborador",
    llenado_en: f.llenado_en, creado: f.creado, actualizado: f.actualizado,
    correo: parse(f.datos).correo || "", correo_enviado: f.correo_enviado || "",
    estatus: f.estatus === "inactivo" ? "inactivo" : "activo", fecha_baja: f.fecha_baja || "", motivo_baja: f.motivo_baja || "",
    entregados: docs.entregados, total: docs.total,
    completo: !!f.llenado_en && docs.entregados === docs.total
  };
}

export async function personalPanel(request, env, url, partes, enviar) {
  await asegurarEsquemaPersonal(env);

  if (partes.length === 1 && request.method === "GET") {
    const filtro = url.searchParams.get("filtro") || "todos";
    const q = (url.searchParams.get("q") || "").trim().toLowerCase().slice(0, 60);
    const { results } = await env.DB.prepare("SELECT * FROM colaboradores ORDER BY nombre COLLATE NOCASE ASC LIMIT 500").all();
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
    if (q) lista = lista.filter(c => [c.nombre, c.telefono, c.puesto, c.actividad].join(" ").toLowerCase().includes(q));
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
    await env.DB.prepare("INSERT INTO colaboradores (id, token, creado, actualizado, nombre, telefono, datos, admin, docs, tipo) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '{}', ?)")
      .bind(id, token, ahora, ahora, nombre, telefono || null, JSON.stringify({ nombre, ...(telefono ? { telefono } : {}), ...(correo ? { correo } : {}) }), JSON.stringify(admin), tipo).run();
    let correoRes = null;
    if (correo) {
      const fila = await env.DB.prepare("SELECT * FROM colaboradores WHERE id = ?").bind(id).first();
      correoRes = await enviarEnlacePorCorreo(env, fila, enviar);
    }
    return json({ ok: true, id, token, correo: correoRes });
  }

  if (partes[1] === "config") {
    if (request.method === "GET") return json({ ok: true, config: await leerConfig(env) });
    const cuerpo = await request.json().catch(() => ({}));
    const fl = String(cuerpo.fecha_limite || "");
    if (fl && !/^\d{4}-\d{2}-\d{2}$/.test(fl)) return json({ ok: false, error: "Fecha inválida." }, 422);
    const cfg = { ...(await leerConfig(env)), fecha_limite: fl || null };
    await env.FILES.put("cfg:personal", JSON.stringify(cfg));
    return json({ ok: true, config: cfg });
  }

  if (partes[1] === "recordar-todos" && request.method === "POST") {
    const cfg = await leerConfig(env);
    const cuerpoR = await request.json().catch(() => ({}));
    const tipoR = cuerpoR.tipo === "externo" ? "externo" : "colaborador";
    const { results } = await env.DB.prepare("SELECT * FROM colaboradores WHERE estatus != 'inactivo' AND COALESCE(tipo, 'colaborador') = ?").bind(tipoR).all();
    const res = { enviados: 0, sin_correo: [], errores: 0, completos: 0 };
    for (const f of results) {
      const r = await recordarUno(env, f, enviar, cfg);
      if (r.enviado) res.enviados++;
      else if (r.omitido === "completo") res.completos++;
      else if (r.omitido === "sin correo") res.sin_correo.push(f.nombre);
      else { res.errores++; res.error = r.error; }
    }
    return json({ ok: true, ...res });
  }

  const id = partes[1];
  if (!id || !/^[0-9a-f-]{36}$/.test(id)) return json({ ok: false, error: "Ruta no encontrada." }, 404);
  const fila = await env.DB.prepare("SELECT * FROM colaboradores WHERE id = ?").bind(id).first();
  if (!fila) return json({ ok: false, error: "No existe ese colaborador." }, 404);

  if (partes.length === 2 && request.method === "GET") {
    return json({
      ok: true,
      colaborador: { ...resumenFila(fila), token: fila.token, datos: parse(fila.datos), admin: parse(fila.admin), docs: docsResumen(parse(fila.docs), parse(fila.admin), fila.tipo).lista, admin_docs: JSON.parse(fila.admin_docs || "[]"), recordado: fila.recordado || "", falta: faltantes(fila) },
      config: await leerConfig(env),
      listas: { estado_civil: ESTADO_CIVIL, escolaridad: ESCOLARIDAD, puestos: PUESTOS, nacionalidad: NACIONALIDAD, actividades: ACTIVIDADES }
    });
  }

  if (partes[2] === "archivo" && DOC_DE_ARCHIVO[partes[3]] && request.method === "GET") {
    const { value, metadata } = await env.FILES.getWithMetadata(`x:${id}:${partes[3]}`, { type: "arrayBuffer" });
    if (!value) return new Response("Archivo no disponible.", { status: 404, headers: cabecerasPrivadas() });
    const tipo = metadata && TIPOS_FOTO.includes(metadata.tipo) ? metadata.tipo : "application/octet-stream";
    const ext = tipo === "application/pdf" ? "pdf" : (tipo.split("/")[1] || "bin");
    const nombre = String(fila.nombre).normalize("NFD").replace(/[^\w ]/g, "").replace(/\s+/g, "-").slice(0, 40);
    return new Response(value, { headers: cabecerasPrivadas({ "Content-Type": tipo, "Content-Disposition": `inline; filename="${nombre}-${partes[3]}.${ext}"`, "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'self'", "X-Frame-Options": "SAMEORIGIN" }) });
  }

  if (partes[2] === "archivo-admin" && /^[0-9a-f]{16}$/.test(partes[3] || "") && request.method === "GET") {
    const { value, metadata } = await env.FILES.getWithMetadata(`xa:${id}:${partes[3]}`, { type: "arrayBuffer" });
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
    await env.FILES.put(`xa:${id}:${docId}`, bytes, { metadata: { tipo, nombre: nombreArchivo.slice(0, 120) } });
    lista.push({ id: docId, descripcion, fecha, tipo, nombre: nombreArchivo.slice(0, 120), tamano: bytes.byteLength, subido: new Date().toISOString() });
    await env.DB.prepare("UPDATE colaboradores SET admin_docs = ?, actualizado = ? WHERE id = ?").bind(JSON.stringify(lista), new Date().toISOString(), id).run();
    return json({ ok: true, admin_docs: lista });
  }

  if (request.method !== "POST" || partes.length !== 3) return json({ ok: false, error: "Ruta no encontrada." }, 404);
  const cuerpo = await request.json().catch(() => ({}));

  if (partes[2] === "adoc-eliminar") {
    const lista = JSON.parse(fila.admin_docs || "[]");
    const nueva = lista.filter(d => d.id !== cuerpo.doc);
    if (nueva.length === lista.length) return json({ ok: false, error: "No existe ese documento." }, 404);
    await env.FILES.delete(`xa:${id}:${cuerpo.doc}`);
    await env.DB.prepare("UPDATE colaboradores SET admin_docs = ? WHERE id = ?").bind(JSON.stringify(nueva), id).run();
    return json({ ok: true, admin_docs: nueva });
  }

  if (partes[2] === "recordar") {
    if (fila.estatus === "inactivo") return json({ ok: false, error: "El colaborador está inactivo." }, 409);
    const r = await recordarUno(env, fila, enviar, await leerConfig(env));
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
    return json({ ok: true, docs: docsResumen(docs, parse(fila.admin), fila.tipo) });
  }

  if (partes[2] === "admin") {
    const { datos: admin, errores } = leerCampos(cuerpo, CAMPOS_ADMIN);
    if (fila.tipo === "externo") delete admin.puesto; else delete admin.actividad;
    if (Object.keys(errores).length) return json({ ok: false, error: "Revisa los datos.", errores }, 422);
    await env.DB.prepare("UPDATE colaboradores SET admin = ?, actualizado = ? WHERE id = ?").bind(JSON.stringify(admin), ahora, id).run();
    return json({ ok: true });
  }

  if (partes[2] === "datos") {
    const { datos, errores } = leerCampos(cuerpo, CAMPOS_COLABORADOR, ["nombre"]);
    if (Object.keys(errores).length) return json({ ok: false, error: "Revisa los datos.", errores }, 422);
    await env.DB.prepare("UPDATE colaboradores SET datos = ?, nombre = ?, telefono = ?, actualizado = ? WHERE id = ?")
      .bind(JSON.stringify(datos), datos.nombre, datos.telefono || null, ahora, id).run();
    return json({ ok: true });
  }

  if (partes[2] === "estatus") {
    const estatus = cuerpo.estatus === "inactivo" ? "inactivo" : "activo";
    let fechaBaja = null, motivo = null;
    if (estatus === "inactivo") {
      fechaBaja = /^\d{4}-\d{2}-\d{2}$/.test(cuerpo.fecha_baja || "") ? cuerpo.fecha_baja : ahora.slice(0, 10);
      motivo = limpiar(cuerpo.motivo_baja, 300) || null;
    }
    await env.DB.prepare("UPDATE colaboradores SET estatus = ?, fecha_baja = ?, motivo_baja = ?, actualizado = ? WHERE id = ?").bind(estatus, fechaBaja, motivo, ahora, id).run();
    return json({ ok: true });
  }

  if (partes[2] === "enviar-correo") {
    if (fila.estatus === "inactivo") return json({ ok: false, error: "El colaborador está inactivo." }, 409);
    const r = await enviarEnlacePorCorreo(env, fila, enviar);
    if (r.error) return json({ ok: false, error: r.error }, 422);
    return json({ ok: true, enviado: r.enviado });
  }

  if (partes[2] === "nuevo-enlace") {
    const token = nuevoToken();
    await env.DB.prepare("UPDATE colaboradores SET token = ?, actualizado = ? WHERE id = ?").bind(token, ahora, id).run();
    return json({ ok: true, token });
  }

  if (partes[2] === "eliminar") {
    for (const a of Object.keys(DOC_DE_ARCHIVO)) await env.FILES.delete(`x:${id}:${a}`);
    for (const d of JSON.parse(fila.admin_docs || "[]")) await env.FILES.delete(`xa:${id}:${d.id}`);
    await env.DB.prepare("DELETE FROM colaboradores WHERE id = ?").bind(id).run();
    return json({ ok: true });
  }

  return json({ ok: false, error: "Ruta no encontrada." }, 404);
}
