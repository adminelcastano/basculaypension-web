// Cálculo del día operativo y turno, sin sesión ni acceso a base de datos.
export const TZ = "America/Mexico_City";
// Hora local en México (sin horario de verano)
export function local(ahora = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(ahora).map(x => [x.type, x.value]));
  return { dia: `${p.year}-${p.month}-${p.day}`, h: Number(p.hour) + Number(p.minute) / 60 };
}
export const sumaDias = (dia, n) => { const d = new Date(dia + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

// Turno sugerido al entrar: el que empieza en los próximos 30 minutos ya cuenta
export function turnoSugerido(ahora = new Date()) {
  const { h } = local(ahora);
  const x = (h + 0.5) % 24;
  return x >= 6 && x < 14 ? "MAÑANA" : x >= 14 && x < 22 ? "TARDE" : "NOCHE";
}
// Día del corte para el turno elegido (la noche que pasa de medianoche es del día anterior)
export function diaDeTurno(turno, ahora = new Date()) {
  const { dia, h } = local(ahora);
  if (turno === "NOCHE" && h < 12) return sumaDias(dia, -1);
  return dia;
}

