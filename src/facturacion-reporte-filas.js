import { REGIMENES, USOS, SERVICIOS, FORMAS_PAGO } from "./catalogos.js";
export const ENCABEZADOS = ["Folio solicitud", "Recibida", "Estado", "Servicio", "Folio ticket", "Cliente en ticket", "Placas", "Descripción auto", "Tarifa", "Anotación a mano", "RFC", "Nombre o razón social", "Código postal", "Régimen fiscal", "Uso CFDI", "Forma de pago", "Correo", "WhatsApp", "Importe", "Folio factura", "Fecha resolución", "Fecha entrega manual", "Motivo rechazo", "Versión aviso de privacidad"];
export function filasExcel(results) {
  const local = iso => iso ? new Date(new Date(iso).getTime() - 6 * 3600e3).toISOString().slice(0, 16).replace("T", " ") : "";
  const est = { pendiente: "Recibida", en_revision: "En revisión", facturada: "Facturada", enviada: "Enviada al cliente", rechazada: "Rechazada", cancelada: "CFDI cancelado" };
  const filas = [ENCABEZADOS];
  for (const r of results) {
    filas.push([r.folio, local(r.creado), est[r.estado] || r.estado, SERVICIOS[r.servicio] || r.servicio || "", r.folio_ticket || "", r.cliente || "",
      r.placas || "", r.descripcion || "", r.tarifa || "", r.anotacion || "",
      r.rfc || "", r.nombre || "", r.cp || "", r.regimen ? `${r.regimen} ${REGIMENES[r.regimen] || ""}` : "",
      r.uso ? `${r.uso} ${USOS[r.uso] || ""}` : "", r.forma_pago ? `${r.forma_pago} ${FORMAS_PAGO[r.forma_pago] || ""}` : "", r.email || "", r.telefono || "", r.importe ? "$" + Number(r.importe).toLocaleString("es-MX", { minimumFractionDigits: 2 }) : "", r.folio_factura || "", local(r.resuelta_en), local(r.enviada_en), r.motivo || "", r.aviso_version || ""]);
  }
  return filas;
}

