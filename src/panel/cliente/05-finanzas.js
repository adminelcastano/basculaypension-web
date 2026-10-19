// ---- Finanzas: turnos + administración, efectivo en sobres, banco, transferencias de clientes y reportes ----
(() => {
  const $ = q => document.querySelector(q);
  const esc = EC.esc;
  const D = v => (v < 0 ? "−" : "") + "$" + Math.abs(Number(v) || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  // Aviso preventivo: una segunda operación idéntica con UID nuevo es otro
  // movimiento real. Advertirlo sin bloquear traspasos legítimos repetidos.
  const mismoMovimiento = (a, b) => a.tipo === b.tipo && a.fecha === b.fecha &&
    a.origen === b.origen && a.destino === b.destino &&
    Math.round(Number(a.importe) * 100) === Math.round(Number(b.importe) * 100);
  const fDia = new Intl.DateTimeFormat("es-MX", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
  const diaTxt = d => fDia.format(new Date(d + "T12:00:00Z"));
  const nomMes = m => { const t = new Date(m + "-15T12:00:00Z").toLocaleDateString("es-MX", { month: "long", year: "numeric", timeZone: "UTC" }); return t.charAt(0).toUpperCase() + t.slice(1); };
  const toast = EC.toast;
  const api = EC.api;
  const post = EC.post;
  const CAT = { caja: "Gastos de caja (turnos)", retiros: "Retiros del corte (taxi, compras, sueldos)", programado: "Pagos programados", no_programado: "Pagos no programados", compra: "Compras", otro: "Otros gastos", comision: "Comisión de tarjeta (Mercado Pago)", faltantes: "Faltantes de caja" };
  const CAT1 = { programado: "Pago programado", no_programado: "Pago no programado", compra: "Compra", otro: "Otro gasto", sobre: "Sobre recibido", llevo: "Tomado de la caja", cambio: "Puesto en la caja", deposito: "Depósito al banco", retiro: "Retiro del banco", pago_tarjeta: "Pago de tarjeta", traspaso: "Traspaso" };
  const FORMA = { EFECTIVO: "Sobres", TRANSFERENCIA: "Banco · transferencia", TARJETA: "Banco · tarjeta" };
  const TURNO_TXT = { "MAÑANA": "mañana", TARDE: "tarde", NOCHE: "noche" };
  const SVC = { bascula: "Báscula", pension: "Pensión" };
  const hoyMx = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(new Date());
  const cuando = iso => new Date(iso).toLocaleString("es-MX", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "America/Mexico_City" });
  const st = { mes: "", datos: null, cargarRep: null };

  let secuenciaDinero = 0;
  async function cargar() {
    const solicitud = ++secuenciaDinero;
    const c = $("#fb-resumen");
    try {
      const j = await api("finanzas" + (st.mes ? "?mes=" + st.mes : ""));
      if (solicitud !== secuenciaDinero) return;
      st.datos = j; st.mes = j.mes;
      try { pintarConfigCuentas(); } catch (er) { console.error(er); }
      if (j.cuentas_activas) window.CUENTAS = j.cuentas_activas;
      const sel = $("#f-mes");
      if (!sel.options.length) sel.innerHTML = j.meses.map((m, i) => `<option value="${m}">${esc(nomMes(m))}${i === 0 ? " (en curso)" : ""}</option>`).join("");
      sel.value = j.mes;
      pintar();
      if (st.foco === "transf") { st.foco = null; const el = $("#f-ftransf"); if (el) { el.scrollIntoView({ behavior: "smooth", block: "center" }); el.cliente.focus(); } }
    } catch (e) { if (solicitud === secuenciaDinero && e.message !== "sesion") c.innerHTML = `<p class="empty">No se pudo cargar: ${esc(e.message)}</p>`; }
  }

  function graf(porDia) {
    if (!porDia.length) return `<p class="note">Sin movimientos este mes.</p>`;
    const W = Math.max(300, Math.min(1200, ($("#f-cuerpo").clientWidth || 720) - 90)), H = 200, izq = 46, abajo = 22, arr = 10, max = Math.max(1, ...porDia.map(d => Math.max(d.ingresos, d.egresos)));
    const banda = (W - izq - 6) / porDia.length, ancho = Math.max(2, Math.min(10, banda * 0.36));
    const y = v => arr + (H - arr - abajo) * (1 - v / max);
    const comp = v => v >= 1000 ? "$" + (v / 1000).toLocaleString("es-MX", { maximumFractionDigits: 1 }) + "k" : "$" + Math.round(v);
    let g = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Ingresos y egresos por día">`;
    for (const k of [0, .5, 1]) g += `<line x1="${izq}" x2="${W - 6}" y1="${y(max * k)}" y2="${y(max * k)}" stroke="#2c2c2e"/><text x="${izq - 6}" y="${y(max * k) + 4}" text-anchor="end" fill="#8e8e93" font-size="11">${comp(max * k)}</text>`;
    porDia.forEach((d, i) => {
      const cx = izq + banda * i + banda / 2;
      g += `<g><title>${esc(diaTxt(d.dia))}: entró ${D(d.ingresos)}, salió ${D(d.egresos)}</title><rect x="${cx - ancho - 1}" y="${y(d.ingresos)}" width="${ancho}" height="${Math.max(0, y(0) - y(d.ingresos))}" rx="2" fill="#30d158"/><rect x="${cx + 1}" y="${y(d.egresos)}" width="${ancho}" height="${Math.max(0, y(0) - y(d.egresos))}" rx="2" fill="#ff7a70"/>`;
      if (porDia.length <= 16 || i % 3 === 0) g += `<text x="${cx}" y="${H - 6}" text-anchor="middle" fill="#8e8e93" font-size="11">${Number(d.dia.slice(8))}</text>`;
      g += `</g>`;
    });
    return g + `</svg><div class="leyenda" aria-hidden="true"><span><i class="sw" style="background:#30d158"></i>Entró</span><span><i class="sw" style="background:#ff7a70"></i>Salió</span></div>`;
  }

  // Saldo inicial: contado (capturado) o calculado del mes anterior, con el ajuste si hay los dos
  const origenSaldo = x => x.inicial == null ? `<span class="note" style="color:var(--warn)">sin saldo</span>` : x.capturado ? `<span class="note">contado${x.ajuste ? ` · ajuste <b style="color:${x.ajuste < 0 ? "#ff8a80" : "#7ee2a0"}">${D(x.ajuste)}</b>` : x.calculado != null ? " · cuadra con lo calculado" : ""}</span>` : `<span class="note">calculado del mes anterior</span>`;

  // ---- Administrar cuentas (vive en Configuración): usos, nombre, tipo, comisión, nuevas y notas ----
  function adminCuentas(b) {
    return `<p class="note" style="margin:0">Las cuentas de banco y tarjetas de la administración. Los saldos y traspasos de cada mes siguen en Dinero → Cuentas y sobres.</p>
          ${(() => {
            // Para qué se usa cada cuenta: una misma cuenta puede tener los tres usos a la vez
            const deb = (b.lista || []).filter(c => c.tipo !== "credito" && c.activa);
            const uso = (k, txt, ayuda) => `<label class="cuso"><span>${txt}<small>${ayuda}</small></span><select data-cuso="${k}" aria-label="${esc(txt)}">${(b.lista || []).some(c => c[k]) ? "" : `<option value="">Elige…</option>`}${deb.map(c => `<option value="${esc(c.id)}" ${c[k] ? "selected" : ""}>${esc(c.nombre)}</option>`).join("")}</select></label>`;
            return `<div class="cusos">${uso("def_pago", "Pagos y compras", "cuenta que se propone al pagar con transferencia o débito")}${uso("def_transf", "Transferencias de clientes", "a dónde llegan por defecto")}${uso("tarjeta", "Cobros con tarjeta", "a dónde entran los cobros de la terminal")}</div>
              <p class="note" style="margin:4px 0 0">Puedes elegir la misma cuenta en los tres. Al registrar cada movimiento puedes cambiar la cuenta. Si una cuenta tiene cobros históricos, el servidor protegerá su asignación y explicará cómo corregirla.</p>`;
          })()}
          <div class="alist" style="margin-top:8px">${(b.lista || []).map(c => `<div class="aitem cfila" style="opacity:${c.activa ? 1 : .55}"><form class="cnom" data-cnom="${esc(c.id)}"><input name="nombre" value="${esc(c.nombre)}" maxlength="40" aria-label="Nombre de la cuenta" autocomplete="off"><button class="btn btn-line" type="submit">Guardar</button></form><span class="acc" style="flex-wrap:wrap"><select data-ctipo="${esc(c.id)}" aria-label="Tipo de ${esc(c.nombre)}"><option value="debito" ${c.tipo !== "credito" ? "selected" : ""}>Débito</option><option value="credito" ${c.tipo === "credito" ? "selected" : ""}>Crédito</option></select><button class="btn btn-line" type="button" data-cact="${esc(c.id)}" data-v="${c.activa ? 0 : 1}" style="min-height:34px;padding:0 10px">${c.activa ? "Ocultar" : "Mostrar"}</button></span>
            <span class="mm">${[c.def_pago ? "Pagos y compras" : "", c.def_transf ? "Transferencias de clientes" : "", c.tarjeta ? "Cobros con tarjeta" : ""].filter(Boolean).map(t => `<span class="cat-chip">${t}</span>`).join("")}</span>
            ${c.tarjeta ? `<span class="note" style="flex-basis:100%;margin-top:6px">Comisión Mercado Pago: 3.50 % + IVA (tasa histórica fija por cobro).</span>` : ""}</div>`).join("")}</div>
          <form class="aform" id="f-cnueva" style="margin-top:10px"><label class="w2">Nueva cuenta<input name="nombre" maxlength="40" placeholder="Ej. SANTANDER" autocomplete="off"></label><label>Tipo<select name="tipo"><option value="debito">Débito</option><option value="credito">Crédito</option></select></label><button class="btn btn-primary" type="submit">Agregar</button><span class="err"></span></form>
          <form id="f-cuentas" novalidate style="margin-top:12px"><label class="fcuentas">Notas de las cuentas <span class="ayuda">(terminaciones, CLABE, para qué se usa…)</span><textarea name="texto" rows="3" maxlength="4000">${esc(b.cuentas)}</textarea></label>
            <div class="row" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:8px"><button class="btn btn-line" type="submit">Guardar notas</button><span class="err"></span></div></form>
`;
  }
  function pintarConfigCuentas() {
    const m = $("#mod-config"), c = $("#cfg-cuentas-c");
    if (!m || m.hidden || !c || !st.datos) return;
    c.innerHTML = adminCuentas(st.datos.banco);
    const act = (st.datos.banco.lista || []).filter(x => x.activa).length;
    EC.bloqueInfo("config", "cuentas", { valor: act, texto: act === 1 ? "cuenta activa" : "cuentas activas" });
    conectarCuentas(c);
  }
  document.addEventListener("modulo", e => { if (e.detail !== "config") return; if (st.datos) pintarConfigCuentas(); else cargar(); });

  function pintar() {
    const j = st.datos, e = j.efectivo, i = j.ingresos, g = j.egresos, b = j.banco, df = j.diferencias, su = j.sueldos;
    const enCurso = j.mes === j.meses[0], abierto = (j.abiertos || []).includes(j.mes);
    const filas = l => l.map(([k, v, cl]) => `<div class="frow ${cl || ""}"><span>${k}</span><b>${D(v)}</b></div>`).join("");
    const mc = b.comision_cuenta;
    const modoEnsayo = j.ensayo_finanzas === true;
    const sync = j.sync || null;
    const syncFallida = !!(sync?.error && (!sync.at || sync.error_at > sync.at));
    const minutosSync = sync?.at ? Math.max(0, Math.round((Date.now() - Date.parse(sync.at)) / 60000)) : null;
    const fuenteEstado = modoEnsayo
      ? "ENSAYO: solo datos ficticios. La hoja de ingresos está desconectada intencionalmente."
      : syncFallida
      ? "Error al actualizar los ingresos de la hoja: " + sync.error
      : minutosSync == null ? "Sin fecha verificada de sincronización de ingresos"
      : minutosSync <= 1 ? "Última actualización registrada de ingresos: hace un momento"
      : "Última actualización registrada de ingresos: hace " + minutosSync + " minutos";
    const fuenteAlerta = !modoEnsayo && (syncFallida || minutosSync == null || minutosSync > 90);
    const hojaSinLigar = (j.transf_hoja || []).filter(h => !h.ligada);
    const ticketTxt = h => `${SVC[h.servicio] || h.servicio} ${h.folio}`;
    const posibles = Object.fromEntries((j.transf_posibles || []).map(x => [x.id, x.tickets]));
    const alertas = j.conciliacion_alertas || [];
    const alertaIds = new Set(alertas.map(a => a.id));
    const motivoAlerta = { importe: "El importe de la hoja cambió", forma: "El ticket ya no figura como transferencia", ausente: "El ticket desapareció de la hoja", ambiguo: "Hay más de un ticket con ese folio" };
    const S = {
      resumen: () => `      <section class="card"><h3>${esc(nomMes(j.mes))}</h3>
        <div class="ctot fkpi"><div class="k"><span>Entró</span><b style="color:#7ee2a0">${D(i.total)}</b></div><div class="k"><span>Salió</span><b style="color:#ff8a80">${D(g.total)}</b></div><div class="k dest"><span>Resultado</span><b>${D(j.resultado)}</b></div></div>
        <p class="note" role="status" style="margin:8px 0 12px;${fuenteAlerta ? "color:var(--warn);" : ""}">${esc(fuenteEstado)}${modoEnsayo ? "" : " · Puede haber consultas de la hoja sin cambios entre registros."}${fuenteAlerta ? " · Revisa Caja → Sincronizar antes de tomar decisiones." : ""}</p>
        ${alertas.length ? `<p class="note" role="alert" style="margin:0 0 12px;color:var(--warn);font-weight:650">Atención: hay ${alertas.length} transferencia(s) con tickets modificados o no encontrados. Revisa DINERO → Transferencias antes de confiar en la conciliación. Los importes no se han corregido automáticamente.</p>` : ""}
        <div class="fcols">
          <div><h4>Ingresos</h4>${filas([["Tickets en efectivo", i.efectivo], ["Tickets con tarjeta (Mercado Pago)", i.tarjeta], ["Tickets por transferencia (hoja)", i.transf_hoja], ...(i.transf_manual ? [["Transferencias capturadas sin ticket", i.transf_manual]] : []), ["Otros ingresos (rentas)", i.otros], ...(i.sobrantes ? [["Sobrantes de caja", i.sobrantes]] : []), ["Total", i.total, "tot"]])}</div>
          <div><h4>Egresos</h4>${filas([[CAT.caja, g.caja], [CAT.retiros, g.retiros], [CAT.programado, g.programado], [CAT.no_programado, g.no_programado], [CAT.compra, g.compra], ...(g.otro ? [[CAT.otro, g.otro]] : []), [CAT.comision, g.comision], ...(g.faltantes ? [[CAT.faltantes, g.faltantes]] : []), ["Total", g.total, "tot"]])}</div>
        </div>
        <div class="fgraf">${graf(j.por_dia)}</div>
        ${enCurso ? `<p class="note" style="margin:6px 0 0">Mes en curso: las cifras cambian conforme entran tickets, gastos y pagos.</p>` : ""}
      </section>`,
      diferencias: () => `      <section class="card"><h3>Diferencias de caja</h3>
        <p class="note" style="margin:4px 0 10px">Lo que el encargado contó contra lo que el sistema esperaba, y el cambio que dejó un turno contra el que recibió el siguiente. Lo que falta cuenta como egreso; lo que sobra, como ingreso.</p>
        <div class="ctot" style="margin:0 0 10px"><div class="k"><span>Faltó</span><b style="color:#ff8a80">${D(df.faltantes)}</b></div><div class="k"><span>Sobró</span><b style="color:#7ee2a0">${D(df.sobrantes)}</b></div><div class="k dest"><span>Neto</span><b>${D(df.sobrantes - df.faltantes)}</b></div></div>
        ${df.lista.length ? `<div class="tabla-scroll" tabindex="0" role="region" aria-label="Diferencias de caja"><table class="cmovs"><thead><tr><th>Día</th><th>Turno</th><th>Encargado</th><th>Qué</th><th class="n">Diferencia</th></tr></thead><tbody>
          ${df.lista.map(x => `<tr><td>${esc(diaTxt(x.dia))}</td><td>${esc(TURNO_TXT[x.turno] || x.turno)}</td><td>${x.persona ? avP(x.persona) + esc(x.persona) : ""}</td><td>${esc(x.concepto)}</td><td class="n"><b style="color:${x.dif < 0 ? "#ff8a80" : "#7ee2a0"}">${D(x.dif)}</b></td></tr>`).join("")}
        </tbody></table></div>` : `<p class="note">Todos los cortes entregados cuadran.</p>`}
      </section>`,
      sueldos: () => `      <section class="card"><h3>Sueldos del mes</h3>
        <p class="note" style="margin:4px 0 10px">Lo que cada encargado se cobró del turno (gastos de caja o retiros del corte con categoría <b>Sueldos</b>, aunque lo junte en varios turnos) y lo que pagaste tú (pagos con categoría Sueldos, en efectivo de los sobres o por banco). Para verlos por persona, pon su nombre en el concepto del pago.</p>
        <div class="ctot" style="margin:0 0 10px"><div class="k"><span>Cobrado del turno</span><b>${D(su.total_caja)}</b></div><div class="k"><span>Pagado por ti</span><b>${D(su.total_admin)}</b></div><div class="k dest"><span>Total</span><b>${D(su.total)}</b></div></div>
        ${su.caja.length || su.admin.length ? `<div class="tabla-scroll" tabindex="0" role="region" aria-label="Sueldos"><table class="cmovs"><thead><tr><th>Quién o concepto</th><th>De dónde</th><th class="n">Pagos</th><th class="n">Total</th></tr></thead><tbody>
          ${su.caja.map(x => `<tr><td>${avP(x.persona)}${esc(x.persona)}</td><td>Del turno</td><td class="n">${x.n}</td><td class="n">${D(x.total)}</td></tr>`).join("")}
          ${su.admin.map(x => `<tr><td>${esc(x.concepto)}</td><td>Pagado por ti</td><td class="n">${x.n}</td><td class="n">${D(x.total)}</td></tr>`).join("")}
        </tbody></table></div>` : `<p class="note">Sin sueldos registrados este mes.</p>`}
      </section>`,
      categorias: () => `      <section class="card"><h3>Egresos por categoría</h3>
        ${(j.por_categoria || []).length ? `<div class="fcat">${j.por_categoria.map(x => `<div class="fcat-f" style="--c:${esc(x.color)}"><span class="ci"><svg aria-hidden="true"><use href="#i-cat-${esc(x.icono)}"/></svg></span><span class="fn">${esc(x.nombre)}${x.caja && x.total - x.caja > 0.004 ? `<small>caja ${D(x.caja)} · administración ${D(x.total - x.caja)}</small>` : ""}</span><span class="fb"><i style="width:${Math.max(2, 100 * x.total / j.por_categoria[0].total)}%"></i></span><b>${D(x.total)}</b></div>`).join("")}</div>` : `<p class="note">Sin egresos este mes.</p>`}
      </section>`,
      efectivo: () => `      <section class="card" id="f-efectivo">
        <p class="note" style="margin:4px 0 10px">Entra lo que los turnos entregan en sobre y lo que retiras del banco; sale lo que pagas o compras en efectivo, lo que depositas y el cambio que pones en la caja. El saldo pasa solo de un mes al siguiente: captúralo solo cuando cuentes los sobres, y verás si cuadra con lo calculado.</p>
        ${abierto ? `<form class="fsaldo" id="f-saldo" data-original="${e.capturado ? esc(e.inicial) : ""}" novalidate><label>Efectivo contado al empezar ${esc(nomMes(j.mes).toLowerCase())}<input name="efectivo" inputmode="decimal" placeholder="${e.calculado != null ? esc(e.calculado.toFixed(2)) + " (calculado)" : "Ej. 12500.00"}" value="${e.capturado ? esc(e.inicial) : ""}" autocomplete="off"></label><button class="btn btn-primary" type="submit">Guardar</button>${e.capturado && e.inicial_actualizado ? `<span class="note">Guardado ${esc(cuando(e.inicial_actualizado))}</span>` : ""}${e.inicial == null ? `<span class="note" style="color:var(--warn)">Falta un saldo de partida: cuenta los sobres y escríbelo una vez; después se calcula solo.</span>` : ""}<span class="err"></span></form>` : ""}
        <div class="ctot" style="margin:12px 0"><div class="k"><span>Saldo inicial</span><b>${e.inicial != null ? D(e.inicial) : "—"}</b>${origenSaldo(e)}</div><div class="k"><span>Entró</span><b style="color:#7ee2a0">${D(e.recibido)}</b></div><div class="k"><span>Salió</span><b style="color:#ff8a80">${D(e.gastado)}</b></div><div class="k dest"><span>Debería quedar</span><b>${e.saldo != null ? D(e.saldo) : "—"}</b></div></div>
        ${e.movimientos.length ? `<details ${e.movimientos.length <= 12 ? "open" : ""}><summary class="note" style="cursor:pointer;font-weight:600">Movimientos del efectivo (${e.movimientos.length})</summary><div class="tabla-scroll" tabindex="0" role="region" aria-label="Movimientos del efectivo"><table class="cmovs"><thead><tr><th>Día</th><th>Movimiento</th><th>Concepto</th><th class="n">Entró</th><th class="n">Salió</th><th class="n">Saldo</th></tr></thead><tbody>
          ${e.movimientos.map(m => `<tr><td>${esc(diaTxt(m.dia))}</td><td>${esc(CAT1[m.tipo] || m.tipo)}</td><td>${m.persona ? avP(m.persona) : ""}${esc(m.concepto)}</td><td class="n">${m.entrada ? D(m.entrada) : ""}</td><td class="n">${m.salida ? D(m.salida) : ""}</td><td class="n">${m.saldo != null ? D(m.saldo) : "—"}</td></tr>`).join("")}
        </tbody></table></div></details>` : `<p class="note">Sin movimientos de efectivo este mes.</p>`}
      </section>`,
      cuentas: () => `      <section class="card" id="f-banco">
        <details class="f-guia-saldos">
          <summary>Cómo se calculan los saldos y las deudas</summary>
          <p class="note" data-nl="1">Débito: saldo inicial + entradas − salidas. Crédito: deuda inicial + cargos − pagos. Las compras con tarjeta de crédito cuentan como gasto al comprar; pagar la tarjeta no es otro gasto. El saldo se arrastra al mes siguiente. Captura el saldo inicial solo cuando conozcas el importe real de la cuenta.</p>
        </details>
        <div class="ctot" style="margin:0 0 12px"><div class="k"><span>Dinero en cuentas</span><b style="color:#7ee2a0">${b.dinero != null ? D(b.dinero) : "—"}</b>${b.dinero_parcial ? `<small class="note">Total parcial: faltan saldos de algunas cuentas</small>` : ""}${b.conciliaciones_pendientes ? `<small class="note" style="color:var(--warn)">Atención: ${b.conciliaciones_pendientes} conciliación(es) por revisar. Comprueba las transferencias.</small>` : ""}</div><div class="k"><span>Deuda en tarjetas</span><b style="color:#ff8a80">${b.deuda != null ? D(b.deuda) : "—"}</b>${b.deuda_parcial ? `<small class="note">Total parcial: faltan deudas de algunas tarjetas</small>` : ""}</div><div class="k"><span>Cobros con tarjeta${mc ? ` (a ${esc(mc.nombre)})` : ""}</span><b>${D(b.tarjeta)}</b><span class="note">comisión ${D(b.comision)} · neto ${D(b.tarjeta_neto)}</span></div><div class="k"><span>Transferencias de clientes</span><b>${D(b.transferencias)}</b></div></div>
        ${mc && !(mc.pct > 0) ? `<p class="note" style="margin:0 0 10px;color:var(--warn)">Falta la comisión de ${esc(mc.nombre)}: escríbela en Configuración (⚙️) → Cuentas.</p>` : ""}
        ${(b.faltan_saldo || []).length ? `<div class="f-aviso-saldos" role="status">
          <strong>Faltan saldos iniciales de ${b.faltan_saldo.length} cuentas o tarjetas.</strong>
          <span>Los totales mostrados son parciales. No captures importes sin verificarlos.</span>
          <details>
            <summary>Ver cuáles faltan (${b.faltan_saldo.length})</summary>
            <ul>${b.faltan_saldo.map(nombre => `<li>${esc(nombre)}</li>`).join("")}</ul>
            <p>Si una cuenta nunca se ha usado, puedes ocultarla en Configuración → Cuentas.</p>
          </details>
        </div>` : ""}
        ${["debito", "credito"].map(tipo => { const l = (b.lista || []).filter(c => c.tipo === tipo && c.activa); return l.length ? `<h4 class="fsub">${tipo === "credito" ? "Tarjetas de crédito" : "Cuentas de débito"}</h4><div class="tabla-scroll" tabindex="0" role="region" aria-label="${tipo === "credito" ? "Tarjetas de crédito" : "Cuentas de débito"}"><table class="cmovs fcuentas-t"><thead><tr><th>${tipo === "credito" ? "Tarjeta" : "Cuenta"}</th><th class="n">${tipo === "credito" ? "Deuda inicial" : "Saldo inicial"}</th><th class="n">${tipo === "credito" ? "Cargos" : "Entró"}</th><th class="n">${tipo === "credito" ? "Pagos" : "Salió"}</th><th class="n">${tipo === "credito" ? "Deuda" : "Saldo"}</th></tr></thead><tbody>
          ${l.map(c => { const cargos = tipo === "credito" ? c.salidas : c.entradas, abonos = tipo === "credito" ? c.entradas : c.salidas; const det = [c.detalle.tarjeta ? `tarjeta ${D(c.detalle.tarjeta)} − comisión ${D(c.detalle.comision)}` : "", c.detalle.transferencias ? "transferencias " + D(c.detalle.transferencias) : "", c.detalle.recibido ? (tipo === "credito" ? "pagos " : "recibido ") + D(c.detalle.recibido) : "", c.detalle.pagos ? (tipo === "credito" ? "compras " : "pagos ") + D(c.detalle.pagos) : "", c.detalle.enviado ? "enviado " + D(c.detalle.enviado) : ""].filter(Boolean).join(" · ");
            const ini = abierto ? `<input class="fsaldo-c" data-cuenta="${esc(c.id)}" data-original="${c.capturado ? esc(c.inicial) : ""}" inputmode="decimal" value="${c.capturado ? esc(c.inicial) : ""}" placeholder="${c.calculado != null ? esc(c.calculado.toFixed(2)) : "—"}" aria-label="Saldo inicial de ${esc(c.nombre)}">` : `<b>${c.inicial != null ? D(c.inicial) : "—"}</b>`;
            return `<tr><td><b>${esc(c.nombre)}</b>${c.tarjeta ? ` <span class="cat-chip">cobros con tarjeta</span>` : ""}${c.def_transf ? ` <span class="cat-chip">transferencias de clientes</span>` : ""}${det ? `<div class="note" style="font-size:var(--t-xs)">${esc(det)}</div>` : ""}</td><td class="n">${ini}<div>${origenSaldo(c)}</div></td><td class="n">${D(cargos)}</td><td class="n">${D(abonos)}</td><td class="n"><b style="color:${tipo === "credito" ? "#ff8a80" : "#7ee2a0"}">${c.saldo != null ? D(c.saldo) : "—"}</b></td></tr>`; }).join("")}
        </tbody></table></div>` : ""; }).join("")}
        ${b.sin_cuenta && (b.sin_cuenta.pagos || b.sin_cuenta.transferencias) ? `<p class="note" style="margin:8px 0 0;color:var(--warn)">Sin cuenta asignada: pagos ${D(b.sin_cuenta.pagos)} · transferencias ${D(b.sin_cuenta.transferencias)}. No restan ni suman a ninguna cuenta hasta que la elijas con «Editar» en cada pago.</p>` : ""}

        <h4 class="fsub">Traspasos, pagos de tarjeta, depósitos y retiros</h4>
        ${abierto ? `<form class="cform" id="f-mov" novalidate>
          <label>Movimiento<select name="tipo"><option value="traspaso">Traspaso entre cuentas</option><option value="pago_tarjeta">Pago de tarjeta de crédito</option><option value="deposito">Depósito en efectivo (de los sobres)</option><option value="retiro">Retiro de efectivo (a los sobres)</option></select></label>
          <label class="m-or">De<select name="origen"></select></label>
          <label class="m-de">A<select name="destino"></select></label>
          <label>Importe<input name="importe" inputmode="decimal" placeholder="0.00"></label>
          <label>Fecha<input type="date" name="fecha" value="${esc(enCurso ? hoyMx() : j.mes + "-01")}" max="${esc(hoyMx())}"></label>
          <label class="wide">Nota <span style="font-weight:400">(opcional)</span><input name="nota" maxlength="200" placeholder="Ej. traspaso de cobros de la semana" autocomplete="off"></label>
          <span class="err" style="grid-column:1/-1"></span>
          <div class="row" style="grid-column:1/-1"><button class="btn btn-primary" type="submit">Registrar movimiento</button></div>
        </form>` : `<p class="note">Mes cerrado: los movimientos ya no se pueden cambiar.</p>`}
        ${(b.movs || []).length ? `<div class="alist fmov-lista" style="margin-top:10px">${b.movs.map(m => `<div class="aitem"><span class="grav pagado" title="${esc(m.tipo_txt)}"><svg aria-hidden="true"><use href="#i-transf"/></svg></span><span class="tt">${esc(m.origen_txt)} → ${esc(m.destino_txt)}</span><span class="acc">${abierto ? `<button class="del fmov-eliminar" type="button" data-mdel="${esc(m.id)}" aria-label="Eliminar movimiento ${esc(m.origen_txt)} hacia ${esc(m.destino_txt)}"><svg aria-hidden="true"><use href="#i-trash"/></svg><span>Eliminar</span></button>` : ""}</span><span class="mm"><span><b>${D(m.importe)}</b></span><span>${esc(m.tipo_txt)}</span><span>${esc(diaTxt(m.fecha))}</span>${m.nota ? `<span>${esc(m.nota)}</span>` : ""}</span></div>`).join("")}</div>` : `<p class="note" style="margin-top:8px">Sin movimientos entre cuentas este mes.</p>`}

      </section>`,
      transferencias: () => `      <section class="card">
        <details class="ftransf-ayuda">
          <summary>¿Cuándo vincular un ticket?</summary>
          <p class="ftransf-ayuda-texto">Si el cobro ya aparece como transferencia en la hoja de Báscula o Pensión, selecciona su ticket para no contar el ingreso dos veces. Elige «Sin ticket» solo para cobros que no pasaron por esas hojas.</p>
        </details>
        ${alertas.length ? `<div class="note" role="alert" style="padding:12px;margin:10px 0;border:1px solid var(--warn);border-radius:12px"><b style="color:var(--warn)">Conciliaciones que necesitan revisión (${alertas.length})</b><p style="margin:6px 0">La hoja cambió después de vincular el ticket. No se borró ningún dato ni se ajustaron saldos de forma automática.</p><ul style="margin:6px 0;padding-left:22px">${alertas.map(a => `<li><b>${esc(a.ref)}</b>: ${esc(motivoAlerta[a.motivo] || "Revisar ticket")}${a.motivo === "importe" ? ` (capturado ${D(a.importe_capturado)}, hoja ${D(a.importe_hoja)})` : ""}</li>`).join("")}</ul></div>` : ""}
        ${enCurso ? `<form class="cform" id="f-ftransf" novalidate style="margin:6px 0 12px">
          <label class="wide">Nombre del cliente<input name="cliente" maxlength="120" required autocomplete="off"></label>
          <label>Importe<input name="importe" inputmode="decimal" placeholder="0.00" required></label>
          <label>Fecha<input type="date" name="fecha" value="${esc(hoyMx())}" min="${esc(j.mes)}-01" max="${esc(hoyMx())}" required></label>
          <label class="wide">Ticket de la hoja <span style="font-weight:400">(si es de un ticket)</span><select name="ticket_ref"><option value="">Sin ticket</option>${hojaSinLigar.map(h => `<option value="${esc(h.ref)}" data-imp="${h.importe}" data-cli="${esc(h.cliente)}" data-f="${esc(h.fecha)}">${esc(ticketTxt(h))} · ${esc(diaTxt(h.fecha))} · ${D(h.importe)}${h.cliente ? " · " + esc(h.cliente) : ""}</option>`).join("")}</select></label>
          <label class="wide">Factura <span style="font-weight:400">(opcional)</span><input name="factura" maxlength="60" placeholder="Número o folio de la factura" autocomplete="off"></label>
          <label>Llegó a<select name="cuenta">${(j.cuentas_activas || []).filter(c => c.tipo !== "credito").map(c => `<option value="${esc(c.id)}" ${c.def_transf ? "selected" : ""}>${esc(c.nombre)}</option>`).join("")}</select></label>
          <span class="err" style="grid-column:1/-1"></span>
          <div class="row" style="grid-column:1/-1"><button class="btn btn-primary" type="submit">Agregar transferencia</button></div></form>` : ""}
        ${(j.transf_hoja || []).length ? `<h4 class="fsub">Tickets pagados por transferencia (hoja)</h4><div class="alist">${j.transf_hoja.map(h => `<div class="aitem"><span class="grav pagado" title="Ticket por transferencia"><svg aria-hidden="true"><use href="#i-transf"/></svg></span><span class="tt">${esc(ticketTxt(h))}${h.cliente ? " · " + esc(h.cliente) : ""}</span><span class="acc"></span><span class="mm"><span><b>${D(h.importe)}</b></span><span>${esc(diaTxt(h.fecha))}</span><span>${h.ligada ? `capturada: ${esc(h.ligada.cliente)}${h.ligada.factura ? " · factura " + esc(h.ligada.factura) : ""}${alertaIds.has(h.ligada.id) ? " · vínculo en revisión" : ""}` : "sin capturar · llega a la cuenta por defecto"}</span></span></div>`).join("")}</div>` : ""}
        ${j.transferencias.length ? `<h4 class="fsub">Capturadas en el panel</h4><div class="alist ftransf-lista">${j.transferencias.map(x => { const tk = x.ticket_ref ? (j.transf_hoja || []).find(h => h.ref === x.ticket_ref) : null, pos = posibles[x.id] || []; return `<div class="aitem"><span class="grav pagado" title="Transferencia">${'<svg aria-hidden="true"><use href="#i-transf"/></svg>'}</span><span class="tt">${esc(x.cliente)}</span><span class="acc">${enCurso ? `<button class="del ftransf-eliminar" type="button" data-tdel="${esc(x.id)}" aria-label="Eliminar transferencia de ${esc(x.cliente)}"><svg aria-hidden="true"><use href="#i-trash"/></svg><span>Eliminar</span></button>` : ""}</span><span class="mm"><span><b>${D(x.importe)}</b></span><span>${esc(diaTxt(x.fecha))}</span><span>${x.factura ? "Factura " + esc(x.factura) : "Sin factura"}</span>${x.cuenta ? `<span>a ${esc(((j.cuentas_activas || []).find(c => c.id === x.cuenta) || { nombre: x.cuenta }).nombre)}</span>` : ""}<span>${tk ? `del ticket ${esc(ticketTxt(tk))} (ya cuenta en el ticket)` : x.ticket_ref ? "su ticket ya no está en la hoja: cuenta aparte" : "sin ticket: cuenta aparte"}</span></span></div>
          ${enCurso && pos.length ? `<div class="note" style="margin:2px 0 10px;color:var(--warn);display:flex;gap:8px;align-items:center;flex-wrap:wrap">¿Es la misma que un ticket de la hoja? Si sí, lígala para no contarla dos veces: ${pos.map(r => { const h = j.transf_hoja.find(z => z.ref === r); return `<button class="btn btn-line" type="button" data-tligar="${esc(x.id)}" data-ref="${esc(r)}" style="min-height:32px;padding:0 10px">Es el ticket ${esc(h ? ticketTxt(h) : r)}</button>`; }).join(" ")}</div>` : ""}
          ${enCurso && x.ticket_ref ? `<div style="margin:2px 0 10px"><button class="btn btn-line" type="button" data-tligar="${esc(x.id)}" data-ref="" style="min-height:32px;padding:0 10px">Quitar el ticket</button></div>` : ""}`; }).join("")}</div>` : (j.transf_hoja || []).length ? "" : `<p class="note">No hay transferencias de clientes este mes.</p>`}
        <p class="note" style="margin:8px 0 0">Entran al banco: suman a los ingresos, pero no a la caja de ningún turno.</p>
      </section>`,
      admin: () => `      <section class="card"><h3>Egresos de la administración</h3>
        ${j.admin.length ? `<div class="tabla-scroll" tabindex="0" role="region" aria-label="Egresos de la administración"><table class="cmovs"><thead><tr><th>Día</th><th>Tipo</th><th>Concepto</th><th>Pagado con</th><th class="n">Monto</th></tr></thead><tbody>
          ${j.admin.slice().sort((a, b) => b.dia.localeCompare(a.dia)).map(x => `<tr><td>${esc(diaTxt(x.dia))}</td><td>${esc(CAT1[x.cat])}</td><td>${esc(x.concepto)}${x.comprobante ? ` · <a href="/panel/api/agenda/pagos/${esc(x.comprobante)}/comprobante" target="_blank" rel="noopener">📎</a>` : ""}</td><td>${esc(FORMA[x.forma] || x.forma)}${x.forma !== "EFECTIVO" ? (x.cuenta ? ` · ${esc(((b.lista || []).find(c => c.id === x.cuenta) || { nombre: x.cuenta }).nombre)}` : ` · <span style="color:var(--warn)">sin cuenta</span>`) : ""}</td><td class="n">${D(x.monto)}</td></tr>`).join("")}
        </tbody></table></div>` : `<p class="note">Sin pagos ni compras este mes.</p>`}
        ${(j.retiros || []).length ? `<h4 class="fsub">Retiros del corte</h4><div class="tabla-scroll" tabindex="0" role="region" aria-label="Retiros del corte"><table class="cmovs"><thead><tr><th>Día</th><th>Turno</th><th>Concepto</th><th>Categoría</th><th class="n">Monto</th></tr></thead><tbody>
          ${j.retiros.slice().sort((a, b) => b.dia.localeCompare(a.dia)).map(r => `<tr><td>${esc(diaTxt(r.dia))}</td><td>${avP(r.persona)}${esc(TURNO_TXT[r.turno] || r.turno)}</td><td>${esc(r.concepto)}</td><td>${window.catChip ? window.catChip(r.categoria) : esc(r.categoria)}</td><td class="n">${D(r.monto)}</td></tr>`).join("")}
        </tbody></table></div>` : ""}
        <button class="btn btn-line" type="button" data-ir-pagos style="margin-top:10px">Ver pagos y gastos hechos ›</button>
      </section>`,
      bitacora: () => `      <section class="card"><h3>Bitácora de cambios</h3>
        <p class="note" style="margin:4px 0 10px">Quién registró, cambió o borró pagos, compras, traspasos, saldos, transferencias y gastos de caja. Sirve para saber por qué cambió una cifra.</p>
        <details id="f-bit"><summary class="note" style="cursor:pointer;font-weight:600">Ver los últimos cambios</summary><div id="f-bit-lista" style="margin-top:8px"><p class="note">Cargando…</p></div></details>
      </section>`,
      reportes: () => `      <section class="card"><h3>Reportes en Google Sheets</h3>
        <p class="note" style="margin:4px 0 10px">Al cerrar cada mes se crean solos tres reportes, cada uno en su carpeta de Drive: <b>Turnos</b> (TURNOS), <b>Finanzas</b> (ADMIN FINANZAS) y <b>Facturación</b> (FACTURACION). Aquí puedes generarlos para cualquiera de los últimos 13 meses; si ya existen, se reemplazan.</p>
        <div class="row" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><select id="f-rep-mes" aria-label="Mes del reporte"></select><button class="btn btn-primary" id="f-rep-gen" type="button">Generar los tres</button><span class="note" id="f-rep-estado" role="status"></span></div>
        <div id="f-rep-lista"></div>
      </section>`
    };
    // Dinero muestra todo a la vez, en bloques (los de pagos y compras los pinta la Agenda)
    const BLOQUES = { "fb-resumen": ["resumen", "diferencias", "sueldos", "categorias", "admin"], "fb-efectivo": ["efectivo"], "fb-cuentas": ["cuentas"], "fb-transf": ["transferencias"], "fb-bitacora": ["bitacora", "reportes"] };
    for (const [id, ks] of Object.entries(BLOQUES)) { const el = $("#" + id); if (el) el.innerHTML = ks.map(k => S[k]()).join("\n"); }
    const pendientesConciliacion = (j.conciliacion_alertas || []).length;
    const estadoTransferencias = modoEnsayo ? "Ensayo · hoja desconectada"
      : fuenteAlerta ? "Hoja sin sincronización verificada"
      : pendientesConciliacion ? pendientesConciliacion + " conciliaciones por revisar"
      : hojaSinLigar.length ? hojaSinLigar.length + " tickets por ligar"
      : !(j.transf_hoja || []).length ? "Sin tickets de transferencia en la hoja"
      : "Sin tickets pendientes de vincular";
    EC.bloqueN("finanzas", "transferencias",
      pendientesConciliacion || hojaSinLigar.length || null,
      pendientesConciliacion > 0 || fuenteAlerta || hojaSinLigar.length > 0);
    EC.bloqueN("finanzas", "cuentas", (b.faltan_saldo || []).length ? "!" : null, (b.faltan_saldo || []).length > 0);
    // Línea de estado de cada tarjeta del índice (celular y tablet)
    // Tarjetas financieras: preservar los centavos cuando no son .00.
    // No redondear el saldo real al peso en el resumen del celular.
    const D0 = v => EC.dinero(v, Math.round(Math.abs(Number(v) || 0) * 100) % 100 ? 2 : 0);
    EC.bloqueInfo("finanzas", "resumen", { valor: D0(j.resultado ?? (i.total - g.total)), texto: "resultado de " + nomMes(j.mes).toLowerCase() });
    EC.bloqueInfo("finanzas", "efectivo", { valor: e.saldo != null ? D0(e.saldo) : "—", texto: e.saldo != null ? "en sobres" : "Sin saldo inicial capturado" });
    EC.bloqueInfo("finanzas", "cuentas", { valor: b.dinero != null ? D0(b.dinero) : null, texto: (b.dinero_parcial ? "Parcial · falta capturar saldos" : "en cuentas" + (b.deuda ? " · deuda " + D0(b.deuda) : "")) + (b.conciliaciones_pendientes ? " · revisar conciliación" : "") });
    EC.bloqueInfo("finanzas", "transferencias", { texto: estadoTransferencias });
    EC.bloqueInfo("finanzas", "bitacora", { texto: "Cambios y reportes del mes" });
    conectar();
    pintarConfigCuentas();
  }

  function conectarCuentas(c) {
    // Guardado guiado: no dejar seleccionada una cuenta/tipo rechazados
    // ni permitir un segundo envío mientras el primero está en curso.
    const guardarCuenta = async (datos, msg, control = null) => {
      if (control?.disabled) return false;
      if (control) control.disabled = true;
      try {
        await post("finanzas/cuenta", datos);
        toast(msg);
        await cargar();
        return true;
      } catch (e) {
        if (e.message !== "sesion") {
          toast(e.message);
          if (control?.tagName === "SELECT") control.value = control.dataset.confirmado || "";
          if (/otra sesión|históric|ya tiene movimientos|ya existe/.test(e.message)) await cargar();
        }
        return false;
      } finally { if (control?.isConnected) control.disabled = false; }
    };
    c.querySelectorAll("[data-ctipo]").forEach(x => {
      x.dataset.confirmado = x.value;
      x.addEventListener("change", () => guardarCuenta({ id: x.dataset.ctipo, tipo: x.value }, "Tipo guardado", x));
    });
    c.querySelectorAll("[data-cuso]").forEach(x => {
      x.dataset.confirmado = x.value;
      x.addEventListener("change", () => { if (x.value) guardarCuenta({ id: x.value, [x.dataset.cuso]: 1 }, "Guardado", x); });
    });
    c.querySelectorAll("form[data-cnom]").forEach(f => f.addEventListener("submit", ev => {
      ev.preventDefault();
      guardarCuenta({ id: f.dataset.cnom, nombre: f.nombre.value }, "Nombre guardado", f.querySelector("[type=submit]"));
    }));
    c.querySelectorAll("[data-cact]").forEach(x => x.addEventListener("click", () =>
      guardarCuenta({ id: x.dataset.cact, activa: x.dataset.v === "1" }, x.dataset.v === "1" ? "Cuenta visible" : "Cuenta oculta", x)));
    c.querySelectorAll("[data-ccom]").forEach(f => f.addEventListener("submit", ev => {
      ev.preventDefault();
      guardarCuenta({ id: f.dataset.ccom, comision_pct: f.pct.value, comision_iva: f.iva.checked }, "Comisión guardada", f.querySelector("[type=submit]"));
    }));
    const cnu = c.querySelector("#f-cnueva");
    if (cnu) cnu.addEventListener("submit", async ev => {
      ev.preventDefault();
      const bt = cnu.querySelector("[type=submit]");
      if (bt.disabled) return;
      bt.disabled = true;
      cnu.querySelector(".err").textContent = "";
      try {
        await post("finanzas/cuenta", { nombre: cnu.nombre.value, tipo: cnu.tipo.value });
        toast("Cuenta agregada");
        await cargar();
      } catch (e) {
        if (e.message !== "sesion") cnu.querySelector(".err").textContent = e.message;
      } finally { if (bt.isConnected) bt.disabled = false; }
    });
    const cu = c.querySelector("#f-cuentas");
    if (cu) cu.addEventListener("submit", async ev => {
      ev.preventDefault(); const b = cu.querySelector("button"); b.disabled = true;
      try { await post("finanzas/cuentas", { texto: cu.texto.value }); toast("Cuentas guardadas"); } catch (e) { if (e.message !== "sesion") cu.querySelector(".err").textContent = e.message; }
      b.disabled = false;
    });
  }
  // Los bloques de Finanzas (sin tocar los de pagos y compras, que viven en la misma pantalla)
  const misBloques = () => ["fb-resumen", "fb-efectivo", "fb-cuentas", "fb-transf", "fb-bitacora"].map(id => $("#" + id)).filter(Boolean);
  function conectar() {
    const c = { querySelectorAll: q => misBloques().flatMap(b => [...b.querySelectorAll(q)]), querySelector: q => misBloques().map(b => b.querySelector(q)).find(Boolean) || null };
    const sal = $("#f-saldo");
    if (sal) sal.addEventListener("submit", async ev => {
      ev.preventDefault(); const b = sal.querySelector("button");
      if (b.disabled) return;
      b.disabled = true; sal.querySelector(".err").textContent = "";
      try {
        const res = await post("finanzas/saldo", {
          mes: st.mes, efectivo: sal.efectivo.value.replace(/[$,\s]/g, ""),
          esperado: sal.dataset.original === "" ? null : sal.dataset.original
        });
        toast(res.sin_cambios ? "Saldo sin cambios" : sal.efectivo.value.trim() ? "Saldo inicial guardado" : "Saldo inicial quitado");
        await cargar();
      } catch (e) {
        if (e.message !== "sesion") {
          sal.querySelector(".err").textContent = e.message;
          if (/otra sesión/.test(e.message)) await cargar();
        }
      } finally { if (b.isConnected) b.disabled = false; }
    });
    // Cuentas: saldo inicial (se guarda al salir del campo), movimientos y administración
    const j = st.datos, todas = j.banco.lista || [], activas = todas.filter(c => c.activa);
    c.querySelectorAll(".fsaldo-c[data-cuenta]").forEach(inp => inp.addEventListener("change", async () => {
      if (inp.disabled) return;
      const valor = inp.value, mes = st.mes, cuenta = inp.dataset.cuenta;
      inp.disabled = true;
      try {
        const res = await post("finanzas/saldo-cuenta", { mes, cuenta, saldo: valor, esperado: inp.dataset.original === "" ? null : inp.dataset.original });
        toast(res.sin_cambios ? "Saldo sin cambios" : valor.trim() ? "Saldo inicial guardado" : "Saldo inicial quitado: se usa el calculado");
        await cargar();
      } catch (e) {
        if (e.message !== "sesion") {
          toast(e.message);
          // Si otra pestaña cambió el saldo, presentar el dato confirmado del servidor.
          if (/otra sesión/.test(e.message)) await cargar();
        }
      } finally { if (inp.isConnected) inp.disabled = false; }
    }));
    const fm = $("#f-mov");
    const opc = l => `<option value="">Selecciona una cuenta</option>` + l.map(x => `<option value="${esc(x.id)}">${esc(x.nombre)}</option>`).join("");
    const SOBRES = { id: "sobres", nombre: "Efectivo (sobres)" };
    if (fm) {
      const pintarMov = () => {
        const t = fm.tipo.value, deb = activas.filter(x => x.tipo !== "credito"), cred = activas.filter(x => x.tipo === "credito");
        fm.querySelector(".m-or").hidden = t === "deposito"; fm.querySelector(".m-de").hidden = t === "retiro";
        // Traspaso: entre cuentas · Pago de tarjeta: de débito o de los sobres a una de crédito · Depósito: a débito · Retiro: de débito
        fm.origen.innerHTML = opc(t === "pago_tarjeta" ? [...deb, SOBRES] : t === "retiro" ? deb : activas);
        fm.destino.innerHTML = opc(t === "pago_tarjeta" ? cred : t === "deposito" ? deb : activas);
      };
      fm.tipo.addEventListener("change", pintarMov); pintarMov();
      fm.addEventListener("submit", async ev => {
        ev.preventDefault();
        const bt = fm.querySelector("[type=submit]");
        if (bt.disabled) return;
        bt.disabled = true;
        const err = fm.querySelector(".err");
        err.textContent = "";
        try {
          const tipo = fm.tipo.value;
          const origen = tipo === "deposito" ? "sobres" : fm.origen.value;
          const destino = tipo === "retiro" ? "sobres" : fm.destino.value;
          const importe = fm.importe.value.replace(/[$,\s]/g, "");
          if (!origen || !destino || origen === destino) {
            err.textContent = "Elige de qué cuenta sale y a cuál llega. Deben ser distintas.";
            return;
          }
          if (!/^\d{1,9}(\.\d{1,2})?$/.test(importe) || !(Number(importe) > 0)) {
            err.textContent = "Escribe un importe positivo, con máximo dos decimales.";
            return;
          }
          if (!fm.fecha.value) {
            err.textContent = "Elige la fecha del movimiento.";
            return;
          }
          const nombre = id => id === "sobres" ? "Efectivo (sobres)" :
            (activas.find(c => c.id === id) || { nombre: id }).nombre;
          const clase = fm.tipo.selectedOptions[0]?.textContent || "Movimiento";
          const yaExiste = (st.datos?.banco?.movs || []).some(m =>
            mismoMovimiento(m, { tipo, origen, destino, fecha: fm.fecha.value, importe }));
          const aviso = yaExiste
            ? " ATENCIÓN: ya hay un movimiento con los mismos datos en este mes. Registrar otro volverá a modificar ambos saldos."
            : "";
          const detalle = `${D(Number(importe))} · ${nombre(origen)} → ${nombre(destino)} · ${diaTxt(fm.fecha.value)}. Esta operación modificará los saldos. ¿Son correctos los datos?${aviso}`;
          const titulo = yaExiste ? "¿Registrar otro movimiento idéntico?" : "¿Registrar " + clase.toLowerCase() + "?";
          if (!(await EC.confirmar(titulo, detalle, yaExiste ? "Registrar otro" : "Registrar"))) return;
          await post("finanzas/mov", {
            tipo, origen, destino, importe, fecha: fm.fecha.value, nota: fm.nota.value,
            uid: fm.dataset.uid || (fm.dataset.uid = crypto.randomUUID())
          });
          toast("Movimiento registrado");
          await cargar();
        } catch (e) {
          if (e.message !== "sesion") err.textContent = e.message;
        } finally { if (bt.isConnected) bt.disabled = false; }
      });
    }
    c.querySelectorAll("[data-mdel]").forEach(bt => bt.addEventListener("click", async () => {
      if (bt.disabled) return;
      bt.disabled = true;
      try {
        if (!(await EC.confirmar(
          "¿Eliminar este movimiento?",
          "Dejará de contar en los saldos bancarios y quedará una constancia en la bitácora.",
          "Eliminar", true
        ))) return;
        const res = await post(`finanzas/mov/${encodeURIComponent(bt.dataset.mdel)}/eliminar`);
        toast(res.borrados ? "Movimiento eliminado" : "Movimiento ya eliminado");
        await cargar();
      } catch (e) {
        if (e.message !== "sesion") toast(e.message);
      } finally { if (bt.isConnected) bt.disabled = false; }
    }));
    const ft = $("#f-ftransf");
    if (ft) {
      // Al elegir el ticket se llenan el importe, la fecha y el cliente que trae la hoja
      ft.ticket_ref.addEventListener("change", () => {
        const o = ft.ticket_ref.selectedOptions[0];
        const anteriorCliente = ft.dataset.ticketCliente || "";
        if (!o || !o.value) {
          // Volver a «Sin ticket»: quitar solo lo autocompletado.
          if (anteriorCliente && ft.cliente.value.trim() === anteriorCliente) ft.cliente.value = "";
          if (ft.dataset.ticketImporte && ft.importe.value === ft.dataset.ticketImporte) ft.importe.value = "";
          if (ft.dataset.ticketFecha && ft.fecha.value === ft.dataset.ticketFecha) ft.fecha.value = hoyMx();
          delete ft.dataset.ticketCliente;
          delete ft.dataset.ticketImporte;
          delete ft.dataset.ticketFecha;
          return;
        }
        const cliente = (o.dataset.cli || "").trim();
        // Cambiar a otro ticket sustituye el cliente autoanterior, no el escrito a mano.
        if (!ft.cliente.value.trim() || (anteriorCliente && ft.cliente.value.trim() === anteriorCliente)) {
          ft.cliente.value = cliente;
          if (cliente) ft.dataset.ticketCliente = cliente;
          else delete ft.dataset.ticketCliente;
        } else delete ft.dataset.ticketCliente;
        ft.importe.value = o.dataset.imp || "";
        ft.fecha.value = o.dataset.f || "";
        ft.dataset.ticketImporte = ft.importe.value;
        ft.dataset.ticketFecha = ft.fecha.value;
      });
      ft.addEventListener("submit", async ev => {
        ev.preventDefault(); const b = ft.querySelector("button[type=submit]"); if (b.disabled) return; b.disabled = true; ft.querySelector(".err").textContent = "";
        try { await post("caja/transferencias", { cliente: ft.cliente.value, importe: ft.importe.value.replace(/[$,\s]/g, ""), fecha: ft.fecha.value, factura: ft.factura.value, cuenta: ft.cuenta.value, ticket_ref: ft.ticket_ref.value, uid: ft.dataset.uid || (ft.dataset.uid = crypto.randomUUID()) }); toast("Transferencia guardada"); await cargar(); }
        catch (e) { if (e.message !== "sesion") ft.querySelector(".err").textContent = e.errores ? Object.values(e.errores).join(" ") : e.message; b.disabled = false; }
      });
    }
    c.querySelectorAll("[data-tdel]").forEach(b => b.addEventListener("click", async () => {
      if (b.disabled) return;
      b.disabled = true;
      try {
        const nombre = b.closest(".aitem")?.querySelector(".tt")?.textContent || "esta transferencia";
        if (!(await EC.confirmar(
          "¿Eliminar transferencia?",
          "Se eliminará el registro de " + nombre + " de los ingresos. El cambio quedará en la bitácora.",
          "Eliminar", true
        ))) return;
        await post(`caja/transferencias/${encodeURIComponent(b.dataset.tdel)}/eliminar`);
        toast("Transferencia eliminada");
        await cargar();
      } catch (e) {
        if (e.message !== "sesion") {
          toast(e.message);
          if (/otra sesión|cambió/.test(e.message)) await cargar();
        }
      } finally { if (b.isConnected) b.disabled = false; }
    }));
    c.querySelectorAll("[data-tligar]").forEach(b => b.addEventListener("click", async () => {
      b.disabled = true;
      try {
        const res = await post(`caja/transferencias/${encodeURIComponent(b.dataset.tligar)}/ligar`, { ticket_ref: b.dataset.ref });
        toast(res.sin_cambios ? "El ticket ya tenía ese vínculo" : b.dataset.ref ? "Ligada al ticket: ya no cuenta dos veces" : "Ticket quitado");
        await cargar();
      } catch (e) {
        if (e.message !== "sesion") {
          toast(e.message);
          if (/otra sesión|cambió/.test(e.message)) await cargar();
        }
      } finally { if (b.isConnected) b.disabled = false; }
    }));
    const bit = $("#f-bit");
    if (bit) bit.addEventListener("toggle", async () => {
      if (!bit.open || bit.dataset.cargado) return;
      const l = $("#f-bit-lista");
      try {
        const r = await api("finanzas/bitacora"); bit.dataset.cargado = "1";
        const det = d => !d ? "" : Object.entries(d).filter(([, v]) => v != null && v !== "" && typeof v !== "object").map(([k, v]) => `${k}: ${typeof v === "number" ? D(v) : v}`).join(" · ");
        l.innerHTML = r.bitacora.length ? `<div class="tabla-scroll" tabindex="0" role="region" aria-label="Bitácora"><table class="cmovs"><thead><tr><th>Cuándo</th><th>Quién</th><th>Qué</th><th>Detalle</th></tr></thead><tbody>${r.bitacora.map(x => `<tr><td>${esc(cuando(x.cuando))}</td><td>${esc((x.quien || "").split("@")[0])}</td><td>${esc((r.acciones[x.accion] || x.accion) + " · " + x.que)}</td><td class="note" style="font-size:var(--t-xs)">${esc(det(x.detalle))}${x.detalle && x.detalle.antes && typeof x.detalle.antes === "object" ? esc(" · antes: " + det(x.detalle.antes) + " · ahora: " + det(x.detalle.ahora)) : ""}</td></tr>`).join("")}</tbody></table></div>` : `<p class="note">Sin cambios registrados todavía.</p>`;
      } catch (e) { if (e.message !== "sesion") l.innerHTML = `<p class="note">${esc(e.message)}</p>`; }
    });
    const irPagos = c.querySelector("[data-ir-pagos]"); if (irPagos) irPagos.addEventListener("click", () => window.agendaAbrir && window.agendaAbrir("hechos"));
    if (window.reporteWidget && $("#f-rep-mes")) { st.cargarRep = window.reporteWidget({ tipos: ["turnos", "finanzas", "facturacion"], sel: $("#f-rep-mes"), btn: $("#f-rep-gen"), est: $("#f-rep-estado"), lista: $("#f-rep-lista") }); st.cargarRep(); }
  }

  $("#f-mes").addEventListener("change", e => { st.mes = e.target.value; cargar(); });
  // Desde el Inicio: abrir Finanzas con el formulario de transferencia listo
  window.finanzasAbrir = foco => { st.foco = foco; if (window.irA) window.irA("finanzas", { historia: "push", vista: foco === "transf" ? "transferencias" : "resumen" }); };
  document.addEventListener("modulo", e => { if (e.detail === "finanzas") { if (st.datos) pintar(); cargar(); } });
  document.addEventListener("recargar-todo", () => { if (!$("#mod-finanzas").hidden) cargar(); });
  if (EC.ruta().mod === "finanzas") cargar();
})();
