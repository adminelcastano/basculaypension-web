// Registro histórico informativo, ajeno a los importes operativos y contables.
// Hasta el turno de mañana del 14 de octubre de 2026.
const CAMPOS = ["sobre", "taxi", "sueldo", "cambio", "contado"];
const texto = v => String(v ?? "").trim();
const redondear = v => Math.round(Number(v) * 100) / 100;

export function esTurnoHistorico(dia, turno) {
  return /^\d{4}-\d{2}-\d{2}$/.test(dia) &&
    ((dia >= "2026-10-01" && dia <= "2026-10-13") ||
      (dia === "2026-10-14" && turno === "MAÑANA"));
}

function fechaYTurno(f, t) {
  const fecha = texto(f).toLowerCase();
  const normal = texto(t).toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const turno = normal.startsWith("MAN") ? "MAÑANA" :
    normal.startsWith("TAR") ? "TARDE" : normal.startsWith("NOC") ? "NOCHE" : "";
  let dia = /^\d{4}-\d{2}-\d{2}$/.test(fecha) ? fecha : "";
  const m = /^(\d{1,2})[-\/\s]*oct\.?$/.exec(fecha);
  if (m) dia = "2026-10-" + m[1].padStart(2, "0");
  return esTurnoHistorico(dia, turno) ? { dia, turno } : null;
}

function monto(c) {
  const t = texto(c);
  if (!t || t === "—" || t === "-" || t === "–") return { valor: null, dudoso: false };
  const dudoso = t.endsWith("*");
  const limpio = (dudoso ? t.slice(0, -1) : t).replace(/[$,\s]/g, "");
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(limpio)) return { error: "Monto no válido: " + t.slice(0, 30) };
  return { valor: Number(limpio), dudoso };
}

export function evaluarHistorico(x) {
  const valores = CAMPOS.slice(0, 4).map(k => x[k]);
  if (valores.every(v => v == null)) return { estado: "sin_datos", reparto: null, diferencia: null };
  if (valores.some(v => v == null)) return { estado: "incompleto", reparto: null, diferencia: null };
  const reparto = redondear(valores.reduce((s, v) => s + v, 0));
  // Sólo una referencia INDEPENDIENTE permite declarar que cuadra.
  // El esperado de Caja no es fiable sin conciliar retiros ya asentados.
  if (x.contado == null || x.dudoso) return { estado: "por_verificar", reparto, diferencia: null };
  const diferencia = redondear(reparto - x.contado);
  return { estado: Math.abs(diferencia) < 0.01 ? "cuadra" : "no_cuadra", reparto, diferencia };
}

export function leerTablaHistoricos(raw) {
  const filas = [], errores = [], vistos = new Set();
  texto(raw).split(/\r?\n/).forEach((linea, i) => {
    if (!linea.trim()) return;
    const columnas = linea.split(/\t|\||;/).map(texto);
    if (i === 0 && /fecha|turno/i.test(linea) && !/^\d/.test(columnas[0])) return;
    if (columnas.length < 6) {
      errores.push({ linea: i + 1, error: "Se requieren: fecha, turno, sobre, taxi, sueldo, cambio." });
      return;
    }
    const ft = fechaYTurno(columnas[0], columnas[1]);
    if (!ft) { errores.push({ linea: i + 1, error: "Fecha o turno fuera de 1-14 de octubre (mañana del 14)." }); return; }
    const clave = ft.dia + "|" + ft.turno;
    if (vistos.has(clave)) { errores.push({ linea: i + 1, error: "Turno duplicado: " + clave }); return; }
    vistos.add(clave);
    const valores = CAMPOS.map((k, j) => monto(columnas[j + 2]));
    const invalido = valores.find(v => v.error);
    if (invalido) { errores.push({ linea: i + 1, error: invalido.error }); return; }
    const x = { ...ft, dudoso: valores.some(v => v.dudoso),
      notas: texto(columnas[7]).slice(0, 300) };
    CAMPOS.forEach((k, j) => { x[k] = valores[j].valor; });
    if (x.dudoso && !x.notas) x.notas = "Dato marcado con asterisco en la fuente.";
    filas.push({ ...x, ...evaluarHistorico(x) });
  });
  return { filas, errores };
}

let esquema = null;
export async function asegurarHistoricos(env) {
  // No ejecutar DDL cada vez que alguien abre Hoy o Caja.
  if (!esquema) esquema = env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS caja_cortes_historicos (dia TEXT NOT NULL, turno TEXT NOT NULL, datos TEXT NOT NULL, actualizado TEXT NOT NULL, por TEXT, PRIMARY KEY(dia, turno))"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS caja_cortes_historicos_hist (id INTEGER PRIMARY KEY AUTOINCREMENT, dia TEXT NOT NULL, turno TEXT NOT NULL, anterior TEXT, nuevo TEXT NOT NULL, cuando TEXT NOT NULL, por TEXT)")
  ]).catch(e => { esquema = null; throw e; });
  await esquema;
}

export async function listarHistoricos(env) {
  await asegurarHistoricos(env);
  const rows = (await env.DB.prepare("SELECT dia, turno, datos, actualizado, por FROM caja_cortes_historicos ORDER BY dia, turno").all()).results;
  return rows.map(r => {
    let d = {};
    try { d = JSON.parse(r.datos); } catch {}
    return { ...d, dia: r.dia, turno: r.turno, actualizado: r.actualizado, por: r.por, ...evaluarHistorico(d) };
  });
}

export async function procesarHistoricos(env, tabla, { aplicar = false, quien = null } = {}) {
  const { filas, errores } = leerTablaHistoricos(tabla);
  const previos = await listarHistoricos(env);
  const mapa = new Map(previos.map(x => [x.dia + "|" + x.turno, x]));
  const revisadas = filas.map(x => ({ ...x, accion: mapa.has(x.dia + "|" + x.turno) ? "actualizar" : "nuevo" }));
  const resumen = { cuadra: 0, no_cuadra: 0, incompleto: 0, sin_datos: 0, por_verificar: 0 };
  for (const x of revisadas) resumen[x.estado]++;
  if (aplicar && !errores.length && revisadas.length) {
    const cuando = new Date().toISOString(), stmts = [];
    for (const f of revisadas) {
      const anterior = mapa.get(f.dia + "|" + f.turno);
      const datos = JSON.stringify(Object.fromEntries([...CAMPOS, "dudoso", "notas"].map(k => [k, f[k]])));
      const antes = anterior && JSON.stringify(Object.fromEntries([...CAMPOS, "dudoso", "notas"].map(k => [k, anterior[k]])));
      if (datos === antes) continue;
      stmts.push(env.DB.prepare("INSERT INTO caja_cortes_historicos (dia, turno, datos, actualizado, por) VALUES (?, ?, ?, ?, ?) ON CONFLICT(dia, turno) DO UPDATE SET datos=excluded.datos, actualizado=excluded.actualizado, por=excluded.por").bind(f.dia, f.turno, datos, cuando, quien));
      stmts.push(env.DB.prepare("INSERT INTO caja_cortes_historicos_hist (dia, turno, anterior, nuevo, cuando, por) VALUES (?, ?, ?, ?, ?, ?)").bind(f.dia, f.turno, antes || null, datos, cuando, quien));
    }
    for (let i = 0; i < stmts.length; i += 80) await env.DB.batch(stmts.slice(i, i + 80));
  }
  return { filas: revisadas, errores, resumen, aplicado: !!aplicar && !errores.length };
}
