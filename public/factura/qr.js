// Contrato QR G7 validado únicamente con comprobantes QA sintéticos entregados
// por el proyecto de báscula/pensión. No confiere prueba de pago ni CFDI.
(() => {
  "use strict";
  const FORMATO_QA = "G7-SYNTHETIC-EXIT-1";
  const HOSTS = new Set(["basculaypension.com", "www.basculaypension.com"]);
  const CONTROLES = /[\u0000-\u001f\u007f]/g;
  const limpiar = (v, largo) => String(v || "").replace(CONTROLES, " ").replace(/\s+/g, " ").trim().slice(0, largo);
  const dinero = v => {
    const s = String(v || "").trim();
    return /^(?:0|[1-9]\d{0,6})\.\d{2}$/.test(s) ? s : null;
  };
  const folioValido = v => /^(?:\d{1,40}|A\d{1,39})$/.test(v);
  const salirse = mensaje => ({ ok: false, error: mensaje });
  const campo = (q, k) => {
    const todos = q.getAll(k);
    return todos.length === 1 ? todos[0] : null;
  };
  function leerUrlQR(raw) {
    if (typeof raw !== "string" || raw.length > 4096) return salirse("El enlace QR es demasiado largo.");
    let u;
    try { u = new URL(raw); } catch { return salirse("No se pudo leer la dirección del QR."); }
    if (u.protocol !== "https:" || !HOSTS.has(u.hostname) || u.port ||
        !["/factura", "/factura/"].includes(u.pathname) || u.username || u.password)
      return salirse("El enlace no corresponde al formulario oficial de facturación.");
    const q = u.searchParams;
    if (![...q.keys()].some(k => ["MODULO","FOLIO","FORMATO","IMPORTE TOTAL","TARIFA","PAGOS"].includes(k)))
      return { ok:false, sinQr:true };
    const formato=campo(q,"FORMATO"),modulo=campo(q,"MODULO"),folio=limpiar(campo(q,"FOLIO"),40).toUpperCase();
    if (formato !== FORMATO_QA)
      return salirse("Este formato QR aún no está validado. Continúa con la foto del ticket.");
    if (!["BASCULA","PENSION"].includes(modulo) || !folioValido(folio))
      return salirse("El código contiene un servicio o folio no válido.");
    if (modulo === "PENSION" && !/^\d{1,40}$/.test(folio))
      return salirse("El folio de pensión debe ser numérico.");
    const importe = dinero(campo(q,"IMPORTE TOTAL"));
    const tarifa = dinero(campo(q,"TARIFA"));
    if (!importe || Number(importe) <= 0 || !tarifa)
      return salirse("El código contiene importes no válidos.");
    const placa = limpiar(campo(q,"MATRICULA"),24).toUpperCase();
    const cliente = limpiar(campo(q,"CLIENTE"),100);
    if (placa && !/^[A-Z0-9 -]{1,24}$/.test(placa))
      return salirse("La matrícula del QR no tiene un formato válido.");
    if (q.has("PAGOS") && campo(q,"PAGOS") === null)
      return salirse("El QR contiene datos duplicados de pagos.");
    return {ok:true, servicio:modulo === "BASCULA" ? "bascula" : "pension",
      folio, matricula:placa, cliente, importe, tarifa, formato, sintetico:true,
      // IMPORTANTE: PAGOS se ignora porque los ejemplos impresos no concuerdan
      // necesariamente con el saldo pendiente de la operación.
      pagoConfirmado:false};
  }
  function notaRevision(qr) {
    if (!qr || !qr.ok) return "";
    return [
      "QR informativo SIN VERIFICAR (" + qr.formato + ")",
      "Servicio: " + qr.servicio,
      "Folio: " + qr.folio,
      qr.matricula ? "Matrícula: " + qr.matricula : "",
      qr.cliente ? "Cliente del ticket: " + qr.cliente : "",
      "Tarifa: $" + qr.tarifa,
      "Importe declarado: $" + qr.importe,
      "PAGO NO ACREDITADO: revisar ticket y cobranza."
    ].filter(Boolean).join(" | ");
  }
  // Sólo en memoria, no se guardan URL completas, parámetros QA ni IDs externos.
  window.CastaTicketQR = Object.freeze({ leerUrlQR, notaRevision, FORMATO_QA });
})();
