// Guardián de consumo de Cloudflare: que nada se cobre sin que la administración se entere.
// Cloudflare no tiene tope de gasto; con Workers Paid (5 USD) se incluye cada mes:
// 10 millones de peticiones al Worker, 30 millones de ms de CPU, KV (10 M lecturas, 1 M escrituras,
// 1 M borrados, 1 M listados, 1 GB) y D1 (25 mil millones de filas leídas, 50 M escritas, 5 GB).
// Cada hora se consulta el uso del mes (API de analítica, token de solo lectura en CF_API_TOKEN):
//   - 60 % de cualquier límite: correo de aviso.
//   - 85 %: correo y "modo ahorro": se pausan los formularios públicos (facturas y expedientes muestran
//     un mensaje para escribir por WhatsApp), la lectura con IA y la sincronización frecuente de la hoja.
//     El panel y la tablet siguen funcionando. Se quita solo al empezar el mes siguiente.

const INCLUIDO = {
  peticiones: [10e6, "peticiones al Worker"], cpu_ms: [30e6, "ms de CPU"],
  kv_lecturas: [10e6, "lecturas de KV"], kv_escrituras: [1e6, "escrituras de KV"], kv_borrados: [1e6, "borrados de KV"], kv_listados: [1e6, "listados de KV"], kv_bytes: [1e9, "bytes guardados en KV"],
  d1_leidas: [25e9, "filas leídas de D1"], d1_escritas: [50e6, "filas escritas en D1"], d1_bytes: [5e9, "bytes de D1"]
};
const AVISO = 0.6, AHORRO = 0.85;

async function gql(env, query, variables) {
  const r = await fetch("https://api.cloudflare.com/client/v4/graphql", {
    method: "POST",
    headers: { "Authorization": "Bearer " + String(env.CF_API_TOKEN).trim(), "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify({ query, variables })
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || (j.errors && j.errors.length)) throw new Error((j.errors && j.errors[0] && j.errors[0].message) || "HTTP " + r.status);
  return j.data.viewer.accounts[0] || {};
}

// Uso del mes en curso (calendario UTC). Cada consulta es independiente: si una falla, las demás cuentan.
export async function usoDelMes(env, ahora = new Date()) {
  const ini = new Date(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth(), 1));
  const v = { a: String(env.CF_ACCOUNT_ID).trim(), dt0: ini.toISOString(), dt1: ahora.toISOString(), d0: ini.toISOString().slice(0, 10), d1: ahora.toISOString().slice(0, 10) };
  const uso = {}, errores = [];
  const consulta = async (nombre, q, f) => { try { f(await gql(env, q, v)); } catch (e) { errores.push(nombre + ": " + e.message); } };
  await consulta("workers", `query($a: String!, $dt0: Time!, $dt1: Time!) { viewer { accounts(filter: {accountTag: $a}) {
      workersInvocationsAdaptive(limit: 10000, filter: {datetime_geq: $dt0, datetime_leq: $dt1}) { sum { requests cpuTimeUs } } } } }`,
    d => { const l = d.workersInvocationsAdaptive || []; uso.peticiones = l.reduce((s, x) => s + (x.sum.requests || 0), 0); uso.cpu_ms = Math.round(l.reduce((s, x) => s + (x.sum.cpuTimeUs || 0), 0) / 1000); });
  if (uso.peticiones === undefined) await consulta("workers (sin CPU)", `query($a: String!, $dt0: Time!, $dt1: Time!) { viewer { accounts(filter: {accountTag: $a}) {
      workersInvocationsAdaptive(limit: 10000, filter: {datetime_geq: $dt0, datetime_leq: $dt1}) { sum { requests } } } } }`,
    d => { uso.peticiones = (d.workersInvocationsAdaptive || []).reduce((s, x) => s + (x.sum.requests || 0), 0); });
  await consulta("kv", `query($a: String!, $d0: Date!, $d1: Date!) { viewer { accounts(filter: {accountTag: $a}) {
      kvOperationsAdaptiveGroups(limit: 10000, filter: {date_geq: $d0, date_leq: $d1}) { sum { requests } dimensions { actionType } }
      kvStorageAdaptiveGroups(limit: 10000, filter: {date_geq: $d0, date_leq: $d1}, orderBy: [date_DESC]) { max { byteCount } dimensions { date namespaceId } } } } }`,
    d => {
      const por = t => (d.kvOperationsAdaptiveGroups || []).filter(x => x.dimensions.actionType === t).reduce((s, x) => s + x.sum.requests, 0);
      uso.kv_lecturas = por("read"); uso.kv_escrituras = por("write"); uso.kv_borrados = por("delete"); uso.kv_listados = por("list");
      const ult = {}; for (const x of d.kvStorageAdaptiveGroups || []) if (!ult[x.dimensions.namespaceId]) ult[x.dimensions.namespaceId] = x.max.byteCount;
      uso.kv_bytes = Object.values(ult).reduce((s, b) => s + b, 0);
    });
  await consulta("d1", `query($a: String!, $d0: Date!, $d1: Date!) { viewer { accounts(filter: {accountTag: $a}) {
      d1AnalyticsAdaptiveGroups(limit: 10000, filter: {date_geq: $d0, date_leq: $d1}) { sum { rowsRead rowsWritten } }
      d1StorageAdaptiveGroups(limit: 10000, filter: {date_geq: $d0, date_leq: $d1}, orderBy: [date_DESC]) { max { databaseSizeBytes } dimensions { date databaseId } } } } }`,
    d => {
      uso.d1_leidas = (d.d1AnalyticsAdaptiveGroups || []).reduce((s, x) => s + x.sum.rowsRead, 0);
      uso.d1_escritas = (d.d1AnalyticsAdaptiveGroups || []).reduce((s, x) => s + x.sum.rowsWritten, 0);
      const ult = {}; for (const x of d.d1StorageAdaptiveGroups || []) if (!ult[x.dimensions.databaseId]) ult[x.dimensions.databaseId] = x.max.databaseSizeBytes;
      uso.d1_bytes = Object.values(ult).reduce((s, b) => s + b, 0);
    });
  return { uso, errores };
}

let cacheAhorro = { at: 0, v: false };
export async function enAhorro(env) {
  if (Date.now() - cacheAhorro.at < 60000) return cacheAhorro.v;
  const mes = new Date().toISOString().slice(0, 7);
  const v = (await env.FILES.get("consumo:ahorro")) === mes;
  cacheAhorro = { at: Date.now(), v };
  return v;
}

const pct = v => Math.round(v * 1000) / 10;
export async function revisarConsumo(env, enviar) {
  if (!env.CF_API_TOKEN || !env.CF_ACCOUNT_ID) return { sin_token: true };
  const mes = new Date().toISOString().slice(0, 7);
  const { uso, errores } = await usoDelMes(env);
  const filas = Object.entries(INCLUIDO).filter(([k]) => uso[k] !== undefined).map(([k, [lim, nombre]]) => ({ k, nombre, uso: uso[k], incluido: lim, fraccion: uso[k] / lim }));
  const max = filas.reduce((m, f) => f.fraccion > m.fraccion ? f : m, { fraccion: 0 });
  const nivel = max.fraccion >= AHORRO ? 2 : max.fraccion >= AVISO ? 1 : 0;
  const estado = { at: new Date().toISOString(), mes, filas, nivel, errores, max: max.k || null };
  await env.FILES.put("consumo:estado", JSON.stringify(estado));
  if (nivel === 2) { await env.FILES.put("consumo:ahorro", mes); cacheAhorro.at = 0; }
  // Un correo por nivel y por mes
  const avisado = Number(await env.FILES.get("consumo:avisado:" + mes)) || 0;
  if (nivel > avisado && enviar) {
    const lista = filas.sort((a, b) => b.fraccion - a.fraccion).map(f => `${f.nombre}: ${Math.round(f.uso).toLocaleString("es-MX")} de ${f.incluido.toLocaleString("es-MX")} (${pct(f.fraccion)} %)`);
    const titulo = nivel === 2 ? "Modo ahorro activado: el consumo de Cloudflare llegó al 85 %" : "Aviso: el consumo de Cloudflare pasó el 60 %";
    try {
      await enviar(env, {
        asunto: titulo,
        texto: `${titulo}.\n\n${nivel === 2 ? "Para que no haya cobros extra se pausaron los formularios públicos (facturas y expedientes muestran un mensaje para escribir por WhatsApp), la lectura con IA y la sincronización frecuente de la hoja. El panel y la tablet siguen funcionando. Se quita solo el próximo mes.\n\n" : ""}Uso del mes:\n${lista.join("\n")}\n\nPanel: https://basculaypension.com/panel`,
        html: `<div style="font-family:system-ui,sans-serif;font-size:15px"><h2 style="margin:0 0 8px">${titulo}</h2>${nivel === 2 ? "<p>Para que no haya cobros extra se pausaron los formularios públicos (facturas y expedientes muestran un mensaje para escribir por WhatsApp), la lectura con IA y la sincronización frecuente de la hoja. El panel y la tablet siguen funcionando. Se quita solo el próximo mes.</p>" : ""}<ul>${lista.map(l => `<li>${l}</li>`).join("")}</ul><p><a href="https://basculaypension.com/panel">Abrir el panel</a></p></div>`
      });
      await env.FILES.put("consumo:avisado:" + mes, String(nivel), { expirationTtl: 40 * 86400 });
    } catch (e) { console.error("consumo: correo", e && e.message); }
  }
  return estado;
}

export async function estadoConsumo(env) {
  const e = await env.FILES.get("consumo:estado", { type: "json" });
  return { configurado: !!(env.CF_API_TOKEN && env.CF_ACCOUNT_ID), ahorro: await enAhorro(env), estado: e };
}
