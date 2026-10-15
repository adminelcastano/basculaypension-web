// ---- Ocultar la parte fija de arriba (título, pestañas, filtros y totales) y colapsar la lista lateral ----
// Cada sección recuerda cómo la dejaste en este navegador.
(() => {
  const leer = k => { try { return localStorage.getItem(k); } catch { return null; } };
  const guardar = (k, v) => { try { v ? localStorage.setItem(k, "1") : localStorage.removeItem(k); } catch {} };
  const flecha = '<svg aria-hidden="true" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" d="M6 15l6-6 6 6"/></svg>';
  document.querySelectorAll("main.mod").forEach(m => {
    const tb = m.querySelector(":scope > .titlebar"), tools = m.querySelector(":scope > .tools");
    if (!tb || !tools) return;
    const k = "enc:" + m.id, b = document.createElement("button");
    b.type = "button"; b.className = "enc-tg";
    const pintar = () => { const o = m.classList.contains("enc-oculto"); b.innerHTML = flecha + `<span>${o ? "Mostrar filtros" : "Ocultar filtros"}</span>`; b.setAttribute("aria-expanded", String(!o)); b.title = o ? "Mostrar título, pestañas y filtros" : "Ocultar título, pestañas y filtros"; };
    m.classList.toggle("enc-oculto", leer(k) === "1"); pintar();
    b.addEventListener("click", () => { m.classList.toggle("enc-oculto"); guardar(k, m.classList.contains("enc-oculto")); pintar(); });
    tb.appendChild(b);
  });
  document.querySelectorAll("div.work").forEach(w => {
    const lista = w.querySelector(":scope > .list"); if (!lista) return;
    const k = "lat:" + w.id, b = document.createElement("button");
    b.type = "button"; b.className = "lat-tg";
    b.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" d="M9.5 6l6 6-6 6"/></svg>';
    const ubicar = () => { const o = w.classList.contains("lista-oculta"); b.style.left = o ? "0px" : Math.max(0, lista.offsetWidth - 1) + "px"; b.setAttribute("aria-label", o ? "Mostrar la lista" : "Ocultar la lista"); b.title = o ? "Mostrar la lista" : "Ocultar la lista para ver el detalle completo"; b.setAttribute("aria-expanded", String(!o)); };
    w.classList.toggle("lista-oculta", leer(k) === "1");
    b.addEventListener("click", () => { w.classList.toggle("lista-oculta"); guardar(k, w.classList.contains("lista-oculta")); requestAnimationFrame(ubicar); setTimeout(ubicar, 250); });
    w.appendChild(b);
    if (window.ResizeObserver) new ResizeObserver(ubicar).observe(lista);
    addEventListener("resize", ubicar); document.addEventListener("modulo", () => setTimeout(ubicar, 50)); ubicar();
  });
})();
