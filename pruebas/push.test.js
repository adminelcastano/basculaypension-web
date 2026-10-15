// Notificaciones push: el mensaje cifrado se puede descifrar como lo hace el navegador y la firma VAPID es válida
import { test } from "node:test";
import assert from "node:assert/strict";
import { cifrar, vapid } from "../src/push.js";

const b64u = b => Buffer.from(b).toString("base64url");
const deB64u = s => new Uint8Array(Buffer.from(s, "base64url"));
const enc = s => new TextEncoder().encode(s);
async function hkdf(sal, ikm, info, n) {
  const k = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: sal, info }, k, n * 8));
}

test("cifrado aes128gcm (RFC 8291): el navegador lo descifra", async () => {
  // El "navegador": su par de llaves y su secreto
  const ua = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const uaPub = new Uint8Array(await crypto.subtle.exportKey("raw", ua.publicKey));
  const auth = crypto.getRandomValues(new Uint8Array(16));
  const mensaje = JSON.stringify({ titulo: "Incidencia grave", cuerpo: "Falla en la pluma de salida — ñ ✓" });
  const cuerpo = await cifrar(mensaje, b64u(uaPub), b64u(auth));

  // Descifrar como el navegador
  const sal = cuerpo.slice(0, 16), rs = new DataView(cuerpo.buffer, cuerpo.byteOffset + 16, 4).getUint32(0), idlen = cuerpo[20];
  assert.equal(rs, 4096);
  assert.equal(idlen, 65);
  const asPub = cuerpo.slice(21, 21 + idlen), datos = cuerpo.slice(21 + idlen);
  const asKey = await crypto.subtle.importKey("raw", asPub, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const compartido = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: asKey }, ua.privateKey, 256));
  const info = new Uint8Array([...enc("WebPush: info\0"), ...uaPub, ...asPub]);
  const ikm = await hkdf(auth, compartido, info, 32);
  const cek = await hkdf(sal, ikm, enc("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(sal, ikm, enc("Content-Encoding: nonce\0"), 12);
  const k = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]);
  const claro = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, k, datos));
  assert.equal(claro[claro.length - 1], 2); // delimitador del último registro
  assert.equal(new TextDecoder().decode(claro.slice(0, -1)), mensaje);
});

test("firma VAPID (RFC 8292): JWT ES256 válido para el servicio de push", async () => {
  const par = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const publica = b64u(await crypto.subtle.exportKey("raw", par.publicKey));
  const jwk = await crypto.subtle.exportKey("jwk", par.privateKey);
  const h = await vapid("https://fcm.googleapis.com/fcm/send/abc:123", publica, jwk, Date.UTC(2026, 9, 15));
  const m = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(h);
  assert.ok(m, h);
  assert.equal(m[4], publica);
  const claims = JSON.parse(Buffer.from(m[2], "base64url").toString());
  assert.equal(claims.aud, "https://fcm.googleapis.com");
  assert.equal(claims.exp, Date.UTC(2026, 9, 15) / 1000 + 12 * 3600);
  assert.match(claims.sub, /^mailto:/);
  const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, par.publicKey, deB64u(m[3]), enc(m[1] + "." + m[2]));
  assert.ok(ok);
});
