// ---- Ingresos y gastos por corte de turno ----
(() => {
  const $ = (q, el = document) => el.querySelector(q);
  const esc = EC.esc;
  const dinero = v => (v < 0 ? "−" : "") + "$" + Math.abs(Number(v) || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fDia = new Intl.DateTimeFormat("es-MX", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
  const diaTxt = d => fDia.format(new Date(d + "T12:00:00Z"));
  const hora = f => (f || "").slice(11, 16);
  const fechaHora = iso => iso ? "Entregado " + new Date(iso).toLocaleString("es-MX", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "America/Mexico_City" }) : "";
  // Diferencia del corte ciego: contado − sistema (con ícono y texto, no solo color)
  const difEtq = v => v == null ? "" : Math.abs(v) < 1 ? `<span class="dif ok">✓ Cuadra</span>` : v < 0 ? `<span class="dif falta">▼ Faltan ${dinero(-v)}</span>` : `<span class="dif sobra">▲ Sobran ${dinero(v)}</span>`;
  const TURNO_TXT = { "MAÑANA": "Mañana", "TARDE": "Tarde", "NOCHE": "Noche" };
  const toast = EC.toast;
  const api = EC.api;
  // Turno actual (hora de Tapachula): mañana 6–14, tarde 14–22, noche 22–6
  function turnoActual() {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hour12: false }).formatToParts(new Date()).map(x => [x.type, x.value]));
    let dia = `${p.year}-${p.month}-${p.day}`; const h = Number(p.hour) % 24;
    if (h < 6) { const d = new Date(dia + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() - 1); dia = d.toISOString().slice(0, 10); return { dia, turno: "NOCHE" }; }
    return { dia, turno: h < 14 ? "MAÑANA" : h < 22 ? "TARDE" : "NOCHE" };
  }

  const st = { datos: null, actual: null, cargado: false, vista: "cortes", desde: "", hasta: "", rapido: "mes" };
  const sumar = (dia, n) => { const d = new Date(dia + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const hoyMx = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(new Date());
  const consulta = () => { const q = new URLSearchParams(); if (st.desde) q.set("desde", st.desde); if (st.hasta) q.set("hasta", st.hasta); const t = q.toString(); return t ? "?" + t : ""; };
  const clave = c => c.dia + "|" + c.turno;

  let secuenciaCaja = 0;
  async function cargar() {
    const solicitud = ++secuenciaCaja;
    const lista = $("#c-lista");
    try {
      const j = await api("caja" + consulta());
      if (solicitud !== secuenciaCaja) return;
      st.datos = j;
      if (j.categorias) window.ponerCategorias(j.categorias);
      if (j.cuentas) window.CUENTAS = j.cuentas;
      EC.bloqueN("caja", "movs", (j.movimientos || []).length);
      EC.bloqueN("caja", "cortes", j.cortes.length);
      EC.bloqueN("caja", "entregas", j.cortes.filter(x => x.conteo).length);
      const [a, m] = j.mes.split("-");
      const nomMes = new Intl.DateTimeFormat("es-MX", { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(+a, +m - 1, 15)));
      const s = j.sync;
      const hace = s && s.at ? Math.max(0, Math.round((Date.now() - new Date(s.at)) / 60000)) : null;
      const per = st.desde && st.desde === st.hasta ? diaTxt(st.desde) : st.desde || st.hasta ? `${st.desde ? diaTxt(st.desde) : "inicio del mes"} a ${st.hasta ? diaTxt(st.hasta) : "hoy"}` : `${esc(nomMes)} ${a}`;
      $("#c-subtitulo").innerHTML = !j.conectado ? `<span style="color:var(--bad)">La hoja de Google todavía no está conectada.</span>`
        : `${esc(per)} · ${hace === null ? "sin actualizar" : hace < 1 ? "actualizado hace un momento" : `actualizado hace ${hace} min`}${s && s.error && (!s.at || s.error_at > s.at) ? ` · <span style="color:var(--bad)">Última lectura falló: ${esc(s.error)}</span>` : ""}`;
      const t = j.totales;
      const sobres = j.cortes.reduce((a, c) => a + (c.conteo && c.conteo.sobre || 0), 0);
      $("#c-totales").innerHTML = [["Tickets en efectivo", t.efectivo], ["Tarjeta (va a Mercado Pago)", t.tarjeta], ...(t.extras ? [["Ingresos extra", t.extras]] : []), ["Gastos de caja", t.gastos], ["Sobres entregados", sobres, "dest"]]
        .map(([k, v, c]) => `<div class="k ${c || ""}"><span>${k}</span><b>${dinero(v)}</b></div>`).join("");
      const ahora = turnoActual();
      // Línea de estado de cada tarjeta del índice (celular y tablet) y botón de filtros plegados
      {
        const D0 = v => dinero(v, 0);
        const cur = j.cortes.find(x => x.dia === ahora.dia && x.turno === ahora.turno);
        const sinCorte = j.cortes.filter(x => !x.conteo && (x.registros || 0) > 0 && !(x.dia === ahora.dia && x.turno === ahora.turno)).length;
        EC.bloqueInfo("caja", "curso", { valor: cur ? D0((cur.efectivo || 0) + (cur.tarjeta || 0)) : null, texto: `Turno de la ${(TURNO_TXT[ahora.turno] || "").toLowerCase()} · ${cur && cur.conteo ? "corte entregado" : "sin corte"}` });
        EC.bloqueN("caja", "cortes", j.cortes.length, sinCorte > 0);
        EC.bloqueInfo("caja", "cortes", { texto: sinCorte ? `${sinCorte} sin entregar` : "Todos entregados" });
        EC.bloqueInfo("caja", "movs", { texto: "gastos " + D0(t.gastos || 0) + (t.extras ? " · extras " + D0(t.extras) : "") });
        EC.bloqueInfo("caja", "entregas", { texto: "sobres " + D0(sobres) });
        const fb = $("#c-fil-btn"); if (fb) fb.textContent = "Periodo: " + per.replace(/^(\S)/, c => c.toUpperCase()) + " ▾";
      }
      // Todo a la vista: turno en curso, cortes, movimientos y entregas (cada uno en su bloque)
      for (const [f, id] of [[vistaCurso, "#c-curso"], [vistaMovs, "#c-movs"], [vistaEntregas, "#c-entregas"]]) try { f(j); } catch (er) { console.error(er); $(id).innerHTML = `<p class="note">No se pudo mostrar: ${esc(er.message)}</p>`; }
      if (!j.cortes.length) { lista.innerHTML = `<p class="empty">${j.conectado ? "Todavía no hay registros este mes." : "Conecta la hoja de Google para ver los ingresos."}</p>`; return; }
      const fila = c => {
        const es = c.dia === ahora.dia && c.turno === ahora.turno;
        return `<button class="item citem" data-k="${esc(clave(c))}" ${st.actual === clave(c) ? 'aria-current="true"' : ""}>
          <svg class="chev" aria-hidden="true"><use href="#i-chev"/></svg>
          <span class="svc ambos" aria-hidden="true" style="font-weight:700;font-size:var(--t-md)">${esc((TURNO_TXT[c.turno] || c.turno).slice(0, 1))}</span>
          <span class="t">${esc(TURNO_TXT[c.turno] || c.turno)}${es ? ` <span class="cturno ahora">en curso</span>` : ""}</span>
          <span class="m"><span>Efectivo ${dinero(c.efectivo)}</span><span>Tarjeta ${dinero(c.tarjeta)}</span></span>
          <span class="m"><span>${c.n_gastos ? `Gastos ${dinero(c.gastos_total)}` : "Sin gastos"}</span><span>En caja ${dinero(c.efectivo_caja)}</span></span>
          ${c.conteo && c.conteo.admin ? `<span class="m"><span>Entrega de la administración</span><span>Sobre ${dinero(c.conteo.sobre || 0)}</span></span>` : c.conteo ? `<span class="m"><span>Contó ${avP(c.conteo.persona)}${esc(c.conteo.persona)} ${dinero(c.conteo.efectivo)}</span>${difEtq(c.conteo.dif_efectivo)}</span>` : ""}
          ${c.cambio_turno && Math.abs(c.cambio_turno.dif) >= 1 ? `<span class="m"><span>Cambio recibido</span>${difEtq(c.cambio_turno.dif)}</span>` : ""}
        </button>`;
      };
      // Un grupo por día, con el total de ingresos del día en el encabezado
      const grupos = [];
      for (const c of j.cortes) { const g = grupos[grupos.length - 1]; if (g && g.dia === c.dia) g.cs.push(c); else grupos.push({ dia: c.dia, cs: [c] }); }
      lista.innerHTML = grupos.map(g => `<div class="cgrupo"><h3 class="cdia"><span>${esc(diaTxt(g.dia))}</span><span>${dinero(g.cs.reduce((t, c) => t + (c.efectivo || 0) + (c.tarjeta || 0), 0))}</span></h3>${g.cs.map(fila).join("")}</div>`).join("");
    } catch (e) { if (solicitud === secuenciaCaja && e.message !== "sesion") lista.innerHTML = `<p class="empty">No se pudo cargar: ${esc(e.message)}</p>`; }
  }

  function formGasto(dia, turno) {
    return `<form class="cform" id="c-fgasto" novalidate>
      <label>Día<input type="date" name="dia" value="${esc(dia)}" required></label>
      <label>Turno<select name="turno">${["MAÑANA", "TARDE", "NOCHE"].map(t => `<option value="${t}" ${t === turno ? "selected" : ""}>${TURNO_TXT[t]}</option>`).join("")}</select></label>
      <label class="wide">Concepto<input name="concepto" maxlength="120" placeholder="Ej. garrafón de agua, papelería" required></label>
      <label>Monto<input name="monto" inputmode="decimal" placeholder="0.00" required></label>
      <label class="wide">Categoría <span style="font-weight:400">(elige o escribe; vacía se asigna sola)</span><input name="categoria" list="dl-cats" maxlength="40" placeholder="Ej. Papelería y consumibles" autocomplete="off"></label>
      <p class="note wide" style="grid-column:1/-1;margin:0">Solo lo que salió del efectivo de la caja de ese turno (resta al corte). Los pagos y compras de la administración van en Pagos y compras.</p>
      <span class="err wide" id="c-ferr" style="grid-column:1/-1"></span>
      <div class="row" style="grid-column:1/-1"><button class="btn btn-primary" type="submit">Guardar gasto de caja</button></div>
    </form>`;
  }
  function conectarForm(despues) {
    $("#c-fgasto").addEventListener("submit", async ev => {
      ev.preventDefault();
      const f = ev.target, b = f.querySelector("button[type=submit]");
      const cuerpo = { dia: f.dia.value, turno: f.turno.value, concepto: f.concepto.value, monto: f.monto.value.replace(/[$,\s]/g, ""), forma: "EFECTIVO", categoria: f.categoria.value };
      b.disabled = true; $("#c-ferr").textContent = "";
      try {
        await api("caja/gastos", { method: "POST", body: JSON.stringify(cuerpo) });
        toast("Gasto de caja guardado");
        await cargar();
        abrirCorte(cuerpo.dia + "|" + cuerpo.turno);
      } catch (e) { if (e.message !== "sesion") $("#c-ferr").textContent = e.errores ? Object.values(e.errores).join(" ") : e.message; b.disabled = false; }
    });
  }

  function nuevoGasto() {
    const a = turnoActual();
    st.actual = null;
    $("#c-work").classList.add("ver-detalle");
    $("#c-detalle").innerHTML = `<button class="btn btn-line back" id="c-volver" type="button">← Volver a la lista</button>
      <div class="detail-head"><h2>Nuevo gasto de caja</h2></div>
      <section class="card">${formGasto(a.dia, a.turno)}</section>`;
    $("#c-volver").addEventListener("click", () => $("#c-work").classList.remove("ver-detalle"));
    conectarForm();
    $("#c-fgasto").concepto.focus();
  }

  // ---- Ficha de conciliación del corte: se lee de arriba abajo y cada paso dice si cuadra ----
  // cambio recibido → ventas e ingresos → gastos → debería haber → contado → reparto → cambio dejado
  function ficha(c, j, dia, turno) {
    const ahora = turnoActual(), enCurso = dia === ahora.dia && turno === ahora.turno;
    const k = c.conteo, ct = c.cambio_turno, cs = c.cambio_siguiente;
    const marca = (estado, txt) => `<span class="cf-m ${estado}">${estado === "ok" ? "✓" : estado === "mal" ? "!" : estado === "esp" ? "…" : "·"}<span class="sr"> ${esc(txt)}</span></span>`;
    const paso = (estado, titulo, valor, detalle = "", extra = "") => `<li class="cf-p ${estado}">${marca(estado, titulo)}<div class="cf-c"><div class="cf-l"><span>${titulo}</span><b>${valor}</b></div>${detalle ? `<p>${detalle}</p>` : ""}${extra}</div></li>`;
    const dif = v => Math.abs(v) < 1 ? "cuadra" : v < 0 ? `faltan ${dinero(-v)}` : `sobran ${dinero(v)}`;
    const est = v => v == null ? "" : Math.abs(v) < 1 ? "ok" : "mal";
    const pasos = [];
    // 1. Cambio recibido
    const cambio = c.cambio && c.cambio.n ? c.cambio.importe : null;
    pasos.push(paso(ct ? est(ct.dif) : cambio != null ? "" : "esp", "Cambio inicial", cambio != null ? dinero(cambio) : "—",
      ct ? `${avP(ct.de.persona)}${esc(ct.de.persona)} dejó ${dinero(ct.dejado)} · ${avP(ct.recibio)}${esc(ct.recibio)} recibió ${dinero(ct.recibido)}${Math.abs(ct.dif) >= 1 ? ` · <b class="rojo">${dif(ct.dif)}</b>` : ""}`
        : cambio != null ? (c.cambio.fuente === "tablet" ? `Declarado en la tablet por ${avP(c.cambio.persona)}${esc(c.cambio.persona)}.` : "De la hoja (renglón CAMBIO o FONDO).") : "Nadie declaró el cambio con el que empezó."));
    // 2. Ventas e ingresos que entran a la caja
    pasos.push(paso("", "+ Ventas en efectivo", dinero(c.efectivo), `Báscula ${dinero(c.bascula.EFECTIVO)} · pensión ${dinero(c.pension.EFECTIVO)}`));
    if (c.extra && c.extra.n) pasos.push(paso("", "+ Ingresos extra", dinero(c.extra.importe), `${c.extra.ingreso ? `Rentas y otros ${dinero(c.extra.ingreso)}` : ""}${c.extra.importe - c.extra.ingreso ? `${c.extra.ingreso ? " · " : ""}aumento de cambio ${dinero(c.extra.importe - c.extra.ingreso)}` : ""}`));
    if (c.caja && c.caja.n) pasos.push(paso("", "Renglones de caja de la hoja", dinero(c.caja.importe), `${c.caja.n} sin folio de ticket (aparecen en Movimientos de caja).`));
    // 3. Gastos
    pasos.push(paso("", "− Gastos de caja", c.gastos.EFECTIVO ? "−" + dinero(c.gastos.EFECTIVO) : dinero(0), c.n_gastos ? `${c.n_gastos} ${c.n_gastos === 1 ? "gasto capturado" : "gastos capturados"} en el turno.` : "Sin gastos en el turno."));
    // 4. Debería haber
    const esperado = k ? (k.esperado ?? c.efectivo_caja) : c.efectivo_caja;
    pasos.push(`<li class="cf-p cf-tot"><span class="cf-m"></span><div class="cf-c"><div class="cf-l"><span>= Debería haber en la caja</span><b>${dinero(esperado)}</b></div>${k && !k.con_cambio && c.cambio && c.cambio.n ? `<p>Este corte se contó sin el fondo de cambio (antes del 14 oct).</p>` : ""}</div></li>`);
    // 5. Contado
    if (k && k.admin) pasos.push(paso("", "Entrega capturada por la administración", dinero(k.efectivo), "Turno sin corte en la tablet: el sobre, los retiros y el cambio los capturó la administración, sin conteo ciego."));
    else if (k) pasos.push(paso(est(k.dif_efectivo), "Contó " + `${avP(k.persona)}${esc(k.persona)}`, dinero(k.efectivo), Math.abs(k.dif_efectivo) < 1 ? "Cuadra con lo que debería haber." : `<b class="rojo">${dif(k.dif_efectivo)}</b> contra lo que debería haber.`));
    else pasos.push(paso(enCurso ? "esp" : "mal", "Corte ciego", "—", enCurso ? "El turno sigue abierto: el encargado entrega el corte en la tablet al terminar." : "Nadie entregó el corte de este turno en la tablet."));
    // 6. Reparto
    if (k && k.sobre != null) {
      const rets = k.retiros || [], rep = (k.sobre || 0) + rets.reduce((a, r) => a + r.monto, 0) + (k.cambio_sig || 0), d = k.admin ? 0 : Math.round((k.efectivo - rep) * 100) / 100;
      pasos.push(paso(k.admin ? "" : Math.abs(d) < 0.01 ? "ok" : "mal", "Reparto", dinero(rep),
        `Sobre ${dinero(k.sobre || 0)}${rets.length ? " · retiros " + rets.map((r, i) => `${(j.folios_retiros || [])[i] ? `<span class="folio-mc">${esc(j.folios_retiros[i])}</span> ` : ""}${esc(r.concepto)} ${dinero(r.monto)}`).join(", ") : ""} · cambio que dejó ${dinero(k.cambio_sig || 0)}${Math.abs(d) >= 0.01 ? ` · <b class="rojo">${d > 0 ? "faltan " + dinero(d) + " por repartir" : "sobran " + dinero(-d)}</b>` : ""}`));
    }
    // 7. Cambio dejado al siguiente turno
    if (k && k.cambio_sig != null) pasos.push(paso(cs ? est(cs.dif) : k.admin ? "" : "esp", "Cambio para el siguiente turno", dinero(k.cambio_sig),
      k.admin && !cs ? "Lo anotó la administración." : cs ? `${avP(cs.recibio)}${esc(cs.recibio)} dijo recibir ${dinero(cs.recibido)}${Math.abs(cs.dif) >= 1 ? ` · <b class="rojo">${dif(cs.dif)}</b>` : " · cuadra"}` : "El siguiente turno todavía no declara su cambio inicial."));
    // Tarjeta: tickets contra la terminal
    const tj = k && k.tarjeta != null ? paso(est(k.dif_tarjeta), "Tarjeta: tickets contra la terminal", dinero(c.tarjeta), `La terminal dice ${dinero(k.tarjeta)}${Math.abs(k.dif_tarjeta) >= 1 ? ` · <b class="rojo">${dif(k.dif_tarjeta)}</b>` : " · cuadra"}`) : paso("", "Tickets con tarjeta", dinero(c.tarjeta), `Báscula ${dinero(c.bascula.TARJETA)} · pensión ${dinero(c.pension.TARJETA)} (van a Mercado Pago, no a la caja).`);
    // Resumen arriba: ¿cuadra todo?
    const problemas = [];
    if (ct && Math.abs(ct.dif) >= 1) problemas.push("cambio recibido " + dif(ct.dif));
    if (k && Math.abs(k.dif_efectivo) >= 1) problemas.push("efectivo " + dif(k.dif_efectivo));
    if (k && k.dif_tarjeta != null && Math.abs(k.dif_tarjeta) >= 1) problemas.push("tarjeta " + dif(k.dif_tarjeta));
    if (cs && Math.abs(cs.dif) >= 1) problemas.push("cambio dejado " + dif(cs.dif));
    if (!k && !enCurso) problemas.push("falta el corte");
    const estado = problemas.length ? "mal" : !k ? "esp" : k.admin ? "" : "ok";
    const fuera = Object.entries(c.fuera.formas).map(([f, v]) => `${f.toLowerCase()} ${dinero(v)}`).join(" · ");
    return `<section class="card cficha ${estado}"><h3>Corte</h3>
      <div class="cf-res ${estado}">${k && k.admin && !problemas.length ? "Entrega capturada por la administración" : estado === "ok" ? "✓ Todo cuadra" : estado === "esp" ? (enCurso ? "Turno en curso" : "Sin corte") : "Revisar: " + esc(problemas.join(" · "))}</div>
      <ol class="cf">${pasos.join("")}</ol>
      <ol class="cf cf-aparte">${tj}</ol>
      ${c.fuera.n ? `<p class="note">No pasan por la caja: ${c.fuera.n} registros (${esc(fuera)}). Las transferencias cuentan como ingreso en Dinero.</p>` : ""}
      ${k && k.admin ? `<div class="row"><button class="btn btn-bad" type="button" id="c-del-entrega" style="min-height:40px">Borrar esta captura</button></div>` : ""}
      ${k && !k.admin ? `<p class="note">${esc(fechaHora(k.actualizado))}${k.veces > 1 ? ` · corregido ${k.veces - 1} ${k.veces === 2 ? "vez" : "veces"}` : ""}${k.notas ? " · " + esc(k.notas) : ""}</p>` : ""}
      ${(j.historial || []).length > 1 ? `<details><summary class="note" style="cursor:pointer;font-weight:600">Entregas y correcciones (${j.historial.length})</summary>
        <div class="tabla-scroll" tabindex="0" role="region" aria-label="Historial del corte"><table class="cmovs"><thead><tr><th>Hora</th><th>Quién</th><th class="n">Efectivo</th><th class="n">Sobre</th><th class="n">Retiros</th><th class="n">Cambio sig.</th></tr></thead><tbody>
        ${j.historial.map(x => `<tr><td>${esc(new Date(x.creado).toLocaleString("es-MX", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "America/Mexico_City" }))}</td><td>${avP(x.persona)}${esc(x.persona)}</td><td class="n">${dinero(x.efectivo || 0)}</td><td class="n">${dinero(x.sobre || 0)}</td><td class="n">${dinero((x.retiros || []).reduce((a, r) => a + r.monto, 0))}</td><td class="n">${dinero(x.cambio_sig || 0)}</td></tr>`).join("")}
        </tbody></table></div></details>` : ""}
    </section>`;
  }

  async function abrir(k) {
    st.actual = k;
    document.querySelectorAll("#c-lista .item").forEach(b => b.dataset.k === k ? b.setAttribute("aria-current", "true") : b.removeAttribute("aria-current"));
    const [dia, turno] = k.split("|");
    const d = $("#c-detalle");
    $("#c-work").classList.add("ver-detalle");
    d.innerHTML = `<p class="empty">Cargando corte…</p>`;
    let j;
    try { j = await api(`caja/corte?dia=${encodeURIComponent(dia)}&turno=${encodeURIComponent(turno)}`); }
    catch (e) { if (e.message !== "sesion") d.innerHTML = `<p class="empty">${esc(e.message)}</p>`; return; }
    const c = j.corte || { bascula: { EFECTIVO: 0, TARJETA: 0 }, pension: { EFECTIVO: 0, TARJETA: 0 }, efectivo: 0, tarjeta: 0, ingresos: 0, gastos: { EFECTIVO: 0, TARJETA: 0, TRANSFERENCIA: 0 }, gastos_total: 0, caja: { n: 0, importe: 0 }, cambio: { n: 0, importe: 0 }, extra: { n: 0, importe: 0, ingreso: 0 }, efectivo_caja: 0, fuera: { n: 0, importe: 0, formas: {} } };
    const fila = (k, a, b, cls = "") => `<span class="${cls}">${k}</span><span class="n ${cls}">${a}</span><span class="n ${cls}">${b}</span>`;
    const fuera = Object.entries(c.fuera.formas).map(([f, v]) => `${f.toLowerCase()} ${dinero(v)}`).join(" · ");
    const icono = sv => `<span class="svc ${sv}" title="${sv === "bascula" ? "Báscula" : "Pensión"}"><svg aria-hidden="true"><use href="#i-${sv}"/></svg></span>`;
    d.innerHTML = `<button class="btn btn-line back" id="c-volver" type="button">← Volver a la lista</button>
      <div class="detail-head"><h2>${esc(diaTxt(dia))} · ${esc(TURNO_TXT[turno] || turno)}</h2><span class="note">${j.movs.length} ${j.movs.length === 1 ? "registro" : "registros"} de la hoja · ${j.gastos.length} ${j.gastos.length === 1 ? "gasto" : "gastos"}</span></div>
      <div style="display:grid;gap:20px;min-width:0">
      <div class="cols">
          ${ficha(c, j, dia, turno)}
          <section class="card"><h3>Gastos de caja del turno</h3>
            ${j.gastos.length ? `<div>${j.gastos.map(g => `<div class="cgasto"><span>${g.folio_mc ? `<span class="folio-mc">${esc(g.folio_mc)}</span> ` : ""}${g.categoria ? window.catIco(g.categoria) + " " : ""}${esc(g.concepto)}${c.conteo && g.creado > c.conteo.actualizado ? ` <span class="tag alta">Después del corte</span>` : ""}</span><b>${dinero(g.monto)}</b><button class="btn btn-bad" type="button" data-del="${esc(g.id)}" style="min-height:40px;padding:0 12px">Eliminar</button><span class="note">${esc(g.forma.toLowerCase())}${g.persona ? " · " + avP(g.persona) + esc(g.persona) + " (tablet)" : g.creado_por ? " · " + esc(g.creado_por) : ""}${g.foto ? ` · <a href="/panel/api/turno/foto/${encodeURIComponent(g.foto)}" target="_blank" rel="noopener">ver foto</a>` : ""}</span></div>`).join("")}</div>` : `<p class="note">Sin gastos en este turno.</p>`}
            <details ${j.gastos.length ? "" : "open"}><summary class="note" style="cursor:pointer;font-weight:600">Agregar gasto de caja a este turno</summary><div style="margin-top:12px">${formGasto(dia, turno)}</div></details>
          </section>
          <section class="card"><h3>Ingresos extra del turno</h3>
            ${(j.extras || []).length ? `<div>${j.extras.map(x => `<div class="cgasto"><span>${x.folio_mc ? `<span class="folio-mc">${esc(x.folio_mc)}</span> ` : ""}${esc(x.concepto)}${x.detalle ? " · " + esc(x.detalle) : ""}${c.conteo && x.creado > c.conteo.actualizado ? ` <span class="tag alta">Después del corte</span>` : ""}</span><b>+${dinero(x.monto)}</b><button class="btn btn-bad" type="button" data-xdel="${esc(x.id)}" style="min-height:40px;padding:0 12px">Eliminar</button><span class="note">${x.ingreso ? "cuenta como ingreso" : "solo caja"}${x.persona ? " · " + avP(x.persona) + esc(x.persona) + " (tablet)" : ""}${x.foto ? ` · <a href="/panel/api/turno/foto/${encodeURIComponent(x.foto)}" target="_blank" rel="noopener">ver foto</a>` : ""}</span></div>`).join("")}</div>` : `<p class="note">Rentas, aumento de cambio u otros ingresos sin ticket.</p>`}
            <details><summary class="note" style="cursor:pointer;font-weight:600">Agregar ingreso extra a este turno</summary><div style="margin-top:12px">
              <form class="cform" id="c-fextra" novalidate>
                <label>Concepto<select name="concepto">${(j.conceptos_extra || ["Renta", "Aumento de cambio", "Otro ingreso"]).map(x => `<option>${esc(x)}</option>`).join("")}</select></label>
                <label>Monto<input name="monto" inputmode="decimal" placeholder="0.00" required></label>
                <label class="wide">De quién o de qué<input name="detalle" maxlength="120" placeholder="Ej. renta del local de ropa"></label>
                <span class="err wide" id="c-xerr" style="grid-column:1/-1"></span>
                <div class="row" style="grid-column:1/-1"><button class="btn btn-primary" type="submit">Guardar ingreso</button></div>
              </form></div></details>
          </section>
      </div>
        <section class="card" style="min-width:0">
          <h3>Pendientes de cobro</h3>
          <p class="note">Registra cuánto recibiste, la fecha y la forma. El abono se refleja en Dinero en su fecha, no altera el corte original y deja de sumarse si la hoja ya refleja ese cobro.</p>
          ${(j.pendientes || []).length ? j.pendientes.map(p => `<div class="cgasto" data-pendiente-id="${esc(p.id)}">
            <span><b>${esc(p.servicio === "bascula" ? "Báscula" : "Pensión")} · folio ${esc(p.folio)}</b>
              <span class="note" style="display:block">${esc(p.cliente || "")} · ${esc(hora(p.fecha))} · ${esc(p.forma || "")}</span>
              <span class="note" style="display:block">${esc(p.estado === "parcial" ? "Abonado parcialmente" : p.estado === "pagado" ? "Liquidado" : p.estado === "cancelado" ? "Cancelado" : "Pendiente")}${p.origen_activo ? "" : " · la hoja ya no lo considera pendiente"}</span>
              ${p.resuelto ? `<span class="note" style="display:block">Resuelto: ${esc(p.resuelto)} · ${esc(p.por || "Administración")}</span>` : ""}
            </span>
            <b>${dinero(Math.max(0, p.monto - (p.abonado || 0)))} restante</b>
            ${p.abonado ? `<span class="note" style="grid-column:1/-1">Abonado: ${dinero(p.abonado)} de ${dinero(p.monto)}</span>` : ""}
            ${(p.abonos || []).length ? `<div style="grid-column:1/-1">${p.abonos.map(a => `<p class="note" style="margin:3px 0">${esc(a.fecha_pago)} · ${esc(a.forma)} · ${dinero(a.monto)} · ${esc(a.por || "Administración")}${a.anulado ? " · ANULADO" : ""}
              ${!a.anulado ? `<button class="btn btn-line" type="button" data-cobro-id="${esc(p.id)}" data-cobro-estado="anular-abono" data-pago-id="${esc(a.id)}">Anular abono</button>` : ""}</p>`).join("")}</div>` : ""}
            ${p.origen_activo && (p.estado === "pendiente" || p.estado === "parcial") && Math.max(0, p.monto - (p.abonado || 0)) > 0 ? `<form data-abonar="${esc(p.id)}" class="cform" style="grid-column:1/-1" novalidate>
              <label>Importe cobrado<input name="monto" inputmode="decimal" value="${(Math.max(0, p.monto - (p.abonado || 0))).toFixed(2)}" required></label>
              <label>Fecha de pago<input name="fecha" type="date" value="${hoyMx()}" required></label>
              <label>Forma<select name="forma" required><option value="EFECTIVO">Efectivo (sobres)</option><option value="TARJETA">Tarjeta (Mercado Pago)</option><option value="TRANSFERENCIA">Transferencia (cuenta predeterminada)</option></select></label>
              <label>Nota opcional<input name="notas" maxlength="240" placeholder="Referencia del pago"></label>
              <div class="row wide"><button class="btn btn-primary" type="submit">Registrar pago</button>
                ${!p.abonado ? `<button class="btn btn-bad" type="button" data-cobro-id="${esc(p.id)}" data-cobro-estado="cancelado">Cancelar pendiente</button>` : ""}</div>
            </form>` : ""}
            ${!p.origen_activo && (p.estado === "pendiente" || p.estado === "parcial") ? `<div class="row" style="grid-column:1/-1">
              <button class="btn btn-line" type="button" data-cobro-id="${esc(p.id)}" data-cobro-estado="conciliado">Confirmar conciliado en hoja</button>
              <button class="btn btn-bad" type="button" data-cobro-id="${esc(p.id)}" data-cobro-estado="cancelado">Cancelar pendiente</button>
            </div>` : ""}
            ${p.estado === "cancelado" && p.origen_activo ? `<button class="btn btn-line" type="button" data-cobro-id="${esc(p.id)}" data-cobro-estado="pendiente">Reabrir pendiente</button>` : ""}
          </div>`).join("") : '<p class="note">Este corte no tiene cobros pendientes o resueltos.</p>'}
        </section>
        <section class="card" style="min-width:0"><h3>Registros de la hoja</h3>
          ${j.movs.length ? `<div class="tabla-scroll" tabindex="0" role="region" aria-label="Registros de la hoja"><table class="cmovs"><thead><tr><th><span class="sr">Servicio</span></th><th>Hora</th><th>Folio</th><th>Matrícula</th><th>Cliente</th><th>Forma</th><th class="n">Importe</th></tr></thead><tbody>
            ${j.movs.map(m => `<tr class="${m.tipo === "caja" ? "mov" : j.formas_contadas.includes(m.forma) ? "" : "no"}"><td>${icono(m.servicio)}</td><td>${esc(hora(m.fecha))}</td><td>${m.folio_mc ? `<span class="folio-mc">${esc(m.folio_mc)}</span> ` : ""}${esc(m.folio)}</td><td>${esc(m.matricula)}</td><td>${esc(m.cliente)}</td><td>${esc(m.tipo === "caja" ? "caja" : m.forma.toLowerCase())}</td><td class="n">${dinero(m.importe)}</td></tr>`).join("")}
          </tbody></table></div><p class="note">En gris: no suman al corte (prepago, transferencia u otros). En cursiva: renglones de caja (con su folio de movimiento MC).</p>` : `<p class="note">No hay registros de la hoja en este turno.</p>`}
        </section>
      </div>`;
    d.querySelectorAll("form[data-abonar]").forEach(f => f.addEventListener("submit", async ev => {
      ev.preventDefault();
      const b = f.querySelector('button[type="submit"]');
      b.disabled = true;
      try {
        await api("caja/pendiente/" + encodeURIComponent(f.dataset.abonar) + "/resolver", {
          method: "POST", body: JSON.stringify({
            estado: "pagado", fecha: f.elements.fecha.value, forma: f.elements.forma.value,
            monto: f.elements.monto.value, notas: f.elements.notas.value, pago_id: crypto.randomUUID()
          })
        });
        toast("Cobro registrado en Dinero por su fecha y forma de pago");
        await cargar(); await abrir(k);
      } catch (e) { if (e.message !== "sesion") toast(e.message); b.disabled = false; }
    }));
    d.querySelectorAll("[data-cobro-id]").forEach(b => b.addEventListener("click", async () => {
      const id = b.dataset.cobroId, estado = b.dataset.cobroEstado;
      const mensaje = estado === "conciliado"
        ? "¿Confirmas que la hoja ya recoge el cobro? No se sumará otro ingreso administrativo."
        : estado === "cancelado"
          ? "¿Confirmas la cancelación? Quedará registrada en el historial."
          : estado === "anular-abono"
          ? "¿Anular este abono? Se corregirán los totales de Dinero mientras el mes esté abierto."
          : "¿Reabrir este pendiente?";
      if (!window.confirm(mensaje)) return;
      b.disabled = true;
      try {
        await api("caja/pendiente/" + encodeURIComponent(id) + "/resolver", {
          method: "POST", body: JSON.stringify({ estado, pago_id: b.dataset.pagoId || "" })
        });
        toast(estado === "conciliado" ? "Conciliación registrada, sin duplicar ingreso" :
          estado === "cancelado" ? "Pendiente cancelado" :
          estado === "anular-abono" ? "Abono anulado" : "Pendiente reabierto");
        await cargar(); await abrir(k);
      } catch (e) { if (e.message !== "sesion") toast(e.message); b.disabled = false; }
    }));
    $("#c-volver").addEventListener("click", () => { $("#c-work").classList.remove("ver-detalle"); st.actual = null; });
    const be = $("#c-del-entrega");
    if (be) be.addEventListener("click", async () => {
      if (!be.classList.contains("armed")) { be.classList.add("armed"); be.textContent = "¿Seguro? Toca otra vez"; setTimeout(() => { be.classList.remove("armed"); be.textContent = "Borrar esta captura"; }, 3000); return; }
      be.disabled = true;
      try { await api("caja/entregas-admin/eliminar", { method: "POST", body: JSON.stringify({ dia, turno }) }); toast("Captura borrada"); await cargar(); abrir(k); }
      catch (e) { if (e.message !== "sesion") toast(e.message); be.disabled = false; }
    });
    conectarForm();
    $("#c-fextra").addEventListener("submit", async ev => {
      ev.preventDefault();
      const f = ev.target, b = f.querySelector("button[type=submit]");
      b.disabled = true; $("#c-xerr").textContent = "";
      try {
        await api("caja/extras", { method: "POST", body: JSON.stringify({ dia, turno, concepto: f.concepto.value, detalle: f.detalle.value, monto: f.monto.value.replace(/[$,\s]/g, "") }) });
        toast("Ingreso guardado"); await cargar(); abrir(k);
      } catch (e) { if (e.message !== "sesion") $("#c-xerr").textContent = e.errores ? Object.values(e.errores).join(" ") : e.message; b.disabled = false; }
    });
    d.querySelectorAll("[data-xdel]").forEach(b => b.addEventListener("click", async () => {
      if (!b.classList.contains("armed")) { b.classList.add("armed"); b.textContent = "¿Seguro?"; setTimeout(() => { b.classList.remove("armed"); b.textContent = "Eliminar"; }, 3000); return; }
      b.disabled = true;
      try { await api(`caja/extras/${encodeURIComponent(b.dataset.xdel)}/eliminar`, { method: "POST", body: "{}" }); toast("Ingreso eliminado"); await cargar(); abrir(k); }
      catch (e) { if (e.message !== "sesion") toast(e.message); b.disabled = false; }
    }));
    d.querySelectorAll("[data-del]").forEach(b => b.addEventListener("click", async () => {
      if (!b.classList.contains("armed")) { b.classList.add("armed"); b.textContent = "¿Seguro?"; setTimeout(() => { b.classList.remove("armed"); b.textContent = "Eliminar"; }, 3000); return; }
      b.disabled = true;
      try { await api(`caja/gastos/${encodeURIComponent(b.dataset.del)}/eliminar`, { method: "POST", body: "{}" }); toast("Gasto eliminado"); await cargar(); abrir(k); }
      catch (e) { if (e.message !== "sesion") toast(e.message); b.disabled = false; }
    }));
  }

  $("#c-lista").addEventListener("click", e => { const b = e.target.closest(".item[data-k]"); if (b) abrir(b.dataset.k); });

  // ---- Movimientos de caja con folio ----
  const TIPO_MOV = { gasto: ["Gasto de caja", "#ff7a70"], ingreso: ["Ingreso extra", "#30d158"], retiro: ["Retiro en el corte", "#ff9f0a"], hoja: ["Renglón de la hoja", "#64d2ff"] };
  function vistaMovs(j) {
    const c = $("#c-movs"), ms = j.movimientos || [];
    const filtro = st.filtroMov || "";
    const lista = ms.filter(m => !filtro || m.tipo === filtro);
    const suma = t => ms.filter(m => m.tipo === t).reduce((a, m) => a + m.monto, 0);
    c.innerHTML = `<section class="card">
      <p class="note" style="margin:4px 0 10px">Todo lo que entra o sale de la caja de un turno, salvo los tickets y el cambio inicial. Cada movimiento tiene un folio único (MC-AAMM-número) que no cambia.</p>
      <div class="ptabs mfil" role="tablist" aria-label="Tipo de movimiento">
        <button class="ptab" type="button" data-f="" aria-selected="${!filtro}">Todos <span class="n">${ms.length}</span></button>
        ${Object.entries(TIPO_MOV).map(([k, [t]]) => `<button class="ptab" type="button" data-f="${k}" aria-selected="${filtro === k}">${t} <span class="n">${ms.filter(m => m.tipo === k).length}</span></button>`).join("")}
      </div>
      <div class="ctot" style="margin:10px 0">${Object.entries(TIPO_MOV).map(([k, [t]]) => `<div class="k"><span>${t}</span><b>${dinero(suma(k))}</b></div>`).join("")}</div>
      ${lista.length ? `<div class="tabla-scroll" tabindex="0" role="region" aria-label="Movimientos de caja"><table class="cmovs tmovs"><thead><tr><th>Folio</th><th>Día y turno</th><th>Hora</th><th>Tipo</th><th>Concepto</th><th>Quién</th><th class="n">Monto</th></tr></thead><tbody>
        ${lista.map(m => `<tr><td><span class="folio-mc">${esc(m.folio || "—")}</span></td><td><button type="button" class="lnk-corte" data-k="${esc(m.dia + "|" + m.turno)}">${esc(diaTxt(m.dia))} · ${esc(TURNO_TXT[m.turno] || m.turno)}</button></td><td>${esc(String(m.cuando || "").slice(11, 16))}</td><td><span class="tmov" style="--c:${TIPO_MOV[m.tipo][1]}">${TIPO_MOV[m.tipo][0]}</span></td><td>${m.categoria ? window.catIco(m.categoria) + " " : ""}${esc(m.concepto)}${m.detalle ? `<span class="note"> · ${esc(m.detalle)}</span>` : ""}${m.foto ? ` · <a href="/panel/api/turno/foto/${encodeURIComponent(m.foto)}" target="_blank" rel="noopener">foto</a>` : ""}</td><td>${m.persona ? avP(m.persona) + esc(m.persona) : esc(m.por ? "Administración" : "")}</td><td class="n" style="color:${m.monto < 0 ? "#ff8a80" : "#7ee2a0"}">${m.monto < 0 ? "−" : "+"}${dinero(Math.abs(m.monto))}</td></tr>`).join("")}
      </tbody></table></div>` : `<p class="note">No hay movimientos de caja ${st.desde || st.hasta ? "en este periodo" : "este mes"}.</p>`}</section>`;
    c.querySelectorAll(".mfil .ptab").forEach(b => b.addEventListener("click", () => { st.filtroMov = b.dataset.f; vistaMovs(j); }));
    c.querySelectorAll(".lnk-corte").forEach(b => b.addEventListener("click", () => { abrirCorte(b.dataset.k); }));
  }

  // ---- Entregas: lo que cada turno entregó en el corte ciego ----
  function vistaEntregas(j) {
    const c = $("#c-entregas");
    const cs = j.cortes.filter(x => x.conteo);
    const folRet = {}; for (const m of j.movimientos || []) if (m.tipo === "retiro") (folRet[m.dia + "|" + m.turno] = folRet[m.dia + "|" + m.turno] || []).push(m);
    const tot = k => cs.reduce((a, x) => a + (k === "retiros" ? (x.conteo.retiros || []).reduce((y, r) => y + r.monto, 0) : x.conteo[k] || 0), 0);
    c.innerHTML = `<section class="card">
      <p class="note" style="margin:4px 0 10px">Lo que cada encargado contó y cómo lo repartió al entregar el corte: el sobre para la administración (cuenta como efectivo recibido en Dinero), los retiros y el cambio que dejó al siguiente turno.</p>
      <details id="c-imp"><summary class="btn btn-line" style="display:inline-flex;align-items:center;cursor:pointer;margin-bottom:10px">Capturar entregas de turnos sin tablet</summary>
        <div class="cform" style="display:block;margin:0 0 14px">
          <p class="note" style="margin:0 0 8px">Pega una tabla con una línea por turno: <b>día, turno, sobre, taxi, sueldo y cambio que dejó</b> (separada por tabuladores, como al copiar de una hoja). «—» o vacío = sin dato. Primero se revisa; no se guarda nada hasta que confirmes. El sueldo o taxi que ya está como renglón en la hoja de ese turno no se cuenta dos veces, y los turnos que entregaron en la tablet no se cambian.</p>
          <textarea id="c-imp-t" rows="8" style="width:100%;font-family:ui-monospace,monospace;font-size:var(--t-sm)" placeholder="01/oct&#9;Tarde&#9;$3,500&#9;$200&#9;—&#9;$130"></textarea>
          <div class="row" style="margin-top:8px"><button class="btn btn-primary" type="button" id="c-imp-rev">Revisar</button></div>
          <div id="c-imp-r"></div>
        </div></details>
      <div class="ctot" style="margin:0 0 10px"><div class="k dest"><span>Sobres</span><b>${dinero(tot("sobre"))}</b></div><div class="k"><span>Retiros</span><b>${dinero(tot("retiros"))}</b></div><div class="k"><span>Cortes entregados</span><b>${cs.length}</b></div></div>
      ${cs.length ? `<div class="tabla-scroll" tabindex="0" role="region" aria-label="Entregas"><table class="tcortes"><thead><tr><th>Corte</th><th>Entregó</th><th class="n">Contado</th><th>Diferencia</th><th class="n">Sobre</th><th>Retiros</th><th class="n">Cambio sig.</th></tr></thead><tbody>
        ${cs.map(x => `<tr><td><button type="button" class="lnk-corte" data-k="${esc(x.dia + "|" + x.turno)}">${esc(diaTxt(x.dia))} · ${esc(TURNO_TXT[x.turno] || x.turno)}</button></td><td>${x.conteo.admin ? `<span class="cat-chip">Administración</span>` : avP(x.conteo.persona) + esc(x.conteo.persona)}</td><td class="n">${x.conteo.admin ? "—" : dinero(x.conteo.efectivo)}</td><td>${x.conteo.admin ? `<span class="note">sin conteo</span>` : difEtq(x.conteo.dif_efectivo)}</td><td class="n"><b>${x.conteo.sobre != null ? dinero(x.conteo.sobre) : "—"}</b></td><td>${(folRet[x.dia + "|" + x.turno] || []).map(r => `<div><span class="folio-mc">${esc(r.folio || "")}</span> ${esc(r.concepto)} ${dinero(-r.monto)}</div>`).join("") || "—"}</td><td class="n">${x.conteo.cambio_sig != null ? dinero(x.conteo.cambio_sig) : "—"}</td></tr>`).join("")}
      </tbody></table></div>` : `<p class="note">No hay cortes entregados ${st.desde || st.hasta ? "en este periodo" : "este mes"}.</p>`}</section>`;
    c.querySelectorAll(".lnk-corte").forEach(b => b.addEventListener("click", () => { abrirCorte(b.dataset.k); }));
    const EST = { nueva: ["Se agrega", "ok"], reemplaza: ["Reemplaza la captura anterior", "ok"], tablet: ["Ya entregó en la tablet", "no"], vacia: ["Sin datos", "no"], fuera: ["Fuera del mes", "no"], repetida: ["Repetida", "no"] };
    const enviar = async aplicar => {
      const r = $("#c-imp-r"), t = $("#c-imp-t").value;
      if (!t.trim()) { r.innerHTML = `<p class="err">Pega la tabla primero.</p>`; return; }
      r.innerHTML = `<p class="note">${aplicar ? "Guardando…" : "Revisando…"}</p>`;
      let x;
      try { x = await api("caja/entregas-admin", { method: "POST", body: JSON.stringify({ texto: t, aplicar }) }); }
      catch (e) { if (e.message !== "sesion") r.innerHTML = `<p class="err">${esc(e.message)}</p>`; return; }
      if (aplicar) { toast(`Entregas guardadas: ${x.totales.turnos} turnos`); $("#c-imp-t").value = ""; await cargar(); return; }
      const T = x.totales;
      r.innerHTML = `<div class="ctot" style="margin:10px 0"><div class="k"><span>Turnos a guardar</span><b>${T.turnos}</b></div><div class="k dest"><span>Sobres</span><b>${dinero(T.sobre)}</b></div><div class="k"><span>Taxi</span><b>${dinero(T.taxi)}</b></div><div class="k"><span>Sueldos</span><b>${dinero(T.sueldo)}</b></div></div>
        ${x.errores.length ? `<p class="err">${x.errores.map(e => `Línea ${e.linea}: ${esc(e.error)} (${esc(e.texto)})`).join("<br>")}</p>` : ""}
        <div class="tabla-scroll" tabindex="0" role="region" aria-label="Revisión de entregas"><table class="cmovs cimp"><thead><tr><th>Turno</th><th class="n">Sobre</th><th>Retiros que se agregan</th><th class="n">Cambio dejó</th><th>Qué pasa</th></tr></thead><tbody>
        ${x.filas.map(f => `<tr class="${EST[f.estado][1] === "no" ? "no" : ""}"><td>${esc(diaTxt(f.dia))} · ${esc(TURNO_TXT[f.turno] || f.turno)}</td><td class="n">${f.sobre != null ? dinero(f.sobre) : "—"}</td><td>${f.retiros.map(r => `${esc(r.concepto)} ${dinero(r.monto)}`).join(", ") || "—"}</td><td class="n">${f.cambio != null ? dinero(f.cambio) : "—"}</td><td><b>${EST[f.estado][0]}</b>${f.avisos.length ? `<div class="note">${f.avisos.map(esc).join("<br>")}</div>` : ""}</td></tr>`).join("")}
        </tbody></table></div>
        ${T.turnos ? `<div class="row" style="margin-top:10px"><button class="btn btn-primary" type="button" id="c-imp-ok">Guardar ${T.turnos} ${T.turnos === 1 ? "entrega" : "entregas"}</button></div>` : ""}`;
      const ok = $("#c-imp-ok"); if (ok) ok.addEventListener("click", () => { ok.disabled = true; enviar(true); });
    };
    $("#c-imp-rev").addEventListener("click", () => enviar(false));
  }

  // ---- En curso: el turno abierto en la tablet y su corte hasta ahora ----
  function vistaCurso(j) {
    const a = turnoActual(), c = j.cortes.find(x => x.dia === a.dia && x.turno === a.turno);
    $("#c-curso").innerHTML = `<section class="card"><h3>Corte en curso · ${esc(TURNO_TXT[a.turno])} del ${esc(diaTxt(a.dia))}</h3>
      ${c ? `<div class="ctot" style="margin:8px 0"><div class="k"><span>Tickets en efectivo</span><b>${dinero(c.efectivo)}</b></div><div class="k"><span>Tickets con tarjeta</span><b>${dinero(c.tarjeta)}</b></div><div class="k"><span>Cambio inicial</span><b>${dinero(c.cambio.importe)}</b></div><div class="k"><span>Ingresos extra</span><b>${dinero(c.extra.importe)}</b></div><div class="k"><span>Gastos de caja</span><b>${dinero(c.gastos.EFECTIVO)}</b></div><div class="k dest"><span>Efectivo en caja</span><b>${dinero(c.efectivo_caja)}</b></div></div>
        <button class="btn btn-line" type="button" id="c-ver-curso">Ver el detalle del corte</button>` : `<p class="note">Todavía no hay registros en este turno.</p>`}</section>`;
    const v = $("#c-ver-curso"); if (v) v.addEventListener("click", () => abrirCorte(a.dia + "|" + a.turno));
    if (window.turnoVista) window.turnoVista("curso");
  }

  // ---- Bloques y periodo ----
  // Abre un corte en su bloque (desde movimientos, entregas o el turno en curso)
  function abrirCorte(k) { if (EC.irBloque) EC.irBloque("caja", "cortes", { suave: true }); abrir(k); }
  function cambiarVista(v) { if (EC.irBloque) EC.irBloque("caja", v === "encargados" ? null : v, { suave: true }); }
  window.turnosVista = v => cambiarVista(v);
  // Abrir un corte desde Hoy (dia|turno): cambia el periodo si el día no está en el que se ve
  window.cajaAbrirCorte = async k => {
    const dia = k.split("|")[0], hoy = hoyMx();
    if (window.irA) window.irA("caja", { historia: "push", vista: "cortes" });
    const fuera = st.desde || st.hasta ? (st.desde && dia < st.desde) || (st.hasta && dia > st.hasta) : dia.slice(0, 7) !== hoy.slice(0, 7);
    if (fuera) { st.desde = dia.slice(0, 7) === hoy.slice(0, 7) ? "" : dia; st.hasta = st.desde ? dia : ""; st.rapido = st.desde ? "" : "mes"; $("#c-desde").value = st.desde; $("#c-hasta").value = st.hasta; document.querySelectorAll("#c-rapidos .ptab").forEach(b => b.setAttribute("aria-selected", b.dataset.r === st.rapido ? "true" : "false")); }
    await cargar(); await abrir(k);
  };
  window.cajaAbrirPendiente = async (k, id) => {
    await window.cajaAbrirCorte(k);
    const el = [...document.querySelectorAll("#c-detalle [data-pendiente-id]")].find(x => x.dataset.pendienteId === id);
    if (el) { el.scrollIntoView({ behavior: "smooth", block: "center" }); el.style.outline = "2px solid var(--accent, #ffcc00)"; }
  };
  function periodo(desde, hasta, rapido) {
    st.desde = desde; st.hasta = hasta; st.rapido = rapido;
    $("#c-desde").value = desde; $("#c-hasta").value = hasta;
    document.querySelectorAll("#c-rapidos .ptab").forEach(b => b.setAttribute("aria-selected", b.dataset.r === rapido ? "true" : "false"));
    st.actual = null; $("#c-work").classList.remove("ver-detalle");
    $("#c-detalle").innerHTML = `<p class="empty">Elige un corte de turno.</p>`;
    cargar();
  }
  $("#c-rapidos").addEventListener("click", e => {
    const b = e.target.closest(".ptab[data-r]"); if (!b) return;
    const hoy = hoyMx();
    if (b.dataset.r === "hoy") periodo(hoy, hoy, "hoy");
    else if (b.dataset.r === "ayer") { const a = sumar(hoy, -1); periodo(a, a, "ayer"); }
    else if (b.dataset.r === "7") periodo(sumar(hoy, -6), hoy, "7");
    else periodo("", "", "mes");
  });
  for (const id of ["#c-desde", "#c-hasta"]) $(id).addEventListener("change", () => periodo($("#c-desde").value, $("#c-hasta").value, ""));
  $("#c-gasto").addEventListener("click", nuevoGasto);
  // Celular: el periodo se pliega en un botón
  $("#c-fil-btn").addEventListener("click", e => { const on = !$("#mod-caja").classList.contains("filtros-on"); $("#mod-caja").classList.toggle("filtros-on", on); e.currentTarget.setAttribute("aria-expanded", String(on)); });
  document.addEventListener("modulo", e => { if (e.detail === "caja") cargar(); });
  document.addEventListener("recargar-todo", async () => { if (!$("#mod-caja").hidden) { await cargar(); if (st.actual) abrir(st.actual); } });
  if (EC.ruta().mod === "caja") cargar();
  // Mientras la sección está abierta, se actualiza sola cada 5 minutos
  setInterval(() => { if (!$("#mod-caja").hidden && !document.hidden) cargar(); }, 300000);
})();
