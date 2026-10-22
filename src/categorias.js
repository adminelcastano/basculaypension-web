// Categorías de egresos (pagos programados, pagos y gastos hechos, compras y gastos de caja).
// Se eligen de una lista o se escriben: una nueva se crea sola (con el icono "Otros") y su icono se puede
// cambiar en Pagos y compras → Categorías. El icono es un símbolo SVG de línea del panel (i-cat-*).
import { asegurarEsquemaBitacora, stmtBitacoraSiCambio } from "./bitacora.js";
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });

// Iconos disponibles (deben existir como <symbol id="i-cat-…"> en panel.html y turno.html)
export const ICONOS_CAT = ["servicios", "sueldos", "renta", "mantenimiento", "papeleria", "combustible", "impuestos", "tarjetas", "suscripciones", "familia", "otros", "carrito", "comida", "salud", "transporte", "limpieza"];
// Categorías técnicas: los cálculos dependen de sus claves originales.
export const CATEGORIAS_PROTEGIDAS = ["Sueldos", "Otros", "Comisiones bancarias", "Faltantes de caja", "Transporte"];
const TABLAS_CATEGORIA = ["agenda_items", "agenda_pagos", "caja_gastos", "compras_historial"];
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
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS categorias_eliminadas (nombre TEXT PRIMARY KEY, eliminado TEXT NOT NULL)").run();
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
  // La entrada vieja de otra sesión nunca debe recrear una categoría eliminada.
  const baja = await env.DB.prepare("SELECT 1 FROM categorias_eliminadas WHERE lower(nombre)=lower(?)").bind(nombre).first();
  if (baja) return null;
  const bonito = nombre.charAt(0).toUpperCase() + nombre.slice(1);
  const n = (await env.DB.prepare("SELECT COUNT(*) n FROM categorias").first()).n;
  await env.DB.prepare("INSERT OR IGNORE INTO categorias (nombre, icono, color, orden, creado) VALUES (?, 'otros', ?, ?, ?)").bind(bonito, PALETA[n % PALETA.length], 50 + n, new Date().toISOString()).run();
  return bonito;
}


const existeTablaCategoria = async (env, tabla) => {
  if (!TABLAS_CATEGORIA.includes(tabla)) return false;
  const { results } = await env.DB.prepare("PRAGMA table_info(" + tabla + ")").all();
  return results.some(c => c.name === "categoria");
};

export async function impactoCategoria(env, nombre) {
  await asegurarEsquemaCategorias(env);
  const registros = {};
  for (const tabla of TABLAS_CATEGORIA) {
    registros[tabla] = await existeTablaCategoria(env, tabla)
      ? Number((await env.DB.prepare("SELECT COUNT(*) n FROM " + tabla + " WHERE categoria = ?").bind(nombre).first())?.n || 0)
      : 0;
  }
  return { registros, total: Object.values(registros).reduce((a, b) => a + b, 0) };
}

// Una sola transacción D1: ningún gasto, pago, compra o recuerdo histórico se borra.
// Sólo desaparece su asociación con la categoría, que queda en NULL para recategorizar.
// La bitácora de lo ocurrido no se reescribe.
export async function eliminarCategoria(env, nombre, quien) {
  await asegurarEsquemaCategorias(env);
  if (CATEGORIAS_PROTEGIDAS.includes(nombre)) {
    const e = new Error("Esta categoría se utiliza en cálculos automáticos y no se puede eliminar."); e.code = "CAT_PROTEGIDA"; throw e;
  }
  const existe = await env.DB.prepare("SELECT nombre FROM categorias WHERE nombre = ?").bind(nombre).first();
  if (!existe) { const e = new Error("La categoría ya no existe. Actualiza la lista."); e.code = "CAT_NO_EXISTE"; throw e; }
  const vigentes = [];
  for (const tabla of TABLAS_CATEGORIA) if (await existeTablaCategoria(env, tabla)) vigentes.push(tabla);
  await asegurarEsquemaBitacora(env);
  const st = [
    env.DB.prepare("DELETE FROM categorias WHERE nombre = ?").bind(nombre),
    stmtBitacoraSiCambio(env, { quien, accion:"borrar", que:"Categoría de gastos", ref:nombre, detalle:{ efecto:"sin_categoria", tablas:vigentes } }),
    ...vigentes.map(tabla => env.DB.prepare("UPDATE " + tabla + " SET categoria = NULL WHERE categoria = ?").bind(nombre)),
    env.DB.prepare("INSERT OR REPLACE INTO categorias_eliminadas (nombre, eliminado) VALUES (?, ?)").bind(nombre, new Date().toISOString())
  ];
  const rs = await env.DB.batch(st);
  if (Number(rs[0]?.meta?.changes || 0) !== 1) {
    const e = new Error("La categoría cambió en otra sesión. Actualiza la lista."); e.code = "CAT_NO_EXISTE"; throw e;
  }
  return Object.fromEntries(vigentes.map((tabla,i) => [tabla, Number(rs[i+2]?.meta?.changes || 0)]));
}

// Crear desde Configuración reactiva voluntariamente una etiqueta dada de baja.
// No recategoriza registros antiguos ni cambia sus importes.
export async function crearCategoriaExplicita(env, valor, icono = "otros") {
  const nombre = String(valor ?? "").replace(/\s+/g, " ").trim();
  if (nombre.length < 2 || nombre.length > 40 || !ICONOS_CAT.includes(icono)) {
    const e = new Error("Escribe un nombre de 2 a 40 caracteres y elige un icono válido."); e.code = "CAT_INVALIDA"; throw e;
  }
  await asegurarEsquemaCategorias(env);
  const ya = await env.DB.prepare("SELECT nombre FROM categorias WHERE lower(nombre) = lower(?) OR lower(COALESCE(etiqueta, nombre)) = lower(?)").bind(nombre,nombre).first();
  if (ya) { const e = new Error("Ya existe una categoría con ese nombre."); e.code = "CAT_DUPLICADA"; throw e; }
  const bonito = nombre[0].toUpperCase() + nombre.slice(1);
  const n = Number((await env.DB.prepare("SELECT COUNT(*) n FROM categorias").first()).n);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM categorias_eliminadas WHERE lower(nombre) = lower(?)").bind(bonito),
    env.DB.prepare("INSERT INTO categorias (nombre, icono, color, orden, creado) VALUES (?, ?, ?, ?, ?)").bind(bonito, icono, PALETA[n % PALETA.length], 50+n, new Date().toISOString())
  ]);
  return bonito;
}

// Permite categorizar a mano también gastos históricos de Caja, sin tocar saldos.
// Para un ticket agrupado, reclasifica de manera coherente sus registros vinculados.
export async function recategorizarRegistro(env, { origen, id, categoria, quien }) {
  if (!TABLAS_CATEGORIA.includes(origen) || !/^[\w:.-]{1,90}$/.test(String(id || "")) ||
      typeof categoria !== "string" || !categoria.trim()) {
    const e = new Error("Elige un registro y una categoría válida."); e.code = "CAT_INVALIDA"; throw e;
  }
  await asegurarEsquemaCategorias(env);
  const filaCat = await env.DB.prepare("SELECT nombre FROM categorias WHERE nombre=? OR COALESCE(etiqueta,nombre)=?").bind(categoria,categoria).first();
  if (!filaCat) { const e = new Error("Elige una categoría existente de la lista."); e.code = "CAT_INVALIDA"; throw e; }
  if (!await existeTablaCategoria(env, origen)) { const e = new Error("Registro no encontrado."); e.code = "CAT_NO_EXISTE"; throw e; }
  const original = await env.DB.prepare("SELECT id, categoria" + (origen === "caja_gastos" ? "" : ", gasto_id") + " FROM " + origen + " WHERE id=?").bind(id).first();
  if (!original || original.categoria != null) {
    const e = new Error("Este registro ya fue categorizado o no existe. Actualiza la lista."); e.code = "CAT_CONFLICTO"; throw e;
  }
  await asegurarEsquemaBitacora(env);
  const gastoId = origen === "caja_gastos" ? id : original.gasto_id;
  const st = [
    env.DB.prepare("UPDATE " + origen + " SET categoria = ? WHERE id=? AND categoria IS NULL").bind(filaCat.nombre,id),
    stmtBitacoraSiCambio(env, { quien, accion:"editar", que:"Categoría de gasto", ref:origen+":"+id, detalle:{ categoria:filaCat.nombre, importe:"sin cambios" } })
  ];
  // Cada vinculado se actualiza únicamente si la fila original tiene la
  // categoría esperada; no sobrescribe recategorizaciones simultáneas distintas.
  const asociar = (tabla, condicion, valor) =>
    env.DB.prepare("UPDATE "+tabla+" SET categoria=? WHERE "+condicion+
      " AND categoria IS NULL AND EXISTS (SELECT 1 FROM "+origen+" WHERE id=? AND categoria=?)")
      .bind(filaCat.nombre,valor,id,filaCat.nombre);
  if (gastoId && origen !== "caja_gastos" && await existeTablaCategoria(env,"caja_gastos"))
    st.push(asociar("caja_gastos","id=?",gastoId));
  if (gastoId) {
    for (const tabla of ["agenda_pagos","agenda_items","compras_historial"]) {
      if (tabla === origen || !await existeTablaCategoria(env,tabla)) continue;
      st.push(asociar(tabla,"gasto_id=?",gastoId));
    }
  }
  if (origen === "agenda_items" && await existeTablaCategoria(env,"compras_historial"))
    st.push(asociar("compras_historial","id=?","ag:"+id));
  const rs = await env.DB.batch(st);
  if (!rs[0]?.meta?.changes) { const e = new Error("El registro cambió en otra sesión."); e.code = "CAT_CONFLICTO"; throw e; }
  return { categoria:filaCat.nombre };
}

export async function pendientesCategorias(env) {
  await asegurarEsquemaCategorias(env);
  const especificaciones = [
    ["caja_gastos","id","concepto","dia","monto",""],
    ["agenda_items","id","titulo","fecha","importe","AND tipo IN ('pago','compra') AND gasto_id IS NULL"],
    ["agenda_pagos","id","titulo","fecha","importe","AND gasto_id IS NULL"],
    ["compras_historial","id","titulo","fecha","importe","AND gasto_id IS NULL"]
  ];
  const lista=[], totales={};
  for (const [tabla,id,titulo,fecha,importe,filtro] of especificaciones) {
    if (!await existeTablaCategoria(env,tabla)) continue;
    const base = " FROM "+tabla+" WHERE categoria IS NULL "+filtro;
    totales[tabla] = Number((await env.DB.prepare("SELECT COUNT(*) n"+base).first())?.n||0);
    const filas = (await env.DB.prepare("SELECT "+id+" id, "+titulo+" concepto, "+fecha+" dia, "+importe+" importe"+base+" ORDER BY "+fecha+" DESC LIMIT 40").all()).results;
    for(const f of filas) lista.push({ ...f, origen:tabla });
  }
  lista.sort((a,b)=>String(b.dia||"").localeCompare(String(a.dia||"")));
  return { pendientes:lista.slice(0,80), total:Object.values(totales).reduce((a,b)=>a+b,0) };
}

// La sugerencia automática nunca reutiliza una categoría eliminada.
export async function sugerirCategoriaVigente(env, titulo) {
  const sugerida = await resolverCategoria(env, adivinarCategoria(titulo));
  return sugerida || "Otros";
}

// Rutas: /panel/api/categorias (lista, crear o cambiar icono)
export async function categoriasPanel(request, env, usuario = null) {
  await asegurarEsquemaCategorias(env);
  if (request.method === "GET") return json({ ok: true, categorias: await listaCategorias(env), iconos: ICONOS_CAT, protegidas: CATEGORIAS_PROTEGIDAS, ...(new URL(request.url).searchParams.has("pendientes") ? await pendientesCategorias(env) : {}) });
  let c; try { c = await request.json(); } catch { return json({ ok: false, error: "Datos inválidos." }, 400); }
  const quien = usuario?.email || null;
  if (typeof c.impacto === "string") {
    if (CATEGORIAS_PROTEGIDAS.includes(c.impacto)) return json({ok:false,error:"Categoría protegida."},409);
    const fila = await env.DB.prepare("SELECT nombre FROM categorias WHERE nombre = ?").bind(c.impacto).first();
    if (!fila) return json({ok:false,error:"La categoría ya no existe."},404);
    return json({ok:true, ...(await impactoCategoria(env,c.impacto))});
  }
  if (typeof c.eliminar === "string") {
    try { const afectados = await eliminarCategoria(env,c.eliminar,quien); return json({ok:true,afectados,categorias:await listaCategorias(env),...(await pendientesCategorias(env))}); }
    catch(e) { if (e.code) return json({ok:false,error:e.message}, e.code === "CAT_NO_EXISTE"?404:409); throw e; }
  }
  if (c.recategorizar) {
    try { const x = await recategorizarRegistro(env,{...c.recategorizar,categoria:c.categoria,quien}); return json({ok:true,...x,...(await pendientesCategorias(env))}); }
    catch(e) { if(e.code) return json({ok:false,error:e.message},e.code==="CAT_INVALIDA"?422:409); throw e; }
  }
  if (c.crear) {
    try { const nombre = await crearCategoriaExplicita(env,c.nombre,c.icono || "otros"); return json({ok:true,nombre,categorias:await listaCategorias(env)}); }
    catch(e) { if(e.code) return json({ok:false,error:e.message},e.code==="CAT_DUPLICADA"?409:422); throw e; }
  }
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
