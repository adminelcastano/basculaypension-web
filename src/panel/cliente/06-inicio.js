// ---- Hoy: resumen visual de todas las secciones (una sola llamada: /panel/api/hoy) ----
(() => {
  const $ = q => document.querySelector(q);
  const esc = EC.esc;
  // Colores validados (daltonismo y contraste sobre fondo oscuro). Cada entidad conserva su color en todas las gráficas.
  const COL = { bas: "#c08a00", pen: "#3d8fd6", tra: "#d0559a", efe: "#1aa3a3", tar: "#6c74e8" };
  const ESTADO = { pendiente: ["#fab219", "i-reloj", "Pendientes"], facturada: ["#0ca30c", "i-check", "Facturadas"], enviada: ["#64d2ff", "i-check", "Enviadas"], rechazada: ["#d03b3b", "i-x", "Rechazadas"] };
  const dinero = (v, dec = 0) => (v < 0 ? "−" : "") + "$" + Math.abs(Number(v) || 0).toLocaleString("es-MX", { minimumFractionDigits: dec, maximumFractionDigits: dec });
  const compacto = v => v >= 1000 ? "$" + (v / 1000).toLocaleString("es-MX", { maximumFractionDigits: 1 }) + "k" : "$" + Math.round(v);
  const TURNO_TXT = { "MAÑANA": "Mañana", "TARDE": "Tarde", "NOCHE": "Noche" };
  const reducido = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const api = EC.api;
  const ahoraMx = () => Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date()).map(x => [x.type, x.value]));
  const sumar = (dia, n) => { const d = new Date(dia + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  function turnoActual() {
    const p = ahoraMx(); const h = Number(p.hour) % 24; const hoy = `${p.year}-${p.month}-${p.day}`;
    if (h < 6) return { dia: sumar(hoy, -1), turno: "NOCHE", h, hoy };
    return { dia: hoy, turno: h < 14 ? "MAÑANA" : h < 22 ? "TARDE" : "NOCHE", h, hoy };
  }
  const previos = new Map(), generaciones = new WeakMap();
  function contar(el, valor, formato) {
    if (!el) return;
    const gen = (generaciones.get(el) || 0) + 1; generaciones.set(el, gen);
    const desde = previos.get(el) ?? 0; previos.set(el, valor);
    if (reducido || desde === valor) { el.textContent = formato(valor); return; }
    const t0 = performance.now(), dur = 900;
    const paso = t => {
      if (generaciones.get(el) !== gen) return;
      const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
      el.textContent = formato(desde + (valor - desde) * e);
      if (k < 1) requestAnimationFrame(paso);
    };
    requestAnimationFrame(paso);
  }
  // Cuando una fuente no respondió, no conservar importes/gráficas anteriores como actuales.
  function ocultarNumero(id) {
    const el = $("#" + id); if (!el) return;
    generaciones.set(el, (generaciones.get(el) || 0) + 1);
    previos.delete(el); el.textContent = "—";
  }
  function limpiarFuenteHoy(tipo) {
    const conjuntos = {
      facturas: { numeros: ["i-pend"], textos: ["i-pend-l", "d-fact"], notas: ["i-pend-nota"] },
      personal: { numeros: ["i-exp"], notas: ["i-exp-nota"] },
      caja: { numeros: ["i-hoy", "i-caja", "i-gastos"],
        textos: ["i-split", "i-turnos", "d-formas", "d-serv", "cmp", "g-dias", "ini-gastos-l"],
        notas: ["i-caja-nota", "i-gastos-nota", "i-turno", "prom-txt"] },
      agenda: { numeros: ["n-incid", "n-tareas", "n-avisos", "n-compras"],
        textos: ["m-incid", "m-tareas", "m-avisos", "m-incav", "m-eventos", "m-compras"] },
      pagos: { numeros: ["i-pp", "i-pg", "n-pagos", "n-noprog"],
        textos: ["m-pagos", "m-noprog", "g-pagos", "d-pagos"],
        notas: ["i-pp-nota", "i-pg-nota"] },
      finanzas: { numeros: ["i-f-ing", "i-f-egr", "i-f-res", "i-f-sob"],
        notas: ["i-f-ing-nota", "i-f-egr-nota", "i-f-res-nota", "i-f-sob-nota"] },
      calendario: { textos: ["i-calendario"] }
    };
    const grupo = conjuntos[tipo];
    if (!grupo) return;
    (grupo.numeros || []).forEach(ocultarNumero);
    (grupo.textos || []).forEach(id => { const el = $("#" + id); if (el) el.replaceChildren(); });
    (grupo.notas || []).forEach(id => { const el = $("#" + id); if (el) el.textContent = "No disponible"; });
    if (tipo === "caja") {
      const activo = $("#ini-activo"), gastos = $("#ini-gastos-l");
      if (activo) activo.hidden = true;
      if (gastos) gastos.hidden = true;
      firmaGraf = null;
    }
  }
  const tip = $("#gtip");
  function tooltip(ev, titulo, filas, total) {
    tip.innerHTML = `<b>${esc(titulo)}</b>${filas.map(p => `<div class="r"><span><i class="sw" style="background:${p.c}"></i>${esc(p.nombre)}</span><span>${p.txt ?? dinero(p.v, 2)}</span></div>`).join("")}${total !== undefined ? `<div class="r" style="border-top:1px solid #3a3a3c;padding-top:3px"><span>Total</span><b>${total}</b></div>` : ""}`;
    tip.hidden = false;
    const x = Math.min(innerWidth - tip.offsetWidth - 8, ev.clientX + 12), y = Math.max(8, ev.clientY - tip.offsetHeight - 12);
    tip.style.left = x + "px"; tip.style.top = y + "px";
  }
  const ocultarTip = () => { tip.hidden = true; };

  // ---- Gráfica circular (dona) ----
  // Pagos programados en el Inicio: totales del mes, próximos, pagado por mes y por concepto
  function pintarPagos(j) {
    const D = v => dinero(v, 2);
    contar($("#i-pp"), j.por_pagar_mes, v => dinero(v));
    $("#i-pp-nota").textContent = j.n_por_pagar_mes ? `${j.n_por_pagar_mes} ${j.n_por_pagar_mes === 1 ? "pago pendiente" : "pagos pendientes"}${j.vencidos ? ` · ${j.vencidos} ${j.vencidos === 1 ? "vencido" : "vencidos"}` : ""}` : "Nada pendiente este mes";
    contar($("#i-pg"), j.pagado_mes, v => dinero(v));
    $("#i-pg-nota").textContent = j.n_pagado_mes ? `${j.n_pagado_mes} ${j.n_pagado_mes === 1 ? "pago registrado" : "pagos registrados"}` : "Sin pagos registrados";
    $("#n-pagos").textContent = j.proximos.length;
    const fc = d => { const t = new Date(d + "T12:00:00Z"); return t.toLocaleDateString("es-MX", { day: "numeric", month: "short", timeZone: "UTC" }); };
    $("#m-pagos").innerHTML = j.proximos.length ? `<div class="mini-q">${j.proximos.map(x => `<div><span class="mini-r"><span class="t">${x.categoria ? window.catIco(x.categoria, 14) + " " : ""}${esc(x.titulo)}</span><b>${x.importe != null ? esc(D(x.importe)) : "—"}</b></span><span class="q" style="${x.fecha < j.hoy ? "color:#ff6961" : x.fecha === j.hoy ? "color:#ffcc00" : ""}">${x.fecha < j.hoy ? "Vencido · " : ""}${x.fecha === j.hoy ? "Hoy" : esc(fc(x.fecha))}</span></div>`).join("")}</div>` : `<p class="note">No hay pagos programados.</p>`;
    $("#n-noprog").textContent = j.n_no_programados || 0;
    $("#m-noprog").innerHTML = (j.no_programados || []).length ? `<div class="mini-q">${j.no_programados.slice(0, 5).map(x => `<div><span class="mini-r"><span class="t">${x.categoria ? window.catIco(x.categoria, 14) + " " : ""}${esc(x.titulo || "Pago")}</span><b>${esc(D(x.importe))}</b></span><span class="q">${esc(fc(x.fecha))}</span></div>`).join("")}</div>${j.no_programados.length > 5 ? `<p class="note" style="margin:6px 0 0">y ${j.no_programados.length - 5} más</p>` : ""}<div class="mini-tot"><span>Total del mes</span><b>${esc(D(j.total_no_programados || 0))}</b></div>` : `<p class="note">Sin pagos no programados este mes.</p>`;
    const max = Math.max(1, ...j.por_mes.map(x => x.total));
    const nm = m => new Date(m + "-15T12:00:00Z").toLocaleDateString("es-MX", { month: "short", timeZone: "UTC" });
    $("#g-pagos").innerHTML = j.por_mes.map(x => `<div class="cmp-fila"><span class="k">${esc(nm(x.mes))}${x.mes === j.mes ? " (este)" : ""}</span><div style="background:#1f1f21;border-radius:0 4px 4px 0"><div class="cmp-bar" style="--c:${x.mes === j.mes ? "#30d158" : "#2f8f50"};width:${Math.max(x.total ? 1.5 : 0, 100 * x.total / max)}%"></div></div><span><b>${D(x.total)}</b></span></div>`).join("");
    const pc = (j.por_categoria || []).slice(0, 7), resto = (j.por_categoria || []).slice(7).reduce((a, x) => a + x.total, 0);
    const partes = [...pc.map(x => ({ nombre: x.nombre, v: x.total, c: x.color, ico: "i-cat-" + x.icono })), ...(resto ? [{ nombre: "Otras", v: resto, c: "#8e8e93", ico: "i-cat-otros" }] : [])];
    if (partes.length) dona($("#d-pagos"), partes, { etiqueta: "pagado", formato: D, iconos: true });
    else $("#d-pagos").innerHTML = `<p class="note">Todavía no hay pagos ni compras este mes.</p>`;
  }
  function dona(cont, partes, { centro, etiqueta, formato = v => dinero(v, 2), iconos = false } = {}) {
    const total = partes.reduce((a, p) => a + p.v, 0);
    const R = 52, C = 2 * Math.PI * R, gap = total > 0 && partes.filter(p => p.v > 0).length > 1 ? 2.5 : 0;
    let off = 0, arcos = "";
    if (total > 0) partes.forEach((p, i) => {
      if (p.v <= 0) return;
      const largo = Math.max(0, C * p.v / total - gap);
      arcos += `<circle class="arco" data-i="${i}" r="${R}" cx="64" cy="64" fill="none" stroke="${p.c}" stroke-width="16" stroke-dasharray="${largo} ${C - largo}" stroke-dashoffset="${-off}" transform="rotate(-90 64 64)"/>`;
      off += C * p.v / total;
    });
    else arcos = `<circle r="${R}" cx="64" cy="64" fill="none" stroke="#2c2c2e" stroke-width="16"/>`;
    cont.innerHTML = `<svg viewBox="0 0 128 128" role="img" aria-label="${esc(etiqueta)}: ${partes.map(p => `${p.nombre} ${formato(p.v)}`).join(", ")}">${arcos}
      <text class="centro-v" x="64" y="66" text-anchor="middle">${esc(centro ?? formato(total))}</text><text class="centro-k" x="64" y="80" text-anchor="middle">${esc(etiqueta)}</text></svg>
      <div class="ley">${partes.map(p => `<div>${iconos && p.ico ? `<span class="st-ico" style="background:${p.c}"><svg><use href="#${p.ico}"/></svg></span>` : `<i class="sw" style="background:${p.c}"></i>`}<span>${esc(p.nombre)}</span><b>${formato(p.v)}${total > 0 ? `<small>${Math.round(100 * p.v / total)}%</small>` : ""}</b></div>`).join("")}</div>`;
    cont.querySelectorAll(".arco").forEach(a => {
      const p = partes[a.dataset.i];
      a.addEventListener("pointermove", ev => tooltip(ev, etiqueta, [{ c: p.c, nombre: p.nombre, txt: `${formato(p.v)} · ${Math.round(100 * p.v / total)}%` }]));
      a.addEventListener("pointerleave", ocultarTip);
      if (!reducido) { const L = a.getAttribute("stroke-dasharray").split(" ")[0]; a.animate([{ strokeDasharray: `0 ${C}` }, { strokeDasharray: `${L} ${C - L}` }], { duration: 800, easing: "cubic-bezier(.16,1,.3,1)" }); }
    });
  }

  // ---- Columnas apiladas con línea de promedio ----
  function columnas(cont, datos, { alto = 210, promedio } = {}) {
    const W = Math.max(280, cont.clientWidth || 320), H = alto, izq = 42, der = 6, arr = 20, abajo = 24;
    const max = Math.max(1, promedio || 0, ...datos.map(d => d.total));
    const paso = max > 20000 ? 10000 : max > 8000 ? 5000 : max > 4000 ? 2000 : max > 2000 ? 1000 : max > 800 ? 500 : 200;
    const tope = Math.ceil(max / paso) * paso;
    const y = v => arr + (H - arr - abajo) * (1 - v / tope);
    const banda = (W - izq - der) / datos.length, ancho = Math.min(28, banda * 0.55);
    let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Ingresos de los últimos 7 días">`;
    for (let v = 0; v <= tope; v += paso) svg += `<line class="eje" x1="${izq}" x2="${W - der}" y1="${y(v)}" y2="${y(v)}"/><text x="${izq - 6}" y="${y(v) + 4}" text-anchor="end">${compacto(v)}</text>`;
    datos.forEach((d, i) => {
      const cx = izq + banda * i + banda / 2, x0 = cx - ancho / 2;
      let base = y(0), segs = "";
      const vivas = d.partes.filter(p => p.v > 0);
      vivas.forEach((p, j) => {
        const alto = (H - arr - abajo) * (p.v / tope), yTop = base - alto, gap = j > 0 ? 2 : 0, hh = Math.max(0, alto - gap);
        segs += j === vivas.length - 1 && hh > 4
          ? `<path d="M${x0},${base - gap} V${yTop + 4} Q${x0},${yTop} ${x0 + 4},${yTop} H${x0 + ancho - 4} Q${x0 + ancho},${yTop} ${x0 + ancho},${yTop + 4} V${base - gap} Z" fill="${p.c}"/>`
          : `<rect x="${x0}" y="${yTop}" width="${ancho}" height="${hh}" fill="${p.c}"/>`;
        base = yTop;
      });
      const val = d.total > 0 && (datos.length <= 12 || d.resaltar) ? `<text class="val" x="${cx}" y="${base - 6}" text-anchor="middle">${compacto(d.total)}</text>` : "";
      svg += `<g class="col" data-i="${i}"><g class="segs" style="transform-origin:${cx}px ${y(0)}px">${segs}</g>${val}<text x="${cx}" y="${H - 6}" text-anchor="middle"${d.resaltar ? ' style="fill:#f5f5f7;font-weight:600"' : ""}>${esc(d.etiqueta)}</text><rect class="hit" x="${izq + banda * i}" y="${arr}" width="${banda}" height="${H - arr}"/></g>`;
    });
    if (promedio > 0) svg += `<line x1="${izq}" x2="${W - der}" y1="${y(promedio)}" y2="${y(promedio)}" stroke="#c7c7cc" stroke-width="1.5" opacity=".8"/>`;
    svg += `<line class="eje" x1="${izq}" x2="${W - der}" y1="${y(0)}" y2="${y(0)}" style="stroke:#48484a"/></svg>`;
    cont.innerHTML = svg;
    cont.querySelectorAll(".col").forEach(g => {
      const d = datos[g.dataset.i];
      const mostrar = ev => tooltip(ev, d.titulo, d.partes.map(p => ({ c: p.c, nombre: p.nombre, v: p.v })), dinero(d.total, 2));
      g.addEventListener("pointermove", mostrar); g.addEventListener("pointerdown", mostrar); g.addEventListener("pointerleave", ocultarTip);
    });
    if (!reducido) cont.querySelectorAll(".segs").forEach((g, i) => g.animate([{ transform: "scaleY(0)" }, { transform: "scaleY(1)" }], { duration: 700, delay: i * 60, easing: "cubic-bezier(.16,1,.3,1)", fill: "backwards" }));
  }

  // ---- Comparativo del turno en curso ----
  function comparativo(cont, ta, porDiaTurno, dias7) {
    const t = ta.turno, val = d => { const c = porDiaTurno[d + "|" + t]; return c ? c.efectivo + c.tarjeta : 0; };
    const hoy = val(ta.dia), ayer = val(sumar(ta.dia, -1));
    const previos = dias7.filter(d => d !== ta.dia).map(val);
    const prom = previos.length ? previos.reduce((a, b) => a + b, 0) / previos.length : 0;
    const max = Math.max(1, hoy, ayer, prom);
    const delta = (a, b, enCurso) => { if (enCurso) return `<span class="delta igual">en curso</span>`; if (!b) return `<span class="delta igual">—</span>`; const p = Math.round(100 * (a - b) / b); return `<span class="delta ${p > 0 ? "sube" : p < 0 ? "baja" : "igual"}">${p > 0 ? "▲" : p < 0 ? "▼" : "="} ${Math.abs(p)}%</span>`; };
    $("#cmp-sub").textContent = `Turno de la ${TURNO_TXT[t].toLowerCase()} en curso contra el mismo turno de ayer y su promedio de 7 días (efectivo + tarjeta). Los porcentajes salen al cerrar el turno.`;
    const fila = (k, v, c, d) => `<div class="cmp-fila"><span class="k">${k}</span><div style="background:#1f1f21;border-radius:0 4px 4px 0"><div class="cmp-bar" style="--c:${c};width:${Math.max(1.5, 100 * v / max)}%"></div></div><span><b>${dinero(v)}</b> ${d || ""}</span></div>`;
    const tTurnos = ["MAÑANA", "TARDE", "NOCHE"].map(x => {
      const h = porDiaTurno[ta.dia + "|" + x], a = porDiaTurno[sumar(ta.dia, -1) + "|" + x];
      const vh = h ? h.efectivo + h.tarjeta : 0, va = a ? a.efectivo + a.tarjeta : 0;
      const orden = ["MAÑANA", "TARDE", "NOCHE"], futuro = orden.indexOf(x) > orden.indexOf(t);
      return `<div class="${x === t ? "act" : ""}"><span>${TURNO_TXT[x]} hoy</span><b>${futuro ? "—" : dinero(vh)}</b><span style="font-weight:500">ayer ${dinero(va)} ${futuro ? "" : delta(vh, va, x === t)}</span></div>`;
    }).join("");
    cont.innerHTML = fila("Hoy", hoy, "#ffcc00", "") + fila("Ayer", ayer, "#8e8e93", "") + fila("Promedio 7 d", prom, "#5e5e63", "") + `<div class="cmp-turnos">${tTurnos}</div>`;
    if (!reducido) cont.querySelectorAll(".cmp-bar").forEach((b, i) => b.animate([{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }], { duration: 700, delay: i * 80, easing: "cubic-bezier(.16,1,.3,1)", fill: "backwards" }));
  }

  const fDia = new Intl.DateTimeFormat("es-MX", { weekday: "short", day: "numeric", timeZone: "UTC" });
  const fCorto = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", timeZone: "UTC" });
  const fLargo = new Intl.DateTimeFormat("es-MX", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
  let firmaGraf = null;

  // Consumo del mes (guardián) y almacén de archivos en Drive
  function pintarConsumo(j) {
    const el = $("#i-consumo-txt");
    try {
      if (!j) throw new Error("sin datos");
      const c = j.consumo, a = j.archivos || {};
      const e = c.estado;
      const top = e && e.filas && e.filas.length ? e.filas.slice().sort((x, y) => y.fraccion - x.fraccion)[0] : null;
      const lineas = [];
      if (c.ahorro) lineas.push(`<b style="color:#ff6961">Modo ahorro activo:</b> formularios públicos, IA y sincronización frecuente pausados hasta el próximo mes para no generar cobros.`);
      if (!c.configurado) lineas.push(`<b style="color:#ff9f0a">Falta el token de analítica</b> (CF_API_TOKEN): sin él no se puede vigilar el consumo.`);
      else if (top) lineas.push(`Lo más alto del mes: <b>${esc(top.nombre)}</b> al <b>${(Math.round(top.fraccion * 1000) / 10).toLocaleString("es-MX")} %</b> de lo incluido en los 5 USD. Aviso al 60 %, modo ahorro al 85 %.`);
      else lineas.push("Todavía no hay lectura del consumo (se revisa cada hora).");
      if (e && e.errores && e.errores.length) lineas.push(`<span style="color:#ff9f0a">No se pudo leer: ${esc(e.errores.join("; ").slice(0, 160))}</span>`);
      if (a.error) lineas.push(`Archivos: ${esc(a.error)}`);
      else lineas.push(`Archivos en Google Drive: <b>${(a.en_drive || 0).toLocaleString("es-MX")}</b>${a.en_kv ? ` · <b>${a.en_kv}</b> esperando para subir${a.script ? "" : " (falta el script de Google)"}` : " · todo subido"}.`);
      el.innerHTML = lineas.map(x => `<p style="margin:0 0 6px">${x}</p>`).join("");
      if (EC.bloqueInfo) EC.bloqueInfo("config", "sistema", { valor: top ? (Math.round(top.fraccion * 100)) + " %" : null, texto: c.ahorro ? "Modo ahorro activo" : top ? "del plan incluido" : "Consumo y archivos" });
    } catch (e) { if (e.message !== "sesion") el.textContent = "No se pudo leer el consumo: " + e.message; }
  }

  window.pintarConsumo = pintarConsumo;
  // Pide atención: una ficha corta por cosa (lo urgente en rojo), y tocarla lleva a donde se resuelve
  function irA(dest) {
    if (!dest || !window.irA) return;
    if (dest.corte && dest.pendiente && window.cajaAbrirPendiente) return window.cajaAbrirPendiente(dest.corte, dest.pendiente);
    if (dest.corte && window.cajaAbrirCorte) return window.cajaAbrirCorte(dest.corte);
    if (dest.mod === "finanzas") return window.irA("finanzas", { historia: "push", vista: dest.vista || "resumen" });
    if (dest.tab && window.agendaAbrir && (dest.mod === "agenda" || dest.mod === "pagos")) return window.agendaAbrir(dest.tab);
    window.irA(dest.mod);
  }
  let verTodas = false;
  function pintarAtencion(l) {
    const cont = $("#i-aten"), lista = $("#i-aten-l");
    cont.hidden = !l.length;
    if (!l.length) return;
    const urgentes = l.filter(x => x.nivel !== "info").length;
    $("#i-aten-n").textContent = urgentes ? `${urgentes} ${urgentes === 1 ? "urgente" : "por atender"}` : "";
    const max = matchMedia("(max-width: 640px)").matches ? 5 : 8, ver = verTodas ? l : l.slice(0, max);
    lista.innerHTML = ver.map((x, i) => `<button type="button" class="ia-chip ${x.nivel}" data-i="${i}" title="${esc(x.detalle || "")}"><i aria-hidden="true"></i><span>${esc(x.titulo)}</span>${x.ir ? '<svg aria-hidden="true"><use href="#i-chev"/></svg>' : ""}<span class="sr">${esc(x.detalle || "")}</span></button>`).join("")
      + (l.length > max ? `<button type="button" class="ia-chip mas" data-mas>${verTodas ? "Ver menos" : `y ${l.length - max} más`}</button>` : "");
    lista.querySelectorAll("[data-i]").forEach(b => b.addEventListener("click", e => { e.stopPropagation(); irA(l[b.dataset.i].ir); }));
    const m = lista.querySelector("[data-mas]"); if (m) m.addEventListener("click", e => { e.stopPropagation(); verTodas = !verTodas; pintarAtencion(l); });
  }

  // ---- Turnos de hoy: los tres últimos hasta el que está en curso (noche, mañana y tarde) ----
  const ANT = { "MAÑANA": [-1, "NOCHE"], TARDE: [0, "MAÑANA"], NOCHE: [0, "TARDE"] };
  const HORARIO = { "MAÑANA": ["6:00", "14:00"], TARDE: ["14:00", "22:00"], NOCHE: ["22:00", "6:00"] };
  const horaMx = iso => iso ? new Date(iso).toLocaleTimeString("es-MX", { hour: "numeric", minute: "2-digit", timeZone: "America/Mexico_City" }).replace(/\s?([ap])\.?\s?m\.?/i, " $1m") : null;
  const hayInicio = (c, act) => !!((c && c.cambio && c.cambio.desde) || (act && act.desde));
  function pintarTurnos(j, porDiaTurno, ta, activo) {
    const el = $("#i-turnos"); if (!el) return;
    const lista = [{ dia: ta.dia, turno: ta.turno }];
    for (let k = 0; k < 2; k++) { const a = lista[0], p = ANT[a.turno]; lista.unshift({ dia: sumar(a.dia, p[0]), turno: p[1] }); }
    el.innerHTML = lista.map(t => {
      const c = porDiaTurno[t.dia + "|" + t.turno], k = c && c.conteo, actual = t.dia === ta.dia && t.turno === ta.turno;
      const act = actual && activo && activo.dia === t.dia && activo.turno === t.turno ? activo : null;
      const persona = (k && !k.admin && k.persona) || (c && c.cambio && c.cambio.persona) || (act && act.persona) || null;
      const ini = horaMx((c && c.cambio && c.cambio.desde) || (act && act.desde)), fin = k && !k.admin ? horaMx(k.creado || k.actualizado) : null;
      const hr = `${ini || HORARIO[t.turno][0]} – ${fin || (actual ? "en curso" : HORARIO[t.turno][1])}`;
      const [cls, txt, tit] = k ? (k.admin ? ["", "Capturado", "Entrega capturada por la administración"] : Math.abs(k.dif_efectivo || 0) < 1 ? ["ok", "✓ Cuadra", `Contó ${dinero(k.efectivo, 2)}`] : k.dif_efectivo < 0 ? ["mal", "✗ Faltan " + dinero(-k.dif_efectivo), `No cuadra: contó ${dinero(k.efectivo, 2)}`] : ["mal", "✗ Sobran " + dinero(k.dif_efectivo), `No cuadra: contó ${dinero(k.efectivo, 2)}`])
        : actual ? ["cur", "En curso", "El turno sigue abierto"] : ["esp", "Sin corte", "Nadie entregó el corte en la tablet"];
      const nom = TURNO_TXT[t.turno] + (t.dia !== ta.dia ? ` ${new Date(t.dia + "T12:00:00Z").toLocaleDateString("es-MX", { day: "numeric", timeZone: "UTC" })}` : "");
      return `<button type="button" class="tcard${actual ? " actual" : ""}" data-k="${esc(t.dia + "|" + t.turno)}" aria-label="Corte ${esc(nom)}${persona ? " de " + esc(persona) : ""}">
        <span class="th">${persona ? avP(persona) : ""}<span>${esc(nom)}</span>${!hayInicio(c, act) && !fin && !actual ? `<span class="hr" title="Horario del turno">horario</span>` : ""}</span>
        <span class="hr">${esc(hr)}</span>
        <span class="tk">En caja</span>
        <span class="tn">${dinero(c ? c.efectivo_caja : 0)}</span>
        <span class="est ${cls}" title="${esc(tit)}">${esc(txt)}</span>
        <span class="tl"><span>En sobre</span><b>${k && k.sobre != null ? dinero(k.sobre) : "—"}</b></span>
      </button>`;
    }).join("");
    el.querySelectorAll(".tcard").forEach(b => b.addEventListener("click", ev => { ev.stopPropagation(); if (window.cajaAbrirCorte) window.cajaAbrirCorte(b.dataset.k); }));
    // En sobres hoy: lo que entregaron en sobre los mismos tres turnos de las tarjetas
    const conSobre = lista.map(t => porDiaTurno[t.dia + "|" + t.turno]).filter(c => c && c.conteo && c.conteo.sobre != null);
    const sobres = conSobre.reduce((a, c) => a + (Number(c.conteo.sobre) || 0), 0);
    contar($("#i-sobres"), sobres, v => dinero(v));
    const n = conSobre.length;
    $("#i-sobres-nota").textContent = n ? `${n} de ${lista.length} turnos entregados` : "Ningún turno ha entregado sobre";
  }

  let cargando = false;
  async function cargar() {
    if (cargando) return; cargando = true;
    try { await cargarTodo(); } finally { cargando = false; }
  }
  async function cargarTodo() {
    const ta = turnoActual(), h = ta.h;
    $("#i-saludo").textContent = h >= 6 && h < 12 ? "Buenos días." : h >= 12 && h < 19 ? "Buenas tardes." : "Buenas noches.";
    const fechaTxt = fLargo.format(new Date(ta.dia + "T12:00:00Z"));
    $("#i-fecha").textContent = fechaTxt.charAt(0).toUpperCase() + fechaTxt.slice(1) + ` · turno de la ${TURNO_TXT[ta.turno].toLowerCase()} en curso`;
    let todo;
    try { todo = await api("hoy"); }
    catch (e) {
      for (const fuente of ["facturas", "personal", "caja", "agenda", "pagos", "finanzas", "calendario"]) limpiarFuenteHoy(fuente);
      pintarAtencion([]);
      $("#i-pie").textContent = e.message === "sesion" ? "Tu sesión expiró. Recarga la página." : "No se pudo cargar: " + e.message;
      return;
    }
    const F = todo.fuentes || {};
    const ok = v => v ? { status: "fulfilled", value: v } : { status: "rejected", reason: new Error("no se pudo leer") };
    const fac = ok(F.facturas), caja = ok(F.caja), per = ok(F.personal), ag = ok(F.agenda);
    pintarAtencion(todo.atencion || []);
    pintarConsumo(F.consumo);
    if (F.pagos) pintarPagos(F.pagos); else limpiarFuenteHoy("pagos");
    if (F.finanzas) pintarFinanzas(F.finanzas); else limpiarFuenteHoy("finanzas");
    if (F.calendario) pintarCalendario(F.calendario); else limpiarFuenteHoy("calendario");
    const turnoMal = todo.turno && todo.turno.cambio_turno && Math.abs(todo.turno.cambio_turno.dif) >= 1 ? todo.turno.cambio_turno : null;

    if (fac.status === "fulfilled") {
      const c = fac.value.conteos, n = c.pendiente || 0;
      contar($("#i-pend"), n, v => String(Math.round(v)));
      const viejo = fac.value.solicitudes[0], horas = viejo ? (Date.now() - new Date(viejo.creado)) / 36e5 : 0;
      $("#i-pend-nota").textContent = !n ? "Todo facturado" : horas < 1 ? "La más antigua llegó hace menos de 1 h" : horas < 24 ? `La más antigua espera ${Math.round(horas)} h` : `La más antigua espera ${Math.floor(horas / 24)} ${Math.floor(horas / 24) === 1 ? "día" : "días"}`;
      const pend = fac.value.solicitudes || [];
      const imp = x => Number(String(x.importe ?? x.tarifa ?? "").replace(/[$,\s]/g, ""));
      $("#i-pend-l").innerHTML = pend.length ? `<div class="mini-q">${pend.slice(0, 5).map(x => `<div><span class="mini-r"><span class="t">${esc(x.nombre || x.cliente || x.rfc || "Sin nombre")}</span><b>${imp(x) > 0 ? esc(dinero(imp(x), 2)) : "—"}</b></span><span class="q">Folio ${esc(x.folio)} · llegó ${esc(fCorto.format(new Date(Date.parse(x.creado) - 216e5)))}</span></div>`).join("")}</div>${pend.length > 5 ? `<p class="note" style="margin:6px 0 0">y ${pend.length - 5} más</p>` : ""}` : "";
      dona($("#d-fact"), ["pendiente", "facturada", "enviada", "rechazada"].map(k => ({ nombre: ESTADO[k][2], v: c[k] || 0, c: ESTADO[k][0], ico: ESTADO[k][1] })), { etiqueta: "solicitudes", formato: v => String(Math.round(v)), iconos: true });
    } else limpiarFuenteHoy("facturas");
    if (per.status === "fulfilled") {
      const c = per.value.conteos;
      contar($("#i-exp"), c.incompletos || 0, v => String(Math.round(v)));
      $("#i-exp-nota").textContent = `(de ${c.todos || 0} activos)`;
    } else limpiarFuenteHoy("personal");
    if (caja.status === "fulfilled") {
      const j = caja.value;
      const porDiaTurno = Object.fromEntries(j.cortes.map(c => [c.dia + "|" + c.turno, c]));
      const delDia = j.cortes.filter(c => c.dia === ta.dia);
      const cobrosHoy = (j.cobros || []).filter(x => x.dia === ta.dia);
      const montoCobros = (l, pred) => l.filter(pred).reduce((a, x) => a + Number(x.monto || 0), 0);
      const tpd = j.transf_por_dia || {}, trHoy = (tpd[ta.dia] || 0) + montoCobros(cobrosHoy, x => x.forma === "TRANSFERENCIA");
      const ef = delDia.reduce((a, c) => a + c.efectivo, 0) + montoCobros(cobrosHoy, x => x.forma === "EFECTIVO"),
        tj = delDia.reduce((a, c) => a + c.tarjeta, 0) + montoCobros(cobrosHoy, x => x.forma === "TARJETA");
      const bas = delDia.reduce((a, c) => a + c.bascula.EFECTIVO + c.bascula.TARJETA, 0) + montoCobros(cobrosHoy, x => x.servicio === "bascula" && x.forma !== "TRANSFERENCIA"),
        pen = delDia.reduce((a, c) => a + c.pension.EFECTIVO + c.pension.TARJETA, 0) + montoCobros(cobrosHoy, x => x.servicio === "pension" && x.forma !== "TRANSFERENCIA");
      const otrosHoy = delDia.reduce((a, c) => a + (c.extra ? c.extra.ingreso : 0), 0);
      contar($("#i-hoy"), ef + tj + trHoy + otrosHoy, v => dinero(v));
      $("#i-split").innerHTML = `<span><i class="sw efe"></i> Efectivo <b>${dinero(ef, 2)}</b></span><span><i class="sw tar"></i> Tarjeta <b>${dinero(tj, 2)}</b></span><span><i class="sw tra"></i> Transferencias <b>${dinero(trHoy, 2)}</b></span>${otrosHoy ? `<span>Otros (rentas) <b>${dinero(otrosHoy, 2)}</b></span>` : ""}`;
      const enCurso = porDiaTurno[ta.dia + "|" + ta.turno];
      contar($("#i-caja"), enCurso ? enCurso.efectivo_caja : 0, v => dinero(v));
      $("#i-caja-nota").textContent = `Turno de la ${TURNO_TXT[ta.turno].toLowerCase()}${enCurso ? ` · ${enCurso.registros} registros` : " · sin registros aún"}`;
      // Turno activo en la tablet (discreto, con su imagen de perfil)
      {
        const a = F.turno, el = $("#ini-activo");
        el.hidden = !a && !turnoMal;
        el.innerHTML = (a ? `${avP(a.persona)}<span><b>${esc(a.nombre)}</b> · ${esc(TURNO_TXT[a.turno].toLowerCase())} desde ${esc(new Date(a.desde).toLocaleTimeString("es-MX", { hour: "numeric", minute: "2-digit", timeZone: "America/Mexico_City" }))}${a.cambio_inicial != null ? ` · cambio inicial ${dinero(a.cambio_inicial, 2)}` : ""}</span>` : "")
          + (turnoMal ? `<span style="color:#ff8a80;flex-basis:100%">El cambio no cuadra: ${esc(turnoMal.de.persona)} dejó ${dinero(turnoMal.dejado, 2)} y ${esc(turnoMal.recibio)} recibió ${dinero(turnoMal.recibido, 2)}</span>` : "");
      }
      pintarTurnos(j, porDiaTurno, ta, F.turno);
      const gHoy = delDia.reduce((a, c) => a + c.gastos_total, 0), nG = delDia.reduce((a, c) => a + c.n_gastos, 0);
      contar($("#i-gastos"), gHoy, v => dinero(v));
      $("#i-gastos-nota").textContent = nG ? `${nG} ${nG === 1 ? "gasto de caja" : "gastos de caja"}` : "Sin gastos de caja";
      // Detalle discreto: quién capturó cada gasto (imagen chiquita) y cuánto
      const gl = (j.gastos_recientes || []).filter(g => g.dia === ta.dia).sort((a, b) => String(b.creado).localeCompare(String(a.creado)));
      const gEl = $("#ini-gastos-l");
      gEl.hidden = !gl.length;
      gEl.innerHTML = gl.slice(0, 4).map(g => `<div>${avP(g.persona || "admin")}<span class="gc">${esc(g.concepto)}</span><b>${dinero(g.monto, 2)}</b></div>`).join("") + (gl.length > 4 ? `<div class="mas">y ${gl.length - 4} más</div>` : "");
      const s = j.sync, hace = s && s.at ? Math.round((Date.now() - new Date(s.at)) / 60000) : null;
      $("#i-turno").textContent = !j.conectado ? "La hoja de ingresos no está conectada" : hace === null ? "" : `Hoja de ingresos leída hace ${hace < 1 ? "un momento" : hace + " min"}`;

      const dias7 = []; for (let k = 6; k >= 0; k--) dias7.push(sumar(ta.dia, -k));
      const diasMes = []; for (let d = ta.dia.slice(0, 8) + "01"; d <= ta.dia; d = sumar(d, 1)) diasMes.push(d);
      const semana = diasMes.map((d, i) => {
        const cs = j.cortes.filter(c => c.dia === d);
        const rec = (j.cobros || []).filter(x => x.dia === d);
        const partes = [
          { c: COL.bas, nombre: "Báscula", v: cs.reduce((a, c) => a + c.bascula.EFECTIVO + c.bascula.TARJETA, 0) + montoCobros(rec, x => x.servicio === "bascula" && x.forma !== "TRANSFERENCIA") },
          { c: COL.pen, nombre: "Pensión", v: cs.reduce((a, c) => a + c.pension.EFECTIVO + c.pension.TARJETA, 0) + montoCobros(rec, x => x.servicio === "pension" && x.forma !== "TRANSFERENCIA") },
          { c: COL.tra, nombre: "Transferencias", v: (tpd[d] || 0) + montoCobros(rec, x => x.forma === "TRANSFERENCIA") }
        ];
        const ult = i === diasMes.length - 1, n = diasMes.length;
        return { etiqueta: ult ? "Hoy" : n <= 10 ? fDia.format(new Date(d + "T12:00:00Z")).replace(".", "") : (i % (n > 20 ? 3 : 2) === 0 ? String(Number(d.slice(8))) : ""), titulo: fLargo.format(new Date(d + "T12:00:00Z")), partes, total: partes.reduce((a, p) => a + p.v, 0), resaltar: ult };
      });
      const cerrados = semana.slice(0, -1), promedio = cerrados.reduce((a, d) => a + d.total, 0) / Math.max(1, cerrados.length);
      const firma = JSON.stringify([ef, tj, trHoy, bas, pen, semana.map(d => d.total), Object.keys(porDiaTurno).length, innerWidth]);
      if (firma !== firmaGraf) {
        firmaGraf = firma;
        dona($("#d-formas"), [{ nombre: "Efectivo", v: ef, c: COL.efe }, { nombre: "Tarjeta", v: tj, c: COL.tar }, { nombre: "Transferencias", v: trHoy, c: COL.tra }], { etiqueta: "hoy", centro: compacto(ef + tj + trHoy) });
        dona($("#d-serv"), [{ nombre: "Báscula", v: bas, c: COL.bas }, { nombre: "Pensión", v: pen, c: COL.pen }, { nombre: "Transferencias", v: trHoy, c: COL.tra }], { etiqueta: "hoy", centro: compacto(bas + pen + trHoy) });
        comparativo($("#cmp"), ta, porDiaTurno, dias7);
        columnas($("#g-dias"), semana, { promedio });
        $("#prom-txt").textContent = cerrados.length ? `Promedio diario ${dinero(promedio)} (${cerrados.length} ${cerrados.length === 1 ? "día" : "días"} anteriores del mes)` : "Promedio diario";
      }
      $("#i-pie").textContent = `Actualizado ${new Date(todo.generado).toLocaleTimeString("es-MX", { hour: "numeric", minute: "2-digit", timeZone: "America/Mexico_City" })} · las gráficas suman efectivo, tarjeta y transferencias (de la hoja y capturadas); el prepago no suma; los cobros recuperados se contabilizan por su fecha.`;
    } else {
      limpiarFuenteHoy("caja");
      $("#i-pie").textContent = "No se pudieron cargar los ingresos: " + caja.reason.message;
    }

    if (ag.status === "fulfilled") {
      const a = ag.value, d = x => fCorto.format(new Date(x + "T12:00:00Z"));
      const lista = (filas, f, vacio) => `<div class="mini-l">${filas.length ? filas.map(f).join("") : `<div class="vacio">${vacio}</div>`}</div>`;
      const quien = x => x.reporto || (x.autor && x.autor !== "admin" ? x.autor : null);
      const cuando = iso => iso ? new Date(iso).toLocaleDateString("es-MX", { day: "numeric", month: "short", timeZone: "America/Mexico_City" }) : "";
      const q3 = (filas, vacio, extra = () => "") => `<div class="mini-q">${filas.length ? filas.slice(0, 3).map(x => `<div><span class="t">${extra(x)}${esc(x.titulo)}</span><span class="q">${quien(x) ? avP(quien(x)) + esc(quien(x)) : avP("admin") + "Administración"} · ${esc(cuando(x.creado))}</span></div>`).join("") : `<div class="vacio">${vacio}</div>`}</div>`;
      contar($("#n-incid"), a.abiertos.incidencia || 0, v => String(Math.round(v)));
      $("#m-incid").innerHTML = q3(a.incidencias, "Sin incidencias abiertas", x => x.gravedad === "grave" ? "❗ " : "");
      contar($("#n-tareas"), a.abiertos.tarea || 0, v => String(Math.round(v)));
      $("#m-tareas").innerHTML = q3(a.tareas, "Nada pendiente", x => x.prioridad === "alta" ? "❗ " : "");
      const novedadesCastagram = Math.max(0, Number(a.avisos_sin_leer) || 0);
      const indicadorCastagram = $("#n-avisos");
      contar(indicadorCastagram, novedadesCastagram, v => String(Math.round(v)));
      indicadorCastagram.classList.toggle("con-novedades", novedadesCastagram > 0);
      indicadorCastagram.setAttribute("aria-label", `${novedadesCastagram} novedades pendientes de Castagram`);
      $("#m-avisos").innerHTML = `<p class="note">${novedadesCastagram ? `${novedadesCastagram} publicaciones o conversaciones con novedades` : "Sin novedades pendientes"} · ${a.abiertos.aviso || 0} activas</p>` + q3(a.avisos || [], "Sin publicaciones activas de Castagram");
      const ia = [...a.incidencias.map(x => ({ ...x, k: "Incidencia" })), ...(a.avisos || []).map(x => ({ ...x, k: "Aviso" }))].sort((x, y) => String(y.creado).localeCompare(String(x.creado)));
      $("#m-incav").innerHTML = `<div class="mini-q">${ia.length ? ia.slice(0, 5).map(x => `<div><span class="t">${x.k === "Incidencia" ? `<span style="color:${x.gravedad === "grave" ? "#ff6961" : x.gravedad === "media" ? "#ff9f0a" : "#8e8e93"}">●</span> ` : `<span style="color:#ffcc00">●</span> `}${esc(x.titulo)}</span><span class="q">${esc(x.k)} · ${quien(x) ? esc(quien(x)) : "Administración"} · ${esc(cuando(x.creado))}</span></div>`).join("") : `<div class="vacio">Sin incidencias ni avisos</div>`}</div>`;
      $("#m-eventos").innerHTML = lista(a.proximos, x => `<div><span>${esc(x.titulo)}</span><span class="m">${x.fecha === a.hoy ? "Hoy" : esc(d(x.fecha))}${x.hora ? " · " + esc(x.hora) : ""}</span></div>`, "Sin eventos próximos");
      contar($("#n-compras"), a.abiertos.compra || 0, v => String(Math.round(v)));
      $("#m-compras").innerHTML = lista(a.compras, x => `<div><span>${x.prioridad === "alta" ? "❗ " : ""}${esc(x.titulo)}</span><span class="m">${esc(x.cantidad || "")}</span></div>`, "Sin compras pendientes");
    } else limpiarFuenteHoy("agenda");
  }

  // ---- Finanzas del mes ----
  function pintarFinanzas(j) {
    contar($("#i-f-ing"), j.ingresos.total, v => dinero(v));
    $("#i-f-ing-nota").textContent = `Tickets, transferencias y rentas`;
    contar($("#i-f-egr"), j.egresos.total, v => dinero(v));
    const eg = j.egresos, caja = eg.caja + (eg.retiros || 0), otros = (eg.comision || 0) + (eg.faltantes || 0);
    $("#i-f-egr-nota").textContent = `Caja ${dinero(caja)} · administración ${dinero(eg.total - caja - otros)}${otros ? ` · comisión y faltantes ${dinero(otros)}` : ""}`;
    contar($("#i-f-res"), j.resultado, v => dinero(v));
    const df = j.diferencias || {}, notaRes = [eg.comision ? `comisión MP ${dinero(eg.comision)}` : "", df.faltantes ? `faltantes ${dinero(df.faltantes)}` : ""].filter(Boolean).join(" · ");
    $("#i-f-res-nota").textContent = notaRes ? "Ya descuenta " + notaRes : "Entró − salió";
    const e = j.efectivo;
    if (e.saldo != null) { contar($("#i-f-sob"), e.saldo, v => dinero(v)); $("#i-f-sob-nota").textContent = `Entró ${dinero(e.recibido)} · salió ${dinero(e.gastado)}${e.capturado ? "" : " · saldo calculado"}`; }
    else { $("#i-f-sob").textContent = "—"; $("#i-f-sob-nota").textContent = `Falta un saldo de partida · entró ${dinero(e.recibido)}`; }
  }

  // ---- Calendario del mes con puntos (eventos, tareas, incidencias, pagos) ----
  function pintarCalendario(j) {
    const ta = turnoActual(), mes = ta.hoy.slice(0, 7);
    const [a, m] = mes.split("-").map(Number), primero = new Date(Date.UTC(a, m - 1, 1));
    const inicio = new Date(primero); inicio.setUTCDate(1 - ((primero.getUTCDay() + 6) % 7));
    const abierto = it => !["hecho", "comprado", "resuelta", "archivado", "pagado"].includes(it.estado);
    const porDia = {};
    for (const it of j.items) if (it.fecha && it.tipo !== "aviso" && it.tipo !== "compra" && (abierto(it) || it.tipo === "evento")) (porDia[it.fecha] = porDia[it.fecha] || new Set()).add(it.tipo);
    for (const p of j.pagos_hechos || []) (porDia[p.fecha] = porDia[p.fecha] || new Set()).add("pagado");
    let celdas = ["Lu", "Ma", "Mi", "Ju", "Vi", "Sá", "Do"].map(d => `<span class="dow">${d}</span>`).join("");
    for (let i = 0; i < 42; i++) {
      const d = new Date(inicio); d.setUTCDate(inicio.getUTCDate() + i);
      const iso = d.toISOString().slice(0, 10), t = [...(porDia[iso] || [])];
      celdas += `<button class="d ${d.getUTCMonth() !== m - 1 ? "fuera" : ""} ${iso === ta.hoy ? "hoy" : ""}" type="button" data-cdia="${iso}" aria-label="${esc(fLargo.format(d))}${t.length ? ", con pendientes" : ""}">${d.getUTCDate()}<span class="pts">${t.map(x => `<i class="pt ${x}"></i>`).join("")}</span></button>`;
      if (i >= 34 && d.getUTCMonth() !== m - 1 && d.getUTCDay() === 0) break;
    }
    const nm = new Date(mes + "-15T12:00:00Z").toLocaleDateString("es-MX", { month: "long", year: "numeric", timeZone: "UTC" });
    $("#i-calendario").innerHTML = `<div class="cal-head"><h3>${esc(nm.charAt(0).toUpperCase() + nm.slice(1))}</h3></div><div class="cal">${celdas}</div>
      <div class="cal-ley"><span><i class="pt evento"></i>Eventos</span><span><i class="pt tarea"></i>Tareas</span><span><i class="pt incidencia"></i>Incidencias</span><span><i class="pt pago"></i>Pagos por hacer</span><span><i class="pt pagado"></i>Pagos hechos</span></div>`;
    $("#i-calendario").querySelectorAll("[data-cdia]").forEach(b => b.addEventListener("click", () => window.agendaDia && window.agendaDia(b.dataset.cdia)));
  }

  // Navegación desde las tarjetas y acciones rápidas
  document.querySelectorAll("#mod-inicio [data-ir]").forEach(el => {
    const ir = () => window.irA && (el.dataset.vista ? window.irA(el.dataset.ir, { historia: "push", vista: el.dataset.vista }) : window.irA(el.dataset.ir));
    el.addEventListener("click", e => { e.stopPropagation(); ir(); });
    el.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); ir(); } });
  });
  document.querySelectorAll("#mod-inicio [data-agenda]").forEach(el => {
    const ir = () => window.agendaAbrir && window.agendaAbrir(el.dataset.agenda);
    el.addEventListener("click", ir);
    el.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); ir(); } });
  });
  document.querySelectorAll("#mod-inicio [data-accion]").forEach(b => b.addEventListener("click", () => {
    const a = b.dataset.accion;
    if (a === "gasto") { window.irA && window.irA("caja"); setTimeout(() => { const x = document.getElementById("c-gasto"); x && x.click(); }, 300); }
    else if (a === "transf") window.finanzasAbrir && window.finanzasAbrir("transf");
    else if (a === "pagohecho") window.agendaAbrir && window.agendaAbrir("hechos", "hecho");
    else if (a === "programar") window.agendaAbrir && window.agendaAbrir("pago", "programar");
    else window.agendaAbrir && window.agendaAbrir(a === "evento" ? "calendario" : a);
  }));
  document.addEventListener("modulo", e => { if (e.detail === "inicio") { firmaGraf = null; cargar().catch(() => {}); } });
  document.addEventListener("recargar-todo", () => { if (!$("#mod-inicio").hidden) cargar().catch(() => {}); });
  let ancho = innerWidth;
  addEventListener("resize", () => { if (Math.abs(innerWidth - ancho) > 40 && !$("#mod-inicio").hidden) { ancho = innerWidth; firmaGraf = null; cargar().catch(() => {}); } });
  if (!$("#mod-inicio").hidden) cargar().catch(() => {});
  setInterval(() => { if (!$("#mod-inicio").hidden && !document.hidden) cargar().catch(() => {}); }, 120000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden && !$("#mod-inicio").hidden) cargar().catch(() => {}); });
  // Tarjetas de Dinero: Entró/Salió/Resultado abren el resumen; Efectivo en sobres, Cuentas y sobres
  document.querySelectorAll('#mod-inicio [data-ir="finanzas"]').forEach(el => { if (el.querySelector("#i-f-sob")) el.dataset.vista = "cuentas"; });
})();
