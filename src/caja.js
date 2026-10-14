// Ingresos y gastos por corte de turno.
// Los ingresos vienen de la hoja de Google (pestañas FORBAS y FORPEN) por medio del script
// herramientas/ingresos-hoja.gs. Solo se guarda el mes actual; al cambiar de mes se envía
// el respaldo en Excel por correo y se borra el mes anterior.

const TZ = "America/Mexico_City";
export const TURNOS = ["MAÑANA", "TARDE", "NOCHE"];
// Horario de cada turno (horas desde el inicio del día del corte)
const VENTANA = { "MAÑANA": [6, 14], "TARDE": [14, 22], "NOCHE": [22, 30] };
// Solo estas formas de pago suman en el corte
export const FORMAS_CONTADAS = ["EFECTIVO", "TARJETA"];
const FORMAS_GASTO = ["EFECTIVO", "TARJETA", "TRANSFERENCIA"];

const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });

export function mesActual(ahora = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit" }).format(ahora).slice(0, 7);
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
const numero = v => { const n = Number(String(v ?? "").replace(/[$,\s]/g, "")); return isFinite(n) ? Math.round(n * 100) / 100 : 0; };
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
    env.DB.prepare("CREATE INDEX IF NOT EXISTS caja_gastos_mes ON caja_gastos (mes, dia)")
  ]);
  esquemaListo = true;
}

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
  if (!d.ok) throw new Error("La hoja rechazó la consulta: " + texto(d.error, 120));
  const limpiar = (lista, servicio) => (Array.isArray(lista) ? lista : []).map(x => {
    const turno = normTurno(x.turno);
    const fecha = texto(x.fecha, 19);
    const folio = texto(x.folio, 60);
    return {
      // Sin folio numérico es un movimiento de caja (cambio, retiro, sueldo, compra), no un ticket
      tipo: /^\s*\d/.test(folio) ? "ticket" : "caja",
      servicio, fecha, turno: turno || "SIN TURNO", dia: diaDelCorte(fecha, turno) || fecha.slice(0, 10),
      folio: folio.slice(0, 40), matricula: texto(x.matricula, 20).toUpperCase(), cliente: texto(x.cliente, 80),
      importe: numero(x.importe), forma: normForma(x.forma) || "SIN FORMA"
    };
  }).filter(x => /^\d{4}-\d{2}-\d{2}T/.test(x.fecha));
  return [...limpiar(d.bascula, "bascula"), ...limpiar(d.pension, "pension")];
}

// Reemplaza los ingresos guardados por los del mes actual (en una sola transacción)
export async function sincronizarCaja(env) {
  await asegurarEsquemaCaja(env);
  const mes = mesActual();
  try {
    const filas = await leerHoja(env, mes);
    const stmts = [env.DB.prepare("DELETE FROM caja_mov")];
    const COLS = 11, POR = 9; // D1 admite hasta 100 parámetros por consulta
    for (let i = 0; i < filas.length; i += POR) {
      const lote = filas.slice(i, i + POR);
      stmts.push(env.DB.prepare(`INSERT INTO caja_mov (servicio, fecha, dia, turno, folio, matricula, cliente, importe, forma, mes, tipo) VALUES ${lote.map(() => "(" + Array(COLS).fill("?").join(",") + ")").join(",")}`)
        .bind(...lote.flatMap(f => [f.servicio, f.fecha, f.dia, f.turno, f.folio, f.matricula, f.cliente, f.importe, f.forma, mes, f.tipo])));
    }
    await env.DB.batch(stmts);
    const estado = { at: new Date().toISOString(), n: filas.length, error: null };
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
export function calcularCortes(movs, gastos) {
  const cortes = new Map();
  const corte = (dia, turno) => {
    const k = dia + "|" + turno;
    if (!cortes.has(k)) cortes.set(k, {
      dia, turno, bascula: { EFECTIVO: 0, TARJETA: 0 }, pension: { EFECTIVO: 0, TARJETA: 0 },
      fuera: { n: 0, importe: 0, formas: {} }, caja: { n: 0, importe: 0 }, gastos: { EFECTIVO: 0, TARJETA: 0, TRANSFERENCIA: 0 }, registros: 0, n_gastos: 0
    });
    return cortes.get(k);
  };
  for (const m of movs) {
    const c = corte(m.dia, m.turno);
    c.registros++;
    if (m.tipo === "caja") { c.caja.n++; if (m.forma === "EFECTIVO") c.caja.importe += m.importe; continue; }
    if (FORMAS_CONTADAS.includes(m.forma)) c[m.servicio][m.forma] += m.importe;
    else { c.fuera.n++; c.fuera.importe += m.importe; c.fuera.formas[m.forma] = (c.fuera.formas[m.forma] || 0) + m.importe; }
  }
  for (const g of gastos) { const c = corte(g.dia, g.turno); c.gastos[g.forma] = (c.gastos[g.forma] || 0) + g.monto; c.n_gastos++; }
  const orden = t => TURNOS.indexOf(t) < 0 ? 9 : TURNOS.indexOf(t);
  return [...cortes.values()].map(c => {
    const efectivo = c.bascula.EFECTIVO + c.pension.EFECTIVO, tarjeta = c.bascula.TARJETA + c.pension.TARJETA;
    return { ...c, efectivo, tarjeta, ingresos: efectivo + tarjeta, gastos_total: c.gastos.EFECTIVO + c.gastos.TARJETA + c.gastos.TRANSFERENCIA, efectivo_caja: efectivo + c.caja.importe - c.gastos.EFECTIVO };
  }).sort((a, b) => b.dia.localeCompare(a.dia) || orden(b.turno) - orden(a.turno));
}

function totalesMes(cortes) {
  const t = { efectivo: 0, tarjeta: 0, ingresos: 0, gastos: 0, caja: 0, bascula: 0, pension: 0 };
  for (const c of cortes) {
    t.efectivo += c.efectivo; t.tarjeta += c.tarjeta; t.ingresos += c.ingresos; t.gastos += c.gastos_total; t.caja += c.caja.importe;
    t.bascula += c.bascula.EFECTIVO + c.bascula.TARJETA; t.pension += c.pension.EFECTIVO + c.pension.TARJETA;
  }
  return t;
}

async function leerMes(env, mes) {
  const movs = (await env.DB.prepare("SELECT * FROM caja_mov WHERE mes = ? ORDER BY fecha DESC").bind(mes).all()).results;
  const gastos = (await env.DB.prepare("SELECT * FROM caja_gastos WHERE mes = ? ORDER BY dia DESC, creado DESC").bind(mes).all()).results;
  return { movs, gastos };
}

const NOMBRE_SERV = { bascula: "Báscula", pension: "Pensión" };
export function hojasExcel(mes, movs, gastos) {
  const cortes = calcularCortes(movs, gastos).slice().reverse();
  return [
    { nombre: "Cortes", anchos: [12, 10, 14, 14, 14, 14, 14, 14, 14, 18, 16, 18], filas: [
      ["Día", "Turno", "Báscula efectivo", "Báscula tarjeta", "Pensión efectivo", "Pensión tarjeta", "Total efectivo", "Total tarjeta", "Gastos", "Movimientos de caja", "Efectivo en caja", "Prepago y otros (no suman)"],
      ...cortes.map(c => [c.dia, c.turno, c.bascula.EFECTIVO, c.bascula.TARJETA, c.pension.EFECTIVO, c.pension.TARJETA, c.efectivo, c.tarjeta, c.gastos_total, c.caja.importe, c.efectivo_caja, c.fuera.importe])
    ] },
    ...["bascula", "pension"].map(sv => ({ nombre: NOMBRE_SERV[sv], anchos: [19, 12, 10, 12, 14, 30, 12, 15, 12], filas: [
      ["Fecha y hora", "Día del corte", "Turno", "Folio", "Matrícula", "Cliente", sv === "bascula" ? "Tarifa" : "Recibido", "Forma de pago", "En el corte"],
      ...movs.filter(m => m.servicio === sv).slice().reverse().map(m => [m.fecha.replace("T", " "), m.dia, m.turno, m.folio, m.matricula, m.cliente, m.importe, m.forma, m.tipo === "caja" ? "Movimiento de caja" : FORMAS_CONTADAS.includes(m.forma) ? "Sí" : "No"])
    ] })),
    { nombre: "Gastos", anchos: [12, 10, 40, 12, 15, 30], filas: [
      ["Día", "Turno", "Concepto", "Monto", "Forma de pago", "Capturado por"],
      ...gastos.slice().reverse().map(g => [g.dia, g.turno, g.concepto, g.monto, g.forma, g.creado_por || ""])
    ] }
  ];
}

// Cambio de mes: respaldo del mes anterior por correo (leído completo de la hoja) y borrado.
// Si el correo falla, no se borra nada y se reintenta en la siguiente ejecución.
export async function cierreMensualCaja(env, h) {
  await asegurarEsquemaCaja(env);
  const actual = mesActual();
  const guardado = await env.FILES.get("caja:mes");
  if (!guardado) { await env.FILES.put("caja:mes", actual); return { nada: true }; }
  if (guardado === actual) return { nada: true };
  const mes = guardado;
  let movs;
  try { movs = await leerHoja(env, mes); } catch (e) { console.error("cierre caja: hoja", e.message); return { error: e.message }; }
  const gastos = (await env.DB.prepare("SELECT * FROM caja_gastos WHERE mes = ? ORDER BY dia, creado").bind(mes).all()).results;
  const t = totalesMes(calcularCortes(movs, gastos));
  const xlsx = h.crearLibro(hojasExcel(mes, movs, gastos));
  const dinero = v => "$" + v.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  try {
    await h.llamarScript(env, {
      asunto: `Respaldo de ingresos y gastos ${mes}`,
      texto: `Respaldo de ingresos y gastos de ${mes} de Báscula y Pensión El Castaño.\n\nIngresos en efectivo: ${dinero(t.efectivo)}\nIngresos con tarjeta: ${dinero(t.tarjeta)}\nGastos: ${dinero(t.gastos)}\nMovimientos de caja (cambio, retiros): ${dinero(t.caja)}\n\nEl detalle por corte de turno va en el Excel adjunto. Estos datos ya se borraron del panel.`,
      adjunto: { nombre: `ingresos-gastos-${mes}.xlsx`, tipo: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", base64: h.aBase64(xlsx) }
    });
  } catch (e) { console.error("cierre caja: correo", e.message); return { error: e.message }; }
  await env.DB.batch([
    env.DB.prepare("DELETE FROM caja_gastos WHERE mes < ?").bind(actual),
    env.DB.prepare("DELETE FROM caja_mov WHERE mes < ?").bind(actual)
  ]);
  await env.FILES.put("caja:mes", actual);
  return { cerrado: mes };
}

// Rutas del panel: /panel/api/caja...
export async function cajaPanel(request, env, url, partes, usuario, h) {
  await asegurarEsquemaCaja(env);
  const mes = mesActual();

  if (partes.length === 1 && request.method === "GET") {
    const { movs, gastos } = await leerMes(env, mes);
    const cortes = calcularCortes(movs, gastos);
    const sync = await env.FILES.get("caja:sync", { type: "json" });
    return json({ ok: true, mes, sync, totales: totalesMes(cortes), cortes, conectado: !!(env.INGRESOS_URL && env.INGRESOS_TOKEN), turnos: TURNOS, formas_gasto: FORMAS_GASTO });
  }

  if (partes[1] === "corte" && request.method === "GET") {
    const dia = url.searchParams.get("dia") || "", turno = url.searchParams.get("turno") || "";
    const movs = (await env.DB.prepare("SELECT * FROM caja_mov WHERE dia = ? AND turno = ? ORDER BY fecha ASC").bind(dia, turno).all()).results;
    const gastos = (await env.DB.prepare("SELECT * FROM caja_gastos WHERE dia = ? AND turno = ? ORDER BY creado ASC").bind(dia, turno).all()).results;
    return json({ ok: true, corte: calcularCortes(movs, gastos)[0] || null, movs, gastos, formas_contadas: FORMAS_CONTADAS });
  }

  if (partes[1] === "sincronizar" && request.method === "POST") {
    const estado = await sincronizarCaja(env);
    if (estado.error && estado.error_at && (!estado.at || estado.error_at > estado.at)) return json({ ok: false, error: estado.error }, 502);
    return json({ ok: true, sync: estado });
  }

  if (partes[1] === "exportar" && request.method === "GET") {
    const { movs, gastos } = await leerMes(env, mes);
    const xlsx = h.crearLibro(hojasExcel(mes, movs, gastos));
    return new Response(xlsx, { headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="ingresos-gastos-${mes}.xlsx"`, "Cache-Control": "no-store"
    } });
  }

  if (partes[1] === "gastos" && partes.length === 2 && request.method === "POST") {
    let c; try { c = await request.json(); } catch { return json({ ok: false, error: "Datos inválidos." }, 400); }
    const dia = String(c.dia || ""), turno = normTurno(c.turno), concepto = texto(c.concepto, 120), monto = numero(c.monto), forma = normForma(c.forma) || "EFECTIVO";
    const errores = {};
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dia) || dia.slice(0, 7) > mes || dia < sumaDias(mes + "-01", -1)) errores.dia = "Elige un día del mes actual.";
    if (!turno) errores.turno = "Elige el turno.";
    if (concepto.length < 2) errores.concepto = "Escribe en qué se gastó.";
    if (!(monto > 0) || monto > 1000000) errores.monto = "Escribe un monto válido.";
    if (!FORMAS_GASTO.includes(forma)) errores.forma = "Forma de pago inválida.";
    if (Object.keys(errores).length) return json({ ok: false, error: "Revisa los datos del gasto.", errores }, 422);
    const id = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO caja_gastos (id, mes, dia, turno, concepto, monto, forma, creado, creado_por) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(id, mes, dia, turno, concepto, monto, forma, new Date().toISOString(), usuario && usuario.email || null).run();
    return json({ ok: true, id });
  }

  if (partes[1] === "gastos" && partes[3] === "eliminar" && request.method === "POST") {
    const r = await env.DB.prepare("DELETE FROM caja_gastos WHERE id = ? AND mes = ?").bind(partes[2], mes).run();
    return json({ ok: true, borrados: r.meta && r.meta.changes || 0 });
  }

  return json({ ok: false, error: "Ruta no encontrada." }, 404);
}
