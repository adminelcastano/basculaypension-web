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

  async function cargar() {
    const lista = $("#c-lista");
    try {
      const j = await api("caja" + consulta());
      st.datos = j;
      if (j.categorias) window.ponerCategorias(j.categorias);
      if (j.cuentas) window.CUENTAS = j.cuentas;
      $("#c-nmovs").textContent = (j.movimientos || []).length;
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
      if (st.vista === "movs") { vistaMovs(j); return; }
      if (st.vista === "entregas") { vistaEntregas(j); return; }
      if (st.vista === "curso") { vistaCurso(j); return; }
      if (st.vista === "encargados") return;
      if (!j.cortes.length) { lista.innerHTML = `<p class="empty">${j.conectado ? "Todavía no hay registros este mes." : "Conecta la hoja de Google para ver los ingresos."}</p>`; return; }
      const fila = c => {
        const es = c.dia === ahora.dia && c.turno === ahora.turno;
        return `<button class="item citem" data-k="${esc(clave(c))}" ${st.actual === clave(c) ? 'aria-current="true"' : ""}>
          <svg class="chev" aria-hidden="true"><use href="#i-chev"/></svg>
          <span class="svc ambos" aria-hidden="true" style="font-weight:700;font-size:var(--t-md)">${esc((TURNO_TXT[c.turno] || c.turno).slice(0, 1))}</span>
          <span class="t">${esc(TURNO_TXT[c.turno] || c.turno)}${es ? ` <span class="cturno ahora">en curso</span>` : ""}</span>
          <span class="m"><span>Efectivo ${dinero(c.efectivo)}</span><span>Tarjeta ${dinero(c.tarjeta)}</span></span>
          <span class="m"><span>${c.n_gastos ? `Gastos ${dinero(c.gastos_total)}` : "Sin gastos"}</span><span>En caja ${dinero(c.efectivo_caja)}</span></span>
          ${c.conteo ? `<span class="m"><span>Contó ${avP(c.conteo.persona)}${esc(c.conteo.persona)} ${dinero(c.conteo.efectivo)}</span>${difEtq(c.conteo.dif_efectivo)}</span>` : ""}
          ${c.cambio_turno && Math.abs(c.cambio_turno.dif) >= 1 ? `<span class="m"><span>Cambio recibido</span>${difEtq(c.cambio_turno.dif)}</span>` : ""}
        </button>`;
      };
      // Un grupo por día, con el total de ingresos del día en el encabezado
      const grupos = [];
      for (const c of j.cortes) { const g = grupos[grupos.length - 1]; if (g && g.dia === c.dia) g.cs.push(c); else grupos.push({ dia: c.dia, cs: [c] }); }
      lista.innerHTML = grupos.map(g => `<div class="cgrupo"><h3 class="cdia"><span>${esc(diaTxt(g.dia))}</span><span>${dinero(g.cs.reduce((t, c) => t + (c.efectivo || 0) + (c.tarjeta || 0), 0))}</span></h3>${g.cs.map(fila).join("")}</div>`).join("");
    } catch (e) { if (e.message !== "sesion") lista.innerHTML = `<p class="empty">No se pudo cargar: ${esc(e.message)}</p>`; }
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
        if (st.vista !== "cortes") cambiarVista("cortes", false);
        await cargar();
        abrir(cuerpo.dia + "|" + cuerpo.turno);
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
          <section class="card"><h3>Corte</h3>
            <div class="cres">
              <span class="h">Ingresos</span><span class="h">Efectivo</span><span class="h">Tarjeta</span>
              ${fila("Báscula", dinero(c.bascula.EFECTIVO), dinero(c.bascula.TARJETA))}
              ${fila("Pensión", dinero(c.pension.EFECTIVO), dinero(c.pension.TARJETA))}
              ${fila("Total", dinero(c.efectivo), dinero(c.tarjeta), "tot")}
              ${c.cambio && c.cambio.n ? fila(c.cambio.fuente === "tablet" ? `Cambio inicial (${avP(c.cambio.persona)}${esc(c.cambio.persona)}, tablet)` : "Cambio inicial", "+" + dinero(c.cambio.importe), "") : ""}
              ${c.extra && c.extra.n ? fila(`Ingresos extra (${c.extra.n})`, "+" + dinero(c.extra.importe), "") : ""}
              ${fila("Gastos de caja", c.gastos.EFECTIVO ? "−" + dinero(c.gastos.EFECTIVO) : dinero(0), c.gastos.TARJETA ? "−" + dinero(c.gastos.TARJETA) : dinero(0))}
              ${c.caja.n ? fila(`Renglones de caja de la hoja (${c.caja.n})`, dinero(c.caja.importe), "") : ""}
              <span class="fin">Efectivo en caja</span><span class="n fin">${dinero(c.efectivo_caja)}</span><span class="fin"></span>
            </div>
            ${c.conteo ? `<div class="conteo"><h4>Corte ciego de la tablet</h4>
              <div class="cres">
                <span class="h">Entregó ${avP(c.conteo.persona)}${esc(c.conteo.persona)}</span><span class="h">Efectivo</span><span class="h">Tarjeta</span>
                ${fila("Contado", dinero(c.conteo.efectivo), c.conteo.tarjeta != null ? dinero(c.conteo.tarjeta) : "—")}
                ${fila(!c.conteo.con_cambio && c.cambio && c.cambio.n ? "Según el sistema (sin cambio)" : "Según el sistema", dinero(c.conteo.esperado ?? c.efectivo_caja), dinero(c.tarjeta))}
                <span class="fin">Diferencia</span><span class="n">${difEtq(c.conteo.dif_efectivo)}</span><span class="n">${c.conteo.dif_tarjeta != null ? difEtq(c.conteo.dif_tarjeta) : ""}</span>
              </div>
              ${c.conteo.sobre != null ? `<h4 style="margin-top:14px">Reparto del efectivo (informe final)</h4>
              <div class="cres">
                ${fila("Efectivo en sobre", dinero(c.conteo.sobre || 0), "")}
                ${(c.conteo.retiros || []).map((r, i) => fila(`${(j.folios_retiros || [])[i] ? `<span class="folio-mc">${esc(j.folios_retiros[i])}</span> ` : ""}Retiro: ${esc(r.concepto)}`, dinero(r.monto), "")).join("")}
                ${fila("Cambio para el siguiente turno", dinero(c.conteo.cambio_sig || 0), "")}
                ${(() => { const rep = (c.conteo.sobre || 0) + (c.conteo.retiros || []).reduce((x, r) => x + r.monto, 0) + (c.conteo.cambio_sig || 0), d = Math.round((c.conteo.efectivo - rep) * 100) / 100; return `<span class="fin">Repartido</span><span class="n fin">${dinero(rep)}</span><span class="n">${Math.abs(d) < 0.01 ? "✓ cuadra" : d > 0 ? "faltan " + dinero(d) : "sobran " + dinero(-d)}</span>`; })()}
              </div>` : ""}
              ${c.cambio_turno || c.cambio_siguiente ? `<h4 style="margin-top:14px">Cambio entre turnos</h4><div class="cres">
                <span class="h"></span><span class="h">Dejó</span><span class="h">Recibió</span>
                ${c.cambio_turno ? fila(`Del turno anterior (${avP(c.cambio_turno.de.persona)}${esc(c.cambio_turno.de.persona)} → ${avP(c.cambio_turno.recibio)}${esc(c.cambio_turno.recibio)})`, dinero(c.cambio_turno.dejado), dinero(c.cambio_turno.recibido)) + `<span class="fin">Diferencia</span><span class="n"></span><span class="n">${difEtq(c.cambio_turno.dif)}</span>` : ""}
                ${c.cambio_siguiente ? fila(`Al turno siguiente (→ ${avP(c.cambio_siguiente.recibio)}${esc(c.cambio_siguiente.recibio)})`, dinero(c.cambio_siguiente.dejado), dinero(c.cambio_siguiente.recibido)) + `<span class="fin">Diferencia</span><span class="n"></span><span class="n">${difEtq(c.cambio_siguiente.dif)}</span>` : ""}
              </div><p class="note">Si el cambio que declara quien entra no es el que dejó quien sale, la diferencia cuenta como faltante o sobrante en Dinero.</p>` : ""}
              ${(j.historial || []).length > 1 ? `<details style="margin-top:10px"><summary class="note" style="cursor:pointer;font-weight:600">Entregas y correcciones (${j.historial.length})</summary>
                <div class="tabla-scroll" tabindex="0" role="region" aria-label="Historial del corte"><table class="cmovs"><thead><tr><th>Hora</th><th>Quién</th><th class="n">Efectivo</th><th class="n">Sobre</th><th class="n">Retiros</th><th class="n">Cambio sig.</th></tr></thead><tbody>
                ${j.historial.map(x => `<tr><td>${esc(new Date(x.creado).toLocaleString("es-MX", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "America/Mexico_City" }))}</td><td>${avP(x.persona)}${esc(x.persona)}</td><td class="n">${dinero(x.efectivo || 0)}</td><td class="n">${dinero(x.sobre || 0)}</td><td class="n">${dinero((x.retiros || []).reduce((a, r) => a + r.monto, 0))}</td><td class="n">${dinero(x.cambio_sig || 0)}</td></tr>`).join("")}
                </tbody></table></div></details>` : ""}
              <p class="note">${esc(fechaHora(c.conteo.actualizado))}${c.conteo.veces > 1 ? ` · corregido ${c.conteo.veces - 1} ${c.conteo.veces === 2 ? "vez" : "veces"}` : ""}${c.conteo.notas ? " · " + esc(c.conteo.notas) : ""}</p>
              <p class="note">Si el turno sigue abierto o la hoja no se ha sincronizado, la diferencia puede cambiar.</p></div>` : ""}
            ${c.fuera.n ? `<p class="note">No suman al corte: ${c.fuera.n} registros (${esc(fuera)}).</p>` : ""}
            ${c.caja.n ? `<p class="note">Renglones de caja de la hoja: registros sin folio de ticket (retiros, sueldos o compras). Llevan folio de movimiento y no cuentan como ingresos.</p>` : ""}
            ${c.cambio && c.cambio.n ? `<p class="note">El cambio inicial se suma al efectivo en caja y no cuenta como ingreso.${c.conteo && !c.conteo.con_cambio ? " Este corte se contó sin el fondo de cambio (antes del 14 oct), así que se compara sin él." : ""}</p>` : ""}
            ${c.extra && c.extra.n ? `<p class="note">Ingresos extra: rentas y otros ingresos suman a la caja y a los ingresos${c.extra.importe - c.extra.ingreso ? `; el aumento de cambio (${dinero(c.extra.importe - c.extra.ingreso)}) solo suma a la caja` : ""}.</p>` : ""}
            ${c.gastos.TRANSFERENCIA ? `<p class="note">Gastos por transferencia: ${dinero(c.gastos.TRANSFERENCIA)} (no salen de la caja).</p>` : ""}
          </section>
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
        <section class="card" style="min-width:0"><h3>Registros de la hoja</h3>
          ${j.movs.length ? `<div class="tabla-scroll" tabindex="0" role="region" aria-label="Registros de la hoja"><table class="cmovs"><thead><tr><th><span class="sr">Servicio</span></th><th>Hora</th><th>Folio</th><th>Matrícula</th><th>Cliente</th><th>Forma</th><th class="n">Importe</th></tr></thead><tbody>
            ${j.movs.map(m => `<tr class="${m.tipo === "caja" ? "mov" : j.formas_contadas.includes(m.forma) ? "" : "no"}"><td>${icono(m.servicio)}</td><td>${esc(hora(m.fecha))}</td><td>${m.folio_mc ? `<span class="folio-mc">${esc(m.folio_mc)}</span> ` : ""}${esc(m.folio)}</td><td>${esc(m.matricula)}</td><td>${esc(m.cliente)}</td><td>${esc(m.tipo === "caja" ? "caja" : m.forma.toLowerCase())}</td><td class="n">${dinero(m.importe)}</td></tr>`).join("")}
          </tbody></table></div><p class="note">En gris: no suman al corte (prepago, transferencia u otros). En cursiva: renglones de caja (con su folio de movimiento MC).</p>` : `<p class="note">No hay registros de la hoja en este turno.</p>`}
        </section>
      </div>`;
    $("#c-volver").addEventListener("click", () => { $("#c-work").classList.remove("ver-detalle"); st.actual = null; });
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
    const c = $("#c-curso"), ms = j.movimientos || [];
    $("#t-cuerpo").innerHTML = "";
    const filtro = st.filtroMov || "";
    const lista = ms.filter(m => !filtro || m.tipo === filtro);
    const suma = t => ms.filter(m => m.tipo === t).reduce((a, m) => a + m.monto, 0);
    c.innerHTML = `<section class="card"><h3>Movimientos de caja</h3>
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
    c.querySelectorAll(".lnk-corte").forEach(b => b.addEventListener("click", () => { cambiarVista("cortes", false); cargar().then(() => abrir(b.dataset.k)); }));
  }

  // ---- Entregas: lo que cada turno entregó en el corte ciego ----
  function vistaEntregas(j) {
    const c = $("#c-curso"); $("#t-cuerpo").innerHTML = "";
    const cs = j.cortes.filter(x => x.conteo);
    const folRet = {}; for (const m of j.movimientos || []) if (m.tipo === "retiro") (folRet[m.dia + "|" + m.turno] = folRet[m.dia + "|" + m.turno] || []).push(m);
    const tot = k => cs.reduce((a, x) => a + (k === "retiros" ? (x.conteo.retiros || []).reduce((y, r) => y + r.monto, 0) : x.conteo[k] || 0), 0);
    c.innerHTML = `<section class="card"><h3>Entregas de los turnos</h3>
      <p class="note" style="margin:4px 0 10px">Lo que cada encargado contó y cómo lo repartió al entregar el corte: el sobre para la administración (cuenta como efectivo recibido en Dinero), los retiros y el cambio que dejó al siguiente turno.</p>
      <div class="ctot" style="margin:0 0 10px"><div class="k dest"><span>Sobres</span><b>${dinero(tot("sobre"))}</b></div><div class="k"><span>Retiros</span><b>${dinero(tot("retiros"))}</b></div><div class="k"><span>Cortes entregados</span><b>${cs.length}</b></div></div>
      ${cs.length ? `<div class="tabla-scroll" tabindex="0" role="region" aria-label="Entregas"><table class="tcortes"><thead><tr><th>Corte</th><th>Entregó</th><th class="n">Contado</th><th>Diferencia</th><th class="n">Sobre</th><th>Retiros</th><th class="n">Cambio sig.</th></tr></thead><tbody>
        ${cs.map(x => `<tr><td><button type="button" class="lnk-corte" data-k="${esc(x.dia + "|" + x.turno)}">${esc(diaTxt(x.dia))} · ${esc(TURNO_TXT[x.turno] || x.turno)}</button></td><td>${avP(x.conteo.persona)}${esc(x.conteo.persona)}</td><td class="n">${dinero(x.conteo.efectivo)}</td><td>${difEtq(x.conteo.dif_efectivo)}</td><td class="n"><b>${x.conteo.sobre != null ? dinero(x.conteo.sobre) : "—"}</b></td><td>${(folRet[x.dia + "|" + x.turno] || []).map(r => `<div><span class="folio-mc">${esc(r.folio || "")}</span> ${esc(r.concepto)} ${dinero(-r.monto)}</div>`).join("") || "—"}</td><td class="n">${x.conteo.cambio_sig != null ? dinero(x.conteo.cambio_sig) : "—"}</td></tr>`).join("")}
      </tbody></table></div>` : `<p class="note">No hay cortes entregados ${st.desde || st.hasta ? "en este periodo" : "este mes"}.</p>`}</section>`;
    c.querySelectorAll(".lnk-corte").forEach(b => b.addEventListener("click", () => { cambiarVista("cortes", false); cargar().then(() => abrir(b.dataset.k)); }));
  }

  // ---- En curso: el turno abierto en la tablet y su corte hasta ahora ----
  function vistaCurso(j) {
    const a = turnoActual(), c = j.cortes.find(x => x.dia === a.dia && x.turno === a.turno);
    $("#c-curso").innerHTML = `<section class="card"><h3>Corte en curso · ${esc(TURNO_TXT[a.turno])} del ${esc(diaTxt(a.dia))}</h3>
      ${c ? `<div class="ctot" style="margin:8px 0"><div class="k"><span>Tickets en efectivo</span><b>${dinero(c.efectivo)}</b></div><div class="k"><span>Tickets con tarjeta</span><b>${dinero(c.tarjeta)}</b></div><div class="k"><span>Cambio inicial</span><b>${dinero(c.cambio.importe)}</b></div><div class="k"><span>Ingresos extra</span><b>${dinero(c.extra.importe)}</b></div><div class="k"><span>Gastos de caja</span><b>${dinero(c.gastos.EFECTIVO)}</b></div><div class="k dest"><span>Efectivo en caja</span><b>${dinero(c.efectivo_caja)}</b></div></div>
        <button class="btn btn-line" type="button" id="c-ver-curso">Ver el detalle del corte</button>` : `<p class="note">Todavía no hay registros en este turno.</p>`}</section>`;
    const v = $("#c-ver-curso"); if (v) v.addEventListener("click", () => { cambiarVista("cortes", false); cargar().then(() => abrir(a.dia + "|" + a.turno)); });
    if (window.turnoVista) window.turnoVista("curso");
  }

  // ---- Vistas y periodo ----
  function cambiarVista(v, recargar = true) {
    st.vista = v; st.actual = null;
    document.querySelectorAll("#c-vistas .ptab").forEach(b => b.setAttribute("aria-selected", b.dataset.v === v ? "true" : "false"));
    $("#c-detalle").innerHTML = `<p class="empty">Elige un corte de turno.</p>`;
    $("#c-work").classList.remove("ver-detalle");
    const lista = v === "cortes";
    $("#c-work").hidden = !lista; $("#c-full").hidden = lista;
    $("#c-per").hidden = $("#c-totales").hidden = v === "curso" || v === "encargados";
    $("#c-gasto").hidden = v === "encargados";
    $("#c-curso").innerHTML = ""; $("#t-cuerpo").innerHTML = "";
    if (v === "encargados" && window.turnoVista) window.turnoVista("encargados");
    if (recargar && v !== "encargados") cargar();
  }
  window.turnosVista = v => cambiarVista(v);
  $("#c-vistas").addEventListener("click", e => { const b = e.target.closest(".ptab[data-v]"); if (b) cambiarVista(b.dataset.v); });
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
  document.addEventListener("modulo", e => { if (e.detail === "caja") { if (st.vista === "encargados") window.turnoVista && window.turnoVista("encargados"); else cargar(); } });
  document.addEventListener("recargar-todo", async () => { if (!$("#mod-caja").hidden) { if (st.vista === "encargados") { window.turnoVista && window.turnoVista("encargados"); return; } await cargar(); if (st.actual) abrir(st.actual); } });
  if (EC.ruta().mod === "caja") cargar();
  // Mientras la sección está abierta, se actualiza sola cada 5 minutos
  setInterval(() => { if (!$("#mod-caja").hidden && !document.hidden) cargar(); }, 300000);
})();
