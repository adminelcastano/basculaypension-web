// Calendario y tareas de Agenda. Reutiliza el estado único, sin caché paralelo.
window.CastaCalendarioControlador = function crearCalendario(dependencias) {
  const { st, $, esc, toast, post, fLargo, fMes, mayus, ico, abierto, cargar, pintar, formulario, item, MXN, filaPagoHecho } = dependencias;
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
  return { vistaCalendario, vistaTareas, toastAccion };
};
