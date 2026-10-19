// Notificaciones push (Web Push estándar: VAPID + cifrado aes128gcm, RFC 8291/8292) para el celular del
// administrador (panel) y la tablet del turno. Sin servicios externos: cada aparato da una dirección de su
// servicio de push (en Android, el de Google) y aquí se le manda el mensaje cifrado. Gratis y sin app.
//
// destino: "admin" (panel) o "tablet" (turno). Las llaves VAPID se generan solas la primera vez y viven en D1.

const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const deB64u = s => { const b = atob(String(s).replace(/-/g, "+").replace(/_/g, "/") + "===".slice((String(s).length + 3) % 4)); return Uint8Array.from(b, c => c.charCodeAt(0)); };
const unir = (...partes) => { const n = partes.reduce((a, p) => a + p.length, 0), r = new Uint8Array(n); let i = 0; for (const p of partes) { r.set(p, i); i += p.length; } return r; };
const txt = s => new TextEncoder().encode(s);
export const DESTINOS = ["admin", "tablet"];

let esquemaListo = false;
export async function asegurarEsquemaPush(env) {
  if (esquemaListo) return;
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS push_subs (endpoint TEXT PRIMARY KEY, p256dh TEXT NOT NULL, auth TEXT NOT NULL, destino TEXT NOT NULL,
      aparato TEXT, creado TEXT, actualizado TEXT, ultimo_ok TEXT, fallas INTEGER DEFAULT 0)`),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS push_config (id INTEGER PRIMARY KEY, publica TEXT NOT NULL, privada TEXT NOT NULL, creado TEXT)")
  ]);
  esquemaListo = true;
}

// Llaves VAPID: se crean una sola vez (INSERT OR IGNORE: si dos peticiones llegan juntas, gana la primera y ambas leen la misma)
async function llaves(env) {
  await asegurarEsquemaPush(env);
  let f = await env.DB.prepare("SELECT publica, privada FROM push_config WHERE id = 1").first();
  if (!f) {
    const k = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const publica = b64u(await crypto.subtle.exportKey("raw", k.publicKey));
    const privada = JSON.stringify(await crypto.subtle.exportKey("jwk", k.privateKey));
    await env.DB.prepare("INSERT OR IGNORE INTO push_config (id, publica, privada, creado) VALUES (1, ?, ?, ?)").bind(publica, privada, new Date().toISOString()).run();
    f = await env.DB.prepare("SELECT publica, privada FROM push_config WHERE id = 1").first();
  }
  return f;
}
export async function clavePublica(env) { return (await llaves(env)).publica; }

// Guardar (o renovar) la suscripción de un aparato
export async function suscribir(env, destino, sub, aparato) {
  if (!DESTINOS.includes(destino)) throw new Error("Destino inválido.");
  const endpoint = String(sub && sub.endpoint || ""), k = sub && sub.keys || {};
  if (!/^https:\/\/[^\s]{10,900}$/.test(endpoint)) throw new Error("Suscripción inválida.");
  let p, a;
  try { p = deB64u(k.p256dh); a = deB64u(k.auth); } catch { throw new Error("Suscripción inválida."); }
  if (p.length !== 65 || p[0] !== 4 || a.length !== 16) throw new Error("Suscripción inválida.");
  await asegurarEsquemaPush(env);
  const ahora = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO push_subs (endpoint, p256dh, auth, destino, aparato, creado, actualizado, fallas) VALUES (?, ?, ?, ?, ?, ?, ?, 0)
    ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth, destino = excluded.destino, aparato = excluded.aparato, actualizado = excluded.actualizado, fallas = 0`)
    .bind(endpoint, k.p256dh, k.auth, destino, String(aparato || "").slice(0, 120) || null, ahora, ahora).run();
}
export async function desuscribir(env, endpoint) {
  await asegurarEsquemaPush(env);
  await env.DB.prepare("DELETE FROM push_subs WHERE endpoint = ?").bind(String(endpoint || "")).run();
}
export async function aparatos(env, destino) {
  await asegurarEsquemaPush(env);
  return (await env.DB.prepare("SELECT aparato, creado, actualizado, ultimo_ok, fallas FROM push_subs WHERE destino = ? ORDER BY actualizado DESC").bind(destino).all()).results;
}

// ---- Cifrado del mensaje (RFC 8291, aes128gcm) ----
async function hkdf(sal, ikm, info, bytes) {
  const k = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: sal, info }, k, bytes * 8));
}
export async function cifrar(texto, p256dh, auth, { sal = crypto.getRandomValues(new Uint8Array(16)), efimera } = {}) {
  const uaPub = deB64u(p256dh), secreto = deB64u(auth);
  const par = efimera || await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPub = new Uint8Array(await crypto.subtle.exportKey("raw", par.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", uaPub, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const compartido = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, par.privateKey, 256));
  const ikm = await hkdf(secreto, compartido, unir(txt("WebPush: info\0"), uaPub, asPub), 32);
  const cek = await hkdf(sal, ikm, txt("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(sal, ikm, txt("Content-Encoding: nonce\0"), 12);
  const llave = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const cifrado = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, llave, unir(txt(texto), new Uint8Array([2]))));
  const rs = new Uint8Array([0, 0, 16, 0]); // 4096
  return unir(sal, rs, new Uint8Array([asPub.length]), asPub, cifrado);
}

// ---- Firma VAPID (RFC 8292) ----
export async function vapid(endpoint, publica, privadaJwk, ahora = Date.now()) {
  const aud = new URL(endpoint).origin;
  const cab = b64u(txt(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const cuerpo = b64u(txt(JSON.stringify({ aud, exp: Math.floor(ahora / 1000) + 12 * 3600, sub: "mailto:administracion@basculaypension.com" })));
  const k = await crypto.subtle.importKey("jwk", typeof privadaJwk === "string" ? JSON.parse(privadaJwk) : privadaJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const firma = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, k, txt(cab + "." + cuerpo));
  return `vapid t=${cab}.${cuerpo}.${b64u(firma)}, k=${publica}`;
}

// Los push de tablet llegan al aparato compartido, no a una identidad autenticada.
// Blindaje central: ningún módulo puede poner su contenido privado en el aviso del sistema.
export function datosPush(destino, msg = {}) {
  const tablet = destino === "tablet";
  return {
    titulo: tablet ? (msg.grave ? "Actividad importante en El Castaño" : "Nueva actividad en El Castaño") : String(msg.titulo || "El Castaño").slice(0, 120),
    cuerpo: tablet ? "Abre la tableta con tu PIN para consultar novedades." : String(msg.cuerpo || "").slice(0, 400),
    url: msg.url || (tablet ? "/turno" : "/panel"),
    etiqueta: msg.etiqueta || null, grave: !!msg.grave, sec: msg.sec || null
  };
}

// Mensaje: { titulo, cuerpo, url, etiqueta, grave }. Devuelve cuántos aparatos lo recibieron.
export async function enviarPush(env, destino, msg) {
  await asegurarEsquemaPush(env);
  const subs = (await env.DB.prepare("SELECT * FROM push_subs WHERE destino = ?").bind(destino).all()).results;
  if (!subs.length) return 0;
  const { publica, privada } = await llaves(env);
  const datos = JSON.stringify(datosPush(destino, msg));
  let ok = 0;
  const ahora = new Date().toISOString();
  await Promise.all(subs.map(async s => {
    try {
      const r = await fetch(s.endpoint, {
        method: "POST",
        headers: { Authorization: await vapid(s.endpoint, publica, privada), "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream", TTL: String(msg.ttl || 86400), Urgency: msg.grave ? "high" : "normal" },
        body: await cifrar(datos, s.p256dh, s.auth),
        signal: AbortSignal.timeout(8000)
      });
      if (r.ok) { ok++; await env.DB.prepare("UPDATE push_subs SET ultimo_ok = ?, fallas = 0 WHERE endpoint = ?").bind(ahora, s.endpoint).run(); }
      // 404/410: el aparato ya no existe (se desinstaló o se borraron los datos del navegador)
      else if (r.status === 404 || r.status === 410) await env.DB.prepare("DELETE FROM push_subs WHERE endpoint = ?").bind(s.endpoint).run();
      else { console.error("push", r.status, (await r.text()).slice(0, 200)); await env.DB.prepare("UPDATE push_subs SET fallas = COALESCE(fallas, 0) + 1 WHERE endpoint = ?").bind(s.endpoint).run(); }
    } catch (e) { console.error("push", e && e.message); }
  }));
  return ok;
}

// Código del service worker que muestra la notificación y, al tocarla, abre la sección (base: "/panel" o "/turno").
// Si la app ya está abierta, le avisa para que recargue los datos.
export const swPush = base => `
self.addEventListener("push", e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { cuerpo: e.data ? e.data.text() : "" }; }
  const titulo = d.titulo || "El Castaño";
  e.waitUntil(Promise.all([
    self.registration.showNotification(titulo, {
      body: d.cuerpo || "", icon: "/img/turno-192.png", badge: "/img/badge-96.png", lang: "es-MX",
      tag: d.etiqueta || undefined, renotify: !!d.etiqueta, requireInteraction: !!d.grave,
      vibrate: d.grave ? [600, 200, 600, 200, 600, 200, 600] : [250, 120, 250],
      data: { url: d.url || ${JSON.stringify(base)}, sec: d.sec || null }
    }),
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(l => l.forEach(c => c.postMessage({ tipo: "push", sec: d.sec || null })))
  ]));
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const d = e.notification.data || {};
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(l => {
    const c = l.find(x => new URL(x.url).pathname.startsWith(${JSON.stringify(base)}));
    if (c) { c.postMessage({ tipo: "abrir", sec: d.sec || null }); return c.focus(); }
    return self.clients.openWindow(d.url || ${JSON.stringify(base)});
  }));
});`;

// Para las rutas: manda en segundo plano (si hay ctx) sin retrasar la respuesta; nunca lanza error.
export function notificar(env, destino, msg) {
  const p = enviarPush(env, destino, msg).catch(e => console.error("push", e && e.message));
  if (env && typeof env.enFondo === "function") { env.enFondo(p); return Promise.resolve(); }
  return p;
}
