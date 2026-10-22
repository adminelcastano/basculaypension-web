// Contabilización pura de cortes del turno. Sin D1, KV ni efectos de escritura.
// Las políticas y los registros pertenecen a caja.js; este módulo solo calcula.
export function crearCalculosCortes({ esCambio, FORMAS_CONTADAS, TURNOS, esTransf }) {
function calcularCortes(movs, gastos, extras = [], inicios = [], adminMovs = []) {
  const cortes = new Map();
  const corte = (dia, turno) => {
    const k = dia + "|" + turno;
    if (!cortes.has(k)) cortes.set(k, {
      dia, turno, bascula: { EFECTIVO: 0, TARJETA: 0 }, pension: { EFECTIVO: 0, TARJETA: 0 },
      fuera: { n: 0, importe: 0, formas: {} }, caja: { n: 0, importe: 0 }, cambio: { n: 0, importe: 0 }, extra: { n: 0, importe: 0, ingreso: 0 }, adminMovs: { n: 0, entradas: 0, salidas: 0 }, gastos: { EFECTIVO: 0, TARJETA: 0, TRANSFERENCIA: 0 }, registros: 0, n_gastos: 0
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
  for (const x of adminMovs) {
    const c = corte(x.dia, x.turno);
    if (x.anulado) continue;
    c.adminMovs.n++;
    if (x.tipo === "entrada") c.adminMovs.entradas += x.monto;
    else if (x.tipo === "salida") c.adminMovs.salidas += x.monto;
  }
  // El cambio inicial capturado en la tablet manda sobre el "cambio" de la hoja (no se suman los dos)
  for (const i of inicios) { const c = corte(i.dia, i.turno); c.cambio = { n: 1, importe: Number(i.cambio) || 0, fuente: "tablet", persona: i.persona, desde: i.creado || null, hoja: c.cambio.importe }; }
  const orden = t => TURNOS.indexOf(t) < 0 ? 9 : TURNOS.indexOf(t);
  return [...cortes.values()].map(c => {
    const efectivo = c.bascula.EFECTIVO + c.pension.EFECTIVO, tarjeta = c.bascula.TARJETA + c.pension.TARJETA;
    return { ...c, efectivo, tarjeta, ingresos: efectivo + tarjeta, gastos_total: c.gastos.EFECTIVO + c.gastos.TARJETA + c.gastos.TRANSFERENCIA, efectivo_caja: efectivo + c.cambio.importe + c.extra.importe + c.caja.importe + c.adminMovs.entradas - c.adminMovs.salidas - c.gastos.EFECTIVO };
  }).sort((a, b) => b.dia.localeCompare(a.dia) || orden(b.turno) - orden(a.turno));
}

// transf: transferencias capturadas a mano que cuentan (las ligadas a un ticket de la hoja ya van en el ticket; ver transferenciasMes)
function totalesMes(cortes, transf = []) {
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


  return { calcularCortes, totalesMes };
}
