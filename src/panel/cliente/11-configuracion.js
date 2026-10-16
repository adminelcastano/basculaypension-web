// ---- Configuración (engranaje arriba a la derecha): reúne lo que se configura una vez ----
// Tablet y encargados, cuentas, categorías, lugares de compra, notificaciones, conexiones y sistema.
// Cada sección dibuja su parte aquí al abrirse (evento "modulo" = "config"); lo del día a día sigue en su sección.
(() => {
  const { $, api } = EC;
  const ir = ap => {
    const el = ap && document.getElementById("cfg-" + ap);
    if (el) requestAnimationFrame(() => el.scrollIntoView({ behavior: "smooth", block: "start" }));
    else scrollTo({ top: 0 });
  };
  const abrir = ap => {
    if (window.irA) window.irA("config", { historia: "push", vista: ap || null });
    ir(ap);
  };
  const b = $("#cfg-abrir");
  if (b) b.addEventListener("click", () => abrir(null));
  // Enlaces cortos al final de cada sección y el índice de Configuración
  document.addEventListener("click", e => {
    const a = e.target.closest("a[data-cfg]"); if (!a) return;
    e.preventDefault();
    if ($("#mod-config").hidden) abrir(a.dataset.cfg); else { history.replaceState({ mod: "config", vista: a.dataset.cfg }, "", "#config/" + a.dataset.cfg); ir(a.dataset.cfg); }
  });
  document.addEventListener("modulo", async e => {
    if (e.detail !== "config") return;
    if (EC.cfgVista) ir(EC.cfgVista);
    try { if (window.pintarConsumo) window.pintarConsumo(await api("consumo")); } catch (er) { if (er.message !== "sesion" && window.pintarConsumo) window.pintarConsumo(null); }
  });
  // Abierto desde un enlace (#config/...) al cargar la página
  const r = EC.ruta();
  if (r.mod === "config" && window.irA) window.irA("config", { vista: r.vista });
})();
