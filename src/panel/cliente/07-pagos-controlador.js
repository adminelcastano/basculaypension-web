// Pagos administrativos en Agenda. Recibe el estado y los servicios existentes; no escribe un segundo libro.
window.CastaPagosControlador = function crearPagos(dependencias) {
  const { st, ico, esc, MXN, diaTxt, mayus, fMes, post, cargar, toast } = dependencias;
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
    const v = pago || { fecha: st.hoy, importe: modo === "obligacion" ? it.saldo : it && it.importe != null ? it.importe : "", forma: (it && it.forma) || "", cuenta: it && it.cuenta || null, titulo: modo === "obligacion" ? "Abono a " + it.acreedor + ": " + it.concepto : "", nota: "", categoria: it && it.categoria || "" };
    const suelto = modo === "hecho" || modo === "obligacion" || (modo === "editar" && !pago.item_id);
    const titulo = modo === "editar" ? "Corregir pago" : modo === "obligacion" ? "Abonar obligación: " + it.acreedor : modo === "hecho" ? "Registrar un pago o gasto ya hecho" : "Registrar pago: " + it.titulo;
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
    const uidPago = crypto.randomUUID(); // mismo identificador tras error de red
    const enviar = async () => {
      const b = f.querySelector("[type=submit]");
      if (b.disabled) return;
      b.disabled = true;
      f.querySelector(".err").textContent = "";
      const cuerpo = { fecha: f.fecha.value, importe: f.importe.value, forma: f.forma.value, nota: f.nota.value, categoria: f.categoria.value, ...(f.titulo ? { titulo: f.titulo.value } : {}), ...(forzar ? { forzar: 1 } : {}), uid: uidPago, ...(modo === "obligacion" ? { obligacion_id: it.id } : {}) };
      let id;
      try {
        if (modo === "editar") { await post(`agenda/pagos/${pago.id}/editar`, cuerpo); id = pago.id; }
        else if (modo === "hecho" || modo === "obligacion") id = (await post("agenda/pagos/hecho", cuerpo)).id;
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
      if(modo==="obligacion")document.dispatchEvent(new Event("obligaciones-actualizadas"));
    };
    f.addEventListener("submit", ev => { ev.preventDefault(); enviar(); });
  }

  return { filaPagoHecho, listaPagosHechos, ventanaPago, ventanaProgramar };
};
