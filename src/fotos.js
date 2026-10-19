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
    // Las fotos de la tablet ya no vencen: viven lo mismo que su registro
    env.DB.prepare("UPDATE archivos SET vence = NULL WHERE llave LIKE 'tf:%' AND vence IS NOT NULL")
  ]);
  listo = true;
}

const conScript = env => !!(env.AVISO_URL && env.AVISO_TOKEN);
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

// Guarda un archivo. opciones: { tipo, nombre, carpeta: [..] (opcional), ttlDias (opcional), metadata (para KV) }
export async function guardarArchivo(env, llave, bytes, op = {}) {
  await esquema(env);
  const tipo = op.tipo || "application/octet-stream";
  const vence = op.ttlDias ? new Date(Date.now() + op.ttlDias * 864e5).toISOString() : null;
  const anterior = await env.DB.prepare("SELECT drive_id FROM archivos WHERE llave = ?").bind(llave).first();
  // Una carga a Drive solo cuenta como confirmada después de guardar su índice en D1.
  // Ningún error de limpieza posterior debe activar la ruta KV y retirar el archivo nuevo.
  let driveNuevo = null;
  let driveConfirmado = false;
  if (conScript(env)) {
    try {
      const carpeta = op.carpeta || carpetaPorLlave(llave, op.carpetaPersona);
      const nombre = String(op.nombre || llave.replace(/[:]/g, "_")).replace(/[\\/:*?"<>|]/g, "").slice(0, 120);
      const r = await script(env, { op: "guardar", raiz: RAIZ, carpeta, nombre, tipoArchivo: tipo, base64: aBase64(bytes) });
      if (!r.id || typeof r.id !== "string") throw new Error("Drive no devolvió un identificador");
      driveNuevo = r.id;
      await env.DB.prepare(`INSERT INTO archivos (llave, drive_id, tipo, nombre, tam, carpeta, creado, vence) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (llave) DO UPDATE SET drive_id = excluded.drive_id, tipo = excluded.tipo, nombre = excluded.nombre, tam = excluded.tam, carpeta = excluded.carpeta, creado = excluded.creado, vence = excluded.vence`)
        .bind(llave, r.id, tipo, nombre, bytes.byteLength, carpeta.join("/"), new Date().toISOString(), vence).run();
      driveConfirmado = true;
    } catch {
      // Si Drive escribió pero D1 no confirmó, se preserva el archivo remoto:
      // no se sabe si D1 llegó a confirmar la escritura al fallar la respuesta.
      console.error("archivos: Drive/D1 no confirmó la carga; conservando referencia anterior");
    }
  }
  if (driveConfirmado) {
    await env.FILES.delete(llave).catch(() => {});
    if (anterior && anterior.drive_id !== driveNuevo) {
      await mandarAPapelera(env, anterior.drive_id).catch(() => {});
    }
    return { drive: true };
  }
  // Fallback conservador: escribir KV y confirmar el éxito ANTES de modificar D1
  // o de enviar el documento anterior a papelera. Si KV falla, el anterior sigue vivo.
  await env.FILES.put(llave, bytes, {
    metadata: { tipo, ...(op.metadata || {}), ...(op.nombre ? { nombre: String(op.nombre).slice(0, 120) } : {}) },
    ...(op.ttlDias ? { expirationTtl: op.ttlDias * 86400 } : {})
  });
  // Conservar también la referencia y el documento Drive anterior mientras KV
  // se propaga. La tarea programada reemplazará el índice D1 y sólo entonces
  // archivará Drive. De esta manera un lector en otra región no queda sin copia.
  return { drive: false };
}

// Lee un archivo: { value: ArrayBuffer, metadata: { tipo, nombre } } (value null si no existe)
export async function leerArchivo(env, llave) {
  await esquema(env);
  // Primero KV: ahí está lo recién subido (o reemplazado) mientras la tarea programada lo pasa a Drive
  const k = await env.FILES.getWithMetadata(llave, { type: "arrayBuffer" });
  if (k && k.value) return k;
  const fila = await env.DB.prepare("SELECT * FROM archivos WHERE llave = ?").bind(llave).first();
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
        if (cache) { try { await cache.put(clave, new Response(value.slice(0), { headers: { "Content-Type": fila.tipo || "application/octet-stream", "Cache-Control": "max-age=604800" } })); } catch {} }
        return { value, metadata: { tipo: fila.tipo || r.tipo, nombre: fila.nombre } };
      } catch (e) { console.error("archivos: no se pudo leer de Drive"); }
    }
  }
  return { value: null, metadata: null };
}

export async function borrarArchivo(env, llave) {
  await esquema(env);
  const fila = await env.DB.prepare("SELECT drive_id FROM archivos WHERE llave = ?").bind(llave).first();
  if (fila) {
    await env.DB.prepare("DELETE FROM archivos WHERE llave = ?").bind(llave).run();
    await mandarAPapelera(env, fila.drive_id);
  }
  await env.FILES.delete(llave).catch(() => {});
}
async function mandarAPapelera(env, id) {
  try { if (!conScript(env)) throw new Error("sin script"); await script(env, { op: "borrar", id }, 20000); }
  catch { await env.DB.prepare("INSERT OR IGNORE INTO archivos_borrar (drive_id, creado) VALUES (?, ?)").bind(id, new Date().toISOString()).run(); }
}

// Tarea programada: sube a Drive lo que quedó en KV, borra lo vencido y reintenta la papelera.
// Pocos archivos por vuelta para no pasar los límites de tiempo.
export async function mantenerArchivos(env, max = 20) {
  await esquema(env);
  if (!conScript(env)) return { sin_script: true };
  try { await script(env, { op: "probar", raiz: RAIZ }, 20000); } catch (e) { return { error: e.message }; }
  let subidos = 0, vencidos = 0;
  // Vencidos (fotos de la tablet: 100 días)
  const viejos = (await env.DB.prepare("SELECT llave FROM archivos WHERE vence IS NOT NULL AND vence < ? LIMIT 20").bind(new Date().toISOString()).all()).results;
  for (const v of viejos) { await borrarArchivo(env, v.llave); vencidos++; }
  const pend = (await env.DB.prepare("SELECT drive_id FROM archivos_borrar LIMIT 20").all()).results;
  for (const p of pend) {
    try { await script(env, { op: "borrar", id: p.drive_id }, 20000); await env.DB.prepare("DELETE FROM archivos_borrar WHERE drive_id = ?").bind(p.drive_id).run(); } catch {}
  }
  // Todo archivo nuevo entra primero a KV (rápido para quien lo sube) y aquí pasa a Drive
  for (const prefijo of ["f:", "tf:", "x:", "xa:"]) {
    if (subidos >= max) break;
    const l = await env.FILES.list({ prefix: prefijo, limit: 50 });
    for (const k of l.keys) {
      if (subidos >= max) break;
      const r = await env.FILES.getWithMetadata(k.name, { type: "arrayBuffer" });
      if (!r || !r.value) continue;
      let persona = null;
      if (prefijo === "x:" || prefijo === "xa:") {
        const f = await env.DB.prepare("SELECT nombre, num FROM colaboradores WHERE id = ?").bind(k.name.split(":")[1]).first().catch(() => null);
        persona = f ? `${String(f.num || 0).padStart(3, "0")} ${f.nombre}`.replace(/[\\/:*?"<>|]/g, "").slice(0, 100) : null;
      }
      const tipo = (r.metadata && r.metadata.tipo) || "application/octet-stream";
      const carpeta = carpetaPorLlave(k.name, persona);
      const nombre = String((r.metadata && r.metadata.nombre) || k.name.replace(/[:]/g, "_")).replace(/[\\/:*?"<>|]/g, "").slice(0, 120);
      let id;
      try { id = (await script(env, { op: "guardar", raiz: RAIZ, carpeta, nombre, tipoArchivo: tipo, base64: aBase64(r.value) })).id; }
      catch (e) { return { subidos, vencidos, error: e.message }; }
      // Si lo borraron mientras subía, se manda a la papelera y no se registra
      const sigue = await env.FILES.get(k.name, { type: "arrayBuffer" });
      if (!sigue || !mismosBytes(r.value, sigue)) {
        // El archivo se borró o se reemplazó durante la subida: nunca
        // vincular una versión antigua ni borrar la sustitución más reciente.
        await mandarAPapelera(env, id);
        continue;
      }
      const vence = k.expiration && !k.name.startsWith("tf:") ? new Date(k.expiration * 1000).toISOString() : null;
      const anterior = await env.DB.prepare("SELECT drive_id FROM archivos WHERE llave = ?").bind(k.name).first();
      await env.DB.prepare(`INSERT INTO archivos (llave, drive_id, tipo, nombre, tam, carpeta, creado, vence) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (llave) DO UPDATE SET drive_id = excluded.drive_id, tipo = excluded.tipo, nombre = excluded.nombre, tam = excluded.tam, carpeta = excluded.carpeta, creado = excluded.creado, vence = excluded.vence`)
        .bind(k.name, id, tipo, nombre, r.value.byteLength, carpeta.join("/"), new Date().toISOString(), vence).run();
      if (anterior && anterior.drive_id !== id) await mandarAPapelera(env, anterior.drive_id);
      // KV no ofrece compare-and-delete atómico. Comprobación conservadora
      // de versión: no retirar un reemplazo con contenido diferente.
      const actual = await env.FILES.get(k.name, { type: "arrayBuffer" });
      if (actual && mismosBytes(r.value, actual)) await env.FILES.delete(k.name);
      subidos++;
    }
  }
  return { subidos, vencidos };
}

// Para el panel: cuántos archivos hay en Drive y cuántos esperan en KV
export async function estadoArchivos(env) {
  await esquema(env);
  const n = (await env.DB.prepare("SELECT COUNT(*) n, COALESCE(SUM(tam), 0) b FROM archivos").first());
  let enKv = 0;
  for (const p of ["x:", "xa:", "tf:", "f:"]) enKv += (await env.FILES.list({ prefix: p, limit: 1000 })).keys.length;
  const pendientes = await env.DB.prepare("SELECT COUNT(*) n FROM archivos_borrar").first();
  return { en_drive: n.n, bytes_drive: n.b, en_kv: enKv,
    pendientes_borrar: Number(pendientes?.n || 0), script: conScript(env) };
}
