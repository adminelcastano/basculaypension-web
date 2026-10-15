// ---- Hoy: lo que pide atención, el turno en curso y los números del día (una sola llamada: /panel/api/hoy) ----
(() => {
  const { $, esc, api } = EC;
  const D = v => EC.dinero(v, 2), D0 = v => EC.dinero(v, 0);
  const compacto = v => v >= 1000 ? "$" + (v / 1000).toLocaleString("es-MX", { maximumFractionDigits: 1 }) + "k" : "$" + Math.round(v);
  const fDia = new Intl.DateTimeFormat("es-MX", { weekday: "short", day: "numeric", timeZone: "UTC" });
  const fLargo = new Intl.DateTimeFormat("es-MX", { weekday: "long", day: "numeric", month: "long", timeZone: EC.TZ });
  const horaAhora = () => Number(new Intl.DateTimeFormat("en-US", { timeZone: EC.TZ, hour: "numeric", hour12: false }).format(new Date())) % 24;
  const st = { datos: null, cargando: false };

  function cabecera() {
    const h = horaAhora();
    $("#h-saludo").textContent = h < 12 ? "Buenos días." : h < 19 ? "Buenas tardes." : "Buenas noches.";
    const t = fLargo.format(new Date());
    $("#h-fecha").textContent = t.charAt(0).toUpperCase() + t.slice(1);
  }

  // Tocar una tarjeta lleva a donde se resuelve
  function ir(dest) {
    if (!dest || !window.irA) return;
    if (dest.corte && window.cajaAbrirCorte) return window.cajaAbrirCorte(dest.corte);
    if (dest.mod === "finanzas") return window.irA("finanzas", { historia: "push", vista: dest.vista || "resumen" });
    if (dest.tab && window.agendaAbrir && (dest.mod === "agenda" || dest.mod === "pagos")) return window.agendaAbrir(dest.tab);
    window.irA(dest.mod);
  }

  function pintarTurno(t) {
    const el = $("#h-turno");
    const ct = t.cambio_turno, malCambio = ct && Math.abs(ct.dif) >= 1;
    const sem = !t.encargado && !t.registros ? ["", "Sin abrir"] : malCambio ? ["mal", "Revisar cambio"] : t.encargado ? ["ok", "Abierto"] : ["esp", "Sin encargado en la tablet"];
    el.className = "hoy-turno " + (malCambio ? "mal" : t.encargado ? "ok" : "");
    el.innerHTML = `
      <div class="ht-cab">${t.encargado ? window.avP(t.encargado.clave, true) : ""}<div><b>Turno de la ${esc(t.txt)}</b><span>${t.encargado ? esc(t.encargado.nombre) + " está en la tablet" : "Nadie ha abierto el turno en la tablet"}</span></div><span class="ht-sem ${sem[0]}">${esc(sem[1])}</span></div>
      <div class="ht-big"><b>${D(t.en_caja ?? 0)}</b><span>debería haber en la caja</span></div>
      <div class="ht-filas">
        <div><span>Cambio inicial</span><b>${t.cambio_inicial != null ? D(t.cambio_inicial) : "—"}</b></div>
        <div><span>Ventas en efectivo</span><b>${D(t.efectivo)}</b></div>
        <div><span>Con tarjeta</span><b>${D(t.tarjeta)}</b></div>
        <div><span>Gastos de caja</span><b>${t.gastos ? "−" + D(t.gastos) : D(0)}</b></div>
      </div>
      ${malCambio ? `<p class="note" style="margin:0;color:var(--bad)">${esc(ct.de.persona)} dejó ${D(ct.dejado)} de cambio y ${esc(ct.recibio)} dijo recibir ${D(ct.recibido)}.</p>` : ""}
      <button class="btn btn-line ht-ir" type="button" id="h-ver-turno">Ver el corte en Caja ›</button>`;
    $("#h-ver-turno").addEventListener("click", () => window.cajaAbrirCorte ? window.cajaAbrirCorte(t.dia + "|" + t.turno) : window.irA && window.irA("caja"));
  }

  function pintarAtencion(l) {
    const el = $("#h-aten"), n = l.filter(x => x.nivel !== "info").length;
    $("#h-aten-n").textContent = n; $("#h-aten-n").hidden = !n;
    if (!l.length) { el.innerHTML = `<div class="vacio"><svg aria-hidden="true"><use href="#i-ok"/></svg><span>Todo en orden. No hay nada pendiente que requiera tu atención.</span></div>`; return; }
    el.innerHTML = l.map((x, i) => `<button type="button" class="at ${x.nivel}${x.ir ? "" : " sin-ir"}" data-i="${i}" ${x.ir ? "" : 'aria-disabled="true"'}>
      <span class="pt" aria-hidden="true"></span><span class="tt">${esc(x.titulo)}</span>
      ${x.ir ? '<svg class="chev" aria-hidden="true"><use href="#i-chev"/></svg>' : "<span></span>"}
      ${x.detalle ? `<span class="dd">${esc(x.detalle)}</span>` : ""}
      <span class="sr">${x.nivel === "alta" ? "Urgente" : x.nivel === "media" ? "Pronto" : "Para saber"}</span></button>`).join("");
    el.querySelectorAll(".at").forEach(b => b.addEventListener("click", () => ir(l[b.dataset.i].ir)));
  }

  function pintarNumeros(n, semana, hoy) {
    const max = Math.max(1, ...semana.map(x => x.ingresos));
    $("#h-num").innerHTML = `<h3>Ingresos de hoy <button type="button" data-ir="caja">Caja ›</button></h3>
      <div class="hn-big">${D(n.ingresos)}</div>
      <div class="hn-chips"><span>Efectivo ${D0(n.efectivo)}</span><span>Tarjeta ${D0(n.tarjeta)}</span>${n.transferencias ? `<span>Transferencia ${D0(n.transferencias)}</span>` : ""}${n.rentas ? `<span>Rentas ${D0(n.rentas)}</span>` : ""}<span>Gastos de caja ${D0(n.gastos)}</span></div>
      <div class="hn-sem" role="img" aria-label="Ingresos de los últimos 7 días">${semana.map(x => `<div class="${x.dia === hoy ? "hn-hoy" : ""}" title="${esc(fDia.format(new Date(x.dia + "T12:00:00Z")))}: ${esc(D(x.ingresos))}"><i style="height:${Math.max(3, Math.round(80 * x.ingresos / max))}px"></i><b>${x.ingresos ? compacto(x.ingresos) : "—"}</b><small>${esc(fDia.format(new Date(x.dia + "T12:00:00Z")).split(" ")[0])}</small></div>`).join("")}</div>`;
  }

  function pintarMes(m) {
    const el = $("#h-mes");
    if (!m) { el.innerHTML = `<h3>Este mes</h3><p class="note">No se pudo leer Dinero.</p>`; return; }
    const nom = new Date(m.mes + "-15T12:00:00Z").toLocaleDateString("es-MX", { month: "long", timeZone: "UTC" });
    el.innerHTML = `<h3>${esc(nom.charAt(0).toUpperCase() + nom.slice(1))} <button type="button" data-vista="resumen">Dinero ›</button></h3>
      <div class="hm">
        <button type="button" data-vista="resumen"><span>Entró</span><b class="verde">${D0(m.entro)}</b></button>
        <button type="button" data-vista="resumen"><span>Salió</span><b class="rojo">${D0(m.salio)}</b></button>
        <button type="button" data-vista="resumen"><span>Resultado</span><b>${D0(m.resultado)}</b></button>
        <button type="button" data-vista="cuentas"><span>Efectivo en sobres</span><b>${m.sobres != null ? D0(m.sobres) : "—"}</b><small>${m.sobres == null ? "falta el saldo de partida" : m.sobres_calculado ? "calculado" : "contado este mes"}</small></button>
        ${m.dinero != null ? `<button type="button" data-vista="cuentas"><span>En cuentas</span><b>${D0(m.dinero)}</b></button>` : ""}
        ${m.deuda != null ? `<button type="button" data-vista="cuentas"><span>Deuda en tarjetas</span><b class="rojo">${D0(m.deuda)}</b></button>` : ""}
      </div>`;
  }

  function pintarProximos(l, hoy) {
    const el = $("#h-prox");
    const f = d => d === hoy ? "hoy" : fDia.format(new Date(d + "T12:00:00Z"));
    el.innerHTML = `<h3>Próximo <button type="button" data-ir="agenda">Agenda ›</button></h3>
      ${l.length ? `<div class="hp">${l.map(x => `<div><span class="f">${esc(f(x.fecha))}${x.hora ? "<br>" + esc(x.hora) : ""}</span><span class="t">${x.tipo === "pago" ? "Pago: " : ""}${esc(x.titulo)}</span><span class="i">${x.importe ? D0(x.importe) : ""}</span></div>`).join("")}</div>` : `<p class="note">Sin eventos ni pagos próximos.</p>`}`;
  }

  async function cargar() {
    if (st.cargando) return; st.cargando = true;
    cabecera();
    try {
      const j = await api("hoy");
      st.datos = j;
      pintarTurno(j.turno);
      pintarAtencion(j.atencion);
      pintarNumeros(j.numeros, j.semana, j.turno.dia);
      pintarMes(j.mes);
      pintarProximos(j.proximos, j.turno.dia);
      $("#h-pie").textContent = `Actualizado ${new Date(j.generado).toLocaleTimeString("es-MX", { hour: "numeric", minute: "2-digit", timeZone: EC.TZ })}${(j.fallas || []).length ? " · no se pudo leer: " + j.fallas.join(", ") : ""}`;
    } catch (e) {
      if (e.message !== "sesion") $("#h-aten").innerHTML = `<p class="note">No se pudo cargar: ${esc(e.message)}</p>`;
    } finally { st.cargando = false; }
  }

  // Enlaces de las tarjetas (Caja ›, Dinero ›, Agenda ›)
  $("#mod-inicio").addEventListener("click", e => {
    const v = e.target.closest("[data-vista]"); if (v) return window.irA && window.irA("finanzas", { historia: "push", vista: v.dataset.vista });
    const b = e.target.closest("[data-ir]"); if (b && window.irA) window.irA(b.dataset.ir);
  });
  // Registrar: abre el formulario en su sección
  document.querySelectorAll("#mod-inicio [data-accion]").forEach(b => b.addEventListener("click", () => {
    const a = b.dataset.accion;
    if (a === "gasto") { window.irA && window.irA("caja"); setTimeout(() => { const x = document.getElementById("c-gasto"); x && x.click(); }, 300); }
    else if (a === "transf") window.finanzasAbrir && window.finanzasAbrir("transf");
    else if (a === "pagohecho") window.agendaAbrir && window.agendaAbrir("hechos", "hecho");
    else if (a === "programar") window.agendaAbrir && window.agendaAbrir("pago", "programar");
    else window.agendaAbrir && window.agendaAbrir(a === "evento" ? "calendario" : a);
  }));

  document.addEventListener("modulo", e => { if (e.detail === "inicio") cargar(); });
  document.addEventListener("recargar-todo", () => { if (!$("#mod-inicio").hidden) cargar(); });
  if (EC.ruta().mod === "inicio") cargar();
  // Solo se actualiza mientras Hoy está a la vista (cada 2 minutos)
  setInterval(() => { if (!$("#mod-inicio").hidden && !document.hidden) cargar(); }, 120000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden && !$("#mod-inicio").hidden && st.datos && Date.now() - new Date(st.datos.generado) > 120000) cargar(); });
})();
