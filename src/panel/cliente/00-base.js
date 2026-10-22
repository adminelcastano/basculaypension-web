// Si la sesión de Cloudflare Access vence, las llamadas a la API reciben una redirección
// al inicio de sesión; en vez de fallar con "sin conexión", se recarga la página para entrar de nuevo.
(() => {
  const f = window.fetch.bind(window);
  let avisado = false;

  function sesionVencida() {
    const d = document.createElement("dialog");
    d.className = "sesion-vencida";
    d.setAttribute("aria-labelledby", "sv-t");
    d.innerHTML = '<h2 id="sv-t">Tu sesión venció</h2><p>Vuelve a entrar para seguir trabajando. Lo que no guardaste se pierde al recargar.</p><button type="button" class="btn">Volver a entrar</button>';
    d.querySelector("button").addEventListener("click", () => location.reload());
    d.addEventListener("cancel", e => e.preventDefault());
    document.body.appendChild(d);
    try { d.showModal(); } catch { location.reload(); }
  }
  window.fetch = async (u, o = {}) => {
    const interna = typeof u === "string" && u.startsWith("/");
    const r = await f(u, interna ? { redirect: "manual", ...o } : o);
    if (interna && (r.type === "opaqueredirect" || r.status === 0) && !avisado) {
      avisado = true;
      sesionVencida();
      throw new Error("sesion");
    }
    return r;
  };
})();

// ---- Herramientas comunes del panel (una sola copia para todas las secciones) ----
// Cada sección las toma de window.EC: const { $, esc, toast, api, post } = EC;
(() => {
  const $ = (q, el = document) => el.querySelector(q);
  const $$ = (q, el = document) => [...el.querySelectorAll(q)];
  const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ESC[c]);
  function toast(msg) { const t = $("#toast"); if (!t) return; t.textContent = msg; t.classList.add("on"); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("on"), 2200); }
  // Llamada a la API del panel: devuelve el JSON si ok; si no, lanza un error con su mensaje (y los errores por campo)
  async function api(ruta, op = {}) {
    // Si la red falla (celular cambiando de red, despliegue en curso), se reintenta una vez antes de avisar
    const pedir = () => fetch("/panel/api/" + ruta, { ...op, headers: { "X-Panel": "1", ...(op.body ? { "Content-Type": "application/json" } : {}) } });
    let r;
    try { r = await pedir(); }
    catch (e) {
      if (e && e.message === "sesion") throw e;
      await new Promise(ok => setTimeout(ok, 900));
      try { r = await pedir(); } catch (e2) { if (e2 && e2.message === "sesion") throw e2; throw new Error("No hay conexión con el servidor. Revisa el internet y toca «Reintentar»."); }
    }
    if (r.status === 401 || r.status === 403) { toast("Tu sesión expiró. Recarga la página."); throw new Error("sesion"); }
    const j = await r.json().catch(() => ({ ok: false, error: "Respuesta inválida del servidor." }));
    if (!j.ok) { const e = new Error(j.error || "Error"); e.errores = j.errores; e.datos = j; throw e; }
    return j;
  }
  const post = (ruta, cuerpo) => api(ruta, { method: "POST", body: JSON.stringify(cuerpo || {}) });
  const TZ = "America/Mexico_City";
  const hoyMx = () => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
  // $1,234.50 (dec = 2) o $1,235 (dec = 0); negativos con signo menos tipográfico
  const dinero = (v, dec = 2) => (v < 0 ? "−" : "") + "$" + Math.abs(Number(v) || 0).toLocaleString("es-MX", { minimumFractionDigits: dec, maximumFractionDigits: dec });
  // ---- Secciones y direcciones (#hash) ----
  // Menú: Hoy (inicio) · Caja · Dinero · Agenda · Facturas · Personal. Dinero tiene vistas: resumen, pagos, cuentas,
  // transferencias y bitacora; "pagos" vive en #mod-pagos y las demás en #mod-finanzas. Los enlaces viejos siguen sirviendo.
  // Desde el 15 oct 2026 Dinero es una sola pantalla con bloques; la "vista" es el bloque al que se baja
  const VISTAS_DINERO = ["resumen", "bancos", "obligaciones", "movimientos"];
  const ALIAS_DINERO = { pagos:"movimientos", programados:"movimientos", hechos:"movimientos", bitacora:"movimientos", efectivo:"bancos", cuentas:"bancos", estados:"bancos" };
  const MODS = ["inicio", "caja", "finanzas", "agenda", "facturacion", "personal", "config"];
  // Configuración (engranaje): #config o #config/<apartado> (tablet, cuentas, categorias, lugares, notificaciones, conexiones, sistema)
  function ruta(hash = location.hash) {
    const h = String(hash || "").replace(/^#/, "");
    if (!h || h === "inicio" || h === "hoy") return { mod: "inicio" };
    if (h === "turno") return { mod: "caja" };
    if (h === "finanzas") return { mod: "finanzas", vista: null };
    if (h === "pagos") return { mod: "finanzas", vista: "movimientos" };
    if (h === "dinero/salarios" || h === "finanzas/salarios") return { mod: "config", vista: "conexiones" };
    if (h === "dinero/transferencias" || h === "finanzas/transferencias") return { mod: "caja", vista: "transferencias" };
    if (h === "config" || h.startsWith("config/")) return { mod: "config", vista: h.split("/")[1] || null };
    if (h === "dinero" || h.startsWith("dinero/")) {
      const v = h.split("/")[1] || "";
      if (v === "compras") return { mod: "agenda", vista: "compras" };
      if (v === "transferencias") return { mod: "caja", vista: "transferencias" };
      return { mod: "finanzas", vista: VISTAS_DINERO.includes(v) ? v : (ALIAS_DINERO[v] || null) };
    }
    const [m, v] = h.split("/");
    if (m === "finanzas" && v === "compras") return { mod: "agenda", vista: "compras" };
    if (m === "finanzas" && v === "transferencias") return { mod: "caja", vista: "transferencias" };
    if (m === "finanzas" && v) return { mod: "finanzas", vista: VISTAS_DINERO.includes(v) ? v : (ALIAS_DINERO[v] || null) };
    return MODS.includes(m) ? { mod: m, vista: v || null } : { mod: "inicio" };
  }
  const seccionDe = mod => mod === "finanzas" || mod === "pagos" ? "dinero" : mod;
  // Contador de un bloque (título del bloque y submenú lateral); urgente = en rojo
  function bloqueN(mod, clave, n, urgente = false) {
    // El bloque puede ser una sección (.bloque) o un grupo dentro de una lista (Facturas, Personal)
    const b = document.querySelector(`#mod-${mod} [data-bloque="${clave}"]`);
    (EC.cuentas = EC.cuentas || {})[mod + "|" + clave] = [n, urgente];
    for (const el of [b && b.querySelector(".bq-n"), document.querySelector(`#mod-${mod} .sub-nav [data-ir="${clave}"] .sn-n`)]) {
      if (!el) continue;
      el.hidden = n == null || n === "" || n === 0; el.textContent = n == null ? "" : n; el.classList.toggle("rojo", !!urgente);
    }
  }
  const hashDe = (mod, vista) => mod === "inicio" ? (vista ? "#inicio/" + vista : "") : mod === "config" ? "#config" + (vista ? "/" + vista : "") : mod === "finanzas" ? "#dinero" + (vista ? "/" + vista : "") : "#" + mod + (vista ? "/" + vista : "");
  window.EC = { $, $$, esc, toast, api, post, TZ, hoyMx, dinero, ruta, seccionDe, hashDe, bloqueN, VISTAS_DINERO };
})();

// ---- Confirmación con el diseño del panel (en vez de la ventana del navegador) ----
// EC.confirmar("¿Eliminar el pago?", "Se quita también de Dinero.", "Eliminar", true) → Promise<boolean>
(() => {
  let dlg = null;
  function crear() {
    dlg = document.createElement("dialog");
    dlg.className = "confirmar";
    dlg.innerHTML = `<form method="dialog"><h2 class="cf-t"></h2><p class="cf-x"></p><div class="cf-b"><button class="btn btn-line" value="no" type="submit">Cancelar</button><button class="btn btn-primary cf-si" value="si" type="submit"></button></div></form>`;
    document.body.appendChild(dlg);
    dlg.addEventListener("click", e => { if (e.target === dlg) dlg.close("no"); }); // tocar fuera = cancelar
  }
  window.EC.confirmar = (titulo, texto = "", si = "Aceptar", peligro = false) => new Promise(res => {
    if (!dlg) crear();
    dlg.querySelector(".cf-t").textContent = titulo;
    dlg.querySelector(".cf-x").textContent = texto; dlg.querySelector(".cf-x").hidden = !texto;
    const b = dlg.querySelector(".cf-si"); b.textContent = si; b.className = "btn cf-si " + (peligro ? "btn-bad-lleno" : "btn-primary");
    dlg.returnValue = "no";
    dlg.onclose = () => res(dlg.returnValue === "si");
    // En lo que borra o cierra, el foco queda en Cancelar (un Enter por error no borra nada)
    dlg.showModal(); (peligro ? dlg.querySelector('[value="no"]') : b).focus();
  });
})();

// ---- Tablas: en el celular cada renglón se ve como tarjeta (cada celda lleva el nombre de su columna) ----
(() => {
  function etiquetar(t) {
    if (t.dataset.tarjetas) return;
    const ths = [...t.querySelectorAll("thead th")].map(th => th.textContent.trim());
    if (!ths.length) return;
    t.dataset.tarjetas = "1";
    t.querySelectorAll("tbody tr").forEach(tr => [...tr.children].forEach((td, i) => { if (ths[i] && !td.dataset.k) td.dataset.k = ths[i]; }));
  }
  const revisar = raiz => raiz.querySelectorAll && raiz.querySelectorAll("table.cmovs, table.tcortes").forEach(etiquetar);
  new MutationObserver(ms => { for (const m of ms) for (const n of m.addedNodes) if (n.nodeType === 1) { if (n.matches && n.matches("table.cmovs, table.tcortes")) etiquetar(n); else revisar(n); } })
    .observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener("DOMContentLoaded", () => revisar(document));
})();
