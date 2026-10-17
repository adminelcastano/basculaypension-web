// <interpretar> Lenguaje natural para agregar a la agenda (como Fantastical): "Técnico de la báscula mañana 9:30 urgente"
// Devuelve { titulo, fecha, hora, prioridad, repetir, para_turno, turno, aviso, piezas: [texto reconocido] }. Sin dependencias (se prueba en node).
window.interpretarAgenda = function (texto, hoy) {
  const DIAS = ["domingo", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado"];
  const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  const sin = t => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const iso = d => d.toISOString().slice(0, 10);
  const base = new Date(hoy + "T12:00:00Z");
  const sumar = n => { const d = new Date(base); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
  let t = " " + String(texto || "").replace(/\s+/g, " ").trim() + " ";
  const r = { titulo: "", fecha: null, hora: null, prioridad: "normal", repetir: null, para_turno: 0, turno: null, aviso: null, piezas: [] };
  // Cada patrón se busca sobre el texto sin acentos y se quita del título
  const quitar = (re, fn) => {
    const m = re.exec(sin(t)); if (!m) return false;
    const ok = fn(m); if (ok === false) return false;
    t = t.slice(0, m.index) + " " + t.slice(m.index + m[0].length);
    return true;
  };
  quitar(/\s(urgente|importante|!+)(?=\s)/, () => { r.prioridad = "alta"; r.piezas.push("Urgente"); });
  quitar(/\s(?:para (?:el |la )?)?(?:tablet|encargados?)(?:\s+(?:del\s+)?turno\s+(?:de\s+la\s+)?(manana|tarde|noche))?(?=\s)/, m => { r.para_turno = 1; if (m[1]) r.turno = { manana: "MAÑANA", tarde: "TARDE", noche: "NOCHE" }[m[1]]; r.piezas.push("Tablet" + (m[1] ? " · turno " + m[1].replace("manana", "mañana") : "")); });
  // "turno noche" sin decir "tablet": también es para los encargados de ese turno
  if (!r.turno) quitar(/\s(?:para\s+(?:el\s+)?|del?\s+)?turno\s+(?:de\s+la\s+)?(manana|tarde|noche)(?=\s)/, m => { r.para_turno = 1; r.turno = { manana: "MAÑANA", tarde: "TARDE", noche: "NOCHE" }[m[1]]; r.piezas.push("Tablet · turno " + m[1].replace("manana", "mañana")); });
  quitar(/\s(?:recuerdame|recordarme|avisame|con recordatorio)(?=\s)/, () => { r.aviso = 60; r.piezas.push("Recordatorio"); });
  // Repetición
  quitar(/\s(?:todos los dias|cada dia|diario|diariamente)(?=\s)/, () => { r.repetir = "diaria"; r.piezas.push("Diario"); });
  quitar(/\s(?:cada|todos los)\s+(lunes|martes|miercoles|jueves|viernes|sabados?|domingos?)(?=\s)/, m => { r.repetir = "semanal"; const w = DIAS.indexOf(m[1].replace(/(sabado|domingo)s$/, "$1")); const k = ((w - base.getUTCDay()) + 7) % 7; r.fecha = sumar(k); r.piezas.push("Cada semana"); });
  quitar(/\s(?:cada semana|semanal|semanalmente)(?=\s)/, () => { r.repetir = "semanal"; r.piezas.push("Cada semana"); });
  quitar(/\s(?:cada mes|mensual|mensualmente)(?=\s)/, () => { r.repetir = "mensual"; r.piezas.push("Cada mes"); });
  // Hora: "a las 9", "9am", "9:30", "5 pm", "17:00", "a las 5 de la tarde", "mediodia"
  quitar(/\s(?:a\s+las?\s+|a\s+la\s+)?(mediodia|medio dia)(?=\s)/, () => { r.hora = "12:00"; });
  if (!r.hora) quitar(/\s(?:a\s+las?\s+|al?\s+)?(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|a\.m\.|p\.m\.|hrs?|horas)?(?:\s+de\s+la\s+(manana|tarde|noche))?(?=\s)/, m => {
    const conA = /a\s+las?\s|^\s*al?\s/.test(m[0]) || /^\sa\s/.test(m[0]);
    if (!m[2] && !m[3] && !m[4] && !conA) return false; // un número suelto no es hora
    let h = +m[1], mi = m[2] ? +m[2] : 0;
    if (h > 23 || mi > 59) return false;
    const pm = /p/.test(m[3] || "") || m[4] === "tarde" || m[4] === "noche";
    if (pm && h < 12) h += 12;
    if ((m[3] || "").startsWith("a") && h === 12) h = 0;
    if (!m[3] && !m[4] && h >= 1 && h <= 6) h += 12; // "a las 5" en horario de trabajo = 5 de la tarde
    r.hora = String(h).padStart(2, "0") + ":" + String(mi).padStart(2, "0");
  });
  // Fecha
  const ponerFecha = (f, txt) => { if (!r.fecha) r.fecha = f; return txt; };
  quitar(/\s(?:para\s+|el\s+)?pasado\s+manana(?=\s)/, () => ponerFecha(sumar(2)));
  quitar(/\s(?:para\s+)?hoy(?=\s)/, () => ponerFecha(sumar(0)));
  quitar(/\s(?:para\s+)?manana(?=\s)/, () => { if (r.fecha) return false; ponerFecha(sumar(1)); });
  quitar(/\sen\s+(\d+|un|una|dos|tres|cuatro|cinco)\s+(dias?|semanas?|mes(?:es)?)(?=\s)/, m => {
    const n = { un: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5 }[m[1]] || +m[1];
    if (m[2].startsWith("dia")) ponerFecha(sumar(n)); else if (m[2].startsWith("semana")) ponerFecha(sumar(7 * n));
    else { const d = new Date(base); d.setUTCMonth(d.getUTCMonth() + n); ponerFecha(iso(d)); }
  });
  quitar(/\s(?:la\s+)?(?:proxima|siguiente)\s+semana(?=\s)/, () => ponerFecha(sumar(((8 - base.getUTCDay()) % 7) || 7)));
  quitar(/\s(?:a\s+)?fin\s+de\s+mes(?=\s)/, () => ponerFecha(iso(new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0, 12)))));
  quitar(/\s(?:el\s+|este\s+|para\s+el\s+)?(?:(proximo|siguiente)\s+)?(lunes|martes|miercoles|jueves|viernes|sabado|domingo)(?:\s+(?:que\s+viene|proximo))?(?=\s)/, m => {
    const w = DIAS.indexOf(m[2]); let k = (w - base.getUTCDay() + 7) % 7;
    if (k === 0 && !/este/.test(m[0])) k = 7;
    ponerFecha(sumar(k));
  });
  quitar(/\s(?:el\s+|para\s+el\s+)?(\d{1,2})\s*(?:de\s+)?(ene|feb|mar|abr|may|jun|jul|ago|sep|sept|oct|nov|dic)[a-z]*\.?(?:\s+(?:de\s+)?(\d{4}))?(?=\s)/, m => {
    const mes = MESES.indexOf(m[2].slice(0, 3)); let a = m[3] ? +m[3] : base.getUTCFullYear();
    let d = new Date(Date.UTC(a, mes, +m[1], 12)); if (d.getUTCMonth() !== mes) return false;
    if (!m[3] && iso(d) < hoy) d = new Date(Date.UTC(a + 1, mes, +m[1], 12));
    ponerFecha(iso(d));
  });
  quitar(/\s(?:el\s+|para\s+el\s+)?(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(?=\s)/, m => {
    let a = m[3] ? (+m[3] < 100 ? 2000 + +m[3] : +m[3]) : base.getUTCFullYear();
    let d = new Date(Date.UTC(a, +m[2] - 1, +m[1], 12)); if (d.getUTCMonth() !== +m[2] - 1) return false;
    if (!m[3] && iso(d) < hoy) d = new Date(Date.UTC(a + 1, +m[2] - 1, +m[1], 12));
    ponerFecha(iso(d));
  });
  // Si hay hora pero no fecha: hoy (o mañana si ya pasó... se deja hoy: el usuario lo ve en la vista previa)
  r.titulo = t.replace(/\s+/g, " ").replace(/\s+(el|la|a|para|de|del|en)\s*$/i, "").replace(/^\s*(el|la|para)\s+/i, "").trim();
  r.titulo = r.titulo.charAt(0).toUpperCase() + r.titulo.slice(1);
  return r;
};
// </interpretar>
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
  const fotosDe = it => { let l = Array.isArray(it.fotos) ? [...it.fotos] : []; if (!Array.isArray(it.fotos)) { try { l = JSON.parse(it.fotos || "[]"); } catch {} } if (!Array.isArray(l)) l = []; if (it.foto && !l.includes(it.foto)) l.unshift(it.foto); return l; };
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
      st.frecuencias = j.frecuencias || {};
      st.lugares = j.lugares || [];
      st.memoria = j.memoria_compras || [];
      EC.bloqueInfo("config", "lugares", { valor: st.lugares.length, texto: st.lugares.length === 1 ? "lugar de compra" : "lugares de compra" });
      EC.bloqueInfo("config", "categorias", { valor: (window.CATS || []).length, texto: "categorías de gastos" });
      // Avisos de los encargados sin leer: el contador se pone en rojo con cuántos son
      st.avisosSinLeer = j.avisos_sin_leer || 0;
      if (!st.personas) try { st.personas = (await api("turno")).personas; } catch { st.personas = []; }
      const a = j.abiertos;
      $("#a-subtitulo").textContent = `${a.tarea || 0} por hacer · ${a.incidencia || 0} incidencias abiertas`;
      pintar();
      const er = $("#ag-error"); if (er) er.remove();
    } catch (e) {
      if (e.message === "sesion") return;
      // El aviso va encima de los bloques (sin borrarlos), para que «Reintentar» pueda volver a pintarlos
      let er = $("#ag-error");
      if (!er) { er = document.createElement("div"); er.id = "ag-error"; er.className = "card ag-error"; er.setAttribute("role", "alert"); $("#ag-cuerpo").before(er); }
      er.innerHTML = `<p>No se pudo cargar la agenda: ${esc(e.message)}</p><button class="btn btn-primary" type="button">Reintentar</button>`;
      const b = er.querySelector("button"); b.onclick = () => { b.disabled = true; b.textContent = "Cargando…"; cargar(); };
    }
  }

  // La Agenda (calendario, por hacer, incidencias, avisos) y Pagos y compras comparten datos y formularios
  function pintar() {
    // Todo a la vista, un bloque por tipo: Agenda (calendario, por hacer, incidencias, avisos) y, en Dinero,
    // pagos programados, compras por hacer y pagos hechos
    const B = { "ab-calendario": vistaCalendario, "ab-tarea": vistaTareas, "ab-incidencia": () => vistaLista("incidencia"), "ab-aviso": vistaAvisos,
      "pg-prog": vistaProgramados, "pg-comp": () => resumenPagos("compras") + vistaCompras(), "pg-hechos": vistaHechos };
    for (const [id, f] of Object.entries(B)) { const el = $("#" + id); if (el) { el.innerHTML = f(); conectar(el); } }
    contadores();
    pintarConfig();
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
      it.tipo === "tarea" && it.reporto ? `<span class="tag tablet" title="La dejó un encargado desde la tablet">${avP(it.reporto)}La dejó ${esc(it.reporto)}</span>` : "",
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
      <span class="tt">${esc(it.titulo)}</span><span class="acc">${(it.tipo === "tarea" || it.tipo === "evento") && !hecho ? `<button class="btn btn-line btn-repro" type="button" data-repro="${esc(it.id)}" aria-expanded="${st.repro === it.id}">${ico("i-cal")}${it.fecha ? "Cambiar fecha" : "Poner fecha"}</button>` : ""}${it.tipo === "compra" && !hecho ? `<button class="btn btn-line btn-otra" type="button" data-posponer="${esc(it.id)}" data-v="${it.pospuesta ? 0 : 1}">${it.pospuesta ? "Regresar a la lista" : "Otra ocasión"}</button>` : ""}${it.tipo === "compra" && !hecho ? selLugar(it.lugar || "", ` class="lugar-sel" data-lugar="${esc(it.id)}" aria-label="Dónde se compra ${esc(it.titulo)}"`) : ""}${del}</span>${meta ? `<span class="mm">${meta}</span>` : ""}${(it.tipo === "tarea" || it.tipo === "compra") && it.detalle ? `<span class="mm">Nota: ${esc(it.detalle)}</span>` : ""}${informes ? `<span class="mm informes">${informes}</span>` : ""}</div>`;
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
      <section class="card"><div class="alist">${ab.length ? ab.map(item).join("") : `<p class="note">${vacio}</p>`}</div>
      ${ce.length ? `<details class="hechos"><summary>${fin} en los últimos 30 días (${ce.length})</summary><div class="alist">${ce.map(item).join("")}</div></details>` : ""}</section>`;
    return `<section class="card">${formulario(tipo)}</section>
      <section class="card"><div class="alist">${ab.length ? ab.map(item).join("") : `<p class="note">${vacio}</p>`}</div>
      ${ce.length ? `<details class="hechos"><summary>${fin} en los últimos 30 días (${ce.length})</summary><div class="alist">${ce.map(item).join("")}</div></details>` : ""}</section>`;
  }

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
      try {
        const r = await post("agenda/compras/terminar", { ids: carro.map(x => x.id), total: f.total.value, precios, forma: f.forma.value, fecha_compra: f.fecha_compra.value });
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
  setTimeout(conectarCompras, 0);

  // ---- Configuración (engranaje): lugares de compra y categorías ----
  function vistaLugares() {
    const lugares = st.lugares || [];
    return `<p class="note" style="margin:0 0 10px">Tú decides dónde se compra cada cosa; la tablet solo pide qué hace falta. Si algo ya se compró antes en un lugar, la compra nueva se va sola a ese lugar. Si quitas un lugar, sus compras pendientes quedan «Sin lugar».</p>
        <div class="lg-lista">${lugares.map(l => `<form class="lg-fila" data-lid="${esc(l.id)}"><input name="nombre" value="${esc(l.nombre)}" maxlength="40" aria-label="Nombre del lugar"><button class="btn btn-line btn-sm" type="submit">Guardar</button><button class="btn btn-line btn-sm" type="button" data-lquitar="${esc(l.id)}" aria-label="Quitar ${esc(l.nombre)}">Quitar</button></form>`).join("")}</div>
        <form class="lg-fila" id="lg-nuevo"><input name="nombre" maxlength="40" placeholder="Nuevo lugar (ej. Ferretería Martínez)" aria-label="Nuevo lugar"><button class="btn btn-primary btn-sm" type="submit">Agregar</button></form>`;
  }
  function vistaCategorias() {
    const ICONOS = ["servicios", "sueldos", "renta", "mantenimiento", "papeleria", "combustible", "impuestos", "tarjetas", "suscripciones", "familia", "otros", "carrito", "comida", "salud", "transporte", "limpieza"];
      const ICO_TXT = { servicios: "Foco", sueldos: "Monedas", renta: "Casa", mantenimiento: "Llave", papeleria: "Clip", combustible: "Bomba de gasolina", impuestos: "Recibo", tarjetas: "Tarjeta", suscripciones: "Pantalla", familia: "Personas", otros: "Caja", carrito: "Carrito", comida: "Cubiertos", salud: "Cruz", transporte: "Camión", limpieza: "Escoba" };
      return `<section class="card"><p class="note" style="margin:0 0 12px">Se usan en pagos, compras y gastos de caja. Una categoría nueva se crea sola cuando la escribes en un formulario. Aquí le cambias el nombre (con «Guardar») y el icono (se guarda al elegirlo). Al cambiar el nombre, lo ya registrado y los totales siguen igual, con el nombre nuevo.</p>
        <div class="cat-lista">${(window.CATS || []).map(c => `<div class="cat-fila" style="--c:${esc(c.color)}"><span class="ci"><svg aria-hidden="true"><use href="#i-cat-${esc(c.icono)}"/></svg></span>
          <form class="cat-nom" data-renombrar="${esc(c.nombre)}"><input name="nombre" value="${esc(c.etiqueta || c.nombre)}" maxlength="40" aria-label="Nombre de la categoría" autocomplete="off"><button class="btn btn-line btn-sm" type="submit">Guardar</button></form>
          <label class="cat-sel"><span>Icono</span><select data-cat="${esc(c.nombre)}" aria-label="Icono de ${esc(c.etiqueta || c.nombre)}">${ICONOS.map(i => `<option value="${i}" ${i === c.icono ? "selected" : ""}>${esc(ICO_TXT[i] || i)}</option>`).join("")}</select></label></div>`).join("")}</div>
        <form class="aform" id="cat-nueva" style="margin-top:14px"><label class="w2">Nueva categoría<input name="nombre" maxlength="40" placeholder="Ej. Publicidad" autocomplete="off"></label><button class="btn btn-primary" type="submit">Agregar</button><span class="err"></span></form></section>`;
  }
  function pintarConfig() {
    const m = $("#mod-config"); if (!m || m.hidden || !st.hoy) return;
    const cc = $("#cfg-categorias-c"), cl = $("#cfg-lugares-c");
    if (cc) { cc.innerHTML = vistaCategorias(); conectar(cc); }
    if (cl) { cl.innerHTML = vistaLugares(); conectar(cl); }
  }

  // ---- Pagos y compras (bloques de Dinero) ----
  // Resumen del mes: va arriba de los pagos programados (y, compacto, arriba de las compras)
  function resumenPagos(donde) {
    if (donde === "compras") return "";
    const mes = (st.hoy || "").slice(0, 7);
    const finMes = mes ? new Date(Date.UTC(+mes.slice(0, 4), +mes.slice(5, 7), 0)).toISOString().slice(0, 10) : "";
    const prog = st.items.filter(x => x.tipo === "pago" && abierto(x));
    const porPagar = prog.filter(x => x.fecha && x.fecha <= finMes), vencidos = prog.filter(x => x.fecha && x.fecha < st.hoy);
    const hechosMes = (st.pagosHechos || []).filter(p => p.fecha.slice(0, 7) === mes);
    const compras = st.items.filter(x => x.tipo === "compra");
    const compradas = compras.filter(x => x.estado === "comprado" && (x.monto_gasto != null || x.importe != null) && ((x.dia_gasto || (x.cerrado ? new Date(Date.parse(x.cerrado) - 216e5).toISOString() : "")).slice(0, 7) === mes));
    // Un ticket puede llevar varios artículos: se cuenta una vez
    const vistos = new Set(), compradasMes = compradas.filter(x => { const k = x.gasto_id || x.id; if (vistos.has(k)) return false; vistos.add(k); return true; }).map(x => ({ importe: x.monto_gasto != null ? x.monto_gasto : x.importe }));
    const sum = (l, f) => l.reduce((a, x) => a + (Number(f(x)) || 0), 0);
    const resumen = `<section class="card"><div class="ctot pg-res">
        <div class="k"><span>Por pagar este mes</span><b>${MXN(sum(porPagar, x => x.importe))}</b><small>${porPagar.length} ${porPagar.length === 1 ? "pago" : "pagos"}${vencidos.length ? ` · <span style="color:#ff6961">${vencidos.length} ${vencidos.length === 1 ? "vencido" : "vencidos"}</span>` : ""}</small></div>
        <div class="k dest"><span>Pagado este mes</span><b>${MXN(sum(hechosMes, p => p.importe))}</b><small>${hechosMes.length} ${hechosMes.length === 1 ? "registro" : "registros"}</small></div>
        <div class="k"><span>Compras del mes</span><b>${MXN(sum(compradasMes, x => x.importe))}</b><small>${compras.filter(abierto).length} por comprar</small></div>
      </div><p class="note" style="margin:8px 0 0">Todo esto sale de la administración: el efectivo de los sobres o el banco. No toca la caja de ningún turno; se suma a los egresos en Dinero.</p></section>`;
    return resumen;
  }
  function vistaProgramados() { return resumenPagos() + vistaLista("pago"); }
  function vistaHechos() {
    return `<section class="card"><div class="pago-acc"><button class="btn btn-primary" type="button" data-nuevo-pago="hecho">${ico("i-billete")}Registrar un pago o gasto ya hecho</button></div>
        <p class="note" style="margin:10px 0 0">Para lo que ya pagaste y no estaba programado: un recibo, una refacción, gasolina, una comida… Lleva comprobante opcional.</p></section>
      <section class="card">${listaPagosHechos()}</section>`;
  }
  // Contadores de cada bloque (en su título y en el submenú)
  function contadores() {
    const N = t => st.items.filter(x => x.tipo === t && abierto(x));
    const tareas = N("tarea"), inc = N("incidencia"), pagos = N("pago"), compras = N("compra").filter(x => !x.pospuesta);
    EC.bloqueN("agenda", "tarea", tareas.length, tareas.some(x => x.fecha && x.fecha < st.hoy));
    EC.bloqueN("agenda", "incidencia", inc.length, inc.some(x => x.gravedad === "grave"));
    EC.bloqueN("agenda", "aviso", Number.isFinite(st.avisosSinLeer) ? st.avisosSinLeer : N("aviso").length, !!st.avisosSinLeer);
    EC.bloqueN("finanzas", "programados", pagos.length, pagos.some(x => x.fecha && x.fecha < st.hoy));
    EC.bloqueN("finanzas", "compras", compras.length, compras.some(x => x.prioridad === "alta"));
    const mes = (st.hoy || "").slice(0, 7);
    const hechos = (st.pagosHechos || []).filter(p => p.fecha.slice(0, 7) === mes);
    EC.bloqueN("finanzas", "hechos", hechos.length);
    // Línea de estado de cada tarjeta del índice (celular y tablet)
    const pl = (n, a, b) => `${n} ${n === 1 ? a : b}`;
    const D0 = v => EC.dinero(v, 0);
    const evHoy = st.items.filter(x => x.tipo === "evento" && x.fecha === st.hoy).length;
    const venc = tareas.filter(x => x.fecha && x.fecha < st.hoy).length;
    const graves = inc.filter(x => x.gravedad === "grave").length;
    EC.bloqueInfo("agenda", "calendario", { valor: evHoy, texto: evHoy ? pl(evHoy, "evento hoy", "eventos hoy") : "Nada programado hoy" });
    EC.bloqueInfo("agenda", "tarea", { texto: !tareas.length ? "Nada pendiente" : venc ? pl(venc, "vencida", "vencidas") : "Al día" });
    EC.bloqueInfo("agenda", "incidencia", { texto: !inc.length ? "Ninguna abierta" : graves ? pl(graves, "grave", "graves") : "Ninguna grave" });
    EC.bloqueInfo("agenda", "aviso", { texto: st.avisosSinLeer ? pl(st.avisosSinLeer, "sin leer", "sin leer") : N("aviso").length ? "Todos leídos" : "Sin publicaciones activas" });
    const finMes = mes ? new Date(Date.UTC(+mes.slice(0, 4), +mes.slice(5, 7), 0)).toISOString().slice(0, 10) : "";
    const vPag = pagos.filter(x => x.fecha && x.fecha < st.hoy).length, porPagar = pagos.filter(x => x.fecha && x.fecha <= finMes).reduce((a, x) => a + (Number(x.importe) || 0), 0);
    EC.bloqueInfo("finanzas", "programados", { texto: !pagos.length ? "Sin pagos programados" : (vPag ? pl(vPag, "vencido", "vencidos") + " · " : "") + D0(porPagar) + " por pagar este mes" });
    const urgC = compras.filter(x => x.prioridad === "alta").length, lugs = new Set(compras.map(x => x.lugar || "sin")).size;
    EC.bloqueInfo("finanzas", "compras", { texto: !compras.length ? "Nada por comprar" : (urgC ? pl(urgC, "urgente", "urgentes") + " · " : "") + "en " + pl(lugs, "lugar", "lugares") });
    EC.bloqueInfo("finanzas", "hechos", { valor: D0(hechos.reduce((a, p) => a + p.importe, 0)), texto: hechos.length ? pl(hechos.length, "pago este mes", "pagos este mes") : "Nada pagado este mes" });
  }

  // ---- Avisos: muro de publicaciones con conversación ----
  // Cada aviso es una publicación: quien publica etiqueta a los destinatarios y todos comentan debajo
  // hasta que la administración la archiva. Solo la administración edita o borra comentarios.
  const T_AV = { "MAÑANA": "mañana", "TARDE": "tarde", "NOCHE": "noche" };
  const encargados = () => (st.personas || []).filter(p => p.activo);
  const nomDe = k => k === "admin" ? "Administración" : ((encargados().find(p => p.clave === k) || {}).nombre || k);
  const etqPara = p => [p.admin ? "Administración" : "", p.todos ? "Todos" : "", ...(p.turnos || []).map(t => "Turno " + T_AV[t]), ...(p.personas || [])].filter(Boolean);
  const conMenciones = t => esc(t).replace(/@([A-Za-zÑñ0-9_]{2,12})/g, (m, k) => encargados().some(p => p.clave === k.toUpperCase()) ? `<b class="men">@${esc(k.toUpperCase())}</b>` : m);
  const parrafos = t => conMenciones(t).replace(/\n/g, "<br>");
  st.hilos = st.hilos || {};
  st.abiertosAv = st.abiertosAv || new Set();
  function pintarAvisos() {
    const el = $("#ab-aviso");
    if (el) {
      const actividadAbierta = !!el.querySelector("details.casta-actividad[open]");
      const dlg = el.querySelector("dialog.casta-sheet[open]");
      const html = vistaAvisos();
      if (dlg) {
        // Conservar el modal abierto en el DOM: quitarlo cerraría la hoja en pleno envío.
        while (el.firstChild && el.firstChild !== dlg) el.firstChild.remove();
        const tmp = document.createElement("div");
        tmp.innerHTML = html;
        while (tmp.firstChild) el.insertBefore(tmp.firstChild, dlg);
        const it = st.items.find(x => x.id === dlg.dataset.av);
        if (it) { const hilo = dlg.querySelector(".hilo"); if (hilo) hilo.outerHTML = hiloHtml(it); }
      } else {
        el.innerHTML = html;
        mostrarSheetAdmin();
      }
      const actividad = el.querySelector("details.casta-actividad");
      if (actividad) actividad.open = actividadAbierta;
      conectar(el);
      castaRestaurar(el);
    }
    contadores();
  }
  // Una conversación visible a la vez, en una hoja modal. La lista de publicaciones no cambia.
  function mostrarSheetAdmin() {
    const el = $("#ab-aviso"), id = st.abiertosAv.values().next().value;
    if (!el || !id || st.archivo) return;
    const it = st.items.find(x => x.id === id);
    if (!it) { st.abiertosAv.clear(); return; }
    const dlg = document.createElement("dialog");
    dlg.className = "casta-sheet";
    dlg.dataset.av = id;
    dlg.setAttribute("aria-label", "Comentarios de " + it.titulo);
    dlg.innerHTML = `<div class="casta-sheet-head"><span class="casta-sheet-grip" aria-hidden="true"></span><h3>Comentarios</h3><button type="button" class="casta-sheet-x" data-sheet-cerrar aria-label="Cerrar comentarios">×</button></div>${hiloHtml(it)}`;
    dlg.addEventListener("close", () => { st.abiertosAv.delete(id); st.editCom = null; el.querySelectorAll('[data-hilo]').forEach(x => { if (x.dataset.hilo === id) x.setAttribute("aria-expanded", "false"); }); });
    dlg.addEventListener("click", e => { if (e.target === dlg) dlg.close(); });
    el.append(dlg);
    dlg.showModal();
  }

  function comentarioHtml(it, c, admin = true, editable = true) {
    if (st.editCom === c.id) return `<form class="com-edit" data-av="${esc(it.id)}" data-cid="${esc(c.id)}"><label class="sr">Editar comentario<textarea name="texto" rows="2" maxlength="1000">${esc(c.texto)}</textarea></label>
      <div class="com-acc"><button class="btn btn-primary" type="submit">Guardar</button><button class="btn btn-line" type="button" data-com-cancelar>Cancelar</button></div><span class="err" role="alert"></span></form>`;
    return `<div class="com ${c.borrado ? "borrado" : ""}">${avP(c.autor === "admin" ? "admin" : c.autor)}<div class="com-b">
      <div class="com-burb"><b>${esc(nomDe(c.autor))}</b>${c.borrado ? `<p class="com-t">Comentario borrado${admin && c.texto ? `: <s>${parrafos(c.texto)}</s>` : ""}</p>` : `${c.texto ? `<p class="com-t">${parrafos(c.texto)}</p>` : ""}`}
        ${!c.borrado && c.foto ? `<a class="com-foto" href="${urlFoto(c.foto)}" target="_blank" rel="noopener"><img src="${urlFoto(c.foto)}" alt="Foto del comentario de ${esc(nomDe(c.autor))}" loading="lazy"></a>` : ""}</div>
      <div class="com-m"><span>${esc(cuando(c.creado))}</span>${editable && !c.borrado && c.autor !== "admin" ? `<button type="button" class="lnk" data-responder="${esc(c.autor)}">Responder</button>` : ""}${c.editado && !c.borrado ? "<span>Editado</span>" : ""}${(c.etiquetas || []).length ? `<span>Etiquetó a ${c.etiquetas.map(k => "@" + esc(k)).join(", ")}</span>` : ""}
        ${editable && !c.borrado ? `<button type="button" class="lnk" data-com-editar="${esc(c.id)}" data-av="${esc(it.id)}">Editar</button><button type="button" class="lnk peligro" data-com-borrar="${esc(c.id)}" data-av="${esc(it.id)}">Borrar</button>` : ""}</div></div></div>`;
  }

  function hiloHtml(it) {
    const h = st.hilos[it.id];
    if (!h) return `<div class="hilo"><p class="note">Cargando la conversación…</p></div>`;
    if (h.error) return `<div class="hilo"><p class="note">${esc(h.error)} <button class="lnk" type="button" data-hilo-reintentar="${esc(it.id)}">Reintentar</button></p></div>`;
    const p = it.para || {}, fuera = encargados().filter(x => !p.todos && !(p.personas || []).includes(x.clave) && x.clave !== it.autor);
    const sel = h.etq || [];
    return `<div class="hilo"><div class="casta-sheet-list">${h.comentarios.length ? h.comentarios.map(c => comentarioHtml(it, c)).join("") : `<p class="note">Todavía no hay comentarios.</p>`}</div>
      <div class="casta-sheet-compose">${abierto(it) ? `<form class="com-form" data-av="${esc(it.id)}">${avP("admin")}<div class="com-b">
        ${h.responderA ? `<div class="casta-reply"><span>Respondiendo a @${esc(h.responderA)}</span><button type="button" data-reply-cancel aria-label="Cancelar respuesta">×</button></div>` : ""}
        <div class="casta-emoji-bar" aria-label="Emojis rápidos"><button type="button" data-com-emoji="😅" aria-label="Insertar emoji 😅">😅</button><button type="button" data-com-emoji="😡" aria-label="Insertar emoji 😡">😡</button><button type="button" data-com-emoji="💩" aria-label="Insertar emoji 💩">💩</button><button type="button" data-com-emoji="👽" aria-label="Insertar emoji 👽">👽</button><button type="button" data-com-emoji="🙊" aria-label="Insertar emoji 🙊">🙊</button><button type="button" data-com-emoji="🙉" aria-label="Insertar emoji 🙉">🙉</button><button type="button" data-com-emoji="🙈" aria-label="Insertar emoji 🙈">🙈</button><button type="button" data-com-emoji="❤️" aria-label="Insertar emoji ❤️">❤️</button><button type="button" data-com-emoji="🔥" aria-label="Insertar emoji 🔥">🔥</button></div>
        <label class="sr" for="com-${esc(it.id)}">Escribe un comentario</label>
        <textarea id="com-${esc(it.id)}" name="texto" rows="2" maxlength="1000" placeholder="Escribe un comentario… usa @ para etiquetar">${esc(h.borrador || "")}</textarea>
        ${!h.responderA && fuera.length ? `<div class="com-etq"><span>Etiquetar a alguien más</span>${fuera.map(x => `<button type="button" class="pchip ${sel.includes(x.clave) ? "on" : ""}" data-etq="${esc(x.clave)}" aria-pressed="${sel.includes(x.clave)}">@${esc(x.clave)}</button>`).join("")}</div>` : ""}
        ${!h.responderA && h.foto ? `<span class="inc-th"><img src="${h.foto}" alt="Foto para el comentario"><button type="button" data-com-sinfoto aria-label="Quitar la foto">×</button></span>` : ""}
        <div class="com-acc">${!h.responderA ? `<label class="btn btn-line"><input type="file" accept="image/*" data-com-foto hidden>Foto</label>` : ""}<button class="btn btn-primary" type="submit">${h.responderA ? "Responder" : "Comentar"}</button></div>
        <span class="err" role="alert"></span></div></form>` : `<p class="note">Archivado: ya no se puede comentar.</p>`}</div></div>`;
  }


  // Carrusel de fotografías solo en Castagram; las claves y rutas de fotos siguen intactas.
  const castaFotoActual = new Map();
  function castaFotos(fotos, id) {
    if (!Array.isArray(fotos) || !fotos.length) return "";
    const foto = (k, i) => `<a href="${urlFoto(k)}" target="_blank" rel="noopener" aria-label="Abrir foto ${i + 1} de ${fotos.length}"><img src="${urlFoto(k)}" alt="Foto ${i + 1} de ${fotos.length} de Castagram" loading="lazy"></a>`;
    if (fotos.length === 1) return `<div class="post-fotos">${foto(fotos[0],0)}</div>`;
    const actual = Math.max(0, Math.min(fotos.length-1, castaFotoActual.get(id) || 0));
    return `<div class="casta-carrusel" data-casta-carrusel="${esc(id)}" aria-label="Galería de ${fotos.length} fotografías">
      <div class="casta-carrusel-pista" aria-roledescription="carrusel" tabindex="0">${fotos.map((k,i)=>`<div class="casta-carrusel-slide">${foto(k,i)}</div>`).join("")}</div>
      <span class="casta-carrusel-num" aria-live="polite">${actual+1} / ${fotos.length}</span>
      <button type="button" class="casta-carrusel-arrow anterior" data-casta-paso="-1" aria-label="Foto anterior" ${actual===0?"disabled":""}>‹</button>
      <button type="button" class="casta-carrusel-arrow siguiente" data-casta-paso="1" aria-label="Foto siguiente" ${actual===fotos.length-1?"disabled":""}>›</button>
      <div class="casta-carrusel-puntos" aria-label="Posición de fotografía">${fotos.map((_,i)=>`<button type="button" data-casta-ir="${i}" aria-label="Ver foto ${i+1} de ${fotos.length}" ${actual===i?'aria-current="true"':""}></button>`).join("")}</div>
    </div>`;
  }
  function castaSincronizar(caja) {
    if (!caja || !caja.isConnected) return;
    const pista = caja.querySelector(".casta-carrusel-pista");
    if (!pista || !pista.clientWidth) return;
    const total = pista.children.length, indice = Math.max(0, Math.min(total-1, Math.round(pista.scrollLeft / pista.clientWidth)));
    castaFotoActual.set(caja.dataset.castaCarrusel,indice);
    const num = caja.querySelector(".casta-carrusel-num");
    if (num) num.textContent = `${indice+1} / ${total}`;
    for (const [paso,borde] of [[-1,0],[1,total-1]]) { const b = caja.querySelector('[data-casta-paso="'+paso+'"]'); if (b) b.disabled = indice === borde; }
    caja.querySelectorAll("[data-casta-ir]").forEach(b=>{ if(+b.dataset.castaIr===indice)b.setAttribute("aria-current","true");else b.removeAttribute("aria-current"); });
  }
  function castaMover(boton) {
    const caja = boton.closest("[data-casta-carrusel]"), pista = caja && caja.querySelector(".casta-carrusel-pista");
    if(!pista || !pista.clientWidth)return;
    const actual=Math.round(pista.scrollLeft/pista.clientWidth);
    const destino=boton.dataset.castaIr!==undefined?+boton.dataset.castaIr:actual+Number(boton.dataset.castaPaso);
    if(destino<0 || destino>=pista.children.length)return;
    castaFotoActual.set(caja.dataset.castaCarrusel,destino);
    pista.scrollTo({left:destino*pista.clientWidth,behavior:matchMedia("(prefers-reduced-motion: reduce)").matches?"instant":"smooth"});
  }
  function castaRestaurar(root) {
    if(!root)return;
    requestAnimationFrame(()=>root.querySelectorAll("[data-casta-carrusel]").forEach(caja=>{
      if(!caja.isConnected)return;
      const pista=caja.querySelector(".casta-carrusel-pista"), indice=castaFotoActual.get(caja.dataset.castaCarrusel)||0;
      if(pista&&pista.clientWidth)pista.scrollLeft=indice*pista.clientWidth;
      castaSincronizar(caja);
    }));
  }

  function postHtml(it) {
    if (st.editando === it.id) return `<article class="post">${formEditar(it)}</article>`;
    const deEnc = it.autor !== "admin", p = it.para || {}, cv = it.conv || { n: 0, nuevos: 0, nuevosEnterado: 0 };
    const leidoAdmin = (it.lecturas || []).some(l => l.persona === "ADMIN");
    const nuevo = deEnc && p.admin && abierto(it) && !leidoAdmin;
    const dest = p.todos || (p.turnos || []).length ? encargados() : encargados().filter(x => (p.personas || []).includes(x.clave));
    const lec = new Map((it.lecturas || []).map(x => [x.persona, x.at]));
    const vistos = dest.filter(x => x.clave !== it.autor && lec.has(x.clave)), faltan = dest.filter(x => x.clave !== it.autor && !lec.has(x.clave));
    const abiertoHilo = st.abiertosAv.has(it.id);
    const comentarIcono = "<svg class=\"casta-comentar-ico\" viewBox=\"0 0 24 24\" width=\"24\" height=\"24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"M5 3.5h14a2.5 2.5 0 0 1 2.5 2.5v10a2.5 2.5 0 0 1-2.5 2.5H9l-6.5 4V6A2.5 2.5 0 0 1 5 3.5Z\"/><path d=\"M7.5 9H17M7.5 13H15\"/></svg>";
    const pulgar = `<img class="casta-pulgar-ico" src="/img/castagram-pulgar.png" alt="" aria-hidden="true" width="26" height="26">`;
    const cantidadEnterados = vistos.length + (deEnc && p.admin && leidoAdmin ? 1 : 0);
    return `<article class="post ${nuevo || cv.nuevos || cv.nuevosEnterado ? "nuevo" : ""} ${abierto(it) ? "" : "hecho"}" data-post="${esc(it.id)}">
      <header class="post-h">${avP(deEnc ? it.autor : "admin", 1)}<div class="post-q"><b>${esc(nomDe(it.autor))}</b><span>${esc(cuando(it.creado))}${it.fecha && it.fecha > st.hoy ? ` · se muestra desde ${esc(diaTxt(it.fecha))}` : ""}</span></div>
        ${it.prioridad === "alta" ? `<span class="tag alta">Importante</span>` : ""}</header>
      <p class="post-para">Para ${etqPara(p).map(t => `<span class="etq-p">@${esc(t)}</span>`).join("")}</p>
      <h4 class="post-t">${esc(it.titulo)}</h4>${it.detalle ? `<p class="post-d">${parrafos(it.detalle)}</p>` : ""}
      ${castaFotos(fotosDe(it),it.id)}
      <div class="post-st"><div class="casta-acciones">${nuevo ? `<button type="button" class="casta-pulgar casta-pulgar-boton" data-leer="${esc(it.id)}" aria-label="Confirmar mi Enterado. ${cantidadEnterados} confirmaciones registradas" title="Confirmar mi Enterado">${pulgar}<small>${cantidadEnterados}</small></button>` : `<span class="casta-pulgar ${cantidadEnterados ? "is-enterado" : ""}" role="img" aria-label="${cantidadEnterados} confirmaciones de Enterado" title="${cantidadEnterados} confirmaciones de Enterado">${pulgar}<small>${cantidadEnterados}</small></span>`}<button type="button" class="casta-comentar" data-hilo="${esc(it.id)}" aria-label="Abrir comentarios" title="Comentar">${comentarIcono}</button></div>${dest.length ? `<span class="post-ent">${vistos.length ? `<span class="si" title="${esc(vistos.map(x => x.clave + " " + cuando(lec.get(x.clave))).join(", "))}">✓ Enterado: ${vistos.map(x => `${esc(x.clave)} <small>${esc(cuando(lec.get(x.clave)).replace(/^.*?, /, ""))}</small>`).join(", ")}</span>` : ""}${faltan.length ? `<span class="no">Sin enterado: ${faltan.map(x => esc(x.clave)).join(", ")}</span>` : ""}</span>` : `<span>${deEnc && p.admin && leidoAdmin ? "✓ Enterado" : ""}</span>`}
        <button type="button" class="lnk" data-hilo="${esc(it.id)}" aria-expanded="${abiertoHilo}">${cv.n ? (cv.n === 1 ? "1 comentario" : cv.n + " comentarios") : "0 comentarios"}${cv.nuevos ? ` <span class="nuevo-n">${cv.nuevos} ${cv.nuevos === 1 ? "comentario nuevo" : "comentarios nuevos"}</span>` : ""}${cv.nuevosEnterado ? ` <span class="nuevo-n">${cv.nuevosEnterado} ${cv.nuevosEnterado === 1 ? "Enterado nuevo" : "Enterados nuevos"}</span>` : ""}</button></div>
      ${!abiertoHilo && cv.ultimo ? `<button type="button" class="post-ult" data-hilo="${esc(it.id)}">${avP(cv.ultimo.autor === "admin" ? "admin" : cv.ultimo.autor)}<span><b>${esc(nomDe(cv.ultimo.autor))}</b> ${esc(cv.ultimo.texto || "Mandó una foto")}</span></button>` : ""}
      <div class="post-acc">
        ${abierto(it) ? `<button type="button" class="pa" data-archivar="${esc(it.id)}">${ico("i-archivo")}Archivar</button>` : `<button type="button" class="pa" data-reactivar="${esc(it.id)}">Reactivar</button>`}
        ${it.autor === "admin" && abierto(it) ? `<button type="button" class="pa" data-editar="${esc(it.id)}">Editar</button>` : ""}
      </div>
      </article>`;
  }


  // Actividad dentro de Castagram. Se deriva solo de los avisos ya autorizados
  // y distingue el visto de una confirmación explícita de Enterado.
  function castaActividadAdmin() {
    const eventos = [];
    for (const it of st.items || []) {
      if (it.tipo !== "aviso" || !abierto(it)) continue;
      const cv = it.conv || {}, para = it.para || {}, autor = it.autor || "admin";
      const vistoAdmin = (it.lecturas || []).some(x => x.persona === "ADMIN");
      if (autor !== "admin" && para.admin && !vistoAdmin)
        eventos.push({ id: it.id, tipo: "publicacion", at: it.creado,
          mensaje: nomDe(autor) + " publicó una novedad", titulo: it.titulo });
      if (cv.nuevos > 0) {
        const quien = cv.ultimo && cv.ultimo.autor !== "admin" ? nomDe(cv.ultimo.autor) : "";
        eventos.push({ id: it.id, tipo: "comentario", at: cv.ultimo && cv.ultimo.creado || cv.actividad || it.creado,
          mensaje: cv.nuevos === 1 ? (quien ? quien + " comentó" : "Comentario nuevo") : cv.nuevos + " comentarios nuevos",
          titulo: it.titulo });
      }
      if (cv.nuevosEnterado > 0) {
        const ultimos = (it.lecturas || []).filter(x => x.persona !== "ADMIN")
          .sort((a,b) => String(b.at || "").localeCompare(String(a.at || "")))
          .slice(0,cv.nuevosEnterado);
        const quien = cv.nuevosEnterado === 1 && ultimos.length ? nomDe(ultimos[0].persona) + " confirmó Enterado" :
          cv.nuevosEnterado + " confirmaciones de Enterado";
        eventos.push({ id: it.id, tipo: "enterado", at: ultimos[0] && ultimos[0].at || cv.actividad || it.creado,
          mensaje: quien, titulo: it.titulo });
      }
    }
    return eventos.sort((a,b) => String(b.at || "").localeCompare(String(a.at || ""))).slice(0,20);
  }
  function castaActividadVistaAdmin() {
    const eventos = castaActividadAdmin();
    return `<details class="casta-actividad"><summary>${ico("i-aviso")}<span>Actividad</span>${eventos.length ? `<b aria-label="${eventos.length} novedades">${eventos.length > 99 ? "99+" : eventos.length}</b>` : ""}</summary>
      <div class="casta-actividad-list">${eventos.length ? eventos.map(e => `<button type="button" data-casta-evento="${esc(e.id)}" aria-label="${esc(e.mensaje)}. Abrir conversación">
      <strong>${esc(e.mensaje)}</strong><small>${esc(e.titulo)}</small></button>`).join("") : `<p>Sin novedades pendientes.</p>`}</div></details>`;
  }

  function vistaAvisos() {
    if (st.archivo) return vistaArchivo();
    const act = st.items.filter(x => x.tipo === "aviso" && abierto(x)).sort((a, b) => String((b.conv && b.conv.actividad) || b.creado).localeCompare(String((a.conv && a.conv.actividad) || a.creado)));
    const r = st.resp || {}; st.resp = null;
    const opPara = [["todos", "Todos los encargados"], ...Object.entries(T_AV).map(([k, v]) => ["t:" + k, "Turno " + v]), ...encargados().map(p => ["p:" + p.clave, p.clave])];
    const marcado = () => false; // Cada nueva publicación requiere elección expresa.
    return `<div class="casta-identidad"><img src="/img/castagram-texto.png" alt="Castagram" width="300" height="79"></div>${castaActividadVistaAdmin()}<section class="card muro-nuevo"><form class="aform" data-tipo="aviso"><div class="w4 muro-q">${avP("admin", 1)}<label>Nueva publicación<input name="titulo" maxlength="140" placeholder="¿Qué necesitas avisar? Ej. Mañana viene el técnico de la báscula" autocomplete="off" value="${esc(r.titulo || "")}"></label></div>
      <label class="w4 extra">Detalle <span style="font-weight:400">(opcional)</span><textarea name="detalle" rows="2" maxlength="1000"></textarea></label>
      <div class="w4 para-op extra"><span>Elige destinatarios (obligatorio)</span>${opPara.map(([v, t]) => `<label class="pchip ${marcado(v) ? "on" : ""}"><input type="checkbox" data-para="${esc(v)}" ${marcado(v) ? "checked" : ""}>@${esc(t)}</label>`).join("")}</div>
      <label class="extra">Mostrar desde<input type="date" name="fecha"></label><label class="extra">Importancia<select name="prioridad"><option value="normal">Normal</option><option value="alta">Importante</option></select></label>
      <div class="w4 inc-fotos extra"><span class="lbl">Foto <span style="font-weight:400">(opcional · hasta 8)</span></span>
        <div class="inc-fbtns"><label class="btn btn-line"><input type="file" accept="image/*" capture="environment" class="inc-f" hidden>Tomar foto</label><label class="btn btn-line"><input type="file" accept="image/*" multiple class="inc-f" hidden>Subir fotos</label></div>
        <div class="inc-prev"></div></div>
      <button class="btn btn-primary extra" type="submit">Publicar</button><span class="err"></span></form>
      <p class="note extra-n" style="margin:10px 0 0">Solo lo ven las personas etiquetadas y quien lo publica. Todos comentan en la misma publicación hasta que la archives; lo archivado se guarda con su conversación en el archivo.</p></section>
      <div class="muro">${act.length ? act.map(postHtml).join("") : `<p class="empty">No hay publicaciones activas. Publica una arriba.</p>`}</div>
      <button class="btn btn-line muro-arch" type="button" data-archivo-abrir>${ico("i-archivo")}Archivo de Castagram</button>`;
  }

  // ---- Archivo de avisos: todo lo archivado, con búsqueda, conversación e historial ----
  const ACC_TXT = { publicar: "publicó el aviso", comentar: "comentó", etiquetar: "etiquetó a", editar: "editó un comentario", borrar: "borró un comentario", archivar: "archivó el aviso", reactivar: "reactivó el aviso", "editar-aviso": "cambió el aviso" };
  function historialHtml(l) {
    return `<ol class="hist">${l.map(h => {
      const d = h.detalle || {};
      let extra = "";
      if (h.accion === "comentar") extra = d.texto ? `«${esc(d.texto)}»` : "una foto";
      else if (h.accion === "etiquetar") extra = (d.personas || []).map(k => "@" + esc(k)).join(", ");
      else if (h.accion === "editar") extra = `de ${esc(nomDe(d.autor))}: antes «${esc(d.antes)}», ahora «${esc(d.despues)}»`;
      else if (h.accion === "borrar") extra = `de ${esc(nomDe(d.autor))}: «${esc(d.texto || (d.foto ? "foto" : ""))}»`;
      else if (h.accion === "editar-aviso") extra = d.antes && d.despues && d.antes.titulo !== d.despues.titulo ? `título: «${esc(d.antes.titulo)}» → «${esc(d.despues.titulo)}»` : "texto o destinatarios";
      else if (h.accion === "publicar" && d.para) extra = "para " + etqPara(d.para).map(t => "@" + esc(t)).join(", ");
      return `<li><time>${esc(cuando(h.at))}</time><span><b>${esc(nomDe(h.quien))}</b> ${ACC_TXT[h.accion] || esc(h.accion)} ${extra}${d.por ? ` <span class="muted">(${esc(d.por)})</span>` : ""}</span></li>`;
    }).join("")}</ol>`;
  }
  function vistaArchivo() {
    const a = st.archivo;
    const filtros = `<form class="arch-f" id="arch-f"><label>Buscar<input name="q" type="search" value="${esc(a.q || "")}" placeholder="Palabra del aviso o de un comentario…" autocomplete="off"></label>
      <label>Persona<select name="persona"><option value="">Todas</option><option value="ADMIN" ${a.persona === "ADMIN" ? "selected" : ""}>Administración</option>${encargados().map(p => `<option value="${esc(p.clave)}" ${a.persona === p.clave ? "selected" : ""}>${esc(p.clave)}</option>`).join("")}</select></label>
      <label>Archivado desde<input type="date" name="desde" value="${esc(a.desde || "")}"></label><label>Hasta<input type="date" name="hasta" value="${esc(a.hasta || "")}"></label>
      <button class="btn btn-primary" type="submit">Buscar</button></form>`;
    if (a.sel) {
      const d = a.det;
      if (!d) return `<button class="btn btn-line" type="button" data-archivo-volver>‹ Archivo</button><p class="note">Cargando…</p>`;
      const it = { ...d.aviso, conv: null };
      return `<button class="btn btn-line" type="button" data-archivo-volver>‹ Archivo de Castagram</button>
        <article class="post hecho"><header class="post-h">${avP(it.autor === "admin" ? "admin" : it.autor, 1)}<div class="post-q"><b>${esc(nomDe(it.autor))}</b><span>${esc(cuando(it.creado))} · archivado ${esc(cuando(it.cerrado))}</span></div></header>
          <p class="post-para">Para ${etqPara(it.para || {}).map(t => `<span class="etq-p">@${esc(t)}</span>`).join("")}</p>
          <h4 class="post-t">${esc(it.titulo)}</h4>${it.detalle ? `<p class="post-d">${parrafos(it.detalle)}</p>` : ""}
          ${castaFotos(fotosDe(it),it.id)}
          <div class="post-acc"><button type="button" class="pa" data-reactivar="${esc(it.id)}">Reactivar</button></div>
          <div class="hilo">${d.comentarios.length ? d.comentarios.map(c => comentarioHtml(it, c, true, false)).join("") : `<p class="note">Sin comentarios.</p>`}</div></article>
        <section class="card"><h4 class="hist-t">Historial</h4>${historialHtml(d.historial || [])}</section>`;
    }
    return `<button class="btn btn-line" type="button" data-archivo-volver>‹ Castagram</button>
      <section class="card"><h4 class="hist-t">Archivo de Castagram</h4><p class="note" style="margin:0 0 10px">Todo lo archivado se conserva con su conversación y su historial.</p>${filtros}</section>
      ${a.cargando ? `<p class="note">Buscando…</p>` : a.error ? `<p class="empty">${esc(a.error)}</p>` : `<div class="arch-l">${(a.items || []).length ? a.items.map(it => `<button type="button" class="arch-i" data-archivo-ver="${esc(it.id)}">${avP(it.autor === "admin" ? "admin" : it.autor)}<span class="arch-t"><b>${esc(it.titulo)}</b><span>${esc(nomDe(it.autor))} · archivado ${esc(cuando(it.cerrado || it.actualizado))}${it.conv && it.conv.n ? ` · ${it.conv.n} ${it.conv.n === 1 ? "comentario" : "comentarios"}` : ""}</span></span></button>`).join("") : `<p class="empty">No hay avisos archivados con esos filtros.</p>`}</div>
      ${a.pagina > 0 || a.mas ? `<div class="arch-pag">${a.pagina > 0 ? `<button class="btn btn-line" type="button" data-archivo-pag="-1">Anteriores</button>` : ""}${a.mas ? `<button class="btn btn-line" type="button" data-archivo-pag="1">Más</button>` : ""}</div>` : ""}`}`;
  }
  async function buscarArchivo() {
    const a = st.archivo;
    if (!a) return;
    const solicitud = (a.solicitud || 0) + 1;
    a.solicitud = solicitud; a.cargando = true; a.error = ""; pintarAvisos();
    const q = new URLSearchParams({ q: a.q || "", persona: a.persona || "", desde: a.desde || "", hasta: a.hasta || "", pagina: a.pagina || 0 });
    try {
      const j = await api("agenda/avisos-archivo?" + q);
      if (st.archivo !== a || a.solicitud !== solicitud) return;
      a.items = j.items; a.mas = j.mas;
    } catch (e) {
      if (st.archivo !== a || a.solicitud !== solicitud) return;
      if (e.message !== "sesion") a.error = "No se pudo cargar el archivo: " + e.message;
    }
    if (st.archivo === a && a.solicitud === solicitud) { a.cargando = false; pintarAvisos(); }
  }
  async function abrirHilo(id, forzar) {
    if (!forzar && st.hilos[id] && !st.hilos[id].error) return;
    const prev = st.hilos[id] || {};
    try {
      const j = await api(`agenda/${id}/conversacion`);
      st.hilos[id] = { ...prev, error: "", comentarios: j.comentarios };
      const it = st.items.find(x => x.id === id);
      if (it) {
        const nuevaPublicacion = it.autor !== "admin" && !!(it.para && it.para.admin) &&
          !(it.lecturas || []).some(x => x.persona === "ADMIN");
        const habiaNovedad = !!(it.conv && (it.conv.nuevos || it.conv.nuevosEnterado));
        // La conversación ya fue marcada vista por el servidor: reflejarlo de inmediato.
        if (nuevaPublicacion) it.lecturas = [...(it.lecturas || []), { persona: "ADMIN", at: new Date().toISOString() }];
        if (it.conv) { it.conv.nuevos = 0; it.conv.nuevosEnterado = 0; }
        if (nuevaPublicacion || habiaNovedad)
          st.avisosSinLeer = Math.max(0, (st.avisosSinLeer || 0) - 1);
      }
    } catch (e) { if (e.message !== "sesion") st.hilos[id] = { ...prev, error: "No se pudo cargar: " + e.message, comentarios: [] }; }
    if (st.abiertosAv.has(id)) pintarAvisos();
  }

  function comenzarReplyAdmin(h, nombre) {
    if (!h.responderA) h.antesReply = { texto: h.borrador || "", foto: h.foto || null, etq: h.etq || [] };
    h.responderA = nombre;
    h.borrador = "@" + nombre + " ";
    h.foto = null;
    h.etq = [];
  }
  function terminarReplyAdmin(h) {
    if (!h.responderA) return;
    const ant = h.antesReply || {};
    h.borrador = ant.texto || "";
    h.foto = ant.foto || null;
    h.etq = ant.etq || [];
    h.responderA = null;
    delete h.antesReply;
  }
  function insertarEmojiCastagram(form, emoji) {
    const ta = form && form.querySelector('textarea[name="texto"]');
    if (!ta) return;
    const i = ta.selectionStart, j = ta.selectionEnd;
    ta.setRangeText(emoji, i, j, "end");
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    ta.focus({ preventScroll: true });
  }

  // Eventos del muro (se conectan una vez sobre el bloque; el contenido se vuelve a pintar)
  function conectarMuro() {
    const el = $("#ab-aviso"); if (!el || el._muro) return; el._muro = true;
    // El cuadro para publicar se abre completo al tocarlo (como en una red social)
    el.addEventListener("focusin", e => { const f = e.target.closest(".muro-nuevo form.aform"); if (f) f.classList.add("abierto"); });
    el.addEventListener("click", async e => {
      const t = e.target.closest("button"); if (!t || !el.contains(t)) return;
      const d = t.dataset;
      if (t.matches("[data-casta-paso], [data-casta-ir]")) { castaMover(t); return; }
      if (d.castaEvento) {
        const it = st.items.find(x => x.id === d.castaEvento && x.tipo === "aviso" && abierto(x));
        if (!it) return;
        st.abiertosAv.clear(); st.abiertosAv.add(it.id);
        pintarAvisos();
        await abrirHilo(it.id, true);
        return;
      }
      if (d.reactivar && st.archivo) { st.archivo = null; return; }
      if (d.hilo) {
        const id = d.hilo;
        st.abiertosAv.clear(); st.abiertosAv.add(id);
        pintarAvisos();
        await abrirHilo(id, true);
        if (t.classList.contains("pa")) { const ta = el.querySelector(`#com-${CSS.escape(id)}`); if (ta) ta.focus({ preventScroll: true }); }
      } else if ("sheetCerrar" in d) { const sheet = t.closest("dialog.casta-sheet"); if (sheet) sheet.close(); }
      else if (d.responder) {
        const sheet = t.closest("dialog.casta-sheet"), id = sheet && sheet.dataset.av;
        if (id && st.hilos[id]) {
          const form = sheet.querySelector(".com-form");
          if (form) st.hilos[id].borrador = form.texto.value;
          comenzarReplyAdmin(st.hilos[id], d.responder);
          pintarAvisos();
          const ta = el.querySelector("dialog.casta-sheet .com-form textarea");
          if (ta) { ta.focus({ preventScroll: true }); ta.setSelectionRange(ta.value.length, ta.value.length); }
        }
      } else if ("replyCancel" in d) {
        const sheet = t.closest("dialog.casta-sheet");
        if (sheet && st.hilos[sheet.dataset.av]) { terminarReplyAdmin(st.hilos[sheet.dataset.av]); pintarAvisos(); }
      } else if (d.comEmoji) {
        insertarEmojiCastagram(t.closest("form.com-form"), d.comEmoji);
      } else if (d.hiloReintentar) abrirHilo(d.hiloReintentar, true);
      else if (d.etq) {
        const f = t.closest("form"), h = st.hilos[f.dataset.av]; h.etq = h.etq || [];
        h.etq = h.etq.includes(d.etq) ? h.etq.filter(x => x !== d.etq) : [...h.etq, d.etq];
        t.classList.toggle("on"); t.setAttribute("aria-pressed", h.etq.includes(d.etq));
      } else if ("comSinfoto" in d) { const f = t.closest("form"); st.hilos[f.dataset.av].foto = null; st.hilos[f.dataset.av].borrador = f.texto.value; pintarAvisos(); }
      else if (d.comEditar) { st.editCom = d.comEditar; pintarAvisos(); const ta = el.querySelector("form.com-edit textarea"); ta && ta.focus(); }
      else if ("comCancelar" in d) { st.editCom = null; pintarAvisos(); }
      else if (d.comBorrar) {
        if (!(await EC.confirmar("¿Borrar este comentario?", "Deja de verse en la conversación. Queda registrado en el historial del aviso.", "Borrar", true))) return;
        try { await post(`agenda/${d.av}/comentarios/${d.comBorrar}/borrar`, {}); toast("Comentario borrado"); await abrirHilo(d.av, true); } catch (er) { if (er.message !== "sesion") toast(er.message); }
      } else if ("archivoAbrir" in d) { st.archivo = { pagina: 0 }; buscarArchivo(); scrollTo({ top: el.getBoundingClientRect().top + scrollY - 80 }); }
      else if ("archivoVolver" in d) { if (st.archivo && st.archivo.sel) { st.archivo.sel = null; st.archivo.det = null; } else st.archivo = null; pintarAvisos(); }
      else if (d.archivoPag) { st.archivo.pagina = Math.max(0, (st.archivo.pagina || 0) + Number(d.archivoPag)); buscarArchivo(); }
      else if (d.archivoVer) {
        const a = st.archivo; a.sel = d.archivoVer; a.det = null; pintarAvisos();
        try { a.det = await api(`agenda/${d.archivoVer}/conversacion?historial=1`); } catch (er) { if (er.message !== "sesion") { toast(er.message); a.sel = null; } }
        if (st.archivo === a) pintarAvisos();
      }
    });
    el.addEventListener("scroll", e => { if(e.target.matches(".casta-carrusel-pista"))castaSincronizar(e.target.closest("[data-casta-carrusel]")); }, true);
    el.addEventListener("change", async e => {
      const inp = e.target.closest("[data-com-foto]"); if (!inp || !inp.files[0]) return;
      const f = inp.closest("form"), h = st.hilos[f.dataset.av];
      if (h.responderA) { inp.value = ""; return; }
      try { h.foto = await comprimirFoto(inp.files[0]); h.borrador = f.texto.value; pintarAvisos(); } catch (er) { f.querySelector(".err").textContent = er.message; }
    });
    el.addEventListener("input", e => { const f = e.target.closest("form.com-form"); if (f && st.hilos[f.dataset.av]) st.hilos[f.dataset.av].borrador = e.target.value; });
    el.addEventListener("submit", async e => {
      const f = e.target;
      if (f.id === "arch-f") { e.preventDefault(); Object.assign(st.archivo, { q: f.q.value, persona: f.persona.value, desde: f.desde.value, hasta: f.hasta.value, pagina: 0 }); buscarArchivo(); return; }
      if (f.classList.contains("com-form")) {
        e.preventDefault();
        const id = f.dataset.av, h = st.hilos[id], b = f.querySelector("[type=submit]"), err = f.querySelector(".err");
        err.textContent = ""; b.disabled = true; b.textContent = "Enviando…";
        try {
          await post(`agenda/${id}/comentar`, { texto: f.texto.value, foto: h.responderA ? null : h.foto || null, etiquetas: h.responderA ? [] : h.etq || [] });
          const eraRespuesta = !!h.responderA, etq = eraRespuesta ? [] : h.etq || [];
          if (eraRespuesta) terminarReplyAdmin(h);
          else { h.borrador = ""; h.foto = null; h.etq = []; }
          if (etq.length) { const it = st.items.find(x => x.id === id); if (it && it.para && !it.para.todos) it.para.personas = [...new Set([...(it.para.personas || []), ...etq])]; }
          const it = st.items.find(x => x.id === id); if (it) it.conv = { ...(it.conv || {}), n: ((it.conv && it.conv.n) || 0) + 1, nuevos: 0, actividad: new Date().toISOString() };
          await abrirHilo(id, true);
          const ta = $(`#com-${CSS.escape(id)}`); ta && ta.focus();
        } catch (er) { if (er.message !== "sesion") err.textContent = er.message; b.disabled = false; b.textContent = h.responderA ? "Responder" : "Comentar"; }
        return;
      }
      if (f.classList.contains("com-edit")) {
        e.preventDefault();
        const b = f.querySelector("[type=submit]"); b.disabled = true;
        try { await post(`agenda/${f.dataset.av}/comentarios/${f.dataset.cid}/editar`, { texto: f.texto.value }); st.editCom = null; toast("Comentario editado"); await abrirHilo(f.dataset.av, true); }
        catch (er) { if (er.message !== "sesion") f.querySelector(".err").textContent = er.message; b.disabled = false; }
      }
    });
  }
  setTimeout(conectarMuro, 0);

  // ---- Turno: turno activo, encargados de la tablet (cada dato se guarda por separado) y cortes ciegos ----
  // modo "curso": turno abierto en la tablet; modo "encargados": encargados de la tablet (sección Turnos)
  let modoTablet = "encargados";
  async function vistaTablet(modo) {
    if (modo) modoTablet = modo; else modo = modoTablet;
    // "curso" se ve en Caja; los encargados, en Configuración
    const c = modo === "curso" ? $("#t-cuerpo") : $("#cfg-tablet-c");
    if (!c) return;
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
    if (modo !== "curso") { const act = j.personas.filter(p => p.activo).length, sinPin = j.personas.filter(p => p.activo && !p.tiene_pin).length; EC.bloqueInfo("config", "tablet", { valor: act, texto: sinPin ? `${sinPin} sin PIN` : act === 1 ? "encargado activo" : "encargados activos" }); }
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
  // Al abrir Configuración: encargados, categorías y lugares
  document.addEventListener("modulo", e => { if (e.detail !== "config") return; vistaTablet("encargados"); if (st.hoy) pintarConfig(); else cargar(); });

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
      celdas += `<button class="d ${d.getUTCMonth() !== m - 1 ? "fuera" : ""} ${iso === st.hoy ? "hoy" : ""} ${iso === st.sel ? "sel" : ""}" type="button" data-dia="${iso}" aria-label="${esc(fLargo.format(d))}${nPend ? `, ${nPend} pendientes` : ""}${tipos.includes("pagado") ? ", con pagos hechos" : ""}">${d.getUTCDate()}<span class="pts">${tipos.map(t => `<i class="pt ${t}"></i>`).join("")}</span>${(() => { const v = its.filter(x => x.tipo !== "pagado").sort((x, y) => (x.hora || "99").localeCompare(y.hora || "99")); return v.length ? `<span class="d-evs">${v.slice(0, 3).map(x => `<span class="d-ev ${x.tipo}${abierto(x) ? "" : " hecho"}">${x.hora ? `<b>${esc(x.hora)}</b> ` : ""}${esc(x.titulo)}</span>`).join("")}${v.length > 3 ? `<span class="d-mas">+${v.length - 3} más</span>` : ""}</span>` : ""; })()}</button>`;
      if (i >= 34 && d.getUTCMonth() !== m - 1 && d.getUTCDay() === 0) break;
    }
    const delDia = st.items.filter(x => x.fecha === st.sel && x.tipo !== "aviso").sort((x, y) => (x.hora || "99").localeCompare(y.hora || "99"));
    const pagDia = (st.pagosHechos || []).filter(p => p.fecha === st.sel);
    const vistaTog = `<div class="seg ag-vista" role="tablist" aria-label="Vista del calendario"><button type="button" role="tab" data-ag-vista="mes" aria-selected="${st.vistaCal !== "agenda"}">Mes</button><button type="button" role="tab" data-ag-vista="agenda" aria-selected="${st.vistaCal === "agenda"}">Agenda</button></div>`;
    if (st.vistaCal === "agenda") return `<section class="card">${barraRapida("evento")}</section>${vistaTog}${vistaAgendaLista()}`;
    return `<section class="card">${barraRapida("evento")}</section>${vistaTog}<div class="ag-cal">
      <section class="card"><div class="cal-head"><h3>${esc(mayus(fMes.format(primero)))}</h3><div class="cal-nav"><button type="button" data-mes="-1" aria-label="Mes anterior">‹</button><button type="button" data-mes="hoy" aria-label="Hoy" style="width:auto;padding:0 12px;font-size:var(--t-sm)">Hoy</button><button type="button" data-mes="1" aria-label="Mes siguiente">›</button></div></div>
        <div class="cal">${celdas}</div>
        <div class="cal-ley"><span><i class="pt evento"></i>Eventos</span><span><i class="pt tarea"></i>Tareas con fecha</span><span><i class="pt incidencia"></i>Incidencias</span><span><i class="pt pago"></i>Pagos por hacer</span><span><i class="pt pagado"></i>Pagos hechos</span></div></section>
      <section class="card"><h3>${esc(mayus(fLargo.format(new Date(st.sel + "T12:00:00Z"))))}</h3>
        <div class="alist">${delDia.length || pagDia.length ? delDia.map(x => st.repro === x.id ? item(x).replace(/<\/div>\s*$/, menuRepro(x) + "</div>") : item(x)).join("") + pagDia.map(filaPagoHecho).join("") : `<p class="note">Nada programado este día.</p>`}</div>
        <details class="cl-mas"><summary>Agregar con todos los campos</summary>${formulario("evento", st.sel)}</details></section></div>`;
  }


  // ---- Agregar rápido con lenguaje natural (calendario y tareas) ----
  const fCh = new Intl.DateTimeFormat("es-MX", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
  const diaRel = f => { if (!f) return ""; const dd = Math.round((Date.parse(f + "T12:00:00Z") - Date.parse(st.hoy + "T12:00:00Z")) / 864e5); return dd === 0 ? "Hoy" : dd === 1 ? "Mañana" : dd === -1 ? "Ayer" : dd > 1 && dd < 7 ? mayus(new Intl.DateTimeFormat("es-MX", { weekday: "long", timeZone: "UTC" }).format(new Date(f + "T12:00:00Z"))) : fCh.format(new Date(f + "T12:00:00Z")); };
  function barraRapida(modo) {
    const ph = modo === "evento" ? "Agregar… ej. Técnico de la báscula mañana 9:30" : "Nueva tarea… ej. Pintar la caseta el lunes urgente";
    return `<form class="ag-rapida" data-modo="${modo}" autocomplete="off" novalidate><label class="sr" for="agr-${modo}">${modo === "evento" ? "Agregar al calendario" : "Nueva tarea"}</label>
      <input id="agr-${modo}" name="q" maxlength="200" placeholder="${ph}" enterkeyhint="done"><button class="btn btn-primary" type="submit">Agregar</button>
      <div class="agr-prev" aria-live="polite"><span class="agr-ayuda">Escribe la fecha y la hora como las dirías: «el viernes a las 5», «15 nov», «cada lunes», «urgente», «tablet turno tarde».</span></div></form>`;
  }
  function previaRapida(f) {
    const q = f.q.value, box = f.querySelector(".agr-prev");
    if (!q.trim()) { box.innerHTML = `<span class="agr-ayuda">Escribe la fecha y la hora como las dirías: «el viernes a las 5», «15 nov», «cada lunes», «urgente», «tablet turno tarde».</span>`; return; }
    const r = window.interpretarAgenda(q, st.hoy), modo = f.dataset.modo;
    const fecha = r.fecha || (modo === "evento" ? st.sel : null), tipo = modo === "evento" && !r.repetir && !r.para_turno ? "evento" : "tarea";
    const chips = [`<span class="agr-c tipo ${tipo}">${tipo === "evento" ? "Evento" : "Tarea"}</span>`, r.titulo ? `<span class="agr-c t">${esc(r.titulo)}</span>` : "",
      fecha ? `<span class="agr-c">${ico("i-cal")}${esc(diaRel(fecha))}${!r.fecha ? " (día elegido)" : ""}</span>` : `<span class="agr-c gris">Sin fecha</span>`,
      r.hora ? `<span class="agr-c">🕘 ${esc(r.hora)}</span>` : "", ...r.piezas.map(p => `<span class="agr-c ${p === "Urgente" ? "urg" : ""}">${esc(p)}</span>`)];
    box.innerHTML = chips.join("");
  }
  async function agregarRapido(f) {
    const r = window.interpretarAgenda(f.q.value, st.hoy), modo = f.dataset.modo;
    if (r.titulo.length < 2) throw new Error("Escribe qué hay que hacer.");
    const tipo = modo === "evento" && !r.repetir && !r.para_turno ? "evento" : "tarea";
    const fecha = r.fecha || (modo === "evento" ? st.sel : "");
    const datos = { tipo, titulo: r.titulo, fecha: fecha || "", hora: r.hora || "", prioridad: r.prioridad, aviso: r.aviso || (tipo === "evento" && r.hora ? 60 : "") || "", repetir: r.repetir || "", para_turno: r.para_turno ? 1 : "", turno: r.turno || "" };
    const j = await post("agenda", datos);
    toastAccion(`${tipo === "evento" ? "Evento" : "Tarea"} agregado: ${r.titulo}${fecha ? " · " + diaRel(fecha) : ""}${r.hora ? " " + r.hora : ""}`, "Deshacer", async () => { await post(`agenda/${j.id}/eliminar`); toast("Se quitó"); await cargar(); });
    if (fecha && tipo === "evento") { st.sel = fecha; st.mes = fecha.slice(0, 7); }
  }
  // Aviso con acción (Deshacer), como en las apps de iPhone
  function toastAccion(msg, etq, fn) {
    let t = $("#toast-acc");
    if (!t) { t = document.createElement("div"); t.id = "toast-acc"; t.setAttribute("role", "status"); document.body.appendChild(t); }
    t.innerHTML = `<span>${esc(msg)}</span><button type="button">${esc(etq)}</button>`;
    t.classList.add("on"); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("on"), 6000);
    t.querySelector("button").onclick = async () => { t.classList.remove("on"); try { await fn(); } catch (e) { if (e.message !== "sesion") toast(e.message); } };
  }

  // ---- Vista Agenda: lo atrasado y los próximos días en una lista (como la vista Lista de Fantastical) ----
  function vistaAgendaLista() {
    const hasta = (() => { const d = new Date(st.hoy + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + 45); return d.toISOString().slice(0, 10); })();
    const con = st.items.filter(x => x.fecha && ["evento", "tarea", "pago"].includes(x.tipo));
    const atr = con.filter(x => abierto(x) && x.fecha < st.hoy && x.tipo !== "evento").sort((a, b) => a.fecha.localeCompare(b.fecha));
    const prox = con.filter(x => x.fecha >= st.hoy && x.fecha <= hasta && (abierto(x) || x.tipo === "evento"));
    const dias = [...new Set(prox.map(x => x.fecha))].sort();
    const fila = it => `<div class="agl-it ${it.tipo} ${abierto(it) ? "" : "hecho"}"><span class="agl-h">${it.hora ? esc(it.hora) : it.tipo === "pago" ? "Vence" : "Todo el día"}</span><span class="agl-bar"></span>
      <span class="agl-t"><b>${esc(it.titulo)}</b><span>${{ evento: "Evento", tarea: it.para_turno ? "Tarea de la tablet" : "Tarea", pago: "Pago" + (it.importe != null ? " · " + MXN(it.importe) : "") }[it.tipo]}${it.prioridad === "alta" ? ` · <span class="urg">urgente</span>` : ""}${it.repetir ? " · 🔁" : ""}${it.fecha < st.hoy ? " · " + esc(diaRel(it.fecha)) : ""}</span></span>
      ${it.tipo === "pago" ? `<button class="btn btn-line btn-sm" type="button" data-pagar="${esc(it.id)}">Pagar</button>` : abierto(it) ? `<button class="chk" type="button" data-chk="${esc(it.id)}" data-fin="hecho" data-ini="${it.tipo === "evento" ? "programado" : "pendiente"}" aria-label="Marcar hecho: ${esc(it.titulo)}">${ico("i-check")}</button>` : `<span class="chk on">${ico("i-check")}</span>`}</div>`;
    const orden = l => l.sort((a, b) => (a.hora || "99").localeCompare(b.hora || "99"));
    return `<section class="card agl">${atr.length ? `<div class="agl-d atr"><h4>Atrasado <span>${atr.length}</span></h4>${atr.map(fila).join("")}</div>` : ""}
      ${dias.length ? dias.map(d => `<div class="agl-d ${d === st.hoy ? "hoy" : ""}"><h4>${esc(diaRel(d))}<span>${esc(mayus(fLargo.format(new Date(d + "T12:00:00Z"))))}</span></h4>${orden(prox.filter(x => x.fecha === d)).map(fila).join("")}</div>`).join("") : `<p class="note">No hay nada programado en las próximas semanas.</p>`}</section>`;
  }

  // ---- Tareas: agrupadas como en Things/Recordatorios (atrasadas, hoy, mañana, esta semana, después, sin fecha) ----
  function vistaTareas() {
    const todos = st.items.filter(x => x.tipo === "tarea"), ab = todos.filter(abierto), ce = todos.filter(x => !abierto(x));
    const dd = f => Math.round((Date.parse(f + "T12:00:00Z") - Date.parse(st.hoy + "T12:00:00Z")) / 864e5);
    const G = [["atr", "Atrasadas", x => x.fecha && dd(x.fecha) < 0], ["hoy", "Hoy", x => x.fecha && dd(x.fecha) === 0], ["man", "Mañana", x => x.fecha && dd(x.fecha) === 1],
      ["sem", "Próximos 7 días", x => x.fecha && dd(x.fecha) > 1 && dd(x.fecha) <= 7], ["des", "Más adelante", x => x.fecha && dd(x.fecha) > 7], ["sin", "Sin fecha", x => !x.fecha]];
    const orden = l => l.sort((a, b) => (b.prioridad === "alta") - (a.prioridad === "alta") || (a.fecha || "").localeCompare(b.fecha || "") || (a.hora || "99").localeCompare(b.hora || "99"));
    const conMenu = it => { let h = item(it); if (st.repro === it.id) h = h.replace(/<\/div>\s*$/, menuRepro(it) + "</div>"); return h; };
    return `<section class="card">${barraRapida("tarea")}<details class="cl-mas"><summary>Agregar con todos los campos (nota para el encargado, turno, recordatorio)</summary>${formulario("tarea")}</details></section>
      <section class="card tar">${ab.length ? G.map(([k, t, f]) => { const l = orden(ab.filter(f)); return l.length ? `<div class="tar-g ${k}"><h4>${t} <span>${l.length}</span></h4><div class="alist">${l.map(conMenu).join("")}</div></div>` : ""; }).join("") : `<p class="note">No hay nada por hacer. 🎉</p>`}
      ${ce.length ? `<details class="hechos"><summary>Hechas en los últimos 30 días (${ce.length})</summary><div class="alist">${ce.map(item).join("")}</div></details>` : ""}</section>`;
  }
  function menuRepro(it) {
    const d = n => { const x = new Date(st.hoy + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
    const lunes = d(((8 - new Date(st.hoy + "T12:00:00Z").getUTCDay()) % 7) || 7);
    const ops = [["Hoy", d(0)], ["Mañana", d(1)], ["El lunes", lunes], ["En una semana", d(7)], ...(it.tipo === "tarea" ? [["Sin fecha", ""]] : [])];
    return `<div class="repro" role="group" aria-label="Reprogramar ${esc(it.titulo)}">${ops.map(([t, v]) => `<button type="button" class="cl-chip" data-repro-a="${esc(it.id)}" data-f="${v}">${t}</button>`).join("")}<label class="repro-f">Otra fecha<input type="date" data-repro-f="${esc(it.id)}" value="${esc(it.fecha || "")}"></label></div>`;
  }
  // Eventos de la agenda rápida, la vista Agenda y reprogramar (una vez, por delegación)
  function conectarAgenda() {
    for (const id of ["ab-calendario", "ab-tarea"]) {
      const el = $("#" + id); if (!el || el._ag) continue; el._ag = true;
      el.addEventListener("input", e => { const f = e.target.closest("form.ag-rapida"); if (f) previaRapida(f); });
      el.addEventListener("submit", async e => {
        const f = e.target.closest("form.ag-rapida"); if (!f) return;
        e.preventDefault(); e.stopPropagation();
        const b = f.querySelector("[type=submit]"); b.disabled = true;
        try { await agregarRapido(f); f.q.value = ""; await cargar(); const n = $("#agr-" + f.dataset.modo); n && n.focus(); }
        catch (er) { if (er.message !== "sesion") toast(er.errores ? Object.values(er.errores).join(" ") : er.message); b.disabled = false; }
      }, true);
      el.addEventListener("click", async e => {
        const t = e.target.closest("button"); if (!t) return;
        if (t.dataset.agVista) { st.vistaCal = t.dataset.agVista; try { localStorage.setItem("ec-agenda-vista", st.vistaCal); } catch {} pintar(); return; }
        if (t.dataset.repro) { st.repro = st.repro === t.dataset.repro ? null : t.dataset.repro; pintar(); return; }
        if (t.dataset.reproA) await reprogramar(t.dataset.reproA, t.dataset.f);
      });
      el.addEventListener("change", e => { const i = e.target.closest("[data-repro-f]"); if (i && i.value) reprogramar(i.dataset.reproF, i.value); });
    }
  }
  async function reprogramar(id, fecha) {
    const it = st.items.find(x => x.id === id); if (!it) return;
    const antes = it.fecha || "";
    try {
      await post("agenda/" + id, { fecha: fecha || "" }); st.repro = null;
      toastAccion(fecha ? `Para ${diaRel(fecha).toLowerCase()}: ${it.titulo}` : `Sin fecha: ${it.titulo}`, "Deshacer", async () => { await post("agenda/" + id, { fecha: antes }); await cargar(); });
      await cargar();
    } catch (e) { if (e.message !== "sesion") toast(e.errores ? Object.values(e.errores).join(" ") : e.message); }
  }
  setTimeout(conectarAgenda, 0);
  // Al volver a la app, la agenda y Dinero se actualizan (por ejemplo, para ver quién ya dio «Enterado»)
  document.addEventListener("visibilitychange", () => {
    if (document.hidden || document.querySelector("dialog[open]") || (document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName))) return;
    const ag = $("#mod-agenda"), fi = $("#mod-finanzas");
    if ((ag && !ag.hidden) || (fi && !fi.hidden && !st.tienda)) cargar();
  });
  try { st.vistaCal = localStorage.getItem("ec-agenda-vista") || "mes"; } catch { st.vistaCal = "mes"; }
  // "N" abre el cuadro para agregar de la sección visible (como en las apps de escritorio)
  addEventListener("keydown", e => {
    if (e.key.toLowerCase() !== "n" || e.metaKey || e.ctrlKey || e.altKey || /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) || document.querySelector("dialog[open]")) return;
    const i = [...document.querySelectorAll(".ag-rapida input, #cl-q")].find(x => x.offsetParent); if (i) { e.preventDefault(); i.focus(); }
  });

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
    c.querySelectorAll("form.aform[data-tipo=incidencia], form.aform[data-tipo=aviso]").forEach(conectarFotos);
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
        const fila = b.closest(".aitem, .cl-it");
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
      try {
        await post("agenda/" + b.dataset.chk, { estado: on ? b.dataset.ini : b.dataset.fin });
        const it = st.items.find(x => x.id === b.dataset.chk);
        if (!on && it && it.repetir) toast(`Hecho: ${it.titulo} · se programó la siguiente`);
        else if (!on && it && ["tarea", "evento"].includes(it.tipo)) toastAccion(`Hecho: ${it.titulo}`, "Deshacer", async () => { await post("agenda/" + it.id, { estado: b.dataset.ini }); await cargar(); });
        await cargar();
      } catch (e) { if (e.message !== "sesion") toast(e.message); b.classList.toggle("on"); }
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
      try { await post(`agenda/${b.dataset.leer}/enterado`); toast("Enterado confirmado"); await cargar(); } catch (e) { if (e.message !== "sesion") toast(e.message); }
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
    c.querySelectorAll("select[data-cat]").forEach(sl => sl.addEventListener("change", async () => {
      sl.disabled = true;
      try { const r = await post("categorias", { nombre: sl.dataset.cat, icono: sl.value }); window.ponerCategorias(r.categorias); toast("Icono guardado"); pintar(); } catch (e) { if (e.message !== "sesion") toast(e.message); sl.disabled = false; }
    }));
    c.querySelectorAll("form[data-renombrar]").forEach(f => f.addEventListener("submit", async ev => {
      ev.preventDefault(); const b = f.querySelector("button"); b.disabled = true;
      try { const r = await post("categorias", { renombrar: f.dataset.renombrar, nombre: f.nombre.value }); window.ponerCategorias(r.categorias); toast("Nombre guardado"); pintar(); } catch (e) { if (e.message !== "sesion") toast(e.message); b.disabled = false; }
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

  // Abrir la agenda (o Pagos y compras) en una pestaña y con el formulario listo (desde el Inicio)
  window.agendaDia = dia => { st.sel = dia; st.mes = dia.slice(0, 7); if (st.hoy) pintar(); if (window.irA) window.irA("agenda", { historia: "push", vista: "calendario" }); };
  // Bloque de cada tipo: los de pagos y compras viven en Dinero
  const BLOQUE_DE = { pago: ["finanzas", "programados", "pg-prog"], compra: ["finanzas", "compras", "pg-comp"], hechos: ["finanzas", "hechos", "pg-hechos"],
    calendario: ["agenda", "calendario", "ab-calendario"], tarea: ["agenda", "tarea", "ab-tarea"], incidencia: ["agenda", "incidencia", "ab-incidencia"], aviso: ["agenda", "aviso", "ab-aviso"] };
  window.agendaAbrir = async (tab, accion) => {
    const [mod, clave, cont] = BLOQUE_DE[tab] || BLOQUE_DE.calendario;
    if (window.irA) window.irA(mod, { historia: "push", vista: clave });
    if (accion && !st.hoy) await cargar();
    setTimeout(() => {
      if (accion === "programar") return ventanaProgramar();
      if (accion === "hecho") return ventanaPago("hecho");
      if (!accion) return;
      const n = $(`#${cont} form.aform input[name=titulo]`); n && n.focus({ preventScroll: true });
    }, 300);
  };
  document.addEventListener("modulo", e => { if (e.detail === "agenda" || e.detail === "finanzas") cargar(); });
  document.addEventListener("recargar-todo", () => { if (!$("#mod-agenda").hidden || !$("#mod-finanzas").hidden) cargar(); });
  if (["agenda", "finanzas"].includes(EC.ruta().mod)) cargar();

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
