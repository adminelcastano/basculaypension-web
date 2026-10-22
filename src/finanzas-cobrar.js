// Resumen de solo lectura de cobros pendientes cuyo origen y cobro pertenecen a CAJA.
// Nunca crea ingresos nuevos ni altera el libro caja_pendientes/caja_cobros_admin.
export async function resumenPorCobrarCaja(env) {
  const r = await env.DB.prepare(`
    WITH abonos AS (
      SELECT pendiente_id, SUM(ROUND(monto * 100)) AS centavos
      FROM caja_cobros_admin WHERE anulado = 0
      GROUP BY pendiente_id
    ), pendientes AS (
      SELECT p.dia, p.actualizado, p.estado,
        MAX(0, ROUND(p.monto * 100) - COALESCE(a.centavos, 0)) AS resto
      FROM caja_pendientes p
      LEFT JOIN abonos a ON a.pendiente_id = p.id
      WHERE p.origen_activo = 1 AND p.estado IN ('pendiente', 'parcial', 'pagado')
    )
    SELECT COALESCE(SUM(CASE WHEN estado IN ('pendiente','parcial') THEN resto ELSE 0 END), 0) AS centavos,
      COALESCE(SUM(CASE WHEN estado IN ('pendiente','parcial') AND resto > 0 THEN 1 ELSE 0 END), 0) AS operaciones,
      MIN(CASE WHEN estado IN ('pendiente','parcial') AND resto > 0 THEN dia ELSE NULL END) AS mas_antiguo,
      MAX(CASE WHEN estado IN ('pendiente','parcial') AND resto > 0 THEN actualizado ELSE NULL END) AS ultima_edicion,
      COALESCE(SUM(CASE WHEN estado='pagado' AND resto>0 THEN 1 ELSE 0 END),0) AS revisar_pagados,
      COALESCE(SUM(CASE WHEN estado='pagado' AND resto>0 THEN resto ELSE 0 END),0) AS revisar_centavos
    FROM pendientes
  `).first();
  return {
    total: Number(r?.centavos || 0) / 100,
    operaciones: Number(r?.operaciones || 0),
    mas_antiguo: r?.mas_antiguo || null,
    ultima_edicion: r?.ultima_edicion || null,
    revisar_pagados: Number(r?.revisar_pagados || 0),
    revisar_total: Number(r?.revisar_centavos || 0)/100,
    origen: "caja_pendientes",
    advertencia: "Saldo pendiente de cobro: no es ingreso realizado. Los abonos se registran únicamente en CAJA."
  };
}
