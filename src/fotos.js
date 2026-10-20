// Almacén de archivos (fotos y PDFs) del panel y la tablet.
// Se guardan en Google Drive, en una carpeta dedicada de la cuenta administracion@ ("El Castaño · Archivos del panel"),
// por medio del Apps Script (herramientas/aviso-correo.gs, acción "archivos"). Drive no cobra por esto
// (entra en el espacio de Google Workspace); así no crece el almacenamiento de Cloudflare.
//
// Cada archivo conserva su "llave" de siempre (f:<id>:ticket, x:<id>:<doc>, xa:<id>:<doc>, tf:<tipo>:<uuid>).
// La tabla `archivos` de D1 dice en qué archivo de Drive vive cada llave.
// Si Drive no responde, el archivo se guarda en KV como antes y una tarea programada lo sube después,
// así nunca se pierde una foto. Al leer, Drive se consulta una vez y se guarda en la caché de Cloudflare
// (gratis) para que las siguientes vistas sean rápidas.

const RAIZ = "El Castaño · Archivos del panel";

let listo = false;
async function esquema(env) {
  if (listo) return;
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS archivos (llave TEXT PRIMARY KEY, drive_id TEXT NOT NULL, tipo TEXT, nombre TEXT,
      tam INTEGER, carpeta TEXT, creado TEXT NOT NULL, vence TEXT)`),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS archivos_vence ON archivos (vence)"),
    // Archivos de Drive que no se pudieron mandar a la papelera: se reintenta después
    env.DB.prepare("CREATE TABLE IF NOT EXISTS archivos_borrar (drive_id TEXT PRIMARY KEY, creado TEXT NOT NULL)"),
    // Versiones inmutables: D1 decide cuál es vigente; KV nunca se sobreescribe por sustitución.
    env.DB.prepare("CREATE TABLE IF NOT EXISTS archivos_actual (llave TEXT PRIMARY KEY, kv_llave TEXT NOT NULL, drive_id TEXT, tipo TEXT, nombre TEXT, tam INTEGER, carpeta TEXT, creado TEXT NOT NULL, vence TEXT)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS archivos_actual_pend ON archivos_actual (drive_id, creado)"),
    // Registro de copias para conciliación y borrado explícito; no purgar versiones al reemplazar.
    env.DB.prepare("CREATE TABLE IF NOT EXISTS archivos_copias (kv_llave TEXT PRIMARY KEY, llave TEXT NOT NULL, drive_id TEXT, creado TEXT NOT NULL)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS archivos_copias_llave ON archivos_copias (llave)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS archivos_legacy (llave TEXT PRIMARY KEY, hash TEXT NOT NULL, drive_id TEXT NOT NULL, at TEXT NOT NULL)"),
    // Impide que una lectura KV atrasada reabra un registro eliminado.
    env.DB.prepare("CREATE TABLE IF NOT EXISTS archivos_eliminados (llave TEXT PRIMARY KEY, at TEXT NOT NULL)"),
    // Descubrimiento conservador: registrar versiones físicas que quedaron sin índice por fallo D1.
    env.DB.prepare("CREATE TABLE IF NOT EXISTS archivos_huerfanos (kv_llave TEXT PRIMARY KEY, llave TEXT NOT NULL, detectado TEXT NOT NULL)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS archivos_recorrido (nombre TEXT PRIMARY KEY, cursor TEXT, actualizado TEXT NOT NULL)"),
    // Las fotos de la tablet ya no vencen: viven lo mismo que su registro
    env.DB.prepare("UPDATE archivos SET vence = NULL WHERE llave LIKE 'tf:%' AND vence IS NOT NULL")
  ]);
  listo = true;
}

const conScript = env => !!(env.AVISO_URL && env.AVISO_TOKEN);
// Identificador estable para reintentos de la misma clave y exactamente los mismos bytes.
// No incluye nombres, llaves de usuario ni datos privados en el valor enviado a Google.
async function idCarga(llave, bytes) {
  const cuerpo = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const prefijo = new TextEncoder().encode(llave + ":");
  const combinado = new Uint8Array(prefijo.length + cuerpo.byteLength);
  combinado.set(prefijo);
  combinado.set(cuerpo, prefijo.length);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", combinado));
  return [...digest].map(b => b.toString(16).padStart(2, "0")).join("");
}

function aBase64(bytes) {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = "";
  for (let i = 0; i < u.length; i += 0x8000) bin += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(bin);
}
// Comprobación de versión antes de migrar una clave KV. No depende del nombre
// del archivo, que puede repetirse cuando dos peticiones coinciden.
function mismosBytes(a, b) {
  if (!a || !b || a.byteLength !== b.byteLength) return false;
  const x = new Uint8Array(a.buffer || a, a.byteOffset || 0, a.byteLength);
  const y = new Uint8Array(b.buffer || b, b.byteOffset || 0, b.byteLength);
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
  return true;
}

function deBase64(b64) {
  const bin = atob(b64), u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u.buffer;
}

export async function scriptArchivos(env, datos, ms) { return script(env, datos, ms); }
async function script(env, datos, ms = 45000) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(env.AVISO_URL.trim(), {
      method: "POST", redirect: "follow", signal: ctl.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: env.AVISO_TOKEN.trim(), accion: "archivos", ...datos })
    });
    const txt = await r.text();
    let j; try { j = JSON.parse(txt); } catch { throw new Error("el script de Google no tiene la versión con archivos (" + txt.replace(/\s+/g, " ").slice(0, 80) + ")"); }
    if (!j.ok) throw new Error(j.error || "error del script");
    return j;
  } finally { clearTimeout(t); }
}

// Carpeta por tipo de llave (dentro de la carpeta dedicada)
function carpetaPorLlave(llave, extra) {
  const mes = new Date(Date.now() - 6 * 3600e3).toISOString().slice(0, 7);
  if (llave.startsWith("f:")) return ["Facturas (tickets y constancias)", mes];
  if (llave.startsWith("tf:")) return ["Tablet de turno", mes];
  if (llave.startsWith("x:") || llave.startsWith("xa:")) return ["Expedientes del personal", extra || llave.split(":")[1]];
  return ["Otros"];
}

// Guarda una versión nueva en una clave KV inmutable y después publica su puntero en D1.
// Si KV o D1 falla, la referencia anterior permanece intacta. No borrar versiones sustituidas.
// opciones: { tipo, nombre, carpeta, carpetaPersona, metadata, ttlDias, soloKV }
export async function guardarArchivo(env, llave, bytes, op = {}) {
  await esquema(env);
  const tipo = op.tipo || "application/octet-stream";
  const carpeta = Array.isArray(op.carpeta) ? op.carpeta : carpetaPorLlave(llave, op.carpetaPersona);
  const nombre = String(op.nombre || llave.replace(/[:]/g, "_")).replace(/[\\/:*?"<>|]/g, "").slice(0, 120);
  const creado = new Date().toISOString();
  const vence = op.ttlDias ? new Date(Date.now() + op.ttlDias * 864e5).toISOString() : null;
  // Capturar el estado inicial: una operación atrasada no debe pisar un reemplazo
  // ni resucitar un borrado que terminó durante la transferencia a KV.
  const estadoInicial = await env.DB.prepare(`SELECT
    (SELECT kv_llave FROM archivos_actual WHERE llave = ?) AS kv_llave,
    (SELECT at FROM archivos_eliminados WHERE llave = ?) AS eliminado_at`
  ).bind(llave, llave).first();
  const previo = estadoInicial?.kv_llave || "";
  const borradoAlIniciar = estadoInicial?.eliminado_at || "";
  const kvLlave = "fv:" + llave + ":" + crypto.randomUUID();
  // No aplicar expirationTtl al respaldo pendiente: podría vencer antes de pasar a Drive.
  await env.FILES.put(kvLlave, bytes, { metadata: { ...(op.metadata || {}), tipo, nombre } });
  // batch es una transacción D1: nunca apuntar a bytes que no se pudieron guardar en KV.
  const publicado = await env.DB.batch([
    env.DB.prepare("INSERT INTO archivos_copias (kv_llave, llave, creado) VALUES (?, ?, ?)")
      .bind(kvLlave, llave, creado),
    env.DB.prepare(`INSERT INTO archivos_actual (llave, kv_llave, drive_id, tipo, nombre, tam, carpeta, creado, vence)
      SELECT ?, ?, NULL, ?, ?, ?, ?, ?, ?
      WHERE COALESCE((SELECT at FROM archivos_eliminados WHERE llave = ?), '') = ?
      ON CONFLICT(llave) DO UPDATE SET
        kv_llave=excluded.kv_llave, drive_id=NULL, tipo=excluded.tipo,
        nombre=excluded.nombre, tam=excluded.tam, carpeta=excluded.carpeta,
        creado=excluded.creado, vence=excluded.vence
      WHERE archivos_actual.kv_llave = ?`)
      .bind(llave, kvLlave, tipo, nombre, bytes.byteLength, JSON.stringify(carpeta), creado, vence,
        llave, borradoAlIniciar, previo),
    env.DB.prepare(`DELETE FROM archivos_eliminados WHERE llave = ?
      AND EXISTS (SELECT 1 FROM archivos_actual WHERE llave = ? AND kv_llave = ?)`)
      .bind(llave, llave, kvLlave)
  ]);
  if (!publicado[1]?.meta?.changes) {
    // No descartar la copia huérfana: conservarla para conciliación técnica.
    throw new Error("Otra operación modificó este archivo mientras se guardaba. Actualiza la información y vuelve a intentarlo.");
  }
  if (!conScript(env) || op.soloKV) return { drive: false };
  // El envío directo a Drive es optativo: D1 conserva una versión KV recuperable si falla.
  try {
    const r = await script(env, { op: "guardar", raiz: RAIZ, carpeta, nombre, tipoArchivo: tipo,
      operacion: await idCarga(llave, bytes), base64: aBase64(bytes) });
    if (!r.id || typeof r.id !== "string") throw new Error("Drive no devolvió un identificador");
    return { drive: await confirmarDrive(env, { llave, kv_llave: kvLlave, tipo, nombre, tam: bytes.byteLength, carpeta: JSON.stringify(carpeta), creado, vence }, r.id) };
  } catch {
    console.error("archivos: versión KV conservada; transferencia Drive pendiente");
    return { drive: false };
  }
}

// Confirmación atómica: un envío tardío NO puede reemplazar una versión más nueva.
// La primera sentencia conserva incluso el ID de una carga que perdió la carrera.
async function confirmarDrive(env, version, id) {
  const carpeta = JSON.parse(version.carpeta || "[]");
  const r = await env.DB.batch([
    env.DB.prepare("UPDATE archivos_copias SET drive_id = ? WHERE kv_llave = ? AND llave = ?")
      .bind(id, version.kv_llave, version.llave),
    env.DB.prepare("UPDATE archivos_actual SET drive_id = ? WHERE llave = ? AND kv_llave = ? AND drive_id IS NULL")
      .bind(id, version.llave, version.kv_llave),
    // Guardar también el ID legado que el nuevo índice va a sustituir.
    env.DB.prepare("INSERT OR IGNORE INTO archivos_copias (kv_llave, llave, drive_id, creado) SELECT 'legacy-drive:' || drive_id, llave, drive_id, creado FROM archivos WHERE llave = ? AND drive_id <> ?").bind(version.llave, id),
    env.DB.prepare("INSERT INTO archivos (llave, drive_id, tipo, nombre, tam, carpeta, creado, vence) SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM archivos_actual WHERE llave = ? AND kv_llave = ? AND drive_id = ?) ON CONFLICT(llave) DO UPDATE SET drive_id=excluded.drive_id, tipo=excluded.tipo, nombre=excluded.nombre, tam=excluded.tam, carpeta=excluded.carpeta, creado=excluded.creado, vence=excluded.vence")
      .bind(version.llave, id, version.tipo, version.nombre, version.tam, carpeta.join("/"), version.creado, version.vence, version.llave, version.kv_llave, id)
  ]);
  return !!r[1]?.meta?.changes;
}

// Lee la versión señalada por D1. El esquema previo sigue sirviendo los archivos legados.
export async function leerArchivo(env, llave) {
  await esquema(env);
  const actual = await env.DB.prepare("SELECT * FROM archivos_actual WHERE llave = ?").bind(llave).first();
  const eliminado = await env.DB.prepare("SELECT 1 FROM archivos_eliminados WHERE llave = ?").bind(llave).first();
  // El borrado en D1 prevalece sobre una lectura KV retrasada en otra región.
  if (eliminado && !actual) return { value: null, metadata: null };
  if (actual) {
    try {
      const k = await env.FILES.getWithMetadata(actual.kv_llave, { type: "arrayBuffer" });
      if (k?.value) return { value: k.value, metadata: { ...(k.metadata || {}), tipo: actual.tipo, nombre: actual.nombre } };
    } catch { console.error("archivos: lectura de versión KV no disponible"); }
  }
  // Mientras una versión nueva se propaga por KV, aún es recuperable el archivo anterior.
  // Si la versión nueva ya tiene Drive confirmado, NO dejar que KV legado la eclipse.
  if (!eliminado && (!actual || !actual.drive_id)) {
    try {
      const legado = await env.FILES.getWithMetadata(llave, { type: "arrayBuffer" });
      if (legado?.value) return legado;
    } catch { console.error("archivos: lectura KV legada no disponible"); }
  }
  const fila = actual?.drive_id
    ? { drive_id: actual.drive_id, tipo: actual.tipo, nombre: actual.nombre }
    : eliminado ? null : await env.DB.prepare("SELECT * FROM archivos WHERE llave = ?").bind(llave).first();
  if (fila) {
    const clave = new Request("https://archivos.basculaypension.com/" + encodeURIComponent(fila.drive_id));
    const cache = typeof caches !== "undefined" ? caches.default : null;
    try {
      const c = cache && await cache.match(clave);
      if (c) return { value: await c.arrayBuffer(), metadata: { tipo: fila.tipo, nombre: fila.nombre } };
    } catch {}
    if (conScript(env)) {
      try {
        const r = await script(env, { op: "leer", id: fila.drive_id });
        const value = deBase64(r.base64);
        if (cache) {
          try { await cache.put(clave, new Response(value.slice(0), { headers: { "Content-Type": fila.tipo || "application/octet-stream", "Cache-Control": "max-age=604800" } })); } catch {}
        }
        return { value, metadata: { tipo: fila.tipo || r.tipo, nombre: fila.nombre } };
      } catch { console.error("archivos: no se pudo leer de Drive"); }
    }
  }
  return { value: null, metadata: null };
}

// Eliminación solicitada por un flujo del negocio, nunca por sustitución automática.
// Si alguien guardó otra versión simultáneamente, el borrado obsoleto no la toca.
export async function borrarArchivo(env, llave) {
  await esquema(env);
  const actual = await env.DB.prepare("SELECT kv_llave FROM archivos_actual WHERE llave = ?").bind(llave).first();
  const anterior = await env.DB.prepare("SELECT drive_id FROM archivos WHERE llave = ?").bind(llave).first();
  const copias = (await env.DB.prepare("SELECT kv_llave, drive_id FROM archivos_copias WHERE llave = ?").bind(llave).all()).results;
  // La marca de borrado está condicionada al puntero leído al iniciar.
  // Si otra operación lo sustituyó, no se borra ni se invalida esa versión nueva.
  // El UUID diferencia dos eliminaciones ocurridas en el mismo milisegundo.
  const versionInicial = actual?.kv_llave || "";
  const marcaBorrado = new Date().toISOString() + "#" + crypto.randomUUID();
  const resultado = await env.DB.batch([
    env.DB.prepare(`INSERT INTO archivos_eliminados (llave, at)
      SELECT ?, ? WHERE COALESCE((SELECT kv_llave FROM archivos_actual WHERE llave = ?), '') = ?
      ON CONFLICT(llave) DO UPDATE SET at = excluded.at
      WHERE COALESCE((SELECT kv_llave FROM archivos_actual WHERE llave = ?), '') = ?`)
      .bind(llave, marcaBorrado, llave, versionInicial, llave, versionInicial),
    env.DB.prepare("DELETE FROM archivos_actual WHERE llave = ? AND kv_llave = ?").bind(llave, versionInicial),
    env.DB.prepare("DELETE FROM archivos WHERE llave = ? AND NOT EXISTS (SELECT 1 FROM archivos_actual WHERE llave = ?)").bind(llave, llave),
    env.DB.prepare("DELETE FROM archivos_copias WHERE llave = ? AND NOT EXISTS (SELECT 1 FROM archivos_actual WHERE llave = ?)").bind(llave, llave),
    env.DB.prepare("DELETE FROM archivos_legacy WHERE llave = ? AND NOT EXISTS (SELECT 1 FROM archivos_actual WHERE llave = ?)").bind(llave, llave)
  ]);
  // Una eliminación obsoleta no puede purgar datos ni dejar marcas de borrado.
  if (!resultado[0]?.meta?.changes) return;
  // Verificar otra vez el puntero antes de limpiar físicamente una versión antigua.
  if (await env.DB.prepare("SELECT 1 FROM archivos_actual WHERE llave = ?").bind(llave).first()) return;
  for (const copia of copias) if (copia.kv_llave.startsWith("fv:")) await env.FILES.delete(copia.kv_llave).catch(() => {});
  await env.FILES.delete(llave).catch(() => {});
  for (const id of new Set([anterior?.drive_id, ...copias.map(c => c.drive_id)].filter(Boolean))) {
    await mandarAPapelera(env, id);
  }
}
async function mandarAPapelera(env, id) {
  if (!id) return;
  // No enviar a papelera IDs vigentes ni copias históricas de otros registros.
  const activo = await env.DB.prepare("SELECT 1 FROM archivos WHERE drive_id = ? UNION SELECT 1 FROM archivos_actual WHERE drive_id = ? UNION SELECT 1 FROM archivos_copias WHERE drive_id = ? LIMIT 1")
    .bind(id, id, id).first();
  if (activo) return;
  try { if (!conScript(env)) throw new Error("sin script"); await script(env, { op: "borrar", id }, 20000); }
  catch {
    await env.DB.prepare("INSERT OR IGNORE INTO archivos_borrar (drive_id, creado) VALUES (?, ?)")
      .bind(id, new Date().toISOString()).run();
  }
}

// Escaneo progresivo y acotado: tras KV.put puede fallar D1 y quedar una copia
// recuperable que no figura en archivos_actual ni archivos_copias.
// NUNCA vuelve a publicarla, la copia ni la elimina: solo registra la evidencia.
// El cursor evita recorrer siempre el comienzo cuando aumenta el volumen.
export async function reconciliarVersionesKV(env, limite = 40) {
  await esquema(env);
  const estado = await env.DB.prepare("SELECT cursor FROM archivos_recorrido WHERE nombre = ?").bind("versiones-fv").first();
  const cursor = estado?.cursor || null;
  let listado;
  try {
    listado = await env.FILES.list({ prefix: "fv:", limit: Math.max(1, Math.min(100, limite)),
      ...(cursor ? { cursor } : {}) });
  } catch (e) {
    if (!cursor) throw e;
    // Si KV invalida un cursor, recomenzar sin perder ninguna copia.
    listado = await env.FILES.list({ prefix: "fv:", limit: Math.max(1, Math.min(100, limite)) });
  }
  let nuevos = 0;
  for (const item of listado.keys || []) {
    // No confiar en metadatos de KV ni leer contenido personal.
    const m = /^fv:((?:f|tf|x|xa|pc):.+):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(item.name);
    if (!m) continue;
    const r = await env.DB.prepare(`INSERT OR IGNORE INTO archivos_huerfanos (kv_llave, llave, detectado)
      SELECT ?, ?, ?
      WHERE NOT EXISTS (SELECT 1 FROM archivos_copias WHERE kv_llave = ?)
        AND NOT EXISTS (SELECT 1 FROM archivos_actual WHERE kv_llave = ?)
        AND NOT EXISTS (SELECT 1 FROM archivos_eliminados WHERE llave = ?)`)
      .bind(item.name, m[1], new Date().toISOString(), item.name, item.name, m[1]).run();
    nuevos += Number(r.meta?.changes || 0);
  }
  // Solo avanzar después de registrar todos los elementos de la página.
  await env.DB.prepare(`INSERT INTO archivos_recorrido (nombre, cursor, actualizado)
    VALUES (?, ?, ?) ON CONFLICT(nombre) DO UPDATE SET cursor=excluded.cursor, actualizado=excluded.actualizado`)
    .bind("versiones-fv", listado.list_complete ? null : (listado.cursor || null), new Date().toISOString()).run();
  return { revisados: (listado.keys || []).length, nuevos, vuelta_completa: !!listado.list_complete };
}

// Tarea programada: se migran primero las versiones actuales y después las claves KV legadas.
// No borrar KV ni la versión anterior de Drive al reemplazar; conciliación antes de purgar.
export async function mantenerArchivos(env, max = 20) {
  await esquema(env);
  let huerfanosDetectados = 0;
  try {
    huerfanosDetectados = (await reconciliarVersionesKV(env)).nuevos;
  } catch {
    // Una incidencia en la enumeración no interrumpe la migración de archivos vigentes.
    console.error("archivos: recorrido de recuperación pendiente");
  }
  if (!conScript(env)) return { sin_script: true, huerfanosDetectados };
  try { await script(env, { op: "probar", raiz: RAIZ }, 20000); } catch (e) { return { error: e.message, huerfanosDetectados }; }
  let subidos = 0, vencidos = 0;
  const viejos = (await env.DB.prepare("SELECT llave FROM archivos WHERE vence IS NOT NULL AND vence < ? AND NOT EXISTS (SELECT 1 FROM archivos_actual WHERE llave = archivos.llave AND drive_id IS NULL) LIMIT 20")
    .bind(new Date().toISOString()).all()).results;
  for (const v of viejos) { await borrarArchivo(env, v.llave); vencidos++; }
  // Borrados explícitos fallidos: esperar propagación y confirmar que el ID no esté vigente.
  const hasta = new Date(Date.now() - 24 * 3600e3).toISOString();
  const pendientesBorrar = (await env.DB.prepare("SELECT drive_id FROM archivos_borrar WHERE creado <= ? LIMIT 20").bind(hasta).all()).results;
  for (const p of pendientesBorrar) {
    const activo = await env.DB.prepare("SELECT 1 FROM archivos WHERE drive_id = ? UNION SELECT 1 FROM archivos_actual WHERE drive_id = ? UNION SELECT 1 FROM archivos_copias WHERE drive_id = ? LIMIT 1").bind(p.drive_id, p.drive_id, p.drive_id).first();
    if (activo) continue;
    try {
      await script(env, { op: "borrar", id: p.drive_id }, 20000);
      await env.DB.prepare("DELETE FROM archivos_borrar WHERE drive_id = ?").bind(p.drive_id).run();
    } catch {}
  }
  const pendientes = (await env.DB.prepare("SELECT * FROM archivos_actual WHERE drive_id IS NULL ORDER BY creado LIMIT ?")
    .bind(Math.max(1, Math.min(max, 50))).all()).results;
  for (const v of pendientes) {
    if (subidos >= max) break;
    const kv = await env.FILES.getWithMetadata(v.kv_llave, { type: "arrayBuffer" });
    if (!kv?.value) continue; // propagación eventual: dejar intacto para la siguiente vuelta
    let id;
    try {
      const carpeta = JSON.parse(v.carpeta || "[]");
      const r = await script(env, { op: "guardar", raiz: RAIZ, carpeta, nombre: v.nombre, tipoArchivo: v.tipo,
        operacion: await idCarga(v.llave, kv.value), base64: aBase64(kv.value) });
      id = r.id;
      if (!id || typeof id !== "string") throw new Error("Drive no devolvió identificador");
      if (await confirmarDrive(env, v, id)) subidos++;
    } catch (e) { return { subidos, vencidos, error: e.message }; }
  }
  // Compatibilidad: revisar versiones legadas a lo sumo una vez al día por llave.
  // Se acota el número de lecturas profundas por ejecución para evitar gasto KV excesivo.
  const legacyConocidos = new Map((await env.DB.prepare("SELECT llave, hash, at FROM archivos_legacy").all()).results.map(x => [x.llave, x]));
  const bloqueadas = new Set((await env.DB.prepare("SELECT llave FROM archivos_actual UNION SELECT llave FROM archivos_eliminados").all()).results.map(x => x.llave));
  let revisadosLegacy = 0, detenerLegacy = false;
  for (const prefijo of ["f:", "tf:", "x:", "xa:"]) {
    if (subidos >= max || detenerLegacy) break;
    let cursor = null, paginas = 0;
    do {
      const l = await env.FILES.list({ prefix: prefijo, limit: 500, ...(cursor ? { cursor } : {}) });
      cursor = l.list_complete ? null : l.cursor || null;
      for (const k of l.keys) {
        if (subidos >= max) break;
        if (bloqueadas.has(k.name)) continue;
        const procesado = legacyConocidos.get(k.name);
        if (procesado && Date.now() - Date.parse(procesado.at) < 864e5) continue;
        if (revisadosLegacy >= Math.max(1, max)) { detenerLegacy = true; break; }
        revisadosLegacy++;
        const r = await env.FILES.getWithMetadata(k.name, { type: "arrayBuffer" });
        if (!r?.value) continue;
        const hash = await idCarga(k.name, r.value);
        if (procesado?.hash === hash) {
          await env.DB.prepare("UPDATE archivos_legacy SET at = ? WHERE llave = ? AND hash = ?")
            .bind(new Date().toISOString(), k.name, hash).run();
          continue;
        }
        let persona = null;
        if (prefijo === "x:" || prefijo === "xa:") {
          const f = await env.DB.prepare("SELECT nombre, num FROM colaboradores WHERE id = ?").bind(k.name.split(":")[1]).first().catch(() => null);
          persona = f ? (String(f.num || 0).padStart(3, "0") + " " + f.nombre).replace(/[\\/:*?"<>|]/g, "").slice(0, 100) : null;
        }
        const tipo = r.metadata?.tipo || "application/octet-stream";
        const carpeta = Array.isArray(r.metadata?.carpeta)
          ? r.metadata.carpeta : carpetaPorLlave(k.name, r.metadata?.carpetaPersona || persona);
        const nombre = String(r.metadata?.nombre || k.name.replace(/[:]/g, "_")).replace(/[\\/:*?"<>|]/g, "").slice(0, 120);
        let id;
        try {
          const res = await script(env, { op: "guardar", raiz: RAIZ, carpeta, nombre, tipoArchivo: tipo,
            operacion: hash, base64: aBase64(r.value) });
          id = res.id;
          if (!id || typeof id !== "string") throw new Error("Drive no devolvió identificador");
        } catch (e) { return { subidos, vencidos, error: e.message }; }
        const sigue = await env.FILES.get(k.name, { type: "arrayBuffer" });
        if (!sigue || !mismosBytes(r.value, sigue)) continue; // nueva escritura: reintentar más adelante
        const vence = k.expiration && !k.name.startsWith("tf:")
          ? new Date(k.expiration * 1000).toISOString() : null;
        const resultado = await env.DB.batch([
          env.DB.prepare("INSERT OR IGNORE INTO archivos_copias (kv_llave, llave, drive_id, creado) SELECT 'legacy-drive:' || drive_id, llave, drive_id, creado FROM archivos WHERE llave = ? AND drive_id <> ?").bind(k.name, id),
          env.DB.prepare("INSERT INTO archivos (llave, drive_id, tipo, nombre, tam, carpeta, creado, vence) SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM archivos_actual WHERE llave = ?) AND NOT EXISTS (SELECT 1 FROM archivos_eliminados WHERE llave = ?) ON CONFLICT(llave) DO UPDATE SET drive_id=excluded.drive_id, tipo=excluded.tipo, nombre=excluded.nombre, tam=excluded.tam, carpeta=excluded.carpeta, creado=excluded.creado, vence=excluded.vence")
            .bind(k.name, id, tipo, nombre, r.value.byteLength, carpeta.join("/"), new Date().toISOString(), vence, k.name, k.name),
          env.DB.prepare("INSERT INTO archivos_legacy (llave, hash, drive_id, at) SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM archivos WHERE llave = ? AND drive_id = ?) AND NOT EXISTS (SELECT 1 FROM archivos_actual WHERE llave = ?) ON CONFLICT(llave) DO UPDATE SET hash=excluded.hash, drive_id=excluded.drive_id, at=excluded.at")
            .bind(k.name, hash, id, new Date().toISOString(), k.name, id, k.name)
        ]);
        if (resultado[1]?.meta?.changes) subidos++;
        // Sin borrado por comprobación de contenido: KV no ofrece compare-and-delete.
      }
      paginas++;
    } while (cursor && paginas < 5 && subidos < max && !detenerLegacy);
  }
  return { subidos, vencidos, huerfanosDetectados };
}

// Para el panel: Drive, respaldo KV y copias pendientes sin purga automática.
export async function estadoArchivos(env) {
  await esquema(env);
  const n = await env.DB.prepare("SELECT COUNT(*) n, COALESCE(SUM(tam), 0) b FROM archivos").first();
  const versiones = await env.DB.prepare("SELECT COUNT(*) n FROM archivos_copias WHERE kv_llave LIKE 'fv:%'").first();
  const porSubir = await env.DB.prepare("SELECT COUNT(*) n FROM archivos_actual WHERE drive_id IS NULL").first();
  // Descontar huérfanos que luego fueron indexados correctamente.
  const hu = await env.DB.prepare(`SELECT COUNT(*) n FROM archivos_huerfanos h
    WHERE NOT EXISTS (SELECT 1 FROM archivos_copias c WHERE c.kv_llave = h.kv_llave)
      AND NOT EXISTS (SELECT 1 FROM archivos_actual a WHERE a.kv_llave = h.kv_llave)
      AND NOT EXISTS (SELECT 1 FROM archivos_eliminados e WHERE e.llave = h.llave)`).first();
  let enKv = 0, kvTruncado = false;
  for (const p of ["x:", "xa:", "tf:", "f:"]) {
    let cursor = null, paginas = 0;
    do {
      const r = await env.FILES.list({ prefix: p, limit: 1000, ...(cursor ? { cursor } : {}) });
      enKv += r.keys.length;
      cursor = r.list_complete ? null : r.cursor || null;
      paginas++;
    } while (cursor && paginas < 5);
    if (cursor) kvTruncado = true;
  }
  const pendientes = await env.DB.prepare("SELECT COUNT(*) n FROM archivos_borrar").first();
  return { en_drive: n.n, bytes_drive: n.b, en_kv: enKv + Number(versiones?.n || 0),
    en_kv_truncado: kvTruncado,
    versiones_pendientes: Number(porSubir?.n || 0),
    versiones_conservadas: Number(versiones?.n || 0),
    versiones_sin_indice: Number(hu?.n || 0),
    pendientes_borrar: Number(pendientes?.n || 0), script: conScript(env) };
}
