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

export const ESCOLARIDAD = ["Primaria", "Secundaria", "Preparatoria o bachillerato", "Carrera técnica", "Licenciatura", "Posgrado", "Sin estudios"];
export const ESTADO_CIVIL = ["Soltero(a)", "Casado(a)", "Unión libre", "Divorciado(a)", "Viudo(a)"];
export const AREAS = ["Báscula", "Pensión", "Administración", "Mantenimiento", "Vigilancia", "Otra"];

// Campos que llena el colaborador desde su enlace: [clave, largo máximo, tipo]
export const CAMPOS_COLABORADOR = [
  ["nombre", 120], ["fecha_nacimiento", 10, "fecha"], ["lugar_nacimiento", 80], ["curp", 18, "curp"],
  ["estado_civil", 30, "lista:estado_civil"], ["telefono", 10, "tel"], ["correo", 120, "email"],
  ["calle", 120], ["colonia", 80], ["municipio", 80], ["cp", 5, "cp"],
  ["emerg_nombre", 120], ["emerg_parentesco", 40], ["emerg_telefono", 10, "tel"],
  ["emerg2_nombre", 120], ["emerg2_parentesco", 40], ["emerg2_telefono", 10, "tel"],
  ["escolaridad", 40, "lista:escolaridad"], ["institucion", 120],
  ["emp1_empresa", 120], ["emp1_puesto", 80], ["emp1_periodo", 60], ["emp1_motivo", 200],
  ["emp2_empresa", 120], ["emp2_puesto", 80], ["emp2_periodo", 60], ["emp2_motivo", 200],
  ["ref1_nombre", 120], ["ref1_relacion", 40], ["ref1_telefono", 10, "tel"],
  ["ref2_nombre", 120], ["ref2_relacion", 40], ["ref2_telefono", 10, "tel"]
];
export const REQUERIDOS = ["nombre", "fecha_nacimiento", "curp", "telefono", "correo", "calle", "colonia", "municipio", "emerg_nombre", "emerg_parentesco", "emerg_telefono"];

// Campos que solo llena el administrador en el panel
export const CAMPOS_ADMIN = [
  ["puesto", 80], ["area", 30, "lista:areas"], ["fecha_ingreso", 10, "fecha"], ["turno", 60],
  ["fecha_entrevista", 10, "fecha"], ["notas", 2000]
];

const LISTAS = { estado_civil: ESTADO_CIVIL, escolaridad: ESCOLARIDAD, areas: AREAS };
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
  for (const [nombre, tipo] of [["estatus", "TEXT NOT NULL DEFAULT 'activo'"], ["fecha_baja", "TEXT"], ["motivo_baja", "TEXT"]]) {
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

function docsResumen(docs) {
  const lista = Object.entries(DOCUMENTOS).map(([k, nombre]) => ({ clave: k, nombre, recibido: !!(docs[k] && docs[k].recibido), fecha: docs[k] && docs[k].fecha || null }));
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

export async function expedienteApi(request, env, url) {
  const token = url.pathname.split("/")[3] || "";
  if (!RE_TOKEN.test(token)) return json({ ok: false, error: "Enlace no válido." }, 404);
  await asegurarEsquemaPersonal(env);
  const fila = await env.DB.prepare("SELECT * FROM colaboradores WHERE token = ?").bind(token).first();
  if (!fila) return json({ ok: false, error: "Este enlace ya no es válido. Pide uno nuevo a la administración." }, 404);
  if (fila.estatus === "inactivo") return json({ ok: false, error: "Este enlace ya no está activo. Si crees que es un error, comunícate con la administración." }, 403);

  if (request.method === "GET") {
    const datos = parse(fila.datos);
    if (!datos.nombre) datos.nombre = fila.nombre;
    if (!datos.telefono && fila.telefono) datos.telefono = fila.telefono;
    return json({ ok: true, datos, llenado_en: fila.llenado_en, docs: docsResumen(parse(fila.docs)), listas: { estado_civil: ESTADO_CIVIL, escolaridad: ESCOLARIDAD } });
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
  const { datos, errores } = leerCampos(cuerpo, CAMPOS_COLABORADOR, REQUERIDOS);
  if (!cuerpo.acepto) errores.acepto = "Marca esta casilla para continuar.";
  if (Object.keys(errores).length) return json({ ok: false, error: "Faltan datos o hay datos por revisar. Están marcados en rojo.", errores }, 422);

  const ahora = new Date().toISOString();
  await env.DB.prepare("UPDATE colaboradores SET datos = ?, nombre = ?, telefono = ?, llenado_en = ?, actualizado = ? WHERE id = ?")
    .bind(JSON.stringify(datos), datos.nombre, datos.telefono || fila.telefono, ahora, ahora, fila.id).run();
  return json({ ok: true });
}

// ---------------------------------------------------------------------------
// Panel: /panel/api/colaboradores...
// ---------------------------------------------------------------------------
function resumenFila(f) {
  const docs = docsResumen(parse(f.docs));
  const admin = parse(f.admin);
  return {
    id: f.id, nombre: f.nombre, telefono: f.telefono, puesto: admin.puesto || "", area: admin.area || "",
    llenado_en: f.llenado_en, creado: f.creado, actualizado: f.actualizado,
    estatus: f.estatus === "inactivo" ? "inactivo" : "activo", fecha_baja: f.fecha_baja || "", motivo_baja: f.motivo_baja || "",
    entregados: docs.entregados, total: docs.total,
    completo: !!f.llenado_en && docs.entregados === docs.total
  };
}

export async function personalPanel(request, env, url, partes) {
  await asegurarEsquemaPersonal(env);

  if (partes.length === 1 && request.method === "GET") {
    const filtro = url.searchParams.get("filtro") || "todos";
    const q = (url.searchParams.get("q") || "").trim().toLowerCase().slice(0, 60);
    const { results } = await env.DB.prepare("SELECT * FROM colaboradores ORDER BY nombre COLLATE NOCASE ASC LIMIT 500").all();
    const estatus = ["activo", "inactivo"].includes(url.searchParams.get("estatus")) ? url.searchParams.get("estatus") : "activo";
    const filas = results.map(resumenFila);
    const todos = filas.filter(c => c.estatus === estatus);
    const conteos = {
      activo: filas.filter(c => c.estatus === "activo").length, inactivo: filas.filter(c => c.estatus === "inactivo").length,
      todos: todos.length, incompletos: todos.filter(c => !c.completo).length, completos: todos.filter(c => c.completo).length
    };
    let lista = filtro === "incompletos" ? todos.filter(c => !c.completo) : filtro === "completos" ? todos.filter(c => c.completo) : todos;
    if (q) lista = lista.filter(c => [c.nombre, c.telefono, c.puesto, c.area].join(" ").toLowerCase().includes(q));
    return json({ ok: true, colaboradores: lista, conteos });
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
    const { datos: admin, errores: eAdmin } = leerCampos(cuerpo, CAMPOS_ADMIN);
    Object.assign(errores, eAdmin);
    if (Object.keys(errores).length) return json({ ok: false, error: "Revisa los datos.", errores }, 422);
    const id = crypto.randomUUID(), token = nuevoToken(), ahora = new Date().toISOString();
    await env.DB.prepare("INSERT INTO colaboradores (id, token, creado, actualizado, nombre, telefono, datos, admin, docs) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '{}')")
      .bind(id, token, ahora, ahora, nombre, telefono || null, JSON.stringify({ nombre, ...(telefono ? { telefono } : {}), ...(correo ? { correo } : {}) }), JSON.stringify(admin)).run();
    return json({ ok: true, id });
  }

  const id = partes[1];
  if (!id || !/^[0-9a-f-]{36}$/.test(id)) return json({ ok: false, error: "Ruta no encontrada." }, 404);
  const fila = await env.DB.prepare("SELECT * FROM colaboradores WHERE id = ?").bind(id).first();
  if (!fila) return json({ ok: false, error: "No existe ese colaborador." }, 404);

  if (partes.length === 2 && request.method === "GET") {
    return json({
      ok: true,
      colaborador: { ...resumenFila(fila), token: fila.token, datos: parse(fila.datos), admin: parse(fila.admin), docs: docsResumen(parse(fila.docs)).lista },
      listas: { estado_civil: ESTADO_CIVIL, escolaridad: ESCOLARIDAD, areas: AREAS }
    });
  }

  if (request.method !== "POST" || partes.length !== 3) return json({ ok: false, error: "Ruta no encontrada." }, 404);
  const cuerpo = await request.json().catch(() => ({}));
  const ahora = new Date().toISOString();

  if (partes[2] === "doc") {
    if (!DOCUMENTOS[cuerpo.clave]) return json({ ok: false, error: "Documento desconocido." }, 422);
    const docs = parse(fila.docs);
    if (cuerpo.recibido) docs[cuerpo.clave] = { recibido: true, fecha: /^\d{4}-\d{2}-\d{2}$/.test(cuerpo.fecha || "") ? cuerpo.fecha : ahora.slice(0, 10) };
    else delete docs[cuerpo.clave];
    await env.DB.prepare("UPDATE colaboradores SET docs = ?, actualizado = ? WHERE id = ?").bind(JSON.stringify(docs), ahora, id).run();
    return json({ ok: true, docs: docsResumen(docs) });
  }

  if (partes[2] === "admin") {
    const { datos: admin, errores } = leerCampos(cuerpo, CAMPOS_ADMIN);
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

  if (partes[2] === "nuevo-enlace") {
    const token = nuevoToken();
    await env.DB.prepare("UPDATE colaboradores SET token = ?, actualizado = ? WHERE id = ?").bind(token, ahora, id).run();
    return json({ ok: true, token });
  }

  if (partes[2] === "eliminar") {
    await env.DB.prepare("DELETE FROM colaboradores WHERE id = ?").bind(id).run();
    return json({ ok: true });
  }

  return json({ ok: false, error: "Ruta no encontrada." }, 404);
}
