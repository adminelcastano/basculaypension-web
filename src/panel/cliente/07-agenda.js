// ---- Agenda: calendario, por hacer, compras e incidencias ----
(() => {
  const $ = q => document.querySelector(q);
  const esc = EC.esc;
  const toast = EC.toast;
  const api = EC.api;
  const post = EC.post;
  const fDia = new Intl.DateTimeFormat("es-MX", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
  const fLargo = new Intl.DateTimeFormat("es-MX", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
  const fMes = new Intl.DateTimeFormat("es-MX", { month: "long", year: "numeric", timeZone: "UTC" });
  const diaTxt = d => fDia.format(new Date(d + "T12:00:00Z"));
  const mayus = t => t.charAt(0).toUpperCase() + t.slice(1);
  const st = { tab: "calendario", ptab: "pago", items: [], hoy: "", mes: "", sel: "" };
  const TURNO_TXT = { "MAÑANA": "Mañana", "TARDE": "Tarde", "NOCHE": "Noche" };
  const AVISO_TXT = { 15: "15 min antes", 60: "1 hora antes", 1440: "1 día antes" };
  const ico = id => `<svg aria-hidden="true"><use href="#${id}"/></svg>`;
  const abierto = it => !["hecho", "comprado", "resuelta", "archivado", "pagado"].includes(it.estado);
  const foto = k => k ? ` · <a href="/panel/api/turno/foto/${encodeURIComponent(k)}" target="_blank" rel="noopener">ver foto</a>` : "";
  // Fotos de incidencias: se reducen en el navegador (lado mayor 1600 px, JPEG) antes de subirlas
  async function comprimirFoto(file) {
    let img;
    try { img = await createImageBitmap(file); }
    catch { img = await new Promise((ok, mal) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => mal(new Error(`No se pudo leer ${file.name}. Usa una foto JPG o PNG.`)); i.src = URL.createObjectURL(file); }); }
    const k = Math.min(1, 1600 / Math.max(img.width, img.height));
    const cv = document.createElement("canvas"); cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
    cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
    for (const q of [0.82, 0.7, 0.55]) { const u = cv.toDataURL("image/jpeg", q); if (u.length * 0.75 < 1_400_000) return u; }
    throw new Error(`La foto ${file.name} es demasiado grande.`);
  }
  const fotosDe = it => { let l = []; try { l = JSON.parse(it.fotos || "[]"); } catch {} if (!Array.isArray(l)) l = []; if (it.foto && !l.includes(it.foto)) l.unshift(it.foto); return l; };
  const urlFoto = k => "/panel/api/turno/foto/" + encodeURIComponent(k);
  // Campo de fotos del formulario de incidencia: junta las elegidas (cámara o galería) con vista previa
  function conectarFotos(f) {
    const caja = f.querySelector(".inc-fotos"); if (!caja) return;
    f._fotos = [];
    const pintar = () => { caja.querySelector(".inc-prev").innerHTML = f._fotos.map((u, i) => `<span class="inc-th"><img src="${u}" alt="Foto ${i + 1}"><button type="button" data-qf="${i}" aria-label="Quitar foto ${i + 1}">×</button></span>`).join(""); };
    caja.querySelectorAll(".inc-f").forEach(inp => inp.addEventListener("change", async () => {
      const err = f.querySelector(".err"); err.textContent = "";
      for (const file of inp.files) {
        if (f._fotos.length >= 8) { err.textContent = "Máximo 8 fotos."; break; }
        try { f._fotos.push(await comprimirFoto(file)); } catch (e) { err.textContent = e.message; }
      }
      inp.value = ""; pintar();
    }));
    caja.addEventListener("click", e => { const b = e.target.closest("[data-qf]"); if (b) { f._fotos.splice(+b.dataset.qf, 1); pintar(); } });
  }
  const fHora = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "America/Mexico_City" });
  const cuando = iso => iso ? fHora.format(new Date(iso)) : "";

  async function cargar() {
    try {
      const j = await api("agenda");
      st.items = j.items; st.hoy = j.hoy; st.pagosHechos = j.pagos_hechos || []; st.mesesAbiertos = j.meses_abiertos || [];
      if (j.categorias) window.ponerCategorias(j.categorias);
      if (j.cuentas) window.CUENTAS = j.cuentas;
      if (!st.mes) st.mes = j.hoy.slice(0, 7);
      if (!st.sel) st.sel = j.hoy;
      for (const t of ["tarea", "compra", "incidencia", "aviso", "pago"]) $("#an-" + t).textContent = j.abiertos[t] || 0;
      st.frecuencias = j.frecuencias || {};
      st.lugares = j.lugares || [];
      // Avisos de los encargados sin leer: el contador se pone en rojo con cuántos son
      const nA = $("#an-aviso"); nA.classList.toggle("rojo", !!j.avisos_sin_leer); if (j.avisos_sin_leer) nA.textContent = j.avisos_sin_leer;
      if (!st.personas) try { st.personas = (await api("turno")).personas; } catch { st.personas = []; }
      const a = j.abiertos;
      $("#a-subtitulo").textContent = `${a.tarea || 0} por hacer · ${a.incidencia || 0} incidencias abiertas`;
      pintar();
    } catch (e) { if (e.message !== "sesion") $("#ag-cuerpo").innerHTML = `<p class="empty">No se pudo cargar la agenda: ${esc(e.message)}</p>`; }
  }

  // La Agenda (calendario, por hacer, incidencias, avisos) y Pagos y compras comparten datos y formularios
  function pintar() {
    document.querySelectorAll("#a-tabs .ptab").forEach(b => b.setAttribute("aria-selected", b.dataset.t === st.tab ? "true" : "false"));
    document.querySelectorAll("#pg-tabs .ptab").forEach(b => b.setAttribute("aria-selected", b.dataset.t === st.ptab ? "true" : "false"));
    $("#ag-cuerpo").innerHTML = st.tab === "calendario" ? vistaCalendario() : st.tab === "aviso" ? vistaAvisos() : vistaLista(st.tab);
    conectar($("#ag-cuerpo"));
    $("#pg-cuerpo").innerHTML = vistaPagos();
    conectar($("#pg-cuerpo"));
  }

  // ---- Formularios ----
  const avisoSel = (v = "") => `<label>Recordarme<select name="aviso"><option value="">No</option>${[15, 60, 1440].map(m => `<option value="${m}" ${String(v) === String(m) ? "selected" : ""}>${AVISO_TXT[m]}</option>`).join("")}</select></label>`;
  function formulario(tipo, fecha) {
    if (tipo === "evento") return `<form class="aform" data-tipo="evento"><label class="w4">Nuevo evento<input name="titulo" maxlength="140" placeholder="Ej. Pago de luz, junta con proveedor" autocomplete="off"></label>
      <label>Fecha<input type="date" name="fecha" value="${esc(fecha)}"></label><label>Hora<input type="time" name="hora"></label>${avisoSel(60)}<button class="btn btn-primary" type="submit">Agregar</button><span class="err"></span></form>`;
    if (tipo === "tarea") return `<form class="aform" data-tipo="tarea"><label class="w4">Nueva tarea<input name="titulo" maxlength="140" placeholder="Ej. Pintar la caseta, renovar extintores" autocomplete="off"></label>
      <label>Fecha<input type="date" name="fecha"></label><label>Prioridad<select name="prioridad"><option value="normal">Normal</option><option value="alta">Alta</option></select></label>${avisoSel()}
      <label class="w4">Nota para el encargado <span style="font-weight:400">(opcional; la ve en la tablet)</span><input name="detalle" maxlength="1000" autocomplete="off"></label>
      <label class="chkl w2"><input type="checkbox" name="para_turno">Que la haga el encargado (tablet)</label><label>Turno<select name="turno"><option value="">Cualquiera</option>${Object.entries(TURNO_TXT).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></label><label>Repetir<select name="repetir"><option value="">No se repite</option><option value="diaria">Diario</option><option value="semanal">Cada semana</option><option value="mensual">Cada mes</option></select></label>
      <p class="note w4" style="margin:0">Para la tablet: aparece desde la fecha elegida (sin fecha, desde hoy) y se ve en su calendario. Si se repite, al cumplirse se programa la siguiente.</p>
      <button class="btn btn-primary" type="submit">Agregar</button><span class="err"></span></form>`;
    if (tipo === "pago") return `<form class="aform" data-tipo="pago"><label class="w2">Qué se paga<input name="titulo" maxlength="140" placeholder="Ej. Plan Telcel, tarjeta BBVA, Netflix" autocomplete="off"></label>
      <label>Importe aproximado<input name="importe" inputmode="decimal" placeholder="$0.00" autocomplete="off"></label><label>Próximo pago<input type="date" name="fecha" value="${esc(st.hoy)}"></label>
      <label>Se repite<select name="frecuencia">${Object.entries(st.frecuencias || {}).map(([k, v]) => `<option value="${k}" ${k === "mensual" ? "selected" : ""}>${v}</option>`).join("")}</select></label>${window.campoCategoria()}<label>Se paga con<select name="forma">${window.opcionesMedio("")}</select></label>
      <button class="btn btn-primary" type="submit">Programar</button><span class="err"></span><p class="note" style="margin:0;grid-column:1/-1;flex-basis:100%">Te llega en el correo diario cuando esté por vencer. Al pagarlo, confirma la fecha y el importe y se suma a Dinero.</p></form>`;
    if (tipo === "compra") return `<form class="aform" data-tipo="compra"><label class="w2">Qué hay que comprar<input name="titulo" maxlength="140" placeholder="Ej. Rollos de papel térmico" autocomplete="off"></label>
      <label>Cantidad<input name="cantidad" maxlength="40" placeholder="Ej. 2 cajas"></label><label>Urgencia<select name="prioridad"><option value="normal">Normal</option><option value="alta">Urgente</option></select></label><label>Dónde se compra${selLugar("")}</label>${window.campoCategoria("", "w2")}<button class="btn btn-primary" type="submit">Agregar</button><span class="err"></span></form>`;
    return `<form class="aform" data-tipo="incidencia"><label class="w4">Qué pasó<input name="titulo" maxlength="140" placeholder="Ej. Falla en la pluma de salida" autocomplete="off"></label>
      <label class="w4">Detalle <span style="font-weight:400">(opcional)</span><textarea name="detalle" rows="2" maxlength="1000"></textarea></label>
      <label>Fecha<input type="date" name="fecha" value="${esc(st.hoy)}"></label><label>Turno<select name="turno"><option value="">—</option>${Object.entries(TURNO_TXT).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></label>
      <label>Gravedad<select name="gravedad"><option value="leve">Leve</option><option value="media" selected>Media</option><option value="grave">Grave</option></select></label>
      <div class="w4 inc-fotos"><span class="lbl">Fotos <span style="font-weight:400">(opcional · hasta 8)</span></span>
        <div class="inc-fbtns"><label class="btn btn-line"><input type="file" accept="image/*" capture="environment" class="inc-f" hidden>Tomar foto</label><label class="btn btn-line"><input type="file" accept="image/*" multiple class="inc-f" hidden>Subir fotos</label></div>
        <div class="inc-prev"></div></div>
      <button class="btn btn-primary" type="submit">Reportar</button><span class="err"></span></form>`;
  }

  // ---- Elementos de lista ----
  // Edición de un registro ya creado (título, nota, fecha, prioridad, turno, destinatarios…)
  // Lugar donde se compra (lo elige la administración)
  const selLugar = (v, extra = "") => `<select name="lugar"${extra}><option value="">Sin lugar</option>${(st.lugares || []).map(l => `<option value="${esc(l.id)}" ${v === l.id ? "selected" : ""}>${esc(l.nombre)}</option>`).join("")}</select>`;
  function formEditar(it) {
    const sel = (n, ops, v) => `<select name="${n}">${ops.map(([k, t]) => `<option value="${esc(k)}" ${String(v ?? "") === k ? "selected" : ""}>${esc(t)}</option>`).join("")}</select>`;
    const T = TURNO_TXT, p = it.para || {};
    const campos = [`<label class="w4">Título<input name="titulo" maxlength="140" value="${esc(it.titulo)}" autocomplete="off"></label>`,
      `<label class="w4">${it.tipo === "tarea" ? "Nota para el encargado" : "Detalle"}<textarea name="detalle" rows="2" maxlength="1000">${esc(it.detalle || "")}</textarea></label>`];
    if (["evento", "tarea", "incidencia", "aviso"].includes(it.tipo)) campos.push(`<label>${it.tipo === "aviso" ? "Mostrar desde" : "Fecha"}<input type="date" name="fecha" value="${esc(it.fecha || "")}"></label>`);
    if (it.tipo === "evento") campos.push(`<label>Hora<input type="time" name="hora" value="${esc(it.hora || "")}"></label>`);
    if (it.tipo === "compra") campos.push(`<label>Dónde se compra${selLugar(it.lugar || "")}</label>`);
    if (["tarea", "compra", "aviso"].includes(it.tipo)) campos.push(`<label>${it.tipo === "aviso" ? "Importancia" : "Prioridad"}${sel("prioridad", [["normal", "Normal"], ["alta", it.tipo === "aviso" ? "Importante" : it.tipo === "compra" ? "Urgente" : "Alta"]], it.prioridad || "normal")}</label>`);
    if (it.tipo === "compra") campos.push(`<label>Cantidad<input name="cantidad" maxlength="40" value="${esc(it.cantidad || "")}"></label>`);
    if (it.tipo === "compra" || it.tipo === "pago") campos.push(window.campoCategoria(it.categoria));
    if (it.tipo === "pago") campos.push(`<label>Próximo pago<input type="date" name="fecha" value="${esc(it.fecha || "")}"></label><label>Importe aproximado<input name="importe" inputmode="decimal" value="${it.importe != null ? esc(it.importe) : ""}"></label><label>Se repite${sel("frecuencia", Object.entries(st.frecuencias || {}), it.frecuencia || "mensual")}</label><label>Se paga con<select name="forma">${window.opcionesMedio(window.valorMedio(it.forma, it.cuenta))}</select></label>`);
    if (it.tipo === "tarea") campos.push(`<label class="chkl w2"><input type="checkbox" name="para_turno" ${it.para_turno ? "checked" : ""}>Que la haga el encargado (tablet)</label><label>Turno${sel("turno", [["", "Cualquiera"], ...Object.entries(T)], it.turno || "")}</label><label>Repetir${sel("repetir", [["", "No se repite"], ["diaria", "Diario"], ["semanal", "Cada semana"], ["mensual", "Cada mes"]], it.repetir || "")}</label>`);
    if (it.tipo === "incidencia") campos.push(`<label>Gravedad${sel("gravedad", [["leve", "Leve"], ["media", "Media"], ["grave", "Grave"]], it.gravedad)}</label><label>Dónde<input name="area" maxlength="40" value="${esc(it.area || "")}"></label>`);
    if (it.tipo === "aviso") {
      const op = [["todos", "Todos los encargados"], ...Object.entries(T).map(([k, v]) => ["t:" + k, "Turno " + v.toLowerCase()]), ...(st.personas || []).filter(x => x.activo).map(x => ["p:" + x.clave, x.clave])];
      const on = v => v === "todos" ? !!p.todos : v.startsWith("t:") ? (p.turnos || []).includes(v.slice(2)) : (p.personas || []).includes(v.slice(2));
      campos.push(`<div class="w4 para-op"><span>Para</span>${op.map(([v, t]) => `<label class="pchip ${on(v) ? "on" : ""}"><input type="checkbox" data-para="${esc(v)}" ${on(v) ? "checked" : ""}>${esc(t)}</label>`).join("")}</div>`);
    }
    return `<form class="aform editar" data-id="${esc(it.id)}" data-tipo="${esc(it.tipo)}" aria-label="Editar ${esc(it.titulo)}">${campos.join("")}
      <div class="w4 row" style="display:flex;gap:8px"><button class="btn btn-primary" type="submit">Guardar cambios</button><button class="btn btn-line" type="button" data-cancelar>Cancelar</button></div><span class="err"></span></form>`;
  }
  function item(it) {
    if (st.editando === it.id) return formEditar(it);
    const hecho = !abierto(it);
    const del = `<button class="btn btn-line edit" type="button" data-editar="${esc(it.id)}" aria-label="Editar ${esc(it.titulo)}">Editar</button><button class="del" type="button" data-del="${esc(it.id)}" aria-label="Eliminar ${esc(it.titulo)}">${ico("i-trash")}</button>`;
    if (it.tipo === "pago") {
      const M = v => "$" + Number(v).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const venc = !hecho && it.fecha && it.fecha < st.hoy, hoyP = !hecho && it.fecha === st.hoy;
      const hist = (it.pagos || []).map(x => `<span>Pagado ${esc(diaTxt(x.fecha))} · ${M(x.importe)}${x.comprobante ? " · 📎" : ""}</span>`).join("");
      // Ya pagado: el único que se cerró, o el que se repite y ya se pagó este mes (su siguiente vencimiento es de otro mes)
      const mesHoy = st.hoy.slice(0, 7), ult = (it.pagos || [])[0];
      const pagadoMes = hecho || (ult && ult.fecha.slice(0, 7) === mesHoy && (it.fecha || "") .slice(0, 7) > mesHoy);
      return `<div class="aitem ${hecho ? "hecho pagado-ok" : ""}"><span class="grav ${pagadoMes ? "pagado" : venc ? "grave" : hoyP ? "media" : "leve"}" title="Pago programado">${ico(pagadoMes ? "i-check" : "i-billete")}</span>
        <span class="tt">${esc(it.titulo)}</span>
        <span class="acc">${pagadoMes ? `<span class="btn btn-pagado" title="${ult ? "Pagado el " + esc(diaTxt(ult.fecha)) + " por " + M(ult.importe) : "Pagado"}">${ico("i-check")}Pagado</span>` : `<button class="btn btn-primary" type="button" data-pagar="${esc(it.id)}" style="min-height:40px;padding:0 14px">Registrar pago</button>`}${del}</span>
        <span class="mm">${window.catChip(it.categoria)}${!pagadoMes && venc ? `<span class="tag vencida">Vencido</span>` : !pagadoMes && hoyP ? `<span class="tag hoy">Hoy</span>` : ""}${hecho ? "" : `<span>Próximo: <b>${esc(diaTxt(it.fecha))}</b></span>`}${it.importe != null ? `<span>aprox. ${M(it.importe)}</span>` : ""}<span>${esc((st.frecuencias || {})[it.frecuencia] || "")}</span><span>${esc(window.medioTxt(it.forma, it.cuenta))}</span></span>
        ${hist ? `<span class="mm informes">${hist}</span>` : ""}</div>`;
    }
    if (it.tipo === "incidencia") {
      return `<div class="aitem ${hecho ? "hecho" : ""}"><span class="grav ${esc(it.gravedad)}" title="Gravedad ${esc(it.gravedad)}">${ico("i-alerta")}</span>
        <span class="tt">${esc(it.titulo)}</span>
        <span class="acc"><select class="estado-sel" data-estado="${esc(it.id)}" aria-label="Estado">${[["abierta", "Abierta"], ["en_proceso", "En proceso"], ["resuelta", "Resuelta"]].map(([k, v]) => `<option value="${k}" ${it.estado === k ? "selected" : ""}>${v}</option>`).join("")}</select>${del}</span>
        <span class="mm">${it.reporto ? `<span class="tag tablet">${avP(it.reporto)}${esc(it.reporto)}</span>` : ""}${it.quien ? `<span>Reportó: <b>${esc(it.quien)}</b></span>` : ""}<span>${esc(diaTxt(it.fecha))}${it.turno ? " · " + esc(TURNO_TXT[it.turno] || it.turno) : ""}</span>${it.area ? `<span>${esc(it.area)}</span>` : ""}<span>Gravedad ${esc(it.gravedad)}</span>${it.detalle ? `<span>${esc(it.detalle)}</span>` : ""}</span>
        <span class="inc-gal">${fotosDe(it).map((k, i) => `<span class="inc-th"><a href="${urlFoto(k)}" target="_blank" rel="noopener"><img src="${urlFoto(k)}" alt="Foto ${i + 1} de la incidencia" loading="lazy"></a><button type="button" data-fquitar="${esc(it.id)}" data-k="${esc(k)}" aria-label="Quitar foto ${i + 1} (toca dos veces)">×</button></span>`).join("")}${fotosDe(it).length < 8 ? `<label class="inc-mas" title="Agregar fotos"><input type="file" accept="image/*" multiple hidden data-fmas="${esc(it.id)}">+ Fotos</label>` : ""}</span></div>`;
    }
    const fin = it.tipo === "compra" ? "comprado" : "hecho";
    const vencida = it.tipo === "tarea" && it.fecha && it.fecha < st.hoy && !hecho;
    const meta = [
      it.tipo === "compra" ? window.catChip(it.categoria) : "",
      it.tipo === "compra" && it.reporto ? `<span class="tag tablet" title="Pedida desde la tablet">${avP(it.reporto)}Pidió ${esc(it.reporto)}${it.turno ? " · " + esc((TURNO_TXT[it.turno] || it.turno).toLowerCase()) : ""} · ${esc(cuando(it.creado))}</span>` : "",
      it.tipo === "compra" && it.pospuesta && !hecho ? `<span class="tag otra">Para otra ocasión</span>` : "",
      it.tipo === "evento" ? `<span class="tag evento" style="color:#111">Evento</span>` : "",
      it.prioridad === "alta" && !hecho ? `<span class="tag alta">${it.tipo === "compra" ? "Urgente" : "Alta"}</span>` : "",
      vencida ? `<span class="tag vencida">Vencida</span>` : it.fecha === st.hoy && !hecho ? `<span class="tag hoy">Hoy</span>` : "",
      it.cantidad ? `<span>${esc(it.cantidad)}</span>` : "",
      it.tipo === "compra" && it.importe != null ? `<span>$${Number(it.importe).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${it.gasto_id ? " · en Dinero" : ""}</span>` : "",
      it.fecha && it.tipo !== "evento" ? `<span>${it.tipo === "tarea" ? "Límite " : ""}${esc(diaTxt(it.fecha))}</span>` : "",
      it.hora ? `<span>${esc(it.hora)}</span>` : "",
      it.aviso ? `<span>🔔 ${AVISO_TXT[it.aviso] || ""}</span>` : "",
      it.repetir ? `<span>🔁 ${{ diaria: "Diario", semanal: "Cada semana", mensual: "Cada mes" }[it.repetir] || ""}</span>` : "",
      it.para_turno ? `<span class="tag tablet">${ico("i-tablet")}Tablet${it.turno ? " · " + esc(TURNO_TXT[it.turno] || it.turno) : ""}</span>` : "",
      hecho && it.hecho_por && !(it.reportes || []).length ? `<span>Hecha por ${esc(it.hecho_por)} ${esc(cuando(it.cerrado))}${it.nota_cierre ? " · " + esc(it.nota_cierre) : ""}${foto(it.foto)}</span>` : ""
    ].filter(Boolean).join("");
    const RES = { cumplida: ["Cumplida", "ok"], parcial: ["En parte", "parcial"], no: ["No se pudo", "no"] };
    const informes = (it.reportes || []).slice(0, 3).map(r => `<span class="informe ${RES[r.resultado][1]}"><b>${RES[r.resultado][0]}</b> · ${avP(r.persona)}${esc(r.persona)}${r.turno ? " (" + esc((TURNO_TXT[r.turno] || r.turno).toLowerCase()) + ")" : ""} · ${esc(cuando(r.creado))}${r.nota ? " · " + esc(r.nota) : ""}${foto(r.foto)}</span>`).join("");
    return `<div class="aitem ${hecho ? "hecho" : ""}"><button class="chk ${hecho ? "on" : ""}" type="button" data-chk="${esc(it.id)}" data-fin="${fin}"${it.gasto_id ? ' data-gasto="1"' : ""} data-ini="${it.tipo === "evento" ? "programado" : "pendiente"}" aria-label="${hecho ? "Marcar pendiente" : "Marcar como hecho"}">${ico("i-check")}</button>
      <span class="tt">${esc(it.titulo)}</span><span class="acc">${it.tipo === "compra" && !hecho ? `<button class="btn btn-line btn-otra" type="button" data-posponer="${esc(it.id)}" data-v="${it.pospuesta ? 0 : 1}">${it.pospuesta ? "Regresar a la lista" : "Otra ocasión"}</button>` : ""}${it.tipo === "compra" && !hecho ? selLugar(it.lugar || "", ` class="lugar-sel" data-lugar="${esc(it.id)}" aria-label="Dónde se compra ${esc(it.titulo)}"`) : ""}${del}</span>${meta ? `<span class="mm">${meta}</span>` : ""}${(it.tipo === "tarea" || it.tipo === "compra") && it.detalle ? `<span class="mm">Nota: ${esc(it.detalle)}</span>` : ""}${informes ? `<span class="mm informes">${informes}</span>` : ""}</div>`;
  }

  // ---- Pagos hechos (programados o no) ----
  const MXN = v => "$" + Number(v).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const FORMA_TXT = { TRANSFERENCIA: "Transferencia", TARJETA: "Tarjeta", EFECTIVO: "Efectivo (sobres)" };
  function filaPagoHecho(p) {
    const editable = (st.mesesAbiertos || []).includes(p.fecha.slice(0, 7));
    return `<div class="aitem"><span class="grav pagado" title="Pagado">${ico("i-check")}</span>
      <span class="tt">${esc(p.titulo || "Pago")}</span>
      <span class="acc">${editable ? `<button class="btn btn-line edit" type="button" data-editar-pago="${esc(p.id)}">Editar</button><button class="del" type="button" data-borrar-pago="${esc(p.id)}" aria-label="Eliminar pago de ${esc(p.titulo || "")}">${ico("i-trash")}</button>` : ""}</span>
      <span class="mm"><span class="tag" style="background:#12301d;color:#30d158">Pagado</span>${window.catChip(p.categoria)}<span><b>${MXN(p.importe)}</b></span><span>${esc(diaTxt(p.fecha))}</span><span>${esc(window.medioTxt(p.forma, p.cuenta))}</span><span>${p.item_id ? "Programado" : "No programado"}</span>${p.comprobante ? `<a href="/panel/api/agenda/pagos/${esc(p.id)}/comprobante" target="_blank" rel="noopener">📎 ver comprobante</a>` : `<span>Sin comprobante</span>`}${p.nota ? `<span>${esc(p.nota)}</span>` : ""}</span></div>`;
  }
  function listaPagosHechos() {
    const ps = st.pagosHechos || [];
    if (!ps.length) return `<p class="note">Todavía no hay pagos registrados.</p>`;
    const meses = [...new Set(ps.map(p => p.fecha.slice(0, 7)))];
    const bloque = m => { const del = ps.filter(p => p.fecha.slice(0, 7) === m); return `<p class="ph-mes">${esc(mayus(fMes.format(new Date(m + "-15T12:00:00Z"))))}<b>${MXN(del.reduce((a, p) => a + p.importe, 0))}</b></p><div class="alist">${del.map(filaPagoHecho).join("")}</div>`; };
    return meses.slice(0, 2).map(bloque).join("") + (meses.length > 2 ? `<details class="hechos"><summary>Meses anteriores (${meses.length - 2})</summary>${meses.slice(2).map(bloque).join("")}</details>` : "");
  }

  // Ventana (diálogo) con instrucciones de llenado
  function ventana(titulo, guia, cuerpo) {
    const d = document.createElement("dialog"); d.className = "vent";
    d.innerHTML = `<div class="vent-in"><div class="vent-h"><h3>${esc(titulo)}</h3><button class="vent-x" type="button" aria-label="Cerrar">×</button></div><div class="vent-guia">${guia}</div>${cuerpo}</div>`;
    document.body.appendChild(d);
    d.querySelector(".vent-x").addEventListener("click", () => d.close());
    d.addEventListener("close", () => d.remove());
    d.showModal();
    return d;
  }
  const campoComp = `<label class="w4">Comprobante <span class="ayuda">(opcional · foto o PDF, máximo 10 MB)</span><input type="file" name="comprobante" accept="image/*,application/pdf"></label>`;
  async function subirComprobante(id, archivo) {
    let tipo = (archivo.type || "").toLowerCase();
    if (!tipo) tipo = /\.pdf$/i.test(archivo.name) ? "application/pdf" : /\.hei[cf]$/i.test(archivo.name) ? "image/heic" : "image/jpeg";
    if (archivo.size > 10 * 1024 * 1024) throw new Error("El comprobante pesa más de 10 MB.");
    const r = await fetch(`/panel/api/agenda/pagos/${encodeURIComponent(id)}/comprobante`, { method: "POST", headers: { "X-Panel": "1", "Content-Type": tipo }, body: archivo });
    const j = await r.json().catch(() => ({ ok: false, error: "No se pudo subir el comprobante." }));
    if (!j.ok) throw new Error(j.error);
  }

  function ventanaProgramar() {
    const guia = `<b>Cómo llenarlo</b><ol>
      <li><b>Qué se paga:</b> un nombre claro, por ejemplo «Plan Telcel 962…», «Tarjeta BBVA» o «Netflix».</li>
      <li><b>Importe aproximado:</b> lo que pagas normalmente. Al registrar el pago escribes el importe real.</li>
      <li><b>Próximo pago:</b> la fecha en que vence.</li>
      <li><b>Se repite:</b> cada mes, cada 2, 3, 6 o 12 meses, o una sola vez.</li>
      <li><b>Categoría:</b> elígela de la lista o escribe una nueva (por ejemplo «Servicios» o «Tarjetas y créditos»). Sirve para ver en qué se va el dinero.</li>
      <li><b>Se paga con:</b> «Efectivo (sobres)», la cuenta de la que sale o la tarjeta de crédito. Al registrar el pago lo puedes cambiar. Ninguno toca la caja de los turnos.</li>
    </ol>Aparece en el calendario y te llega en el correo diario 3 días antes. Cuando lo pagues, toca «Registrar pago».`;
    const d = ventana("Programar un pago", guia, `<form class="aform" novalidate>
      <label class="w4">Qué se paga<input name="titulo" maxlength="140" placeholder="Ej. Plan Telcel, tarjeta BBVA, Netflix" autocomplete="off"></label>
      <label>Importe aproximado<input name="importe" inputmode="decimal" placeholder="$0.00" autocomplete="off"></label>
      <label>Próximo pago<input type="date" name="fecha" value="${esc(st.hoy)}"></label>
      <label>Se repite<select name="frecuencia">${Object.entries(st.frecuencias || {}).map(([k, v]) => `<option value="${k}" ${k === "mensual" ? "selected" : ""}>${v}</option>`).join("")}</select></label>
      <label>Se paga con<select name="forma">${window.opcionesMedio("")}</select></label>
      ${window.campoCategoria("", "w4")}
      <span class="err"></span><div class="botones"><button class="btn btn-primary" type="submit">Programar</button><button class="btn btn-line" type="button" data-cerrar>Cancelar</button></div></form>`);
    const f = d.querySelector("form"); f.titulo.focus();
    d.querySelector("[data-cerrar]").addEventListener("click", () => d.close());
    f.addEventListener("submit", async ev => {
      ev.preventDefault(); const b = f.querySelector("[type=submit]"); b.disabled = true; f.querySelector(".err").textContent = "";
      try { await post("agenda", { tipo: "pago", titulo: f.titulo.value, importe: f.importe.value, fecha: f.fecha.value, frecuencia: f.frecuencia.value, forma: f.forma.value, categoria: f.categoria.value }); d.close(); toast("Pago programado"); await cargar(); }
      catch (e) { if (e.message !== "sesion") f.querySelector(".err").textContent = e.errores ? Object.values(e.errores).join(" ") : e.message; b.disabled = false; }
    });
  }

  // modo: "programado" (registrar el pago de un programado), "hecho" (pago sin programar), "editar" (corregir un pago ya registrado)
  function ventanaPago(modo, it, pago) {
    const mesAb = (st.mesesAbiertos || []).slice().sort()[0] || st.hoy.slice(0, 7);
    const v = pago || { fecha: st.hoy, importe: it && it.importe != null ? it.importe : "", forma: (it && it.forma) || "", cuenta: it && it.cuenta || null, titulo: "", nota: "", categoria: it && it.categoria || "" };
    const suelto = modo === "hecho" || (modo === "editar" && !pago.item_id);
    const titulo = modo === "editar" ? "Corregir pago" : modo === "hecho" ? "Registrar un pago o gasto ya hecho" : "Registrar pago: " + it.titulo;
    const guia = `<b>Cómo llenarlo</b><ol>
      ${suelto ? `<li><b>Qué pagaste:</b> un nombre claro, por ejemplo «Recibo de luz CFE», «Refacción de la pluma» o «Gasolina».</li>` : ""}
      <li><b>Fecha en que se pagó:</b> el día real del pago. No puede ser futura y debe ser de un mes abierto (el actual, o el anterior mientras no se cierra).</li>
      <li><b>Importe pagado:</b> lo que realmente pagaste, con centavos si los hay.</li>
      <li><b>Pagado con:</b> «Efectivo (sobres)», la cuenta de la que salió (transferencia o débito) o la tarjeta de crédito con que se pagó. Así cuadran los saldos de Dinero. No toca la caja de ningún turno.</li>
      <li><b>Categoría:</b> elígela de la lista o escribe una nueva.</li>
      <li><b>Comprobante (opcional):</b> toma foto del ticket o sube la captura o el PDF de la transferencia. Se guarda en Drive.</li>
      <li><b>Nota (opcional):</b> folio, referencia o lo que sirva para identificarlo.</li>
    </ol>${modo === "editar" ? "Al guardar se corrige también en Dinero." : `Al guardar se suma a los egresos de la administración (Dinero) y aparece en el calendario como pagado${modo === "programado" && it.frecuencia !== "unica" ? "; el pago programado pasa al siguiente periodo" : ""}.`}`;
    const d = ventana(titulo, guia, `<form class="aform" novalidate>
      ${suelto ? `<label class="w4">Qué pagaste<input name="titulo" maxlength="140" value="${esc(v.titulo || "")}" placeholder="Ej. Recibo de luz CFE" autocomplete="off"></label>` : ""}
      <label>Fecha en que se pagó<input type="date" name="fecha" value="${esc(v.fecha)}" min="${esc(mesAb)}-01" max="${esc(st.hoy)}"></label>
      <label>Importe pagado<input name="importe" inputmode="decimal" placeholder="$0.00" value="${esc(v.importe)}" autocomplete="off"></label>
      <label class="w2">Pagado con<select name="forma">${window.opcionesMedio(window.valorMedio(v.forma, v.cuenta || (it && it.forma === v.forma ? it.cuenta : null)))}</select></label>
      ${window.campoCategoria(v.categoria, "w2")}
      ${campoComp}${modo === "editar" && pago.comprobante ? `<label class="chkl w4" style="flex-direction:row"><input type="checkbox" name="quitar"> Quitar el comprobante actual (<a href="/panel/api/agenda/pagos/${esc(pago.id)}/comprobante" target="_blank" rel="noopener">ver</a>)</label>` : ""}
      <label class="w4">Nota <span class="ayuda">(opcional)</span><input name="nota" maxlength="300" value="${esc(v.nota || "")}" placeholder="Ej. referencia 123456" autocomplete="off"></label>
      <div class="dup" hidden></div><span class="err"></span>
      <div class="botones"><button class="btn btn-primary" type="submit">${modo === "editar" ? "Guardar cambios" : "Confirmar pago"}</button><button class="btn btn-line" type="button" data-cerrar>Cancelar</button></div></form>`);
    const f = d.querySelector("form");
    (f.titulo || f.importe).focus();
    d.querySelector("[data-cerrar]").addEventListener("click", () => d.close());
    let forzar = false;
    const enviar = async () => {
      const b = f.querySelector("[type=submit]"); b.disabled = true; f.querySelector(".err").textContent = "";
      const cuerpo = { fecha: f.fecha.value, importe: f.importe.value, forma: f.forma.value, nota: f.nota.value, categoria: f.categoria.value, ...(f.titulo ? { titulo: f.titulo.value } : {}), ...(forzar ? { forzar: 1 } : {}) };
      let id;
      try {
        if (modo === "editar") { await post(`agenda/pagos/${pago.id}/editar`, cuerpo); id = pago.id; }
        else if (modo === "hecho") id = (await post("agenda/pagos/hecho", cuerpo)).id;
        else {
          const r = await fetch(`/panel/api/agenda/${encodeURIComponent(it.id)}/pagar`, { method: "POST", headers: { "X-Panel": "1", "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) });
          const j = await r.json().catch(() => ({ ok: false, error: "Respuesta inválida." }));
          if (j.duplicado) {
            const dup = f.querySelector(".dup");
            dup.innerHTML = `<span>⚠️ ${esc(j.error)} ¿Es un pago distinto? Si solo querías corregir aquel, cancela y usa «Editar» en ese pago (en «Pagos hechos»).</span><div><button class="btn btn-primary" type="button" data-otro>Sí, es otro pago</button></div>`;
            dup.hidden = false; b.disabled = false;
            dup.querySelector("[data-otro]").addEventListener("click", () => { forzar = true; dup.hidden = true; enviar(); });
            return;
          }
          if (!j.ok) { const e = new Error(j.error || "Error"); e.errores = j.errores; throw e; }
          id = j.id;
        }
      } catch (e) { if (e.message !== "sesion") f.querySelector(".err").textContent = e.errores ? Object.values(e.errores).join(" ") : e.message; b.disabled = false; return; }
      let aviso = "";
      try {
        if (f.quitar && f.quitar.checked) await post(`agenda/pagos/${id}/quitar-comprobante`);
        const arch = f.comprobante.files[0];
        if (arch) { b.textContent = "Subiendo comprobante…"; await subirComprobante(id, arch); }
      } catch (e) { aviso = " · " + e.message + " Puedes subirlo después con «Editar»."; }
      d.close(); toast((modo === "editar" ? "Pago corregido" : "Pago registrado") + aviso); await cargar();
    };
    f.addEventListener("submit", ev => { ev.preventDefault(); enviar(); });
  }

  function vistaLista(tipo) {
    const todos = st.items.filter(x => x.tipo === tipo);
    const ab = todos.filter(abierto), ce = todos.filter(x => !abierto(x));
    if (tipo === "tarea") ab.sort((a, b) => (b.prioridad === "alta") - (a.prioridad === "alta") || (a.fecha || "9999").localeCompare(b.fecha || "9999"));
    if (tipo === "compra") ab.sort((a, b) => (b.prioridad === "alta") - (a.prioridad === "alta"));
    if (tipo === "incidencia") { const g = { grave: 0, media: 1, leve: 2 }; ab.sort((a, b) => g[a.gravedad] - g[b.gravedad] || b.fecha.localeCompare(a.fecha)); }
    if (tipo === "pago") {
      // Los de una sola vez pagados este mes siguen a la vista (con su botón verde "Pagado")
      const mesHoy = st.hoy.slice(0, 7), esteMes = x => (x.pagos || []).some(p => p.fecha.slice(0, 7) === mesHoy);
      for (let i = ce.length - 1; i >= 0; i--) if (esteMes(ce[i])) ab.push(ce.splice(i, 1)[0]);
      ab.sort((a, b) => abierto(b) - abierto(a) || (a.fecha || "9999").localeCompare(b.fecha || "9999"));
    }
    const vacio = { tarea: "No hay nada por hacer. 🎉", compra: "No hay compras pendientes.", incidencia: "No hay incidencias abiertas.", pago: "No hay pagos programados." }[tipo];
    const fin = { tarea: "Hechas", compra: "Compradas", incidencia: "Resueltas", pago: "Pagos únicos ya hechos" }[tipo];
    if (tipo === "pago") return `<section class="card"><div class="pago-acc"><button class="btn btn-primary" type="button" data-nuevo-pago="programar">${ico("i-cal")}Programar un pago</button><button class="btn btn-line" type="button" data-nuevo-pago="hecho">${ico("i-billete")}Registrar un pago o gasto ya hecho</button></div>
        <p class="note" style="margin:10px 0 0">Programa lo que pagas seguido (planes, suscripciones, tarjetas). Si ya pagaste algo que no estaba programado, regístralo como pago o gasto hecho. Todo aparece en el calendario y se suma a Dinero.</p></section>
      <section class="card"><h3>Programados</h3><div class="alist">${ab.length ? ab.map(item).join("") : `<p class="note">${vacio}</p>`}</div>
      ${ce.length ? `<details class="hechos"><summary>${fin} en los últimos 30 días (${ce.length})</summary><div class="alist">${ce.map(item).join("")}</div></details>` : ""}</section>`;
    return `<section class="card">${formulario(tipo)}</section>
      <section class="card"><div class="alist">${ab.length ? ab.map(item).join("") : `<p class="note">${vacio}</p>`}</div>
      ${ce.length ? `<details class="hechos"><summary>${fin} en los últimos 30 días (${ce.length})</summary><div class="alist">${ce.map(item).join("")}</div></details>` : ""}</section>`;
  }

  // ---- Compras agrupadas por el lugar donde se compran ----
  function vistaCompras() {
    const todos = st.items.filter(x => x.tipo === "compra");
    const ab = todos.filter(abierto).sort((a, b) => (b.prioridad === "alta") - (a.prioridad === "alta") || (a.creado || "").localeCompare(b.creado || ""));
    const ce = todos.filter(x => !abierto(x));
    const lugares = st.lugares || [], ids = new Set(lugares.map(l => l.id));
    const sin = ab.filter(x => !x.lugar || !ids.has(x.lugar));
    const grupo = (nombre, l, cls = "") => `<div class="lg-grupo ${cls}"><h3 class="lg-h">${ico("i-carrito")}<span>${esc(nombre)}</span><span class="n">${l.filter(x => !x.pospuesta).length}</span>${l.some(x => x.prioridad === "alta" && !x.pospuesta) ? `<span class="tag alta">Urgente</span>` : ""}</h3><div class="alist">${l.map(item).join("")}</div></div>`;
    // Dentro de cada lugar, lo que se deja para otra ocasión va al final
    const orden = l => [...l.filter(x => !x.pospuesta), ...l.filter(x => x.pospuesta)];
    const deLugar = id => id === "sin" ? sin : ab.filter(i => i.lugar === id);
    // Filtro "Para comprar en": al llegar a la tienda se ve solo lo de ahí
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
    let grupos;
    if (fl) {
      const nombre = fl === "sin" ? "Sin lugar" : lugares.find(l => l.id === fl).nombre;
      const lst = deLugar(fl), por = lst.filter(x => !x.pospuesta), otra = lst.filter(x => x.pospuesta);
      grupos = `<div class="lg-grupo ${fl === "sin" ? "sin" : ""}"><h3 class="lg-h">${ico("i-carrito")}<span>${esc(nombre)}</span><span class="n">${por.length}</span>${por.some(x => x.prioridad === "alta") ? `<span class="tag alta">Urgente</span>` : ""}</h3>
          ${por.length ? `<div class="alist">${por.map(item).join("")}</div>` : `<p class="note lg-listo">${lst.length ? "Ya no queda nada por comprar aquí en esta visita." : "No hay nada pendiente por comprar aquí."}</p>`}
          ${otra.length ? `<h4 class="lg-otra-h">Para otra ocasión (${otra.length})</h4><div class="alist lg-otra">${otra.map(item).join("")}</div>` : ""}</div>`;
    } else {
      grupos = (sin.length ? grupo("Sin lugar · elige dónde se compra", orden(sin), "sin") : "")
        + lugares.map(l => { const x = deLugar(l.id); return x.length ? grupo(l.nombre, orden(x)) : ""; }).join("");
    }
    const adm = `<details class="lg-adm"><summary>Lugares de compra (${lugares.length})</summary>
        <p class="note" style="margin:6px 0 10px">Tú decides dónde se compra cada cosa; la tablet solo pide qué hace falta. Si algo ya se compró antes en un lugar, la compra nueva se va sola a ese lugar.</p>
        <div class="lg-lista">${lugares.map(l => `<form class="lg-fila" data-lid="${esc(l.id)}"><input name="nombre" value="${esc(l.nombre)}" maxlength="40" aria-label="Nombre del lugar"><button class="btn btn-line btn-sm" type="submit">Guardar</button><button class="btn btn-line btn-sm" type="button" data-lquitar="${esc(l.id)}" aria-label="Quitar ${esc(l.nombre)}">Quitar</button></form>`).join("")}</div>
        <form class="lg-fila" id="lg-nuevo"><input name="nombre" maxlength="40" placeholder="Nuevo lugar (ej. Ferretería Martínez)" aria-label="Nuevo lugar"><button class="btn btn-primary btn-sm" type="submit">Agregar</button></form>
      </details>`;
    return `<section class="card">${formulario("compra")}</section>
      <section class="card">${filtro}${ab.length ? grupos : `<p class="note">No hay compras pendientes.</p>`}${adm}
      ${ce.length ? `<details class="hechos"><summary>Compradas en los últimos 30 días (${ce.length})</summary><div class="alist">${ce.map(item).join("")}</div></details>` : ""}</section>`;
  }

  // ---- Pagos y compras (sección propia) ----
  function vistaPagos() {
    const mes = (st.hoy || "").slice(0, 7);
    const finMes = mes ? new Date(Date.UTC(+mes.slice(0, 4), +mes.slice(5, 7), 0)).toISOString().slice(0, 10) : "";
    const prog = st.items.filter(x => x.tipo === "pago" && abierto(x));
    const porPagar = prog.filter(x => x.fecha && x.fecha <= finMes), vencidos = prog.filter(x => x.fecha && x.fecha < st.hoy);
    const hechosMes = (st.pagosHechos || []).filter(p => p.fecha.slice(0, 7) === mes);
    const compras = st.items.filter(x => x.tipo === "compra");
    const compradasMes = compras.filter(x => x.estado === "comprado" && x.importe != null && (x.cerrado ? new Date(Date.parse(x.cerrado) - 216e5).toISOString().slice(0, 7) === mes : false));
    const sum = (l, f) => l.reduce((a, x) => a + (Number(f(x)) || 0), 0);
    const resumen = `<section class="card"><div class="ctot pg-res">
        <div class="k"><span>Por pagar este mes</span><b>${MXN(sum(porPagar, x => x.importe))}</b><small>${porPagar.length} ${porPagar.length === 1 ? "pago" : "pagos"}${vencidos.length ? ` · <span style="color:#ff6961">${vencidos.length} ${vencidos.length === 1 ? "vencido" : "vencidos"}</span>` : ""}</small></div>
        <div class="k dest"><span>Pagado este mes</span><b>${MXN(sum(hechosMes, p => p.importe))}</b><small>${hechosMes.length} ${hechosMes.length === 1 ? "registro" : "registros"}</small></div>
        <div class="k"><span>Compras del mes</span><b>${MXN(sum(compradasMes, x => x.importe))}</b><small>${compras.filter(abierto).length} por comprar</small></div>
      </div><p class="note" style="margin:8px 0 0">Todo esto sale de la administración: el efectivo de los sobres o el banco. No toca la caja de ningún turno; se suma a los egresos en Dinero.</p></section>`;
    if (st.ptab === "hechos") return resumen + `<section class="card"><div class="pago-acc"><button class="btn btn-primary" type="button" data-nuevo-pago="hecho">${ico("i-billete")}Registrar un pago o gasto ya hecho</button></div>
        <p class="note" style="margin:10px 0 0">Para lo que ya pagaste y no estaba programado: un recibo, una refacción, gasolina, una comida… Lleva comprobante opcional.</p></section>
      <section class="card"><h3>Pagos y gastos hechos</h3>${listaPagosHechos()}</section>`;
    if (st.ptab === "compra") return resumen + vistaCompras();
    if (st.ptab === "categorias") {
      const ICONOS = ["servicios", "sueldos", "renta", "mantenimiento", "papeleria", "combustible", "impuestos", "tarjetas", "suscripciones", "familia", "otros", "carrito", "comida", "salud", "transporte", "limpieza"];
      return `<section class="card"><h3>Categorías</h3><p class="note" style="margin:4px 0 12px">Se usan en pagos, compras y gastos de caja. Una categoría nueva se crea sola cuando la escribes en un formulario; aquí le eliges su icono.</p>
        <div class="cat-lista">${(window.CATS || []).map(c => `<div class="cat-fila" style="--c:${esc(c.color)}"><span class="ci"><svg aria-hidden="true"><use href="#i-cat-${esc(c.icono)}"/></svg></span><b>${esc(c.nombre)}</b>
          <div class="cat-icos" role="group" aria-label="Icono de ${esc(c.nombre)}">${ICONOS.map(i => `<button type="button" data-cat="${esc(c.nombre)}" data-ico="${i}" aria-pressed="${i === c.icono}" aria-label="${i}"><svg aria-hidden="true"><use href="#i-cat-${i}"/></svg></button>`).join("")}</div></div>`).join("")}</div>
        <form class="aform" id="cat-nueva" style="margin-top:14px"><label class="w2">Nueva categoría<input name="nombre" maxlength="40" placeholder="Ej. Publicidad" autocomplete="off"></label><button class="btn btn-primary" type="submit">Agregar</button><span class="err"></span></form></section>`;
    }
    return resumen + vistaLista("pago");
  }

  // ---- Avisos para la tablet ----
  function vistaAvisos() {
    const todos = st.items.filter(x => x.tipo === "aviso");
    const act = todos.filter(abierto).sort((a, b) => b.creado.localeCompare(a.creado)), arch = todos.filter(x => !abierto(x));
    const activos = (st.personas || []).filter(p => p.activo);
    const T = { "MAÑANA": "mañana", "TARDE": "tarde", "NOCHE": "noche" };
    const paraTxt = p => [p.admin ? "Administración" : "", p.todos ? "Todos los encargados" : "", ...(p.turnos || []).map(t => "Turno " + T[t]), ...(p.personas || [])].filter(Boolean).join(", ") || "Todos";
    const deTxt = it => it.autor === "admin" ? "Administración" : (activos.find(p => p.clave === it.autor) || { nombre: it.autor }).nombre + " (" + it.autor + ")";
    const leidoAdmin = it => (it.lecturas || []).some(l => l.persona === "ADMIN");
    const lecturas = it => {
      const p = it.para || {};
      // Encargados a los que va dirigido (por turno no se sabe quién: se muestran todos)
      const dest = p.todos || (p.turnos || []).length ? activos : activos.filter(x => (p.personas || []).includes(x.clave));
      const l = new Map((it.lecturas || []).map(x => [x.persona, x.at]));
      return dest.filter(x => x.clave !== it.autor).map(x => l.has(x.clave) ? `<span class="lect si" title="Enterado ${esc(cuando(l.get(x.clave)))}">✓ ${esc(x.clave)} ${esc(cuando(l.get(x.clave)).replace(/^.*?, /, ""))}</span>` : `<span class="lect" title="Todavía no lo lee">${esc(x.clave)}</span>`).join("");
    };
    const fila = it => {
      if (st.editando === it.id) return `<div class="aitem">${formEditar(it)}</div>`;
      const deEnc = it.autor !== "admin", paraAdmin = it.para && it.para.admin, nuevo = deEnc && paraAdmin && abierto(it) && !leidoAdmin(it);
      return `<div class="aitem ${abierto(it) ? "" : "hecho"}">${avP(deEnc ? it.autor : "admin", 1)}
      <span class="tt">${nuevo ? `<span class="tag hoy" style="margin-right:6px">Nuevo</span>` : ""}${esc(it.titulo)}</span>
      <span class="acc">${nuevo ? `<button class="btn btn-primary" type="button" data-leer="${esc(it.id)}" style="min-height:40px;padding:0 12px">Enterado</button>` : ""}${deEnc ? `<button class="btn btn-line" type="button" data-responder="${esc(it.id)}" style="min-height:40px;padding:0 12px">Responder</button>` : ""}${abierto(it) ? `<button class="btn btn-line" type="button" data-archivar="${esc(it.id)}" style="min-height:40px;padding:0 12px">Archivar</button>` : `<button class="btn btn-line" type="button" data-reactivar="${esc(it.id)}" style="min-height:40px;padding:0 12px">Reactivar</button>`}${it.autor === "admin" ? `<button class="btn btn-line edit" type="button" data-editar="${esc(it.id)}">Editar</button>` : ""}<button class="del" type="button" data-del="${esc(it.id)}" aria-label="Eliminar ${esc(it.titulo)}">${ico("i-trash")}</button></span>
      <span class="mm"><span>De <b>${esc(deTxt(it))}</b> para <b>${esc(paraTxt(it.para || {}))}</b></span>${it.prioridad === "alta" ? `<span class="tag alta">Importante</span>` : ""}<span>${esc(cuando(it.creado))}</span>${it.fecha && it.fecha > st.hoy ? `<span>Se muestra desde ${esc(diaTxt(it.fecha))}</span>` : ""}${it.detalle ? `<span>${esc(it.detalle)}</span>` : ""}${deEnc && paraAdmin && leidoAdmin(it) ? `<span class="lect si">✓ Leído por ti</span>` : ""}</span>
      <span class="mm" style="margin-top:4px">${lecturas(it)}</span></div>`;
    };
    const r = st.resp || {}; st.resp = null;
    const opPara = [["todos", "Todos los encargados"], ...Object.entries(T).map(([k, v]) => ["t:" + k, "Turno " + v]), ...activos.map(p => ["p:" + p.clave, p.clave])];
    const marcado = v => r.persona ? v === "p:" + r.persona : v === "todos";
    return `<section class="card"><form class="aform" data-tipo="aviso"><label class="w4">${r.persona ? "Responder a " + esc(r.persona) : "Nuevo aviso para los encargados"}<input name="titulo" maxlength="140" placeholder="Ej. Mañana viene el técnico de la báscula" autocomplete="off" value="${esc(r.titulo || "")}"></label>
      <label class="w4">Mensaje <span style="font-weight:400">(opcional)</span><textarea name="detalle" rows="2" maxlength="1000"></textarea></label>
      <div class="w4 para-op"><span>Para</span>${opPara.map(([v, t]) => `<label class="pchip ${marcado(v) ? "on" : ""}"><input type="checkbox" data-para="${esc(v)}" ${marcado(v) ? "checked" : ""}>${esc(t)}</label>`).join("")}</div>
      <label>Mostrar desde<input type="date" name="fecha"></label><label>Importancia<select name="prioridad"><option value="normal">Normal</option><option value="alta">Importante</option></select></label>
      <button class="btn btn-primary" type="submit">Publicar</button><span class="err"></span></form>
      <p class="note" style="margin:10px 0 0">Se ve en la tablet hasta que lo archives. Cada encargado marca "Enterado". Los encargados también pueden dejarte avisos a ti o entre ellos; aquí los ves todos.</p></section>
      <section class="card"><div class="alist">${act.length ? act.map(fila).join("") : `<p class="note">No hay avisos activos.</p>`}</div>
      ${arch.length ? `<details class="hechos"><summary>Archivados en los últimos 30 días (${arch.length})</summary><div class="alist">${arch.map(fila).join("")}</div></details>` : ""}</section>`;
  }

  // ---- Turno: turno activo, encargados de la tablet (cada dato se guarda por separado) y cortes ciegos ----
  // modo "curso": turno abierto en la tablet; modo "encargados": encargados de la tablet (sección Turnos)
  let modoTablet = "encargados";
  async function vistaTablet(modo) {
    if (modo) modoTablet = modo; else modo = modoTablet;
    const c = $("#t-cuerpo");
    if (!c.innerHTML.trim()) c.innerHTML = `<p class="empty">Cargando…</p>`;
    let j, act = null, colabs = [];
    try {
      [j, act] = await Promise.all([api("turno"), api("turno/activo").then(x => x.activo).catch(() => null)]);
      st.personas = j.personas;
    } catch (e) { if (e.message !== "sesion") c.innerHTML = `<p class="empty">${esc(e.message)}</p>`; return; }
    try { colabs = ((await api("colaboradores?tipo=colaborador&estatus=activo")).colaboradores || []); } catch {}
    const DIN = v => (v < 0 ? "−" : "") + "$" + Math.abs(Number(v) || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const dif = v => v == null ? "" : Math.abs(v) < 1 ? `<span class="dif ok">✓ Cuadra</span>` : v < 0 ? `<span class="dif falta">▼ Faltan ${DIN(-v)}</span>` : `<span class="dif sobra">▲ Sobran ${DIN(v)}</span>`;
    const avs = j.avatares || [];
    const AV = id => `/panel/api/turno/avatar/${encodeURIComponent(id)}`;
    const k = p => esc(p.clave);
    const selAv = p => avs.length ? `<fieldset class="avs" data-avbase="${k(p)}"><legend>Avatar base${p.avatar === "foto" ? ` · ahora usa su foto <button type="button" class="lnk-q" data-quitarfoto="${k(p)}">Quitar foto</button>` : ""}</legend>
        <label title="Sin avatar"><input type="radio" name="avb-${k(p)}" value="" ${p.avatar_base ? "" : "checked"} aria-label="Sin avatar base"><span class="sin">${esc(p.clave.slice(0, 4))}</span></label>
        ${avs.map((a, i) => `<label title="Avatar ${i + 1}"><input type="radio" name="avb-${k(p)}" value="${esc(a)}" ${p.avatar_base === a ? "checked" : ""} aria-label="Avatar ${i + 1}"><img src="${AV(a)}" alt="" width="38" height="38" loading="lazy"></label>`).join("")}</fieldset>` : "";
    const selExp = p => `<label class="exp-sel">Expediente<select data-exp="${k(p)}" aria-label="Expediente de ${k(p)}"><option value="">Sin vincular</option>${colabs.map(x => `<option value="${esc(x.id)}" ${p.colaborador === x.id ? "selected" : ""}>${esc(x.nombre)} · ${esc(x.folio)}</option>`).join("")}</select></label>`;
    const enc = p => `<div class="enc ${p.activo ? "" : "inactivo"}"><span class="av ${p.avatar_url ? "foto" : ""}">${p.avatar_url ? `<img src="${esc(p.avatar_url)}" alt="" width="46" height="46">` : esc(p.clave.slice(0, 5))}</span>
      <span class="nm"><b>${esc(p.nombre)}</b><span>${p.activo ? (p.bloqueado ? `<span class="estp bloq">Bloqueado</span>` : p.tiene_pin ? `<span class="estp ok">✓ PIN listo</span>` : `<span class="estp no">Sin PIN</span>`) : "Desactivado"}${p.ultimo_acceso ? " · entró " + esc(cuando(p.ultimo_acceso)) : ""}</span></span>
      <div class="ajustes">
        <form class="aj" data-nombre="${k(p)}" autocomplete="off"><input class="nom" name="nombre" value="${esc(p.nombre)}" maxlength="60" aria-label="Nombre de ${k(p)}"><button class="btn btn-line btn-aj" type="submit">Guardar nombre</button></form>
        <form class="aj" data-pin="${k(p)}" autocomplete="off"><input class="pin" name="pin" inputmode="numeric" pattern="[0-9]*" maxlength="4" placeholder="PIN" aria-label="Nuevo PIN de ${k(p)}" autocomplete="new-password"><button class="btn btn-primary btn-aj" type="submit">Guardar PIN</button></form>
        ${selExp(p)}${selAv(p)}<span class="err" data-err="${k(p)}"></span>
      </div>
      <span class="ac">${p.bloqueado ? `<button class="btn btn-line" type="button" data-desbloquear="${k(p)}" style="min-height:34px;padding:0 12px">Desbloquear</button>` : ""}<button class="btn btn-line" type="button" data-activo="${k(p)}" data-v="${p.activo ? 0 : 1}" style="min-height:34px;padding:0 12px">${p.activo ? "Desactivar" : "Activar"}</button></span></div>`;
    const secActivo = `<section class="card ${act ? "t-activo" : ""}"><h3>Turno activo</h3>
        ${act ? `<div class="t-act">${avP(act.persona, 1)}<div><b>${esc(act.nombre)}</b> <span class="note">(${esc(act.persona)})</span><div class="note">Turno de la ${esc((TURNO_TXT[act.turno] || act.turno).toLowerCase())} del ${esc(diaTxt(act.dia))} · desde ${esc(cuando(act.desde))} · cambio inicial ${act.cambio_inicial != null ? DIN(act.cambio_inicial) : "sin capturar"} · <b style="color:var(--warn)">sin corte</b></div></div></div>
          <p class="note" style="margin:10px 0">Mientras este turno no tenga corte, nadie más puede entrar a la tablet. Si la persona ya no va a regresar, cierra su turno: se cierra su sesión y la tablet queda libre; el corte quedará pendiente en Cortes.</p>
          <button class="btn btn-bad" type="button" id="t-cerrar">Cerrar turno de ${esc(act.persona)}</button>`
        : `<p class="note" style="margin:6px 0 0">No hay turnos abiertos sin corte.</p>`}</section>`;
    const secEnc = `<section class="card"><h3>Encargados de turno</h3>
        <p class="note" style="margin:4px 0 8px">Cada dato se guarda por separado: el nombre y el PIN con su botón; el expediente y el avatar base se guardan en cuanto los eliges. Al cambiar un PIN, el anterior deja de servir. Cada encargado puede cambiar su imagen (su avatar base, una foto suya o sus iniciales), color y tamaño de letra desde la tablet, tocando su nombre arriba.</p>
        <div>${j.personas.map(enc).join("") || `<p class="note">Sin encargados.</p>`}</div>
        <details style="margin-top:10px"><summary class="note" style="cursor:pointer;font-weight:600">Agregar encargado</summary>
          <form class="aform" id="enc-nuevo" style="margin-top:10px"><label>Clave<input name="clave" maxlength="12" placeholder="Ej. MAR" autocomplete="off"></label><label>Nombre<input name="nombre" maxlength="60" autocomplete="off"></label><label>PIN<input name="pin" inputmode="numeric" maxlength="4" autocomplete="new-password"></label><button class="btn btn-primary" type="submit">Agregar</button><span class="err"></span></form></details>
      </section>`;
    const secComo = `<section class="card"><h3>Cómo se abre</h3><p class="note" style="margin:6px 0 0">En la tablet: <b>basculaypension.com/turno</b>, con la cuenta de entrada. Desde el navegador se puede "Agregar a la pantalla de inicio" para usarla como app.</p></section>`;
    c.innerHTML = modo === "curso" ? secActivo : secEnc + secComo;
    const errDe = clave => c.querySelector(`[data-err="${CSS.escape(clave)}"]`);
    const guardar = async (clave, datos, msg = "Guardado") => {
      const e = clave && errDe(clave); if (e) e.textContent = "";
      try { await post("turno/personas" + (clave ? "/" + encodeURIComponent(clave) : ""), datos); toast(msg); st.personas = null; vistaTablet(); return true; }
      catch (er) { if (er.message !== "sesion") { if (e) e.textContent = er.message; else toast(er.message); } return false; }
    };
    if (modo === "curso") { const cerr = $("#t-cerrar"); if (cerr) cerr.addEventListener("click", async () => { if (!(await EC.confirmar(`¿Cerrar el turno de ${act.persona} sin corte?`, "Su sesión se cierra y la tablet queda libre.", "Cerrar turno", true))) return; try { await post("turno/cerrar", {}); toast("Turno cerrado"); vistaTablet("curso"); } catch (e) { if (e.message !== "sesion") toast(e.message); } }); return; }
    c.querySelectorAll("form[data-nombre]").forEach(f => f.addEventListener("submit", ev => { ev.preventDefault(); guardar(f.dataset.nombre, { nombre: f.nombre.value }, "Nombre guardado"); }));
    c.querySelectorAll("form[data-pin]").forEach(f => f.addEventListener("submit", ev => {
      ev.preventDefault();
      if (!/^\d{4}$/.test(f.pin.value)) { errDe(f.dataset.pin).textContent = "El PIN debe ser de 4 números."; return; }
      guardar(f.dataset.pin, { pin: f.pin.value }, "PIN guardado");
    }));
    c.querySelectorAll("select[data-exp]").forEach(sel => sel.addEventListener("change", () => guardar(sel.dataset.exp, { colaborador: sel.value }, sel.value ? "Expediente vinculado" : "Expediente desvinculado")));
    c.querySelectorAll("fieldset[data-avbase]").forEach(fs => fs.addEventListener("change", e => { if (e.target.matches("input[type=radio]")) guardar(fs.dataset.avbase, { avatar_base: e.target.value }, "Avatar guardado"); }));
    c.querySelectorAll("[data-quitarfoto]").forEach(b => b.addEventListener("click", () => guardar(b.dataset.quitarfoto, { quitar_foto: 1 }, "Foto quitada")));
    c.querySelectorAll("[data-desbloquear]").forEach(b => b.addEventListener("click", () => guardar(b.dataset.desbloquear, { desbloquear: 1 }, "Desbloqueado")));
    c.querySelectorAll("[data-activo]").forEach(b => b.addEventListener("click", () => guardar(b.dataset.activo, { activo: b.dataset.v === "1" })));
    $("#enc-nuevo").addEventListener("submit", ev => {
      ev.preventDefault(); const f = ev.target; f.querySelector(".err").textContent = "";
      post("turno/personas", { clave: f.clave.value, nombre: f.nombre.value, pin: f.pin.value }).then(() => { toast("Encargado agregado"); vistaTablet(); }).catch(er => { if (er.message !== "sesion") f.querySelector(".err").textContent = er.message; });
    });
  }
  window.turnoVista = vistaTablet;

  function vistaCalendario() {
    const [a, m] = st.mes.split("-").map(Number);
    const primero = new Date(Date.UTC(a, m - 1, 1));
    const inicio = new Date(primero); inicio.setUTCDate(1 - ((primero.getUTCDay() + 6) % 7)); // semana inicia en lunes
    const porDia = {};
    for (const it of st.items) if (it.tipo !== "aviso" && (it.fecha && abierto(it) || (it.fecha && it.tipo === "evento"))) (porDia[it.fecha] = porDia[it.fecha] || []).push(it);
    for (const p of st.pagosHechos || []) (porDia[p.fecha] = porDia[p.fecha] || []).push({ tipo: "pagado" });
    let celdas = ["Lu", "Ma", "Mi", "Ju", "Vi", "Sá", "Do"].map(d => `<span class="dow">${d}</span>`).join("");
    for (let i = 0; i < 42; i++) {
      const d = new Date(inicio); d.setUTCDate(inicio.getUTCDate() + i);
      const iso = d.toISOString().slice(0, 10);
      const its = porDia[iso] || [];
      const tipos = [...new Set(its.map(x => x.tipo))].filter(t => t !== "compra");
      const nPend = its.filter(x => x.tipo !== "pagado").length;
      celdas += `<button class="d ${d.getUTCMonth() !== m - 1 ? "fuera" : ""} ${iso === st.hoy ? "hoy" : ""} ${iso === st.sel ? "sel" : ""}" type="button" data-dia="${iso}" aria-label="${esc(fLargo.format(d))}${nPend ? `, ${nPend} pendientes` : ""}${tipos.includes("pagado") ? ", con pagos hechos" : ""}">${d.getUTCDate()}<span class="pts">${tipos.map(t => `<i class="pt ${t}"></i>`).join("")}</span></button>`;
      if (i >= 34 && d.getUTCMonth() !== m - 1 && d.getUTCDay() === 0) break;
    }
    const delDia = st.items.filter(x => x.fecha === st.sel && x.tipo !== "aviso").sort((x, y) => (x.hora || "99").localeCompare(y.hora || "99"));
    const pagDia = (st.pagosHechos || []).filter(p => p.fecha === st.sel);
    return `<div class="ag-cal">
      <section class="card"><div class="cal-head"><h3>${esc(mayus(fMes.format(primero)))}</h3><div class="cal-nav"><button type="button" data-mes="-1" aria-label="Mes anterior">‹</button><button type="button" data-mes="hoy" aria-label="Hoy" style="width:auto;padding:0 12px;font-size:var(--t-sm)">Hoy</button><button type="button" data-mes="1" aria-label="Mes siguiente">›</button></div></div>
        <div class="cal">${celdas}</div>
        <div class="cal-ley"><span><i class="pt evento"></i>Eventos</span><span><i class="pt tarea"></i>Tareas con fecha</span><span><i class="pt incidencia"></i>Incidencias</span><span><i class="pt pago"></i>Pagos por hacer</span><span><i class="pt pagado"></i>Pagos hechos</span></div></section>
      <section class="card"><h3>${esc(mayus(fLargo.format(new Date(st.sel + "T12:00:00Z"))))}</h3>
        <div class="alist">${delDia.length || pagDia.length ? delDia.map(item).join("") + pagDia.map(filaPagoHecho).join("") : `<p class="note">Nada programado este día.</p>`}</div>
        ${formulario("evento", st.sel)}</section></div>`;
  }

  function conectar(c) {
    // Compras: cambiar dónde se compra, y administrar los lugares
    c.querySelectorAll("select.lugar-sel").forEach(sl => sl.addEventListener("change", async () => {
      sl.disabled = true;
      try { await post(`agenda/${sl.dataset.lugar}/lugar`, { lugar: sl.value }); const it = st.items.find(x => x.id === sl.dataset.lugar); if (it) it.lugar = sl.value || null; pintar(); }
      catch (e) { if (e.message !== "sesion") toast(e.message); sl.disabled = false; }
    }));
    const lf = c.querySelector("#lg-filtro");
    if (lf) lf.addEventListener("change", () => { st.lugarFiltro = lf.value; try { lf.value ? localStorage.setItem("ec-compras-lugar", lf.value) : localStorage.removeItem("ec-compras-lugar"); } catch {} pintar(); const n = $("#lg-filtro"); n && n.focus(); });
    c.querySelectorAll("[data-posponer]").forEach(b => b.addEventListener("click", async () => {
      b.disabled = true; const v = b.dataset.v === "1";
      try { await post(`agenda/${b.dataset.posponer}/posponer`, { v: v ? 1 : 0 }); const it = st.items.find(x => x.id === b.dataset.posponer); if (it) it.pospuesta = v ? 1 : null; toast(v ? "Queda para otra ocasión" : "Regresó a la lista"); pintar(); }
      catch (e) { if (e.message !== "sesion") toast(e.message); b.disabled = false; }
    }));
    c.querySelectorAll("form.lg-fila").forEach(f => f.addEventListener("submit", async ev => {
      ev.preventDefault();
      const b = f.querySelector("button[type=submit]"); b.disabled = true;
      const abierto = !!f.closest("details[open]");
      try {
        const r = await post(f.id === "lg-nuevo" ? "agenda/lugares" : `agenda/lugares/${f.dataset.lid}/nombre`, { nombre: f.nombre.value });
        st.lugares = r.lugares; toast(f.id === "lg-nuevo" ? "Lugar agregado" : "Lugar guardado"); pintar();
        if (abierto) { const d = $("#pg-cuerpo .lg-adm"); if (d) d.open = true; }
      } catch (e) { if (e.message !== "sesion") toast(e.message); b.disabled = false; }
    }));
    c.querySelectorAll("[data-lquitar]").forEach(b => b.addEventListener("click", async () => {
      const l = (st.lugares || []).find(x => x.id === b.dataset.lquitar); if (!l) return;
      const n = st.items.filter(x => x.tipo === "compra" && abierto(x) && x.lugar === l.id).length;
      if (!(await EC.confirmar(`¿Quitar ${l.nombre}?`, n ? `${n} ${n === 1 ? "compra pendiente queda" : "compras pendientes quedan"} sin lugar.` : "Ninguna compra pendiente es de este lugar.", "Quitar"))) return;
      try { const r = await post(`agenda/lugares/${l.id}/quitar`, {}); st.lugares = r.lugares; for (const it of st.items) if (it.lugar === l.id) it.lugar = null; toast("Lugar quitado"); pintar(); const d = $("#pg-cuerpo .lg-adm"); if (d) d.open = true; }
      catch (e) { if (e.message !== "sesion") toast(e.message); }
    }));
    c.querySelectorAll("[data-editar]").forEach(b => b.addEventListener("click", () => { st.editando = b.dataset.editar; pintar(); const f = c.querySelector("form.editar"); f && f.titulo.focus(); }));
    c.querySelectorAll("form.editar [data-cancelar]").forEach(b => b.addEventListener("click", () => { st.editando = null; pintar(); }));
    c.querySelectorAll("form.editar").forEach(f => f.addEventListener("submit", async ev => {
      ev.preventDefault();
      const datos = {};
      for (const el of f.elements) if (el.name) datos[el.name] = el.type === "checkbox" ? (el.checked ? 1 : "") : el.value;
      if (f.dataset.tipo === "aviso") {
        const v = [...f.querySelectorAll("[data-para]:checked")].map(x => x.dataset.para);
        if (!v.length) { f.querySelector(".err").textContent = "Elige para quién es el aviso."; return; }
        datos.para = { todos: v.includes("todos"), turnos: v.filter(x => x.startsWith("t:")).map(x => x.slice(2)), personas: v.filter(x => x.startsWith("p:")).map(x => x.slice(2)) };
      }
      const b = f.querySelector("button[type=submit]"); b.disabled = true;
      try { await post("agenda/" + f.dataset.id, datos); st.editando = null; toast("Cambios guardados"); await cargar(); }
      catch (e) { if (e.message !== "sesion") f.querySelector(".err").textContent = e.errores ? Object.values(e.errores).join(" ") : e.message; b.disabled = false; }
    }));
    c.querySelectorAll("form.aform:not(.editar):not(#cat-nueva)").forEach(f => f.addEventListener("submit", async ev => {
      ev.preventDefault();
      const datos = { tipo: f.dataset.tipo };
      for (const el of f.elements) if (el.name) datos[el.name] = el.type === "checkbox" ? (el.checked ? 1 : "") : el.value;
      if (f.dataset.tipo === "aviso") {
        const v = [...f.querySelectorAll("[data-para]:checked")].map(x => x.dataset.para);
        if (!v.length) { f.querySelector(".err").textContent = "Elige para quién es el aviso."; return; }
        datos.para = { todos: v.includes("todos"), turnos: v.filter(x => x.startsWith("t:")).map(x => x.slice(2)), personas: v.filter(x => x.startsWith("p:")).map(x => x.slice(2)) };
      }
      if (f._fotos && f._fotos.length) datos.fotos = f._fotos;
      const b = f.querySelector("button[type=submit]"); b.disabled = true; f.querySelector(".err").textContent = "";
      try { await post("agenda", datos); toast("Guardado"); if (datos.fecha && f.dataset.tipo === "evento") st.sel = datos.fecha; await cargar(); const n = c.querySelector("form.aform input[name=titulo]"); n && n.focus(); }
      catch (e) { if (e.message !== "sesion") f.querySelector(".err").textContent = e.errores ? Object.values(e.errores).join(" ") : e.message; b.disabled = false; }
    }));
    c.querySelectorAll("form.aform[data-tipo=incidencia]").forEach(conectarFotos);
    // Fotos de incidencias ya registradas: agregar más o quitar una
    c.querySelectorAll("[data-fmas]").forEach(inp => inp.addEventListener("change", async () => {
      const lab = inp.closest(".inc-mas"); lab.classList.add("cargando");
      try { const fotos = []; for (const file of inp.files) fotos.push(await comprimirFoto(file)); await post(`agenda/${inp.dataset.fmas}/fotos`, { fotos }); toast(fotos.length === 1 ? "Foto agregada" : "Fotos agregadas"); await cargar(); }
      catch (e) { if (e.message !== "sesion") toast(e.message); lab.classList.remove("cargando"); }
    }));
    c.querySelectorAll("[data-fquitar]").forEach(b => b.addEventListener("click", async () => {
      if (!b.classList.contains("armed")) { b.classList.add("armed"); setTimeout(() => b.classList.remove("armed"), 3000); return; }
      try { await post(`agenda/${b.dataset.fquitar}/fotos`, { quitar: b.dataset.k }); toast("Foto quitada"); await cargar(); } catch (e) { if (e.message !== "sesion") toast(e.message); }
    }));
    c.querySelectorAll("[data-chk]").forEach(b => b.addEventListener("click", async () => {
      const on = b.classList.contains("on");
      // Compra: antes de marcarla comprada se pide el importe (se registra como gasto)
      if (!on && b.dataset.fin === "comprado") {
        const fila = b.closest(".aitem");
        if (fila.querySelector(".compra-conf")) { fila.querySelector(".compra-conf input").focus(); return; }
        fila.insertAdjacentHTML("beforeend", `<form class="compra-conf" novalidate><label>Importe de la compra<input name="importe" inputmode="decimal" placeholder="$0.00" autocomplete="off"></label><label>Pagada con<select name="forma">${window.opcionesMedio("EFECTIVO")}</select></label><label>Día de la compra<input type="date" name="fecha_compra" value="${new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(new Date())}" max="${new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(new Date())}"></label><button class="btn btn-primary" type="submit">Confirmar compra</button><button class="btn btn-line" type="button" data-cancelar>Cancelar</button><span class="err"></span><span class="note" style="flex-basis:100%">Se suma a los egresos de la administración (Dinero). No toca la caja de ningún turno.</span></form>`);
        const f = fila.querySelector(".compra-conf");
        f.importe.focus();
        f.querySelector("[data-cancelar]").addEventListener("click", () => f.remove());
        f.addEventListener("submit", async ev => {
          ev.preventDefault(); const bt = f.querySelector("[type=submit]"); bt.disabled = true; f.querySelector(".err").textContent = "";
          try { await post("agenda/" + b.dataset.chk, { estado: "comprado", importe: f.importe.value, forma: f.forma.value, fecha_compra: f.fecha_compra.value }); toast("Compra registrada"); await cargar(); }
          catch (e) { if (e.message !== "sesion") f.querySelector(".err").textContent = e.message; bt.disabled = false; }
        });
        return;
      }
      if (on && b.dataset.fin === "comprado" && b.dataset.gasto && !(await EC.confirmar("¿Regresar la compra a pendiente?", "Se quita de los egresos en Dinero.", "Regresar", true))) return;
      b.classList.toggle("on");
      try { await post("agenda/" + b.dataset.chk, { estado: on ? b.dataset.ini : b.dataset.fin }); await cargar(); } catch (e) { if (e.message !== "sesion") toast(e.message); b.classList.toggle("on"); }
    }));
    c.querySelectorAll("[data-pagar]").forEach(b => b.addEventListener("click", () => { const it = st.items.find(x => x.id === b.dataset.pagar); if (it) ventanaPago("programado", it); }));
    c.querySelectorAll("[data-nuevo-pago]").forEach(b => b.addEventListener("click", () => b.dataset.nuevoPago === "hecho" ? ventanaPago("hecho") : ventanaProgramar()));
    c.querySelectorAll("[data-editar-pago]").forEach(b => b.addEventListener("click", () => { const p = (st.pagosHechos || []).find(x => x.id === b.dataset.editarPago); if (p) ventanaPago("editar", null, p); }));
    c.querySelectorAll("[data-borrar-pago]").forEach(b => b.addEventListener("click", async () => {
      const p = (st.pagosHechos || []).find(x => x.id === b.dataset.borrarPago); if (!p) return;
      if (!(await EC.confirmar(`¿Eliminar el pago de «${p.titulo || "Pago"}»?`, `Del ${diaTxt(p.fecha)} por ${MXN(p.importe)}. También se quita de Dinero${p.comprobante ? " y se borra su comprobante" : ""}.`, "Eliminar", true))) return;
      try { const r = await post(`agenda/pagos/${p.id}/eliminar`); toast(r.regreso ? `Pago eliminado; el programado vuelve a vencer el ${diaTxt(r.regreso)}` : "Pago eliminado"); await cargar(); } catch (e) { if (e.message !== "sesion") toast(e.message); }
    }));
    c.querySelectorAll("[data-estado]").forEach(s => s.addEventListener("change", async () => {
      try { await post("agenda/" + s.dataset.estado, { estado: s.value }); toast(s.value === "resuelta" ? "Incidencia resuelta" : "Estado actualizado"); await cargar(); } catch (e) { if (e.message !== "sesion") toast(e.message); }
    }));
    c.querySelectorAll("[data-leer]").forEach(b => b.addEventListener("click", async () => {
      try { await post(`agenda/${b.dataset.leer}/enterado`); toast("Marcado como leído"); await cargar(); } catch (e) { if (e.message !== "sesion") toast(e.message); }
    }));
    c.querySelectorAll("[data-responder]").forEach(b => b.addEventListener("click", () => {
      const it = st.items.find(x => x.id === b.dataset.responder); if (!it) return;
      st.resp = { persona: it.autor, titulo: ("Re: " + it.titulo).slice(0, 140) }; pintar();
      const n = $("#ag-cuerpo form.aform input[name=titulo]"); n && n.focus(); scrollTo({ top: 0, behavior: "smooth" });
    }));
    // "Todos los encargados" incluye turnos y personas
    c.querySelectorAll("[data-para]").forEach(x => x.addEventListener("change", () => {
      const f = x.closest("form");
      const marcar = () => f.querySelectorAll(".pchip").forEach(l => l.classList.toggle("on", l.querySelector("input").checked));
      if (!x.checked) { marcar(); return; }
      if (x.dataset.para === "todos") f.querySelectorAll('[data-para^="t:"],[data-para^="p:"]').forEach(y => { y.checked = false; });
      else { const t = f.querySelector('[data-para="todos"]'); if (t) t.checked = false; }
      marcar();
    }));
    c.querySelectorAll("[data-archivar],[data-reactivar]").forEach(b => b.addEventListener("click", async () => {
      const id = b.dataset.archivar || b.dataset.reactivar;
      try { await post("agenda/" + id, { estado: b.dataset.archivar ? "archivado" : "activo" }); toast(b.dataset.archivar ? "Aviso archivado" : "Aviso reactivado"); await cargar(); } catch (e) { if (e.message !== "sesion") toast(e.message); }
    }));
    c.querySelectorAll("[data-del]").forEach(b => b.addEventListener("click", async () => {
      if (!b.classList.contains("armed")) { b.classList.add("armed"); b.setAttribute("aria-label", "Toca otra vez para eliminar"); setTimeout(() => b.classList.remove("armed"), 3000); return; }
      try { await post(`agenda/${b.dataset.del}/eliminar`); toast("Eliminado"); await cargar(); } catch (e) { if (e.message !== "sesion") toast(e.message); }
    }));
    c.querySelectorAll("[data-cat][data-ico]").forEach(b => b.addEventListener("click", async () => {
      try { const r = await post("categorias", { nombre: b.dataset.cat, icono: b.dataset.ico }); window.ponerCategorias(r.categorias); toast("Icono guardado"); pintar(); } catch (e) { if (e.message !== "sesion") toast(e.message); }
    }));
    const cn = c.querySelector("#cat-nueva");
    if (cn) cn.addEventListener("submit", async ev => {
      ev.preventDefault(); cn.querySelector(".err").textContent = "";
      try { const r = await post("categorias", { nombre: cn.nombre.value }); window.ponerCategorias(r.categorias); toast("Categoría agregada"); pintar(); } catch (e) { if (e.message !== "sesion") cn.querySelector(".err").textContent = e.message; }
    });
    c.querySelectorAll("[data-dia]").forEach(b => b.addEventListener("click", () => { st.sel = b.dataset.dia; if (b.classList.contains("fuera")) st.mes = st.sel.slice(0, 7); pintar(); }));
    c.querySelectorAll("[data-mes]").forEach(b => b.addEventListener("click", () => {
      if (b.dataset.mes === "hoy") { st.mes = st.hoy.slice(0, 7); st.sel = st.hoy; }
      else { const [a, m] = st.mes.split("-").map(Number); const d = new Date(Date.UTC(a, m - 1 + Number(b.dataset.mes), 1)); st.mes = d.toISOString().slice(0, 7); }
      pintar();
    }));
  }

  $("#a-tabs").addEventListener("click", e => { const b = e.target.closest(".ptab[data-t]"); if (b) { st.tab = b.dataset.t; pintar(); } });
  $("#pg-tabs").addEventListener("click", e => { const b = e.target.closest(".ptab[data-t]"); if (b) { st.ptab = b.dataset.t; st.editando = null; pintar(); } });
  // Abrir la agenda (o Pagos y compras) en una pestaña y con el formulario listo (desde el Inicio)
  window.agendaDia = dia => { st.sel = dia; st.mes = dia.slice(0, 7); st.tab = "calendario"; if (window.irA) window.irA("agenda"); };
  window.agendaAbrir = async (tab, accion) => {
    const pagos = ["pago", "compra", "hechos"].includes(tab);
    if (pagos) st.ptab = tab; else st.tab = tab || "calendario";
    if (window.irA) window.irA(pagos ? "pagos" : "agenda");
    if (accion && !st.hoy) await cargar();
    setTimeout(() => {
      if (accion === "programar") return ventanaProgramar();
      if (accion === "hecho") return ventanaPago("hecho");
      const n = $(pagos ? "#pg-cuerpo form.aform input[name=titulo]" : "#ag-cuerpo form.aform input[name=titulo]"); n && n.focus();
    }, 300);
  };
  document.addEventListener("modulo", e => { if (e.detail === "agenda" || e.detail === "pagos") cargar(); });
  document.addEventListener("recargar-todo", () => { if (!$("#mod-agenda").hidden || !$("#mod-pagos").hidden) cargar(); });
  if (["agenda", "pagos"].includes(EC.ruta().mod)) cargar();

  // ---- Un solo botón para sincronizar todo ----
  $("#sync-todo").addEventListener("click", async e => {
    const b = e.currentTarget; if (b.disabled) return;
    b.disabled = true; b.classList.add("girando");
    let error = null;
    try { await post("caja/sincronizar"); } catch (err) { error = err; }
    $("#recargar").click();                                   // facturación
    document.dispatchEvent(new CustomEvent("recargar-todo")); // ingresos, personal, agenda
    const m = ["inicio"].find(x => !$("#mod-" + x).hidden);
    if (m) document.dispatchEvent(new CustomEvent("modulo", { detail: m }));
    setTimeout(() => { b.disabled = false; b.classList.remove("girando"); }, 600);
    if (error && error.message !== "sesion") toast("Hoja de ingresos: " + error.message); else if (!error) toast("Todo sincronizado");
  });
})();
