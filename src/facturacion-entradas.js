// Facturación: lectura y validación de entradas, sin D1/KV ni red externa.
export const MAX_ARCHIVO = 10 * 1024 * 1024;
// Acepta "350", "$1,250.50", "1250,5" y devuelve "1250.50"; null si no es válido
export function normalizarImporte(v) {
  let t = String(v ?? "").trim().replace(/[$\s]|MXN/gi, "");
  if (!t) return "";
  if (/^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(t)) t = t.replace(/,/g, "");
  else if (/^\d+,\d{1,2}$/.test(t)) t = t.replace(",", ".");
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(t)) return null;
  return Number(t).toFixed(2);
}

export function texto(form, nombre) {
  const v = form.get(nombre);
  return typeof v === "string" ? v.trim() : "";
}
export function archivo(form, nombre) {
  const v = form.get(nombre);
  return v && typeof v === "object" && typeof v.arrayBuffer === "function" && v.size > 0 ? v : null;
}
// La firma real evita rechazar fotos móviles sin MIME y aceptar un archivo disfrazado.
export async function tipoArchivo(f) {
  if (!f) return null;
  const a = new Uint8Array(await f.slice(0, 1024).arrayBuffer());
  const ascii = (i, j) => String.fromCharCode(...a.slice(i, j));
  if (a.length >= 3 && a[0] === 255 && a[1] === 216 && a[2] === 255) return "image/jpeg";
  if (a.length >= 8 && a.slice(0, 8).every((v, i) => v === [137, 80, 78, 71, 13, 10, 26, 10][i])) return "image/png";
  if (a.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  if (a.length >= 5 && ascii(0, 1024).includes("%PDF-")) return "application/pdf";
  if (a.length >= 12 && ascii(4, 8) === "ftyp" && /^(heic|heix|hevc|hevx|heim|heis|hevm|hevs|mif1|msf1)$/.test(ascii(8, 12))) return "image/heic";
  return null;
}
export function validarArchivo(f, tipo, requerido, que) {
  if (!f) return requerido ? "Adjunta " + que + "." : null;
  if (f.size > MAX_ARCHIVO) return "El archivo de " + que + " pesa más de 10 MB.";
  if (!tipo) return "Para " + que + " usa JPG, PNG, WebP, HEIC o PDF válido.";
  return null;
}
export function crearFolio() {
  const fecha = new Date(Date.now() - 6 * 3600 * 1000).toISOString().slice(2, 10).replace(/-/g, "");
  const letras = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const rnd = crypto.getRandomValues(new Uint8Array(4));
  let s = "";
  for (const b of rnd) s += letras[b % letras.length];
  return `EC-${fecha}-${s}`;
}

