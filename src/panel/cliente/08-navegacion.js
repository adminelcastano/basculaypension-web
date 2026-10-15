// ---- Navegación (14 oct 2026): barra fija del detalle con ← Lista y flechas ‹ ›, índice de la ficha,
// botón atrás del celular, deslizar a la derecha para volver, teclado (← → Esc) y botón para subir ----
(() => {
  const unaColumna = () => matchMedia("(max-width: 820px)").matches;
  const svg = id => `<svg aria-hidden="true"><use href="#${id}"/></svg>`;
  const llave = el => el && (el.dataset.id || el.dataset.k || el.dataset.t || "");
  const zonas = [...document.querySelectorAll("div.work")].map(w => ({ w, mod: w.closest(".mod"), lista: w.querySelector(".list"), det: w.querySelector(".detail"), ultima: "" }));
  const zonaVisible = () => zonas.find(z => !z.mod.hidden);
  const items = z => [...z.lista.querySelectorAll(".item, .pitem")].filter(llave);

  // Registro que se está viendo: el último tocado en la lista (o el marcado como actual)
  zonas.forEach(z => z.lista.addEventListener("click", e => { const it = e.target.closest(".item, .pitem"); if (it && llave(it)) z.ultima = llave(it); }, true));
  function posicion(z) {
    const lista = items(z);
    let i = z.ultima ? lista.findIndex(x => llave(x) === z.ultima) : -1;
    if (i < 0) i = lista.findIndex(x => x.getAttribute("aria-current") === "true");
    return { lista, i };
  }

  // ---- Barra del detalle ----
  function armar(z) {
    const d = z.det, primero = d.firstElementChild;
    if (!primero || primero.classList.contains("empty")) return;
    let nav = d.querySelector(":scope > .dnav");
    if (!nav) {
      nav = document.createElement("div");
      nav.className = "dnav";
      nav.innerHTML = `<button class="dn-lista" type="button">${svg("i-chev")}Lista</button><b class="dn-tit"></b>
        <span class="dn-der"><span class="dn-pos"></span><button class="dn-flecha dn-prev" type="button" aria-label="Anterior" title="Anterior (←)">${svg("i-chev")}</button><button class="dn-flecha dn-next" type="button" aria-label="Siguiente" title="Siguiente (→)">${svg("i-chev")}</button></span>`;
      d.prepend(nav);
      nav.querySelector(".dn-lista").addEventListener("click", () => cerrar(z));
      nav.querySelector(".dn-prev").addEventListener("click", () => mover(z, -1));
      nav.querySelector(".dn-next").addEventListener("click", () => mover(z, 1));
      // Índice de secciones cuando la ficha es larga
      const secs = [...d.querySelectorAll("section.card")].filter(x => x.querySelector(":scope > h3"));
      if (secs.length >= 4) {
        const ind = document.createElement("div");
        ind.className = "dn-indice";
        secs.forEach(sec => {
          const b = document.createElement("button"); b.type = "button";
          { const h = sec.querySelector(":scope > h3").cloneNode(true); h.querySelectorAll(".num").forEach(n => n.remove()); b.textContent = h.textContent.trim(); }
          b.addEventListener("click", () => { sec.scrollIntoView({ behavior: "smooth", block: "start" }); });
          ind.append(b); b._sec = sec;
        });
        nav.append(ind);
      }
      // El nombre aparece en la barra cuando el título grande sale de la pantalla
      const h2 = d.querySelector(".detail-head h2");
      nav.querySelector(".dn-tit").textContent = h2 ? h2.textContent.trim() : "";
      if (h2 && "IntersectionObserver" in window) {
        new IntersectionObserver(([en]) => nav.classList.toggle("compacta", !en.isIntersecting), { rootMargin: "-120px 0px 0px 0px" }).observe(h2);
      }
    }
    contar(z);
    document.documentElement.style.setProperty("--dnav-alto", (nav.offsetHeight + (unaColumna() ? 60 : 8)) + "px");
  }
  function contar(z) {
    const nav = z.det.querySelector(":scope > .dnav"); if (!nav) return;
    const { lista, i } = posicion(z);
    const pos = nav.querySelector(".dn-pos"), der = nav.querySelector(".dn-der");
    der.hidden = i < 0;
    if (i >= 0) {
      pos.textContent = `${i + 1} de ${lista.length}`;
      nav.querySelector(".dn-prev").disabled = i === 0;
      nav.querySelector(".dn-next").disabled = i === lista.length - 1;
    }
  }
  let saltando = false;
  function mover(z, paso) {
    const { lista, i } = posicion(z);
    const sig = lista[i + paso]; if (i < 0 || !sig) return;
    z.ultima = llave(sig); saltando = true;
    sig.click();
    // En dos columnas la lista acompaña: el registro nuevo queda a la vista y marcado
    if (!unaColumna()) { sig.scrollIntoView({ block: "nearest" }); sig.focus({ preventScroll: true }); }
  }
  function cerrar(z) {
    if (!z.w.classList.contains("ver-detalle")) return;
    if (unaColumna() && (history.state || {}).detalle) { history.back(); return; }
    const b = z.det.querySelector(".back");
    if (b) b.click(); else z.w.classList.remove("ver-detalle");
  }
  zonas.forEach(z => {
    new MutationObserver(() => {
      armar(z);
      if (saltando) { saltando = false; if (unaColumna()) scrollTo({ top: 0, behavior: "instant" }); else z.det.scrollTop = 0; }
    }).observe(z.det, { childList: true });
    new MutationObserver(() => contar(z)).observe(z.lista, { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-current"] });
  });

  // ---- Botón atrás del celular: cierra el detalle y luego regresa a la sección anterior ----
  if (!history.state) {
    const r = EC.ruta();
    history.replaceState({ mod: r.mod, vista: r.vista }, "", location.href);
  }
  zonas.forEach(z => {
    let abierto = z.w.classList.contains("ver-detalle");
    new MutationObserver(() => {
      const ahora = z.w.classList.contains("ver-detalle");
      if (ahora === abierto) return;
      abierto = ahora;
      z.mod.classList.toggle("en-detalle", ahora);
      // Foco: al abrir, en el título del detalle; al volver, en el registro de la lista
      if (unaColumna()) requestAnimationFrame(() => {
        if (ahora) { const h = z.det.querySelector(".detail-head h2"); if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }); } }
        else { const it = z.ultima && items(z).find(x => llave(x) === z.ultima); if (it) it.focus({ preventScroll: true }); }
      });
      const st = history.state || {};
      if (ahora && unaColumna() && !st.detalle) history.pushState({ mod: st.mod || z.mod.id.slice(4), detalle: true }, "", location.href);
      if (!ahora && st.detalle) { ignorar = true; history.back(); }
    }).observe(z.w, { attributes: true, attributeFilter: ["class"] });
  });
  let ignorar = false;
  addEventListener("popstate", e => {
    if (ignorar) { ignorar = false; return; }
    const st = e.state || {};
    const z = zonaVisible();
    if (z && z.w.classList.contains("ver-detalle") && !st.detalle && unaColumna()) {
      const b = z.det.querySelector(".back"); if (b) b.click(); else z.w.classList.remove("ver-detalle");
      return;
    }
    if (st.detalle && !(z && z.w.classList.contains("ver-detalle"))) { history.replaceState({ mod: st.mod }, "", location.href); return; }
    const actualMod = ["inicio", "facturacion", "personal", "caja", "pagos", "finanzas", "agenda"].find(m => { const el = document.getElementById("mod-" + m); return el && !el.hidden; });
    const destino = st.mod || "inicio";
    if ((destino !== actualMod || (destino === "finanzas" && st.vista && st.vista !== EC.finVista)) && window.irA) window.irA(destino, { vista: st.vista });
  });

  // ---- Teclado: ← → anterior y siguiente, Esc vuelve a la lista ----
  addEventListener("keydown", e => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    const z = zonaVisible(); if (!z || !z.det.querySelector(":scope > .dnav")) return;
    if (e.key === "ArrowLeft") { e.preventDefault(); mover(z, -1); }
    else if (e.key === "ArrowRight") { e.preventDefault(); mover(z, 1); }
    else if (e.key === "Escape" && unaColumna()) cerrar(z);
  });

  // ---- Deslizar a la derecha sobre el detalle para volver a la lista ----
  let toque = null;
  const noDeslizar = el => el.closest("input, textarea, select, canvas, .pdf-pages, .dn-indice, .fotos, img, [data-noswipe]") ||
    (() => { for (let n = el; n && n !== document.body; n = n.parentElement) if (n.scrollWidth > n.clientWidth + 2 && /(auto|scroll)/.test(getComputedStyle(n).overflowX)) return true; return false; })();
  document.addEventListener("touchstart", e => {
    const z = zonaVisible();
    if (!z || !unaColumna() || !z.w.classList.contains("ver-detalle") || e.touches.length !== 1 || !z.det.contains(e.target) || noDeslizar(e.target)) { toque = null; return; }
    const p = e.touches[0]; toque = { z, x: p.clientX, y: p.clientY, t: Date.now(), dx: 0, horizontal: null };
  }, { passive: true });
  document.addEventListener("touchmove", e => {
    if (!toque) return;
    const p = e.touches[0], dx = p.clientX - toque.x, dy = p.clientY - toque.y;
    if (toque.horizontal === null && Math.abs(dx) + Math.abs(dy) > 12) toque.horizontal = Math.abs(dx) > Math.abs(dy) * 1.5 && dx > 0;
    if (!toque.horizontal) return;
    toque.dx = Math.max(0, dx);
    const d = toque.z.det; d.classList.add("arrastre"); d.classList.remove("suelta");
    d.style.transform = `translateX(${Math.min(toque.dx * .5, 120)}px)`; d.style.opacity = String(1 - Math.min(toque.dx / 600, .35));
  }, { passive: true });
  document.addEventListener("touchend", () => {
    if (!toque) return;
    const { z, dx, t, horizontal } = toque; toque = null;
    const d = z.det; d.classList.remove("arrastre"); d.classList.add("suelta"); d.style.transform = ""; d.style.opacity = "";
    if (horizontal && (dx > 110 || (dx > 60 && Date.now() - t < 300))) cerrar(z);
  });

  // ---- Botón para volver arriba (página, lista o detalle, el que se esté desplazando) ----
  const arriba = document.getElementById("arriba");
  let fuente = document.scrollingElement;
  const alto = el => el === document.scrollingElement ? innerHeight : el.clientHeight;
  function revisar() { arriba.classList.toggle("on", !!fuente && fuente.scrollTop > alto(fuente) * 1.2); }
  document.addEventListener("scroll", e => {
    const el = e.target === document ? document.scrollingElement : e.target;
    if (!(el instanceof Element) || !(el === document.scrollingElement || el.matches(".list, .detail, .ag, #mod-inicio"))) return;
    fuente = el; revisar();
  }, { capture: true, passive: true });
  arriba.addEventListener("click", () => { if (fuente) fuente.scrollTo({ top: 0, behavior: "smooth" }); });
  document.addEventListener("modulo", () => { fuente = document.scrollingElement; setTimeout(revisar, 50); });
})();
