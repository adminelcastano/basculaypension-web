import { leerArchivo, borrarArchivo } from "./fotos.js";
import { asegurarEsquemaCategorias, resolverCategoria, adivinarCategoria, listaCategorias } from "./categorias.js";
import { asegurarEsquemaCuentas, cuentaDefecto } from "./cuentas.js";
import { idFinanciero, centavosIguales } from "./finanzas-idempotencia.js";
import { asegurarEsquemaBitacora, stmtBitacora, stmtBitacoraSiCambio } from "./bitacora.js";
// Turnos: ingresos y gastos de caja por corte de turno.
// Los ingresos vienen de la hoja de Google (pestañas FORBAS y FORPEN) por medio del script
// herramientas/ingresos-hoja.gs. Solo se guarda el mes actual; al cambiar de mes se envía
// los reportes en Google Sheets (Turnos, Finanzas y Facturación) y se borra lo de hace más de 13 meses.

const TZ = "America/Mexico_City";
const fechaCalendarioCaja = d => /^\d{4}-\d{2}-\d{2}$/.test(String(d || "")) &&
  Number.isFinite(Date.parse(d + "T12:00:00Z")) &&
  new Date(d + "T12:00:00Z").toISOString().slice(0, 10) === d;
export const TURNOS = ["MAÑANA", "TARDE", "NOCHE"];
// Horario de cada turno (horas desde el inicio del día del corte)
const VENTANA = { "MAÑANA": [6, 14], "TARDE": [14, 22], "NOCHE": [22, 30] };
// Solo estas formas de pago suman en el corte
export const FORMAS_CONTADAS = ["EFECTIVO", "TARJETA"];
const FORMAS_GASTO = ["EFECTIVO", "TARJETA", "TRANSFERENCIA"];
// Ingresos extra (efectivo que entra a la caja sin ticket): rentas de locales, dinero que pone la
// administración para aumentar el cambio, etc. Todos suman al efectivo del turno; el "Aumento de cambio"
// no cuenta como ingreso del negocio.
export const CONCEPTOS_EXTRA = ["Renta", "Aumento de cambio", "Otro ingreso"];
export const cuentaComoIngreso = concepto => concepto !== "Aumento de cambio";
 
// Aporte de Administración hecho AL INICIAR un turno. ID fijo: una corrección o reenvío
// offline modifica el mismo movimiento; nunca crea una segunda entrada de efectivo.
export const idAumentoInicio = (dia, turno) => "inicio-aumento:" + dia + ":" + turno;
export const totalCambioInicio = (recibido, aumento = 0) =>
  (Math.round(Number(recibido) * 100) + Math.round(Number(aumento) * 100)) / 100;

// Recibido es SOLO lo que se contó del turno anterior; aumento es dinero nuevo
// desde los sobres. El recibido va en turno_inicio y el aporte en caja_extra
// (ingreso=0), aprovechando los cálculos actuales de Caja y Finanzas.
export async function guardarCambioInicio(env, { dia, turno, persona, recibido, aumento }, ahora = new Date().toISOString()) {
  const mes = dia.slice(0, 7), id = idAumentoInicio(dia, turno);
  const [anterior, extra] = await Promise.all([
    env.DB.prepare("SELECT cambio, persona FROM turno_inicio WHERE dia = ? AND turno = ?").bind(dia, turno).first(),
    env.DB.prepare("SELECT monto, concepto, ingreso FROM caja_extra WHERE id = ?").bind(id).first()
  ]);
  if (extra && (extra.concepto !== "Aumento de cambio" || Number(extra.ingreso) !== 0))
    throw new Error("El movimiento de aumento de cambio no corresponde al inicio del turno.");
  const cambio = !anterior || Number(anterior.cambio) !== recibido || anterior.persona !== persona
    || Number(extra && extra.monto || 0) !== aumento;
  const sentencias = [
    env.DB.prepare(`INSERT INTO turno_inicio (dia, turno, mes, persona, cambio, creado, actualizado)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (dia, turno) DO UPDATE SET persona = excluded.persona,
        cambio = excluded.cambio, actualizado = excluded.actualizado`)
      .bind(dia, turno, mes, persona, recibido, ahora, ahora)
  ];
  if (aumento > 0) {
    sentencias.push(env.DB.prepare(`INSERT INTO caja_extra
      (id, mes, dia, turno, concepto, detalle, monto, ingreso, foto, persona, creado, creado_por)
      VALUES (?, ?, ?, ?, 'Aumento de cambio', 'Aporte al iniciar turno', ?, 0, NULL, ?, ?, ?)
      ON CONFLICT (id) DO UPDATE SET monto = excluded.monto, persona = excluded.persona`)
      .bind(id, mes, dia, turno, aumento, persona, ahora, "tablet:" + persona));
  } else if (extra) {
    // Exclusivamente el registro automático propio; los aumentos manuales se conservan.
    sentencias.push(env.DB.prepare("DELETE FROM caja_extra WHERE id = ? AND concepto = 'Aumento de cambio' AND ingreso = 0")
      .bind(id));
  }
  if (cambio) sentencias.push(stmtBitacora(env, {
    quien: "tablet:" + persona, accion: anterior ? "editar" : "crear",
    que: "Cambio al inicio de turno", ref: dia + "|" + turno, mes,
    detalle: { antes: anterior ? { recibido: anterior.cambio, aumento: Number(extra && extra.monto || 0) } : null,
      recibido, aumento, total: totalCambioInicio(recibido, aumento) }
  }));
  // D1.batch es transaccional: no puede guardarse el recibido sin el aporte ni viceversa.
  await env.DB.batch(sentencias);
  return { cambio: recibido, aumento, total: totalCambioInicio(recibido, aumento), persona, actualizado: ahora };
}

// Cambio inicial (fondo de cambio): movimiento de caja que dice CAMBIO o FONDO en el folio, cliente,
// matrícula o forma de pago. Siempre es efectivo, aunque la forma de pago venga vacía o diga otra cosa.
// Un aporte de sobres a media jornada NO es el fondo recibido al inicio,
// aunque su folio contenga la palabra "CAMBIO". Lo mismo aplica a los
// movimientos provenientes de la hoja que dicen "SE AGREGÓ AL CAMBIO".
const esAporteHoja = m => m.tipo === "caja" && Number(m.importe) > 0 &&
  /\bADM|AGREG|AUMENT/.test([m.folio, m.cliente, m.matricula]
    .map(x => String(x || "")).join(" ").toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""));
export const esCambio = m => m.tipo === "caja" && !esAporteHoja(m) &&
  /\b(CAMBIO|FONDO)\b/.test([m.folio, m.cliente, m.matricula, m.forma]
    .map(x => String(x || "")).join(" ").toUpperCase().normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "").replace(/CAMBI0/g, "CAMBIO")
    .replace(/F0ND0|F0NDO|FOND0/g, "FONDO"));

// Renglones de caja de la hoja (sin folio de ticket), según quién se queda con el dinero:
//   "cambio"  → cambio inicial (no es movimiento)
//   "a_admin" → la administración tomó efectivo de la caja antes del corte (SE LLEVÓ, RETIRO): entra a los sobres
//   "de_admin"→ la administración puso efectivo en la caja (INGRESO DE ADM, SE AGREGÓ AL CAMBIO): sale de los sobres
//   "gasto"   → salió de la caja para pagar algo (TIENDA, GARRAFÓN, SUELDO…): egreso del negocio
//   "ingreso" → otro efectivo que entró a la caja sin ticket: ingreso del negocio
const sinAcento = t => String(t || "").toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
export function claseHoja(m) {
  if (m.tipo !== "caja") return null;
  const t = sinAcento([m.folio, m.cliente, m.matricula].join(" "));
  // "SE AGREGÓ AL CAMBIO": la administración puso dinero (aunque diga CAMBIO, sale de los sobres)
  if (esAporteHoja(m)) return "de_admin";
  if (esCambio(m)) return "cambio";
  if (!m.importe) return null;
  if (m.importe < 0) return /SE LLEV|\bLLEVO\b|\bRETIR|\bADMIN|\bADM\b/.test(t) ? "a_admin" : "gasto";
  return /\bADM|AGREG|AUMENT/.test(t) ? "de_admin" : "ingreso";
}
export const conceptoHoja = m => [m.folio, m.cliente].map(x => String(x || "").trim()).filter((x, i, l) => x && !/^(0|S|SN|N\/?A)$/i.test(x) && (i === 0 || !l[0].toUpperCase().includes(x.toUpperCase()))).join(" · ") || "Movimiento de caja";

// Tickets pagados por transferencia en la hoja (FORBAS/FORPEN): suman a los ingresos y entran al banco.
// Si también se capturó la transferencia a mano en Finanzas, se liga al ticket (ticket_ref) para no contarla dos veces.
export const esTransf = f => String(f || "").startsWith("TRANSF");
export const refTicket = m => `${m.servicio}:${String(m.folio || "").trim()}`;

const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });

// Meses con datos abiertos en el panel: el actual y, mientras no se cierre, el anterior.
// El cierre espera a que termine el turno de noche del último día (7:00 del día 1), así ese
// turno no se parte en dos meses: todo se guarda con el mes del DÍA DEL CORTE, no de la hora de captura.
export async function mesesAbiertos(env) {
  const actual = mesActual(), g = await env.FILES.get("caja:mes");
  return g && g < actual ? [g, actual] : [actual];
}
export function mesActual(ahora = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit" }).format(ahora).slice(0, 7);
}
export function sumarMesesCaja(mes, n) {
  const [a, m] = mes.split("-").map(Number), t = a * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}
function mesAnterior(mes) {
  const [a, m] = mes.split("-").map(Number);
  return m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, "0")}`;
}
const sumaDias = (dia, n) => { const d = new Date(dia + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

// Día del corte: el día cuyo horario de ese turno queda más cerca de la hora del registro.
// Ej.: NOCHE a las 02:00 del 14 → corte de la noche del 13.
export function diaDelCorte(fechaLocal, turno) {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(fechaLocal || "");
  if (!m) return null;
  const dia = m[1], h = Number(m[2]) + Number(m[3]) / 60;
  const v = VENTANA[turno];
  if (!v) return dia;
  let mejor = dia, dist = Infinity;
  for (const k of [-1, 0, 1]) {
    const ini = v[0] + 24 * k, fin = v[1] + 24 * k;
    const d = h < ini ? ini - h : h > fin ? h - fin : 0;
    if (d < dist) { dist = d; mejor = sumaDias(dia, k); }
  }
  return mejor;
}

const normTurno = t => {
  const s = String(t || "").trim().toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  return s.startsWith("MAN") ? "MAÑANA" : s.startsWith("TAR") ? "TARDE" : s.startsWith("NOC") ? "NOCHE" : "";
};
const normForma = f => String(f || "").trim().toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
// Importes de la hoja: "1,500", "$-51", "MENOS 55" (= −55), "- 200"
export const numero = v => {
  let t = String(v ?? "").toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[$,\s]/g, "");
  let neg = false;
  const m = /^(MENOS|-|−)+/.exec(t);
  if (m) { neg = true; t = t.slice(m[0].length); }
  if (!/^\d+(\.\d+)?$/.test(t)) return 0;
  const n = Math.round(Number(t) * 100) / 100;
  return neg ? -n : n;
};
// Montos que captura una persona: solo dígitos y hasta 2 decimales (no "1e4", no negativos)
export const montoUsuario = v => { const t = String(v ?? "").replace(/[$,\s]/g, ""); return /^\d{1,9}(\.\d{1,2})?$/.test(t) ? Number(t) : NaN; };
const texto = (v, n = 80) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);

let esquemaListo = false;
export async function asegurarEsquemaCaja(env) {
  if (esquemaListo) return;
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS caja_mov (
      id INTEGER PRIMARY KEY AUTOINCREMENT, servicio TEXT NOT NULL, fecha TEXT NOT NULL, dia TEXT NOT NULL, turno TEXT NOT NULL,
      folio TEXT, matricula TEXT, cliente TEXT, importe REAL NOT NULL DEFAULT 0, forma TEXT, mes TEXT NOT NULL, tipo TEXT NOT NULL DEFAULT 'ticket')`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS caja_gastos (
      id TEXT PRIMARY KEY, mes TEXT NOT NULL, dia TEXT NOT NULL, turno TEXT NOT NULL, concepto TEXT NOT NULL,
      monto REAL NOT NULL, forma TEXT NOT NULL, creado TEXT NOT NULL, creado_por TEXT)`),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS caja_mov_dia ON caja_mov (dia, turno)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS caja_gastos_mes ON caja_gastos (mes, dia)"),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS caja_transf (
      id TEXT PRIMARY KEY, mes TEXT NOT NULL, fecha TEXT NOT NULL, cliente TEXT NOT NULL, importe REAL NOT NULL,
      factura TEXT, creado TEXT NOT NULL, creado_por TEXT)`),
    // Corte ciego entregado desde la tablet de turno (uno por día y turno)
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS turno_cortes (
      dia TEXT NOT NULL, turno TEXT NOT NULL, mes TEXT NOT NULL, persona TEXT NOT NULL, efectivo REAL NOT NULL, tarjeta REAL,
      notas TEXT, creado TEXT NOT NULL, actualizado TEXT NOT NULL, veces INTEGER NOT NULL DEFAULT 1, PRIMARY KEY (dia, turno))`)
  ]);
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS caja_extra (
      id TEXT PRIMARY KEY, mes TEXT NOT NULL, dia TEXT NOT NULL, turno TEXT NOT NULL, concepto TEXT NOT NULL, detalle TEXT,
      monto REAL NOT NULL, ingreso INTEGER NOT NULL DEFAULT 1, foto TEXT, persona TEXT, creado TEXT NOT NULL, creado_por TEXT)`).run();
  const cols = new Set((await env.DB.prepare("PRAGMA table_info(caja_gastos)").all()).results.map(r => r.name));
  for (const c of ["foto", "persona"]) if (!cols.has(c)) await env.DB.prepare(`ALTER TABLE caja_gastos ADD COLUMN ${c} TEXT`).run();
  // Desde el 14 oct 2026 el encargado cuenta el efectivo físico CON el cambio inicial (con_cambio = 1)
  const colsC = new Set((await env.DB.prepare("PRAGMA table_info(turno_cortes)").all()).results.map(r => r.name));
  if (!colsC.has("con_cambio")) await env.DB.prepare("ALTER TABLE turno_cortes ADD COLUMN con_cambio INTEGER NOT NULL DEFAULT 0").run();
  // Informe final: cómo se repartió el efectivo contado (sobre para la administración, retiros y cambio para el siguiente turno)
  for (const [c, t] of [["sobre", "REAL"], ["cambio_sig", "REAL"], ["retiros", "TEXT"]]) if (!colsC.has(c)) await env.DB.prepare(`ALTER TABLE turno_cortes ADD COLUMN ${c} ${t}`).run();
  // Entrega capturada por la administración (turnos anteriores a la tablet): sobre, retiros y cambio, sin conteo ciego
  if (!colsC.has("admin")) await env.DB.prepare("ALTER TABLE turno_cortes ADD COLUMN admin INTEGER NOT NULL DEFAULT 0").run();
  // Cada entrega o corrección del corte queda registrada (no se pierde lo que se entregó antes)
  // Cambio inicial que el encargado declara al empezar su turno en la tablet (sustituye al "cambio" de la hoja)
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS turno_inicio (dia TEXT NOT NULL, turno TEXT NOT NULL, mes TEXT NOT NULL, persona TEXT NOT NULL, cambio REAL NOT NULL, creado TEXT NOT NULL, actualizado TEXT NOT NULL, PRIMARY KEY (dia, turno))").run();
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS turno_cortes_hist (dia TEXT NOT NULL, turno TEXT NOT NULL, mes TEXT NOT NULL, persona TEXT NOT NULL, datos TEXT NOT NULL, creado TEXT NOT NULL)").run();
  // Origen del gasto (15 oct 2026): 'caja' = salió de la caja del turno (resta al corte);
  // 'admin' = pago, compra u otro gasto de la administración (sale de los sobres o del banco, no toca ningún turno).
  if (!cols.has("origen")) {
    await env.DB.prepare("ALTER TABLE caja_gastos ADD COLUMN origen TEXT").run();
    // Los pagos y compras registrados antes pasan a la administración
    const ligados = [];
    for (const sql of ["SELECT gasto_id FROM agenda_pagos WHERE gasto_id IS NOT NULL", "SELECT gasto_id FROM agenda_items WHERE gasto_id IS NOT NULL"])
      try { ligados.push(...(await env.DB.prepare(sql).all()).results.map(r => r.gasto_id)); } catch {}
    for (let i = 0; i < ligados.length; i += 90) {
      const l = ligados.slice(i, i + 90);
      await env.DB.prepare(`UPDATE caja_gastos SET origen = 'admin', turno = '' WHERE id IN (${l.map(() => "?").join(",")})`).bind(...l).run();
    }
  }
  // Folio único de cada movimiento de caja (gastos de caja, ingresos extra, retiros del corte y renglones sin folio de la hoja)
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS caja_folios (ref TEXT PRIMARY KEY, folio TEXT NOT NULL UNIQUE, mes TEXT NOT NULL, n INTEGER NOT NULL, creado TEXT NOT NULL)").run();
  // Transferencia capturada a mano ligada a un ticket de la hoja pagado por transferencia (servicio:folio)
  const colsT = new Set((await env.DB.prepare("PRAGMA table_info(caja_transf)").all()).results.map(r => r.name));
  if (!colsT.has("ticket_ref")) await env.DB.prepare("ALTER TABLE caja_transf ADD COLUMN ticket_ref TEXT").run();
  // Índices por mes de lo que se consulta en cada carga de Turnos y Finanzas
  await env.DB.batch([
    env.DB.prepare("CREATE INDEX IF NOT EXISTS caja_mov_mes ON caja_mov (mes, tipo, forma)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS caja_transf_mes ON caja_transf (mes)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS caja_extra_mes ON caja_extra (mes)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS turno_cortes_mes ON turno_cortes (mes)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS turno_inicio_mes ON turno_inicio (mes)")
  ]);
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS caja_pendientes (
      id TEXT PRIMARY KEY, servicio TEXT NOT NULL, fecha TEXT NOT NULL, dia TEXT NOT NULL,
      turno TEXT NOT NULL, folio TEXT NOT NULL, matricula TEXT, cliente TEXT, forma TEXT,
      monto REAL NOT NULL, mes TEXT NOT NULL, estado TEXT NOT NULL DEFAULT 'pendiente',
      origen_activo INTEGER NOT NULL DEFAULT 1, actualizado TEXT NOT NULL,
      resuelto TEXT, por TEXT, notas TEXT)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS caja_pendientes_hist (
      id INTEGER PRIMARY KEY AUTOINCREMENT, pendiente_id TEXT NOT NULL,
      anterior TEXT NOT NULL, nuevo TEXT NOT NULL,
      fecha TEXT NOT NULL, quien TEXT, notas TEXT)`),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS caja_pendientes_estado ON caja_pendientes (estado, origen_activo, fecha)"),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS caja_cobros_admin (
      id TEXT PRIMARY KEY, pendiente_id TEXT NOT NULL, fecha_pago TEXT NOT NULL, mes TEXT NOT NULL,
      monto REAL NOT NULL, forma TEXT NOT NULL, creado TEXT NOT NULL, por TEXT,
      anulado INTEGER NOT NULL DEFAULT 0, anulado_por TEXT, anulado_en TEXT)`),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS caja_cobros_admin_mes ON caja_cobros_admin (mes, anulado)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS caja_cobros_admin_pendiente ON caja_cobros_admin (pendiente_id, anulado)"),
    // Exclusión de cierre mensual: KV puede servir lecturas simultáneas antiguas.
    // Una sola ejecución por mes toma la llave transaccional de D1.
    env.DB.prepare("CREATE TABLE IF NOT EXISTS caja_cierre_lock (mes TEXT PRIMARY KEY, token TEXT NOT NULL, tomado TEXT NOT NULL)")
  ]);
  await asegurarEsquemaBitacora(env);
  esquemaListo = true;
}
// Gastos que salen de la caja de un turno (los de la administración no cuentan en los cortes)
export const DE_CAJA = "COALESCE(origen, 'caja') = 'caja'";
export const esDeCaja = g => (g.origen || "caja") === "caja";

// Pide al script de la hoja los registros de un mes
export async function leerHoja(env, mes) {
  if (!env.INGRESOS_URL || !env.INGRESOS_TOKEN) throw new Error("Falta conectar la hoja (INGRESOS_URL e INGRESOS_TOKEN).");
  const url = new URL(env.INGRESOS_URL.trim());
  url.searchParams.set("token", env.INGRESOS_TOKEN.trim());
  url.searchParams.set("mes", mes);
  const r = await fetch(url.toString(), { redirect: "follow" });
  const t = await r.text();
  let d;
  try { d = JSON.parse(t); } catch {
    if (/\/dev(\?|$)/.test(env.INGRESOS_URL)) throw new Error("La URL guardada es la de prueba (/dev). Usa la de la implementación, que termina en /exec.");
    if (/accounts\.google|ServiceLogin|signin/i.test(t + r.url)) throw new Error("Google pidió iniciar sesión: publica la aplicación web con acceso para «Cualquier persona», desde la cuenta dueña de la hoja.");
    throw new Error(`La hoja no respondió bien (HTTP ${r.status}).`);
  }
  if (!r.ok || !d || d.ok !== true)
    throw new Error("La hoja rechazó la consulta: " + texto(d && d.error, 120));
  // Ambas listas deben estar presentes. Un JSON parcial no equivale a borrar tickets.
  if (!Array.isArray(d.bascula) || !Array.isArray(d.pension))
    throw new Error("La hoja devolvió datos incompletos; se conservan los registros anteriores.");
  if (d.mes !== mes)
    throw new Error("La hoja devolvió un mes diferente; se conservan los registros anteriores.");
  if ([...d.bascula, ...d.pension].some(x => !x || typeof x !== "object" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(String(x.fecha || "")) ||
      x.fecha.slice(0, 7) !== mes))
    throw new Error("La hoja devolvió movimientos inválidos; se conservan los registros anteriores.");
  const importeHojaValido = v => {
    const t = String(v ?? "").toUpperCase().normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "").replace(/[$,\s]/g, "");
    return /^(?:MENOS|-|−)?\d{1,9}(?:\.\d{1,2})?$/.test(t) && Number.isFinite(numero(v))
      && Math.abs(numero(v)) <= 100000000;
  };
  const limpiar = (lista, servicio) => lista.map(x => {
    const turno = normTurno(x.turno);
    const fecha = texto(x.fecha, 19);
    const folio = texto(x.folio, 60);
    const tipo = /^\s*\d/.test(folio) ? "ticket" : "caja";
    const pendiente = x.pendiente === true || /^PENDIENTE\s+DE\s+PAGO\b/i.test(String(x.importe || ""));
    // Un importe mal formado nunca puede convertirse silenciosamente en $0,
    // borrando el cobro original de la hoja. Conservar el mes y alertar.
    const vacio = x.importe == null || String(x.importe).trim() === "";
    if (!pendiente && (tipo === "ticket" || !vacio) && !importeHojaValido(x.importe))
      throw new Error("La hoja contiene un importe no válido: se conservaron los tickets anteriores.");
    if (pendiente && x.monto_pendiente != null && String(x.monto_pendiente).trim() !== "" &&
        !importeHojaValido(x.monto_pendiente))
      throw new Error("La hoja contiene un pendiente con importe no válido: se conservaron los tickets anteriores.");
    return {
      // Sin folio numérico es un movimiento de caja (cambio, retiro, sueldo, compra), no un ticket
      tipo,
      servicio, fecha, turno: turno || "SIN TURNO", dia: diaDelCorte(fecha, turno) || fecha.slice(0, 10),
      folio: folio.slice(0, 40), matricula: texto(x.matricula, 20).toUpperCase(), cliente: texto(x.cliente, 80),
      importe: pendiente ? 0 : numero(x.importe),
      forma: normForma(x.forma) || "SIN FORMA",
      pendiente,
      monto_pendiente: numero(x.monto_pendiente) || (String(x.importe || "").match(/^PENDIENTE\s+DE\s+PAGO\s*\$?\s*([\d,.]+)/i)
        ? numero(String(x.importe).replace(/^PENDIENTE\s+DE\s+PAGO\s*/i, "")) : 0)
    };
  }).filter(x => /^\d{4}-\d{2}-\d{2}T/.test(x.fecha));
  return [...limpiar(d.bascula, "bascula"), ...limpiar(d.pension, "pension")];
}

// Actualiza los ingresos guardados con los del mes actual. Solo escribe lo que cambió:
// Reescribir el mes completo cada 10 minutos agotaba las escrituras de D1 en el plan gratuito
// (100 000 filas al día). Se comparan los registros y solo se insertan o borran las diferencias;
// con Workers Paid (50 millones al mes incluidas) se conserva así para no gastar de más.
const COLS_MOV = ["servicio", "fecha", "dia", "turno", "folio", "matricula", "cliente", "importe", "forma", "mes", "tipo"];
export const firmaMov = f => COLS_MOV.map(c => String(f[c] ?? "")).join("\u0001");
export function diferenciasCaja(actuales, nuevas) {
  const libres = new Map();
  for (const f of actuales) { const k = firmaMov(f); if (!libres.has(k)) libres.set(k, []); libres.get(k).push(f.id); }
  const insertar = [];
  for (const f of nuevas) { const ids = libres.get(firmaMov(f)); if (ids && ids.length) ids.pop(); else insertar.push(f); }
  const borrar = [...libres.values()].flat();
  return { insertar, borrar };
}
export async function sincronizarCaja(env) {
  await asegurarEsquemaCaja(env);
  const meses = await mesesAbiertos(env);
  try {
    // Cada registro va al mes de su día de corte (una NOCHE de las 2 a.m. del día 1 es del mes anterior)
    const filas = [];
    for (const m of meses) for (const f of await leerHoja(env, m)) { const mes = String(f.dia).slice(0, 7); if (meses.includes(mes)) filas.push({ ...f, mes }); }
    const q = meses.map(() => "?").join(",");
    const actuales = (await env.DB.prepare(`SELECT id, ${COLS_MOV.join(", ")} FROM caja_mov WHERE mes IN (${q})`).bind(...meses).all()).results;
    const { insertar, borrar } = diferenciasCaja(actuales, filas);
    const stmts = [];
    const pendientes = new Map();
    for (const f of filas.filter(x => x.pendiente)) {
      const id = [f.servicio, f.fecha, f.folio].join("|");
      if (pendientes.has(id)) throw new Error("Dos cobros pendientes tienen la misma identificación en la hoja.");
      if (!Number.isFinite(f.monto_pendiente) || f.monto_pendiente < 0 || f.monto_pendiente > 100000000)
        throw new Error("La hoja devolvió un importe pendiente inválido.");
      pendientes.set(id, { ...f, id });
    }
    // Si la hoja registra otro ticket cobrado del mismo servicio/folio/mes,
    // el asiento administrativo queda suspendido aunque siga el renglón pendiente.
    const cubiertosPorHoja = new Set(filas.filter(x => !x.pendiente && x.tipo === "ticket" && x.importe > 0)
      .map(x => [x.mes, x.servicio, x.folio].join("|")));
    // Se conservan el estado e historial decididos por la administración.
    // Sólo se actualiza la presencia y los datos de origen durante la conciliación.
    stmts.push(env.DB.prepare(`UPDATE caja_pendientes SET origen_activo = 0 WHERE mes IN (${q})`).bind(...meses));
    const ahora = new Date().toISOString();
    for (const p of pendientes.values()) stmts.push(
      env.DB.prepare(`INSERT INTO caja_pendientes
        (id, servicio, fecha, dia, turno, folio, matricula, cliente, forma, monto, mes, estado, origen_activo, actualizado)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pendiente', ?, ?)
        ON CONFLICT(id) DO UPDATE SET dia=excluded.dia, turno=excluded.turno,
          matricula=excluded.matricula, cliente=excluded.cliente, forma=excluded.forma,
          monto=excluded.monto, origen_activo=excluded.origen_activo, actualizado=excluded.actualizado`)
       .bind(p.id, p.servicio, p.fecha, p.dia, p.turno, p.folio, p.matricula, p.cliente,
         p.forma, p.monto_pendiente, p.mes,
         cubiertosPorHoja.has([p.mes, p.servicio, p.folio].join("|")) ? 0 : 1, ahora)
    );
    for (let i = 0; i < borrar.length; i += 90) {
      const lote = borrar.slice(i, i + 90);
      stmts.push(env.DB.prepare(`DELETE FROM caja_mov WHERE id IN (${lote.map(() => "?").join(",")})`).bind(...lote));
    }
    const POR = 9; // D1 admite hasta 100 parámetros por consulta
    for (let i = 0; i < insertar.length; i += POR) {
      const lote = insertar.slice(i, i + POR);
      stmts.push(env.DB.prepare(`INSERT INTO caja_mov (${COLS_MOV.join(", ")}) VALUES ${lote.map(() => "(" + COLS_MOV.map(() => "?").join(",") + ")").join(",")}`)
        .bind(...lote.flatMap(f => COLS_MOV.map(c => f[c]))));
    }
    if (stmts.length) await env.DB.batch(stmts);
    // Folios de los movimientos de caja nuevos (si falla, se numeran la próxima vez)
    await numerarMovimientos(env, meses).catch(e => console.error("folios caja", e && e.message));
    const previo = await env.FILES.get("caja:sync", { type: "json" }) || {};
    const estado = { at: new Date().toISOString(), n: filas.length, error: null, cambios: insertar.length + borrar.length };
    // Solo se guarda el estado si hubo cambios o pasó 1 hora (ahorra escrituras de KV)
    if (estado.cambios || previo.error || !previo.at || Date.now() - Date.parse(previo.at) > 3600e3 || previo.n !== estado.n)
      await env.FILES.put("caja:sync", JSON.stringify(estado));
    return estado;
  } catch (e) {
    const previo = await env.FILES.get("caja:sync", { type: "json" }) || {};
    const estado = { ...previo, error: String(e && e.message || e).slice(0, 200), error_at: new Date().toISOString() };
    await env.FILES.put("caja:sync", JSON.stringify(estado));
    return estado;
  }
}

// Cortes por día y turno a partir de ingresos y gastos
export async function leerCobrosAdmin(env, { mes = "", desde = "", hasta = "" } = {}) {
  await asegurarEsquemaCaja(env);
  const where = ["a.anulado = 0", "p.origen_activo = 1"], bind = [];
  if (mes) { where.push("a.mes = ?"); bind.push(mes); }
  if (desde) { where.push("a.fecha_pago >= ?"); bind.push(desde); }
  if (hasta) { where.push("a.fecha_pago <= ?"); bind.push(hasta); }
  return (await env.DB.prepare(`SELECT a.id, a.pendiente_id, a.fecha_pago AS dia,
    a.mes, a.monto, a.forma, a.creado, a.por, p.folio, p.servicio, p.cliente
    FROM caja_cobros_admin a JOIN caja_pendientes p ON p.id = a.pendiente_id
    WHERE ${where.join(" AND ")} ORDER BY a.fecha_pago ASC, a.creado ASC`)
    .bind(...bind).all()).results;
}

export function calcularCortes(movs, gastos, extras = [], inicios = []) {
  const cortes = new Map();
  const corte = (dia, turno) => {
    const k = dia + "|" + turno;
    if (!cortes.has(k)) cortes.set(k, {
      dia, turno, bascula: { EFECTIVO: 0, TARJETA: 0 }, pension: { EFECTIVO: 0, TARJETA: 0 },
      fuera: { n: 0, importe: 0, formas: {} }, caja: { n: 0, importe: 0 }, cambio: { n: 0, importe: 0 }, extra: { n: 0, importe: 0, ingreso: 0 }, gastos: { EFECTIVO: 0, TARJETA: 0, TRANSFERENCIA: 0 }, registros: 0, n_gastos: 0
    });
    return cortes.get(k);
  };
  for (const m of movs) {
    const c = corte(m.dia, m.turno);
    c.registros++;
    if (esCambio(m)) { c.cambio.n++; c.cambio.importe += m.importe; continue; }
    if (m.tipo === "caja") { c.caja.n++; if (m.forma === "EFECTIVO") c.caja.importe += m.importe; continue; }
    if (FORMAS_CONTADAS.includes(m.forma)) c[m.servicio][m.forma] += m.importe;
    else { c.fuera.n++; c.fuera.importe += m.importe; c.fuera.formas[m.forma] = (c.fuera.formas[m.forma] || 0) + m.importe; }
  }
  for (const g of gastos) { const c = corte(g.dia, g.turno); c.gastos[g.forma] = (c.gastos[g.forma] || 0) + g.monto; c.n_gastos++; }
  for (const x of extras) { const c = corte(x.dia, x.turno); c.extra.n++; c.extra.importe += x.monto; if (x.ingreso) c.extra.ingreso += x.monto; }
  // El cambio inicial capturado en la tablet manda sobre el "cambio" de la hoja (no se suman los dos)
  for (const i of inicios) { const c = corte(i.dia, i.turno); c.cambio = { n: 1, importe: Number(i.cambio) || 0, fuente: "tablet", persona: i.persona, desde: i.creado || null, hoja: c.cambio.importe }; }
  const orden = t => TURNOS.indexOf(t) < 0 ? 9 : TURNOS.indexOf(t);
  return [...cortes.values()].map(c => {
    const efectivo = c.bascula.EFECTIVO + c.pension.EFECTIVO, tarjeta = c.bascula.TARJETA + c.pension.TARJETA;
    return { ...c, efectivo, tarjeta, ingresos: efectivo + tarjeta, gastos_total: c.gastos.EFECTIVO + c.gastos.TARJETA + c.gastos.TRANSFERENCIA, efectivo_caja: efectivo + c.cambio.importe + c.extra.importe + c.caja.importe - c.gastos.EFECTIVO };
  }).sort((a, b) => b.dia.localeCompare(a.dia) || orden(b.turno) - orden(a.turno));
}

// transf: transferencias capturadas a mano que cuentan (las ligadas a un ticket de la hoja ya van en el ticket; ver transferenciasMes)
export function totalesMes(cortes, transf = []) {
  const t = { efectivo: 0, tarjeta: 0, transferencias: 0, transf_hoja: 0, transf_manual: 0, ingresos: 0, gastos: 0, caja: 0, bascula: 0, pension: 0, extras: 0, otros: 0, n_transferencias: transf.length };
  for (const x of transf) { t.transferencias += x.importe; t.transf_manual += x.importe; t.ingresos += x.importe; }
  for (const c of cortes) for (const [f, v] of Object.entries(c.fuera.formas)) if (esTransf(f)) { t.transferencias += v; t.transf_hoja += v; t.ingresos += v; }
  for (const c of cortes) {
    t.efectivo += c.efectivo; t.tarjeta += c.tarjeta; t.ingresos += c.ingresos + c.extra.ingreso; t.gastos += c.gastos_total; t.caja += c.caja.importe;
    t.extras += c.extra.importe; t.otros += c.extra.ingreso;
    t.bascula += c.bascula.EFECTIVO + c.bascula.TARJETA; t.pension += c.pension.EFECTIVO + c.pension.TARJETA;
  }
  return t;
}

// Agrega a cada corte lo que contó el encargado (corte ciego) y la diferencia
export function unirConteos(cortes, conteos) {
  const porClave = new Map(conteos.map(x => [x.dia + "|" + x.turno, x]));
  const salida = cortes.map(c => {
    const x = porClave.get(c.dia + "|" + c.turno); porClave.delete(c.dia + "|" + c.turno);
    return x ? { ...c, conteo: conteo(x, c) } : c;
  });
  // Cortes entregados sin registros todavía (la hoja aún no se sincroniza)
  for (const x of porClave.values()) salida.push({ ...calcularCortes([], [{ dia: x.dia, turno: x.turno, monto: 0, forma: "EFECTIVO" }])[0], n_gastos: 0, conteo: conteo(x, null) });
  const orden = t => TURNOS.indexOf(t) < 0 ? 9 : TURNOS.indexOf(t);
  return salida.sort((a, b) => b.dia.localeCompare(a.dia) || orden(b.turno) - orden(a.turno));
}
// Transferencias del periodo: tickets de la hoja pagados por transferencia + capturadas a mano.
// Una capturada a mano ligada a un ticket que sí está en la hoja no se cuenta otra vez (el ticket ya cuenta);
// si su ticket ya no aparece en la hoja, cuenta ella. Se marcan como "posible duplicado" las sueltas que
// coinciden en importe (y ±3 días) con un ticket sin ligar, para que la administración decida.
export function transferenciasMes(movs, transf) {
  const sumDias = (d, n) => sumaDias(d, n);
  const ligadas = new Map(transf.filter(x => x.ticket_ref).map(x => [x.ticket_ref, x]));
  const hoja = movs.filter(m => m.tipo === "ticket" && esTransf(m.forma)).map(m => {
    const ref = refTicket(m), l = ligadas.get(ref);
    return { ref, servicio: m.servicio, folio: m.folio, fecha: String(m.fecha).slice(0, 10), dia: m.dia, turno: m.turno, cliente: m.cliente || "", matricula: m.matricula || "", importe: m.importe, ligada: l ? { id: l.id, cliente: l.cliente, cuenta: l.cuenta || null, factura: l.factura || null } : null };
  });
  // Una conciliación válida al capturar puede quedar obsoleta si Google
  // corrige después el importe, la forma de pago o elimina el ticket.
  // Señalar el conflicto sin borrar la relación ni modificar importes.
  const tickets = new Map();
  for (const m of movs.filter(m => m.tipo === "ticket")) {
    const ref = refTicket(m);
    if (!tickets.has(ref)) tickets.set(ref, []);
    tickets.get(ref).push(m);
  }
  const alertas = [];
  for (const x of transf.filter(t => t.ticket_ref)) {
    const relacionados = tickets.get(x.ticket_ref) || [];
    let motivo = null;
    if (!relacionados.length) motivo = "ausente";
    else if (relacionados.length !== 1) motivo = "ambiguo";
    else if (!esTransf(relacionados[0].forma)) motivo = "forma";
    else if (Math.round(Number(relacionados[0].importe) * 100) !== Math.round(Number(x.importe) * 100))
      motivo = "importe";
    if (motivo) alertas.push({
      id: x.id, ref: x.ticket_ref, motivo, importe_capturado: x.importe,
      importe_hoja: relacionados.length === 1 ? relacionados[0].importe : null
    });
  }
  const enHoja = new Set(hoja.map(h => h.ref));
  const contadas = transf.filter(x => !x.ticket_ref || !enHoja.has(x.ticket_ref));
  const sinLigar = hoja.filter(h => !h.ligada);
  const posibles = contadas.filter(x => !x.ticket_ref).map(x => ({ id: x.id, tickets: sinLigar.filter(h => Math.abs(h.importe - x.importe) < 0.01 && h.fecha >= sumDias(x.fecha, -3) && h.fecha <= sumDias(x.fecha, 3)).map(h => h.ref) })).filter(x => x.tickets.length);
  const r2 = v => Math.round(v * 100) / 100;
  return { hoja, contadas, posibles, alertas, total_hoja: r2(hoja.reduce((a, h) => a + h.importe, 0)), total_manual: r2(contadas.reduce((a, x) => a + x.importe, 0)) };
}

// ---- Cambio entre turnos: lo que dejó un turno para el siguiente contra lo que el siguiente dijo recibir ----
const ANTERIOR = { "MAÑANA": [-1, "NOCHE"], TARDE: [0, "MAÑANA"], NOCHE: [0, "TARDE"] };
const SIGUIENTE = { "MAÑANA": [0, "TARDE"], TARDE: [0, "NOCHE"], NOCHE: [1, "MAÑANA"] };
export const turnoAnterior = (dia, turno) => ANTERIOR[turno] ? { dia: sumaDias(dia, ANTERIOR[turno][0]), turno: ANTERIOR[turno][1] } : null;
export const turnoSiguiente = (dia, turno) => SIGUIENTE[turno] ? { dia: sumaDias(dia, SIGUIENTE[turno][0]), turno: SIGUIENTE[turno][1] } : null;
// Para cada turno con cambio inicial capturado en la tablet y cuyo turno anterior entregó corte con "cambio para el
// siguiente turno": dif = recibido − dejado (negativo: faltó dinero entre un turno y otro).
export function cambiosEntreTurnos(conteos, inicios) {
  const r2 = v => Math.round(v * 100) / 100;
  const porClave = new Map(conteos.map(x => [x.dia + "|" + x.turno, x]));
  const out = new Map();
  for (const i of inicios) {
    const a = turnoAnterior(i.dia, i.turno); if (!a) continue;
    const c = porClave.get(a.dia + "|" + a.turno);
    if (!c || c.cambio_sig == null) continue;
    out.set(i.dia + "|" + i.turno, { dia: i.dia, turno: i.turno, de: { dia: a.dia, turno: a.turno, persona: c.persona }, dejado: r2(c.cambio_sig), recibio: i.persona, recibido: r2(Number(i.cambio) || 0), dif: r2((Number(i.cambio) || 0) - c.cambio_sig) });
  }
  return out;
}
export function ponerCambioTurnos(cortes, conteos, inicios) {
  const m = cambiosEntreTurnos(conteos, inicios);
  for (const c of cortes) { const x = m.get(c.dia + "|" + c.turno); if (x) c.cambio_turno = x; }
  return cortes;
}

export function leerRetiros(v) {
  let l = v; if (typeof l === "string") { try { l = JSON.parse(l); } catch { l = []; } }
  return Array.isArray(l) ? l.filter(r => r && r.concepto && Number(r.monto) > 0).map(r => ({ concepto: String(r.concepto).slice(0, 80), monto: Math.round(Number(r.monto) * 100) / 100 })) : [];
}
function conteo(x, c) {
  const r2 = v => Math.round(v * 100) / 100;
  // Capturada por la administración: no hubo conteo ciego, así que no hay diferencia que calcular
  if (x.admin) return { persona: x.persona, admin: true, efectivo: x.efectivo, tarjeta: null, notas: x.notas, actualizado: x.actualizado, veces: x.veces, con_cambio: true,
    sobre: x.sobre, cambio_sig: x.cambio_sig, retiros: leerRetiros(x.retiros), esperado: c ? r2(c.efectivo_caja) : null, dif_efectivo: null, dif_tarjeta: null };
  return { persona: x.persona, efectivo: x.efectivo, tarjeta: x.tarjeta, notas: x.notas, creado: x.creado, actualizado: x.actualizado, veces: x.veces,
    // Antes el encargado contaba sin el fondo de cambio; desde el 14 oct 2026 cuenta todo (con_cambio = 1)
    con_cambio: !!x.con_cambio,
    sobre: x.sobre, cambio_sig: x.cambio_sig, retiros: leerRetiros(x.retiros),
    esperado: c ? r2(c.efectivo_caja - (x.con_cambio || !c.cambio ? 0 : c.cambio.importe)) : null,
    dif_efectivo: c ? r2(x.efectivo - (c.efectivo_caja - (x.con_cambio || !c.cambio ? 0 : c.cambio.importe))) : null, dif_tarjeta: c && x.tarjeta != null ? r2(x.tarjeta - c.tarjeta) : null };
}

// ---- Movimientos de caja con folio único (MC-AAMM-NNN) ----
// Todo lo que mueve la caja de un turno, salvo el cambio inicial: gastos de caja, ingresos extra,
// retiros del corte ciego y renglones de la hoja sin folio de ticket. El folio se asigna una sola vez
// (por orden de llegada) y no cambia; si el movimiento se borra, su número no se vuelve a usar.
const horaLocal = iso => { const d = new Date(Date.parse(iso) - 6 * 3600e3); return isNaN(d) ? "" : d.toISOString().slice(0, 16); };
export function movimientosCaja({ movs = [], gastos = [], extras = [], conteos = [] }) {
  const lista = [];
  for (const g of gastos) if (esDeCaja(g)) lista.push({ ref: "g:" + g.id, tipo: "gasto", id: g.id, mes: g.mes, dia: g.dia, turno: g.turno, cuando: horaLocal(g.creado), concepto: g.concepto, categoria: g.categoria || null, detalle: "", monto: -g.monto, forma: g.forma, persona: g.persona || null, por: g.persona ? null : g.creado_por || null, foto: g.foto || null });
  for (const x of extras) lista.push({ ref: "x:" + x.id, tipo: "ingreso", id: x.id, mes: x.mes, dia: x.dia, turno: x.turno, cuando: horaLocal(x.creado), concepto: x.concepto, detalle: x.detalle || "", monto: x.monto, forma: "EFECTIVO", persona: x.persona || null, por: x.persona ? null : x.creado_por || null, foto: x.foto || null, ingreso: !!x.ingreso });
  for (const c of conteos) leerRetiros(c.retiros).forEach((r, i) => lista.push({ ref: `r:${c.dia}|${c.turno}|${i}`, tipo: "retiro", mes: c.mes, dia: c.dia, turno: c.turno, cuando: horaLocal(c.actualizado), concepto: r.concepto, detalle: "Retiro en el corte", monto: -r.monto, forma: "EFECTIVO", persona: c.persona, foto: null }));
  // Renglones de la hoja sin folio de ticket (retiros, sueldos, compras); el cambio inicial no lleva folio
  const vistos = new Map();
  for (const m of movs.filter(m => m.tipo === "caja" && !esCambio(m)).sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)) || (a.id || 0) - (b.id || 0))) {
    const f = firmaMov(m), k = vistos.get(f) || 0; vistos.set(f, k + 1);
    lista.push({ ref: "m:" + f + "#" + k, tipo: "hoja", mes: m.mes, dia: m.dia, turno: m.turno, cuando: String(m.fecha).slice(0, 16), concepto: conceptoHoja(m), clase: claseHoja(m), detalle: /^(0|S|SN)?$/i.test(String(m.matricula || "").trim()) ? "" : m.matricula, monto: m.importe, forma: m.forma, persona: null, foto: null, servicio: m.servicio });
  }
  return lista.sort((a, b) => b.dia.localeCompare(a.dia) || String(b.cuando).localeCompare(String(a.cuando)));
}
export const textoFolio = (mes, n) => `MC-${mes.slice(2, 4)}${mes.slice(5, 7)}-${String(n).padStart(3, "0")}`;
// Pone el folio a cada movimiento; los que no tienen se numeran en orden cronológico dentro de su mes
export async function conFolios(env, lista) {
  if (!lista.length) return lista;
  const meses = [...new Set(lista.map(x => x.mes))];
  const q = meses.map(() => "?").join(",");
  const hechos = new Map((await env.DB.prepare(`SELECT ref, folio FROM caja_folios WHERE mes IN (${q})`).bind(...meses).all()).results.map(r => [r.ref, r.folio]));
  const faltan = lista.filter(x => !hechos.has(x.ref)).sort((a, b) => a.dia.localeCompare(b.dia) || String(a.cuando).localeCompare(String(b.cuando)));
  if (faltan.length) {
    const tope = new Map((await env.DB.prepare(`SELECT mes, MAX(n) n FROM caja_folios WHERE mes IN (${q}) GROUP BY mes`).bind(...meses).all()).results.map(r => [r.mes, r.n || 0]));
    const ahora = new Date().toISOString(), st = [];
    for (const x of faltan) {
      const n = (tope.get(x.mes) || 0) + 1; tope.set(x.mes, n);
      st.push(env.DB.prepare("INSERT OR IGNORE INTO caja_folios (ref, folio, mes, n, creado) VALUES (?, ?, ?, ?, ?)").bind(x.ref, textoFolio(x.mes, n), x.mes, n, ahora));
    }
    for (let i = 0; i < st.length; i += 50) await env.DB.batch(st.slice(i, i + 50));
    for (const r of (await env.DB.prepare(`SELECT ref, folio FROM caja_folios WHERE mes IN (${q})`).bind(...meses).all()).results) hechos.set(r.ref, r.folio);
  }
  for (const x of lista) x.folio = hechos.get(x.ref) || null;
  return lista;
}
// Numera lo que entró desde la última vez (se llama después de cada sincronización)
export async function numerarMovimientos(env, meses) {
  const q = meses.map(() => "?").join(",");
  const leer = sql => env.DB.prepare(sql.replace("(?)", `(${q})`)).bind(...meses).all().then(r => r.results);
  const lista = movimientosCaja({
    movs: await leer("SELECT * FROM caja_mov WHERE tipo = 'caja' AND mes IN (?)"),
    gastos: await leer(`SELECT * FROM caja_gastos WHERE ${DE_CAJA} AND mes IN (?)`),
    extras: await leer("SELECT * FROM caja_extra WHERE mes IN (?)"),
    conteos: await leer("SELECT * FROM turno_cortes WHERE mes IN (?)")
  });
  await conFolios(env, lista);
  return lista.length;
}

// Periodo opcional: desde/hasta (AAAA-MM-DD, por día del corte o fecha de la transferencia)
function leerPeriodo(url) {
  const f = k => { const v = url && url.searchParams.get(k) || ""; return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : ""; };
  let desde = f("desde"), hasta = f("hasta");
  if (desde && hasta && desde > hasta) [desde, hasta] = [hasta, desde];
  return { desde, hasta };
}
export async function leerMes(env, meses, { desde = "", hasta = "" } = {}) {
  meses = [].concat(meses);
  const rango = (col) => `${desde ? ` AND ${col} >= ?` : ""}${hasta ? ` AND ${col} <= ?` : ""}`;
  // Con periodo (desde/hasta) se busca por fechas en todo lo conservado (13 meses); sin periodo, los meses abiertos
  const porRango = !!(desde || hasta);
  const args = [...(porRango ? [] : meses), ...(desde ? [desde] : []), ...(hasta ? [hasta] : [])];
  const enMes = porRango ? "1 = 1" : `mes IN (${meses.map(() => "?").join(",")})`;
  // Son lecturas independientes; no hay que esperar a que termine cada consulta
  // para iniciar las demás. Conservamos exactamente las mismas filas y filtros.
  const consultar = sql => env.DB.prepare(sql).bind(...args).all().then(r => r.results);
  const [movs, todos, transf, conteos, extras, inicios] = await Promise.all([
    consultar(`SELECT * FROM caja_mov WHERE ${enMes}${rango("dia")} ORDER BY fecha DESC`),
    consultar(`SELECT * FROM caja_gastos WHERE ${enMes}${rango("dia")} ORDER BY dia DESC, creado DESC`),
    consultar(`SELECT * FROM caja_transf WHERE ${enMes}${rango("fecha")} ORDER BY fecha DESC, creado DESC`),
    consultar(`SELECT * FROM turno_cortes WHERE ${enMes}${rango("dia")}`),
    consultar(`SELECT * FROM caja_extra WHERE ${enMes}${rango("dia")} ORDER BY dia DESC, creado DESC`),
    consultar(`SELECT * FROM turno_inicio WHERE ${enMes}${rango("dia")}`)
  ]);
  const gastos = todos.filter(esDeCaja), gastosAdmin = todos.filter(g => !esDeCaja(g));
  return { movs, gastos, gastosAdmin, transf, conteos, extras, inicios };
}

// Cambio de mes: el mes anterior se deja en la base tal como quedó en la hoja y se crean sus reportes
// en Google Sheets (Turnos, Finanzas y Facturación, cada uno en su carpeta de Drive). Si los reportes no
// se crean, no se borra nada y se reintenta cada hora.
export async function cierreMensualCaja(env, h, ahora = new Date()) {
  await asegurarEsquemaCaja(env);
  const actual = mesActual(ahora);
  const guardado = await env.FILES.get("caja:mes");
  if (!guardado) { await env.FILES.put("caja:mes", actual); return { nada: true }; }
  if (guardado >= actual) return { nada: true };
  // Se espera a que termine el turno de noche del último día del mes (7:00 del día 1, hora de Tapachula)
  if (mesActual(new Date(ahora.getTime() - 7 * 3600e3)) !== actual) return { esperando: true };
  const intento = await env.FILES.get("caja:cierre_intento");
  if (intento && ahora.getTime() - Date.parse(intento) < 3600e3) return { esperando: true };
  const mes = guardado;
  const token = crypto.randomUUID();
  const vencido = new Date(ahora.getTime() - 2 * 3600e3).toISOString();
  // El INSERT / UPDATE condicional se serializa en D1. Un segundo Worker
  // no puede obtener el mismo mes a la vez aunque ambos leyeran KV vacío.
  // La llave vence para permitir recuperación si un Worker desaparece.
  const toma = await env.DB.prepare(`INSERT INTO caja_cierre_lock (mes, token, tomado)
    VALUES (?, ?, ?) ON CONFLICT(mes) DO UPDATE SET
      token = excluded.token, tomado = excluded.tomado
    WHERE caja_cierre_lock.tomado < ?`)
    .bind(mes, token, ahora.toISOString(), vencido).run();
  if (!toma.meta?.changes) return { esperando: true };
  let completado = false;
  try {
    await env.FILES.put("caja:cierre_intento", ahora.toISOString(), { expirationTtl: 7200 });
    let movs;
  try {
    // Del mes que se cierra: lo de su hoja más lo capturado después de medianoche del día 1 que es de su último día
    const sig = (await leerHoja(env, actual)).filter(f => String(f.dia).slice(0, 7) === mes);
    movs = [...(await leerHoja(env, mes)).filter(f => String(f.dia).slice(0, 7) === mes), ...sig];
  } catch (e) { console.error("cierre caja: hoja", e.message); return { error: e.message }; }
  // Lo del mes que se cierra queda en el panel tal como quedó en la hoja (por si hubo cambios después de la última lectura)
  const filasMes = movs.map(f => ({ ...f, mes }));
  // La lectura final de la hoja debe conciliar los cobros pendientes igual que
  // la sincronización ordinaria. De lo contrario, el mes puede cerrarse con
  // un ticket ya pagado Y un abono administrativo que sigue sumando dos veces.
  const pendientes = new Map();
  for (const f of filasMes.filter(x => x.pendiente)) {
    const id = [f.servicio, f.fecha, f.folio].join("|");
    if (pendientes.has(id)) return { error: "La hoja tiene dos pendientes con la misma identificación: no se cerró el mes." };
    if (!Number.isFinite(f.monto_pendiente) || f.monto_pendiente < 0 || f.monto_pendiente > 100000000)
      return { error: "La hoja tiene un importe pendiente inválido: no se cerró el mes." };
    pendientes.set(id, { ...f, id });
  }
  const cubiertosPorHoja = new Set(filasMes.filter(x => !x.pendiente && x.tipo === "ticket" && x.importe > 0)
    .map(x => [x.mes, x.servicio, x.folio].join("|")));
  const POR = 9, st = [
    env.DB.prepare("DELETE FROM caja_mov WHERE mes = ?").bind(mes),
    env.DB.prepare("UPDATE caja_pendientes SET origen_activo = 0 WHERE mes = ?").bind(mes)
  ];
  for (const p of pendientes.values()) st.push(env.DB.prepare(`INSERT INTO caja_pendientes
    (id, servicio, fecha, dia, turno, folio, matricula, cliente, forma, monto, mes, estado, origen_activo, actualizado)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pendiente', ?, ?)
    ON CONFLICT(id) DO UPDATE SET dia=excluded.dia, turno=excluded.turno,
      matricula=excluded.matricula, cliente=excluded.cliente, forma=excluded.forma,
      monto=excluded.monto, origen_activo=excluded.origen_activo, actualizado=excluded.actualizado`)
    .bind(p.id, p.servicio, p.fecha, p.dia, p.turno, p.folio, p.matricula, p.cliente,
      p.forma, p.monto_pendiente, p.mes,
      cubiertosPorHoja.has([p.mes, p.servicio, p.folio].join("|")) ? 0 : 1, ahora.toISOString())
  );
  for (let i = 0; i < filasMes.length; i += POR) {
    const lote = filasMes.slice(i, i + POR);
    st.push(env.DB.prepare(`INSERT INTO caja_mov (${COLS_MOV.join(", ")}) VALUES ${lote.map(() => "(" + COLS_MOV.map(() => "?").join(",") + ")").join(",")}`).bind(...lote.flatMap(f => COLS_MOV.map(c => f[c] ?? null))));
  }
  await env.DB.batch(st);
  await numerarMovimientos(env, [mes]).catch(() => {});
  // Reportes del mes en Google Sheets: son el respaldo, así que sin ellos no se borra nada
  try { await h.reportes(env, mes); }
  catch (e) { console.error("cierre caja: reportes Sheets", e && e.message); return { error: "reportes: " + (e && e.message) }; }
  // Se conservan 13 meses (el actual y los 12 anteriores); lo más viejo se borra con sus fotos
  const limite = sumarMesesCaja(actual, -12);
  const fotos = [...(await env.DB.prepare("SELECT foto FROM caja_gastos WHERE mes < ? AND foto IS NOT NULL").bind(limite).all()).results,
    ...(await env.DB.prepare("SELECT foto FROM caja_extra WHERE mes < ? AND foto IS NOT NULL").bind(limite).all()).results];
  for (const f of fotos) await borrarArchivo(env, f.foto).catch(() => {});
  await env.DB.batch(["caja_gastos", "caja_transf", "caja_extra", "caja_mov", "turno_cortes", "turno_cortes_hist", "turno_inicio", "caja_folios"]
    .map(t => env.DB.prepare(`DELETE FROM ${t} WHERE mes < ?`).bind(limite)));
  await env.FILES.put("caja:mes", actual);
  completado = true;
  await env.FILES.delete("caja:cierre_intento").catch(e => console.error("cierre caja: marcador", e && e.message));
  return { cerrado: mes };
  } finally {
    // El éxito conserva la llave temporal para absorber lecturas KV obsoletas
    // después del cierre. El error la suelta para que pueda reintentarse.
    if (!completado) await env.DB.prepare(
      "DELETE FROM caja_cierre_lock WHERE mes = ? AND token = ?"
    ).bind(mes, token).run().catch(e => console.error("cierre caja: liberar", e && e.message));
  }
}

// ---- Entregas capturadas por la administración (turnos sin corte en la tablet) ----
// Se pega una tabla con: día, turno, sobre, taxi, sueldo y cambio que dejó (separada por tabuladores, | o ;).
// "—" o vacío = no hubo dato; "$0" = cero. El día puede ser "01/oct", "1 oct" o "2026-10-01".
const MESES_TXT = { ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6, jul: 7, ago: 8, sep: 9, sept: 9, set: 9, oct: 10, nov: 11, dic: 12 };
const celdaMonto = v => { const t = String(v ?? "").replace(/[*\s$,]/g, ""); if (!t || /^[—–\-]+$/.test(t)) return null; return /^\d{1,9}(\.\d{1,2})?$/.test(t) ? Number(t) : NaN; };
export function leerTablaEntregas(textoTabla, anio) {
  const filas = [], errores = [];
  String(textoTabla || "").split(/\r?\n/).forEach((linea, i) => {
    if (!linea.trim()) return;
    const c = linea.split(/\t|\||;/).map(x => x.trim());
    if (c.length < 3) { errores.push({ linea: i + 1, texto: linea.slice(0, 80), error: "Faltan columnas." }); return; }
    let dia = null, m;
    if ((m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(c[0]))) dia = c[0];
    else if ((m = /^(\d{1,2})\s*[\/\- ]\s*([a-záéíóú]{3,4})\.?$/i.exec(c[0])) && MESES_TXT[m[2].toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")])
      dia = `${anio}-${String(MESES_TXT[m[2].toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")]).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    const turno = normTurno(c[1]);
    if (!fechaCalendarioCaja(dia) || !turno) { if (i === 0 && /^(d[ií]a|fecha)$/i.test(c[0]) && /^turno$/i.test(c[1])) return; errores.push({ linea: i + 1, texto: linea.slice(0, 80), error: "No se entiende el día o el turno." }); return; }
    const [sobre, taxi, sueldo, cambio] = [c[2], c[3], c[4], c[5]].map(celdaMonto);
    if ([sobre, taxi, sueldo, cambio].some(v => Number.isNaN(v))) { errores.push({ linea: i + 1, texto: linea.slice(0, 80), error: "Hay un monto que no es número." }); return; }
    filas.push({ linea: i + 1, dia, turno, sobre, taxi, sueldo, cambio });
  });
  return { filas, errores };
}
// Hora de fin del turno (UTC) para ordenar la entrega como si se hubiera hecho al terminar
const finTurnoIso = (dia, turno) => new Date(Date.parse(dia + "T00:00:00Z") + ((VENTANA[turno] || [0, 24])[1] + 6) * 3600e3).toISOString();
// Revisa (y si aplicar = true, guarda) las entregas. No toca los cortes entregados en la tablet; el sueldo o taxi
// que ya está como renglón en la hoja de ese turno no se vuelve a contar.
export async function entregasAdmin(env, textoTabla, { aplicar = false, meses, hoy, quien = null }) {
  const { filas, errores } = leerTablaEntregas(textoTabla, meses[meses.length - 1].slice(0, 4));
  const r2 = v => Math.round(v * 100) / 100;
  const dias = [...new Set(filas.map(f => f.dia))];
  const q = dias.map(() => "?").join(",") || "''";
  const cortes = new Map((dias.length ? (await env.DB.prepare(`SELECT dia, turno, admin FROM turno_cortes WHERE dia IN (${q})`).bind(...dias).all()).results : []).map(x => [x.dia + "|" + x.turno, x]));
  const hojaCaja = dias.length ? (await env.DB.prepare(`SELECT * FROM caja_mov WHERE tipo = 'caja' AND dia IN (${q})`).bind(...dias).all()).results : [];
  const enHoja = (dia, turno, re) => hojaCaja.filter(m => m.dia === dia && m.turno === turno && m.importe < 0 && re.test(sinAcento(m.folio + " " + m.cliente)));
  const vistas = new Set(), lista = [];
  for (const f of filas) {
    const k = f.dia + "|" + f.turno, x = { ...f, retiros: [], avisos: [] };
    if (vistas.has(k)) { x.estado = "repetida"; x.avisos.push("Este turno ya venía en otra línea; se toma la primera."); lista.push(x); continue; }
    vistas.add(k);
    if (!meses.includes(f.dia.slice(0, 7)) || f.dia > hoy) { x.estado = "fuera"; x.avisos.push("El día no está en el mes abierto."); lista.push(x); continue; }
    const ya = cortes.get(k);
    if (ya && !ya.admin) { x.estado = "tablet"; x.avisos.push("Este turno ya entregó su corte en la tablet; no se cambia."); lista.push(x); continue; }
    if (f.taxi > 0) { const h = enHoja(f.dia, f.turno, /TAXI/); if (h.length) x.avisos.push(`Taxi ${r2(-h[0].importe)} ya está en la hoja; no se cuenta otra vez.`); else x.retiros.push({ concepto: "Taxi", monto: f.taxi }); }
    if (f.sueldo > 0) { const h = enHoja(f.dia, f.turno, /SUELDO|NOMINA|SALARIO/); if (h.length) { x.avisos.push(`El sueldo ya está en la hoja (${conceptoHoja(h[0])} ${r2(-h[0].importe)}); no se cuenta otra vez.`); if (Math.abs(-h[0].importe - f.sueldo) >= 0.01) x.avisos.push(`Ojo: en la hoja dice ${r2(-h[0].importe)} y aquí ${f.sueldo}. Corrige el renglón de la hoja.`); } else x.retiros.push({ concepto: "Sueldo", monto: f.sueldo }); }
    if (f.sobre == null && !x.retiros.length && f.cambio == null) { x.estado = "vacia"; lista.push(x); continue; }
    x.estado = ya ? "reemplaza" : "nueva";
    x.efectivo = r2((f.sobre || 0) + x.retiros.reduce((a, r) => a + r.monto, 0) + (f.cambio || 0));
    lista.push(x);
  }
  const guardar = lista.filter(x => x.estado === "nueva" || x.estado === "reemplaza");
  if (aplicar && guardar.length) {
    const st = guardar.map(x => { const t = finTurnoIso(x.dia, x.turno); return env.DB.prepare(`INSERT INTO turno_cortes (dia, turno, mes, persona, efectivo, tarjeta, notas, creado, actualizado, veces, con_cambio, sobre, cambio_sig, retiros, admin)
      VALUES (?, ?, ?, 'Administración', ?, NULL, ?, ?, ?, 1, 1, ?, ?, ?, 1)
      ON CONFLICT (dia, turno) DO UPDATE SET efectivo = excluded.efectivo, notas = excluded.notas, sobre = excluded.sobre, cambio_sig = excluded.cambio_sig, retiros = excluded.retiros, veces = turno_cortes.veces + 1 WHERE turno_cortes.admin = 1`)
      .bind(x.dia, x.turno, x.dia.slice(0, 7), x.efectivo, "Capturado por la administración", t, t, x.sobre, x.cambio, JSON.stringify(x.retiros)); });
    st.push(stmtBitacora(env, { quien, accion: "crear", que: "Entregas de turnos (captura de administración)", ref: "entregas", mes: meses[meses.length - 1], detalle: { turnos: guardar.length, sobres: r2(guardar.reduce((a, x) => a + (x.sobre || 0), 0)), retiros: r2(guardar.reduce((a, x) => a + x.retiros.reduce((b, r) => b + r.monto, 0), 0)) } }));
    for (let i = 0; i < st.length; i += 50) await env.DB.batch(st.slice(i, i + 50));
    await numerarMovimientos(env, meses).catch(() => {});
  }
  const suma = k => r2(guardar.reduce((a, x) => a + (k === "retiros" ? x.retiros.reduce((b, r) => b + r.monto, 0) : x[k] || 0), 0));
  return { filas: lista, errores, totales: { turnos: guardar.length, sobre: suma("sobre"), retiros: suma("retiros"), taxi: r2(guardar.reduce((a, x) => a + x.retiros.filter(r => r.concepto === "Taxi").reduce((b, r) => b + r.monto, 0), 0)), sueldo: r2(guardar.reduce((a, x) => a + x.retiros.filter(r => r.concepto === "Sueldo").reduce((b, r) => b + r.monto, 0), 0)) }, aplicado: !!aplicar };
}

// ticket_ref "servicio:folio" de un ticket de la hoja del mes pagado por transferencia y sin otra transferencia ligada
// El vínculo cambia cuánto se reconoce como ingreso: nunca asociar tickets
// de importes distintos o folios ambiguos sin un modelo explícito de abonos.
export async function validarTicketRef(env, valor, mes, excepto, importe = null) {
  const v = String(valor ?? "").trim();
  if (!v) return null;
  const m = /^(bascula|pension):(.{1,40})$/.exec(v);
  if (!m) return { error: "Ticket inválido." };
  const t = (await env.DB.prepare("SELECT forma, importe FROM caja_mov WHERE mes = ? AND tipo = 'ticket' AND servicio = ? AND folio = ?").bind(mes, m[1], m[2]).all()).results;
  const pagados = t.filter(x => esTransf(x.forma));
  if (!pagados.length) return { error: "Ese ticket no está en la hoja de este mes como pagado por transferencia." };
  if (t.length !== 1 || pagados.length !== 1) return { error: "Hay varios tickets con ese folio. Revisa la hoja antes de vincular la transferencia; no se puede elegir uno con seguridad." };
  if (!(Number.isFinite(importe) && importe > 0))
    return { error: "Escribe un importe válido para comparar con el ticket." };
  if (Math.round(Number(pagados[0].importe) * 100) !== Math.round(importe * 100))
    return { error: "El importe de la transferencia no coincide con el ticket de la hoja. No los vincules: si es un abono parcial o varios tickets, hay que conciliarlo por separado." };
  const otra = await env.DB.prepare("SELECT cliente FROM caja_transf WHERE mes = ? AND ticket_ref = ? AND id != ?").bind(mes, v, excepto || "").first();
  if (otra) return { error: `Ese ticket ya está ligado a la transferencia de ${otra.cliente}.` };
  return { ref: v };
}

// Rutas del panel: /panel/api/caja...
export async function cajaPanel(request, env, url, partes, usuario, h) {
  await asegurarEsquemaCaja(env);
  await asegurarEsquemaCategorias(env);
  const meses = await mesesAbiertos(env), mes = meses[meses.length - 1];
  const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
  const diaValido = d => fechaCalendarioCaja(d) && meses.includes(d.slice(0, 7)) && d <= hoy;


  if (partes[1] === "pendiente" && partes[2] && partes[3] === "resolver" && request.method === "POST") {
    const id = decodeURIComponent(partes[2]);
    const fila = await env.DB.prepare("SELECT * FROM caja_pendientes WHERE id = ?").bind(id).first();
    if (!fila) return json({ ok: false, error: "No existe el cobro pendiente." }, 404);
    const c = await request.json().catch(() => ({}));
    const quien = usuario && usuario.email || null, ahora = new Date().toISOString();
    const notas = String(c.notas || "").trim().slice(0, 240) || null;
    const cobrados = await env.DB.prepare(`SELECT COALESCE(SUM(monto), 0) AS total FROM caja_cobros_admin
      WHERE pendiente_id = ? AND anulado = 0`).bind(id).first();
    const abonado = Math.round(Number(cobrados.total || 0) * 100) / 100;
    if (c.estado === "pagado") {
      if (fila.estado === "cancelado" || !fila.origen_activo)
        return json({ ok: false, error: "El cobro está cancelado o ya no figura pendiente en la hoja." }, 409);
      const fecha = String(c.fecha || ""), forma = String(c.forma || "");
      const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
      const pagoId = String(c.pago_id || "");
      if (!/^[0-9a-f-]{36}$/i.test(pagoId)) return json({ ok: false, error: "Falta el identificador de la operación." }, 422);
      // Un mismo identificador solo representa el MISMO cobro, con importe,
      // fecha y forma idénticos. No confirmar un reintento modificado o anulado.
      const reintento = async () => {
        const previo = await env.DB.prepare("SELECT pendiente_id, fecha_pago, monto, forma, anulado FROM caja_cobros_admin WHERE id = ?").bind(pagoId).first();
        if (!previo) return null;
        if (previo.pendiente_id !== id)
          return json({ ok: false, error: "Identificador de pago utilizado en otro pendiente." }, 409);
        if (previo.anulado)
          return json({ ok: false, error: "Este abono fue anulado. Actualiza el corte antes de registrar otro." }, 409);
        const igual = previo.fecha_pago === String(c.fecha || "") &&
          previo.forma === String(c.forma || "") &&
          centavosIguales(previo.monto, montoUsuario(c.monto));
        return igual
          ? json({ ok: true, estado: fila.estado, sin_cambios: true })
          : json({ ok: false, error: "Este identificador ya registró otro importe, fecha o forma de pago. Actualiza el corte antes de intentar de nuevo." }, 409);
      };
      const yaGuardado = await reintento();
      if (yaGuardado) return yaGuardado;
      const monto = montoUsuario(c.monto);
      const fechaReal = /^\d{4}-\d{2}-\d{2}$/.test(fecha) && !Number.isNaN(Date.parse(fecha + "T12:00:00Z"))
        && new Date(fecha + "T12:00:00Z").toISOString().slice(0, 10) === fecha;
      if (!fechaReal || fecha > hoy ||
          !(await mesesAbiertos(env)).includes(fecha.slice(0, 7)))
        return json({ ok: false, error: "Elige una fecha de cobro válida dentro de un mes abierto." }, 422);
      if (!FORMAS_GASTO.includes(forma))
        return json({ ok: false, error: "Elige efectivo, tarjeta o transferencia." }, 422);
      if (!(monto > 0) || monto > 100000000 || Math.round((abonado + monto) * 100) > Math.round(fila.monto * 100))
        return json({ ok: false, error: "El abono debe ser positivo y no superar el saldo por cobrar." }, 422);
      const restante = Math.round((fila.monto - abonado - monto) * 100) / 100;
      const estado = restante <= 0 ? "pagado" : "parcial";
      // La inserción comprueba el saldo dentro de la misma transacción de D1.
      // Dos formularios simultáneos no pueden registrar más dinero del adeudado.
      let resultados;
      try {
        resultados = await env.DB.batch([
        env.DB.prepare(`INSERT INTO caja_cobros_admin (id, pendiente_id, fecha_pago, mes, monto, forma, creado, por)
          SELECT ?, ?, ?, ?, ?, ?, ?, ?
          WHERE EXISTS (
            SELECT 1 FROM caja_pendientes p WHERE p.id = ? AND p.origen_activo = 1
              AND p.estado IN ('pendiente', 'parcial')
              AND ROUND(p.monto * 100) >= ROUND(? * 100) +
                ROUND(COALESCE((SELECT SUM(a.monto) FROM caja_cobros_admin a
                  WHERE a.pendiente_id = p.id AND a.anulado = 0), 0) * 100)
          )`).bind(pagoId, id, fecha, fecha.slice(0, 7), monto, forma, ahora, quien, id, monto),
        env.DB.prepare(`UPDATE caja_pendientes SET
          estado = CASE WHEN ROUND(COALESCE((SELECT SUM(a.monto) FROM caja_cobros_admin a
            WHERE a.pendiente_id = caja_pendientes.id AND a.anulado = 0), 0) * 100) >= ROUND(monto * 100)
            THEN 'pagado' ELSE 'parcial' END,
          resuelto = CASE WHEN ROUND(COALESCE((SELECT SUM(a.monto) FROM caja_cobros_admin a
            WHERE a.pendiente_id = caja_pendientes.id AND a.anulado = 0), 0) * 100) >= ROUND(monto * 100)
            THEN ? ELSE NULL END,
          por = ?, notas = ?
          WHERE id = ? AND EXISTS (SELECT 1 FROM caja_cobros_admin WHERE id = ?)`)
          .bind(ahora, quien, notas, id, pagoId),
        env.DB.prepare(`INSERT INTO caja_pendientes_hist (pendiente_id, anterior, nuevo, fecha, quien, notas)
          SELECT ?, ?, (SELECT estado FROM caja_pendientes WHERE id = ?), ?, ?, ?
          WHERE EXISTS (SELECT 1 FROM caja_cobros_admin WHERE id = ?)`)
          .bind(id, fila.estado, id, ahora, quien,
            [`Abono de ${monto.toFixed(2)} el ${fecha} por ${forma}`, notas].filter(Boolean).join(" · "), pagoId)
        ]);
      } catch (er) {
        // Una petición concurrente pudo insertar primero este UID.
        // Recuperar el éxito auténtico sin generar un segundo abono.
        const ya = await reintento();
        if (ya) return ya;
        throw er;
      }
      if (!resultados[0]?.meta?.changes)
        return json({ ok: false, error: "El saldo pendiente cambió; recarga el corte antes de registrar otro abono." }, 409);
      const saldoActual = await env.DB.prepare(`SELECT p.estado,
        COALESCE((SELECT SUM(a.monto) FROM caja_cobros_admin a WHERE a.pendiente_id = p.id AND a.anulado = 0), 0) AS abonado
        FROM caja_pendientes p WHERE p.id = ?`).bind(id).first();
      return json({ ok: true, estado: saldoActual.estado,
        abonado: Math.round(Number(saldoActual.abonado) * 100) / 100,
        resto: Math.max(0, Math.round((fila.monto - saldoActual.abonado) * 100) / 100),
        nota: "Abono contabilizado por su fecha y forma de pago." });
    }
    if (["conciliado", "cancelado", "pendiente"].includes(c.estado)) {
      const solicitado = c.estado;
      if (solicitado === "conciliado" && fila.origen_activo)
        return json({ ok: false, error: "La hoja sigue indicando PENDIENTE DE PAGO: primero registra el pago o corrige su origen." }, 409);
      if (solicitado === "cancelado" && abonado > 0 && fila.origen_activo)
        return json({ ok: false, error: "Ya existen abonos: anúlalos antes de cancelar el pendiente." }, 409);
      if (solicitado === "pendiente" && (abonado > 0 || !fila.origen_activo))
        return json({ ok: false, error: "Para reabrir, anula primero los abonos y comprueba que siga pendiente en la hoja." }, 409);
      if (fila.estado === solicitado)
        return json({ ok: true, estado: solicitado, sin_cambios: true });
      // Dos sesiones pueden leer el mismo estado. El cambio de estado y su
      // historial deben ser condicionales y atómicos, igual que los abonos.
      // Cancelar / reabrir no puede ganar si entró un abono mientras se leía.
      const condiciones = solicitado === "conciliado"
        ? "AND origen_activo = 0"
        : solicitado === "pendiente"
          ? "AND origen_activo = 1 AND NOT EXISTS (SELECT 1 FROM caja_cobros_admin a WHERE a.pendiente_id = caja_pendientes.id AND a.anulado = 0)"
          : "AND (origen_activo = 0 OR NOT EXISTS (SELECT 1 FROM caja_cobros_admin a WHERE a.pendiente_id = caja_pendientes.id AND a.anulado = 0))";
      const notaHist = solicitado === "conciliado"
        ? ["Comprobado en la hoja, sin asiento duplicado", notas].filter(Boolean).join(" · ")
        : notas;
      const resultado = await env.DB.batch([
        env.DB.prepare(`UPDATE caja_pendientes SET estado = ?, resuelto = ?, por = ?, notas = ?
          WHERE id = ? AND estado = ? ${condiciones}`)
          .bind(solicitado, solicitado === "pendiente" ? null : ahora, quien, notas, id, fila.estado),
        env.DB.prepare(`INSERT INTO caja_pendientes_hist (pendiente_id, anterior, nuevo, fecha, quien, notas)
          SELECT ?, ?, ?, ?, ?, ? WHERE changes() > 0`)
          .bind(id, fila.estado, solicitado, ahora, quien, notaHist)
      ]);
      if (!resultado[0]?.meta?.changes)
        return json({ ok: false, error: "El cobro o sus abonos cambiaron en otra sesión. Actualiza el corte antes de continuar." }, 409);
      return json({ ok: true, estado: solicitado });
    }
    if (c.estado === "anular-abono") {
      const pagoId = String(c.pago_id || "");
      const pago = await env.DB.prepare("SELECT * FROM caja_cobros_admin WHERE id = ? AND pendiente_id = ? AND anulado = 0")
        .bind(pagoId, id).first();
      if (!pago) return json({ ok: false, error: "No existe ese abono activo." }, 404);
      if (!(await mesesAbiertos(env)).includes(pago.mes))
        return json({ ok: false, error: "No se pueden modificar abonos de meses cerrados." }, 409);
      // La anulación, el saldo pendiente y su historial comparten transacción.
      // Dos sesiones no pueden anular el mismo pago ni crear una segunda entrada.
      const resultados = await env.DB.batch([
        env.DB.prepare(`UPDATE caja_cobros_admin SET anulado = 1, anulado_por = ?, anulado_en = ?
          WHERE id = ? AND pendiente_id = ? AND anulado = 0
            AND EXISTS (SELECT 1 FROM caja_pendientes WHERE id = ?)`).bind(quien, ahora, pagoId, id, id),
        // Recalcular desde los abonos realmente activos dentro del lote:
        // una nueva captura concurrente no puede dejar estado/importe obsoletos.
        env.DB.prepare(`UPDATE caja_pendientes SET
          estado = CASE WHEN EXISTS (
            SELECT 1 FROM caja_cobros_admin a
            WHERE a.pendiente_id = caja_pendientes.id AND a.anulado = 0
          ) THEN 'parcial' ELSE 'pendiente' END,
          resuelto = NULL, por = ?, notas = ?
          WHERE id = ? AND changes() > 0`).bind(quien, notas, id),
        env.DB.prepare(`INSERT INTO caja_pendientes_hist (pendiente_id, anterior, nuevo, fecha, quien, notas)
          SELECT ?, ?, (SELECT estado FROM caja_pendientes WHERE id = ?), ?, ?, ?
          WHERE changes() > 0`).bind(id, fila.estado, id, ahora, quien,
            [`Anulado abono de $${Number(pago.monto).toFixed(2)} (${pago.forma}, ${pago.fecha_pago})`, notas].filter(Boolean).join(" · "))
      ]);
      if (!resultados[0]?.meta?.changes)
        return json({ ok: false, error: "El abono ya fue anulado en otra sesión. Actualiza el corte." }, 409);
      const actual = await env.DB.prepare(`SELECT p.estado,
        COALESCE((SELECT SUM(a.monto) FROM caja_cobros_admin a
          WHERE a.pendiente_id = p.id AND a.anulado = 0), 0) AS abonado
        FROM caja_pendientes p WHERE p.id = ?`).bind(id).first();
      return json({ ok: true, estado: actual.estado, abonado: Math.round(Number(actual.abonado || 0) * 100) / 100 });
    }
    return json({ ok: false, error: "Operación no reconocida." }, 422);
  }

  if (partes[1] === "pendientes" && request.method === "GET") {
    const pendientes = (await env.DB.prepare(`SELECT p.id, p.servicio, p.fecha, p.dia, p.turno, p.folio, p.cliente, p.monto, p.forma, p.origen_activo,
      (SELECT COALESCE(SUM(a.monto), 0) FROM caja_cobros_admin a
       WHERE a.pendiente_id = p.id AND a.anulado = 0) AS abonado
      FROM caja_pendientes p WHERE p.estado IN ('pendiente', 'parcial')
      ORDER BY fecha ASC LIMIT 100`).all()).results;
    return json({ ok: true, pendientes });
  }

  if (partes.length === 1 && request.method === "GET") {
    const periodo = leerPeriodo(url);
    // Hoy sólo necesita resumen, no folios/catálogos/tabla de movimientos.
    const esResumenHoy = url.searchParams.get("resumen") === "1";
    // Las fuentes son independientes: no encadenar lecturas de D1, KV y
    // categorías cuando todas pueden comenzar juntas.
    const [{ movs, gastos, transf, conteos, extras, inicios }, sync, pendientes, cobros, categorias] = await Promise.all([
      leerMes(env, meses, periodo),
      env.FILES.get("caja:sync", { type: "json" }),
      env.DB.prepare(`SELECT p.id, p.servicio, p.fecha, p.dia, p.turno, p.folio, p.cliente, p.monto, p.forma, p.origen_activo,
        (SELECT COALESCE(SUM(a.monto), 0) FROM caja_cobros_admin a
         WHERE a.pendiente_id = p.id AND a.anulado = 0) AS abonado
        FROM caja_pendientes p WHERE p.estado IN ('pendiente', 'parcial')
        ORDER BY fecha ASC LIMIT 100`).all().then(r => r.results),
      leerCobrosAdmin(env, periodo.desde || periodo.hasta ? periodo : { desde: mes + "-01", hasta: mes + "-31" }),
      esResumenHoy ? Promise.resolve(null) : listaCategorias(env)
    ]);
    const cortes = ponerCambioTurnos(unirConteos(calcularCortes(movs, gastos, extras, inicios), conteos), conteos, inicios);
    const tr = transferenciasMes(movs, transf);
    // El camino ligero evita numeraciones de folios, escrituras y catálogos.
    // Conserva todas las fuentes en vivo que utiliza Hoy y sus alertas.
    if (esResumenHoy) {
      const ayer = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(Date.now() - 86400e3));
      const gastosRecientes = gastos.filter(g => g.dia >= ayer).map(g => ({
        dia: g.dia, turno: g.turno, concepto: g.concepto, monto: g.monto,
        forma: g.forma, persona: g.persona || null, creado: g.creado
      }));
      return json({ ok: true, mes, sync, pendientes, cobros, cortes,
        transferencias: transf, transf_hoja: tr.hoja, gastos_recientes: gastosRecientes,
        conectado: !!(env.INGRESOS_URL && env.INGRESOS_TOKEN) });
    }
    const movimientos = await conFolios(env, movimientosCaja({ movs, gastos, extras, conteos }));
    // Gastos sueltos de hoy y ayer (para el Inicio: quién los capturó y cuánto)
    const ayer = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(Date.now() - 86400e3));
    const gastosRecientes = gastos.filter(g => g.dia >= ayer).map(g => ({ dia: g.dia, turno: g.turno, concepto: g.concepto, monto: g.monto, forma: g.forma, persona: g.persona || null, creado: g.creado }));

    const totales = totalesMes(cortes, tr.contadas);
    for (const x of cobros) {
      totales.ingresos += x.monto;
      if (x.forma === "EFECTIVO") totales.efectivo += x.monto;
      else if (x.forma === "TARJETA") totales.tarjeta += x.monto;
      else totales.transferencias += x.monto;
      totales[x.servicio] += x.monto;
    }
    return json({ ok: true, mes, meses, periodo, sync, pendientes, cobros, totales, cortes, movimientos, transferencias: transf, transf_hoja: tr.hoja, gastos_recientes: gastosRecientes, categorias, conectado: !!(env.INGRESOS_URL && env.INGRESOS_TOKEN), turnos: TURNOS, formas_gasto: FORMAS_GASTO, conceptos_extra: CONCEPTOS_EXTRA });
  }

  if (partes[1] === "corte" && request.method === "GET") {
    const dia = url.searchParams.get("dia") || "", turno = url.searchParams.get("turno") || "";
    const ant = turnoAnterior(dia, turno), sig = turnoSiguiente(dia, turno);
    const get = (sql, ...params) => env.DB.prepare(sql).bind(...params).all().then(r => r.results);
    const [movs, gastos, pendientes, conteos, extras, inicios, conteoAnt, inicioSig, historialFilas] = await Promise.all([
      get("SELECT * FROM caja_mov WHERE dia = ? AND turno = ? ORDER BY fecha ASC", dia, turno),
      get(`SELECT * FROM caja_gastos WHERE dia = ? AND turno = ? AND ${DE_CAJA} ORDER BY creado ASC`, dia, turno),
      get("SELECT * FROM caja_pendientes WHERE dia = ? AND turno = ? ORDER BY fecha ASC", dia, turno),
      get("SELECT * FROM turno_cortes WHERE dia = ? AND turno = ?", dia, turno),
      get("SELECT * FROM caja_extra WHERE dia = ? AND turno = ? ORDER BY creado ASC", dia, turno),
      get("SELECT * FROM turno_inicio WHERE dia = ? AND turno = ?", dia, turno),
      ant ? get("SELECT * FROM turno_cortes WHERE dia = ? AND turno = ?", ant.dia, ant.turno) : Promise.resolve([]),
      sig ? get("SELECT * FROM turno_inicio WHERE dia = ? AND turno = ?", sig.dia, sig.turno) : Promise.resolve([]),
      get("SELECT * FROM turno_cortes_hist WHERE dia = ? AND turno = ? ORDER BY creado ASC", dia, turno)
    ]);
    // Las consultas de abonos también son independientes entre pendientes.
    await Promise.all(pendientes.map(async p => {
      p.abonos = await get(`SELECT id, monto, fecha_pago, forma, por, creado, anulado
        FROM caja_cobros_admin WHERE pendiente_id = ? ORDER BY creado ASC`, p.id);
      p.abonado = Math.round(p.abonos.filter(x => !x.anulado).reduce((a, x) => a + x.monto, 0) * 100) / 100;
    }));
    const corte = unirConteos(calcularCortes(movs, gastos, extras, inicios), conteos)[0] || null;
    if (corte) {
      corte.cambio_turno = cambiosEntreTurnos(conteoAnt, inicios).get(dia + "|" + turno) || null;
      corte.cambio_siguiente = cambiosEntreTurnos(conteos, inicioSig).get(sig.dia + "|" + sig.turno) || null;
    }
    const historial = historialFilas.map(x => { let d = {}; try { d = JSON.parse(x.datos); } catch {} return { persona: x.persona, creado: x.creado, ...d }; });
    // Folio de cada movimiento de caja del corte (gastos, ingresos extra, retiros y renglones de la hoja sin ticket)
    const folios = Object.fromEntries((await conFolios(env, movimientosCaja({ movs: movs.map(m => ({ ...m, mes: m.mes || dia.slice(0, 7) })), gastos, extras, conteos }))).map(x => [x.ref, x.folio]));
    const vistos = new Map();
    for (const m of movs.filter(m => m.tipo === "caja" && !esCambio(m)).sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)) || (a.id || 0) - (b.id || 0))) { const f = firmaMov(m), k = vistos.get(f) || 0; vistos.set(f, k + 1); m.folio_mc = folios["m:" + f + "#" + k] || null; }
    for (const g of gastos) g.folio_mc = folios["g:" + g.id] || null;
    for (const x of extras) x.folio_mc = folios["x:" + x.id] || null;
    const folRet = conteos[0] ? leerRetiros(conteos[0].retiros).map((r, i) => folios[`r:${dia}|${turno}|${i}`] || null) : [];
    return json({ ok: true, corte, movs, pendientes, gastos, extras, historial, folios_retiros: folRet, formas_contadas: FORMAS_CONTADAS, conceptos_extra: CONCEPTOS_EXTRA });
  }

  if (partes[1] === "sincronizar" && request.method === "POST") {
    const estado = await sincronizarCaja(env);
    if (estado.error && estado.error_at && (!estado.at || estado.error_at > estado.at)) return json({ ok: false, error: estado.error }, 502);
    return json({ ok: true, sync: estado });
  }

  if (partes[1] === "gastos" && partes.length === 2 && request.method === "POST") {
    let c; try { c = await request.json(); } catch { return json({ ok: false, error: "Datos inválidos." }, 400); }
    const dia = String(c.dia || ""), turno = normTurno(c.turno), concepto = texto(c.concepto, 120), monto = montoUsuario(c.monto), forma = "EFECTIVO"; // gasto de caja: sale del efectivo del turno
    const errores = {};
    if (!diaValido(dia)) errores.dia = "Elige un día del mes actual (no futuro).";
    if (!turno) errores.turno = "Elige el turno.";
    if (concepto.length < 2) errores.concepto = "Escribe en qué se gastó.";
    if (!(monto > 0) || monto > 1000000) errores.monto = "Escribe un monto válido.";
    if (!FORMAS_GASTO.includes(forma)) errores.forma = "Forma de pago inválida.";
    if (Object.keys(errores).length) return json({ ok: false, error: "Revisa los datos del gasto.", errores }, 422);
    const quien = usuario && usuario.email || null;
    let id; try { id = await idFinanciero("gasto-turno-admin", c.uid, quien); }
    catch (er) { return json({ok:false,error:er.message},422); }
    const cat = (await resolverCategoria(env, c.categoria)) || adivinarCategoria(concepto);
    const repetido = async () => {
      const g = c.uid ? await env.DB.prepare("SELECT * FROM caja_gastos WHERE id = ?").bind(id).first() : null;
      if (!g) return null;
      const igual = g.dia === dia && g.turno === turno && g.concepto === concepto
        && centavosIguales(g.monto, monto) && g.forma === forma
        && (g.categoria || null) === (cat || null) && g.origen === "caja";
      return igual ? json({ok:true,id,repetido:true}) :
        json({ok:false,error:"Este gasto ya fue registrado con otros datos. Revisa el corte antes de repetir."},409);
    };
    const previo = await repetido(); if (previo) return previo;
    const fueEliminado = async () => !!(await env.DB.prepare(
      "SELECT 1 FROM fin_bitacora WHERE ref = ? AND accion = 'borrar' AND que = 'Gasto de caja' LIMIT 1"
    ).bind(id).first());
    if (await fueEliminado())
      return json({ok:false,error:"Ese gasto fue eliminado. Actualiza el corte antes de capturar otro."},409);
    try {
      const resultado = await env.DB.batch([
        env.DB.prepare(`INSERT INTO caja_gastos (id, mes, dia, turno, concepto, monto, forma, creado, creado_por, origen, categoria)
          SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, 'caja', ?
          WHERE NOT EXISTS (SELECT 1 FROM fin_bitacora WHERE ref = ? AND accion = 'borrar' AND que = 'Gasto de caja')`)
          .bind(id, dia.slice(0, 7), dia, turno, concepto, monto, forma, new Date().toISOString(), quien, cat, id),
        stmtBitacoraSiCambio(env, { quien, accion:"crear", que:"Gasto de caja", ref:id, mes:dia.slice(0,7), detalle:{dia,turno,concepto,monto,forma,categoria:cat} })
      ]);
      if (!resultado[0]?.meta?.changes)
        return json({ok:false,error:"Ese gasto fue eliminado en otra sesión. Actualiza Caja."},409);
    } catch (er) {
      const ya = await repetido(); if (ya) return ya;
      throw er;
    }
    return json({ ok: true, id });
  }

  if (partes[1] === "gastos" && partes[3] === "eliminar" && request.method === "POST") {
    const g = await env.DB.prepare(`SELECT * FROM caja_gastos WHERE id = ? AND ${DE_CAJA}`).bind(partes[2]).first();
    if (!g) return json({ ok: true, borrados: 0 });
    if (!meses.includes(g.mes)) return json({ ok: false, error: "Ese gasto es de un mes ya cerrado; ya no se puede borrar." }, 409);
    const r = (await env.DB.batch([
      env.DB.prepare(`DELETE FROM caja_gastos WHERE id = ? AND ${DE_CAJA}`).bind(g.id),
      stmtBitacoraSiCambio(env, { quien: usuario && usuario.email, accion: "borrar", que: "Gasto de caja", ref: g.id, mes: g.mes, detalle: { dia: g.dia, turno: g.turno, concepto: g.concepto, monto: g.monto, persona: g.persona || g.creado_por } })
    ]))[0];
    if (r.meta?.changes && g.foto) await borrarArchivo(env, g.foto).catch(() => {});
    return json({ ok: true, borrados: r.meta && r.meta.changes || 0 });
  }

  // Entregas de turnos capturadas por la administración: revisar (aplicar: false) o guardar
  if (partes[1] === "entregas-admin" && partes.length === 2 && request.method === "POST") {
    let c; try { c = await request.json(); } catch { return json({ ok: false, error: "Datos inválidos." }, 400); }
    if (String(c.texto || "").length > 20000) return json({ ok: false, error: "La tabla es demasiado larga." }, 413);
    return json({ ok: true, ...(await entregasAdmin(env, c.texto, { aplicar: c.aplicar === true, meses, hoy, quien: usuario && usuario.email })) });
  }
  if (partes[1] === "entregas-admin" && partes[2] === "eliminar" && request.method === "POST") {
    let c; try { c = await request.json(); } catch { return json({ ok: false, error: "Datos inválidos." }, 400); }
    const x = await env.DB.prepare("SELECT * FROM turno_cortes WHERE dia = ? AND turno = ? AND admin = 1").bind(String(c.dia || ""), String(c.turno || "")).first();
    if (!x) return json({ ok: true, borrados: 0 });
    if (!meses.includes(x.mes)) return json({ ok: false, error: "Esa entrega es de un mes ya cerrado." }, 409);
    const resultados = await env.DB.batch([
      env.DB.prepare("DELETE FROM turno_cortes WHERE dia = ? AND turno = ? AND admin = 1").bind(x.dia, x.turno),
      stmtBitacoraSiCambio(env, { quien: usuario && usuario.email, accion: "borrar", que: "Entrega de turno (captura de administración)", ref: x.dia + "|" + x.turno, mes: x.mes, detalle: { sobre: x.sobre, cambio_sig: x.cambio_sig, retiros: leerRetiros(x.retiros) } })
    ]);
    return json({ ok: true, borrados: Number(resultados[0]?.meta?.changes || 0) });
  }

  // Ingresos extra capturados desde el panel
  if (partes[1] === "extras" && partes.length === 2 && request.method === "POST") {
    let c; try { c = await request.json(); } catch { return json({ ok: false, error: "Datos inválidos." }, 400); }
    const dia = String(c.dia || ""), turno = normTurno(c.turno), concepto = CONCEPTOS_EXTRA.includes(c.concepto) ? c.concepto : "", detalle = texto(c.detalle, 120), monto = montoUsuario(c.monto);
    const errores = {};
    if (!diaValido(dia)) errores.dia = "Elige un día del mes actual (no futuro).";
    if (!turno) errores.turno = "Elige el turno.";
    if (!concepto) errores.concepto = "Elige el concepto.";
    if (!(monto > 0) || monto > 1000000) errores.monto = "Escribe un monto válido.";
    if (Object.keys(errores).length) return json({ ok: false, error: "Revisa los datos del ingreso.", errores }, 422);
    const quien = usuario && usuario.email || null;
    let id; try { id = await idFinanciero("extra-turno-admin", c.uid, quien); }
    catch (er) { return json({ok:false,error:er.message},422); }
    const ingreso = cuentaComoIngreso(concepto) ? 1 : 0;
    const repetido = async () => {
      const x = c.uid ? await env.DB.prepare("SELECT * FROM caja_extra WHERE id = ?").bind(id).first() : null;
      if (!x) return null;
      const igual = x.dia === dia && x.turno === turno && x.concepto === concepto
        && (x.detalle || null) === (detalle || null) && centavosIguales(x.monto, monto)
        && Number(x.ingreso) === ingreso;
      return igual ? json({ok:true,id,repetido:true}) :
        json({ok:false,error:"Este ingreso extra ya fue registrado con otros datos. Revisa el corte antes de repetir."},409);
    };
    const previo = await repetido(); if (previo) return previo;
    const fueEliminado = async () => !!(await env.DB.prepare(
      "SELECT 1 FROM fin_bitacora WHERE ref = ? AND accion = 'borrar' AND que = 'Ingreso extra de caja' LIMIT 1"
    ).bind(id).first());
    if (await fueEliminado())
      return json({ok:false,error:"Ese ingreso fue eliminado. Actualiza Caja antes de capturar otro."},409);
    try {
      const resultado = await env.DB.batch([
        env.DB.prepare(`INSERT INTO caja_extra (id, mes, dia, turno, concepto, detalle, monto, ingreso, creado, creado_por)
          SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
          WHERE NOT EXISTS (SELECT 1 FROM fin_bitacora WHERE ref = ? AND accion = 'borrar' AND que = 'Ingreso extra de caja')`)
          .bind(id, dia.slice(0, 7), dia, turno, concepto, detalle || null, monto, ingreso, new Date().toISOString(), quien, id),
        stmtBitacoraSiCambio(env, { quien, accion:"crear", que:"Ingreso extra de caja", ref:id, mes:dia.slice(0,7), detalle:{dia,turno,concepto,detalle,monto,ingreso} })
      ]);
      if (!resultado[0]?.meta?.changes)
        return json({ok:false,error:"Ese ingreso fue eliminado en otra sesión. Actualiza Caja."},409);
    } catch (er) {
      const ya = await repetido(); if (ya) return ya;
      throw er;
    }
    return json({ ok: true, id });
  }
  if (partes[1] === "extras" && partes[3] === "eliminar" && request.method === "POST") {
    const x = await env.DB.prepare("SELECT * FROM caja_extra WHERE id = ?").bind(partes[2]).first();
    if (!x) return json({ ok: true, borrados: 0 });
    if (x.id === idAumentoInicio(x.dia, x.turno))
      return json({ ok: false, error: "Este aporte proviene de sobres. Corrígelo desde el inicio de turno, antes de entregar el corte." }, 409);
    if (!meses.includes(x.mes)) return json({ ok: false, error: "Ese ingreso es de un mes ya cerrado; ya no se puede borrar." }, 409);
    const r = (await env.DB.batch([
      env.DB.prepare("DELETE FROM caja_extra WHERE id = ?").bind(x.id),
      stmtBitacoraSiCambio(env, { quien: usuario && usuario.email, accion: "borrar", que: "Ingreso extra de caja", ref: x.id, mes: x.mes, detalle: { dia: x.dia, turno: x.turno, concepto: x.concepto, detalle: x.detalle, monto: x.monto, persona: x.persona || x.creado_por } })
    ]))[0];
    if (r.meta?.changes && x.foto) await borrarArchivo(env, x.foto).catch(() => {});
    return json({ ok: true, borrados: r.meta && r.meta.changes || 0 });
  }

  if (partes[1] === "transferencias" && partes.length === 2 && request.method === "POST") {
    let c; try { c = await request.json(); } catch { return json({ ok: false, error: "Datos inválidos." }, 400); }
    const fecha = String(c.fecha || ""), cliente = texto(c.cliente, 120), importe = montoUsuario(c.importe), factura = texto(c.factura, 60);
    const errores = {};
    const fechaReal = /^\d{4}-\d{2}-\d{2}$/.test(fecha) &&
      Number.isFinite(Date.parse(fecha + "T12:00:00Z")) &&
      new Date(fecha + "T12:00:00Z").toISOString().slice(0, 10) === fecha;
    if (!fechaReal || fecha.slice(0, 7) !== mes || fecha > hoy)
      errores.fecha = "Elige una fecha válida del mes actual, no futura.";
    if (cliente.length < 2) errores.cliente = "Escribe el nombre del cliente.";
    if (!(importe > 0) || importe > 10000000) errores.importe = "Escribe un importe válido.";
    if (Object.keys(errores).length) return json({ ok: false, error: "Revisa los datos de la transferencia.", errores }, 422);
    const quien = usuario && usuario.email || null;
    let id;
    try { id = await idFinanciero("transferencia-cliente", c.uid, quien); }
    catch (er) { return json({ ok: false, error: er.message }, 422); }
    // Cuenta a la que llegó. Nunca sustituir silenciosamente una cuenta
    // seleccionada pero inválida o desactivada por otra cuenta: movería el
    // ingreso al banco equivocado sin que el administrador lo advirtiera.
    await asegurarEsquemaCuentas(env);
    const cuentaElegida = c.cuenta == null ? "" : String(c.cuenta).trim();
    const cta = cuentaElegida || await cuentaDefecto(env, "transf");
    const solicitada = String(c.ticket_ref || "").trim() || null;
    const repetida = async () => {
      const x = c.uid ? await env.DB.prepare("SELECT * FROM caja_transf WHERE id = ?").bind(id).first() : null;
      if (!x) return null;
      const igual = x.fecha === fecha && x.cliente === cliente && centavosIguales(x.importe, importe)
        && (x.factura || null) === (factura || null) && (x.cuenta || null) === (cta || null)
        && (x.ticket_ref || null) === solicitada;
      return igual ? json({ ok: true, id, repetido: true }) :
        json({ ok: false, error: "Esta transferencia ya se registró con otros datos. Actualiza la lista para revisarla." }, 409);
    };
    const ya = await repetida(); if (ya) return ya;
    // Una respuesta de red tardía no debe recrear transferencias eliminadas.
    const fueEliminada = async () => !!(await env.DB.prepare(
      "SELECT 1 FROM fin_bitacora WHERE ref = ? AND accion = 'borrar' AND que = 'Transferencia de cliente' LIMIT 1"
    ).bind(id).first());
    if (await fueEliminada())
      return json({ok:false,error:"Esta transferencia fue eliminada. Actualiza Finanzas antes de capturar otra."},409);
    // Un reintento del MISMO UID se reconoce antes de validar la cuenta activa:
    // si fue desactivada después de guardar, el reintento no debe duplicar ni fallar.
    if (cuentaElegida) {
      const elegida = await env.DB.prepare("SELECT id FROM fin_cuentas WHERE id = ? AND tipo = 'debito' AND activa = 1")
        .bind(cuentaElegida).first();
      if (!elegida) return json({
        ok:false,error:"La cuenta elegida no está disponible. Actualiza Finanzas y selecciona una cuenta de débito activa.",
        errores:{cuenta:"Elige una cuenta de débito activa."}
      },422);
    }
    // Ticket de la hoja pagado por transferencia al que corresponde (opcional)
    const ref = await validarTicketRef(env, c.ticket_ref, mes, null, importe);
    if (ref && ref.error) return json({ ok: false, error: ref.error, errores: { ticket_ref: ref.error } }, 422);
    try {
      // Comprobaciones definitivas dentro del mismo INSERT: si otra sesión
      // desactiva la cuenta o liga el ticket entre validación y escritura,
      // ninguna transferencia ni bitácora queda contabilizada.
      const condiciones = [];
      if (cta) condiciones.push("EXISTS (SELECT 1 FROM fin_cuentas WHERE id = ? AND tipo = 'debito' AND activa = 1)");
      if (ref) condiciones.push("NOT EXISTS (SELECT 1 FROM caja_transf WHERE mes = ? AND ticket_ref = ?)");
      condiciones.push("NOT EXISTS (SELECT 1 FROM fin_bitacora WHERE ref = ? AND accion = 'borrar' AND que = 'Transferencia de cliente')");
      const sql = condiciones.length
        ? `INSERT INTO caja_transf (id, mes, fecha, cliente, importe, factura, creado, creado_por, cuenta, ticket_ref)
            SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${condiciones.join(" AND ")}`
        : "INSERT INTO caja_transf (id, mes, fecha, cliente, importe, factura, creado, creado_por, cuenta, ticket_ref) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
      const parametros = [id, mes, fecha, cliente, importe, factura || null, new Date().toISOString(), quien, cta, ref ? ref.ref : null];
      if (cta) parametros.push(cta);
      if (ref) parametros.push(mes, ref.ref);
      parametros.push(id);
      const detalle = { fecha, cliente, importe, cuenta: cta, ticket: ref ? ref.ref : null };
      const resultados = await env.DB.batch([
        env.DB.prepare(sql).bind(...parametros),
        condiciones.length ? stmtBitacoraSiCambio(env, { quien, accion: "crear", que: "Transferencia de cliente", ref: id, mes, detalle })
          : stmtBitacora(env, { quien, accion: "crear", que: "Transferencia de cliente", ref: id, mes, detalle })
      ]);
      if (!resultados[0]?.meta?.changes)
        return json({ok:false,error:await fueEliminada()
          ? "Esta transferencia fue eliminada en otra sesión. Actualiza Finanzas."
          : "El ticket ya fue vinculado o la cuenta bancaria cambió en otra sesión. Actualiza la lista antes de repetir."},409);
    } catch (er) {
      const ya = await repetida(); if (ya) return ya;
      throw er;
    }
    return json({ ok: true, id });
  }

  if (partes[1] === "transferencias" && partes[3] === "eliminar" && request.method === "POST") {
    const x = await env.DB.prepare("SELECT * FROM caja_transf WHERE id = ? AND mes = ?").bind(partes[2], mes).first();
    if (!x) return json({ ok: false, error: "Esa transferencia no existe o es de un mes ya cerrado." }, 409);
    // Compare-and-delete: una sesión no puede borrar silenciosamente una
    // transferencia que otra acaba de vincular o desvincular.
    const resultado = await env.DB.batch([
      env.DB.prepare("DELETE FROM caja_transf WHERE id = ? AND mes = ? AND COALESCE(ticket_ref, '') = ?").bind(x.id, x.mes, x.ticket_ref || ""),
      stmtBitacoraSiCambio(env, { quien: usuario && usuario.email, accion: "borrar", que: "Transferencia de cliente", ref: x.id, mes: x.mes, detalle: { fecha: x.fecha, cliente: x.cliente, importe: x.importe, cuenta: x.cuenta, ticket: x.ticket_ref } })
    ]);
    if (!resultado[0]?.meta?.changes)
      return json({ ok: false, error: "La transferencia cambió en otra sesión. Actualiza la lista antes de borrarla." }, 409);
    return json({ ok: true, borrados: 1 });
  }

  // Ligar (o desligar con ticket_ref vacío) una transferencia capturada a mano con su ticket de la hoja
  if (partes[1] === "transferencias" && partes[3] === "ligar" && request.method === "POST") {
    let c; try { c = await request.json(); } catch { return json({ ok: false, error: "Datos inválidos." }, 400); }
    const x = await env.DB.prepare("SELECT * FROM caja_transf WHERE id = ? AND mes = ?").bind(partes[2], mes).first();
    if (!x) return json({ ok: false, error: "Esa transferencia no existe o es de un mes ya cerrado." }, 409);
    const ref = await validarTicketRef(env, c.ticket_ref, mes, x.id, Number(x.importe));
    if (ref && ref.error) return json({ ok: false, error: ref.error }, 422);
    const solicitado = ref ? ref.ref : null;
    if ((x.ticket_ref || null) === solicitado) return json({ok:true,sin_cambios:true});
    // La misma sentencia comprueba que el ticket sigue disponible Y que este
    // registro no fue modificado por otra sesión mientras estaba abierto.
    const sql = ref
      ? `UPDATE caja_transf SET ticket_ref = ? WHERE id = ? AND mes = ?
         AND COALESCE(ticket_ref, '') = ?
         AND NOT EXISTS (SELECT 1 FROM caja_transf WHERE mes = ? AND ticket_ref = ? AND id != ?)`
      : "UPDATE caja_transf SET ticket_ref = NULL WHERE id = ? AND mes = ? AND COALESCE(ticket_ref, '') = ?";
    const anterior = x.ticket_ref || "";
    const params = ref ? [ref.ref, x.id, mes, anterior, mes, ref.ref, x.id] : [x.id, mes, anterior];
    const resultados = await env.DB.batch([
      env.DB.prepare(sql).bind(...params),
      stmtBitacoraSiCambio(env, { quien: usuario && usuario.email, accion: "editar",
        que: "Transferencia de cliente", ref: x.id, mes:x.mes,
        detalle: { cliente: x.cliente, importe:x.importe, ticket_antes:x.ticket_ref, ticket:ref ? ref.ref : null } })
    ]);
    if (!resultados[0]?.meta?.changes)
      return json({ ok:false,error:"El vínculo cambió en otra sesión o ya no está disponible. Actualiza antes de intentarlo nuevamente." },409);
    return json({ ok: true });
  }

  return json({ ok: false, error: "Ruta no encontrada." }, 404);
}
