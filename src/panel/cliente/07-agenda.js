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
      // La primera pantalla del muro llega sin esperar pagos/compras ni los 1000
      // registros generales. Se conserva la consulta general para el resto de Agenda.
      const esMuro = EC.ruta().mod === "agenda" && EC.ruta().vista === "aviso";
      const feedP = esMuro ? api("agenda/avisos-feed").then(async f => {
        if (!st.personas) try { st.personas = (await api("turno")).personas; } catch { st.personas = []; }
        if (!st.hoy) st.hoy = EC.hoyMx();
        if (!st.archivo && !document.activeElement?.closest("form")) {
          st.items = [...st.items.filter(x => x.tipo !== "aviso"), ...f.items];
          st.castaCursor = f.cursor; st.castaMas = f.mas;
          pintarAvisos();
        }
        return f;
      }).catch(()=>null) : Promise.resolve(null);
      const j = await api("agenda"), feed = await feedP;
      st.items = feed ? [...j.items.filter(x => x.tipo !== "aviso"), ...feed.items] : j.items;
      st.hoy = j.hoy; st.pagosHechos = j.pagos_hechos || [];
      const castaOrden = st.items.filter(x => x.tipo === "aviso" && abierto(x)).sort((a,b)=>String(b.creado).localeCompare(String(a.creado)));
      const castaUltimo = castaOrden[castaOrden.length-1];
      st.castaCursor = feed ? feed.cursor : castaUltimo ? castaUltimo.creado+"|"+castaUltimo.id : "";
      st.castaMas = feed ? feed.mas : true;
      st.mesesAbiertos = j.meses_abiertos || [];
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
    // Agenda incluye la lista de compras pendientes; Dinero conserva programados y pagos hechos.
    const B = { "ab-calendario": vistaCalendario, "ab-tarea": vistaTareas, "ab-incidencia": () => vistaLista("incidencia"), "ab-aviso": vistaAvisos,
      "pg-prog": vistaProgramados, "pg-comp": vistaCompras, "pg-hechos": vistaHechos };
    for (const [id, f] of Object.entries(B)) { const el = $("#" + id); if (el) { if(id==="ab-aviso") pintarAvisos(); else {el.innerHTML = f(); conectar(el);} } }
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
  // Pagos administrativos: mismo estado, mismos UID y rutas de Agenda.
  const { listaPagosHechos, ventanaPago, ventanaProgramar } = window.CastaPagosControlador({
    st, ico, esc, MXN, diaTxt, mayus, fMes, post, cargar, toast
  });

  window.agendaPagarObligacion = async o => { if(!st.hoy)await cargar(); ventanaPago("obligacion",o); };

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

  // Controlador de Compras: comparte el estado y servicios de Agenda.
  const { vistaCompras, conectarCompras } = window.CastaComprasControlador({
    st, abierto, esc, ico, formEditar, avP: (...a) => avP(...a), selLugar,
    MXN, post, toast, cargar, pintar, formulario, $
  });
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
        <div class="k"><span>Pagos previstos este mes · estimado</span><b>${MXN(sum(porPagar, x => x.importe))}</b><small>${porPagar.length} ${porPagar.length === 1 ? "pago" : "pagos"}${vencidos.length ? ` · <span style="color:#ff6961">${vencidos.length} ${vencidos.length === 1 ? "vencido" : "vencidos"}</span>` : ""}</small></div>
        <div class="k dest"><span>Pagado este mes</span><b>${MXN(sum(hechosMes, p => p.importe))}</b><small>${hechosMes.length} ${hechosMes.length === 1 ? "registro" : "registros"}</small></div>
        <div class="k"><span>Compras del mes</span><b>${MXN(sum(compradasMes, x => x.importe))}</b><small>${compras.filter(abierto).length} por comprar</small></div>
      </div><details class="f-guia-saldos" style="margin-top:12px"><summary>¿De dónde salen estos pagos?</summary>
      <p class="note" data-nl="1">Los pagos programados son previsiones aproximadas, no deudas confirmadas. Solo cuando se realiza un pago se registra como egreso administrativo en Dinero; no afecta la caja de ningún turno.</p></details></section>`;
    return resumen;
  }
  function vistaProgramados() { return resumenPagos() + vistaLista("pago"); }
  function vistaHechos() {
    return `<section class="card"><div class="pago-acc"><button class="btn btn-primary" type="button" data-nuevo-pago="hecho">${ico("i-billete")}Registrar un pago o gasto ya hecho</button></div>
        <details class="f-guia-saldos" style="margin-top:12px"><summary>¿Qué pagos se registran aquí?</summary>
          <p class="note" data-nl="1">Registra gastos ya realizados que no estaban programados: recibos, refacciones, gasolina o comidas. Puedes adjuntar foto o PDF como comprobante opcional.</p></details></section>
      <section class="card">${listaPagosHechos()}</section>`;
  }
  // Contadores de cada bloque (en su título y en el submenú)
  function contadores() {
    const N = t => st.items.filter(x => x.tipo === t && abierto(x));
    const tareas = N("tarea"), inc = N("incidencia"), pagos = N("pago"), compras = N("compra").filter(x => !x.pospuesta);
    EC.bloqueN("agenda", "tarea", tareas.length, tareas.some(x => x.fecha && x.fecha < st.hoy));
    EC.bloqueN("agenda", "incidencia", inc.length, inc.some(x => x.gravedad === "grave"));
    EC.bloqueN("agenda", "aviso", Number.isFinite(st.avisosSinLeer) ? st.avisosSinLeer : N("aviso").length, !!st.avisosSinLeer);
    EC.bloqueN("finanzas", "movimientos", pagos.length + (st.pagosHechos || []).filter(p => p.fecha.slice(0,7) === (st.hoy||"").slice(0,7)).length, pagos.some(x => x.fecha && x.fecha < st.hoy));
    EC.bloqueN("agenda", "compras", compras.length, compras.some(x => x.prioridad === "alta"));
    const mes = (st.hoy || "").slice(0, 7);
    const hechos = (st.pagosHechos || []).filter(p => p.fecha.slice(0, 7) === mes);
    // Los dos tipos de pago comparten una sola sección de movimientos.
    // Línea de estado de cada tarjeta del índice (celular y tablet)
    const pl = (n, a, b) => `${n} ${n === 1 ? a : b}`;
    // Cantidades enteras compactas; los importes con centavos NUNCA se redondean.
    const D0 = v => EC.dinero(v, Math.round(Math.abs(Number(v) || 0) * 100) % 100 ? 2 : 0);
    const evHoy = st.items.filter(x => x.tipo === "evento" && x.fecha === st.hoy).length;
    const venc = tareas.filter(x => x.fecha && x.fecha < st.hoy).length;
    const graves = inc.filter(x => x.gravedad === "grave").length;
    EC.bloqueInfo("agenda", "calendario", { valor: evHoy, texto: evHoy ? pl(evHoy, "evento hoy", "eventos hoy") : "Nada programado hoy" });
    EC.bloqueInfo("agenda", "tarea", { texto: !tareas.length ? "Nada pendiente" : venc ? pl(venc, "vencida", "vencidas") : "Al día" });
    EC.bloqueInfo("agenda", "incidencia", { texto: !inc.length ? "Ninguna abierta" : graves ? pl(graves, "grave", "graves") : "Ninguna grave" });
    EC.bloqueInfo("agenda", "aviso", { texto: st.avisosSinLeer ? st.avisosSinLeer+" novedades o Enterados pendientes" : N("aviso").length ? "Sin novedades pendientes" : "Sin publicaciones activas" });
    const finMes = mes ? new Date(Date.UTC(+mes.slice(0, 4), +mes.slice(5, 7), 0)).toISOString().slice(0, 10) : "";
    const vPag = pagos.filter(x => x.fecha && x.fecha < st.hoy).length, porPagar = pagos.filter(x => x.fecha && x.fecha <= finMes).reduce((a, x) => a + (Number(x.importe) || 0), 0);
    EC.bloqueInfo("finanzas", "movimientos", { valor: D0(hechos.reduce((a, p) => a + p.importe, 0)), texto: (vPag ? pl(vPag, "programado vencido", "programados vencidos") + " · " : "") + D0(porPagar) + " previstos este mes (estimado)" });
    const urgC = compras.filter(x => x.prioridad === "alta").length, lugs = new Set(compras.map(x => x.lugar || "sin")).size;
    EC.bloqueInfo("agenda", "compras", { texto: !compras.length ? "Nada por comprar" : (urgC ? pl(urgC, "urgente", "urgentes") + " · " : "") + "en " + pl(lugs, "lugar", "lugares") });

  }

  // CASTAGRAM conserva un solo estado compartido y rutas existentes.
  const { pintarAvisos, vistaAvisos } = window.CastaCastagramControlador({
    st, $, esc, toast, api, post, ico, abierto, formEditar, fotosDe,
    urlFoto, comprimirFoto, cuando, cargar, pintar, conectar, foto, diaTxt, contadores
  });

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

  // Calendario, tareas y acciones rápidas: misma API pública de Agenda.
  const { vistaCalendario, vistaTareas, toastAccion } = window.CastaCalendarioControlador({
    st, $, esc, toast, post, fLargo, fMes, mayus, ico, abierto, cargar, pintar, formulario, item, MXN
  });

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
      if(f.dataset.tipo==="aviso")datos.uid = f._castaUid || (f._castaUid=crypto.randomUUID());
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
      if (b.disabled) return;
      const p = (st.pagosHechos || []).find(x => x.id === b.dataset.borrarPago);
      if (!p) return;
      b.disabled = true;
      try {
        if (!(await EC.confirmar(`¿Eliminar el pago de «${p.titulo || "Pago"}»?`,
          `Del ${diaTxt(p.fecha)} por ${MXN(p.importe)}. También se quita de Dinero${p.comprobante ? " y se borra su comprobante" : ""}.`,
          "Eliminar", true))) return;
        const res = await post(`agenda/pagos/${p.id}/eliminar`);
        toast(res.regreso ? `Pago eliminado; el programado vuelve a vencer el ${diaTxt(res.regreso)}` : "Pago eliminado");
        await cargar();
      } catch (e) {
        if (e.message !== "sesion") {
          toast(e.message);
          if (/otra sesión|cambió|ya no existe/.test(e.message)) await cargar();
        }
      } finally { if (b.isConnected) b.disabled = false; }
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
  // Bloque de cada tipo: compras por hacer en Agenda, pagos registrados en Dinero
  const BLOQUE_DE = { pago: ["finanzas", "movimientos", "pg-prog"], compra: ["agenda", "compras", "pg-comp"], hechos: ["finanzas", "movimientos", "pg-hechos"],
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
    if (document.body?.dataset.panelFinanciero !== "1") $("#recargar").click(); // facturación (solo panel completo)
    document.dispatchEvent(new CustomEvent("recargar-todo")); // ingresos, personal, agenda
    const m = ["inicio"].find(x => !$("#mod-" + x).hidden);
    if (m) document.dispatchEvent(new CustomEvent("modulo", { detail: m }));
    setTimeout(() => { b.disabled = false; b.classList.remove("girando"); }, 600);
    if (error && error.message !== "sesion") toast("Hoja de ingresos: " + error.message); else if (!error) toast("Todo sincronizado");
  });
})();
