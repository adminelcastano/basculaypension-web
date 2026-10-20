(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const estadoState = { estado: "pendiente", q: "", actual: null, cat: null };
  const lecturasCsfAutomaticas = new Set();
  const fmt = new Intl.DateTimeFormat("es-MX", { timeZone: "America/Mexico_City", dateStyle: "medium", timeStyle: "short" });
  const fecha = iso => iso ? fmt.format(new Date(iso)) : "";
  const esc = EC.esc;

  const SERVICIO_ICONO = { bascula: ["i-bascula", "Báscula"], pension: ["i-pension", "Pensión"], ambos: ["i-bascula", "Báscula y pensión"] };
  const iconoServicio = servicio => {
    const [ico, nombre] = SERVICIO_ICONO[servicio] || ["i-inbox", servicio || "Servicio"];
    return `<span class="svc ${esc(servicio || "")}" title="${esc(nombre)}" role="img" aria-label="${esc(nombre)}"><svg aria-hidden="true"><use href="#${ico}"/></svg></span>`;
  };
  const dinero = v => "$" + Number(v).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  function mensajeCliente(s, servicios, cfdis = []) {
    const concepto = { bascula: "servicio de báscula", pension: "servicio de pensión", ambos: "servicios de báscula y pensión" }[s.servicio] || "servicio";
    const unidad = [s.descripcion, s.placas ? `placas ${s.placas}` : ""].filter(Boolean).join(", ");
    const ticket = (s.folio_ticket ? `tu ticket ${s.folio_ticket}` : "tu ticket") + (unidad ? ` (${unidad})` : "");
    const importe = s.importe ? ` por ${dinero(s.importe)}` : "";
    const cancelados = cfdis.filter(x => x.estado === "cancelada");
    const vigentes = cfdis.filter(x => x.estado === "vigente");
    if (cancelados.length) {
      const originales = cancelados.map(x => x.folio).join(", ");
      const nuevos = vigentes.map(x => x.folio).join(", ");
      return `Hola, te saluda Báscula y Pensión El Castaño. Te informamos que ${cancelados.length === 1 ? "la factura" : "las facturas"} ${originales} ${cancelados.length === 1 ? "fue cancelada" : "fueron canceladas"} en Facturador. ${nuevos ? "Los nuevos comprobantes registrados son: " + nuevos + ". Te haremos llegar sus PDF y XML por el medio acordado." : "Estamos revisando cómo corresponde continuar y te avisaremos cuando haya nuevos comprobantes."} Tu solicitud es ${s.folio}. Si tienes dudas, responde este mensaje.`;
    }
    if (vigentes.length > 1)
      return `Hola, te saluda Báscula y Pensión El Castaño. Para tu solicitud ${s.folio}, registramos dos facturas: ${vigentes.map(x => x.folio + " (" + dinero(x.importe) + ")").join(" y ")}. Coordinaremos contigo la entrega de los documentos PDF y XML. Gracias por tu preferencia.`;
    if (s.estado === "facturada" || s.estado === "enviada") {
      return `Hola, te saluda Báscula y Pensión El Castaño. Te confirmamos que ${ticket}${importe} por concepto de ${concepto} quedó facturado con el número de factura ${s.folio_factura}. ${s.estado === "enviada" ? "La administración ya confirmó su entrega." : "La administración coordinará la entrega del comprobante."} Gracias por tu preferencia.`;
    }
    if (s.estado === "rechazada") {
      return `Hola, te saluda Báscula y Pensión El Castaño. No pudimos emitir la factura de tu solicitud ${s.folio}${s.folio_ticket ? ` (ticket ${s.folio_ticket})` : ""}: ${s.motivo || ""}. Puedes enviar tus datos de nuevo aquí:\nhttps://basculaypension.com/factura`;
    }
    return `Hola, te saluda Báscula y Pensión El Castaño. Recibimos tu solicitud de factura ${s.folio}${s.folio_ticket ? ` del ticket ${s.folio_ticket}` : ""}${importe} por concepto de ${concepto}. La estamos revisando.${s.email ? ` Al emitirla, coordinaremos su envío al correo ${s.email}.` : " Si necesitas aclarar o recibir tu factura, comunícate con administración indicando tu folio."}`;
  }

  const toast = EC.toast;

  // Imagen de perfil de un encargado de la tablet ("admin" = logo de la pensión)
  // ---- Categorías de egresos (lista para elegir o escribir, con icono de línea) ----
  window.CATS = window.CATS || [];
  window.ponerCategorias = lista => {
    if (!Array.isArray(lista)) return;
    window.CATS = lista;
    const dl = document.getElementById("dl-cats"); if (dl) dl.innerHTML = lista.map(c => `<option value="${esc(c.etiqueta || c.nombre)}"></option>`).join("");
  };
  window.catInfo = nombre => window.CATS.find(c => c.nombre === nombre) || { nombre: nombre || "Sin categoría", icono: "otros", color: "#8e8e93" };
  window.catIco = (nombre, tam = 16) => { const c = window.catInfo(nombre); return `<svg class="cat-ico" style="width:${tam}px;height:${tam}px;color:${c.color}" aria-hidden="true"><use href="#i-cat-${esc(c.icono)}"/></svg>`; };
  // Nombre visible (se puede cambiar en Categorías; lo guardado conserva su clave)
  window.catNombre = nombre => { const c = window.CATS.find(x => x.nombre === nombre); return c ? c.etiqueta || c.nombre : nombre || ""; };
  window.catChip = nombre => nombre ? `<span class="cat-chip">${window.catIco(nombre, 14)}${esc(window.catNombre(nombre))}</span>` : "";
  window.campoCategoria = (valor = "", clase = "w2") => `<label class="${clase}">Categoría <span class="ayuda">(elige o escribe una nueva)</span><input name="categoria" list="dl-cats" maxlength="40" value="${esc(window.catNombre(valor))}" placeholder="Ej. Servicios" autocomplete="off"></label>`;
  // ---- Cuentas (cómo se pagó: efectivo de los sobres, una cuenta de débito o una tarjeta de crédito) ----
  window.CUENTAS = window.CUENTAS || [];
  window.valorMedio = (forma, cuenta) => cuenta ? "C:" + cuenta : (forma || "");
  window.medioTxt = (forma, cuenta) => {
    if (forma === "EFECTIVO") return "Efectivo (sobres)";
    const c = cuenta && window.CUENTAS.find(x => x.id === cuenta);
    if (c) return (c.tipo === "credito" ? "Crédito " : "") + c.nombre;
    return { TRANSFERENCIA: "Transferencia (sin cuenta)", TARJETA: "Tarjeta (sin cuenta)" }[forma] || forma || "";
  };
  window.opcionesMedio = (valor, efectivo = true) => {
    const C = window.CUENTAS, deb = C.filter(c => c.tipo !== "credito"), cred = C.filter(c => c.tipo === "credito");
    const porDef = (C.find(c => c.def_pago) || deb[0] || {}).id;
    const v = valor || (porDef ? "C:" + porDef : "EFECTIVO");
    const op = (val, t) => `<option value="${esc(val)}" ${val === v ? "selected" : ""}>${esc(t)}</option>`;
    const viejo = ["TRANSFERENCIA", "TARJETA"].includes(v) ? op(v, window.medioTxt(v)) : "";
    return (efectivo ? op("EFECTIVO", "Efectivo (sobres)") : "") + viejo +
      (deb.length ? `<optgroup label="Cuentas (transferencia o débito)">${deb.map(c => op("C:" + c.id, c.nombre)).join("")}</optgroup>` : "") +
      (cred.length ? `<optgroup label="Tarjetas de crédito">${cred.map(c => op("C:" + c.id, c.nombre)).join("")}</optgroup>` : "");
  };
  window.avP = (clave, grande) => `<img class="avp${grande ? " g" : ""}" src="/panel/api/turno/avatar/c/${encodeURIComponent(clave || "admin")}" alt="" width="${grande ? 36 : 22}" height="${grande ? 36 : 22}" loading="lazy">`;
  const api = EC.api;

  // Todas las solicitudes a la vista, agrupadas por estado (el submenú baja a cada grupo)
  const ESTADOS = ["pendiente", "facturada", "enviada", "rechazada", "cancelada", "historico"];
  const NOM_EST = { pendiente: "Recibidas y en revisión", facturada: "Facturadas", enviada: "Enviadas al cliente", rechazada: "Rechazadas", cancelada: "Canceladas", historico: "Histórico" };
  const ICO_EST = { pendiente: "i-inbox", facturada: "i-ok", enviada: "i-ok", rechazada: "i-x", cancelada: "i-x", historico: "i-arch" };
  let secuenciaLista = 0;
  async function cargarLista() {
    const solicitud = ++secuenciaLista;
    const lista = $("#lista");
    estadoState.lim = estadoState.lim || {};
    const clavePag = estadoState.q || "";
    if (estadoState.clavePag !== clavePag) { estadoState.clavePag = clavePag; estadoState.lim = {}; }
    try {
      const rs = await Promise.all(ESTADOS.map((e, i) => {
        const p = new URLSearchParams({ estado: e, limite: estadoState.lim[e] || 200 });
        if (i > 0) p.set("solo_lista", "1");
        if (estadoState.q) p.set("q", estadoState.q);
        return api("solicitudes?" + p);
      }));
      if (solicitud !== secuenciaLista) return;
      const conteos = rs[0].conteos || {}, dias = rs[0].dias_retencion || 90;
      for (const e of ESTADOS) EC.bloqueN("facturacion", e, conteos[e] || 0, e === "pendiente" && (conteos[e] || 0) > 0);
      // Línea de estado de cada tarjeta del índice (celular y tablet)
      const masVieja = (rs[0].solicitudes || []).reduce((a, s) => !a || s.creado < a ? s.creado : a, null);
      const horas = masVieja ? Math.floor((Date.now() - Date.parse(masVieja)) / 36e5) : 0;
      EC.bloqueInfo("facturacion", "pendiente", { texto: !(conteos.pendiente) ? "Nada por facturar" : horas >= 48 ? `La más antigua espera ${Math.floor(horas / 24)} días` : horas >= 1 ? `La más antigua espera ${horas} h` : "Recién llegadas" });
      EC.bloqueInfo("facturacion", "facturada", { texto: "Últimos 7 días" });
      EC.bloqueInfo("facturacion", "enviada", { texto: "Últimos 7 días" });
      EC.bloqueInfo("facturacion", "rechazada", { texto: "Últimos 7 días" });
      EC.bloqueInfo("facturacion", "cancelada", { texto: "Conservar historial" });
      EC.bloqueInfo("facturacion", "historico", { texto: `Se borran a los ${dias} días` });
      $("#titulo").textContent = "Facturas.";
      $("#subtitulo").textContent = `${conteos.pendiente || 0} recibidas/en revisión · ${conteos.facturada || 0} facturadas · ${conteos.enviada || 0} enviadas · ${conteos.rechazada || 0} rechazadas · ${conteos.cancelada || 0} canceladas · ${conteos.historico || 0} en histórico`;
      const restan = iso => Math.max(0, Math.ceil(dias - (Date.now() - new Date(iso).getTime()) / 86400e3));
      const VACIO = { pendiente: "No hay solicitudes recibidas o en revisión.", facturada: "Sin facturas por enviar en los últimos 7 días.", enviada: "Sin facturas entregadas en los últimos 7 días.", rechazada: "Sin rechazos en los últimos 7 días.", cancelada: "Sin CFDI cancelados pendientes de sustitución.", historico: "El histórico está vacío." };
      const AYUDA = { rechazada: "Desliza una a la derecha para eliminarla.", historico: `Se eliminan ${dias} días después de facturar o rechazar. Antes se guarda un respaldo en Google Drive.` };
      lista.innerHTML = ESTADOS.map((e, i) => {
        const j = rs[i], n = conteos[e] || 0, l = j.solicitudes.filter(s => !borrandoIds.has(s.id));
        return `<div class="lgrp-g" data-grupo="${e}"><h4 class="lgrp" data-bloque="${e}"><svg aria-hidden="true"><use href="#${ICO_EST[e]}"/></svg><span>${NOM_EST[e]}</span><b class="bq-n ${e === "pendiente" && n ? "rojo" : ""}" ${n ? "" : "hidden"}>${n}</b></h4>`
          + (AYUDA[e] && l.length ? `<p class="note lgrp-n">${AYUDA[e]}</p>` : "")
          + (l.length ? l.map(s => `${e === "rechazada" ? `<div class="swipe" data-id="${s.id}"><div class="swipe-bg" aria-hidden="true"><svg class="ti"><use href="#i-trash"/></svg><span>Eliminar</span></div><button class="swipe-del" type="button" tabindex="-1" data-del="${s.id}">Eliminar</button>` : ""}
        <button class="item" data-id="${s.id}" ${estadoState.actual === s.id ? 'aria-current="true"' : ""}>
          <svg class="chev" aria-hidden="true"><use href="#i-chev"/></svg>
          ${iconoServicio(s.servicio)}
          <span class="t">${esc(s.nombre || (s.modo === "csf" ? "Constancia por revisar" : "Sin nombre"))}</span>
          <span class="m"><span>${esc(s.rfc || "RFC por revisar")}</span><span>${esc(s.folio)}</span></span>
          <span class="m"><span>${fecha(["pendiente", "en_revision"].includes(s.estado) ? s.creado : s.resuelta_en)}</span>${s.folio_factura ? `<span>Factura ${esc(s.folio_factura)}</span>` : ""}${s.estado === "en_revision" ? `<span>En revisión</span>` : ""}${s.estado === "enviada" ? `<span>Entregada</span>` : ""}${e === "historico" ? `<span>${s.estado === "rechazada" ? "Rechazada · " : ""}se borra en ${restan(s.resuelta_en)} días</span>` : ""}</span>
        </button>${e === "rechazada" ? "</div>" : ""}`).join("") : `<p class="note lgrp-n">${estadoState.q ? "Sin resultados." : VACIO[e]}</p>`)
          + (j.hay_mas ? `<button class="btn btn-line" type="button" data-mas="${e}" style="width:calc(100% - 24px);margin:8px 12px 12px">Ver más ${NOM_EST[e].toLowerCase()}</button>` : "") + `</div>`;
      }).join("");
      lista.querySelectorAll("[data-mas]").forEach(b => b.addEventListener("click", () => { estadoState.lim[b.dataset.mas] = (estadoState.lim[b.dataset.mas] || 200) + 200; b.disabled = true; cargarLista(); }));
    } catch (e) { if (solicitud === secuenciaLista && e.message !== "sesion") lista.innerHTML = `<p class="empty">No se pudo cargar la lista: ${esc(e.message)}</p>`; }
  }

  function campo(etiqueta, valor, copiable = true) {
    const vacio = !valor;
    return `<div class="field"><span class="k">${etiqueta}</span><span class="v ${vacio ? "vacio" : ""}">${vacio ? "Falta" : esc(valor)}</span>${copiable && !vacio ? `<button class="copy" data-copy="${esc(valor)}" type="button">Copiar</button>` : "<span></span>"}</div>`;
  }

  async function abrir(id) {
    estadoState.actual = id;
    document.querySelectorAll(".item").forEach(b => b.toggleAttribute("aria-current", b.dataset.id === id));
    $("#work").classList.add("ver-detalle");
    const d = $("#detalle");
    d.innerHTML = `<p class="empty">Cargando…</p>`;
    let j;
    try { j = await api("solicitudes/" + id); } catch (e) { d.innerHTML = `<p class="empty">${esc(e.message)}</p>`; return; }
    const s = j.solicitud; estadoState.cat = j;
    const cfdis = j.cfdis || [], cancelados = cfdis.filter(x => x.estado === "cancelada"), vigentes = cfdis.filter(x => x.estado === "vigente");
    const reg = s.regimen ? `${s.regimen} · ${j.regimenes[s.regimen] || ""}` : "";
    const uso = s.uso ? `${s.uso} · ${j.usos[s.uso] || ""}` : "";
    const pago = s.forma_pago ? `${s.forma_pago} · ${(j.formas_pago || {})[s.forma_pago] || ""}` : "";
    const tel = s.telefono ? `52${s.telefono}` : "";
    const archivo = tipo => `/panel/api/solicitudes/${s.id}/archivo/${tipo}`;
    const docHtml = (tipo, mime, titulo) => {
      if (s.archivos_borrados) return `<p class="note">El archivo se borró automáticamente ${90} días después de resolver la solicitud.</p>`;
      if (mime === "application/pdf") return `<div class="pdfview" data-pdf="${tipo}" aria-label="${titulo}"><p class="note">Cargando documento…</p></div><div class="row"><a class="btn btn-line" href="${archivo(tipo)}" target="_blank" rel="noopener">Abrir PDF completo</a></div>`;
      return `<a href="${archivo(tipo)}" target="_blank" rel="noopener"><img src="${archivo(tipo)}" alt="${titulo}" loading="lazy"></a>`;
    };
    const faltan = !/^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/.test(String(s.rfc || "").toUpperCase()) ||
      String(s.nombre || "").trim().length < 3 || !/^\d{5}$/.test(String(s.cp || "")) ||
      !j.regimenes?.[s.regimen] || !j.usos?.[s.uso] || !j.formas_pago?.[s.forma_pago];
    const bloqueado = ["facturada", "enviada", "cancelada"].includes(s.estado);
    const duplicada = !!(j.ya_facturado && j.ya_facturado.solicitud_id !== s.id);
    const esBascula = s.servicio === "bascula";
    const capturado = !!(s.folio_ticket || s.importe);

    d.innerHTML = `
      <button class="btn btn-line back" id="volver" type="button">← Volver a la lista</button>
      <div class="detail-head">
        <h2>${esc(s.nombre || "Solicitud " + s.folio)}</h2>
        <span class="svc-tag">${iconoServicio(s.servicio)}${esc(j.servicios[s.servicio] || s.servicio || "")}</span>
        <span class="pill ${s.estado}">${{ pendiente: "Recibida", en_revision: "En revisión", facturada: "Facturada", enviada: "Enviada al cliente", rechazada: "Rechazada", cancelada: "CFDI cancelado" }[s.estado]}</span>
        <span class="note">Folio ${esc(s.folio)} · recibida ${fecha(s.creado)}</span>
      </div>
      <div class="fflujo">
          <section class="card">
            <h3 class="fpaso"><span class="num">1</span>Datos para Facturador</h3><p class="note fguia">Copia cada dato con su botón y pégalo en Facturador.</p>
            ${s.modo === "csf" && !s.datos_de_csf && faltan ? `<p class="warn">El cliente envió su constancia. Los datos se leen solos del PDF; si es una foto o un escaneo, captúralos abajo viendo el documento.</p>` : ""}
            ${s.datos_de_csf ? `<p class="note">Datos tomados de la constancia. Verifícalos contra el documento.</p>` : ""}
            <div class="fields">
              ${campo("RFC", s.rfc)}
              ${campo("Nombre o razón social", s.nombre)}
              ${campo("Código postal", s.cp)}
              ${campo("Régimen fiscal", reg)}
              ${campo("Uso del CFDI", uso)}
              ${campo("Forma de pago", pago)}
              ${campo("Correo", s.email)}
            </div>
            <details class="corregir"><summary>Corregir datos fiscales</summary>
            <div class="grid-form" id="form-datos">
              <label>RFC<input id="d-rfc" value="${esc(s.rfc)}" autocomplete="off"></label>
              <label>Código postal<input id="d-cp" value="${esc(s.cp)}" inputmode="numeric" maxlength="5"></label>
              <label class="wide">Nombre o razón social<input id="d-nombre" value="${esc(s.nombre)}"></label>
              <label class="wide">Correo para recibir la factura<input id="d-email" type="email" value="${esc(s.email)}" maxlength="254" autocomplete="email" inputmode="email" placeholder="cliente@ejemplo.com"></label>
              <label class="wide">Régimen fiscal<select id="d-regimen"><option value="">Elige…</option>${Object.entries(j.regimenes).map(([k, v]) => `<option value="${k}" ${s.regimen === k ? "selected" : ""}>${k} · ${esc(v)}</option>`).join("")}</select></label>
              <label class="wide">Forma de pago<select id="d-pago"><option value="">Elige…</option>${Object.entries(j.formas_pago || {}).map(([k, v]) => `<option value="${k}" ${s.forma_pago === k ? "selected" : ""}>${k} · ${esc(v)}</option>`).join("")}</select></label>
            </div>
            <div class="row"><button class="btn btn-line" id="guardar-datos" type="button" ${bloqueado ? "disabled" : ""}>Guardar datos</button><span class="note" id="csf-estado"></span></div>
          </details>
          </section>
          <section class="card">
            <h3 class="fpaso"><span class="num">2</span>Datos del ticket</h3><p class="note fguia">Captura el número de folio y el importe tal como aparecen en la foto (paso 6). Conserva los ceros iniciales. Al guardar quedan listos para copiar.</p>
            <div class="fields">
              ${s.comentario ? campo("Comentario del cliente", s.comentario, false) : ""}
              ${Number(s.facturas_solicitadas || 1) === 2 ? campo("Solicitud del cliente", "Dos facturas (sujeto a revisión)", false) : ""}
              ${s.facturas_motivo ? campo("Aclaración sobre dos facturas", s.facturas_motivo, false) : ""}
            </div>
            ${duplicada ? `<p class="warn"><b>Ticket ya facturado:</b> aparece con la factura ${esc(j.ya_facturado.folio_factura)}. No emitas otro CFDI; si corresponde, rechaza la nueva solicitud.</p>` : ""}
            ${j.contraste?.advertencia ? `<p class="warn"><b>Verificación de ingresos:</b> ${esc(j.contraste.advertencia)}</p>` : ""}
            ${(j.duplicados || []).length ? `<p class="warn"><b>Ojo: el ticket ${esc(s.folio_ticket)} ya aparece en otra solicitud.</b> ${j.duplicados.map(x => `${esc(x.folio)} (${{ pendiente: "pendiente", facturada: "facturada" + (x.folio_factura ? " con factura " + esc(x.folio_factura) : ""), rechazada: "rechazada" }[x.estado] || esc(x.estado)})`).join(", ")}. Revisa que no se facture dos veces.</p>` : ""}
            ${s.aviso_ticket ? `<p class="warn"><b>Ojo:</b> ${esc(s.aviso_ticket)}</p>` : ""}
            ${(() => {
              const imp = s.importe ? dinero(s.importe) : "";
              const filas = [campo("Folio del ticket", s.folio_ticket)];
              if (esBascula || s.servicio === "ambos") filas.push(campo("Cliente en el ticket", s.cliente));
              if (!esBascula) filas.push(campo("Placas", s.placas), campo("Descripción auto", s.descripcion), campo("Tarifa", s.tarifa));
              filas.push(campo(esBascula ? "Tarifa" : "Total impreso", imp ? Number(s.importe).toFixed(2) : ""));
              if (s.anotacion) filas.push(campo("Anotación a mano", s.anotacion));
              filas.push(campo("WhatsApp del cliente", s.telefono));
              return `<div id="ticket-vista" ${capturado ? "" : "hidden"}><div class="fields">${filas.join("")}</div><div class="row"><button class="btn btn-line" id="editar-ticket" type="button" ${bloqueado ? "hidden" : ""}>Editar datos del ticket</button></div></div>`;
            })()}
            <div id="ticket-edicion" ${capturado ? "hidden" : ""}>
            <p class="note" style="margin:0 0 8px">Captura los datos viendo la foto del ticket (paso 6).</p>
            <div class="grid-form">
              <label>Folio del ticket<input id="t-ticket" value="${esc(s.folio_ticket)}" placeholder="Ej. 17372" inputmode="numeric" autocomplete="off" spellcheck="false"></label>
              ${esBascula || s.servicio === "ambos" ? `<label class="wide">Cliente en el ticket<input id="t-cliente" value="${esc(s.cliente)}" placeholder="Ej. LESVIA RAVELES" autocomplete="off"></label>` : ""}
              ${esBascula ? "" : `<label>Placas<input id="t-placas" value="${esc(s.placas)}" placeholder="Ej. 49AR1X" autocomplete="off" autocapitalize="characters"></label>
              <label class="wide">Descripción auto<input id="t-desc" value="${esc(s.descripcion)}" placeholder="Ej. TRANSPORTES LOZANOS T24" autocomplete="off"></label>
              <label>Tarifa<input id="t-tarifa" value="${esc(s.tarifa)}" placeholder="Ej. BB1 SENCILLO $150 T24" autocomplete="off"></label>`}
              <label>${esBascula ? "Tarifa" : "Total impreso"}<input id="t-importe" value="${s.importe ? esc(Number(s.importe).toFixed(2)) : ""}" placeholder="${esBascula ? "Ej. 60.00" : "Ej. 1200.00"}" inputmode="decimal" autocomplete="off"></label>
              <label class="wide${s.anotacion ? " marcado" : ""}">Anotación a mano en el ticket<input id="t-anot" value="${esc(s.anotacion)}" placeholder="Si alguien escribió otra cantidad, aparece aquí" autocomplete="off"></label>
              <label class="wide">WhatsApp del cliente<input id="t-tel" value="${esc(s.telefono)}" placeholder="10 dígitos" inputmode="tel" maxlength="14"></label>
            </div>
            <div class="row"><button class="btn btn-primary" id="guardar-ticket" type="button" ${bloqueado ? "disabled" : ""}>Guardar</button>${capturado ? `<button class="btn btn-line" id="cancelar-ticket" type="button">Cancelar</button>` : ""}<span class="note" id="ticket-estado"></span></div>
            </div>
          </section>
          <section class="card">
            <h3 class="fpaso"><span class="num">3</span>Factura en Facturador</h3><p class="note fguia">Abre Facturador en otra pestaña, emite la factura con los datos de los pasos 1 y 2 y regresa aquí.</p>
            ${duplicada ? `<p class="warn"><b>No emitir otro CFDI:</b> este ticket ya figura como facturado. Revisa los datos y usa Rechazar con el motivo correspondiente.</p>` : `<div class="row"><a class="btn btn-primary" id="abrir-facturador" href="https://auth.facturador.com/partiallogin?signin=3e13c6177909677b7a2b8adb862f68da" target="_blank" rel="noopener">Abrir Facturador ↗</a></div>`}
          </section>
          <section class="card">
            ${["pendiente", "en_revision"].includes(s.estado) ? `
              <h3 class="fpaso"><span class="num">4</span>Resultado</h3><p class="note fguia">Comprueba los datos y el ticket. Después de emitir el CFDI en Facturador, registra su folio; si no procede, rechaza la solicitud con motivo.</p>
              ${s.estado === "pendiente" ? `<div class="row"><button class="btn btn-line" id="iniciar-revision" type="button">Iniciar revisión</button></div>` : `<p class="note">En revisión por administración.</p>`}
              <div class="row">
                <input type="text" id="folio-factura" placeholder="Folio/UUID del primer CFDI" aria-label="Folio de Facturador">
                ${Number(s.facturas_solicitadas || 1) === 2 ? `<input type="text" id="importe-factura-1" placeholder="Importe CFDI 1" inputmode="decimal" aria-label="Importe primera factura"><input type="text" id="folio-factura-2" placeholder="Folio/UUID CFDI 2 (opcional)" aria-label="Folio segunda factura"><input type="text" id="importe-factura-2" placeholder="Importe CFDI 2" inputmode="decimal" aria-label="Importe segunda factura"><label class="note"><input type="checkbox" id="cfdi-emitido-externo"> Ya emití los CFDI en Facturador; capturé los importes manualmente.</label>` : ""}
                <button class="btn btn-primary" id="facturar" type="button" ${duplicada ? 'disabled title="Ticket ya facturado"' : ''}>${Number(s.facturas_solicitadas || 1) === 2 ? "Registrar CFDI emitidos" : "Facturada"}</button>
              </div>
              <p class="note">Fecha: ${fecha(new Date().toISOString())} (automática). Se guardan también el folio del ticket y el importe del paso 2.</p>
              <div class="rechazo">
                <div class="row">
                  <input type="text" id="motivo" placeholder="Motivo del rechazo (ej. ticket ilegible, datos no coinciden)" aria-label="Motivo del rechazo">
                  <button class="btn btn-bad" id="rechazar" type="button">Rechazar</button>
                </div>
              </div>` : `
              <h3 class="fpaso"><span class="num">4</span>${s.estado === "rechazada" ? "Rechazada" : s.estado === "cancelada" ? "Cancelada en Facturador" : s.estado === "enviada" ? "Enviada al cliente" : "Facturada"}</h3>
              <p>${["facturada", "enviada", "cancelada"].includes(s.estado) ? `${s.estado === "cancelada" ? "Factura original cancelada" : "Factura registrada"} <b>${esc(s.folio_factura)}</b>${s.importe ? ` · ticket ${dinero(s.importe)}` : ""}` : `Motivo: ${esc(s.motivo)}`} · ${fecha(s.resuelta_en)}</p>
              ${s.estado === "facturada" ? `<div class="row"><button class="btn btn-primary" id="marcar-enviada" type="button">Confirmar envío al cliente</button></div><p class="note">Sólo después de entregarla por Facturador; este botón no envía correo.</p>` : ""}
              ${s.estado === "enviada" ? `<p class="note">Entrega confirmada: ${fecha(s.enviada_en)}</p>` : ""}
              ${s.estado === "rechazada" ? `
                <h3 style="margin-top:6px">Cambiar estatus</h3>
                <div class="row">
                  <input type="text" id="folio-factura" placeholder="Número o UUID de la factura" aria-label="Número de la factura">
                  <button class="btn btn-primary" id="facturar" type="button" ${duplicada ? 'disabled title="Ticket ya facturado"' : ''}>Marcar facturada</button>
                </div>
                <div class="row">
                  ${s.archivos_borrados ? "" : `<button class="btn btn-line" id="reabrir" type="button">Regresar a pendientes</button>`}
                  <button class="btn btn-bad" id="eliminar" type="button">Eliminar solicitud</button>
                </div>
                <p class="note">Eliminar borra la solicitud, el ticket y la constancia. No se puede deshacer.</p>` :
                ""}`}
          </section>
          <section class="card">
            <h3 class="fpaso"><span class="num">5</span>Avisa al cliente</h3>
            <p class="note">${{ pendiente: "Confirma recepción.", en_revision: "Confirma que está en revisión.", facturada: "CFDI emitido, pendiente de confirmar entrega.", enviada: "Entrega registrada por administración.", rechazada: "Explica el rechazo.", cancelada: "Avisa de la cancelación confirmada y de la sustitución, si existe." }[s.estado]} Puedes editar el texto antes de enviarlo.</p>
            <textarea id="wa-texto" aria-label="Mensaje de WhatsApp para el cliente" rows="6" style="width:100%;padding:10px 12px;border:1px solid var(--line);border-radius:12px;background:#0b0b0c;resize:vertical;font-family:inherit">${esc(mensajeCliente(s, j.servicios, cfdis))}</textarea>
            <div class="row">
              <a class="btn btn-primary" id="wa-enviar" href="#" target="_blank" rel="noopener">Enviar por WhatsApp</a>
              <button class="btn btn-line" id="wa-copiar" type="button">Copiar mensaje</button>
              <span class="note" id="wa-aviso"></span>
            </div>
          </section>
          <section class="card doc">
            <h3 class="fpaso"><span class="num">6</span>Imagen del ticket</h3>
            ${docHtml("ticket", s.ticket_tipo, "Foto del ticket")}
          </section>
          ${s.modo === "csf" ? `
          <section class="card doc">
            <h3 class="fpaso"><span class="num">7</span>Constancia de Situación Fiscal</h3>
            ${docHtml("csf", s.csf_tipo, "Constancia de Situación Fiscal")}
            ${!bloqueado && !s.archivos_borrados && s.csf_tipo ? `<div class="row"><button class="btn btn-line" id="leer-csf" type="button">Leer datos de constancia (PDF o imagen)</button><span class="note" id="csf-resultado">Las sugerencias deben verificarse antes de guardarlas.</span></div>` : ""}
          </section>` : ""}
      </div>`;

    d.scrollTop = 0;
    d.classList.remove("entra"); void d.offsetWidth; d.classList.add("entra");
    $("#volver")?.addEventListener("click", () => $("#work").classList.remove("ver-detalle"));
    // El CFDI se emite en Facturador, fuera de esta web. Si el administrador
    // cambió el folio sin guardarlo, las advertencias del panel estarían obsoletas.
    // Exigir guardar y volver a consultar los posibles duplicados antes de salir.
    $("#abrir-facturador")?.addEventListener("click", e => {
      if (bloqueado) return; // factura ya registrada: acceso sólo de consulta
      const folioEnPantalla = $("#t-ticket")?.value.trim() || "";
      const importeEnPantalla = $("#t-importe")?.value.trim() || "";
      if (!/^\d+$/.test(folioEnPantalla.replace(/[\s-]/g, ""))) { e.preventDefault(); toast("Verifica el número de folio del ticket."); return; }
      const importeGuardado = s.importe ? Number(s.importe).toFixed(2) : "";
      if (!folioEnPantalla || !s.folio_ticket || folioEnPantalla !== s.folio_ticket ||
          !importeEnPantalla || !importeGuardado || Number(importeEnPantalla) !== Number(importeGuardado)) {
        e.preventDefault();
        toast("Primero guarda el folio completo y el importe del ticket. Así podremos revisar si ya se facturó.");
        return;
      }
      if (faltan) {
        e.preventDefault();
        toast("Revisa y guarda los datos fiscales completos antes de abrir Facturador.");
      }
    });
    $("#iniciar-revision")?.addEventListener("click", e => accion(e.target, "en-revision", {}, "En revisión"));
    $("#marcar-enviada")?.addEventListener("click", async e => {
      if (!confirmarEnPagina(e.target, "¿Ya entregaste el CFDI al cliente?")) return;
      await accion(e.target, "enviada", {}, "Entrega confirmada");
    });
    $("#facturar")?.addEventListener("click", async e => {
      const folio = $("#folio-factura").value.trim();
      if (!folio) { toast("Escribe el folio de la factura"); $("#folio-factura").focus(); return; }
      if (faltan || !$("#t-importe").value.trim() || !$("#t-ticket").value.trim()) { toast("Verifica los datos fiscales, el folio y el importe antes de facturar."); return; }
      await accion(e.target, "facturar", { folio_factura: folio, folio_ticket: $("#t-ticket").value, importe: $("#t-importe").value }, "Marcada como facturada");
    });
    $("#rechazar")?.addEventListener("click", e => {
      const motivo = $("#motivo").value.trim();
      if (!motivo) { toast("Escribe el motivo"); $("#motivo").focus(); return; }
      accion(e.target, "rechazar", { motivo }, "Solicitud rechazada");
    });
    $("#reabrir")?.addEventListener("click", e => accion(e.target, "reabrir", {}, "Regresó a pendientes"));
    $("#eliminar")?.addEventListener("click", async e => {
      const b = e.currentTarget;
      if (b.dataset.confirmado !== "1") { b.dataset.confirmado = "1"; b.textContent = "Toca otra vez para eliminar"; b.classList.add("armed"); setTimeout(() => { if (b.isConnected) { b.dataset.confirmado = ""; b.textContent = "Eliminar solicitud"; b.classList.remove("armed"); } }, 5000); return; }
      b.disabled = true;
      try {
        await api(`solicitudes/${estadoState.actual}/eliminar`, { method: "POST", body: "{}" });
        toast("Solicitud eliminada");
        estadoState.actual = null;
        $("#detalle").innerHTML = `<p class="empty">Elige una solicitud de la lista.</p>`;
        $("#work").classList.remove("ver-detalle");
        await cargarLista();
      } catch (err) { if (err.message !== "sesion") toast(err.message); b.disabled = false; }
    });
    if (!bloqueado) $("#guardar-datos").addEventListener("click", e => guardarDatos(e.target, e.currentTarget.dataset.deCsf === "1"));
    if (!bloqueado) $("#guardar-ticket").addEventListener("click", e => guardarDatos(e.target, !!s.datos_de_csf));
    $("#editar-ticket")?.addEventListener("click", () => { $("#ticket-vista").hidden = true; $("#ticket-edicion").hidden = false; $("#t-ticket").focus(); });
    $("#cancelar-ticket")?.addEventListener("click", () => { $("#ticket-edicion").hidden = true; $("#ticket-vista").hidden = false; });
    const waLink = () => {
      const num = $("#t-tel").value.replace(/\D/g, "").slice(-10);
      const a = $("#wa-enviar");
      if (num.length !== 10) { a.setAttribute("aria-disabled", "true"); a.style.opacity = ".5"; a.href = "#"; $("#wa-aviso").textContent = "Escribe el WhatsApp del cliente (10 dígitos) arriba."; return; }
      a.removeAttribute("aria-disabled"); a.style.opacity = ""; $("#wa-aviso").textContent = "";
      a.href = `https://wa.me/52${num}?text=${encodeURIComponent($("#wa-texto").value)}`;
    };
    $("#t-tel").addEventListener("input", waLink);
    $("#wa-texto").addEventListener("input", waLink);
    $("#wa-enviar").addEventListener("click", e => { waLink(); if (e.currentTarget.getAttribute("aria-disabled")) { e.preventDefault(); $("#t-tel").focus(); } });
    $("#wa-copiar").addEventListener("click", async e => {
      try { await navigator.clipboard.writeText($("#wa-texto").value); toast("Mensaje copiado"); } catch { $("#wa-texto").select(); }
    });
    waLink();
    $("#leer-csf")?.addEventListener("click", e => leerCsf(e.target, s, j.regimenes, false));
    d.querySelectorAll(".pdfview").forEach(c => mostrarPdf(c, archivo(c.dataset.pdf), s.id));
    // Leer una sola vez por sesión del panel, sin sobrescribir ni guardar datos por su cuenta.
    if (!bloqueado && s.modo === "csf" && s.csf_tipo && !s.archivos_borrados && !s.datos_de_csf &&
        (!s.rfc || !s.nombre || !s.regimen || !s.cp) && !lecturasCsfAutomaticas.has(s.id)) {
      lecturasCsfAutomaticas.add(s.id);
      leerCsf($("#leer-csf"), s, j.regimenes, true);
    }
  }

  function confirmarEnPagina(boton, que = "Faltan datos") {
    if (boton.dataset.confirmado === "1") return true;
    boton.dataset.confirmado = "1";
    boton.textContent = `${que}. ¿Marcar de todos modos?`;
    return false;
  }

  async function accion(boton, que, cuerpo, ok) {
    boton.disabled = true;
    try {
      await api(`solicitudes/${estadoState.actual}/${que}`, { method: "POST", body: JSON.stringify(cuerpo) });
      toast(ok);
      await cargarLista();
      await abrir(estadoState.actual);
    } catch (e) { if (e.message !== "sesion") toast(e.message); boton.disabled = false; }
  }

  async function guardarDatos(boton, deCsf) {
    const cuerpo = { rfc: $("#d-rfc").value, nombre: $("#d-nombre").value, email: $("#d-email").value.trim(), regimen: $("#d-regimen").value, cp: $("#d-cp").value, de_csf: deCsf, forma_pago: $("#d-pago").value,
      folio_ticket: $("#t-ticket").value, importe: $("#t-importe").value, telefono: $("#t-tel").value, anotacion: $("#t-anot").value };
    for (const [clave, sel] of [["placas", "#t-placas"], ["descripcion", "#t-desc"], ["tarifa", "#t-tarifa"], ["cliente", "#t-cliente"]]) if ($(sel)) cuerpo[clave] = $(sel).value;
    boton.disabled = true;
    try {
      await api(`solicitudes/${estadoState.actual}/datos`, { method: "POST", body: JSON.stringify(cuerpo) });
      toast("Datos guardados");
      await cargarLista();
      await abrir(estadoState.actual);
    } catch (e) { if (e.message !== "sesion") toast(e.message); boton.disabled = false; }
  }

  // Lectura de la Constancia de Situación Fiscal (PDF del SAT) en el navegador
  let pdfjsListo = null;
  function cargarPdfjs() {
    if (pdfjsListo) return pdfjsListo;
    pdfjsListo = new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
      s.onload = async () => {
        // El worker se carga como blob del mismo sitio para que funcione en todos los navegadores
        try {
          const codigo = await (await fetch("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js")).text();
          window.pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([codigo], { type: "text/javascript" }));
        } catch { window.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js"; }
        res(window.pdfjsLib);
      };
      s.onerror = () => rej(new Error("No se pudo cargar el lector de PDF"));
      document.head.appendChild(s);
    });
    return pdfjsListo;
  }


  // Documentos PDF: se descargan una vez y se dibujan en el panel (funciona en celular y computadora)
  const cachePdf = new Map();
  async function obtenerPdf(url) {
    if (!cachePdf.has(url)) cachePdf.set(url, (async () => {
      const pdfjs = await cargarPdfjs();
      const r = await fetch(url);
      if (!r.ok) throw new Error(r.status === 404 ? "El archivo ya no está disponible." : "No se pudo descargar el archivo.");
      return pdfjs.getDocument({ data: await r.arrayBuffer() }).promise;
    })());
    try { return await cachePdf.get(url); } catch (e) { cachePdf.delete(url); throw e; }
  }
  async function mostrarPdf(contenedor, url, id) {
    try {
      const pdf = await obtenerPdf(url);
      if (estadoState.actual !== id || !contenedor.isConnected) return;
      const paginas = Math.min(pdf.numPages, 6);
      contenedor.innerHTML = `<div class="pdf-bar"><b>Documento PDF</b><span id="pdf-pag">${pdf.numPages} ${pdf.numPages === 1 ? "página" : "páginas"}</span></div><div class="pdf-pages"></div>`;
      const hojas = contenedor.querySelector(".pdf-pages");
      const indicador = contenedor.querySelector("#pdf-pag");
      for (let i = 1; i <= paginas; i++) {
        const pagina = await pdf.getPage(i);
        const ancho = Math.max(hojas.clientWidth - 24, 280);
        const base = pagina.getViewport({ scale: 1 });
        const vp = pagina.getViewport({ scale: (ancho / base.width) * Math.min(window.devicePixelRatio || 1, 2) });
        const canvas = document.createElement("canvas");
        canvas.width = Math.floor(vp.width); canvas.height = Math.floor(vp.height);
        canvas.dataset.pagina = i;
        canvas.setAttribute("aria-label", `Página ${i} de ${pdf.numPages}`);
        hojas.appendChild(canvas);
        await pagina.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise;
      }
      if (pdf.numPages > paginas) hojas.insertAdjacentHTML("beforeend", `<p class="note" style="text-align:center">Faltan ${pdf.numPages - paginas} páginas. Usa "Abrir PDF completo".</p>`);
      // Indicador de página al desplazarse, como en un visor de documentos
      if (pdf.numPages > 1) {
        const actualizar = () => {
          const arriba = hojas.scrollTop + hojas.clientHeight / 3;
          let n = 1;
          for (const c of hojas.querySelectorAll("canvas")) if (c.offsetTop <= arriba) n = +c.dataset.pagina;
          indicador.textContent = `Página ${n} de ${pdf.numPages}`;
        };
        hojas.addEventListener("scroll", actualizar, { passive: true });
        actualizar();
      }
    } catch (e) {
      if (contenedor.isConnected) contenedor.innerHTML = `<p class="note">No se pudo mostrar el documento: ${esc(e.message)}. Usa "Abrir PDF completo".</p>`;
    }
  }


  // Las constancias pueden ser PDF con texto, PDF escaneado o fotografía.
  // La imagen se analiza exclusivamente a través del Worker protegido por Access.
  async function imagenCsfPdf(pdf, numero = 1) {
    const pagina = await pdf.getPage(numero), base = pagina.getViewport({ scale: 1 });
    const vp = pagina.getViewport({ scale: Math.min(2.3, 1700 / Math.max(base.width, base.height)) });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
    await pagina.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise;
    return canvas.toDataURL("image/jpeg", 0.86);
  }
  async function imagenCsfHeic(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error("No se pudo descargar la constancia HEIC");
    const blob = await r.blob();
    let imagen;
    try { imagen = await createImageBitmap(blob); }
    catch {
      imagen = await new Promise((resolve, reject) => {
        const enlace = URL.createObjectURL(blob), img = new Image();
        img.onload = () => { URL.revokeObjectURL(enlace); resolve(img); };
        img.onerror = () => { URL.revokeObjectURL(enlace); reject(new Error("El navegador no puede convertir HEIC a JPG")); };
        img.src = enlace;
      });
    }
    const escala = Math.min(1, 1700 / Math.max(imagen.width, imagen.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(imagen.width * escala));
    canvas.height = Math.max(1, Math.round(imagen.height * escala));
    canvas.getContext("2d").drawImage(imagen, 0, 0, canvas.width, canvas.height);
    if (imagen.close) imagen.close();
    return canvas.toDataURL("image/jpeg", 0.86);
  }
  async function pedirLecturaCsf(id, imagen = null) {
    return api("solicitudes/" + id + "/leer-csf-imagen",
      { method: "POST", body: JSON.stringify(imagen ? { imagen } : {}) });
  }
  async function leerCsf(boton, solicitud, regimenes, automatico) {
    const estado = $("#csf-estado"), resultado = $("#csf-resultado");
    if (!estado || !boton) return;
    const mensaje = texto => {
      if (estadoState.actual !== solicitud.id) return;
      if (estado.isConnected) estado.textContent = texto;
      if (resultado?.isConnected) resultado.textContent = texto;
    };
    boton.disabled = true;
    mensaje(automatico ? "Buscando datos en la constancia…" : "Leyendo la constancia…");
    try {
      let d = {}, varios = false, observacion = "";
      const ruta = "/panel/api/solicitudes/" + solicitud.id + "/archivo/csf";
      if (solicitud.csf_tipo === "application/pdf") {
        const pdf = await obtenerPdf(ruta);
        let textoPdf = "";
        for (let i = 1; i <= Math.min(pdf.numPages, 3); i++) {
          const texto = await (await pdf.getPage(i)).getTextContent();
          textoPdf += " " + texto.items.map(x => x.str).join(" ");
        }
        d = extraerCsf(textoPdf.replace(/\s+/g, " "), regimenes);
        varios = d.regimenes > 1;
        if (varios) d.regimen = "";
        // Hasta dos páginas: el régimen puede aparecer después de los datos generales.
        for (let numero = 1; numero <= Math.min(pdf.numPages, 2) && !(d.rfc && d.nombre && d.cp && d.regimen); numero++) {
          try {
            const j = await pedirLecturaCsf(solicitud.id, await imagenCsfPdf(pdf, numero));
            for (const clave of ["rfc", "nombre", "cp", "regimen"])
              if (!d[clave] && j.datos?.[clave]) d[clave] = j.datos[clave];
            if (j.varios_regimenes) { varios = true; d.regimen = ""; }
          } catch (e) { observacion = e.message; break; }
        }
      } else if (solicitud.csf_tipo === "image/heic" || solicitud.csf_tipo === "image/heif") {
        const j = await pedirLecturaCsf(solicitud.id, await imagenCsfHeic(ruta));
        d = j.datos || {}; varios = !!j.varios_regimenes;
      } else {
        const j = await pedirLecturaCsf(solicitud.id);
        d = j.datos || {}; varios = !!j.varios_regimenes;
      }
      if (estadoState.actual !== solicitud.id || !estado.isConnected) return;
      const campos = {
        rfc: ["#d-rfc", /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/],
        nombre: ["#d-nombre", /^.{3,254}$/],
        cp: ["#d-cp", /^\d{5}$/],
        regimen: ["#d-regimen", null]
      };
      let sugeridos = 0, diferencias = 0;
      for (const [clave, [selector, patron]] of Object.entries(campos)) {
        const input = $(selector), valor = String(d[clave] || "").trim();
        if (!input || !valor || (patron && !patron.test(valor))) continue;
        if (clave === "regimen" && (!regimenes[valor] || varios)) continue;
        if (!input.value.trim()) { input.value = valor; sugeridos++; }
        else if (input.value.trim().toLocaleUpperCase("es-MX") !== valor.toLocaleUpperCase("es-MX")) diferencias++;
      }
      if (sugeridos) $("#guardar-datos").dataset.deCsf = "1";
      let aviso = sugeridos
        ? "Datos sugeridos. Compara con la constancia, corrige y pulsa «Guardar datos»."
        : "No se encontraron datos adicionales seguros. Captúralos viendo la constancia.";
      if (diferencias) aviso += " La lectura difiere de " + diferencias + " dato(s) ya escritos. Revisa la constancia; no se cambiaron.";
      if (varios) aviso += " Hay varios regímenes; elige el correcto.";
      if (observacion) aviso += " El reconocimiento de imagen no estuvo disponible.";
      mensaje(aviso);
    } catch (e) {
      mensaje("No se pudo leer automáticamente: " + (e.message || "verifica el documento") + ". Captura los datos manualmente.");
    } finally {
      if (boton.isConnected) boton.disabled = false;
    }
  }

  function extraerCsf(t, regimenes) {
    const etiquetas = ["RFC:", "CURP:", "Nombre \\(s\\):", "Nombre\\(s\\):", "Primer Apellido:", "Segundo Apellido:", "Fecha inicio de operaciones:", "Estatus en el padrón:", "Fecha de último cambio de estado:", "Nombre Comercial:", "Denominación/Razón Social:", "Régimen Capital:", "Datos del domicilio registrado", "Código Postal:", "Tipo de Vialidad:", "Nombre de Vialidad:", "Número Exterior:", "idCIF:", "Lugar y Fecha de Emisión"];
    const valor = etq => {
      const m = t.match(new RegExp(etq + "\\s*(.*?)\\s*(?=" + etiquetas.join("|") + "|$)"));
      return m ? m[1].trim() : "";
    };
    let rfc = (valor("RFC:").match(/[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}/) || t.match(/\b[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}\b/) || [""])[0];
    const razon = valor("Denominación/Razón Social:");
    let nombre = razon;
    if (!nombre) nombre = [valor("Nombre \\(s\\):") || valor("Nombre\\(s\\):"), valor("Primer Apellido:"), valor("Segundo Apellido:")].filter(Boolean).join(" ");
    const cp = (valor("Código Postal:").match(/\d{5}/) || [""])[0];
    const norm = s => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    const tn = norm(t);
    const encontrados = Object.entries(regimenes).filter(([, v]) => tn.includes(norm(v)));
    // Si un nombre de régimen contiene a otro, prefiere el más largo
    encontrados.sort((a, b) => b[1].length - a[1].length);
    return { rfc, nombre: nombre.toUpperCase(), cp, regimen: encontrados[0]?.[0] || "", regimenes: encontrados.length };
  }

  // ---- Deslizar a la derecha para eliminar (solo en Rechazadas), como en Correo ----
  const borrandoIds = new Set();
  let pendiente = null; // { id, timer, sw }
  const ANCHO_BOTON = 116;
  let gesto = null;

  function cerrarSwipe(sw) {
    const it = sw.querySelector(".item");
    it.style.transition = "transform .35s cubic-bezier(.16,1,.3,1)";
    it.style.transform = "";
    sw.classList.remove("abierto");
  }
  function ejecutarBorrado(p) {
    return api(`solicitudes/${p.id}/eliminar`, { method: "POST", body: "{}" })
      .then(() => { borrandoIds.delete(p.id); cargarLista(); })
      .catch(err => { borrandoIds.delete(p.id); if (err.message !== "sesion") toast(err.message); cargarLista(); });
  }
  function confirmarPendiente() {
    if (!pendiente) return;
    const p = pendiente; pendiente = null; clearTimeout(p.timer);
    $("#undo").hidden = true;
    return ejecutarBorrado(p);
  }
  function eliminarDeslizando(sw) {
    if (!sw) return;
    confirmarPendiente(); // si había otro esperando, se confirma ya
    const id = sw.dataset.id, it = sw.querySelector(".item");
    borrandoIds.add(id);
    it.style.transition = "transform .3s cubic-bezier(.16,1,.3,1)";
    it.style.transform = `translateX(${sw.offsetWidth}px)`;
    sw.style.height = sw.offsetHeight + "px";
    requestAnimationFrame(() => { sw.classList.add("colapsa"); sw.style.height = "0px"; });
    if (estadoState.actual === id) { estadoState.actual = null; $("#detalle").innerHTML = `<p class="empty">Elige una solicitud de la lista.</p>`; $("#work").classList.remove("ver-detalle"); }
    const nombre = it.querySelector(".t")?.textContent || "Solicitud";
    $("#undo-txt").textContent = `${nombre} eliminada`;
    $("#undo").hidden = false;
    pendiente = { id, sw, timer: setTimeout(confirmarPendiente, 5000) };
  }
  $("#undo-btn").addEventListener("click", () => {
    if (!pendiente) return;
    clearTimeout(pendiente.timer); borrandoIds.delete(pendiente.id); pendiente = null;
    $("#undo").hidden = true; toast("Se recuperó la solicitud"); cargarLista();
  });
  // Si se cierra la página con un borrado esperando, se envía de inmediato
  addEventListener("pagehide", () => {
    if (!pendiente) return;
    fetch(`/panel/api/solicitudes/${pendiente.id}/eliminar`, { method: "POST", body: "{}", keepalive: true, headers: { "X-Panel": "1", "Content-Type": "application/json" } });
    pendiente = null;
  });

  const lista = $("#lista");
  lista.addEventListener("pointerdown", e => {
    const it = e.target.closest(".swipe .item");
    if (!it || (e.pointerType === "mouse" && e.button !== 0)) return;
    document.querySelectorAll(".swipe.abierto").forEach(sw => { if (!sw.contains(it)) cerrarSwipe(sw); });
    const sw = it.closest(".swipe");
    gesto = { it, sw, x0: e.clientX, y0: e.clientY, base: sw.classList.contains("abierto") ? ANCHO_BOTON : 0, dx: 0, activo: false, id: e.pointerId };
  });
  lista.addEventListener("pointermove", e => {
    if (!gesto || e.pointerId !== gesto.id) return;
    const dx = e.clientX - gesto.x0, dy = e.clientY - gesto.y0;
    if (!gesto.activo) {
      if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { gesto = null; return; } // es scroll vertical
      if (Math.abs(dx) < 10) return;
      gesto.activo = true;
      try { gesto.it.setPointerCapture(e.pointerId); } catch {}
      gesto.it.style.transition = "none";
    }
    const ancho = gesto.sw.offsetWidth;
    let x = Math.max(0, gesto.base + dx);
    if (x > ancho * 0.6) x = ancho * 0.6 + (x - ancho * 0.6) * 0.5; // resistencia al final
    gesto.dx = x;
    gesto.it.style.transform = `translateX(${x}px)`;
    gesto.sw.classList.toggle("listo", x > ancho * 0.45);
    e.preventDefault();
  });
  const soltar = e => {
    if (!gesto || e.pointerId !== gesto.id) return;
    const g = gesto; gesto = null;
    if (!g.activo) return;
    g.it.dataset.deslizado = "1";
    setTimeout(() => { g.it.dataset.deslizado = ""; }, 400);
    const ancho = g.sw.offsetWidth;
    g.sw.classList.remove("listo");
    if (g.dx > ancho * 0.45) { eliminarDeslizando(g.sw); return; }
    g.it.style.transition = "transform .35s cubic-bezier(.16,1,.3,1)";
    if (g.dx > ANCHO_BOTON * 0.6) { g.it.style.transform = `translateX(${ANCHO_BOTON}px)`; g.sw.classList.add("abierto"); }
    else cerrarSwipe(g.sw);
  };
  lista.addEventListener("pointerup", soltar);
  lista.addEventListener("pointercancel", soltar);

  // Eventos generales
  document.addEventListener("click", async e => {
    const c = e.target.closest(".copy");
    if (c) {
      const v = c.dataset.copy;
      try { await navigator.clipboard.writeText(v); } catch { const r = document.createRange(); r.selectNodeContents(c.previousElementSibling); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); }
      c.textContent = "Copiado"; c.classList.add("hecho");
      setTimeout(() => { c.textContent = "Copiar"; c.classList.remove("hecho"); }, 1500);
      return;
    }
    const del = e.target.closest(".swipe-del");
    if (del) { const sw = del.closest(".swipe"); eliminarDeslizando(sw); return; }
    const it = e.target.closest(".item");
    if (it) {
      if (it.dataset.deslizado === "1") { it.dataset.deslizado = ""; return; }
      const sw = it.closest(".swipe.abierto"); if (sw) { cerrarSwipe(sw); return; }
      abrir(it.dataset.id);
    }
  });
  let h; $("#q").addEventListener("input", e => { clearTimeout(h); h = setTimeout(() => { estadoState.q = e.target.value.trim(); cargarLista(); }, 300); });
  $("#recargar").addEventListener("click", cargarLista);
  // ---- Reportes en Google Sheets (uno por área, cada uno en su carpeta de Drive) ----
  // Se usa aquí (Facturación) y en Finanzas (los tres reportes)
  window.reporteWidget = ({ tipos, sel, btn, est, lista }) => {
    const NOM = { turnos: "Turnos", finanzas: "Finanzas", facturacion: "Facturación", anterior: "Reporte completo (anterior)" };
    const hoyM = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City", year: "numeric", month: "2-digit" }).format(new Date()).slice(0, 7);
    const menos = (m, n) => { const [a, b] = m.split("-").map(Number), t = a * 12 + b - 1 - n; return `${Math.floor(t / 12)}-${String(t % 12 + 1).padStart(2, "0")}`; };
    const nom = m => { const t = new Date(m + "-15T12:00:00Z").toLocaleDateString("es-MX", { month: "long", year: "numeric", timeZone: "UTC" }); return t.charAt(0).toUpperCase() + t.slice(1); };
    sel.innerHTML = Array.from({ length: 13 }, (_, i) => menos(hoyM, i)).map((m, i) => `<option value="${m}" ${i === 1 ? "selected" : ""}>${nom(m)}${i === 0 ? " (en curso)" : ""}</option>`).join("");
    async function cargar() {
      try {
        const j = await api("reportes" + (tipos.length === 1 ? "?tipo=" + tipos[0] : ""));
        const rs = j.reportes.filter(r => tipos.includes(r.tipo) || (tipos.length > 1 && r.tipo === "anterior"));
        const meses = [...new Set(rs.map(r => r.mes))];
        lista.innerHTML = rs.length ? `<div class="rl">${meses.map(m => `<div class="rl-mes"><b>${esc(nom(m))}</b>${rs.filter(r => r.mes === m).map(r => `<a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(NOM[r.tipo] || r.tipo)} ↗</a>`).join("")}</div>`).join("")}</div>` : `<p class="note" style="margin:10px 0 0">Todavía no hay reportes generados.</p>`;
        if (!j.script) est.textContent = "Falta conectar el script de Google.";
      } catch {}
    }
    btn.addEventListener("click", async () => {
      btn.disabled = true; est.textContent = "Generando… puede tardar un minuto por reporte.";
      const hechos = [], errores = [];
      for (const t of tipos) {
        try { const r = await api("reportes", { method: "POST", body: JSON.stringify({ tipo: t, mes: sel.value }) }); hechos.push(`<a href="${esc(r.url)}" target="_blank" rel="noopener" style="color:#64d2ff">${esc(NOM[t])} ↗</a>`); }
        catch (er) { if (er.message === "sesion") break; errores.push(`${NOM[t]}: ${er.message}`); }
      }
      est.innerHTML = (hechos.length ? "Listo: " + hechos.join(" · ") : "") + (errores.length ? `<span style="color:var(--bad);display:block">${esc(errores.join(" · "))}</span>` : "");
      btn.disabled = false; cargar();
    });
    return cargar;
  };
  const cargarRepFact = window.reporteWidget({ tipos: ["facturacion"], sel: $("#fa-rep-mes"), btn: $("#fa-rep-gen"), est: $("#fa-rep-estado"), lista: $("#fa-rep-lista") });
  $("#fa-rep").addEventListener("toggle", e => { if (e.currentTarget.open) cargarRepFact(); });
  setInterval(() => { if (!document.hidden && !$("#mod-facturacion").hidden) cargarLista(); }, 60000);
  document.addEventListener("modulo", e => { if (e.detail === "facturacion") cargarLista(); });
  api("yo").then(j => { $("#yo").textContent = j.email; }).catch(() => {});
  cargarLista();
})();
