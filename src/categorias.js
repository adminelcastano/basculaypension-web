// Categorías de egresos (pagos programados, pagos y gastos hechos, compras y gastos de caja).
// Se eligen de una lista o se escriben: una nueva se crea sola (con el icono "Otros") y su icono se puede
// cambiar en Pagos y compras → Categorías. El icono es un símbolo SVG de línea del panel (i-cat-*).
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });

// Iconos disponibles (deben existir como <symbol id="i-cat-…"> en panel.html y turno.html)
export const ICONOS_CAT = ["servicios", "sueldos", "renta", "mantenimiento", "papeleria", "combustible", "impuestos", "tarjetas", "suscripciones", "familia", "otros", "carrito", "comida", "salud", "transporte", "limpieza"];
const PALETA = ["#30d158", "#64d2ff", "#ffcc00", "#b69cff", "#ff9f0a", "#ff8fc7", "#2dd4bf", "#ff7a70", "#6c74e8", "#c08a00", "#8e8e93", "#7ee2a0", "#e879b6", "#3d8fd6", "#ffb86b", "#a1a1a6"];
export const CATEGORIAS_BASE = [
  ["Servicios", "servicios"], ["Sueldos", "sueldos"], ["Renta", "renta"], ["Mantenimiento y refacciones", "mantenimiento"],
  ["Papelería y consumibles", "papeleria"], ["Combustible", "combustible"], ["Impuestos y contador", "impuestos"],
  ["Tarjetas y créditos", "tarjetas"], ["Suscripciones", "suscripciones"], ["Familia y personales", "familia"], ["Otros", "otros"]
];
// Palabras clave para asignar categoría a lo que ya estaba registrado (y sugerir en lo nuevo)
const CLAVES = [
  ["Papelería y consumibles", /garraf|papel|rollo|tinta|toner|t[oó]ner|cloro|jab[oó]n|escoba|trapeador|bolsa|foco|pila|cinta|sabrita|refresco|agua ciel|consumible|limpieza/],
  ["Servicios", /telcel|telmex|izzi|totalplay|internet|luz|cfe|\bagua\b|predial|gas\b|tel[eé]fono|celular|recarga/],
  ["Sueldos", /sueldo|n[oó]mina|salario|aguinaldo|prima vac|finiquito|pago a /],
  ["Renta", /\brenta\b|arrendamiento|alquiler/],
  ["Mantenimiento y refacciones", /refacci|manten|reparaci|pintura|soldad|plomer|electric|herramient|mec[aá]nic|llanta|pluma|b[aá]scula/],
  ["Transporte", /\btaxi|uber|didi|pasaje|cami[oó]n|colectivo|transporte/],
  ["Combustible", /gasolin|di[eé]sel|combustible|magna|premium/],
  ["Impuestos y contador", /\bsat\b|impuesto|contador|contabilidad|imss|infonavit|isr|iva\b|declaraci/],
  ["Tarjetas y créditos", /tarjeta|cr[eé]dito|elektra|coppel|banco|bbva|banamex|santander|banorte|hsbc|pr[eé]stamo|abono/],
  ["Suscripciones", /netflix|spotify|disney|hbo|amazon|prime|youtube|apple|google one|icloud|suscrip|cloudflare|dominio|hosting/],
  ["Familia y personales", /colegiatura|escuela|uniforme|doctor|m[eé]dico|farmacia|familia|personal|despensa|super/]
];
const limpiar = t => String(t || "").replace(/^(pago|compra):\s*/i, "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
export function adivinarCategoria(texto) {
  const t = limpiar(texto);
  for (const [nombre, re] of CLAVES) if (re.test(t)) return nombre;
  return "Otros";
}

let listo = false;
export async function asegurarEsquemaCategorias(env) {
  if (listo) return;
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS categorias (nombre TEXT PRIMARY KEY, icono TEXT NOT NULL, color TEXT NOT NULL, orden INTEGER NOT NULL DEFAULT 99, creado TEXT NOT NULL)").run();
  const n = (await env.DB.prepare("SELECT COUNT(*) n FROM categorias").first()).n;
  if (!n) {
    const ahora = new Date().toISOString();
    await env.DB.batch(CATEGORIAS_BASE.map(([nombre, icono], i) => env.DB.prepare("INSERT OR IGNORE INTO categorias (nombre, icono, color, orden, creado) VALUES (?, ?, ?, ?, ?)").bind(nombre, icono, PALETA[i % PALETA.length], i, ahora)));
  }
  // Nombre visible editable (etiqueta). "nombre" sigue siendo la clave guardada en los registros y la que usa el
  // cálculo (Sueldos, Comisiones…), así cambiar el nombre no rompe los totales ni lo ya registrado.
  const colsC = new Set((await env.DB.prepare("PRAGMA table_info(categorias)").all()).results.map(r => r.name));
  if (!colsC.has("etiqueta")) await env.DB.prepare("ALTER TABLE categorias ADD COLUMN etiqueta TEXT").run();
  // Columna categoria donde se registran los egresos (si una tabla todavía no existe, se revisa en la siguiente llamada)
  let faltan = false;
  for (const t of ["agenda_items", "agenda_pagos", "caja_gastos"]) {
    let cols;
    try { cols = new Set((await env.DB.prepare(`PRAGMA table_info(${t})`).all()).results.map(r => r.name)); } catch { faltan = true; continue; }
    if (!cols.size) { faltan = true; continue; }
    if (cols.has("categoria")) continue;
    await env.DB.prepare(`ALTER TABLE ${t} ADD COLUMN categoria TEXT`).run();
    // Lo que ya estaba registrado recibe una categoría por palabra clave (se puede cambiar después)
    const sel = t === "agenda_items" ? "SELECT id, titulo AS texto FROM agenda_items WHERE tipo IN ('pago', 'compra')"
      : t === "agenda_pagos" ? "SELECT p.id, COALESCE(p.titulo, i.titulo) AS texto FROM agenda_pagos p LEFT JOIN agenda_items i ON i.id = p.item_id"
      : "SELECT id, concepto AS texto FROM caja_gastos";
    const filas = (await env.DB.prepare(sel).all()).results;
    const st = filas.map(f => env.DB.prepare(`UPDATE ${t} SET categoria = ? WHERE id = ?`).bind(adivinarCategoria(f.texto), f.id));
    for (let i = 0; i < st.length; i += 50) await env.DB.batch(st.slice(i, i + 50));
  }
  listo = !faltan;
}

export async function listaCategorias(env) {
  await asegurarEsquemaCategorias(env);
  return (await env.DB.prepare("SELECT nombre, COALESCE(etiqueta, nombre) AS etiqueta, icono, color FROM categorias ORDER BY orden, nombre").all()).results;
}
// Nombre visible de una categoría guardada (si se le cambió el nombre)
export async function etiquetasCategorias(env) {
  const m = new Map((await listaCategorias(env)).map(c => [c.nombre, c.etiqueta]));
  return nombre => nombre ? m.get(nombre) || nombre : nombre;
}

// Nombre válido de categoría: si no existe, se crea (icono "Otros"). Vacío → null.
export async function resolverCategoria(env, valor) {
  const nombre = String(valor ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
  if (!nombre) return null;
  await asegurarEsquemaCategorias(env);
  const existe = await env.DB.prepare("SELECT nombre FROM categorias WHERE lower(COALESCE(etiqueta, nombre)) = lower(?) OR lower(nombre) = lower(?) ORDER BY lower(COALESCE(etiqueta, nombre)) = lower(?) DESC").bind(nombre, nombre, nombre).first();
  if (existe) return existe.nombre;
  const bonito = nombre.charAt(0).toUpperCase() + nombre.slice(1);
  const n = (await env.DB.prepare("SELECT COUNT(*) n FROM categorias").first()).n;
  await env.DB.prepare("INSERT OR IGNORE INTO categorias (nombre, icono, color, orden, creado) VALUES (?, 'otros', ?, ?, ?)").bind(bonito, PALETA[n % PALETA.length], 50 + n, new Date().toISOString()).run();
  return bonito;
}

// Rutas: /panel/api/categorias (lista, crear o cambiar icono)
export async function categoriasPanel(request, env) {
  await asegurarEsquemaCategorias(env);
  if (request.method === "GET") return json({ ok: true, categorias: await listaCategorias(env), iconos: ICONOS_CAT });
  let c; try { c = await request.json(); } catch { return json({ ok: false, error: "Datos inválidos." }, 400); }
  // Cambiar el nombre visible de una categoría ya creada
  if (c.renombrar) {
    const fila = await env.DB.prepare("SELECT nombre FROM categorias WHERE nombre = ?").bind(String(c.renombrar)).first();
    if (!fila) return json({ ok: false, error: "Esa categoría ya no existe." }, 404);
    let nuevo = String(c.nombre ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
    if (nuevo.length < 2) return json({ ok: false, error: "Escribe el nombre de la categoría." }, 422);
    nuevo = nuevo.charAt(0).toUpperCase() + nuevo.slice(1);
    const choca = await env.DB.prepare("SELECT 1 FROM categorias WHERE nombre != ? AND (lower(nombre) = lower(?) OR lower(COALESCE(etiqueta, nombre)) = lower(?))").bind(fila.nombre, nuevo, nuevo).first();
    if (choca) return json({ ok: false, error: "Ya hay otra categoría con ese nombre." }, 409);
    await env.DB.prepare("UPDATE categorias SET etiqueta = ? WHERE nombre = ?").bind(nuevo === fila.nombre ? null : nuevo, fila.nombre).run();
    return json({ ok: true, nombre: fila.nombre, categorias: await listaCategorias(env) });
  }
  const nombre = await resolverCategoria(env, c.nombre);
  if (!nombre) return json({ ok: false, error: "Escribe el nombre de la categoría." }, 422);
  if (c.icono) {
    if (!ICONOS_CAT.includes(c.icono)) return json({ ok: false, error: "Icono inválido." }, 422);
    await env.DB.prepare("UPDATE categorias SET icono = ? WHERE nombre = ?").bind(c.icono, nombre).run();
  }
  return json({ ok: true, nombre, categorias: await listaCategorias(env) });
}
