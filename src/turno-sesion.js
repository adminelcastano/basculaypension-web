// Sesiones firmadas de Turno; sin estado de usuario global ni divulgación de tokens.
// Las validaciones JWT/Cloudflare Access siguen a cargo del Worker antes de llegar aquí.
export function crearSesionesTurno({ crypto, enc, hex, b64u, deB64u, SESION_HORAS, igual, TURNOS, avatarValido, AVATARES, urlAvatar, leerPrefs }) {
let secretoCache = null;
async function secreto(env) {
  if (secretoCache) return secretoCache;
  let s = await env.FILES.get("turno:secreto");
  if (!s) { s = hex(crypto.getRandomValues(new Uint8Array(32))); await env.FILES.put("turno:secreto", s); }
  return (secretoCache = s);
}
async function firmar(env, datos) {
  const llave = await crypto.subtle.importKey("raw", enc.encode(await secreto(env)), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", llave, enc.encode(datos)));
}
async function crearSesion(env, persona, turno, dia) {
  // La sal del PIN va en la sesión: si se cambia el PIN, las sesiones abiertas dejan de valer
  const datos = b64u(JSON.stringify({ p: persona.clave, t: turno, d: dia, s: persona.pin_sal.slice(0, 8), g: persona.ses_gen || 0, e: Date.now() + SESION_HORAS * 3600e3 }));
  return datos + "." + await firmar(env, datos);
}
function leerCookie(cab, nombre) {
  for (const p of (cab || "").split(/;\s*/)) { const i = p.indexOf("="); if (i > 0 && p.slice(0, i) === nombre) return p.slice(i + 1); }
  return "";
}
async function sesionActual(request, env) {
  const v = leerCookie(request.headers.get("Cookie"), "turno_ses");
  const [datos, firma] = v.split(".");
  if (!datos || !firma || !igual(firma, await firmar(env, datos))) return null;
  let s; try { s = JSON.parse(deB64u(datos)); } catch { return null; }
  if (!s.e || s.e < Date.now() || !TURNOS.includes(s.t)) return null;
  const persona = await env.DB.prepare("SELECT clave, nombre, pin_sal, activo, avatar, avatar_base, foto_ver, prefs, ses_gen FROM turno_personas WHERE clave = ?").bind(s.p).first();
  if (!persona || !persona.activo || !persona.pin_sal || persona.pin_sal.slice(0, 8) !== s.s) return null;
  if ((s.g || 0) !== (persona.ses_gen || 0)) return null;
  return { persona: persona.clave, nombre: persona.nombre || persona.clave, avatar: avatarValido(persona.avatar), avatar_base: Object.hasOwn(AVATARES, persona.avatar_base) ? persona.avatar_base : null, avatar_url: urlAvatar(persona), tiene_foto: !!persona.foto_ver, prefs: leerPrefs(persona.prefs), turno: s.t, dia: s.d };
}
const cookie = (valor, maxAge) => `turno_ses=${valor}; Path=/turno; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;

  return { secreto, firmar, crearSesion, leerCookie, sesionActual, cookie };
}
