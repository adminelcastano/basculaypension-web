// Si la sesión de Cloudflare Access vence, las llamadas a la API reciben una redirección
// al inicio de sesión; en vez de fallar con "sin conexión", se recarga la página para entrar de nuevo.
(() => {
  const f = window.fetch.bind(window);
  let avisado = false;
  window.fetch = async (u, o = {}) => {
    const interna = typeof u === "string" && u.startsWith("/");
    const r = await f(u, interna ? { redirect: "manual", ...o } : o);
    if (interna && (r.type === "opaqueredirect" || r.status === 0) && !avisado) {
      avisado = true;
      alert("Tu sesión venció. La página se va a recargar para que vuelvas a entrar.");
      location.reload();
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
    const r = await fetch("/panel/api/" + ruta, { ...op, headers: { "X-Panel": "1", ...(op.body ? { "Content-Type": "application/json" } : {}) } });
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
  const VISTAS_DINERO = ["resumen", "pagos", "cuentas", "transferencias", "bitacora"];
  const MODS = ["inicio", "caja", "finanzas", "pagos", "agenda", "facturacion", "personal"];
  function ruta(hash = location.hash) {
    const h = String(hash || "").replace(/^#/, "");
    if (!h || h === "inicio" || h === "hoy") return { mod: "inicio" };
    if (h === "turno") return { mod: "caja" };
    if (h === "finanzas") return { mod: "finanzas", vista: "resumen" };
    if (h === "pagos") return { mod: "pagos", vista: "pagos" };
    if (h === "dinero" || h.startsWith("dinero/")) {
      const v = VISTAS_DINERO.includes(h.split("/")[1]) ? h.split("/")[1] : "resumen";
      return v === "pagos" ? { mod: "pagos", vista: "pagos" } : { mod: "finanzas", vista: v };
    }
    return MODS.includes(h) ? { mod: h } : { mod: "inicio" };
  }
  const seccionDe = mod => mod === "finanzas" || mod === "pagos" ? "dinero" : mod;
  const hashDe = (mod, vista) => mod === "inicio" ? "" : mod === "pagos" ? "#dinero/pagos" : mod === "finanzas" ? "#dinero" + (vista && vista !== "resumen" ? "/" + vista : "") : "#" + mod;
  window.EC = { $, $$, esc, toast, api, post, TZ, hoyMx, dinero, ruta, seccionDe, hashDe, VISTAS_DINERO, finVista: ruta().vista && ruta().vista !== "pagos" ? ruta().vista : "resumen" };
})();
