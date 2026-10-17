// ---- Configuración (engranaje arriba a la derecha): reúne lo que se configura una vez ----
// Tablet y encargados, cuentas, categorías, lugares de compra, notificaciones, conexiones y sistema.
// Cada sección dibuja su parte aquí al abrirse (evento "modulo" = "config"); lo del día a día sigue en su sección.
(() => {
  const { $, api } = EC;
  // Cada apartado es un bloque: en computadora se baja hasta él; en celular y tablet se ve solo ese
  const abrir = ap => { if (window.irA) window.irA("config", { historia: "push", vista: ap || null }); };
  const b = $("#cfg-abrir");
  if (b) b.addEventListener("click", () => abrir(null));
  // Enlaces cortos al final de cada sección y el índice de Configuración
  document.addEventListener("click", e => {
    const a = e.target.closest("a[data-cfg]"); if (!a) return;
    e.preventDefault();
    abrir(a.dataset.cfg);
  });
  document.addEventListener("modulo", async e => {
    if (e.detail !== "config") return;
    try { if (window.pintarConsumo) window.pintarConsumo(await api("consumo")); } catch (er) { if (er.message !== "sesion" && window.pintarConsumo) window.pintarConsumo(null); }
  });
  // Abierto desde un enlace (#config/...) al cargar la página
  const r = EC.ruta();
  if (r.mod === "config" && window.irA) window.irA("config", { vista: r.vista });
  // Estado de cada apartado para su tarjeta del índice (celular y tablet)
  const permiso = () => "Notification" in window ? Notification.permission : "nada";
  // (después de cargar todo el código del panel: el índice se arma en 12-submenu.js)
  setTimeout(() => (EC.bloqueInfo && EC.bloqueInfo("config", "notificaciones", { texto: { granted: "Activadas en este aparato", denied: "Bloqueadas en este aparato", default: "Sin activar en este aparato" }[permiso()] || "Este navegador no las recibe" }), EC.bloqueInfo && EC.bloqueInfo("config", "conexiones", { texto: "Google Drive" })), 0);
})();
