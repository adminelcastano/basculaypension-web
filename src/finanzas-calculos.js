// Funciones puras de conciliación y resumen. No leen D1 ni escriben asientos.
export const r2 = v => Math.round(v * 100) / 100;
export const CAT_SUELDOS = "Sueldos";
// Diferencias de caja de los cortes entregados: lo contado contra lo esperado y el cambio entre turnos.
// Negativo = faltó dinero (egreso); positivo = sobró (ingreso).
export function diferenciasCaja(cortes, cambios) {
  const lista = [];
  for (const c of cortes) if (c.conteo && c.conteo.dif_efectivo != null && Math.abs(c.conteo.dif_efectivo) >= 0.01)
    lista.push({ tipo: "corte", dia: c.dia, turno: c.turno, persona: c.conteo.persona, dif: c.conteo.dif_efectivo, concepto: "Efectivo contado contra el esperado" });
  for (const x of cambios) if (Math.abs(x.dif) >= 0.01)
    lista.push({ tipo: "cambio", dia: x.dia, turno: x.turno, persona: x.recibio, dif: x.dif, concepto: `Cambio: ${x.de.persona} dejó ${x.dejado.toFixed(2)}, ${x.recibio} recibió ${x.recibido.toFixed(2)}` });
  const faltantes = r2(-lista.filter(x => x.dif < 0).reduce((a, x) => a + x.dif, 0)), sobrantes = r2(lista.filter(x => x.dif > 0).reduce((a, x) => a + x.dif, 0));
  return { lista: lista.sort((a, b) => a.dia.localeCompare(b.dia)), faltantes, sobrantes };
}

// Sueldos del mes: lo que los encargados se cobran del turno (gastos de caja o retiros con categoría Sueldos)
// y lo que paga la administración (pagos con categoría Sueldos, en efectivo de los sobres o por banco).
export function resumenSueldos(gastosCaja, retiros, admin) {
  const porPersona = {};
  const sumar = (k, v, n = 1) => { porPersona[k] = porPersona[k] || { persona: k, total: 0, n: 0 }; porPersona[k].total = r2(porPersona[k].total + v); porPersona[k].n += n; };
  for (const g of gastosCaja) if (g.categoria === CAT_SUELDOS) sumar(g.persona || g.creado_por || "Sin nombre", g.monto);
  for (const r of retiros) if (r.categoria === CAT_SUELDOS) sumar(r.persona || "Sin nombre", r.monto);
  const delAdmin = {};
  for (const x of admin) if (x.categoria === CAT_SUELDOS) { const k = String(x.concepto || "Sueldo").replace(/^Pago:\s*/i, ""); delAdmin[k] = delAdmin[k] || { concepto: k, total: 0, n: 0 }; delAdmin[k].total = r2(delAdmin[k].total + x.monto); delAdmin[k].n++; }
  const caja = Object.values(porPersona).sort((a, b) => b.total - a.total), adm = Object.values(delAdmin).sort((a, b) => b.total - a.total);
  return { caja, admin: adm, total_caja: r2(caja.reduce((a, x) => a + x.total, 0)), total_admin: r2(adm.reduce((a, x) => a + x.total, 0)), total: r2(caja.reduce((a, x) => a + x.total, 0) + adm.reduce((a, x) => a + x.total, 0)) };
}

