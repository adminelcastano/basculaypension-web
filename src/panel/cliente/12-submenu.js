// ---- Submenú lateral de cada sección (15 oct 2026) ----
// Cada sección muestra todos sus tipos a la vez, en bloques (<section class="bloque" data-bloque>); el submenú
// lista los bloques con su contador y, al tocar uno, la página baja hasta él. En computadora se puede colapsar
// (se recuerda en este navegador); en celular se abre con «☰ Tipos» y se desliza desde la izquierda.
(() => {
  const { $ } = EC;
  const leer = k => { try { return localStorage.getItem(k); } catch { return null; } };
  const guardar = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
  const celular = () => matchMedia("(max-width: 820px)").matches;
  // Celular y tablet (hasta 1200 px): en las secciones con data-uno se ve un tipo a la vez; sin tipo elegido,
  // un índice de tarjetas con el contador y el estado de cada tipo. En computadora se ve todo, como antes.
  const mqUno = matchMedia("(max-width: 1200px)");
  const esUno = m => !!m && m.hasAttribute("data-uno") && mqUno.matches;
  EC.esUno = mod => esUno($("#mod-" + mod));
  let manual = 0; // si la persona se desplaza, se deja de reajustar la posición
  for (const ev of ["wheel", "touchmove", "keydown"]) addEventListener(ev, () => { manual = Date.now(); }, { passive: true });

  function irBloque(mod, clave, opciones = {}) {
    const m = $("#mod-" + mod); if (!m) return;
    if (esUno(m)) { mostrarUno(m, clave && clave !== "todo" ? clave : null); return; }
    const b = clave && clave !== "todo" ? m.querySelector(`[data-bloque="${CSS.escape(clave)}"]`) : null;
    const pedido = Date.now();
    const bajar = suave => { if (manual > pedido) return; if (b) b.scrollIntoView({ behavior: suave ? "smooth" : "instant", block: "start" }); else scrollTo({ top: 0, behavior: suave ? "smooth" : "instant" }); };
    requestAnimationFrame(() => bajar(!!opciones.suave));
    // Los datos llegan después: se vuelve a ajustar mientras la persona no se mueva
    if (!opciones.suave) { setTimeout(() => bajar(false), 450); setTimeout(() => bajar(false), 1400); }
    marcar(m, clave || "todo");
  }
  // Modo un tipo a la vez: solo el bloque elegido, o el índice si no hay ninguno
  function mostrarUno(m, clave) {
    const ok = clave && m.querySelector(`.bloque[data-bloque="${CSS.escape(clave)}"]`);
    m.classList.toggle("en-idx", !ok);
    if (ok) m.dataset.activo = clave; else delete m.dataset.activo;
    m.querySelectorAll(".bloque[data-bloque]").forEach(b => b.classList.toggle("activo", !!ok && b.dataset.bloque === clave));
    marcar(m, ok ? clave : "todo");
    scrollTo({ top: 0, behavior: "instant" });
  }
  function aplicarModo(m) {
    const uno = esUno(m);
    m.classList.toggle("uno", uno);
    if (uno) { const r = EC.ruta(); mostrarUno(m, r.mod === m.id.slice(4) ? r.vista : null); }
    else { m.classList.remove("en-idx"); m.querySelectorAll(".bloque.activo").forEach(b => b.classList.remove("activo")); }
  }
  // Índice: una tarjeta por tipo con su número (o importe) y una línea de estado
  EC.infos = EC.infos || {};
  EC.bloqueInfo = (mod, clave, info) => { EC.infos[mod + "|" + clave] = info || {}; pintarTarjeta(mod, clave); };
  const bloqueNBase = EC.bloqueN;
  EC.bloqueN = (mod, clave, n, urg) => { bloqueNBase(mod, clave, n, urg); pintarTarjeta(mod, clave); };
  function pintarTarjeta(mod, clave) {
    const t = document.querySelector(`#mod-${mod} .sub-idx [data-ir="${CSS.escape(clave)}"]`); if (!t) return;
    const [n, urg] = (EC.cuentas || {})[mod + "|" + clave] || [null, false];
    const info = EC.infos[mod + "|" + clave] || {};
    const valor = info.valor != null ? info.valor : n != null && n !== "" ? n : null;
    t.classList.toggle("urg", !!urg);
    t.querySelector(".ti-v").textContent = valor == null ? "" : valor;
    t.querySelector(".ti-v").classList.toggle("vacio", valor === 0 || valor === "0");
    t.classList.toggle("sin-v", valor == null);
    t.querySelector(".ti-s").textContent = info.texto || "";
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
    const uno = m.hasAttribute("data-uno");
    if (uno) {
      // Índice de tarjetas y barra para volver (solo se ven en el modo un tipo a la vez)
      const cont = m.querySelector(".bloques");
      const nombre = (m.querySelector(":scope > .titlebar h2") || {}).textContent.replace(/\.$/, "");
      const idx = document.createElement("nav"); idx.className = "sub-idx"; idx.setAttribute("aria-label", "Tipos de " + nombre);
      idx.innerHTML = tipos.map(t => `<button type="button" class="ti" data-ir="${t.clave}"><span class="ti-i"><svg aria-hidden="true"><use href="${t.ico || "#i-inbox"}"/></svg></span><svg class="ti-c" aria-hidden="true"><use href="#i-chev"/></svg><b class="ti-v"></b><span class="ti-t">${EC.esc(t.txt)}</span><span class="ti-s"></span></button>`).join("");
      const volver = document.createElement("button"); volver.type = "button"; volver.className = "sub-volver";
      volver.innerHTML = `<svg aria-hidden="true"><use href="#i-chev"/></svg>${EC.esc(nombre)}`;
      cont.prepend(idx, volver);
      idx.addEventListener("click", e => {
        const b = e.target.closest("[data-ir]"); if (!b) return;
        history.pushState({ mod, vista: b.dataset.ir }, "", EC.hashDe(mod, b.dataset.ir));
        mostrarUno(m, b.dataset.ir);
        const h = m.querySelector(".bloque.activo .bq-h"); if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }); }
      });
      volver.addEventListener("click", () => {
        if ((history.state || {}).vista) history.back();
        else { history.replaceState({ mod, vista: null }, "", EC.hashDe(mod, null) || location.pathname); mostrarUno(m, null); }
      });
      for (const t of tipos) pintarTarjeta(mod, t.clave);
      mqUno.addEventListener("change", () => aplicarModo(m));
      aplicarModo(m);
    }
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
      if (m.classList.contains("uno") && clave) history.pushState({ mod, vista: clave }, "", EC.hashDe(mod, clave));
      else history.replaceState({ ...(history.state || {}), mod, vista: clave }, "", EC.hashDe(mod, clave) || location.pathname);
      irBloque(mod, clave, { suave: true });
    });
    // Marca en el submenú el bloque que se está viendo
    if ("IntersectionObserver" in window) {
      const vistos = new Map();
      const io = new IntersectionObserver(es => {
        es.forEach(x => vistos.set(x.target, x.isIntersecting));
        const b = bloques.find(x => vistos.get(x));
        if (b && !m.hidden && !m.classList.contains("uno")) marcar(m, scrollY < 40 ? "todo" : b.dataset.bloque);
      }, { rootMargin: "-25% 0px -65% 0px" });
      bloques.forEach(b => io.observe(b));
    }
  });
  // ---- Menos texto fijo en celular y tablet (secciones data-uno) ----
  // Notas largas: una línea con «ⓘ»; al tocarla se despliega. Formularios para agregar (celular): botón
  // «+ Nueva …» que los abre en una hoja desde abajo.
  const ETQ_FORM = { compra: "Nueva compra", tarea: "Nueva tarea", incidencia: "Reportar incidencia", aviso: "Nuevo aviso" };
  function ajustar(m) {
    m.querySelectorAll(".bq-c p.note:not([data-nl])").forEach(p => {
      p.dataset.nl = "1";
      if (p.textContent.trim().length < 110 || p.closest("form, .aitem, .compra-conf")) return;
      p.classList.add("nota-larga"); p.tabIndex = 0; p.setAttribute("role", "button"); p.setAttribute("aria-expanded", "false");
    });
    m.querySelectorAll(".bq-c > section.card:first-child").forEach(card => {
      const f = card.querySelector(":scope > form.aform[data-tipo]:not(.editar)");
      if (!f || !ETQ_FORM[f.dataset.tipo] || card.classList.contains("hoja-form")) return;
      card.classList.add("hoja-form");
      card.insertAdjacentHTML("afterbegin", `<div class="hoja-h"><b>${ETQ_FORM[f.dataset.tipo]}</b><button type="button" class="hoja-x" aria-label="Cerrar">×</button></div>`);
      card.insertAdjacentHTML("beforebegin", `<button type="button" class="btn btn-primary agregar-btn" aria-haspopup="dialog">+ ${ETQ_FORM[f.dataset.tipo]}</button>`);
    });
    if (!m.querySelector(".hoja-form.abierta")) m.classList.remove("hoja-on");
  }
  function cerrarHoja(m) { m.querySelectorAll(".hoja-form.abierta").forEach(c => c.classList.remove("abierta")); m.classList.remove("hoja-on"); }
  document.querySelectorAll("main.mod[data-uno]").forEach(m => {
    const cont = m.querySelector(".bloques"); if (!cont) return;
    let t; new MutationObserver(() => { clearTimeout(t); t = setTimeout(() => ajustar(m), 30); }).observe(cont, { childList: true, subtree: true });
    ajustar(m);
    const fondo = document.createElement("div"); fondo.className = "hoja-fondo"; m.appendChild(fondo);
    fondo.addEventListener("click", () => cerrarHoja(m));
    addEventListener("keydown", e => { if (e.key === "Escape" && m.classList.contains("hoja-on")) cerrarHoja(m); });
    cont.addEventListener("click", e => {
      const nl = e.target.closest("p.nota-larga");
      if (nl && !e.target.closest("a, button")) { const a = !nl.classList.contains("abierta"); nl.classList.toggle("abierta", a); nl.setAttribute("aria-expanded", String(a)); return; }
      const ag = e.target.closest(".agregar-btn");
      if (ag) { const card = ag.nextElementSibling; if (!card) return; card.classList.add("abierta"); m.classList.add("hoja-on"); const i = card.querySelector("input:not([type=hidden]), textarea, select"); i && i.focus(); return; }
      if (e.target.closest(".hoja-x")) cerrarHoja(m);
    });
    cont.addEventListener("keydown", e => { const nl = e.target.closest && e.target.closest("p.nota-larga"); if (nl && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); nl.click(); } });
  });
  EC.irBloque = irBloque;
  // Abierto con un enlace a un bloque (#agenda/tarea, #dinero/compras…) al cargar la página
  const r = EC.ruta();
  if (r.vista && r.mod !== "config") irBloque(r.mod, r.vista);
})();
