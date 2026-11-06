// Prevención de cierres asociados al turno equivocado.
// Consulta únicamente existencia de registros; nunca devuelve ingresos ni datos personales.
import { turnoAnterior } from "./caja.js";
import { local } from "./turno-tiempo.js";

const FUENTES = [
  ["caja_mov", ""],
  ["turno_inicio", ""],
  ["caja_gastos", "AND COALESCE(origen, 'caja') = 'caja'"],
  ["caja_extra", ""],
  ["caja_admin_movs", "AND anulado = 0"]
];

// Un turno anterior con movimientos, sin corte de tablet ni de administración,
// no puede ignorarse silenciosamente al entregar el siguiente.
export async function turnoPrevioSinCorte(env, dia, turno) {
  const anterior = turnoAnterior(dia, turno);
  if (!anterior) return null;
  const partes = [
    "EXISTS (SELECT 1 FROM turno_cortes WHERE dia = ? AND turno = ?)"
  ];
  const binds = [anterior.dia, anterior.turno];
  const alguna = FUENTES.map(([tabla, extra]) => {
    binds.push(anterior.dia, anterior.turno);
    return `EXISTS (SELECT 1 FROM ${tabla} WHERE dia = ? AND turno = ? ${extra})`;
  });
  const sql = `SELECT CASE WHEN ${partes[0]} THEN 0 WHEN (${alguna.join(" OR ")}) THEN 1 ELSE 0 END AS falta`;
  const r = await env.DB.prepare(sql).bind(...binds).first();
  return Number(r?.falta) === 1 ? anterior : null;
}

// Si el turno recién comenzó, exigir una segunda confirmación explícita.
// No impide corregir cortes ya entregados, y no interpreta cuánto "debería haber".
export function cierreAnticipado(turno, ahora = new Date()) {
  const limites = { "MAÑANA": [6, 14], "TARDE": [14, 22], "NOCHE": [22, 30] };
  const rango = limites[turno];
  if (!rango) return false;
  let h = local(ahora).h;
  if (turno === "NOCHE" && h < 12) h += 24;
  return h >= rango[0] - 0.5 && h < rango[1] - 1;
}
