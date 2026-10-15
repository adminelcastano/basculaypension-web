// Notificaciones push en este celular: tarjeta en Hoy para activarlas y, al tocar una notificación, abrir la sección.
// Las incidencias, avisos, informes de tareas y cortes de la tablet llegan aquí (y los recordatorios de la agenda).
(() => {
  const { $, api, post, toast } = EC;
  const caja = $("#i-push");
  const soporta = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  const deB64u = s => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), c => c.charCodeAt(0));
  const aB64u = b => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const aparato = () => (/Android|iPhone|Mobile/i.test(navigator.userAgent) ? "Celular" : "Computadora") + " · panel";

  async function suscribir(pedir) {
    const reg = await navigator.serviceWorker.register("/panel/sw.js", { scope: "/panel" });
    if (pedir && Notification.permission === "default") await Notification.requestPermission();
    if (Notification.permission !== "granted") return false;
    await navigator.serviceWorker.ready;
    const { clave } = await api("push");
    let sub = await reg.pushManager.getSubscription();
    // Si la llave del servidor cambió, la suscripción vieja ya no sirve
    if (sub && sub.options && sub.options.applicationServerKey && aB64u(sub.options.applicationServerKey) !== clave) { await sub.unsubscribe(); sub = null; }
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: deB64u(clave) });
    await post("push", { sub: sub.toJSON(), aparato: aparato() });
    return true;
  }

  function pintar() {
    if (!caja) return;
    const p = soporta ? Notification.permission : "nada";
    caja.hidden = p === "granted";
    if (p === "granted") return;
    const top = `<div class="ini-top"><span class="ibadge" style="--c:#ffb340"><svg><use href="#i-alerta"/></svg></span><span class="ini-k">Notificaciones</span></div>`;
    caja.innerHTML = top + (p === "nada"
      ? `<p class="push-t">Este navegador no recibe notificaciones. En Android abre el panel en <b>Chrome</b>.</p>`
      : p === "denied"
        ? `<p class="push-t">Están <b>bloqueadas</b> en este celular. Permítelas en Chrome: <b>⋮ → Configuración → Notificaciones → basculaypension.com</b>, y vuelve a abrir el panel.</p>`
        : `<p class="push-t">Recibe al instante los <b>cortes</b>, <b>incidencias</b>, <b>avisos</b> e informes de <b>tareas</b> de la tablet.</p><button class="btn btn-primary" type="button" id="push-act">Activar notificaciones</button>`);
  }

  if (caja) caja.addEventListener("click", async e => {
    const b = e.target.closest("#push-act"); if (!b || b.disabled) return;
    b.disabled = true; b.textContent = "Activando…";
    try {
      if (await suscribir(true)) { const r = await post("push/prueba"); toast(r.enviados ? "Listo: te mandé una notificación de prueba." : "Activadas, pero la prueba no llegó. Intenta de nuevo."); }
      else if (Notification.permission === "denied") toast("Las bloqueaste: permítelas en los ajustes de Chrome.");
    } catch (er) { toast("No se pudieron activar: " + (er && er.message || er)); }
    pintar();
  });

  // Al abrir el panel con permiso ya dado: renueva la suscripción en silencio (por si el navegador la cambió)
  if (soporta && Notification.permission === "granted") suscribir(false).catch(() => {});
  pintar();

  // Al tocar una notificación: abre la sección; si llega con el panel abierto, recarga los datos
  const abrir = sec => {
    if (!sec) return;
    if (sec.startsWith("corte:")) { if (window.cajaAbrirCorte) window.cajaAbrirCorte(sec.slice(6)); return; }
    if (window.agendaAbrir) window.agendaAbrir(sec);
  };
  if (soporta) navigator.serviceWorker.addEventListener("message", e => {
    const m = e.data || {};
    if (m.tipo === "abrir") abrir(m.sec);
    if (m.tipo === "abrir" || m.tipo === "push") document.dispatchEvent(new CustomEvent("recargar-todo"));
  });
  const q = new URLSearchParams(location.search).get("abrir");
  if (q) { history.replaceState(history.state, "", location.pathname + location.hash); setTimeout(() => abrir(q), 0); }
})();
