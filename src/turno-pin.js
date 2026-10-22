// PIN de Turno: hash PBKDF2, compatibilidad de versiones y comparación constante.
// Sin acceso a D1, KV, cookies ni sesiones; no registra secretos.
export function crearPinTurno({ enc, hex, crypto }) {
const ITER_V3 = 100000;
async function derivar(pin, sal, iteraciones) {
  const llave = await crypto.subtle.importKey("raw", enc.encode(pin), "PBKDF2", false, ["deriveBits"]);
  return hex(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: enc.encode(sal), iterations: iteraciones }, llave, 256));
}
const hashPin = async (pin, sal) => "v3$" + await derivar(pin, sal, ITER_V3);
const pinViejo = guardado => !String(guardado || "").startsWith("v3$");
async function pinCorrecto(pin, sal, guardado) {
  if (!guardado) return false;
  const calculado = guardado.startsWith("v3$") ? await hashPin(pin, sal)
    : guardado.startsWith("v2$") ? "v2$" + await derivar(pin, sal, 2000)
    : await derivar(pin, sal, 20000);
  return igual(calculado, guardado);
}
function igual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
  return { derivar, hashPin, pinViejo, pinCorrecto, igual };
}
