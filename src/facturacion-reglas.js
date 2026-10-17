// Reglas puras de verificación de solicitudes, sin acceso a bases ni servicios externos.
// El folio operativo es numérico, incluidos los ceros iniciales.
// Se admiten espacios y guiones visuales; no se altera el número al normalizar.
// Se distingue además por servicio (báscula / pensión).
export function normalizarFolioTicket(folio) {
  return String(folio ?? "").trim().replace(/[\s-]+/g, "").toUpperCase().slice(0, 40);
}
export function folioTicketValido(folio) {
  return /^\d{1,40}$/.test(normalizarFolioTicket(folio));
}
export function claveTicket(servicio, folio) {
  return String(servicio || "").trim().toLowerCase() + ":" + normalizarFolioTicket(folio);
}
export function mismaOperacion(a, b) {
  return !!normalizarFolioTicket(a?.folio_ticket) && claveTicket(a?.servicio, a?.folio_ticket) === claveTicket(b?.servicio, b?.folio_ticket);
}
export function faltantesParaFacturar(s, catalogos) {
  const errores = [];
  const rfc = String(s.rfc || "").trim().toUpperCase();
  const nombre = String(s.nombre || "").trim();
  const cp = String(s.cp || "").trim();
  if (!/^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/.test(rfc)) errores.push("RFC válido");
  if (nombre.length < 3) errores.push("nombre o razón social");
  if (!/^\d{5}$/.test(cp)) errores.push("código postal fiscal");
  if (!catalogos.regimenes?.[s.regimen]) errores.push("régimen fiscal");
  if (!catalogos.usos?.[s.uso]) errores.push("uso del CFDI");
  if (!folioTicketValido(s.folio_ticket)) errores.push("folio numérico del ticket verificado");
  return errores;
}
