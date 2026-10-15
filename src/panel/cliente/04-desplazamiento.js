// ---- Desplazamiento de página completa: al abrir un detalle se ve desde arriba y al volver se regresa al mismo lugar de la lista ----
(() => {
  const unaColumna = () => matchMedia("(max-width: 820px)").matches;
  const posiciones = new WeakMap();
  const barra = () => (document.querySelector("header.bar") || { offsetHeight: 0 }).offsetHeight;
  // La posición de la lista se guarda mientras se desplaza (al abrir el detalle la página ya se acortó)
  const enLista = new WeakMap();
  addEventListener("scroll", () => { document.querySelectorAll("div.work").forEach(w => { if (!w.classList.contains("ver-detalle") && w.offsetParent) enLista.set(w, scrollY); }); }, { passive: true });
  document.querySelectorAll("div.work").forEach(w => {
    let antes = w.classList.contains("ver-detalle");
    new MutationObserver(() => {
      const ahora = w.classList.contains("ver-detalle");
      if (ahora === antes) return;
      antes = ahora;
      if (!unaColumna()) return;
      if (ahora) {
        posiciones.set(w, enLista.has(w) ? enLista.get(w) : scrollY);
        const top = w.getBoundingClientRect().top + scrollY - barra() - 8;
        scrollTo({ top: Math.max(0, top), behavior: "instant" });
      } else if (posiciones.has(w)) {
        const y = posiciones.get(w);
        requestAnimationFrame(() => scrollTo({ top: y, behavior: "instant" }));
      }
    }).observe(w, { attributes: true, attributeFilter: ["class"] });
  });
  // En dos columnas (iPad horizontal, tabletas) el detalle tiene su propio desplazamiento: cada registro nuevo empieza arriba
  document.querySelectorAll("div.work .detail").forEach(d => new MutationObserver(() => { d.scrollTop = 0; }).observe(d, { childList: true }));
  // Al cambiar de sección, empezar arriba
  document.addEventListener("modulo", () => { if (matchMedia("(max-width: 1200px), (max-height: 640px)").matches) scrollTo({ top: 0, behavior: "instant" }); });
})();
