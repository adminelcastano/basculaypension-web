// ---- Submenú lateral de cada sección (15 oct 2026) ----
// Cada sección muestra todos sus tipos a la vez, en bloques (<section class="bloque" data-bloque>); el submenú
// lista los bloques con su contador y, al tocar uno, la página baja hasta él. En computadora se puede colapsar
// (se recuerda en este navegador); en celular se abre con «☰ Tipos» y se desliza desde la izquierda.
(() => {
  const { $ } = EC;
  const leer = k => { try { return localStorage.getItem(k); } catch { return null; } };
  const guardar = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
  const celular = () => matchMedia("(max-width: 820px)").matches;
  let manual = 0; // si la persona se desplaza, se deja de reajustar la posición
  for (const ev of ["wheel", "touchmove", "keydown"]) addEventListener(ev, () => { manual = Date.now(); }, { passive: true });

  function irBloque(mod, clave, opciones = {}) {
    const m = $("#mod-" + mod); if (!m) return;
    const b = clave && clave !== "todo" ? m.querySelector(`[data-bloque="${CSS.escape(clave)}"]`) : null;
    const pedido = Date.now();
    const bajar = suave => { if (manual > pedido) return; if (b) b.scrollIntoView({ behavior: suave ? "smooth" : "instant", block: "start" }); else scrollTo({ top: 0, behavior: suave ? "smooth" : "instant" }); };
    requestAnimationFrame(() => bajar(!!opciones.suave));
    // Los datos llegan después: se vuelve a ajustar mientras la persona no se mueva
    if (!opciones.suave) { setTimeout(() => bajar(false), 450); setTimeout(() => bajar(false), 1400); }
    marcar(m, clave || "todo");
  }
  function marcar(m, clave) {
    m.querySelectorAll(".sub-nav [data-ir]").forEach(x => { if (x.dataset.ir === clave) x.setAttribute("aria-current", "true"); else x.removeAttribute("aria-current"); });
  }

  document.querySelectorAll("main.mod[data-sub]").forEach(m => {
    const mod = m.id.slice(4), bloques = [...m.querySelectorAll(".bloque[data-bloque]")];
    // Secciones de lista y detalle: los tipos son grupos dentro de la lista (data-sub-items="clave|Título|icono;…")
    const fijos = (m.dataset.subItems || "").split(";").filter(Boolean).map(x => { const [clave, txt, ico] = x.split("|"); return { clave, txt, ico: "#" + ico }; });
    const tipos = fijos.length ? fijos : bloques.map(b => ({ clave: b.dataset.bloque, txt: b.querySelector(".bq-h span").textContent, ico: (b.querySelector(".bq-h use") || { getAttribute: () => "" }).getAttribute("href") }));
    if (!tipos.length) return;
    // Estructura: [titlebar][tools] + .sub-lay (submenú | contenido)
    const lay = document.createElement("div"); lay.className = "sub-lay";
    const nav = document.createElement("aside"); nav.className = "sub-nav"; nav.setAttribute("aria-label", "Tipos");
    const main = document.createElement("div"); main.className = "sub-main";
    const ancla = m.querySelector(":scope > .tools") || m.querySelector(":scope > .titlebar");
    let n = ancla.nextSibling; const mover = []; while (n) { mover.push(n); n = n.nextSibling; }
    mover.forEach(x => main.appendChild(x));
    lay.append(nav, main); ancla.after(lay);
    const item = (clave, txt, ico) => `<button type="button" data-ir="${clave}" title="${EC.esc(txt)}">${ico ? `<svg aria-hidden="true"><use href="${ico}"/></svg>` : `<svg aria-hidden="true"><use href="#i-inbox"/></svg>`}<span class="sn-t">${EC.esc(txt)}</span><b class="sn-n" hidden></b></button>`;
    nav.innerHTML = `<div class="sn-top"><span class="sn-k">Tipos</span><button type="button" class="sn-colap" aria-label="Colapsar el submenú" title="Colapsar"><svg aria-hidden="true"><use href="#i-chev"/></svg></button></div>
      ${item("todo", "Todo", "#i-todo")}${tipos.map(t => item(t.clave, t.txt, t.ico)).join("")}`;
    // Contadores que ya se hayan puesto antes de armar el submenú
    for (const t of tipos) { const c = (EC.cuentas || {})[mod + "|" + t.clave]; if (c) EC.bloqueN(mod, t.clave, c[0], c[1]); }
    // Colapsar (computadora): se recuerda; las secciones con lista y detalle arrancan colapsadas
    const k = "sub:" + m.id, guardado = leer(k);
    m.classList.toggle("sn-col", guardado ? guardado === "1" : !!m.querySelector("div.work"));
    nav.querySelector(".sn-colap").addEventListener("click", () => { const c = !m.classList.contains("sn-col"); m.classList.toggle("sn-col", c); guardar(k, c ? "1" : "0"); });
    // Celular: botón «☰ Tipos» y fondo para cerrar
    const abrir = document.createElement("button"); abrir.type = "button"; abrir.className = "sn-abrir"; abrir.innerHTML = `<svg aria-hidden="true" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M4 7h16M4 12h16M4 17h16"/></svg>Tipos`;
    abrir.setAttribute("aria-expanded", "false");
    m.querySelector(":scope > .titlebar").appendChild(abrir);
    const fondo = document.createElement("div"); fondo.className = "sn-fondo"; lay.appendChild(fondo);
    const cerrarMenu = () => { m.classList.remove("sn-open"); abrir.setAttribute("aria-expanded", "false"); };
    abrir.addEventListener("click", () => { const o = !m.classList.contains("sn-open"); m.classList.toggle("sn-open", o); abrir.setAttribute("aria-expanded", String(o)); });
    fondo.addEventListener("click", cerrarMenu);
    addEventListener("keydown", e => { if (e.key === "Escape") cerrarMenu(); });
    nav.addEventListener("click", e => {
      const b = e.target.closest("[data-ir]"); if (!b) return;
      cerrarMenu();
      manual = 0;
      const clave = b.dataset.ir === "todo" ? null : b.dataset.ir;
      history.replaceState({ ...(history.state || {}), mod, vista: clave }, "", EC.hashDe(mod, clave) || location.pathname);
      irBloque(mod, clave, { suave: true });
    });
    // Marca en el submenú el bloque que se está viendo
    if ("IntersectionObserver" in window) {
      const vistos = new Map();
      const io = new IntersectionObserver(es => {
        es.forEach(x => vistos.set(x.target, x.isIntersecting));
        const b = bloques.find(x => vistos.get(x));
        if (b && !m.hidden) marcar(m, scrollY < 40 ? "todo" : b.dataset.bloque);
      }, { rootMargin: "-25% 0px -65% 0px" });
      bloques.forEach(b => io.observe(b));
    }
  });
  EC.irBloque = irBloque;
  // Abierto con un enlace a un bloque (#agenda/tarea, #dinero/compras…) al cargar la página
  const r = EC.ruta();
  if (r.vista && r.mod !== "config") irBloque(r.mod, r.vista);
})();
