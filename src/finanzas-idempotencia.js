// Idempotencia de movimientos que alteran saldos: retry de un mismo formulario
// conserva el ID, incluso tras un error de red. No guarda datos sensibles.
// Los clientes antiguos sin uid siguen admitidos; deben actualizarse para tener protección.
export async function idFinanciero(tipo, uid, usuario, referencia = "") {
  if (uid == null || uid === "") return crypto.randomUUID();
  if (typeof uid !== "string" || !/^[a-z0-9-]{8,64}$/i.test(uid))
    throw new Error("Identificador de operación inválido.");
  const texto = ["finanzas", tipo, String(usuario || "admin").toLowerCase(), referencia, uid].join(":");
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto));
  const h = [...new Uint8Array(hash).slice(0, 16)].map(x => x.toString(16).padStart(2, "0")).join("");
  return h.slice(0, 8)+"-"+h.slice(8,12)+"-"+h.slice(12,16)+"-"+h.slice(16,20)+"-"+h.slice(20,32);
}

// Monto monetario equivalente al centavo; solo comparar datos guardados contra un retry.
export const centavosIguales = (a,b) =>
  Number.isFinite(Number(a)) && Number.isFinite(Number(b)) &&
  Math.round(Number(a) * 100) === Math.round(Number(b) * 100);
