// Hoy: el tablero del panel en una sola llamada (/panel/api/hoy).
// Junta, del lado del servidor, lo que antes pedía el navegador en 8 llamadas, y arma la lista de lo que pide atención.
import { avisosSinLeer } from "./agenda.js";

const TZ = "America/Mexico_City";
const r2 = v => Math.round(v * 100) / 100;
const TURNOS = ["MAÑANA", "TARDE", "NOCHE"];
const TURNO_TXT = { "MAÑANA": "mañana", TARDE: "tarde", NOCHE: "noche" };
const sumaDias = (dia, n) => { const d = new Date(dia + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

// Día y turno de operación en este momento (la noche después de medianoche es del día anterior)
export function turnoEn(ahora = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hour12: false }).formatToParts(ahora).map(x => [x.type, x.value]));
  const fecha = `${p.year}-${p.month}-${p.day}`, h = Number(p.hour) % 24;
  if (h >= 6 && h < 14) return { dia: fecha, turno: "MAÑANA", fecha };
  if (h >= 14 && h < 22) return { dia: fecha, turno: "TARDE", fecha };
  return { dia: h < 6 ? sumaDias(fecha, -1) : fecha, turno: "NOCHE", fecha };
}
const ordenTurno = (dia, turno) => dia + "|" + TURNOS.indexOf(turno);

// Arma el tablero a partir de las respuestas de las demás rutas (función pura: se prueba sin base de datos)
export function armarHoy(d, ahora = new Date()) {
  const t = turnoEn(ahora), atencion = [];
  const add = (nivel, clave, titulo, detalle, ir, n = null) => atencion.push({ nivel, clave, titulo, detalle, ir, n });
  const cortes = (d.caja && d.caja.cortes) || [];
  const transfDe = c => Object.entries((c.fuera && c.fuera.formas) || {}).filter(([f]) => f.startsWith("TRANSF")).reduce((a, [, v]) => a + v, 0);

  // ---- Turno en curso ----
  const actual = cortes.find(c => c.dia === t.dia && c.turno === t.turno) || null;
  const activo = d.turno && d.turno.activo || null;
  const turno = {
    dia: t.dia, turno: t.turno, txt: TURNO_TXT[t.turno],
    encargado: activo ? { clave: activo.persona, nombre: activo.nombre, desde: activo.desde } : null,
    cambio_inicial: actual && actual.cambio && actual.cambio.n ? actual.cambio.importe : activo && activo.cambio_inicial != null ? activo.cambio_inicial : null,
    efectivo: actual ? r2(actual.efectivo) : 0, tarjeta: actual ? r2(actual.tarjeta) : 0, transferencias: actual ? r2(transfDe(actual)) : 0,
    gastos: actual ? r2(actual.gastos.EFECTIVO || 0) : 0, extras: actual ? r2(actual.extra.importe) : 0,
    en_caja: actual ? r2(actual.efectivo_caja) : null, registros: actual ? actual.registros : 0,
    cambio_turno: actual && actual.cambio_turno || null
  };
  // El cambio recibido no coincide con el que dejó el turno anterior
  if (turno.cambio_turno && Math.abs(turno.cambio_turno.dif) >= 1) add("alta", "cambio-actual", `El cambio no cuadra al empezar este turno`, `${turno.cambio_turno.de.persona} dejó ${dinero(turno.cambio_turno.dejado)}; ${turno.cambio_turno.recibio} dijo recibir ${dinero(turno.cambio_turno.recibido)} (${dinero(turno.cambio_turno.dif)}).`, { mod: "caja", corte: t.dia + "|" + t.turno });

  // ---- Cortes: sin entregar y con diferencias (últimos 7 días) ----
  const limite = sumaDias(t.dia, -7), ahoraK = ordenTurno(t.dia, t.turno);
  const pasados = cortes.filter(c => c.dia >= limite && ordenTurno(c.dia, c.turno) < ahoraK && TURNOS.includes(c.turno));
  // El turno que acaba de terminar tiene una hora de gracia para entregar su corte
  const hora = Number(new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", hour12: false }).format(ahora)) % 24;
  const enTurno = (hora - ({ "MAÑANA": 6, TARDE: 14, NOCHE: 22 })[t.turno] + 24) % 24;
  const ant = { "MAÑANA": [sumaDias(t.dia, -1), "NOCHE"], TARDE: [t.dia, "MAÑANA"], NOCHE: [t.dia, "TARDE"] }[t.turno];
  const sinCorte = pasados.filter(c => !c.conteo && c.registros > 0 && c.dia >= sumaDias(t.dia, -2) && !(enTurno < 1 && c.dia === ant[0] && c.turno === ant[1]));
  if (sinCorte.length === 1) { const c = sinCorte[0]; add("alta", "sin-corte", `Corte sin entregar: ${diaCorto(c.dia, t.fecha)}, turno de la ${TURNO_TXT[c.turno]}`, `Tuvo ${c.registros} ${c.registros === 1 ? "registro" : "registros"} en la hoja y nadie entregó el corte en la tablet.`, { mod: "caja", corte: c.dia + "|" + c.turno }); }
  else if (sinCorte.length) add("alta", "sin-corte", `${sinCorte.length} cortes sin entregar`, sinCorte.slice(0, 4).map(c => `${diaCorto(c.dia, t.fecha)} ${TURNO_TXT[c.turno]}`).join(" · ") + ". Tuvieron registros en la hoja y nadie entregó el corte en la tablet.", { mod: "caja", corte: sinCorte[0].dia + "|" + sinCorte[0].turno }, sinCorte.length);
  const difs = [];
  for (const c of pasados) {
    if (c.conteo && c.conteo.dif_efectivo != null && Math.abs(c.conteo.dif_efectivo) >= 1) difs.push({ dia: c.dia, turno: c.turno, persona: c.conteo.persona, dif: c.conteo.dif_efectivo, que: "corte" });
    if (c.cambio_turno && Math.abs(c.cambio_turno.dif) >= 1 && !(c.dia === t.dia && c.turno === t.turno)) difs.push({ dia: c.dia, turno: c.turno, persona: c.cambio_turno.recibio, dif: c.cambio_turno.dif, que: "cambio" });
  }
  const faltante = r2(-difs.filter(x => x.dif < 0).reduce((a, x) => a + x.dif, 0));
  if (difs.length) add(faltante > 0 ? "alta" : "media", "difs", faltante > 0 ? `Faltaron ${dinero(faltante)} en caja en los últimos 7 días` : `Sobró dinero en caja en los últimos 7 días`,
    difs.slice(0, 3).map(x => `${diaCorto(x.dia, t.fecha)} ${TURNO_TXT[x.turno] || x.turno} (${x.persona}): ${x.dif < 0 ? "faltó" : "sobró"} ${dinero(Math.abs(x.dif))}${x.que === "cambio" ? " de cambio" : ""}`).join(" · ") + (difs.length > 3 ? ` · y ${difs.length - 3} más` : ""),
    { mod: "finanzas", vista: "resumen" }, difs.length);

  // ---- Facturas ----
  const fac = d.facturas || {};
  const pend = fac.solicitudes || [], nPend = (fac.conteos && fac.conteos.pendiente) || pend.length;
  if (nPend) {
    const vieja = pend.reduce((a, s) => !a || s.creado < a ? s.creado : a, null);
    const horas = vieja ? Math.floor((ahora - new Date(vieja)) / 3600e3) : 0;
    add(horas >= 48 ? "alta" : "media", "facturas", `${nPend} ${nPend === 1 ? "factura por hacer" : "facturas por hacer"}`, horas >= 48 ? `La más antigua espera desde hace ${Math.floor(horas / 24)} días.` : `La más antigua llegó hace ${horas < 1 ? "menos de una hora" : horas + (horas === 1 ? " hora" : " horas")}.`, { mod: "facturacion" }, nPend);
  }

  // ---- Avisos de los encargados sin leer ----
  const av = d.avisos || [];
  if (av.length) add("alta", "avisos", `${av.length} ${av.length === 1 ? "aviso con novedades" : "avisos con novedades"} de los encargados`, av.slice(0, 2).map(a => `${a.autor}: ${a.titulo}`).join(" · "), { mod: "agenda", tab: "aviso" }, av.length);

  // ---- Agenda: incidencias, tareas vencidas, pagos ----
  const ag = d.agenda || {}, ab = ag.abiertos || {};
  const graves = (ag.incidencias || []).filter(i => i.gravedad === "grave");
  if (ab.incidencia) add(graves.length ? "alta" : "media", "incidencias", `${ab.incidencia} ${ab.incidencia === 1 ? "incidencia abierta" : "incidencias abiertas"}`, (ag.incidencias || []).slice(0, 2).map(i => `${i.titulo}${i.gravedad === "grave" ? " (grave)" : ""}`).join(" · "), { mod: "agenda", tab: "incidencia" }, ab.incidencia);
  if (ag.vencidas) add("media", "tareas", `${ag.vencidas} ${ag.vencidas === 1 ? "tarea vencida" : "tareas vencidas"}`, (ag.tareas || []).slice(0, 2).map(x => x.titulo).join(" · "), { mod: "agenda", tab: "tarea" }, ag.vencidas);
  const pg = d.pagos || {};
  const prox = (pg.proximos || []).filter(p => p.fecha && p.fecha >= t.fecha && p.fecha <= sumaDias(t.fecha, 3));
  if (pg.vencidos) add("alta", "pagos-vencidos", `${pg.vencidos} ${pg.vencidos === 1 ? "pago vencido" : "pagos vencidos"}`, (pg.proximos || []).filter(p => p.fecha && p.fecha < t.fecha).slice(0, 3).map(p => `${p.titulo}${p.importe ? " " + dinero(p.importe) : ""}`).join(" · "), { mod: "pagos", tab: "pago" }, pg.vencidos);
  if (prox.length) add("media", "pagos-pronto", `${prox.length} ${prox.length === 1 ? "pago vence" : "pagos vencen"} en los próximos 3 días`, prox.slice(0, 3).map(p => `${p.titulo} (${diaCorto(p.fecha, t.fecha)})${p.importe ? " " + dinero(p.importe) : ""}`).join(" · "), { mod: "pagos", tab: "pago" }, prox.length);
  // Compras: las que pidieron los encargados desde la tablet van aparte (con quién las pidió); urgentes en rojo
  const ct = ag.compras_tablet || [], ctUrg = ct.filter(x => x.prioridad === "alta").length;
  if (ct.length) add(ctUrg ? "alta" : "media", "compras-tablet", `${ct.length} ${ct.length === 1 ? "compra pedida" : "compras pedidas"} por los encargados${ctUrg ? ` (${ctUrg} ${ctUrg === 1 ? "urgente" : "urgentes"})` : ""}`,
    ct.slice(0, 3).map(x => `${x.reporto}: ${x.titulo}${x.cantidad ? ` (${x.cantidad})` : ""}${x.prioridad === "alta" ? " ❗" : ""}`).join(" · ") + (ct.length > 3 ? ` · y ${ct.length - 3} más` : ""), { mod: "pagos", tab: "compra" }, ct.length);
  const otras = Math.max(0, (ab.compra || 0) - ct.length);
  if (otras) add("info", "compras", `${otras} ${otras === 1 ? (ct.length ? "compra tuya pendiente" : "compra pendiente") : (ct.length ? "compras tuyas pendientes" : "compras pendientes")}`, (ag.compras || []).filter(x => !x.reporto).slice(0, 3).map(x => x.titulo + (x.cantidad ? ` (${x.cantidad})` : "")).join(" · "), { mod: "pagos", tab: "compra" }, otras);

  // ---- Dinero: lo que falta para que las cifras sean reales ----
  const fin = d.finanzas || null;
  if (fin && fin.banco) {
    const mc = fin.banco.comision_cuenta;
    if (mc && !(mc.pct > 0)) add("media", "comision", `Falta la comisión de ${mc.nombre}`, "Sin ella, el saldo de la cuenta y el resultado no descuentan lo que cobra la terminal.", { mod: "finanzas", vista: "cuentas" });
    if (fin.efectivo && fin.efectivo.inicial == null) add("info", "sobres", "Falta el saldo de partida de los sobres", "Cuenta los sobres una vez y escríbelo; después se calcula solo.", { mod: "finanzas", vista: "cuentas" });
    const fs = fin.banco.faltan_saldo || [];
    if (fs.length) add("info", "cuentas", `${fs.length} ${fs.length === 1 ? "cuenta sin" : "cuentas sin"} saldo de partida`, fs.slice(0, 4).join(", ") + (fs.length > 4 ? ` y ${fs.length - 4} más` : "") + ". Las que no uses, ocúltalas.", { mod: "finanzas", vista: "cuentas" }, fs.length);
    const sc = fin.banco.sin_cuenta || {};
    if (sc.pagos) add("info", "sin-cuenta", `Pagos sin cuenta: ${dinero(sc.pagos)}`, "No restan de ninguna cuenta hasta que les pongas de qué cuenta salieron.", { mod: "pagos", tab: "hechos" });
  }
  // Posibles transferencias duplicadas
  if (fin && (fin.transf_posibles || []).length) add("media", "transf-dup", `${fin.transf_posibles.length} ${fin.transf_posibles.length === 1 ? "transferencia podría estar" : "transferencias podrían estar"} contada dos veces`, "Coinciden con un ticket de la hoja pagado por transferencia. Lígalas para no duplicar el ingreso.", { mod: "finanzas", vista: "transferencias" }, fin.transf_posibles.length);

  // ---- Sistema: hoja de ingresos y consumo ----
  const sync = d.caja && d.caja.sync;
  if (d.caja && d.caja.conectado === false) add("media", "hoja", "La hoja de ingresos no está conectada", "Sin ella no entran los tickets a Caja ni a Dinero.", { mod: "caja" });
  else if (sync && sync.error && (!sync.at || sync.error_at > sync.at)) add("alta", "hoja", "No se pudo leer la hoja de ingresos", sync.error, { mod: "caja" });
  else if (sync && sync.at && ahora - new Date(sync.at) > 70 * 60e3) add("media", "hoja", "La hoja de ingresos no se ha leído hace rato", `Última lectura: ${hora(sync.at)}. Toca Sincronizar.`, { mod: "caja" });
  const co = d.consumo && d.consumo.consumo;
  if (co && co.ahorro) add("alta", "consumo", "Modo ahorro activo en Cloudflare", "Formularios públicos, IA y sincronización frecuente pausados hasta el próximo mes para no generar cobros.", null);
  else if (co && co.estado && co.estado.filas) {
    const top = co.estado.filas.slice().sort((a, b) => b.fraccion - a.fraccion)[0];
    if (top && top.fraccion >= 0.6) add("media", "consumo", `Cloudflare: ${top.nombre} al ${Math.round(top.fraccion * 100)} %`, "Al 85 % se activa el modo ahorro para no generar cobros.", null);
  }
  const arch = d.consumo && d.consumo.archivos;
  if (arch && arch.en_kv > 20) add("info", "archivos", `${arch.en_kv} fotos esperando subir a Drive`, arch.script ? "Se suben solas cada 10 minutos." : "Falta conectar el script de Google.", null);

  // ---- Personal ----
  const per = d.personal && d.personal.conteos;
  if (per && per.incompletos) add("info", "expedientes", `${per.incompletos} ${per.incompletos === 1 ? "expediente incompleto" : "expedientes incompletos"}`, "De colaboradores activos.", { mod: "personal" }, per.incompletos);

  // Pendientes procedentes de la hoja: el administrador los resuelve en el corte.
  // No alteran ingresos ni saldos mientras el cobro no se registre en origen.
  const pendientes = (d.caja && d.caja.pendientes) || [];
  for (const p of pendientes.slice(0, 30)) {
    const titulo = `Cobro por resolver · ${p.servicio === "bascula" ? "Báscula" : "Pensión"} · folio ${p.folio}`;
    const detalle = `${dinero(Math.max(0, p.monto - (p.abonado || 0)))} restante · ${p.dia} · ${p.turno}. ${p.origen_activo ? "Registra abono o cancelación en Caja." : "La hoja ya no lo marca pendiente: revisa y concilia el movimiento."}`;
    add("media", "cobro-" + p.id, titulo, detalle,
      { mod: "caja", corte: p.dia + "|" + p.turno, pendiente: p.id });
  }
  if (pendientes.length > 30) add("media", "cobros-restantes",
    `${pendientes.length - 30} cobros adicionales por revisar`,
    "Abre Caja para consultar los pendientes restantes.", { mod: "caja" });

  const peso = { alta: 0, media: 1, info: 2 };
  atencion.sort((a, b) => peso[a.nivel] - peso[b.nivel]);

  // ---- Números de hoy y de la semana ----
  const delDia = cortes.filter(c => c.dia === t.dia);
  const sum = (l, f) => r2(l.reduce((a, c) => a + f(c), 0));
  const numeros = {
    efectivo: sum(delDia, c => c.efectivo), tarjeta: sum(delDia, c => c.tarjeta), transferencias: sum(delDia, transfDe),
    rentas: sum(delDia, c => c.extra.ingreso), gastos: sum(delDia, c => c.gastos.EFECTIVO || 0)
  };
  numeros.ingresos = r2(numeros.efectivo + numeros.tarjeta + numeros.transferencias + numeros.rentas);
  const semana = [];
  for (let k = 6; k >= 0; k--) { const dia = sumaDias(t.dia, -k), l = cortes.filter(c => c.dia === dia); semana.push({ dia, ingresos: sum(l, c => c.efectivo + c.tarjeta + transfDe(c) + c.extra.ingreso) }); }

  const mes = fin ? { mes: fin.mes, entro: fin.ingresos.total, salio: fin.egresos.total, resultado: fin.resultado, sobres: fin.efectivo ? fin.efectivo.saldo : null, sobres_calculado: fin.efectivo ? !fin.efectivo.capturado : null, dinero: fin.banco ? fin.banco.dinero : null, deuda: fin.banco ? fin.banco.deuda : null } : null;

  // ---- Próximo en la agenda ----
  const proximos = [
    ...(ag.proximos || []).map(e => ({ tipo: "evento", titulo: e.titulo, fecha: e.fecha, hora: e.hora || null })),
    ...(pg.proximos || []).filter(p => p.fecha && p.fecha >= t.fecha).map(p => ({ tipo: "pago", titulo: p.titulo, fecha: p.fecha, importe: p.importe || null }))
  ].sort((a, b) => (a.fecha + (a.hora || "")).localeCompare(b.fecha + (b.hora || ""))).slice(0, 5);

  return { ok: true, generado: ahora.toISOString(), turno, atencion, numeros, semana, mes, proximos, conteos: { incidencias: ab.incidencia || 0, tareas: ab.tarea || 0, compras: ab.compra || 0, avisos: ab.aviso || 0, facturas: nPend || 0 } };
}

function dinero(v) { return (v < 0 ? "−" : "") + "$" + Math.abs(Number(v) || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function hora(iso) { return new Date(iso).toLocaleString("es-MX", { timeZone: TZ, hour: "numeric", minute: "2-digit", day: "numeric", month: "short" }); }
function diaCorto(dia, hoy) {
  if (dia === hoy) return "hoy";
  if (dia === sumaDias(hoy, -1)) return "ayer";
  if (dia === sumaDias(hoy, 1)) return "mañana";
  return new Date(dia + "T12:00:00Z").toLocaleDateString("es-MX", { weekday: "short", day: "numeric", timeZone: "UTC" });
}

// Consulta en paralelo las rutas del panel (interno) y arma el tablero. Si una falla, el resto se muestra igual.
export async function hoyPanel(env, interno) {
  const t = turnoEn();
  const pedir = async r => { try { const j = await interno(r); return j && j.ok !== false ? j : null; } catch (e) { console.error("hoy", r, e && e.message); return null; } };
  // El calendario no depende de las otras fuentes: pedirlo desde el inicio evita
  // otro viaje a D1 después de haber esperado Caja, Finanzas y Facturación.
  const [a, m] = t.fecha.slice(0, 7).split("-").map(Number), primero = new Date(Date.UTC(a, m - 1, 1));
  const inicioCal = new Date(primero); inicioCal.setUTCDate(1 - ((primero.getUTCDay() + 6) % 7));
  const finMes = new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
  const [facturas, caja, turno, agenda, pagos, finanzas, personal, consumo, avisos, cal] = await Promise.all([
    pedir("solicitudes?estado=pendiente&limite=50"),
    pedir(`caja?desde=${[sumaDias(t.dia, -8), t.dia.slice(0, 8) + "01"].sort()[0]}&hasta=${t.dia}&resumen=1`),
    pedir("turno/activo"),
    pedir("agenda/resumen"),
    pedir("agenda/pagos"),
    pedir("finanzas"),
    pedir("colaboradores?tipo=colaborador&estatus=activo"),
    pedir("consumo"),
    avisosSinLeer(env).catch(() => []),
    pedir(`agenda?desde=${inicioCal.toISOString().slice(0, 10)}&hasta=${sumaDias(finMes, 7)}`)
  ]);
  const r = armarHoy({ facturas, caja, turno, agenda, pagos, finanzas, personal, consumo, avisos });
  r.fallas = Object.entries({ facturas, caja, agenda, pagos, finanzas }).filter(([, v]) => !v).map(([k]) => k);
  r.fuentes = recortar({ facturas, caja, turno, agenda, pagos, finanzas, personal, consumo, cal });
  return r;
}

// Lo que necesita el tablero de cada fuente (sin las listas largas que no usa)
export function recortar({ facturas, caja, turno, agenda, pagos, finanzas, personal, consumo, cal }) {
  const transfPorDia = {};
  if (caja) {
    for (const c of caja.cortes || []) for (const [f, v] of Object.entries((c.fuera && c.fuera.formas) || {})) if (f.startsWith("TRANSF")) transfPorDia[c.dia] = r2((transfPorDia[c.dia] || 0) + v);
    const enHoja = new Set((caja.transf_hoja || []).map(h => h.ref));
    for (const x of caja.transferencias || []) if (!x.ticket_ref || !enHoja.has(x.ticket_ref)) transfPorDia[x.fecha] = r2((transfPorDia[x.fecha] || 0) + x.importe);
  }
  return {
    facturas: facturas && { conteos: facturas.conteos || {}, solicitudes: (facturas.solicitudes || []).slice(0, 6) },
    caja: caja && { cortes: caja.cortes, cobros: caja.cobros || [], gastos_recientes: caja.gastos_recientes || [], sync: caja.sync || null, conectado: caja.conectado, transf_por_dia: transfPorDia },
    turno: turno && turno.activo || null,
    agenda, pagos,
    finanzas: finanzas && { mes: finanzas.mes, ingresos: finanzas.ingresos, egresos: finanzas.egresos, resultado: finanzas.resultado, diferencias: finanzas.diferencias && { faltantes: finanzas.diferencias.faltantes, sobrantes: finanzas.diferencias.sobrantes },
      efectivo: finanzas.efectivo && { inicial: finanzas.efectivo.inicial, capturado: finanzas.efectivo.capturado, recibido: finanzas.efectivo.recibido, gastado: finanzas.efectivo.gastado, saldo: finanzas.efectivo.saldo },
      banco: finanzas.banco && { dinero: finanzas.banco.dinero, deuda: finanzas.banco.deuda, comision: finanzas.banco.comision } },
    personal: personal && { conteos: personal.conteos || {} },
    consumo,
    calendario: cal && { items: (cal.items || []).map(i => ({ fecha: i.fecha, tipo: i.tipo, estado: i.estado })), pagos_hechos: (cal.pagos_hechos || []).map(p => ({ fecha: p.fecha })) }
  };
}

