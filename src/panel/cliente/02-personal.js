// ---- Secciones del panel (Facturación / Personal) y módulo de Personal ----
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const esc = EC.esc;
  const fmtF = new Intl.DateTimeFormat("es-MX", { timeZone: "America/Mexico_City", dateStyle: "medium" });
  const hoyOperativo = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(new Date());
  const fecha = iso => iso ? fmtF.format(new Date(iso.length === 10 ? iso + "T12:00:00-06:00" : iso)) : "";
  const toast = EC.toast;
  const api = EC.api;
  const post = EC.post;

  // ---- Cambio de sección ----
  let personalCargado = false;
  document.addEventListener("recargar-todo", () => { if (personalCargado) cargar(); });
  // opciones.historia === "push": el cambio queda en el historial (el botón atrás del celular regresa)
  function mostrar(mod, opciones = {}) {
    if (mod === "turno") mod = "caja";
    // Dinero es una sola pantalla con bloques; "pagos" (enlaces viejos) baja a Pagos programados
    if (mod === "pagos") { mod = "finanzas"; opciones = { ...opciones, vista: opciones.vista && opciones.vista !== "pagos" ? opciones.vista : "programados" }; }
    if (mod === "dinero") mod = "finanzas";
    // Enlaces antiguos de Dinero → Compras siguen abriendo la lista, ahora en Agenda.
    if (mod === "finanzas" && opciones.vista === "compras") mod = "agenda";
    const sec = EC.seccionDe(mod);
    const yaVisible = !($("#mod-" + mod) || {}).hidden;
    document.querySelectorAll(".modulos button").forEach(b => { if (b.dataset.mod === sec) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current"); });
    const eng = $("#cfg-abrir"); if (eng) { if (mod === "config") eng.setAttribute("aria-current", "page"); else eng.removeAttribute("aria-current"); }
    for (const m of ["inicio", "facturacion", "personal", "caja", "finanzas", "agenda", "config"]) { const el = $("#mod-" + m); if (el) el.hidden = mod !== m; }
    // La vista es el bloque al que se baja (o el apartado de Configuración)
    const vista = opciones.vista || null;
    document.title = ({ inicio: "Hoy", personal: "Personal", caja: "Caja", finanzas: "Dinero", agenda: "Agenda", config: "Configuración" }[mod] || "Facturas") + " · El Castaño";
    const url = EC.hashDe(mod, vista) || location.pathname;
    const estado = { mod, vista };
    if (opciones.historia === "push" && ((history.state || {}).mod !== mod || (history.state || {}).vista !== vista)) history.pushState(estado, "", url);
    else history.replaceState(estado, "", url);
    if (mod === "personal" && !personalCargado) { personalCargado = true; cargar(); }
    if (mod === "config") EC.cfgVista = vista;
    if (vista && EC.irBloque) EC.irBloque(mod, vista);
    else if (EC.esUno && EC.esUno(mod) && EC.irBloque) EC.irBloque(mod, null);
    else if (!yaVisible) scrollTo({ top: 0 });
    document.dispatchEvent(new CustomEvent("modulo", { detail: mod }));
  }
  document.querySelector(".modulos").addEventListener("click", e => { const b = e.target.closest("button[data-mod]"); if (b) mostrar(b.dataset.mod, { historia: "push" }); });

  // ---- Personal ----
  const st = { tipo: "colaborador", estatus: "activo", filtro: "todos", q: "", actual: null, listas: null };
  const EXT = () => st.tipo === "externo";
  const CAMP = () => st.tipo === "campanas";
  const iconoEst = (e, cl = "") => `<span class="est ${e} ${cl}" title="${e === "inactivo" ? "Inactivo" : "Activo"}" role="img" aria-label="${e === "inactivo" ? "Inactivo" : "Activo"}"><svg aria-hidden="true"><use href="#i-${e}"/></svg></span>`;
  const CAMPOS = [
    ["Datos personales", [["nombre", "Nombre completo", "wide"], ["fecha_nacimiento", "Fecha de nacimiento", "", "date"], ["lugar_nacimiento", "Lugar de nacimiento"], ["curp", "CURP"], ["estado_civil", "Estado civil", "", "lista:estado_civil"], ["telefono", "Teléfono celular", "", "tel"], ["correo", "Correo electrónico", "", "email"]]],
    ["Domicilio", [["calle", "Calle y número", "wide"], ["colonia", "Colonia"], ["municipio", "Municipio"], ["cp", "Código postal"]]],
    ["Contacto de emergencia", [["emerg_nombre", "Nombre", "wide"], ["emerg_parentesco", "Parentesco"], ["emerg_telefono", "Teléfono", "", "tel"]]],
    ["Escolaridad", [["escolaridad", "Último grado", "", "lista:escolaridad"], ["institucion", "Escuela"]]]
  ];
  const enlaceDe = token => `${location.origin}/expediente/${token}`;
  const mensajeWa = (nombre, token, docs, tipo) => tipo === "externo"
    ? `Hola ${(nombre || "").split(" ")[0]}, te saluda Báscula y Pensión El Castaño. Para trabajar dentro de El Castaño necesitamos identificarte. Sube la foto de tus documentos (${docs.join(", ")}) y llena tus datos en este enlace personal (no lo compartas):\n${enlaceDe(token)}`
    : `Hola ${(nombre || "").split(" ")[0]}, te saluda Báscula y Pensión El Castaño. Para actualizar tu expediente laboral, sube la foto de tus documentos y llena tus datos en este enlace personal (no lo compartas):\n${enlaceDe(token)}\n\nY entrega 2 copias de cada documento con Josué: ${docs.join(", ")}.`;
  const mensajeRecordatorio = (nombre, token, falta, tipo) => {
    const lista = [...(falta.datos ? ["llenar tus datos"] : []), ...falta.docs.map(d => d.toLowerCase())];
    const lim = st.limActual ? ` a más tardar el ${fechaLarga(st.limActual)}` : "";
    return `Hola ${(nombre || "").split(" ")[0]}, te saluda Báscula y Pensión El Castaño. Te recordamos completar ${tipo === "externo" ? "tu registro" : "tu expediente laboral"}${lim}. Te falta: ${lista.join(", ")}.\n\nPuedes hacerlo aquí, con tu enlace personal:\n${enlaceDe(token)}`;
  };
  const ENCARGADO_WA = "9622165453";
  const msgEncargadoAlta = (nombre, folio, actividad, token) => `Nuevo externo por registrar: ${nombre} (folio ${folio})${actividad ? " · " + actividad : ""}.\n\nCuando se presente, abre su registro y, con la persona presente, sube la foto de su INE o identificación, CURP, comprobante de domicilio y tómale una foto. Luego revisa y envía sus datos:\n${enlaceDe(token)}`;
  const msgEncargadoEstatus = c => {
    const pend = [...(c.falta.datos ? ["llenar sus datos"] : []), ...c.falta.docs];
    if (c.estatus === "inactivo") return `Baja de externo: ${c.nombre} (folio ${c.folio}) ya NO tiene permitido trabajar dentro de El Castaño.${c.motivo_baja ? " Motivo: " + c.motivo_baja + "." : ""}`;
    if (c.completo) return `Registro completo: ${c.nombre} (folio ${c.folio})${c.admin.actividad ? " · " + c.admin.actividad : ""} ya puede trabajar dentro de El Castaño.`;
    return `Registro pendiente: ${c.nombre} (folio ${c.folio}) todavía no completa su registro. Falta: ${pend.join(", ")}.\n\nComplétalo aquí:\n${enlaceDe(c.token)}`;
  };
  const fechaLarga = d => new Intl.DateTimeFormat("es-MX", { timeZone: "America/Mexico_City", weekday: "long", day: "numeric", month: "long" }).format(new Date(d + "T12:00:00-06:00"));
  const urlWa = (tel, msg) => `https://wa.me/52${tel}?text=${encodeURIComponent(msg)}`;
  const estadoPill = c => c.estatus === "inactivo" ? `<span class="pill inactivo">Inactivo${c.fecha_baja ? " desde " + fecha(c.fecha_baja) : ""}</span>` : c.completo ? `<span class="pill completo">Completo</span>` : !c.llenado_en ? `<span class="pill sinllenar">Sin llenar datos</span>` : `<span class="pill faltan">Faltan documentos</span>`;

  // Expedientes vinculados a un encargado de la tablet: muestran su imagen de perfil
  let VINC = {};
  // Todo a la vista: colaboradores, externos y campañas en una sola lista, agrupados (el submenú baja a cada grupo).
  // Activos/Inactivos y el filtro de expediente aplican a colaboradores y externos.
  const filaCamp = c => `<button class="pitem" type="button" data-tipo="campanas" data-id="${c.id}" ${st.actual === c.id ? 'aria-current="true"' : ""}>
        <svg class="chev" aria-hidden="true"><use href="#i-chev"/></svg>
        <span class="t">${esc(c.nombre)}</span>
        <span class="m">${pillCamp(c)}<span>${c.abierta ? "Hasta" : "Límite"} ${esc(fecha(c.limite))}</span></span>
        <span class="m"><span class="mini ${c.completos === c.total ? "ok" : ""}"><i style="width:${c.total ? c.completos / c.total * 100 : 0}%"></i></span><span>${c.completos} de ${c.total} completaron</span></span>
      </button>`;
  async function cargar() {
    const lista = $("#p-lista");
    const q = tipo => { const p = new URLSearchParams({ tipo, estatus: st.estatus, filtro: st.filtro }); if (st.q) p.set("q", st.q); return api("colaboradores?" + p); };
    try {
      const [jc, je, jk, v] = await Promise.all([q("colaborador"), q("externo"), api("colaboradores/campanas").catch(() => ({ campanas: [] })), api("turno/vinculos").catch(() => ({}))]);
      VINC = (v && v.vinculos) || {};
      st.camps = jk.campanas || [];
      const suma = k => (jc.conteos[k] || 0) + (je.conteos[k] || 0);
      for (const k of ["activo", "inactivo", "todos", "incompletos", "completos"]) { const el = $("#pn-" + k); if (el) el.textContent = suma(k); }
      st.config = jc.config || {};
      $("#p-drive-nota").textContent = st.config.drive ? "Drive conectado: los documentos se copian solos a la carpeta." : "Drive sin conectar.";
      $("#p-drive").textContent = st.config.drive ? "Volver a probar Drive" : "Probar conexión con Drive";
      const inac = st.estatus === "inactivo", activas = st.camps.filter(x => x.abierta).length;
      $("#p-titulo").textContent = "Personal.";
      $("#p-subtitulo").textContent = inac ? `Dados de baja: ${jc.conteos.todos || 0} colaboradores y ${je.conteos.todos || 0} externos. Sus enlaces ya no funcionan.`
        : `${jc.conteos.todos || 0} colaboradores y ${je.conteos.todos || 0} externos activos · ${suma("incompletos")} con expediente incompleto · ${activas} campaña${activas === 1 ? "" : "s"} activa${activas === 1 ? "" : "s"}.`;
      const campsVis = st.q ? st.camps.filter(c => c.nombre.toLowerCase().includes(st.q.toLowerCase())) : st.camps;
      EC.bloqueN("personal", "colaborador", jc.colaboradores.length);
      EC.bloqueN("personal", "externo", je.colaboradores.length);
      EC.bloqueN("personal", "campanas", activas);
      // Línea de estado de cada tarjeta del índice (celular y tablet)
      const inc = j => j.conteos.incompletos || 0;
      EC.bloqueInfo("personal", "colaborador", { texto: inac ? "dados de baja" : inc(jc) ? `${inc(jc)} con expediente incompleto` : "Expedientes completos" });
      EC.bloqueInfo("personal", "externo", { texto: inac ? "dados de baja" : inc(je) ? `${inc(je)} con registro incompleto` : "Registros completos" });
      EC.bloqueInfo("personal", "campanas", { texto: activas ? (activas === 1 ? "campaña activa" : "campañas activas") : st.camps.length ? "Ninguna activa" : "Sin campañas" });
      const grupo = (tipo, txt, ico, items, vacio) => `<div class="lgrp-g" data-grupo="${tipo}"><h4 class="lgrp" data-bloque="${tipo}"><svg aria-hidden="true"><use href="#${ico}"/></svg><span>${txt}</span><b class="bq-n" ${items.length ? "" : "hidden"}>${items.length}</b></h4>`
        + (items.length ? items.join("") : `<p class="note lgrp-n">${st.q ? "Sin resultados." : vacio}</p>`) + `</div>`;
      const filas = (j, tipo) => j.colaboradores.map(c => `<button data-tipo="${tipo}" class="pitem ${c.estatus === "inactivo" ? "baja" : ""}" type="button" data-id="${c.id}" ${st.actual === c.id ? 'aria-current="true"' : ""}>
        <svg class="chev" aria-hidden="true"><use href="#i-chev"/></svg>
        ${VINC[c.id] ? avP(VINC[c.id], 1) : iconoEst(c.estatus)}
        <span class="t">${esc(c.nombre)}</span>
        <span class="m"><span class="folio">${esc(c.folio)}</span></span>
        <span class="m">${c.puesto || c.actividad ? `<span>${esc(c.puesto || c.actividad)}</span>` : ""}</span>
        <span class="m"><span class="mini ${c.entregados === c.total ? "ok" : ""}"><i style="width:${c.entregados / c.total * 100}%"></i></span><span>${c.entregados}/${c.total} documentos</span>${estadoPill(c)}</span>
      </button>`);
      lista.innerHTML = grupo("colaborador", inac ? "Colaboradores inactivos" : "Colaboradores", "i-persona", filas(jc, "colaborador"), inac ? "No hay colaboradores inactivos." : st.filtro === "completos" ? "Todavía nadie tiene su expediente completo." : "Sin colaboradores.")
        + grupo("externo", inac ? "Externos inactivos" : "Externos", "i-activo", filas(je, "externo"), inac ? "No hay externos inactivos." : "Sin externos.")
        + grupo("campanas", "Campañas", "i-doc", campsVis.map(filaCamp), "Todavía no hay campañas. Lanza una con «+ Campaña» cuando necesites pedir documentos.");
    } catch (e) { if (e.message !== "sesion") lista.innerHTML = `<p class="empty">No se pudo cargar: ${esc(e.message)}</p>`; }
  }

  function input(k, etiqueta, clase, tipo, valor) {
    const v = valor ?? "";
    let ctrl;
    if (tipo && tipo.startsWith("lista:")) {
      const ops = st.listas[tipo.slice(6)] || [];
      ctrl = `<select data-k="${k}"><option value="">—</option>${ops.map(o => `<option ${o === v ? "selected" : ""}>${esc(o)}</option>`).join("")}</select>`;
    } else if (tipo === "area") {
      ctrl = `<textarea data-k="${k}">${esc(v)}</textarea>`;
    } else {
      const t = tipo === "date" ? "date" : tipo === "email" ? "email" : tipo === "tel" ? "tel" : "text";
      ctrl = `<input type="${t}" data-k="${k}" value="${esc(v)}" ${tipo === "tel" ? 'inputmode="tel" maxlength="14"' : ""} autocomplete="off">`;
    }
    return `<label class="${clase || ""}">${etiqueta}${ctrl}<span class="err" data-e="${k}"></span></label>`;
  }
  const leer = cont => Object.fromEntries([...cont.querySelectorAll("[data-k]")].map(el => [el.dataset.k, el.value]));
  function errores(cont, errs) {
    cont.querySelectorAll("[data-e]").forEach(el => el.textContent = "");
    for (const [k, m] of Object.entries(errs || {})) { const el = cont.querySelector(`[data-e="${k}"]`); if (el) el.textContent = m; }
  }

  function pintarDocs(docs) {
    const n = docs.filter(d => d.recibido).length;
    $("#p-docs-n").textContent = `${n} de ${docs.length}`;
    $("#p-barra").style.width = (n / docs.length * 100) + "%";
    $("#p-barra").parentElement.classList.toggle("ok", n === docs.length);
  }

  async function abrir(id) {
    st.actual = id;
    document.querySelectorAll(".pitem").forEach(b => b.toggleAttribute("aria-current", b.dataset.id === id));
    $("#p-work").classList.add("ver-detalle");
    const d = $("#p-detalle");
    d.innerHTML = `<p class="empty">Cargando…</p>`;
    let j;
    try { j = await api("colaboradores/" + id); } catch (e) { d.innerHTML = `<p class="empty">${esc(e.message)}</p>`; return; }
    const c = j.colaborador; st.listas = j.listas; st.limActual = c.acceso && c.acceso.hasta || "";
    const tel = c.telefono ? "52" + c.telefono : "";
    const msg = mensajeWa(c.nombre, c.token, c.docs.map(x => x.nombre), c.tipo);
    d.innerHTML = `
      <button class="btn btn-line back" id="p-volver" type="button">← Volver a la lista</button>
      <div class="detail-head">${VINC[c.id] ? avP(VINC[c.id], 1) : iconoEst(c.estatus)}<h2>${esc(c.nombre)}</h2>${estadoPill(c)}<button class="folio-tag" id="p-folio" type="button" title="Copiar folio">Folio ${esc(c.folio)}</button></div>
      <div class="cols">
        <div style="display:grid;gap:24px">
          <section class="card" id="p-estatus">
            <div class="estatus-box">${iconoEst(c.estatus)}<div><b>${c.estatus === "inactivo" ? "Inactivo" : "Activo"}</b><span class="note">${c.estatus === "inactivo" ? `Baja el ${fecha(c.fecha_baja)}${c.motivo_baja ? " · " + esc(c.motivo_baja) : ""}. Su enlace no funciona.` : (c.tipo === "externo" ? "Trabaja actualmente dentro de El Castaño." : "Trabaja actualmente en El Castaño.")}</span></div></div>
            ${c.estatus === "inactivo"
              ? `<div class="row"><button class="btn btn-line" id="p-reactivar" type="button">${iconoEst("activo", "sm")} Reactivar</button></div>`
              : `<div class="row"><button class="btn btn-line" id="p-baja-abrir" type="button">${iconoEst("inactivo", "sm")} Marcar como inactivo</button></div>
                 <div class="grid-form" id="p-baja" hidden>
                   ${input("fecha_baja", "Fecha de baja", "", "date", hoyOperativo())}
                   ${input("motivo_baja", "Motivo (opcional)", "")}
                   <div class="row wide"><button class="btn btn-bad" id="p-baja-ok" type="button">Confirmar baja</button></div>
                 </div>`}
          </section>
          <section class="card">
            <h3>Constancias digitales · Personal y Campañas</h3>
            <p class="note" style="margin:0">Aviso de privacidad v1 · <a href="/aviso-de-privacidad-colaboradores/" target="_blank" rel="noopener">Leer documento</a></p>
            <p class="note" style="margin:6px 0">${c.acuse_v1_en ? `Confirmada el ${esc(fecha(c.acuse_v1_en))}.` : "Pendiente: todavía no hay constancia v1."} Esta recepción no sustituye las firmas en papel.</p>
            ${c.acuse_v1_en || c.estatus === "inactivo" ? "" : `<div class="row"><button type="button" class="btn btn-line" id="p-pedir-acuse">Solicitar constancia por campaña</button></div>`}
          </section>
          <section class="card">
            <h3>Documentos entregados</h3>
            <div class="row" style="justify-content:space-between"><span class="note">${c.tipo === "externo" ? "Se palomean solos cuando sube la foto. También puedes palomearlos tú." : "Se palomean solos cuando el colaborador sube la foto. También puedes palomearlos tú al recibir sus copias."}</span><b id="p-docs-n"></b></div>
            <div class="barra"><i id="p-barra" style="width:0"></i></div>
            <div class="checklist">${c.docs.map(x => `<div class="chkrow"><label class="dchk ${x.recibido ? "ok" : ""}"><input type="checkbox" data-doc="${x.clave}" ${x.recibido ? "checked" : ""}><b>${esc(x.nombre)}</b><span class="note" data-docf="${x.clave}">${x.recibido ? "Recibido " + fecha(x.fecha) : ""}</span></label>${x.fotos.length ? `<div class="fotos">${x.fotos.map(f => `<a class="copy" href="/panel/api/colaboradores/${c.id}/archivo/${f.archivo}" target="_blank" rel="noopener">${f.archivo === "ine" && x.piezas > 1 ? "Ver frente" : f.archivo === "ine2" ? "Ver reverso" : f.archivo === "solicitud" ? "Ver hoja 1" : f.archivo === "solicitud2" ? "Ver hoja 2" : "Ver foto"}</a>`).join("")}</div>` : ""}</div>`).join("")}</div>
          </section>
          <section class="card">
            ${c.tipo === "externo" ? `<h3>Registro con el encargado de turno</h3>
            <p class="note" style="margin:0">Al externo no se le envía nada: se registra con el encargado de turno (${esc(j.encargado.correo)} · WhatsApp 962 216 5453). ${c.llenado_en ? `Sus datos se capturaron el ${fecha(c.llenado_en)}.` : "Todavía no se capturan sus datos."}</p>
            <div class="enlace" id="p-enlace">${esc(enlaceDe(c.token))}</div>
            <div class="row">
              ${c.estatus !== "inactivo" ? `<a class="btn btn-primary" href="${urlWa(ENCARGADO_WA, msgEncargadoAlta(c.nombre, c.folio, c.admin.actividad, c.token))}" target="_blank" rel="noopener">Enviar al encargado (WhatsApp)</a>
              <button class="btn btn-line" id="p-correo" type="button">Enviar al encargado (correo)</button>` : ""}
              <button class="btn btn-line" id="p-estatus-enc" type="button">Enviar estatus al encargado</button>
              <button class="btn btn-line" id="p-regenerar" type="button">Cambiar enlace</button>
            </div>
            <p class="note" style="margin:0" id="p-correo-estado">${j.encargado.avisado ? `Último aviso al encargado: ${({ alta: "registro por hacer", completo: "registro completo", incompleto: "registro pendiente", inactivo: "baja", activo: "reactivado" })[j.encargado.avisado.split("|")[0]] || ""}, ${fecha(j.encargado.avisado.split("|")[1])}.` : "Todavía no se le avisa al encargado."}</p>` : `<h3>Enlace personal</h3>
            <p class="note" style="margin:0">${c.llenado_en ? `Llenó sus datos el ${fecha(c.llenado_en)}.` : "Todavía no llena sus datos."} Con este enlace puede llenarlos o corregirlos desde su celular.</p>
            ${c.estatus === "inactivo" ? "" : c.acceso.abierto
              ? `<p class="acceso">Enlace <b>abierto hasta el ${esc(fechaLarga(c.acceso.hasta))}</b> · ${c.acceso.campana ? `campaña «${esc(c.acceso.campana.nombre)}»` : "alta reciente (14 días)"}.</p>`
              : `<p class="acceso cerrado"><b>Enlace cerrado.</b> Solo se abre cuando lo incluyes en una campaña.</p><div class="row"><button class="btn btn-primary" id="p-pedir" type="button">Pedirle documentos</button></div>`}
            <div class="enlace" id="p-enlace">${esc(enlaceDe(c.token))}</div>
            ${c.estatus !== "inactivo" && !c.acceso.abierto ? "" : `<div class="row">
              ${tel ? `<a class="btn btn-primary" href="${urlWa(c.telefono, msg)}" target="_blank" rel="noopener">Enviar por WhatsApp</a>` : ""}
              ${c.correo && c.estatus !== "inactivo" ? `<button class="btn btn-line" id="p-correo" type="button">${c.correo_enviado ? "Reenviar por correo" : "Enviar por correo"}</button>` : ""}
              ${!c.completo && c.estatus !== "inactivo" ? `<button class="btn btn-primary" id="p-recordar" type="button">Recordar lo que falta</button>` : ""}
              <button class="btn btn-line" id="p-copiar" type="button">Copiar mensaje</button>
            </div>`}
            <div class="row"><button class="btn btn-line" id="p-regenerar" type="button">Cambiar enlace</button></div>
            ${c.recordado ? `<p class="note" style="margin:0">Último recordatorio por correo: ${fecha(c.recordado)}.</p>` : ""}
            <p class="note" style="margin:0" id="p-correo-estado">${c.correo ? (c.correo_enviado ? `Correo enviado a ${esc(c.correo)} el ${fecha(c.correo_enviado)}.` : `Correo: ${esc(c.correo)} · aún no se le envía.`) : "Sin correo registrado: agrégalo en sus datos para enviarle el enlace por correo."}</p>
            ${tel ? "" : `<p class="note" style="margin:0">Agrega su teléfono en los datos para enviarlo directo por WhatsApp.</p>`}`}
          </section>
          <section class="card" id="p-admin">
            ${c.tipo === "externo" ? `<h3>Actividad</h3>
            <div class="grid-form">
              ${input("nacionalidad", "Nacionalidad", "", "lista:nacionalidad", c.admin.nacionalidad || "Nacional")}
              ${input("actividad", "Actividad", "", "lista:actividades", c.admin.actividad)}
              ${input("fecha_ingreso", "Fecha de inicio", "", "date", c.admin.fecha_ingreso)}
              ${input("turno", "Días u horario", "", "", c.admin.turno)}
              ${input("notas", "Notas (qué vende, lugar asignado, acuerdos)", "wide", "area", c.admin.notas)}
            </div>` : `<h3>Puesto y entrevista</h3>
            <div class="grid-form">
              ${input("nacionalidad", "Nacionalidad", "", "lista:nacionalidad", c.admin.nacionalidad || "Nacional")}
              ${input("puesto", "Puesto", "", "lista:puestos", c.admin.puesto)}
              ${input("fecha_ingreso", "Fecha de ingreso", "", "date", c.admin.fecha_ingreso)}
              ${input("turno", "Turno u horario", "", "", c.admin.turno)}
              ${input("fecha_entrevista", "Fecha de entrevista", "", "date", c.admin.fecha_entrevista)}
              ${input("notas", "Notas de la entrevista", "wide", "area", c.admin.notas)}
            </div>`}
            <div class="row"><button class="btn btn-line" id="p-guardar-admin" type="button">Guardar</button></div>
          </section>
        </div>
        <div style="display:grid;gap:24px">
          <section class="card">
            <h3>${c.tipo === "externo" ? "Registro en PDF" : "Expediente en PDF"}</h3>
            <p class="note" style="margin:0">${c.completo ? "Junta sus datos, los documentos que subió y tus documentos administrativos en un solo PDF." : `Se habilita cuando el expediente esté completo. Falta: ${esc([...(c.falta.datos ? ["llenar sus datos"] : []), ...c.falta.docs].join(", "))}.`}</p>
            <div class="row"><button class="btn btn-line" id="p-drive-sync" type="button" ${j.config && j.config.drive ? "" : "disabled"} title="${j.config && j.config.drive ? "Copia a su carpeta de Drive los documentos que ya están aquí" : "Primero conecta Drive"}">Copiar a Drive</button><button class="btn ${c.completo ? "btn-primary" : "btn-line"}" id="p-pdf" type="button" ${c.completo ? "" : "disabled"}>${c.tipo === "externo" ? "Descargar registro PDF" : "Descargar expediente PDF"}</button><span class="note" id="p-pdf-estado"></span></div>
          </section>
          <section class="card" id="p-adocs">
            <h3>Documentos administrativos</h3>
            <p class="note" style="margin:0">Contratos, constancias, actas administrativas u otros documentos que tú agregues. Solo los ves tú.</p>
            <div class="adocs" id="p-adocs-lista"></div>
            <div class="grid-form">
              <label class="wide">Descripción<input type="text" id="ad-desc" maxlength="200" placeholder="Ej. Contrato individual de trabajo" autocomplete="off"></label>
              <label>Fecha de subida<input type="date" id="ad-fecha" value="${hoyOperativo()}"></label>
              <label>Archivo<span class="btn btn-line archivo-sel"><input type="file" id="ad-archivo" accept="application/pdf,image/*"><span id="ad-archivo-n">Elegir PDF</span></span></label>
            </div>
            <div class="row"><button class="btn btn-primary" id="ad-subir" type="button">Subir documento</button><span class="note" id="ad-estado"></span></div>
          </section>
          <section class="card" id="p-datos">
            <h3>Datos del colaborador</h3>
            <p class="note" style="margin:0">Los llena el colaborador desde su enlace. Aquí puedes corregirlos.</p>
            <div class="grid-form">${CAMPOS.filter(([sec]) => !(c.tipo === "externo" && sec === "Escolaridad")).map(([sec, cs], i) => `${i ? `<span class="sep">${sec}</span>` : `<span class="sep" style="border:0;margin:0;padding:0">${sec}</span>`}${cs.map(([k, et, cl, tp]) => input(k, et, cl, tp, c.datos[k])).join("")}`).join("")}</div>
            <div class="row"><button class="btn btn-line" id="p-guardar-datos" type="button">Guardar datos</button></div>
          </section>
        </div>
      </div>`;
    pintarDocs(c.docs);
    pintarAdocs(id, c.admin_docs);
    if ($("#p-pedir")) $("#p-pedir").addEventListener("click", () => irACampanas([c.id]));
    $("#p-pedir-acuse")?.addEventListener("click", () => irACampanas([c.id], ["acuse_v1"]));
    if ($("#p-recordar")) $("#p-recordar").addEventListener("click", async e => {
      const b = e.currentTarget; b.disabled = true;
      if (c.telefono) window.open(urlWa(c.telefono, mensajeRecordatorio(c.nombre, c.token, c.falta, c.tipo)), "_blank");
      try {
        const r = await post(`colaboradores/${id}/recordar`);
        toast(r.enviado ? "Recordatorio enviado por correo" + (c.telefono ? " y WhatsApp listo" : "") : (c.telefono ? "WhatsApp listo. " : "") + (r.error_correo || ""));
        if (r.enviado) abrir(id); else b.disabled = false;
      } catch (err) { toast(err.message); b.disabled = false; }
    });
    $("#p-pdf").addEventListener("click", () => generarPdf(c));
    $("#p-drive-sync").addEventListener("click", async e => {
      const b = e.currentTarget; b.disabled = true; $("#p-pdf-estado").textContent = "Copiando a Drive…";
      try { const r = await post(`colaboradores/${id}/drive-sync`); $("#p-pdf-estado").textContent = r.copiados ? `Listo: ${r.copiados} archivos en su carpeta de Drive.` : "Todavía no tiene documentos para copiar."; }
      catch (err) { $("#p-pdf-estado").textContent = err.message; }
      b.disabled = false;
    });
    $("#ad-archivo").addEventListener("change", e => { const f = e.target.files[0]; $("#ad-archivo-n").textContent = f ? f.name.slice(0, 28) : "Elegir PDF"; });
    $("#ad-subir").addEventListener("click", async e => {
      const b = e.currentTarget, f = $("#ad-archivo").files[0], desc = $("#ad-desc").value.trim();
      if (!desc) { toast("Escribe la descripción"); $("#ad-desc").focus(); return; }
      if (!f) { toast("Elige el archivo"); return; }
      if (f.size > 10 * 1024 * 1024) { toast("El archivo pesa más de 10 MB"); return; }
      b.disabled = true; $("#ad-estado").textContent = "Subiendo…";
      try {
        const r = await fetch(`/panel/api/colaboradores/${id}/adoc`, { method: "POST", headers: { "X-Panel": "1", "Content-Type": f.type || "application/pdf", "X-Descripcion": encodeURIComponent(desc), "X-Fecha": $("#ad-fecha").value, "X-Nombre": encodeURIComponent(f.name) }, body: f });
        const j = await r.json().catch(() => ({ ok: false, error: "No se pudo subir." }));
        if (!j.ok) throw new Error(j.error);
        pintarAdocs(id, j.admin_docs); if (j.drive === "error") toast("Subido, pero no se pudo copiar a Drive"); $("#ad-desc").value = ""; $("#ad-archivo").value = ""; $("#ad-archivo-n").textContent = "Elegir PDF"; $("#ad-estado").textContent = ""; toast("Documento subido");
      } catch (err) { $("#ad-estado").textContent = err.message; }
      b.disabled = false;
    });
    const cambiarEstatus = async cuerpo => {
      if (c.tipo === "externo") {
        const msg = cuerpo.estatus === "inactivo"
          ? `Baja de externo: ${c.nombre} (folio ${c.folio}) ya NO tiene permitido trabajar dentro de El Castaño.${cuerpo.motivo_baja ? " Motivo: " + cuerpo.motivo_baja + "." : ""}`
          : `Reactivado: ${c.nombre} (folio ${c.folio}) de nuevo puede trabajar dentro de El Castaño.`;
        window.open(urlWa(ENCARGADO_WA, msg), "_blank");
      }
      try {
        const r = await post(`colaboradores/${id}/estatus`, cuerpo);
        const base = cuerpo.estatus === "inactivo" ? "Marcado como inactivo" : "Reactivado";
        toast(c.tipo === "externo" ? (r.aviso && r.aviso.enviado ? base + " y avisado al encargado" : base + ". " + ((r.aviso && r.aviso.error) || "")) : base);
        await cargar(); abrir(id);
      } catch (e) { toast(e.message); }
    };
    if ($("#p-reactivar")) $("#p-reactivar").addEventListener("click", () => cambiarEstatus({ estatus: "activo" }));
    if ($("#p-baja-abrir")) {
      $("#p-baja-abrir").addEventListener("click", () => { $("#p-baja").hidden = false; $("#p-baja-abrir").hidden = true; });
      $("#p-baja-ok").addEventListener("click", () => cambiarEstatus({ estatus: "inactivo", ...leer($("#p-baja")) }));
    }

    d.querySelectorAll("[data-doc]").forEach(cb => cb.addEventListener("change", async () => {
      cb.disabled = true;
      try {
        const r = await post(`colaboradores/${id}/doc`, { clave: cb.dataset.doc, recibido: cb.checked });
        const x = r.docs.lista.find(y => y.clave === cb.dataset.doc);
        cb.closest(".dchk").classList.toggle("ok", x.recibido);
        d.querySelector(`[data-docf="${x.clave}"]`).textContent = x.recibido ? "Recibido " + fecha(x.fecha) : "";
        pintarDocs(r.docs.lista);
        cargar();
      } catch (e) { cb.checked = !cb.checked; toast(e.message); }
      cb.disabled = false;
    }));
    $("#p-volver").addEventListener("click", () => { $("#p-work").classList.remove("ver-detalle"); st.actual = null; cargar(); });
    if ($("#p-correo")) $("#p-correo").addEventListener("click", async e => {
      const b = e.currentTarget; b.disabled = true;
      try { await post(`colaboradores/${id}/enviar-correo`); toast("Correo enviado"); abrir(id); } catch (err) { toast(err.message); $("#p-correo-estado").textContent = err.message; b.disabled = false; }
    });
    $("#p-folio").addEventListener("click", async () => { try { await navigator.clipboard.writeText(c.folio); toast("Folio copiado"); } catch {} });
    if ($("#p-estatus-enc")) $("#p-estatus-enc").addEventListener("click", async e => {
      const b = e.currentTarget; b.disabled = true;
      window.open(urlWa(ENCARGADO_WA, msgEncargadoEstatus(c)), "_blank");
      try { await post(`colaboradores/${id}/avisar-encargado`); toast("Estatus enviado al encargado"); abrir(id); } catch (err) { toast("WhatsApp listo. " + err.message); b.disabled = false; }
    });
    if ($("#p-copiar")) $("#p-copiar").addEventListener("click", async () => { try { await navigator.clipboard.writeText(msg); toast("Mensaje copiado"); } catch { toast("No se pudo copiar"); } });
    $("#p-regenerar").addEventListener("click", async e => {
      const b = e.currentTarget;
      if (!b.classList.contains("armed")) { b.classList.add("armed", "btn-bad"); b.textContent = "¿Seguro? El enlace anterior dejará de funcionar"; setTimeout(() => { b.classList.remove("armed", "btn-bad"); b.textContent = "Cambiar enlace"; }, 4000); return; }
      try { await post(`colaboradores/${id}/nuevo-enlace`); toast("Enlace nuevo listo"); abrir(id); } catch (e) { toast(e.message); }
    });
    $("#p-guardar-admin").addEventListener("click", async () => {
      const cont = $("#p-admin");
      try { await post(`colaboradores/${id}/admin`, leer(cont)); errores(cont); toast("Guardado"); cargar(); } catch (e) { errores(cont, e.errores); toast(e.message); }
    });
    $("#p-guardar-datos").addEventListener("click", async () => {
      const cont = $("#p-datos");
      try { await post(`colaboradores/${id}/datos`, leer(cont)); errores(cont); toast("Datos guardados"); cargar(); abrir(id); } catch (e) { errores(cont, e.errores); toast(e.message); }
    });
  }

  function pintarAdocs(id, lista) {
    const cont = $("#p-adocs-lista");
    if (!lista.length) { cont.innerHTML = `<p class="note" style="margin:0">Todavía no hay documentos administrativos.</p>`; return; }
    cont.innerHTML = [...lista].sort((a, b) => (b.fecha + b.subido).localeCompare(a.fecha + a.subido)).map(d => `<div class="adoc">
      <b>${esc(d.descripcion)}</b>
      <span class="acc"><a class="copy" href="/panel/api/colaboradores/${id}/archivo-admin/${d.id}" target="_blank" rel="noopener">Ver</a><button class="copy" type="button" data-adel="${d.id}" style="color:var(--bad)">Eliminar</button></span>
      <span class="note">Subido el ${fecha(d.fecha)}${d.nombre ? " · " + esc(d.nombre) : ""}</span>
    </div>`).join("");
    cont.querySelectorAll("[data-adel]").forEach(b => b.addEventListener("click", async () => {
      if (!b.dataset.armed) { b.dataset.armed = "1"; b.textContent = "¿Seguro?"; setTimeout(() => { b.dataset.armed = ""; b.textContent = "Eliminar"; }, 3500); return; }
      try { const r = await post(`colaboradores/${id}/adoc-eliminar`, { doc: b.dataset.adel }); pintarAdocs(id, r.admin_docs); toast("Documento eliminado"); } catch (e) { toast(e.message); }
    }));
  }

  // ---- Expediente en PDF (se arma en el navegador con pdf-lib) ----
  let pdfLib = null;
  function cargarPdfLib() {
    if (pdfLib) return pdfLib;
    pdfLib = new Promise((res, rej) => { const sc = document.createElement("script"); sc.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js"; sc.onload = () => res(window.PDFLib); sc.onerror = () => { pdfLib = null; rej(new Error("No se pudo cargar el generador de PDF. Revisa tu conexión.")); }; document.head.appendChild(sc); });
    return pdfLib;
  }
  async function aJpeg(blob) {
    const img = await createImageBitmap(blob, { imageOrientation: "from-image" });
    const k = Math.min(1, 2000 / Math.max(img.width, img.height));
    const cv = document.createElement("canvas"); cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
    cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
    return new Uint8Array(await (await new Promise(r => cv.toBlob(r, "image/jpeg", 0.85))).arrayBuffer());
  }
  async function generarPdf(c) {
    const estado = $("#p-pdf-estado"), b = $("#p-pdf");
    b.disabled = true; estado.textContent = "Armando el PDF…";
    try {
      const { PDFDocument, StandardFonts, rgb } = await cargarPdfLib();
      const pdf = await PDFDocument.create();
      pdf.setTitle(`${c.tipo === "externo" ? "Registro de externo" : "Expediente laboral"} · ${c.nombre}`); pdf.setAuthor("Báscula y Pensión El Castaño");
      const f = await pdf.embedFont(StandardFonts.Helvetica), fb = await pdf.embedFont(StandardFonts.HelveticaBold);
      const W = 612, H = 792, M = 48;
      const limpio = t => String(t ?? "").replace(/[^\x20-\x7E\u00A0-\u00FF]/g, "");
      let pg = pdf.addPage([W, H]), y = H - M;
      const nueva = () => { pg = pdf.addPage([W, H]); y = H - M; };
      const texto = (t, { size = 10.5, bold = false, color = rgb(0.1, 0.1, 0.1), x = M } = {}) => {
        const font = bold ? fb : f, maxW = W - M - x; let linea = "";
        const salidas = [];
        for (const palabra of limpio(t).split(" ")) { const prueba = linea ? linea + " " + palabra : palabra; if (font.widthOfTextAtSize(prueba, size) > maxW && linea) { salidas.push(linea); linea = palabra; } else linea = prueba; }
        salidas.push(linea);
        for (const l of salidas) { if (y < M + size) nueva(); pg.drawText(l, { x, y: y - size, size, font, color }); y -= size * 1.45; }
      };
      // Logo y encabezado
      try { const logo = await pdf.embedPng(await (await fetch("/img/logo.png")).arrayBuffer()); pg.drawImage(logo, { x: M, y: H - M - 58, width: 42, height: 58 }); } catch {}
      y = H - M - 6; texto("BÁSCULA Y PENSIÓN EL CASTAÑO", { size: 9, bold: true, color: rgb(0.45, 0.45, 0.45), x: M + 56 });
      const ext = c.tipo === "externo";
      texto(ext ? "Registro de externo" : "Expediente laboral", { size: 22, bold: true, x: M + 56 });
      texto(`${c.nombre} · Folio ${c.folio}`, { size: 14, x: M + 56 });
      y = Math.min(y, H - M - 72) - 10;
      const seccion = t => { y -= 8; if (y < M + 60) nueva(); texto(t.toUpperCase(), { size: 9.5, bold: true, color: rgb(0.55, 0.42, 0) }); pg.drawLine({ start: { x: M, y: y + 4 }, end: { x: W - M, y: y + 4 }, thickness: 0.6, color: rgb(0.8, 0.8, 0.8) }); y -= 4; };
      const fila = (k, v) => {
        if (y < M + 20) nueva();
        if (f.widthOfTextAtSize(limpio(k), 10) > 140) { texto(k, { size: 10, color: rgb(0.42, 0.42, 0.42) }); y += 4; }
        else { pg.drawText(limpio(k), { x: M, y: y - 10.5, size: 10, font: f, color: rgb(0.42, 0.42, 0.42) }); }
        const y0 = y; texto(v || "-", { x: M + 150 }); if (y > y0 - 15) y = y0 - 15;
      };
      const d = c.datos, a = c.admin;
      seccion(ext ? "Actividad dentro de El Castaño" : "Datos laborales");
      fila("Estatus", c.estatus === "inactivo" ? `Inactivo desde ${fecha(c.fecha_baja)}${c.motivo_baja ? " · " + c.motivo_baja : ""}` : "Activo");
      if (ext) { fila("Actividad", a.actividad); fila("Nacionalidad", a.nacionalidad || "Nacional"); fila("Fecha de inicio", fecha(a.fecha_ingreso)); fila("Días u horario", a.turno); }
      else { fila("Puesto", a.puesto); fila("Nacionalidad", a.nacionalidad || "Nacional"); fila("Fecha de ingreso", fecha(a.fecha_ingreso)); fila("Turno u horario", a.turno); fila("Fecha de entrevista", fecha(a.fecha_entrevista)); }
      seccion("Datos personales");
      fila("Nombre completo", d.nombre); fila("Fecha de nacimiento", fecha(d.fecha_nacimiento)); fila("Lugar de nacimiento", d.lugar_nacimiento); fila("CURP", d.curp); fila("Estado civil", d.estado_civil); fila("Teléfono", d.telefono); fila("Correo electrónico", d.correo);
      seccion("Domicilio");
      fila("Calle y número", d.calle); fila("Colonia", d.colonia); fila("Municipio", d.municipio); fila("Código postal", d.cp);
      seccion("Contacto de emergencia");
      fila("Nombre", d.emerg_nombre); fila("Parentesco", d.emerg_parentesco); fila("Teléfono", d.emerg_telefono);
      if (!ext) seccion("Escolaridad");
      if (!ext) { fila("Último grado", d.escolaridad); fila("Escuela", d.institucion); }
      seccion("Documentos");
      for (const x of c.docs) fila(x.nombre, x.recibido ? `Entregado ${fecha(x.fecha)}${x.fotos.length ? " · foto anexa" : " · en físico"}` : "Pendiente");
      // La constancia digital forma parte del expediente exportado, sin simular una firma.
      seccion("Constancia digital de privacidad");
      fila("Documento", "Aviso de privacidad para colaboradores");
      fila("Versión", "personal-aviso-v1-2026-10-17");
      fila("Recepción", c.acuse_v1_en
        ? new Intl.DateTimeFormat("es-MX", { timeZone: "America/Mexico_City", dateStyle: "medium", timeStyle: "short" }).format(new Date(c.acuse_v1_en))
        : "Pendiente - sin constancia digital v1");
      texto("Esta constancia registra la recepcion declarada desde el enlace personal. No sustituye documentos firmados en papel.", { size: 9 });
      if (c.admin_docs.length) { seccion("Documentos administrativos"); for (const x of c.admin_docs) fila(fecha(x.fecha), x.descripcion); }
      if (a.notas) { seccion(ext ? "Notas" : "Notas de la entrevista"); texto(a.notas); }
      y -= 10; texto(`Generado el ${new Intl.DateTimeFormat("es-MX", { timeZone: "America/Mexico_City", dateStyle: "long", timeStyle: "short" }).format(new Date())} · Datos tratados conforme al aviso de privacidad para colaboradores.`, { size: 8, color: rgb(0.5, 0.5, 0.5) });

      // Anexos: fotos y PDFs
      const anexos = [];
      for (const x of c.docs) for (const ft of x.fotos) anexos.push({ titulo: x.nombre + (ft.archivo === "ine2" ? " (reverso)" : ft.archivo === "ine" ? " (frente)" : ft.archivo === "solicitud2" ? " (hoja 2)" : ""), url: `/panel/api/colaboradores/${c.id}/archivo/${ft.archivo}` });
      for (const x of c.admin_docs) anexos.push({ titulo: `${x.descripcion} (${fecha(x.fecha)})`, url: `/panel/api/colaboradores/${c.id}/archivo-admin/${x.id}` });
      let n = 0;
      for (const ax of anexos) {
        n++; estado.textContent = `Agregando anexos ${n} de ${anexos.length}…`;
        const r = await fetch(ax.url); if (!r.ok) continue;
        const tipo = (r.headers.get("Content-Type") || "").split(";")[0];
        const bytes = new Uint8Array(await r.arrayBuffer());
        if (tipo === "application/pdf") {
          try {
            const otro = await PDFDocument.load(bytes, { ignoreEncryption: true });
            const pags = await pdf.copyPages(otro, otro.getPageIndices());
            pags.forEach((p, i) => { pdf.addPage(p); if (i === 0) p.drawText(limpio("Anexo: " + ax.titulo), { x: 18, y: p.getHeight() - 16, size: 8, font: fb, color: rgb(0.55, 0.42, 0) }); });
          } catch { nueva(); texto("Anexo: " + ax.titulo, { bold: true }); texto("No se pudo incluir este PDF (está protegido o dañado). Descárgalo desde el panel."); }
          continue;
        }
        let img;
        try { img = tipo === "image/jpeg" ? await pdf.embedJpg(bytes) : tipo === "image/png" ? await pdf.embedPng(bytes) : await pdf.embedJpg(await aJpeg(new Blob([bytes], { type: tipo }))); }
        catch { nueva(); texto("Anexo: " + ax.titulo, { bold: true }); texto("No se pudo incluir esta imagen por su formato. Descárgala desde el panel."); continue; }
        nueva(); texto("Anexo: " + ax.titulo, { size: 12, bold: true });
        const maxW = W - 2 * M, maxH = y - M, k = Math.min(maxW / img.width, maxH / img.height);
        pg.drawImage(img, { x: M + (maxW - img.width * k) / 2, y: y - img.height * k, width: img.width * k, height: img.height * k });
      }
      const out = await pdf.save();
      const url = URL.createObjectURL(new Blob([out], { type: "application/pdf" }));
      const link = document.createElement("a"); link.href = url; link.download = `${c.folio}-${ext ? "Registro-externo" : "Expediente"}-${c.nombre.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\w]+/g, "-")}.pdf`;
      document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000);
      estado.textContent = `Listo: ${pdf.getPageCount()} páginas.`;
    } catch (e) { estado.textContent = e.message || "No se pudo generar el PDF."; }
    b.disabled = false;
  }

  $("#p-drive").addEventListener("click", async e => {
    const b = e.currentTarget; b.disabled = true; $("#p-drive-nota").textContent = "Probando…";
    try { const r = await post("colaboradores/drive-probar"); st.config = r.config; $("#p-drive-nota").textContent = "Drive conectado: los documentos se copian solos a la carpeta de cada persona. Para los que ya estaban, usa «Copiar a Drive» en cada ficha."; }
    catch (err) { $("#p-drive-nota").textContent = err.message; }
    b.disabled = false;
  });
  // ---------------- Campañas de documentos ----------------
  const DOC_NOMBRES = { acuse_v1: "Constancia de recepción del aviso de privacidad v1", datos: "Revisar y actualizar sus datos", ine: "INE", curp: "CURP", solicitud: "Solicitud de empleo", acta: "Acta de nacimiento", domicilio: "Comprobante de domicilio", estudios: "Comprobante de último grado de estudios" };
  const pillCamp = c => c.abierta ? `<span class="pill faltan">Activa</span>` : `<span class="pill inactivo">Cerrada</span>`;
  const msgCampana = (cp, p) => {
    const soloAcuse = cp.docs.length === 1 && cp.docs[0] === "acuse_v1";
    return `Hola ${(p.nombre || "").split(" ")[0]}, te saluda Báscula y Pensión El Castaño. Abrimos «${cp.nombre}». Tienes hasta el ${fechaLarga(cp.limite)} para ${soloAcuse ? "confirmar" : "entregar"}: ${p.pendientes.map(x => x.toLowerCase()).join(", ")}.\n\n${soloAcuse ? "Lee el aviso de privacidad v1 y registra su recepción" : "Sube tus documentos y revisa tus datos"} en tu enlace personal (no lo compartas):\n${enlaceDe(p.token)}\n\nDespués de esa fecha el enlace se cierra. ${soloAcuse ? "Esta constancia no sustituye la firma de documentos impresos." : "Entrega también las copias físicas con Josué."}`;
  };
  const hoyMx = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(new Date());
  const masDias = (d, n) => new Date(new Date(d + "T12:00:00Z").getTime() + n * 864e5).toISOString().slice(0, 10);

  function irACampanas(ids, pedidos = []) {
    st.tipo = "campanas";
    if (EC.irBloque) EC.irBloque("personal", "campanas", { suave: true });
    nuevaCampana(ids, pedidos);
  }

  // Las campañas se ven en la misma lista que el personal
  async function cargarCampanas() { return cargar(); }

  async function nuevaCampana(pre = [], pedidos = []) {
    st.actual = null;
    document.querySelectorAll(".pitem").forEach(b => b.removeAttribute("aria-current"));
    $("#p-work").classList.add("ver-detalle");
    const d = $("#p-detalle");
    d.innerHTML = `<p class="empty">Cargando…</p>`;
    let gente = [];
    try { gente = (await api("colaboradores?" + new URLSearchParams({ tipo: "colaborador", estatus: "activo", filtro: "todos" }))).colaboradores; } catch (e) { d.innerHTML = `<p class="empty">${esc(e.message)}</p>`; return; }
    const mes = new Date().toLocaleDateString("es-MX", { month: "long", year: "numeric", timeZone: "America/Mexico_City" });
    const hoy = hoyMx();
    d.innerHTML = `
      <button class="btn btn-line back" id="p-volver" type="button">← Volver a la lista</button>
      <div class="detail-head"><h2>Nueva campaña</h2></div>
      <section class="card" id="cp-form" style="max-width:640px">
        <p class="note" style="margin:0">Al lanzarla se abre el enlace de cada persona hasta la fecha límite y le llega un correo con lo que debe entregar. A quien no tenga correo le mandas WhatsApp desde la campaña. Dos días antes del límite se manda solo un recordatorio, y al pasar la fecha los enlaces se cierran.</p>
        <div class="grid-form">
          <label class="wide">Nombre de la campaña<input type="text" id="cp-nombre" maxlength="80" value="${esc(pre.length === 1 ? "Documentos pendientes" : "Actualización de documentos " + mes)}"><span class="err" data-e="nombre"></span></label>
          <label>Fecha límite<input type="date" id="cp-limite" min="${hoy}" max="${masDias(hoy, 90)}" value="${masDias(hoy, 7)}"><span class="err" data-e="limite"></span></label>
        </div>
        <h3>¿A quién va?</h3>
        <div class="camp-dest">
          <label><input type="radio" name="cp-dest" value="incompletos" ${pre.length ? "" : "checked"}> Solo los que tienen el expediente incompleto (${gente.filter(g => !g.completo).length})</label>
          <label><input type="radio" name="cp-dest" value="activos"> Todos los colaboradores activos (${gente.length})</label>
          <label><input type="radio" name="cp-dest" value="elegidos" ${pre.length ? "checked" : ""}> Elegir personas</label>
        </div>
        <div class="camp-gente" id="cp-gente" ${pre.length ? "" : "hidden"}>${gente.map(g => `<label><input type="checkbox" value="${g.id}" ${pre.includes(g.id) ? "checked" : ""}> ${esc(g.nombre)} <span class="note">${g.completo ? "completo" : `${g.entregados}/${g.total}`}</span></label>`).join("") || `<p class="note">No hay colaboradores activos.</p>`}</div>
        <span class="err" data-e="destino"></span>
        <h3>¿Qué se pide?</h3>
        <div class="camp-dest">
          <label><input type="radio" name="cp-que" value="pendiente" ${pedidos.length ? "" : "checked"}> Todo lo que le falte de su expediente</label>
          <label><input type="radio" name="cp-que" value="elegir" ${pedidos.length ? "checked" : ""}> Documentos y constancias específicos</label>
        </div>
        <div class="camp-docs" id="cp-docs" ${pedidos.length ? "" : "hidden"}>${Object.entries(DOC_NOMBRES).map(([k, n]) => `<label><input type="checkbox" value="${k}" ${pedidos.includes(k) ? "checked" : ""}> ${esc(n)}</label>`).join("")}</div>
        <div class="row"><button class="btn btn-primary" id="cp-lanzar" type="button">Lanzar campaña</button><span class="note" id="cp-estado"></span></div>
      </section>`;
    const sync = () => {
      $("#cp-gente").hidden = d.querySelector("[name=cp-dest]:checked").value !== "elegidos";
      $("#cp-docs").hidden = d.querySelector("[name=cp-que]:checked").value !== "elegir";
    };
    d.querySelectorAll("[name=cp-dest],[name=cp-que]").forEach(r => r.addEventListener("change", sync));
    $("#p-volver").addEventListener("click", () => { $("#p-work").classList.remove("ver-detalle"); d.innerHTML = `<p class="empty">Elige una campaña o lanza una nueva.</p>`; });
    $("#cp-lanzar").addEventListener("click", async e => {
      const b = e.currentTarget, cont = $("#cp-form");
      const que = d.querySelector("[name=cp-que]:checked").value;
      const docs = que === "elegir" ? [...d.querySelectorAll("#cp-docs input:checked")].map(x => x.value) : [];
      if (que === "elegir" && !docs.length) { toast("Elige al menos un documento"); return; }
      b.disabled = true; $("#cp-estado").textContent = "Lanzando y enviando correos…";
      try {
        const r = await post("colaboradores/campanas", { nombre: $("#cp-nombre").value, limite: $("#cp-limite").value, destino: d.querySelector("[name=cp-dest]:checked").value, ids: [...d.querySelectorAll("#cp-gente input:checked")].map(x => x.value), docs });
        const v = r.envio || {};
        toast(`Campaña lanzada · ${v.enviados || 0} correo${v.enviados === 1 ? "" : "s"} enviado${v.enviados === 1 ? "" : "s"}`);
        await cargarCampanas(); await abrirCampana(r.id);
        if (v.sin_correo && v.sin_correo.length || v.error) $("#cp-envio").textContent = [v.sin_correo.length ? `Sin correo: ${v.sin_correo.join(", ")}. Mándales WhatsApp con el botón de cada uno.` : "", v.error || ""].filter(Boolean).join(" ");
      } catch (err) { errores(cont, err.errores); $("#cp-estado").textContent = err.message; b.disabled = false; }
    });
  }

  async function abrirCampana(id) {
    st.actual = id;
    document.querySelectorAll(".pitem").forEach(b => b.toggleAttribute("aria-current", b.dataset.id === id));
    $("#p-work").classList.add("ver-detalle");
    const d = $("#p-detalle");
    d.innerHTML = `<p class="empty">Cargando…</p>`;
    let j;
    try { j = await api("colaboradores/campanas/" + id); } catch (e) { d.innerHTML = `<p class="empty">${esc(e.message)}</p>`; return; }
    const cp = j.campana, hoy = j.hoy;
    const pedidos = cp.docs.length ? cp.docs.map(k => DOC_NOMBRES[k] || k).join(", ") : "Todo lo que le falte de su expediente";
    let fuera = [];
    if (cp.abierta) try { fuera = (await api("colaboradores?" + new URLSearchParams({ tipo: "colaborador", estatus: "activo", filtro: "todos" }))).colaboradores.filter(g => !cp.personas.some(p => p.id === g.id)); } catch {}
    d.innerHTML = `
      <button class="btn btn-line back" id="p-volver" type="button">← Volver a la lista</button>
      <div class="detail-head"><h2>${esc(cp.nombre)}</h2>${pillCamp(cp)}</div>
      <div class="cols">
        <div style="display:grid;gap:24px">
          <section class="card">
            <h3>Avance</h3>
            <div class="row" style="justify-content:space-between"><span class="note">${cp.abierta ? `Los enlaces están abiertos hasta el ${esc(fechaLarga(cp.limite))}.` : `Cerrada${cp.cerrada ? " el " + esc(fecha(cp.cerrada)) : ""}. Los enlaces ya no funcionan.`}</span><b>${cp.completos} de ${cp.total}</b></div>
            <div class="barra ${cp.total && cp.completos === cp.total ? "ok" : ""}"><i style="width:${cp.total ? cp.completos / cp.total * 100 : 0}%"></i></div>
            <p class="note" style="margin:0">Se pide: ${esc(pedidos)}. Lanzada el ${esc(fecha(cp.creado))}.${cp.recordada ? ` Recordatorio automático enviado el ${esc(fecha(cp.recordada))}.` : cp.abierta ? " Dos días antes del límite se manda solo un recordatorio a quien le falte algo." : ""}</p>
            <p class="note" style="margin:0" id="cp-envio"></p>
            <div class="row">
              ${cp.abierta ? `<button class="btn btn-primary" id="cp-recordar" type="button">Recordar por correo a quien falta</button>` : ""}
              <label class="note" style="display:inline-flex;gap:8px;align-items:center">${cp.abierta ? "Cambiar fecha límite" : "Reabrir hasta"}<input type="date" id="cp-lim" min="${hoy}" max="${masDias(hoy, 90)}" value="${cp.abierta ? cp.limite : masDias(hoy, 7)}" style="padding:8px 10px;border:1px solid var(--line);border-radius:10px;background:#0b0b0c"></label>
              <button class="btn btn-line" id="cp-lim-ok" type="button">${cp.abierta ? "Guardar fecha" : "Reabrir"}</button>
            </div>
            <div class="row">
              ${cp.abierta ? `<button class="btn btn-line" id="cp-cerrar" type="button">Cerrar ahora</button>` : ""}
              <button class="btn btn-line" id="cp-eliminar" type="button">Eliminar campaña</button>
            </div>
          </section>
          ${cp.abierta && fuera.length ? `<section class="card">
            <h3>Agregar personas</h3>
            <div class="row"><select id="cp-add" style="flex:1;min-width:200px">${fuera.map(g => `<option value="${g.id}">${esc(g.nombre)}</option>`).join("")}</select><button class="btn btn-line" id="cp-add-ok" type="button">Agregar y enviar correo</button></div>
          </section>` : ""}
        </div>
        <section class="card">
          <h3>Personas (${cp.total})</h3>
          <div>${cp.personas.map(p => `<div class="camp-p" data-p="${p.id}">
            ${VINC[p.id] ? avP(VINC[p.id], 1) : iconoEst(p.estatus)}
            <b>${esc(p.nombre)}</b>
            ${p.completo ? `<span class="pill completo">Completó</span>` : `<span class="pill faltan">Pendiente</span>`}
             ${cp.docs.includes("acuse_v1") ? `<span class="note">${p.acuse_v1_en ? "V1 recibida: " + esc(fecha(p.acuse_v1_en)) : "V1: sin constancia"}</span>` : ""}
            ${p.completo ? "" : `<span class="falta">Falta: ${esc(p.pendientes.join(", "))}</span>`}
            <span class="falta">${p.estatus === "inactivo" ? "Inactivo: su enlace no funciona." : p.enviado ? `Último correo: ${esc(fecha(p.enviado))}` : p.correo ? "Sin correo enviado todavía" : "Sin correo registrado"}</span>
            <span class="acc">
              ${cp.abierta && !p.completo && p.telefono && p.estatus !== "inactivo" ? `<a class="btn btn-primary" href="${urlWa(p.telefono, msgCampana(cp, p))}" target="_blank" rel="noopener">WhatsApp</a>` : ""}
              ${cp.abierta && !p.completo && p.estatus !== "inactivo" ? `<button class="btn btn-line" data-copiar="${p.id}" type="button">Copiar mensaje</button>` : ""}
              <button class="btn btn-line" data-ver="${p.id}" type="button">Ver expediente</button>
              ${cp.abierta ? `<button class="btn btn-line" data-quitar="${p.id}" type="button">Quitar</button>` : ""}
            </span>
          </div>`).join("") || `<p class="note">Sin personas.</p>`}</div>
        </section>
      </div>`;
    $("#p-volver").addEventListener("click", () => { $("#p-work").classList.remove("ver-detalle"); st.actual = null; cargarCampanas(); });
    const accion = async (ruta, cuerpo, ok) => { try { const r = await post(`colaboradores/campanas/${id}/${ruta}`, cuerpo); if (ok) ok(r); await cargarCampanas(); await abrirCampana(id); } catch (e) { toast(e.message); } };
    if ($("#cp-recordar")) $("#cp-recordar").addEventListener("click", e => {
      e.currentTarget.disabled = true;
      accion("recordar", {}, r => { toast(`${r.enviados} recordatorio${r.enviados === 1 ? "" : "s"} enviado${r.enviados === 1 ? "" : "s"}`); setTimeout(() => { if ($("#cp-envio")) $("#cp-envio").textContent = [r.sin_correo.length ? `Sin correo: ${r.sin_correo.join(", ")}. Usa su botón de WhatsApp.` : "", r.error || ""].filter(Boolean).join(" "); }, 50); });
    });
    $("#cp-lim-ok").addEventListener("click", () => accion("limite", { limite: $("#cp-lim").value }, () => toast(cp.abierta ? "Fecha guardada" : "Campaña reabierta")));
    const armar = (b, txt, fn) => b.addEventListener("click", () => {
      if (!b.classList.contains("armed")) { const t0 = b.textContent; b.classList.add("armed", "btn-bad"); b.textContent = txt; setTimeout(() => { b.classList.remove("armed", "btn-bad"); b.textContent = t0; }, 4000); return; }
      fn();
    });
    if ($("#cp-cerrar")) armar($("#cp-cerrar"), "¿Cerrar? Los enlaces dejan de funcionar", () => accion("cerrar", {}, () => toast("Campaña cerrada")));
    armar($("#cp-eliminar"), "¿Eliminar? Se borra la campaña (no los expedientes)", async () => { try { await post(`colaboradores/campanas/${id}/eliminar`); toast("Campaña eliminada"); st.actual = null; $("#p-work").classList.remove("ver-detalle"); $("#p-detalle").innerHTML = `<p class="empty">Elige una campaña o lanza una nueva.</p>`; cargarCampanas(); } catch (e) { toast(e.message); } });
    if ($("#cp-add-ok")) $("#cp-add-ok").addEventListener("click", e => { e.currentTarget.disabled = true; accion("agregar", { ids: [$("#cp-add").value] }, r => toast(r.envio && r.envio.enviados ? "Agregado y correo enviado" : "Agregado" + (r.envio && r.envio.sin_correo.length ? " (sin correo: usa WhatsApp)" : ""))); });
    d.querySelectorAll("[data-quitar]").forEach(b => armar(b, "¿Quitar?", () => accion("quitar", { colaborador: b.dataset.quitar }, () => toast("Quitado de la campaña"))));
    d.querySelectorAll("[data-copiar]").forEach(b => b.addEventListener("click", async () => { try { await navigator.clipboard.writeText(msgCampana(cp, cp.personas.find(p => p.id === b.dataset.copiar))); toast("Mensaje copiado"); } catch { toast("No se pudo copiar"); } }));
    d.querySelectorAll("[data-ver]").forEach(b => b.addEventListener("click", () => {
      st.tipo = "colaborador";
      abrir(b.dataset.ver);
    }));
  }

  function nuevo() {
    st.actual = null;
    document.querySelectorAll(".pitem").forEach(b => b.removeAttribute("aria-current"));
    $("#p-work").classList.add("ver-detalle");
    const d = $("#p-detalle");
    st.listas = { ...(st.listas || {}), puestos: ["Báscula y Pensión", "Administración", "Mantenimiento"], nacionalidad: ["Nacional", "Naturalizado"], actividades: ["Lavado de trailers", "Venta de ropa", "Venta de comida", "Otra"] };
    const ext = EXT();
    d.innerHTML = `
      <button class="btn btn-line back" id="p-volver" type="button">← Volver a la lista</button>
      <div class="detail-head"><h2>${ext ? "Nuevo externo" : "Nuevo colaborador"}</h2></div>
      <section class="card" id="p-alta" style="max-width:640px">
        <p class="note" style="margin:0">${ext ? "Al crearlo se le asigna su folio y su registro se envía al encargado de turno (correo entrada@basculaypension.com y WhatsApp 962 216 5453), que lo completa con la persona presente. Al externo no se le envía nada." : "Al crearlo se genera su enlace personal: le llega por correo si escribes su correo, y se abre tu WhatsApp con el mensaje listo para enviárselo. Él llena el resto desde su celular."}</p>
        <div class="grid-form">
          ${input("nombre", "Nombre completo", "wide")}
          ${input("telefono", ext ? "Teléfono del externo (opcional)" : "WhatsApp", "", "tel")}
          ${ext ? "" : input("correo", "Correo electrónico", "", "email")}
          ${input("nacionalidad", "Nacionalidad", "", "lista:nacionalidad", "Nacional")}
          <p class="note wide" style="margin:-4px 0 0;font-size:var(--t-sm)">Nacional: se le pide INE. Naturalizado: se le pide pasaporte o tarjeta de residente.</p>
          ${ext ? input("actividad", "Actividad", "", "lista:actividades") : input("puesto", "Puesto", "", "lista:puestos")}
          ${input("fecha_ingreso", ext ? "Fecha de inicio" : "Fecha de ingreso", "", "date")}
        </div>
        <div class="row"><button class="btn btn-primary" id="p-crear" type="button">${ext ? "Crear y enviar al encargado" : "Crear y enviar enlace"}</button></div>
      </section>`;
    $("#p-volver").addEventListener("click", () => { $("#p-work").classList.remove("ver-detalle"); d.innerHTML = `<p class="empty">Elige un colaborador o agrega uno nuevo.</p>`; });
    $("#p-crear").addEventListener("click", async e => {
      const b = e.currentTarget; b.disabled = true;
      const cont = $("#p-alta");
      const valores = { ...leer(cont), tipo: st.tipo };
      const tel = (valores.telefono || "").replace(/\D/g, "").slice(-10);
      // La ventana de WhatsApp se abre en el mismo toque (si no, el navegador la bloquea) y se llena al tener el enlace
      const ventana = valores.tipo === "externo" ? window.open("", "_blank") : tel.length === 10 ? window.open("", "_blank") : null;
      try {
        const r = await post("colaboradores", valores);
        if (ventana && valores.tipo === "externo") ventana.location.href = urlWa(ENCARGADO_WA, msgEncargadoAlta(valores.nombre, r.folio, valores.actividad, r.token));
        else if (ventana) {
          const nat = valores.nacionalidad === "Naturalizado";
          const idDoc = nat ? "identificación oficial (pasaporte o tarjeta de residente)" : "INE";
          const docs = valores.tipo === "externo" ? [idDoc, "CURP", "comprobante de domicilio", "una foto tuya"] : [idDoc, "CURP", "solicitud de empleo", "acta de nacimiento", "comprobante de domicilio", "comprobante de último grado de estudios"];
          ventana.location.href = urlWa(tel, mensajeWa(valores.nombre, r.token, docs, valores.tipo));
        }
        await cargar(); await abrir(r.id);
        if (r.correo && r.correo.error) { toast("Creado. " + r.correo.error); $("#p-correo-estado").textContent = r.correo.error; }
        else if (r.correo && r.correo.enviado) toast(valores.tipo === "externo" ? "Externo creado y enviado al encargado" : "Creado y enviado por correo");
        else toast(valores.tipo === "externo" ? "Externo registrado" : "Colaborador creado");
      } catch (err) { if (ventana) ventana.close(); errores(cont, err.errores); toast(err.message); b.disabled = false; }
    });
    $("#p-alta [data-k=nombre]").focus();
  }

  // Al abrir un registro, su tipo decide cómo se ve el detalle
  $("#p-lista").addEventListener("click", e => { const it = e.target.closest(".pitem"); if (!it) return; st.tipo = it.dataset.tipo || "colaborador"; (CAMP() ? abrirCampana : abrir)(it.dataset.id); });
  document.querySelectorAll("#mod-personal .ptabs").forEach(g => g.addEventListener("click", e => {
    const t = e.target.closest(".ptab"); if (!t) return;
    g.querySelectorAll(".ptab").forEach(x => x.setAttribute("aria-selected", x === t ? "true" : "false"));
    if (t.dataset.estatus) { st.estatus = t.dataset.estatus; st.actual = null; $("#p-detalle").innerHTML = `<p class="empty">Elige un colaborador o agrega uno nuevo.</p>`; $("#p-work").classList.remove("ver-detalle"); }
    else st.filtro = t.dataset.filtro;
    cargar();
  }));
  let h; $("#p-q").addEventListener("input", e => { clearTimeout(h); h = setTimeout(() => { st.q = e.target.value.trim(); cargar(); }, 300); });
  document.querySelectorAll("#mod-personal [data-nuevo]").forEach(b => b.addEventListener("click", () => { st.tipo = b.dataset.nuevo; CAMP() ? nuevaCampana() : nuevo(); }));

  const inicial = EC.ruta();
  if (inicial.mod !== "inicio") mostrar(inicial.mod, { vista: inicial.vista });
  window.irA = (mod, opciones = { historia: "push" }) => mostrar(mod, opciones);
})();
