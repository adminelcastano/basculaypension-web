// Bitácora de dinero: quién creó, cambió o borró un registro de dinero (pagos, compras, traspasos, saldos,
// transferencias, gastos e ingresos extra de caja, cuentas). Sirve para saber por qué cambió una cifra
// después de que se vio o se reportó. Se conserva 13 meses, igual que los turnos.
let listo = false;
export async function asegurarEsquemaBitacora(env) {
  if (listo) return;
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS fin_bitacora (
    id INTEGER PRIMARY KEY AUTOINCREMENT, cuando TEXT NOT NULL, quien TEXT, accion TEXT NOT NULL,
    que TEXT NOT NULL, ref TEXT, mes TEXT, detalle TEXT)`).run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS fin_bitacora_cuando ON fin_bitacora (cuando)").run();
  listo = true;
}

export const ACCIONES = { crear: "Registró", editar: "Cambió", borrar: "Borró" };

// Devuelve la sentencia para meterla en el mismo batch que el cambio (así no hay cambio sin registro)
export function stmtBitacora(env, { quien, accion, que, ref = null, mes = null, detalle = null }) {
  const d = detalle == null ? null : JSON.stringify(detalle).slice(0, 2000);
  return env.DB.prepare("INSERT INTO fin_bitacora (cuando, quien, accion, que, ref, mes, detalle) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(new Date().toISOString(), quien || null, accion, que, ref, mes, d);
}

export async function listaBitacora(env, limite = 100) {
  await asegurarEsquemaBitacora(env);
  const filas = (await env.DB.prepare("SELECT * FROM fin_bitacora ORDER BY id DESC LIMIT ?").bind(limite).all()).results;
  return filas.map(f => { let d = null; try { d = f.detalle ? JSON.parse(f.detalle) : null; } catch {} return { ...f, detalle: d }; });
}

export async function limpiarBitacora(env, antesDe) {
  await asegurarEsquemaBitacora(env);
  await env.DB.prepare("DELETE FROM fin_bitacora WHERE cuando < ?").bind(antesDe).run();
}
