// CASTAGRAM: controlador del feed administrativo. Comparte el estado de Agenda;
// no crea cachés paralelas y conserva las llamadas HTTP y eventos existentes.
window.CastaCastagramControlador = function crearCastagram(dependencias) {
  const { st, $, esc, toast, api, post, ico, abierto, formEditar, fotosDe, urlFoto, comprimirFoto, cuando, cargar, pintar, conectar, foto, diaTxt, contadores } = dependencias;
  // ---- Avisos: muro de publicaciones con conversación ----
  // Cada aviso es una publicación: quien publica etiqueta a los destinatarios y todos comentan debajo
  // hasta que la administración la archiva. Solo la administración edita o borra comentarios.
  const T_AV = { "MAÑANA": "mañana", "TARDE": "tarde", "NOCHE": "noche" };
  const encargados = () => (st.personas || []).filter(p => p.activo);
  const perfilMencion = p => p.perfil || p.nombre || p.clave;
  document.addEventListener("perfil-admin-actualizado", () => {
    if ($("#ab-aviso") && st.items.length) pintarAvisos();
  });
  const nomDe = k => k === "admin" ? (EC.nombreAdmin?.() || "Administración") : (perfilMencion((st.personas || []).find(p => p.clave === k) || {clave:k}));
  const avatarMencion = p => p.avatar_url || "/panel/api/turno/avatar/c/" + encodeURIComponent(p.clave);
  const tarjetaMencion = p => `<span class="casta-mention" title="@${esc(p.clave)}"><img src="${esc(avatarMencion(p))}" alt="" width="22" height="22" loading="lazy"><b>@${esc(perfilMencion(p))}</b></span>`;
  const etqPara = p => [p.admin ? (EC.nombreAdmin?.() || "Administración") : "", p.todos ? "Todos" : "", ...(p.turnos || []).map(t => "Turno " + T_AV[t]), ...(p.personas || [])].filter(Boolean);
  const etqParaHtml = p => etqPara(p).map(t => {
    const persona = (st.personas || []).find(x => x.clave === t);
    return `<span class="etq-p">${persona ? tarjetaMencion(persona) : "@" + esc(t)}</span>`;
  }).join("");
  const conMenciones = t => esc(t).replace(/@([A-Za-zÑñ0-9_]{2,12})/g, (m,k) => {
    const p = (st.personas || []).find(x => x.clave === k.toUpperCase());
    return p ? tarjetaMencion(p) : m;
  });
  // Autocompletado local: los identificadores en D1 permanecen @CLAVE.
  const buscarMencion = (ta, personas) => {
    const posicion = ta.selectionStart, antes = ta.value.slice(0, posicion);
    const m = /@([A-Za-zÑñÁÉÍÓÚÜáéíóúü0-9_]{0,24})$/.exec(antes);
    if (!m || (m.index > 0 && !/[\s([{]/.test(antes[m.index - 1]))) return null;
    const normal = v => String(v || "").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
    const busqueda = normal(m[1]);
    return { inicio: m.index, fin: posicion, personas: personas.filter(p => normal(perfilMencion(p)).includes(busqueda) || normal(p.clave).includes(busqueda)).slice(0,12) };
  };
  function actualizarMenciones(form) {
    const ta = form.querySelector('textarea[name="texto"]'), caja = form.querySelector("[data-mention-list]"), seleccion = form.querySelector("[data-mention-selected]");
    if (!ta || !caja) return;
    const actual = buscarMencion(ta, encargados());
    caja.hidden = !actual || !actual.personas.length;
    ta.setAttribute("aria-expanded", String(!caja.hidden));
    caja.innerHTML = actual ? actual.personas.map((p,i) => `<button type="button" role="option" aria-selected="${i === 0}" data-mention-pick="${esc(p.clave)}">${tarjetaMencion(p)}<small>${esc(p.clave)}</small></button>`).join("") : "";
    if (seleccion) {
      const claves = [...ta.value.matchAll(/@([A-Za-zÑñ0-9_]{2,12})/g)].map(m => m[1].toUpperCase());
      const elegidos = (st.personas || []).filter(p => claves.includes(p.clave));
      seleccion.innerHTML = elegidos.map(tarjetaMencion).join("");
      seleccion.hidden = !elegidos.length;
    }
  }
  function elegirMencion(form, clave) {
    const ta = form.querySelector('textarea[name="texto"]'), p = encargados().find(x => x.clave === clave);
    if (!ta || !p) return;
    const actual = buscarMencion(ta, encargados());
    if (!actual) return;
    ta.setRangeText("@" + p.clave + " ", actual.inicio, actual.fin, "end");
    ta.dispatchEvent(new Event("input", { bubbles:true }));
    ta.focus({ preventScroll:true });
  }
  function teclaMencion(e) {
    const ta = e.target.closest("form.com-form textarea"), form = ta && ta.closest("form");
    const caja = form && form.querySelector("[data-mention-list]");
    if (!caja || caja.hidden || e.isComposing || e.keyCode === 229) return;
    const opciones = [...caja.querySelectorAll("[data-mention-pick]")];
    if (e.key === "Escape") { e.preventDefault(); caja.hidden = true; ta.setAttribute("aria-expanded", "false"); return; }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      let i = opciones.findIndex(b => b.getAttribute("aria-selected") === "true");
      i = (i + (e.key === "ArrowDown" ? 1 : -1) + opciones.length) % opciones.length;
      opciones.forEach((b,j) => b.setAttribute("aria-selected", String(i === j)));
    } else if (e.key === "Enter" && opciones.length) {
      e.preventDefault();
      elegirMencion(form, (opciones.find(b => b.getAttribute("aria-selected") === "true") || opciones[0]).dataset.mentionPick);
    }
  }
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
  // Actualiza solo el post y su diálogo: no tocar otras tarjetas ni sus scrolls.
  function repintarPostAdmin(id){
    if(st.archivo || castaVisor?.open){return;}
    const root=$("#ab-aviso"),it=st.items.find(x=>x.id===id);
    if(!root||!it)return;
    const post=root.querySelector('[data-post="'+CSS.escape(id)+'"]');
    if(post&&st.editando!==id)post.outerHTML=postHtml(it);
    const dlg=root.querySelector('dialog.casta-sheet[open]');
    if(dlg?.dataset.av===id){const hilo=dlg.querySelector(".hilo");if(hilo)hilo.outerHTML=hiloHtml(it);}
    const anterior=root.querySelector("details.casta-actividad");
    if(anterior){const abrir=anterior.open;anterior.outerHTML=castaActividadVistaAdmin();const nuevo=root.querySelector("details.casta-actividad");if(nuevo)nuevo.open=abrir;}
    castaRestaurar(root);
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
    dlg.addEventListener("close", () => { st.abiertosAv.delete(id); st.editCom = null; el.querySelectorAll('[data-hilo]').forEach(x => { if (x.dataset.hilo === id) x.setAttribute("aria-expanded", "false"); }); const volver=el.querySelector(`[data-post="${CSS.escape(id)}"] [data-hilo]`); if(volver)volver.focus({preventScroll:true}); });
    dlg.addEventListener("click", e => { if (e.target === dlg) castaHojaCerrar(dlg); });
    el.append(dlg);
    dlg.showModal();
    history.pushState({...history.state,casta_layer:"comentarios"},"",location.href);
    dlg.addEventListener("cancel",e=>{e.preventDefault();castaHojaCerrar(dlg);});
  }

  function comentarioHtml(it, c, admin = true, editable = true) {
    if (st.editCom === c.id) return `<form class="com-edit" data-av="${esc(it.id)}" data-cid="${esc(c.id)}"><label class="sr">Editar comentario<textarea name="texto" rows="2" maxlength="1000">${esc(c.texto)}</textarea></label>
      <div class="com-acc"><button class="btn btn-primary" type="submit">Guardar</button><button class="btn btn-line" type="button" data-com-cancelar>Cancelar</button></div><span class="err" role="alert"></span></form>`;
    return `<div class="com ${c.borrado ? "borrado" : ""}">${avP(c.autor === "admin" ? "admin" : c.autor)}<div class="com-b">
      <div class="com-burb"><b>${esc(nomDe(c.autor))}</b>${c.borrado ? `<p class="com-t">Comentario borrado${admin && c.texto ? `: <s>${parrafos(c.texto)}</s>` : ""}</p>` : `${c.texto ? `<p class="com-t">${parrafos(c.texto)}</p>` : ""}`}
        ${!c.borrado && c.foto ? `<button type="button" class="com-foto casta-foto-abrir" data-casta-foto-url="${esc(urlFoto(c.foto))}" aria-label="Ampliar foto del comentario de ${esc(nomDe(c.autor))}"><img src="${urlFoto(c.foto)}" alt="Foto del comentario de ${esc(nomDe(c.autor))}" loading="lazy" decoding="async"></button>` : ""}</div>
      <div class="com-m"><span>${esc(cuando(c.creado))}</span>${!c.borrado ? `<button type="button" class="casta-com-enterado ${c.mi_enterado ? "is-enterado" : ""}" data-com-enterado="${esc(c.id)}" data-av="${esc(it.id)}" aria-label="${c.mi_enterado ? "Quitar Me gusta" : "Me gusta"}" title="${c.mi_enterado ? "Quitar Me gusta" : "Me gusta"}" aria-pressed="${!!c.mi_enterado}" ${!editable ? "disabled" : ""}><svg class="casta-like-corazon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78Z"/></svg></button><small class="casta-like-cuenta" aria-label="${Number(c.enterados)||0} Me gusta" ${Number(c.enterados) ? "" : "hidden"}>${Number(c.enterados)||0}</small>` : ""}${editable && !c.borrado && c.autor !== "admin" ? `<button type="button" class="lnk" data-responder="${esc(c.autor)}">Responder</button>` : ""}${c.editado && !c.borrado ? "<span>Editado</span>" : ""}${(c.etiquetas || []).length ? `<span>Etiquetó a ${c.etiquetas.map(k => conMenciones("@" + k)).join(", ")}</span>` : ""}
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
        ${h.responderA ? `<div class="casta-reply"><span>Respondiendo a ${conMenciones("@" + h.responderA)}</span><button type="button" data-reply-cancel aria-label="Cancelar respuesta">×</button></div>` : ""}
        <div class="casta-emoji-bar" aria-label="Emojis rápidos"><button type="button" data-com-emoji="😅" aria-label="Insertar emoji 😅">😅</button><button type="button" data-com-emoji="😡" aria-label="Insertar emoji 😡">😡</button><button type="button" data-com-emoji="💩" aria-label="Insertar emoji 💩">💩</button><button type="button" data-com-emoji="👽" aria-label="Insertar emoji 👽">👽</button><button type="button" data-com-emoji="🙊" aria-label="Insertar emoji 🙊">🙊</button><button type="button" data-com-emoji="🙉" aria-label="Insertar emoji 🙉">🙉</button><button type="button" data-com-emoji="🙈" aria-label="Insertar emoji 🙈">🙈</button><button type="button" data-com-emoji="❤️" aria-label="Insertar emoji ❤️">❤️</button><button type="button" data-com-emoji="🔥" aria-label="Insertar emoji 🔥">🔥</button></div>
        <label class="sr" for="com-${esc(it.id)}">Escribe un comentario</label>
        <textarea id="com-${esc(it.id)}" name="texto" rows="2" maxlength="1000" aria-autocomplete="list" aria-controls="casta-men-${esc(it.id)}" aria-expanded="false" placeholder="Escribe un comentario… usa @ para etiquetar">${esc(h.borrador || "")}</textarea>
         <div class="casta-mention-list" id="casta-men-${esc(it.id)}" role="listbox" aria-label="Elegir encargado para etiquetar" data-mention-list hidden></div><div class="casta-mention-selected" aria-label="Personas etiquetadas" data-mention-selected hidden></div>
        ${!h.responderA && fuera.length ? `<div class="com-etq"><span>Etiquetar a alguien más</span>${fuera.map(x => `<button type="button" class="pchip casta-chip-perfil ${sel.includes(x.clave) ? "on" : ""}" data-etq="${esc(x.clave)}" aria-pressed="${sel.includes(x.clave)}">${tarjetaMencion(x)}</button>`).join("")}</div>` : ""}
        ${!h.responderA && h.foto ? `<span class="inc-th"><img src="${h.foto}" alt="Foto para el comentario"><button type="button" data-com-sinfoto aria-label="Quitar la foto">×</button></span>` : ""}
        <div class="com-acc">${!h.responderA ? `<label class="btn btn-line"><input type="file" accept="image/*" data-com-foto hidden>Foto</label>` : ""}<button class="btn btn-primary" type="submit">${h.responderA ? "Responder" : "Comentar"}</button></div>
        <span class="err" role="alert"></span></div></form>` : `<p class="note">Archivado: ya no se puede comentar.</p>`}</div></div>`;
  }


  // Carrusel de fotografías solo en Castagram; las claves y rutas de fotos siguen intactas.
  const castaFotoActual = new Map();
  function castaFotos(fotos, id) {
    if (!Array.isArray(fotos) || !fotos.length) return "";
    const foto = (k, i) => `<button type="button" class="casta-foto-abrir" data-casta-foto-url="${esc(urlFoto(k))}" aria-label="Abrir foto ${i + 1} de ${fotos.length}"><img src="${urlFoto(k)}" alt="Foto ${i + 1} de ${fotos.length} de Castagram" loading="lazy" decoding="async"></button>`;
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


  // Visor protegido que no sale del post al abrir una fotografía.
  let castaVisor=null,castaFoco=null,castaUrls=[],castaIndex=0;
  function castaFotoMover(paso){const n=castaIndex+paso;if(!castaVisor?.open||n<0||n>=castaUrls.length)return;castaIndex=n;castaFotoPintar();}
  function castaFotoPintar(){
    if(!castaVisor?.open)return;
    const img=castaVisor.querySelector("img"),estado=castaVisor.querySelector(".casta-visor-estado"),url=castaUrls[castaIndex];
    estado.hidden=false;estado.textContent="Cargando fotografía…";img.style.visibility="hidden";
    img.onload=()=>{if(castaVisor?.open&&img.getAttribute("src")===url){img.style.visibility="visible";estado.hidden=true;}};
    img.onerror=()=>{if(castaVisor?.open&&img.getAttribute("src")===url)estado.textContent="No se pudo abrir esta fotografía.";};
    img.alt="Foto "+(castaIndex+1)+" de "+castaUrls.length;img.src=url;
    castaVisor.querySelector(".casta-visor-n").textContent=(castaIndex+1)+" / "+castaUrls.length;
    for(const p of [-1,1])castaVisor.querySelector('[data-visor-paso="'+p+'"]').disabled=castaIndex+p<0||castaIndex+p>=castaUrls.length;
  }
  function castaFotoCerrar(pop=false){if(!castaVisor?.open)return;if(!pop&&history.state?.casta_layer==="foto"){history.back();return;}const d=castaVisor;castaVisor=null;d.close();d.remove();castaUrls=[];if(castaFoco?.isConnected)castaFoco.focus({preventScroll:true});castaFoco=null;}
  function castaFotoAbrir(b){
    if(castaVisor?.open)return;
    const g=b.closest(".casta-carrusel,.post-fotos"),lista=g?[...g.querySelectorAll("[data-casta-foto-url]")]:[b];
    castaUrls=lista.map(x=>x.dataset.castaFotoUrl).filter(u=>u?.startsWith("/panel/api/turno/foto/"));
    castaIndex=lista.indexOf(b);if(!castaUrls.length||castaIndex<0)return;castaFoco=b;
    const d=document.createElement("dialog");d.className="casta-visor";d.setAttribute("aria-label","Fotografías de Castagram");
    d.innerHTML='<div class="casta-visor-panel"><header><button type="button" data-visor-cerrar aria-label="Cerrar fotografía">×</button><strong class="casta-visor-n" aria-live="polite"></strong></header><div class="casta-visor-centro"><button type="button" data-visor-paso="-1" aria-label="Fotografía anterior">‹</button><img alt="" decoding="async"><span class="casta-visor-estado" role="status">Cargando fotografía…</span><button type="button" data-visor-paso="1" aria-label="Fotografía siguiente">›</button></div></div>';
    d.addEventListener("click",e=>{if(e.target===d||e.target.closest("[data-visor-cerrar]"))castaFotoCerrar();else{const z=e.target.closest("[data-visor-paso]");if(z)castaFotoMover(+z.dataset.visorPaso);}});
    d.addEventListener("cancel",e=>{e.preventDefault();castaFotoCerrar();});
    let touch=null;d.addEventListener("touchstart",e=>{if(e.touches.length===1)touch=[e.touches[0].clientX,e.touches[0].clientY];},{passive:true});
    d.addEventListener("touchend",e=>{if(touch&&e.changedTouches.length){const dx=e.changedTouches[0].clientX-touch[0],dy=e.changedTouches[0].clientY-touch[1];if(Math.abs(dx)>60&&Math.abs(dx)>1.5*Math.abs(dy))castaFotoMover(dx<0?1:-1);}touch=null;},{passive:true});
    document.body.append(d);castaVisor=d;d.showModal();castaFotoPintar();
    history.pushState({...history.state,casta_layer:"foto"},"",location.href);
  }
  function castaHojaCerrar(d){if(history.state?.casta_layer==="comentarios")history.back();else d?.close();}
  function castaRegreso(){
    if(castaVisor?.open&&history.state?.casta_layer!=="foto"){castaFotoCerrar(true);return;}
    const d=document.querySelector("#ab-aviso dialog.casta-sheet[open]");
    if(d&&history.state?.casta_layer!=="comentarios"&&history.state?.casta_layer!=="foto"){d.close();return;}
    if(st.archivo?.sel&&history.state?.casta_layer!=="archivo-detalle"){st.archivo.sel=null;st.archivo.det=null;pintarAvisos();return;}
    if(st.archivo&&history.state?.casta_layer!=="archivo"){st.archivo=null;pintarAvisos();}
  }

  function postHtml(it) {
    if (st.editando === it.id) return `<article class="post">${formEditar(it)}</article>`;
    const deEnc = it.autor !== "admin", p = it.para || {}, cv = it.conv || { n: 0, nuevos: 0, nuevosEnterado: 0 };
    const leidoAdmin = (it.lecturas || []).some(l => l.persona === "ADMIN");
    const pendienteEnterado = deEnc && p.admin && abierto(it) && !leidoAdmin;
    const nuevo = pendienteEnterado && !it.visto_admin;
    const lec = new Map((it.lecturas || []).map(x => [x.persona, x.at]));
    // Un destinatario por turno no significa que todos los encargados activos estén asignados.
    const dest = p.todos ? encargados() : encargados().filter(x => (p.personas || []).includes(x.clave) || lec.has(x.clave));
    const vistos = dest.filter(x => x.clave !== it.autor && lec.has(x.clave)), faltan = dest.filter(x => x.clave !== it.autor && !lec.has(x.clave));
    const abiertoHilo = st.abiertosAv.has(it.id);
    const comentarIcono = "<svg class=\"casta-comentar-ico\" viewBox=\"0 0 24 24\" width=\"24\" height=\"24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"M5 3.5h14a2.5 2.5 0 0 1 2.5 2.5v10a2.5 2.5 0 0 1-2.5 2.5H9l-6.5 4V6A2.5 2.5 0 0 1 5 3.5Z\"/><path d=\"M7.5 9H17M7.5 13H15\"/></svg>";
    const pulgar = `<img class="casta-pulgar-ico" src="/img/castagram-pulgar.png" alt="" aria-hidden="true" width="26" height="26">`;
    const cantidadEnterados = vistos.length + (deEnc && p.admin && leidoAdmin ? 1 : 0);
    return `<article class="post ${nuevo || cv.nuevos || cv.nuevosEnterado ? "nuevo" : ""} ${abierto(it) ? "" : "hecho"}" data-post="${esc(it.id)}">
      <header class="post-h">${avP(deEnc ? it.autor : "admin", 1)}<div class="post-q"><b>${esc(nomDe(it.autor))}</b><span>${esc(cuando(it.creado))}${it.fecha && it.fecha > st.hoy ? ` · se muestra desde ${esc(diaTxt(it.fecha))}` : ""}</span></div>
        ${it.prioridad === "alta" ? `<span class="tag alta">Importante</span>` : ""}</header>
      <p class="post-para">Para ${etqParaHtml(p)}${deEnc && p.admin ? `<span class="etq-p">${leidoAdmin ? "✓ Enterado" : it.visto_admin ? "Visto · Enterado pendiente" : "Sin Enterado"}</span>` : ""}</p>
      <h4 class="post-t">${esc(it.titulo)}</h4>${it.detalle ? `<p class="post-d">${parrafos(it.detalle)}</p>` : ""}
      ${castaFotos(fotosDe(it),it.id)}
      <div class="post-st"><div class="casta-acciones">${pendienteEnterado ? `<button type="button" class="casta-pulgar casta-pulgar-boton" data-leer="${esc(it.id)}" aria-label="Confirmar mi Enterado. ${cantidadEnterados} confirmaciones registradas" title="Confirmar mi Enterado">${pulgar}<small>${cantidadEnterados}</small></button>` : `<span class="casta-pulgar ${cantidadEnterados ? "is-enterado" : ""}" role="img" aria-label="${cantidadEnterados} confirmaciones de Enterado" title="${cantidadEnterados} confirmaciones de Enterado">${pulgar}<small>${cantidadEnterados}</small></span>`}<button type="button" class="casta-comentar" data-hilo="${esc(it.id)}" aria-label="Abrir comentarios" title="Comentar">${comentarIcono}</button></div>${dest.length ? `<span class="post-ent">${vistos.length ? `<span class="si" title="${esc(vistos.map(x => x.clave + " " + cuando(lec.get(x.clave))).join(", "))}">✓ Enterado: ${vistos.map(x => `${esc(x.clave)} <small>${esc(cuando(lec.get(x.clave)).replace(/^.*?, /, ""))}</small>`).join(", ")}</span>` : ""}${faltan.length ? `<span class="no">Sin enterado: ${faltan.map(x => esc(x.clave)).join(", ")}</span>` : ""}${(p.turnos || []).length ? `<span class="no">Turnos destinatarios: ${(p.turnos || []).map(x => esc(x)).join(", ")} · sin padrón individual confirmado</span>` : ""}</span>` : `<span>${deEnc && p.admin && leidoAdmin ? "✓ Enterado" : ""}</span>`}
        <button type="button" class="lnk" data-hilo="${esc(it.id)}" aria-expanded="${abiertoHilo}">${cv.n ? (cv.n === 1 ? "1 comentario" : cv.n + " comentarios") : "0 comentarios"}${cv.nuevos ? ` <span class="nuevo-n">${cv.nuevos} ${cv.nuevos === 1 ? "comentario nuevo" : "comentarios nuevos"}</span>` : ""}${cv.nuevosEnterado ? ` <span class="nuevo-n">${cv.nuevosEnterado} ${cv.nuevosEnterado === 1 ? "Enterado nuevo" : "Enterados nuevos"}</span>` : ""}</button></div>
      ${!abiertoHilo && cv.ultimo ? `<button type="button" class="post-ult" data-hilo="${esc(it.id)}">${avP(cv.ultimo.autor === "admin" ? "admin" : cv.ultimo.autor)}<span><b>${esc(nomDe(cv.ultimo.autor))}</b> ${cv.ultimo.texto ? parrafos(cv.ultimo.texto) : "Mandó una foto"}</span></button>` : ""}
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
    const opPara = [["todos", "Todos los encargados"], ...Object.entries(T_AV).map(([k, v]) => ["t:" + k, "Turno " + v]), ...encargados().map(p => ["p:" + p.clave, perfilMencion(p)])];
    const marcado = () => false; // Cada nueva publicación requiere elección expresa.
    return `<div class="casta-identidad"><img src="/img/castagram-texto.png" alt="Castagram" width="300" height="79"></div>${castaActividadVistaAdmin()}<section class="card muro-nuevo"><form class="aform" data-tipo="aviso"><div class="w4 muro-q">${avP("admin", 1)}<label>Nueva publicación<input name="titulo" maxlength="140" placeholder="¿Qué necesitas avisar? Ej. Mañana viene el técnico de la báscula" autocomplete="off" value="${esc(r.titulo || "")}"></label></div>
      <label class="w4 extra">Detalle <span style="font-weight:400">(opcional)</span><textarea name="detalle" rows="2" maxlength="1000"></textarea></label>
      <div class="w4 para-op extra"><span>Elige destinatarios (obligatorio)</span>${opPara.map(([v, t]) => `<label class="pchip casta-para-perfil ${marcado(v) ? "on" : ""}"><input type="checkbox" data-para="${esc(v)}" ${marcado(v) ? "checked" : ""}>${v.startsWith("p:") ? tarjetaMencion(encargados().find(p => p.clave === v.slice(2))) : "@" + esc(t)}</label>`).join("")}</div>
      <label class="extra">Mostrar desde<input type="date" name="fecha"></label><label class="extra">Importancia<select name="prioridad"><option value="normal">Normal</option><option value="alta">Importante</option></select></label>
      <div class="w4 inc-fotos extra"><span class="lbl">Foto <span style="font-weight:400">(opcional · hasta 8)</span></span>
        <div class="inc-fbtns"><label class="btn btn-line"><input type="file" accept="image/*" capture="environment" class="inc-f" hidden>Tomar foto</label><label class="btn btn-line"><input type="file" accept="image/*" multiple class="inc-f" hidden>Subir fotos</label></div>
        <div class="inc-prev"></div></div>
      <button class="btn btn-primary extra" type="submit">Publicar</button><span class="err"></span></form>
      <p class="note extra-n" style="margin:10px 0 0">Solo lo ven las personas etiquetadas y quien lo publica. Todos comentan en la misma publicación hasta que la archives; lo archivado se guarda con su conversación en el archivo.</p></section>
      <div class="muro">${act.length ? act.map(postHtml).join("") : `<p class="empty">No hay publicaciones activas. Publica una arriba.</p>`}</div>
      ${st.castaMas ? `<button type="button" class="btn btn-line casta-mas" data-casta-mas>Cargar publicaciones anteriores</button>` : ""}
      <button class="btn btn-line muro-arch" type="button" data-archivo-abrir>${ico("i-archivo")}Archivo de Castagram</button>`;
  }

  // ---- Archivo de avisos: todo lo archivado, con búsqueda, conversación e historial ----
  const ACC_TXT = { publicar: "publicó el aviso", comentar: "comentó", etiquetar: "etiquetó a", editar: "editó un comentario", borrar: "borró un comentario", archivar: "archivó el aviso", reactivar: "reactivó el aviso", "editar-aviso": "cambió el aviso", "like-comentario": "dio Me gusta a un comentario", "quitar-like-comentario": "retiró Me gusta de un comentario" };
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
          <p class="post-para">Para ${etqParaHtml(it.para || {})}</p>
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
        it.visto_admin = true;
        const nuevaPublicacion = it.autor !== "admin" && !!(it.para && it.para.admin) &&
          !(it.lecturas || []).some(x => x.persona === "ADMIN");
        const habiaNovedad = !!(it.conv && (it.conv.nuevos || it.conv.nuevosEnterado));
        // La conversación ya fue marcada vista por el servidor: reflejarlo de inmediato.
        // Vista sin Enterado: no crear confirmación en la tabla de lecturas.
        if (it.conv) { it.conv.nuevos = 0; it.conv.nuevosEnterado = 0; }
        if (habiaNovedad && !nuevaPublicacion)
          st.avisosSinLeer = Math.max(0, (st.avisosSinLeer || 0) - 1);
      }
    } catch (e) { if (e.message !== "sesion") st.hilos[id] = { ...prev, error: "No se pudo cargar: " + e.message, comentarios: [] }; }
    if (st.abiertosAv.has(id)) repintarPostAdmin(id);
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
      if(t.matches("[data-casta-foto-url]")){castaFotoAbrir(t);return;}
      const d = t.dataset;
      if (d.mentionPick) { elegirMencion(t.closest("form.com-form"), d.mentionPick); return; }
      if (t.matches("[data-casta-paso], [data-casta-ir]")) { castaMover(t); return; }
      if("castaMas" in d){
        t.disabled=true;t.textContent="Cargando…";
        try{
          const j=await api("agenda/avisos-feed?cursor="+encodeURIComponent(st.castaCursor||""));
          const existentes=new Set(st.items.map(x=>x.id));
          st.items.push(...j.items.filter(x=>!existentes.has(x.id)));
          st.castaCursor=j.cursor;st.castaMas=j.mas;
          const y=scrollY;pintarAvisos();scrollTo({top:y});
        }catch(err){toast(err.message);t.disabled=false;t.textContent="Cargar publicaciones anteriores";}
        return;
      }
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
      } else if ("sheetCerrar" in d) { castaHojaCerrar(t.closest("dialog.casta-sheet")); }
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
      } else if (d.comEnterado) {
        const h=st.hilos[d.av], c=h?.comentarios?.find(x=>x.id===d.comEnterado);
        if(!c || c.borrado || t.disabled)return;
        const antes=!!c.mi_enterado, totalAntes=Number(c.enterados)||0, deseado=!antes;
        const pintar=(activo,total)=>{
          t.classList.toggle("is-enterado",activo);
          t.setAttribute("aria-pressed",String(activo));
          t.setAttribute("aria-label",activo?"Quitar Me gusta":"Me gusta");
          t.title=activo?"Quitar Me gusta":"Me gusta";
          const n=t.nextElementSibling;
          if(n?.classList.contains("casta-like-cuenta")){n.textContent=String(total);n.hidden=!total;n.setAttribute("aria-label",total+" Me gusta");}
        };
        // Respuesta inmediata como Instagram. La API confirma el estado y corrige la cifra.
        c.mi_enterado=deseado;c.enterados=Math.max(0,totalAntes+(deseado?1:-1));
        pintar(c.mi_enterado,c.enterados);
        t.disabled=true;
        try {
          const res=await post(`agenda/${d.av}/comentarios/${d.comEnterado}/enterado`, {activo:deseado});
          if(st.hilos[d.av]!==h)return;
          c.mi_enterado=!!res.mi_enterado;c.enterados=Math.max(0,Number(res.enterados)||0);
          if(t.isConnected)pintar(c.mi_enterado,c.enterados);
          const it=st.items.find(x=>x.id===d.av);
          if(it && res.post_enterado && !(it.lecturas||[]).some(x=>x.persona==="ADMIN")){
            it.lecturas=[...(it.lecturas||[]),{persona:"ADMIN",at:new Date().toISOString()}];
            const card=el.querySelector('[data-post="'+CSS.escape(d.av)+'"]');
            if(card)card.outerHTML=postHtml(it);
          }
          contadores();
        } catch(er) {
          if(st.hilos[d.av]===h){c.mi_enterado=antes;c.enterados=totalAntes;if(t.isConnected)pintar(antes,totalAntes);}
          if(er.message!=="sesion")toast(er.message);
        } finally { if(t.isConnected)t.disabled=false; }
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
      } else if ("archivoAbrir" in d) { st.archivo = { pagina: 0 }; history.pushState({...history.state,casta_layer:"archivo"},"",location.href); buscarArchivo(); scrollTo({ top: el.getBoundingClientRect().top + scrollY - 80 }); }
      else if ("archivoVolver" in d) { if(["archivo","archivo-detalle"].includes(history.state?.casta_layer))history.back();else {if(st.archivo?.sel){st.archivo.sel=null;st.archivo.det=null;}else st.archivo=null;pintarAvisos();} }
      else if (d.archivoPag) { st.archivo.pagina = Math.max(0, (st.archivo.pagina || 0) + Number(d.archivoPag)); buscarArchivo(); }
      else if (d.archivoVer) {
        const a = st.archivo;
        if (!a) return;
        const id = d.archivoVer;
        a.sel = id; a.det = null; history.pushState({...history.state,casta_layer:"archivo-detalle"},"",location.href); pintarAvisos();
        try {
          const detalle = await api(`agenda/${id}/conversacion?historial=1`);
          if (st.archivo !== a || a.sel !== id) return;
          a.det = detalle;
        } catch (er) {
          if (st.archivo !== a || a.sel !== id) return;
          if (er.message !== "sesion") { toast(er.message); a.sel = null; }
        }
        if (st.archivo === a && a.sel === id) pintarAvisos();
      }
    });
    el.addEventListener("scroll", e => { if(e.target.matches(".casta-carrusel-pista"))castaSincronizar(e.target.closest("[data-casta-carrusel]")); }, true);
    el.addEventListener("change", async e => {
      const inp = e.target.closest("[data-com-foto]"); if (!inp || !inp.files[0]) return;
      const f = inp.closest("form"), h = st.hilos[f.dataset.av];
      if (h.responderA) { inp.value = ""; return; }
      try { h.foto = await comprimirFoto(inp.files[0]); h.borrador = f.texto.value; pintarAvisos(); } catch (er) { f.querySelector(".err").textContent = er.message; }
    });
    el.addEventListener("input", e => { const f = e.target.closest("form.com-form"); if (f && st.hilos[f.dataset.av] && e.target.name === "texto") { st.hilos[f.dataset.av].borrador = e.target.value; actualizarMenciones(f); } });
    el.addEventListener("click", e => { const ta = e.target.closest("form.com-form textarea"); if (ta) actualizarMenciones(ta.closest("form")); });
    el.addEventListener("keyup", e => { const ta = e.target.closest("form.com-form textarea"); if (ta && !["Enter","Escape","ArrowDown","ArrowUp"].includes(e.key)) actualizarMenciones(ta.closest("form")); });
    el.addEventListener("keydown", teclaMencion);
    addEventListener("popstate",castaRegreso);
    document.addEventListener("keydown",e=>{if(castaVisor?.open&&!e.isComposing&&e.keyCode!==229&&!e.altKey&&!e.ctrlKey&&!e.metaKey&&(["ArrowLeft","ArrowRight","Home","End"].includes(e.key))){e.preventDefault();e.stopPropagation();if(e.key==="Home"||e.key==="End"){castaIndex=e.key==="Home"?0:castaUrls.length-1;castaFotoPintar();}else castaFotoMover(e.key==="ArrowLeft"?-1:1);}},true);
    el.addEventListener("submit", async e => {
      const f = e.target;
      if (f.id === "arch-f") { e.preventDefault(); Object.assign(st.archivo, { q: f.q.value, persona: f.persona.value, desde: f.desde.value, hasta: f.hasta.value, pagina: 0 }); buscarArchivo(); return; }
      if (f.classList.contains("com-form")) {
        e.preventDefault();
        const id = f.dataset.av, h = st.hilos[id], b = f.querySelector("[type=submit]"), err = f.querySelector(".err");
        err.textContent = ""; b.disabled = true; b.textContent = "Enviando…";
        try {
          const postActual = st.items.find(x => x.id === id), audiencia = postActual?.para || {};
          const mencionados = [...f.texto.value.matchAll(/@([A-Za-zÑñ0-9_]{2,12})/g)].map(m => m[1].toUpperCase());
          const elegidos = [...new Set([...(h.responderA ? [] : h.etq || []),...mencionados])];
          const nuevas = audiencia.todos ? [] : elegidos.filter(k =>
            k !== postActual?.autor && !(audiencia.personas || []).includes(k) &&
            (st.personas || []).some(p => p.clave === k && p.activo));
          if(nuevas.length && !(await EC.confirmar("Ampliar destinatarios",
            "Las personas @"+nuevas.join(", @")+" podrán consultar el aviso y toda su conversación anterior. ¿Permitir acceso?", "Confirmar acceso"))) {
            b.disabled=false;b.textContent=h.responderA?"Responder":"Comentar";return;
          }
          const respuesta = await post(`agenda/${id}/comentar`, { texto: f.texto.value, foto: h.responderA ? null : h.foto || null, etiquetas: h.responderA ? [] : h.etq || [], confirmar_ampliacion: nuevas.length > 0, uid: h.uid || (h.uid = crypto.randomUUID()) });
          delete h.uid;
          const eraRespuesta = !!h.responderA, etq = eraRespuesta ? [] : h.etq || [];
          if (eraRespuesta) terminarReplyAdmin(h);
          else { h.borrador = ""; h.foto = null; h.etq = []; }
          if (etq.length) { const it = st.items.find(x => x.id === id); if (it && it.para && !it.para.todos) it.para.personas = [...new Set([...(it.para.personas || []), ...etq])]; }
          const it = st.items.find(x => x.id === id);
          if (it) {
            it.conv = { ...(it.conv || {}), n: ((it.conv && it.conv.n) || 0) + (respuesta.repetido ? 0 : 1), nuevos: 0, actividad: respuesta.comentario?.creado || new Date().toISOString(), ...(respuesta.comentario ? { ultimo: respuesta.comentario } : {}) };
            if (respuesta.post_enterado && !(it.lecturas||[]).some(x=>x.persona==="ADMIN"))
              it.lecturas=[...(it.lecturas||[]),{persona:"ADMIN",at:new Date().toISOString()}];
          }
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

  return { pintarAvisos, vistaAvisos };
};
