// Compras de Agenda: estado único inyectado; no almacén paralelo.
window.CastaComprasControlador = function crearCompras(contexto) {
  const { st, abierto, esc, ico, formEditar, avP, selLugar, MXN, post, toast, cargar, pintar, formulario, $ } = contexto;
  // ---- Compras agrupadas por el lugar donde se compran ----
  // ---- Lista de compras (al estilo de las mejores apps de compras, adaptada a la pensión) ----
  // Barra rápida con sugerencias de lo ya comprado, "Lo que compras seguido", precio de la última vez,
  // modo "En la tienda" (carrito) y un solo ticket al terminar → un egreso en Dinero.
  const normC = t => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
  const capC = t => t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
  const UNIDADES = "cajas?|paquetes?|paq|pzas?|piezas?|kg|kilos?|gr|g|litros?|lts?|l|ml|rollos?|bolsas?|botes?|cubetas?|galon(?:es)?|garrafon(?:es)?|metros?|mts?|m|docenas?|pares?|juegos?|sobres?|frascos?|latas?|tambos?|bultos?|costales?|tanques?|cartuchos?|resmas?|cientos?|millares?";
  function partirCompra(t) {
    t = String(t || "").trim().replace(/\s+/g, " ");
    let m = t.match(new RegExp(`^(\\d+(?:[.,]\\d+)?(?:\\s*(?:${UNIDADES})\\b)?)\\s+(?:de\\s+)?(.+)$`, "i"));
    if (m) return { cantidad: m[1], titulo: capC(m[2]) };
    m = t.match(/^(.+?)\s*[x×]\s*(\d+)$/i);
    if (m) return { titulo: capC(m[1]), cantidad: m[2] };
    return { titulo: capC(t), cantidad: "" };
  }
  const memDe = t => (st.memoria || []).find(m => m.norm === normC(t));
  const nomLugar = id => id === "sin" ? "Sin lugar" : ((st.lugares || []).find(l => l.id === id) || {}).nombre || "Sin lugar";
  const pendientesC = () => st.items.filter(x => x.tipo === "compra" && abierto(x));
  const fCorta = d => d ? fDia.format(new Date(d.slice(0, 10) + "T12:00:00Z")) : "";
  const precioRef = it => { const m = memDe(it.titulo); return m && m.precio ? m.precio : null; };

  function sugerencias(q) {
    const n = normC(q.replace(/^\d+(?:[.,]\d+)?\s*\S*\s+(?:de\s+)?/, "")) || normC(q);
    if (n.length < 2) return [];
    const ya = new Set(pendientesC().map(x => normC(x.titulo)));
    return (st.memoria || []).filter(m => m.norm.includes(n) && !ya.has(m.norm)).slice(0, 6);
  }
  function filaCompra(it) {
    if (st.editando === it.id) return `<div class="aitem">${formEditar(it)}</div>`;
    const p = precioRef(it), carrito = !!it.en_carrito;
    return `<div class="cl-it ${it.pospuesta ? "otra" : ""} ${carrito ? "carro" : ""}" data-cid="${esc(it.id)}">
      <button class="chk" type="button" data-chk="${esc(it.id)}" data-fin="comprado" data-ini="pendiente" aria-label="Marcar comprada: ${esc(it.titulo)}">${ico("i-check")}</button>
      <div class="cl-tx"><span class="cl-t">${it.cantidad ? `<b class="cl-q">${esc(it.cantidad)}</b> ` : ""}${esc(it.titulo)}</span>
        <span class="cl-m">${it.prioridad === "alta" ? `<span class="tag alta">Urgente</span>` : ""}${carrito ? `<span class="tag ok">En el carrito</span>` : ""}${it.reporto ? `<span class="tag tablet">${avP(it.reporto)}Pidió ${esc(it.reporto)}</span>` : ""}${window.catChip(it.categoria)}${p ? `<span class="cl-p" title="Precio de la última vez">Última vez ${MXN(p.importe)}${p.cantidad ? ` por ${esc(p.cantidad)}` : ""} · ${esc(fCorta(p.fecha))}</span>` : ""}${it.detalle ? `<span>${esc(it.detalle)}</span>` : ""}</span></div>
      <div class="cl-ac"><button class="btn btn-line btn-otra" type="button" data-posponer="${esc(it.id)}" data-v="${it.pospuesta ? 0 : 1}">${it.pospuesta ? "Regresar" : "Otra ocasión"}</button>${selLugar(it.lugar || "", ` class="lugar-sel" data-lugar="${esc(it.id)}" aria-label="Dónde se compra ${esc(it.titulo)}"`)}<button class="btn btn-line edit" type="button" data-editar="${esc(it.id)}" aria-label="Editar ${esc(it.titulo)}">Editar</button><button class="del" type="button" data-del="${esc(it.id)}" aria-label="Eliminar ${esc(it.titulo)}">${ico("i-trash")}</button></div></div>`;
  }
  function estimado(l) {
    let t = 0, n = 0; for (const it of l) { const p = precioRef(it); if (p) { t += p.importe; n++; } }
    return n ? `≈ ${MXN(t)}${n < l.length ? ` en ${n} de ${l.length}` : ""}` : "";
  }
  function grupoCompras(id, l) {
    const por = l.filter(x => !x.pospuesta), otra = l.filter(x => x.pospuesta), est = estimado(por);
    return `<div class="cl-g ${id === "sin" ? "sin" : ""}"><div class="cl-gh"><h3>${ico("i-carrito")}<span>${esc(id === "sin" ? "Sin lugar · elige dónde se compra" : nomLugar(id))}</span><span class="n">${por.length}</span>${por.some(x => x.prioridad === "alta") ? `<span class="tag alta">Urgente</span>` : ""}</h3>
        ${est ? `<span class="cl-est" title="Con los precios de la última vez">${esc(est)}</span>` : ""}
        <div class="cl-gb">${por.length ? `<button class="btn btn-primary btn-sm" type="button" data-cl-tienda="${esc(id)}">${ico("i-carrito")}En la tienda</button><button class="btn btn-line btn-sm" type="button" data-cl-compartir="${esc(id)}">Compartir</button>` : ""}</div></div>
      ${por.length ? `<div class="cl-l">${por.map(filaCompra).join("")}</div>` : `<p class="note lg-listo">${otra.length ? "Ya no queda nada por comprar aquí en esta visita." : "No hay nada pendiente por comprar aquí."}</p>`}
      ${otra.length ? `<details class="cl-otra"><summary>Para otra ocasión (${otra.length})</summary><div class="cl-l">${otra.map(filaCompra).join("")}</div></details>` : ""}</div>`;
  }
  function ticketsHechos(ce) {
    const m = new Map();
    for (const it of ce) { const k = it.gasto_id || "i:" + it.id; if (!m.has(k)) m.set(k, []); m.get(k).push(it); }
    const l = [...m.entries()].map(([k, its]) => ({ k, its, f: its[0].dia_gasto || (its[0].cerrado || "").slice(0, 10), total: its[0].monto_gasto != null ? its[0].monto_gasto : its.reduce((a, x) => a + (Number(x.importe) || 0), 0) }))
      .sort((a, b) => String(b.its[0].cerrado || "").localeCompare(String(a.its[0].cerrado || "")));
    return l.map(t => { const lug = [...new Set(t.its.map(x => x.lugar).filter(Boolean))]; const it0 = t.its[0];
      return `<div class="cl-tk"><div class="cl-tkh"><b>${esc(lug.length === 1 ? nomLugar(lug[0]) : "Compra")}</b><span>${esc(fCorta(t.f))}</span><span class="cl-tkm">${t.total ? MXN(t.total) : ""}</span>${it0.forma_gasto ? `<span>${esc(window.medioTxt(it0.forma_gasto, it0.cuenta_gasto))}</span>` : ""}
        ${it0.gasto_id ? `<button class="lnk-corte" type="button" data-cl-regresar="${esc(it0.gasto_id)}">Regresar a pendiente</button>` : ""}</div>
        <ul>${t.its.map(x => `<li>${x.cantidad ? `<b>${esc(x.cantidad)}</b> ` : ""}${esc(x.titulo)}${t.its.length > 1 && x.importe != null ? ` <span class="muted">${MXN(x.importe)}</span>` : ""}${x.reporto ? ` <span class="muted">· pidió ${esc(x.reporto)}</span>` : ""}</li>`).join("")}</ul></div>`; }).join("");
  }
  // Modo "En la tienda": se palomea lo que va al carrito y al final se captura un solo ticket
  function vistaTienda() {
    const id = st.tienda, l = pendientesC().filter(x => !x.pospuesta && (id === "todos" || (id === "sin" ? !x.lugar || !(st.lugares || []).some(z => z.id === x.lugar) : x.lugar === id)));
    const falta = l.filter(x => !x.en_carrito), carro = l.filter(x => x.en_carrito);
    const fila = it => `<button type="button" class="cl-ti ${it.en_carrito ? "on" : ""}" data-cl-carro="${esc(it.id)}" aria-pressed="${!!it.en_carrito}"><span class="chk ${it.en_carrito ? "on" : ""}">${ico("i-check")}</span><span class="cl-tx"><span class="cl-t">${it.cantidad ? `<b class="cl-q">${esc(it.cantidad)}</b> ` : ""}${esc(it.titulo)}</span>${(() => { const p = precioRef(it); return `<span class="cl-m">${it.prioridad === "alta" ? `<span class="tag alta">Urgente</span>` : ""}${p ? `<span class="cl-p">Última vez ${MXN(p.importe)}</span>` : ""}</span>`; })()}</span></button>`;
    return `<div class="cl-modo"><div class="cl-mh"><button class="btn btn-line btn-sm" type="button" data-cl-salir>‹ Lista</button><div><h3>En ${esc(id === "todos" ? "la tienda" : nomLugar(id))}</h3><p class="note">${carro.length} de ${l.length} en el carrito · toca cada artículo al echarlo al carrito</p></div></div>
      <div class="cl-prog" role="progressbar" aria-valuemin="0" aria-valuemax="${l.length}" aria-valuenow="${carro.length}" aria-label="Avance de la compra"><i style="width:${l.length ? Math.round(carro.length / l.length * 100) : 0}%"></i></div>
      ${falta.length ? `<div class="cl-tl">${falta.map(fila).join("")}</div>` : `<p class="note cl-listo">${l.length ? "¡Todo en el carrito! Termina la compra para registrar el ticket." : "No hay nada pendiente aquí."}</p>`}
      ${carro.length ? `<h4 class="cl-ch">En el carrito (${carro.length})</h4><div class="cl-tl carro">${carro.map(fila).join("")}</div>` : ""}
      <div class="cl-barra"><span>${carro.length ? `${carro.length} ${carro.length === 1 ? "artículo" : "artículos"}${estimado(carro) ? " · " + esc(estimado(carro)) : ""}` : "Nada en el carrito todavía"}</span><button class="btn btn-primary" type="button" data-cl-terminar ${carro.length ? "" : "disabled"}>Terminar compra</button></div></div>`;
  }
  function vistaCompras() {
    if (st.tienda) return vistaTienda();
    const todos = st.items.filter(x => x.tipo === "compra");
    const ab = todos.filter(abierto).sort((a, b) => (b.prioridad === "alta") - (a.prioridad === "alta") || (a.creado || "").localeCompare(b.creado || ""));
    const ce = todos.filter(x => !abierto(x));
    const lugares = st.lugares || [], ids = new Set(lugares.map(l => l.id));
    const sin = ab.filter(x => !x.lugar || !ids.has(x.lugar));
    const deLugar = id => id === "sin" ? sin : ab.filter(i => i.lugar === id);
    let fl = st.lugarFiltro;
    if (fl == null) { try { fl = localStorage.getItem("ec-compras-lugar") || ""; } catch { fl = ""; } }
    if (fl && fl !== "sin" && !ids.has(fl)) fl = "";
    if (fl === "sin" && !sin.length) fl = "";
    st.lugarFiltro = fl;
    const cuenta = l => { const p = l.filter(x => !x.pospuesta).length, o = l.length - p; return `${p}${o ? ` + ${o} otra ocasión` : ""}`; };
    const filtro = ab.length ? `<label class="lg-filtro"><span>Para comprar en</span><select id="lg-filtro" aria-label="Para comprar en">
        <option value="">Todos los lugares (${cuenta(ab)})</option>
        ${sin.length ? `<option value="sin" ${fl === "sin" ? "selected" : ""}>Sin lugar (${cuenta(sin)})</option>` : ""}
        ${lugares.map(l => `<option value="${esc(l.id)}" ${fl === l.id ? "selected" : ""}>${esc(l.nombre)} (${cuenta(deLugar(l.id))})</option>`).join("")}
      </select></label>` : "";
    const grupos = fl ? grupoCompras(fl, deLugar(fl)) : (sin.length ? grupoCompras("sin", sin) : "") + lugares.map(l => deLugar(l.id).length ? grupoCompras(l.id, deLugar(l.id)) : "").join("");
    const enLista = new Set(ab.map(x => normC(x.titulo)));
    const frec = (st.memoria || []).filter(m => m.veces >= 2 && !enLista.has(m.norm)).slice(0, 10);
    return `<section class="card cl-top"><form class="cl-add" id="cl-add" autocomplete="off" novalidate>
        <div class="cl-in"><label class="sr" for="cl-q">Agregar a la lista</label><input id="cl-q" name="q" maxlength="160" placeholder="Agregar… ej. 2 cajas de papel térmico" role="combobox" aria-expanded="false" aria-controls="cl-sug" aria-autocomplete="list" enterkeyhint="done">
          <ul class="cl-sug" id="cl-sug" role="listbox" hidden></ul></div>
        <label class="cl-urg"><input type="checkbox" name="urgente">Urgente</label>
        <button class="btn btn-primary" type="submit">Agregar</button>
        <p class="cl-hint" id="cl-hint" aria-live="polite"></p></form>
      ${frec.length ? `<div class="cl-frec"><span>Lo que compras seguido</span>${frec.map(m => `<button type="button" class="cl-chip" data-cl-frec="${esc(m.norm)}" title="${esc(m.ultimo && m.ultimo.lugar ? "Última vez en " + nomLugar(m.ultimo.lugar) : "")}">+ ${esc(m.titulo)}</button>`).join("")}</div>` : ""}
      <details class="cl-mas"><summary>Más opciones (categoría, lugar, cantidad)</summary>${formulario("compra")}</details></section>
      <section class="card">${filtro}${ab.length ? grupos : `<p class="note">No hay compras pendientes. Agrega arriba lo que haga falta.</p>`}
      ${ce.length ? `<details class="hechos"><summary>Compradas en los últimos 30 días (${ce.length})</summary><div class="cl-tks">${ticketsHechos(ce)}</div></details>` : ""}</section>`;
  }

  async function agregarCompra(texto, urgente, extra = {}) {
    const { titulo, cantidad } = partirCompra(texto);
    if (titulo.length < 2) throw new Error("Escribe qué hay que comprar.");
    const dup = pendientesC().find(x => normC(x.titulo) === normC(titulo));
    if (dup) { toast(`Ya está en la lista${dup.lugar ? " (" + nomLugar(dup.lugar) + ")" : ""}`); return false; }
    const m = memDe(titulo);
    const lugar = extra.lugar !== undefined ? extra.lugar : (st.lugarFiltro && st.lugarFiltro !== "sin" ? st.lugarFiltro : (m && (m.ultimo.lugar || m.lugar)) || "");
    await post("agenda", { tipo: "compra", titulo, cantidad: cantidad || extra.cantidad || "", prioridad: urgente ? "alta" : "normal", lugar, categoria: (m && m.categoria) || "" });
    toast(`Agregado: ${titulo}${lugar ? " · " + nomLugar(lugar) : ""}`);
    return true;
  }
  function compartirLista(id) {
    const l = pendientesC().filter(x => !x.pospuesta && (id === "sin" ? !x.lugar : x.lugar === id));
    const txt = `Compras en ${nomLugar(id)}:\n` + l.map(x => `• ${x.cantidad ? x.cantidad + " " : ""}${x.titulo}${x.prioridad === "alta" ? " (urgente)" : ""}`).join("\n");
    if (navigator.share) navigator.share({ title: `Compras en ${nomLugar(id)}`, text: txt }).catch(() => {});
    else window.open("https://wa.me/?text=" + encodeURIComponent(txt), "_blank", "noopener");
  }
  function ventanaTerminar() {
    const id = st.tienda, carro = pendientesC().filter(x => x.en_carrito && !x.pospuesta && (id === "todos" || (id === "sin" ? !x.lugar : x.lugar === id)));
    if (!carro.length) return;
    const hoyD = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(new Date());
    const d = document.createElement("dialog"); d.className = "vent cl-fin";
    d.innerHTML = `<form method="dialog" novalidate><h2>Terminar compra${id !== "todos" ? " en " + esc(nomLugar(id)) : ""}</h2>
      <p class="note">${carro.length} ${carro.length === 1 ? "artículo" : "artículos"}. Se registra un solo egreso en Dinero con el total del ticket; no toca la caja de ningún turno.</p>
      <div class="aform"><label class="w2">Total del ticket<input name="total" inputmode="decimal" placeholder="$0.00" autocomplete="off"></label>
        <label class="w2">Pagada con<select name="forma">${window.opcionesMedio("EFECTIVO")}</select></label>
        <label class="w2">Día de la compra<input type="date" name="fecha_compra" value="${hoyD}" max="${hoyD}"></label>
        <label class="chkl w2"><input type="checkbox" name="detallar">Poner el precio de cada artículo</label></div>
      <div class="cl-precios" hidden>${carro.map(x => `<label><span>${x.cantidad ? `<b>${esc(x.cantidad)}</b> ` : ""}${esc(x.titulo)}</span><input data-precio="${esc(x.id)}" inputmode="decimal" placeholder="${(() => { const p = precioRef(x); return p ? MXN(p.importe) : "$0.00"; })()}" autocomplete="off" aria-label="Precio de ${esc(x.titulo)}"></label>`).join("")}<p class="note" id="cl-suma"></p></div>
      <p class="err" role="alert"></p>
      <div class="vent-acc"><button class="btn btn-line" type="button" data-cerrar>Cancelar</button><button class="btn btn-primary" type="submit">Registrar compra</button></div></form>`;
    document.body.appendChild(d); d.showModal();
    const f = d.querySelector("form"), pr = d.querySelector(".cl-precios"), err = d.querySelector(".err");
    const sumar = () => { let t = 0, n = 0; pr.querySelectorAll("[data-precio]").forEach(i => { const v = parseFloat(i.value.replace(/[$,\s]/g, "")); if (v >= 0) { t += v; n++; } }); d.querySelector("#cl-suma").textContent = n ? `Suma: ${MXN(t)}${n < carro.length ? ` (${n} de ${carro.length})` : ""}` : ""; };
    f.detallar.addEventListener("change", () => { pr.hidden = !f.detallar.checked; });
    pr.addEventListener("input", sumar);
    d.querySelector("[data-cerrar]").addEventListener("click", () => d.close());
    d.addEventListener("close", () => d.remove());
    setTimeout(() => f.total.focus(), 30);
    f.addEventListener("submit", async ev => {
      ev.preventDefault(); err.textContent = "";
      const precios = {}; if (f.detallar.checked) pr.querySelectorAll("[data-precio]").forEach(i => { if (i.value.trim()) precios[i.dataset.precio] = i.value; });
      const b = f.querySelector("[type=submit]"); b.disabled = true; b.textContent = "Registrando…";
      const uidCompra = f.dataset.uid || (f.dataset.uid = crypto.randomUUID());
      try {
        const r = await post("agenda/compras/terminar", { ids: carro.map(x => x.id), total: f.total.value, precios, forma: f.forma.value, fecha_compra: f.fecha_compra.value, uid: uidCompra });
        d.close(); st.tienda = null; toast(`Compra registrada: ${MXN(r.total)} en Dinero`); await cargar();
      } catch (e) { if (e.message !== "sesion") err.textContent = e.message; b.disabled = false; b.textContent = "Registrar compra"; }
    });
  }
  // Eventos de la lista (una vez sobre el bloque; el contenido se vuelve a pintar)
  function conectarCompras() {
    const el = $("#pg-comp"); if (!el || el._cl) return; el._cl = true;
    let sel = -1;
    const pintarSug = () => {
      const inp = el.querySelector("#cl-q"), ul = el.querySelector("#cl-sug"), hint = el.querySelector("#cl-hint"); if (!inp) return;
      const l = sugerencias(inp.value); sel = Math.min(sel, l.length - 1);
      ul.innerHTML = l.map((m, i) => `<li role="option" id="cl-s${i}" data-cl-sug="${esc(m.norm)}" aria-selected="${i === sel}"><b>${esc(m.titulo)}</b><span>${m.ultimo && m.ultimo.lugar ? esc(nomLugar(m.ultimo.lugar)) : ""}${m.precio ? " · " + MXN(m.precio.importe) : ""} · ${m.veces} ${m.veces === 1 ? "vez" : "veces"}</span></li>`).join("");
      ul.hidden = !l.length; inp.setAttribute("aria-expanded", String(!!l.length));
      if (sel >= 0) inp.setAttribute("aria-activedescendant", "cl-s" + sel); else inp.removeAttribute("aria-activedescendant");
      const p = partirCompra(inp.value), m = memDe(p.titulo), dup = p.titulo && pendientesC().find(x => normC(x.titulo) === normC(p.titulo));
      const lug = st.lugarFiltro && st.lugarFiltro !== "sin" ? st.lugarFiltro : m && (m.ultimo.lugar || m.lugar);
      hint.textContent = !inp.value.trim() ? "" : dup ? `Ya está en la lista${dup.lugar ? " · " + nomLugar(dup.lugar) : ""}` : `${p.cantidad ? `Cantidad: ${p.cantidad} · ` : ""}${lug ? "Va a " + nomLugar(lug) : "Se acomoda en el lugar donde se compró antes (o queda sin lugar)"}${m && m.precio ? ` · última vez ${MXN(m.precio.importe)}` : ""}`;
    };
    const elegir = norm => { const m = (st.memoria || []).find(x => x.norm === norm), inp = el.querySelector("#cl-q"); if (!m || !inp) return; const p = partirCompra(inp.value); inp.value = (p.cantidad ? p.cantidad + " " : "") + m.titulo; sel = -1; pintarSug(); el.querySelector("#cl-sug").hidden = true; inp.focus(); };
    el.addEventListener("input", e => { if (e.target.id === "cl-q") { sel = -1; pintarSug(); } });
    el.addEventListener("keydown", e => {
      if (e.target.id !== "cl-q") return;
      const ul = el.querySelector("#cl-sug"), n = ul.children.length;
      if (e.key === "ArrowDown" && n) { e.preventDefault(); sel = (sel + 1) % n; pintarSug(); }
      else if (e.key === "ArrowUp" && n) { e.preventDefault(); sel = (sel - 1 + n) % n; pintarSug(); }
      else if (e.key === "Enter" && sel >= 0 && !ul.hidden) { e.preventDefault(); elegir(ul.children[sel].dataset.clSug); }
      else if (e.key === "Escape") { ul.hidden = true; sel = -1; }
    });
    el.addEventListener("focusout", e => { if (e.target.id === "cl-q") setTimeout(() => { const ul = el.querySelector("#cl-sug"); if (ul && !el.contains(document.activeElement)) ul.hidden = true; }, 150); });
    el.addEventListener("mousedown", e => { const li = e.target.closest("[data-cl-sug]"); if (li) { e.preventDefault(); elegir(li.dataset.clSug); } });
    el.addEventListener("submit", async e => {
      if (e.target.id !== "cl-add") return;
      e.preventDefault();
      const f = e.target, b = f.querySelector("[type=submit]");
      if (!f.q.value.trim()) { f.q.focus(); return; }
      b.disabled = true;
      try { if (await agregarCompra(f.q.value, f.urgente.checked)) { await cargar(); const n = $("#cl-q"); n && n.focus(); } }
      catch (er) { if (er.message !== "sesion") toast(er.message); }
      b.disabled = false;
    });
    el.addEventListener("click", async e => {
      const t = e.target.closest("button"); if (!t || !el.contains(t)) return;
      const d = t.dataset;
      if (d.clFrec) { const m = (st.memoria || []).find(x => x.norm === d.clFrec); if (!m) return; t.disabled = true; try { await agregarCompra(m.titulo, false, { cantidad: m.ultimo && m.ultimo.cantidad || "" }); await cargar(); } catch (er) { if (er.message !== "sesion") toast(er.message); t.disabled = false; } }
      else if (d.clTienda) { st.tienda = d.clTienda; pintar(); el.scrollIntoView({ block: "start" }); }
      else if ("clSalir" in d) { st.tienda = null; pintar(); }
      else if (d.clCompartir) compartirLista(d.clCompartir);
      else if (d.clCarro) {
        const it = st.items.find(x => x.id === d.clCarro); if (!it) return;
        const v = !it.en_carrito; it.en_carrito = v ? 1 : null; pintar();
        try { await post("agenda/compras/carrito", { ids: [it.id], v }); } catch (er) { it.en_carrito = v ? null : 1; pintar(); if (er.message !== "sesion") toast(er.message); }
      }
      else if ("clTerminar" in d) ventanaTerminar();
      else if (d.clRegresar) {
        if (!(await EC.confirmar("¿Regresar el ticket a pendiente?", "Todos sus artículos vuelven a la lista y se quita el egreso de Dinero.", "Regresar", true))) return;
        try { const r = await post("agenda/compras/regresar-ticket", { gasto_id: d.clRegresar }); toast(r.n === 1 ? "Regresó a la lista" : `${r.n} artículos regresaron a la lista`); await cargar(); } catch (er) { if (er.message !== "sesion") toast(er.message); }
      }
    });
  }

  return { vistaCompras, conectarCompras, agregarCompra };
};
