/**
 * Ingresos de la báscula y la pensión para el panel de basculaypension.com
 *
 * Va pegado en la hoja "BASCULA Y PENSION 2026" (Extensiones → Apps Script) y se publica
 * como aplicación web. El panel lo consulta cada 10 minutos y solo recibe, del mes que pide,
 * estas columnas:
 *   FORBAS: Marca temporal, FOLIO, MATRICULA, CLIENTE, IMPORTE (tarifa), FORMA DE PAGO, TURNO
 *   FORPEN: Marca temporal, FOLIO, MATRICULA, LINEA Y No ECONOMICO (cliente),
 *           CANTIDAD DE $ RECIBIDA EN ESTE REGISTRO, METODO DE PAGO, TURNO
 * No envía teléfonos, identificaciones ni otras columnas.
 *
 * Cambia CLAVE por la misma clave que se guarda en Cloudflare como INGRESOS_TOKEN.
 */
const CLAVE = "PEGA_AQUI_LA_CLAVE";
const ZONA = "America/Mexico_City";
// ID de la hoja "BASCULA Y PENSION 2026" (está en su enlace, entre /d/ y /edit)
const HOJA_ID = "11f1UfV4O4D6IDFlLdJodsTtfSSvxZ-yHst65ObadSjA";

const HOJAS = {
  bascula: { nombre: "FORBAS", cols: { fecha: "MARCA TEMPORAL", folio: "FOLIO", matricula: "MATRICULA", cliente: "CLIENTE", importe: "IMPORTE", forma: "FORMA DE PAGO", turno: "TURNO" } },
  pension: { nombre: "FORPEN", cols: { fecha: "MARCA TEMPORAL", folio: "FOLIO", matricula: "MATRICULA", cliente: "LINEA Y NO ECONOMICO", importe: "CANTIDAD DE $ RECIBIDA EN ESTE REGISTRO", forma: "METODO DE PAGO", turno: "TURNO" } }
};

function doGet(e) {
  const p = (e && e.parameter) || {};
  if (!CLAVE || CLAVE === "PEGA_AQUI_LA_CLAVE" || p.token !== CLAVE) return salida({ ok: false, error: "no autorizado" });
  const mes = /^\d{4}-\d{2}$/.test(p.mes || "") ? p.mes : Utilities.formatDate(new Date(), ZONA, "yyyy-MM");
  // Funciona pegado dentro de la hoja o como proyecto aparte
  const libro = SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.openById(HOJA_ID);
  const res = { ok: true, mes: mes };
  for (const clave in HOJAS) {
    const hoja = buscarHoja(libro, HOJAS[clave].nombre);
    if (!hoja) return salida({ ok: false, error: "No existe la pestaña " + HOJAS[clave].nombre });
    res[clave] = leer(hoja, HOJAS[clave].cols, mes);
    if (res[clave].error) return salida({ ok: false, error: res[clave].error });
  }
  return salida(res);
}

function buscarHoja(libro, nombre) {
  const n = normalizar(nombre);
  return libro.getSheets().filter(function (h) { return normalizar(h.getName()) === n; })[0] || null;
}

function leer(hoja, cols, mes) {
  const datos = hoja.getDataRange().getValues();
  if (!datos.length) return [];
  const encabezado = datos[0].map(normalizar);
  const idx = {};
  for (const k in cols) {
    idx[k] = encabezado.indexOf(normalizar(cols[k]));
    if (idx[k] < 0) return { error: "Falta la columna " + cols[k] + " en " + hoja.getName() };
  }
  const salidaFilas = [];
  for (let i = 1; i < datos.length; i++) {
    const f = datos[i];
    const marca = f[idx.fecha];
    if (!(marca instanceof Date) || isNaN(marca.getTime())) {
      // Una fila con importe/folio y sin fecha legible no es un ticket borrado:
      // detener la lectura antes de que el panel reconcilie y elimine movimientos.
      const movimiento = ["folio", "importe"].some(k => f[idx[k]] !== "" && f[idx[k]] != null);
      if (movimiento) return { error: "Fecha inválida en " + hoja.getName() + " (fila " + (i + 1) + "); no se sincronizó." };
      continue;
    }
    const fecha = Utilities.formatDate(marca, ZONA, "yyyy-MM-dd'T'HH:mm:ss");
    if (fecha.slice(0, 7) !== mes) continue;
    salidaFilas.push({
      fecha: fecha,
      folio: String(f[idx.folio]),
      matricula: String(f[idx.matricula]),
      cliente: String(f[idx.cliente]),
      importe: f[idx.importe] === "" ? 0 : f[idx.importe], // Conservar cifras y texto (MENOS, $, comas) para el parser de Caja
      forma: String(f[idx.forma]),
      turno: String(f[idx.turno])
    });
  }
  return salidaFilas;
}

function normalizar(t) {
  return String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim();
}

function salida(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// Para probar desde el editor: muestra cuántos registros hay este mes
function probar() {
  const r = JSON.parse(doGet({ parameter: { token: CLAVE } }).getContent());
  Logger.log(r.ok ? ("Báscula: " + r.bascula.length + " · Pensión: " + r.pension.length) : r.error);
}
