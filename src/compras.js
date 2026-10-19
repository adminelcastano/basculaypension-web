// Memoria de la lista de compras: lo que se ha comprado, dónde, cuánto y cuántas veces.
// Alimenta las sugerencias al escribir, "Lo que compras seguido" y el precio de referencia de cada artículo.
// Se conserva aunque las compras viejas se borren de la agenda (máximo 3000 registros).

export const normCompra = t => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

let listo = false;
export async function asegurarEsquemaCompras(env) {
  if (listo) return;
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS compras_historial (
      id TEXT PRIMARY KEY, norm TEXT NOT NULL, titulo TEXT NOT NULL, lugar TEXT, cantidad TEXT, importe REAL,
      fecha TEXT NOT NULL, gasto_id TEXT, categoria TEXT, creado TEXT NOT NULL)`),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS compras_hist_norm ON compras_historial (norm, fecha)")
  ]);
  // La primera vez se llena con las compras ya hechas que siguen en la agenda
  const n = await env.DB.prepare("SELECT COUNT(*) n FROM compras_historial").first();
  if (!n || !n.n) {
    const filas = (await env.DB.prepare("SELECT id, titulo, lugar, cantidad, importe, gasto_id, categoria, COALESCE(cerrado, actualizado, creado) f FROM agenda_items WHERE tipo = 'compra' AND estado = 'comprado' LIMIT 1000").all().catch(() => ({ results: [] }))).results;
    const st = filas.map(r => env.DB.prepare("INSERT OR IGNORE INTO compras_historial (id, norm, titulo, lugar, cantidad, importe, fecha, gasto_id, categoria, creado) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind("ag:" + r.id, normCompra(r.titulo), r.titulo, r.lugar, r.cantidad, r.importe, String(r.f || "").slice(0, 10), r.gasto_id, r.categoria, new Date().toISOString()));
    for (let i = 0; i < st.length; i += 50) await env.DB.batch(st.slice(i, i + 50));
  }
  listo = true;
}

// Registro de una compra hecha (para la memoria)
// "exclusiva" impide que dos sesiones compren el mismo artículo simultáneamente.
// La clave ag:<id> existe desde antes y se borra al devolver la compra a pendiente.
export const stmtHistorialCompra = (env, it, { importe = null, fecha, lugar = null, gasto_id = null, exclusiva = false }) =>
  env.DB.prepare(exclusiva
    ? "INSERT INTO compras_historial (id, norm, titulo, lugar, cantidad, importe, fecha, gasto_id, categoria, creado) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    : "INSERT OR REPLACE INTO compras_historial (id, norm, titulo, lugar, cantidad, importe, fecha, gasto_id, categoria, creado) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind("ag:" + it.id, normCompra(it.titulo), it.titulo, lugar || it.lugar || null, it.cantidad || null, importe, fecha, gasto_id, it.categoria || null, new Date().toISOString());

// Si una compra regresa a pendiente, deja de contar en la memoria
export const stmtQuitarHistorialCompra = (env, id) => env.DB.prepare("DELETE FROM compras_historial WHERE id = ?").bind("ag:" + id);

// Resumen por artículo: [{ titulo, norm, veces, ultimo: { importe, fecha, lugar, cantidad }, lugar, categoria }]
export function resumirMemoria(filas) {
  const m = new Map();
  for (const r of filas) {
    let x = m.get(r.norm);
    if (!x) { x = { titulo: r.titulo, norm: r.norm, veces: 0, ultimo: null, precio: null, lugar: r.lugar || null, categoria: r.categoria || null }; m.set(r.norm, x); }
    x.veces++;
    // filas vienen de la más reciente a la más vieja
    if (!x.ultimo) x.ultimo = { fecha: r.fecha, lugar: r.lugar || null, cantidad: r.cantidad || null, importe: r.importe };
    if (x.precio == null && r.importe != null) x.precio = { importe: r.importe, fecha: r.fecha, lugar: r.lugar || null, cantidad: r.cantidad || null };
    if (!x.lugar && r.lugar) x.lugar = r.lugar;
  }
  return [...m.values()].sort((a, b) => b.veces - a.veces || String(b.ultimo.fecha).localeCompare(String(a.ultimo.fecha)));
}

export async function memoriaCompras(env, limite = 300) {
  await asegurarEsquemaCompras(env);
  const filas = (await env.DB.prepare("SELECT norm, titulo, lugar, cantidad, importe, fecha, categoria FROM compras_historial ORDER BY fecha DESC, creado DESC LIMIT 3000").all()).results;
  return resumirMemoria(filas).slice(0, limite);
}

// Limpieza: solo se guardan los 3000 registros más recientes
export async function limpiarMemoriaCompras(env) {
  await asegurarEsquemaCompras(env);
  await env.DB.prepare("DELETE FROM compras_historial WHERE id NOT IN (SELECT id FROM compras_historial ORDER BY fecha DESC, creado DESC LIMIT 3000)").run();
}

// Importe con o sin $ y comas; NaN si no es válido
export const leerImporte = v => { const t = String(v ?? "").replace(/[$,\s]/g, ""); return /^\d{1,9}(\.\d{1,2})?$/.test(t) ? Number(t) : NaN; };

// Reparte el ticket: precios de cada artículo (los que se dieron) y total. Sin total, se suman los precios (todos obligatorios).
export function cuentasTicket(ids, total, precios = {}) {
  const p = {};
  for (const id of ids) { const v = leerImporte(precios[id]); if (precios[id] != null && String(precios[id]).trim() !== "") { if (!(v >= 0)) return { error: "Revisa el precio de cada artículo." }; p[id] = v; } }
  let t = String(total ?? "").trim() === "" ? NaN : leerImporte(total);
  if (String(total ?? "").trim() !== "" && !(t > 0)) return { error: "Escribe el total del ticket." };
  if (!(t > 0)) {
    if (Object.keys(p).length !== ids.length) return { error: "Escribe el total del ticket (o el precio de cada artículo)." };
    t = Math.round(Object.values(p).reduce((a, x) => a + x, 0) * 100) / 100;
    if (!(t > 0)) return { error: "Escribe el total del ticket." };
  }
  // El total pagado y el detalle deben reconciliarse al centavo.
  // Se permiten precios parciales, pero nunca pueden superar el total;
  // si se desglosaron todos, la suma debe coincidir exactamente.
  const desglosadoCentavos = Object.values(p).reduce((a, v) => a + Math.round(v * 100), 0);
  const totalCentavos = Math.round(t * 100);
  if (desglosadoCentavos > totalCentavos)
    return { error: "Los precios de los artículos superan el total del ticket." };
  if (Object.keys(p).length === ids.length && desglosadoCentavos !== totalCentavos)
    return { error: "El total del ticket no coincide con la suma de los artículos." };
  // Un solo artículo sin precio propio: su precio es el total
  if (ids.length === 1 && p[ids[0]] == null) p[ids[0]] = t;
  return { total: t, precios: p };
}
