// Estados de cuenta: captura manual, independiente del mes de Finanzas.
// Nunca copia automáticamente renglones de estados a ingresos/gastos o tarjetas.
(() => {
  const $ = q => document.querySelector(q), esc = EC.esc;
  const datosCampos = [
    ["saldo_inicial","Saldo anterior","0.00"],
    ["abonos","Abonos o pagos totales","0.00"],
    ["cargos","Cargos totales (incluye comisiones, intereses e IVA)","0.00"],
    ["saldo_final","Saldo final / deuda al corte","0.00"],
    ["comisiones","Comisiones incluidas en cargos (opcional)","0.00"],
    ["intereses","Intereses incluidos en cargos (opcional)","0.00"],
    ["iva","IVA incluido en cargos (opcional)","0.00"]
  ];
  const dinero = n => n == null ? "Sin capturar" : (Number(n) < 0 ? "−" : "") + "$" + Math.abs(Number(n)).toLocaleString("es-MX",{minimumFractionDigits:2,maximumFractionDigits:2});
  let actual = null, todos = [], cuentas = [], cargando = false;
  const titulos = {
    debito: {saldo_inicial:"Dinero al inicio",abonos:"Entradas y depósitos",cargos:"Salidas y retiros",saldo_final:"Dinero al corte"},
    credito: {saldo_inicial:"Deuda anterior",abonos:"Pagos y abonos",cargos:"Compras y cargos",saldo_final:"Deuda al corte"}
  };
  function estadoTexto(r) {
    if (r.comprobacion==="incompleto") return "Datos parciales: faltan saldos o movimientos";
    if (r.comprobacion==="cuadra") return "Las cifras de este estado cuadran entre sí";
    return "Diferencia interna por revisar: " + dinero(r.diferencia);
  }
  function continuidadTexto(r) {
    if(r.continuidad==="sin_previo")return "Sin estado anterior para comparar.";
    if(r.continuidad==="intervalo")return "Hay "+r.continuidad_dias_sin_estado+" día(s) sin estado entre los periodos. No se compara saldo.";
    if(r.continuidad==="incompleto")return "Faltan saldos del estado anterior o de este periodo.";
    if(r.continuidad==="cuadra")return "Continuidad correcta: saldo inicial coincide con el cierre anterior.";
    return "Atención: el saldo inicial difiere "+dinero(r.continuidad_diferencia)+" del cierre del periodo anterior. Revisar sin ajustar automáticamente.";
  }
  function mostrar() {
    const el=$("#f-estados-contenido");
    if(!el)return;
    el.innerHTML =
      "<p class='note'>Registra los datos básicos del periodo: cuánto había, qué entró, qué salió y cuánto quedó. En crédito se muestran también los importes y fechas de pago. Puedes dejar importes desconocidos en blanco; este registro no crea movimientos.</p>" +
      "<form class='cform' id='f-est-form' novalidate>" +
      "<label class='wide f-est-cuenta'>Cuenta o tarjeta<select name='cuenta' required>" +
      cuentas.filter(x=>x.activa).map(x=>"<option value='"+esc(x.id)+"'>"+esc(x.nombre)+(x.tipo==="credito"?" · crédito":" · débito")+"</option>").join("")+
      "</select><small class='note'>Elige la cuenta antes de leer el PDF. Verifica tú la titularidad.</small></label>" +
      "<div class='est-pdf-caja wide' role='group' aria-label='Lectura privada de PDF'>"+
      "<b>Leer estado de cuenta en PDF</b>"+
      "<p class='note'>El PDF se procesa únicamente en este dispositivo. Revisa las sugerencias antes de aplicarlas al formulario.</p>"+
      "<div class='row'><label class='est-pdf-archivo'>Seleccionar PDF (máximo 12 MB)<input type='file' id='f-est-pdf-archivo' accept='.pdf,application/pdf' aria-label='Seleccionar estado de cuenta PDF'></label>"+
      "<button type='button' class='btn btn-line' id='f-est-pdf-leer' disabled>Leer PDF</button></div>"+
      "<p id='f-est-pdf-mensaje' class='note' role='status' aria-live='polite'></p>"+
      "<div id='f-est-pdf-preview' hidden></div></div>"+
      "<label>Inicio del periodo<input name='periodo_desde' type='date' required></label>" +
      "<label>Fin del periodo<input name='periodo_hasta' type='date' required></label>" +
      "<label>Fecha de corte<input name='fecha_corte' type='date' required></label>" +
      "<label class='f-est-credito'>Fecha límite de pago<input name='fecha_pago_limite' type='date'></label>" +
      "<p class='note wide f-est-explicacion' id='f-est-explicacion'></p>"+
      datosCampos.slice(0,4).map(([name,title,hint])=>"<label><span data-est-label='"+name+"'>"+title+"</span><input name='"+name+"' inputmode='decimal' autocomplete='off' placeholder='"+hint+"'></label>").join("")+
      "<details class='f-est-detalles wide'><summary>Detalles opcionales: comisiones, intereses e IVA</summary><div class='f-est-detalles-grid'>"+
      datosCampos.slice(4).map(([name,title,hint])=>"<label><span>"+title+"</span><input name='"+name+"' inputmode='decimal' autocomplete='off' placeholder='"+hint+"'></label>").join("")+
      "</div></details>"+
      "<label class='f-est-credito'>Pago mínimo<input name='pago_minimo' inputmode='decimal' placeholder='Opcional'></label>" +
      "<label class='f-est-credito'>Pago para no generar intereses<input name='pago_sin_intereses' inputmode='decimal' placeholder='Opcional'></label>" +
      "<p class='note wide f-est-credito'>La deuda al corte puede incluir compras a meses. No equivale necesariamente al pago para no generar intereses. Los servicios y proveedores se administran en Agenda → Pagos programados.</p>"+
      "<label class='wide'>Nota privada de conciliación (opcional)<textarea name='nota' maxlength='300' rows='2' placeholder='Anotación para revisar movimientos. No incluyas números completos de cuenta.'></textarea></label>"+
      "<div class='row wide'><button class='btn btn-primary' type='submit'>Guardar estado de cuenta</button><button class='btn btn-line' id='f-est-nuevo' type='button' hidden>Nuevo registro</button></div>"+
      "<span class='err wide' role='alert' id='f-est-err'></span></form>"+
      "<p class='note'>Para Coppel, Elektra y Banjercito, crea primero una cuenta de tipo <b>Crédito</b> desde Configuración → Cuentas. No se inventarán montos ni fechas de corte.</p>"+
      "<h4 class='fsub'>Periodos capturados</h4>"+
      (todos.length ? "<div class='alist'>"+todos.map(r=>{
        const c=cuentas.find(x=>x.id===r.cuenta);
        return "<div class='aitem'><span class='tt'>"+esc(c?.nombre||"Cuenta no encontrada")+"</span>"+
          "<span class='mm'><span>"+esc(r.periodo_desde)+" → "+esc(r.periodo_hasta)+"</span>"+
          "<span>"+esc(estadoTexto(r))+"</span>"+
          "<span class='note' "+(r.continuidad==="revisar"?"role='status' style='color:var(--warn)'":"")+">"+esc(continuidadTexto(r))+"</span>"+
          "<span>Saldo del estado: "+esc(dinero(r.saldo_final))+" · versión "+r.version+"</span></span>"+
          "<span class='acc'><button type='button' class='btn btn-line' data-estado-editar='"+esc(r.id)+"'>Editar</button></span></div>";
      }).join("")+"</div>":"<p class='note'>Todavía no se han capturado estados de cuenta. Puedes empezar por el más reciente.</p>");
    const form=$("#f-est-form");
    const mostrarCredito=()=>{
      const c=cuentas.find(x=>x.id===form.cuenta.value);
      const credito=c?.tipo==="credito";
      form.querySelectorAll(".f-est-credito").forEach(x=>x.hidden=!credito);
      for(const [campo,texto] of Object.entries(titulos[credito?"credito":"debito"])){
        const etiqueta=form.querySelector('[data-est-label="'+campo+'"]');
        if(etiqueta)etiqueta.textContent=texto;
      }
      const explicacion=$("#f-est-explicacion");
      if(explicacion)explicacion.textContent=credito
        ? "Deuda final = deuda anterior + compras y cargos − pagos y abonos. No se registra ningún pago automáticamente."
        : "Saldo final = dinero al inicio + entradas − salidas. No se crean ingresos ni gastos automáticamente.";
      if(c?.tipo!=="credito") for(const name of ["fecha_pago_limite","pago_minimo","pago_sin_intereses"])form.elements.namedItem(name).value="";
    };

    // Lectura local: no crea registros ni guarda el PDF; solo rellena campos
    // vacíos y únicamente cuando el banco y tipo seleccionados coinciden.
    const archivo=$("#f-est-pdf-archivo"),leer=$("#f-est-pdf-leer");
    const mensaje=$("#f-est-pdf-mensaje"),preview=$("#f-est-pdf-preview");
    let importado=null;
    const normPDF = txt=>String(txt||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toUpperCase();
    const coincidePDF=(dato,cuenta)=>{
      const nombre=normPDF(cuenta?.nombre),bank=dato?.institucion;
      return !!bank && dato.tipo===cuenta?.tipo &&
        (bank==="AMEX"?/AMEX|AMERICAN EXPRESS/.test(nombre):
         bank==="NU"?/\bNU\b/.test(nombre):
         bank==="MERCADO PAGO"?/MERCADO\s*PAGO|MDO\s*PAGO/.test(nombre):nombre.includes(bank));
    };
    function mostrarPDF(){
      if(!preview||!importado)return;
      const dato=importado,propuestas=dato.campos||{},cuenta=cuentas.find(x=>x.id===form.cuenta.value);
      const ok=coincidePDF(dato,cuenta);
      const nombres=titulos[cuenta?.tipo==="credito"?"credito":"debito"];
      const contexto=ok
        ? "La institución y el tipo coinciden. Confirma que es exactamente tu cuenta o tarjeta (no se verifica el número)."
        : "El PDF indica "+(dato.institucion||"institución desconocida")+" · "+(dato.tipo==="credito"?"crédito":"débito")+
          ". Cuenta seleccionada: "+(cuenta?.nombre||"ninguna")+" · "+(cuenta?.tipo==="credito"?"crédito":"débito")+
          ". Elige la cuenta correcta arriba. No se aplicarán datos a una institución distinta ni a otro tipo.";
      const campos=[
        ["periodo_desde","Inicio del periodo"],["periodo_hasta","Fin del periodo"],
        ["fecha_corte","Fecha de corte"],["fecha_pago_limite","Fecha límite de pago"],
        ...datosCampos.map(([id,titulo])=>[id,nombres[id]||titulo]),
        ["pago_minimo","Pago mínimo"],["pago_sin_intereses","Pago para no generar intereses"]];
      preview.hidden=false;
      preview.innerHTML="<b>"+esc(dato.institucion||"Banco no reconocido")+
        " · "+Number(dato.paginas||0)+" página(s)</b>"+
        "<p class='note' role='status'>"+esc(contexto)+"</p>"+
        "<div class='est-pdf-resumen'>"+
        campos.filter(([k])=>propuestas[k]!=null).map(([k,label])=>
          "<div><span>"+esc(label)+"</span><b>"+esc(propuestas[k])+"</b></div>").join("")+"</div>"+
        (dato.advertencias||[]).map(v=>"<p class='note'>⚠ "+esc(v)+"</p>").join("")+
        (ok&&dato.fiable&&!actual?"<label class='note est-pdf-confirmar'><input type='checkbox' id='f-est-pdf-cuenta-confirmada'> Confirmo que este PDF pertenece exactamente a la cuenta o tarjeta seleccionada.</label>":"")+
        (!dato.fiable?"<p class='note'>La lectura es incompleta o no confiable. Usa la captura manual.</p>":"")+
        (actual?"<p class='note'>Termina esta edición o pulsa Nuevo registro antes de aplicar otro PDF.</p>":"")+
        "<button type='button' id='f-est-pdf-aplicar' class='btn btn-line' disabled>Aplicar sugerencias al formulario</button>"+
        "<p class='note'>Todavía no se guarda nada. Comprueba cada campo y pulsa Guardar estado de cuenta cuando estés seguro.</p>";
      const confirmarCuenta=$("#f-est-pdf-cuenta-confirmada"),aplicarPDF=$("#f-est-pdf-aplicar");
      confirmarCuenta?.addEventListener("change",()=>{aplicarPDF.disabled=!confirmarCuenta.checked||!dato.fiable||!ok||!!actual;});
      aplicarPDF?.addEventListener("click",()=>{
        if(actual||!importado?.fiable||!coincidePDF(importado,cuentas.find(x=>x.id===form.cuenta.value))||!confirmarCuenta?.checked)return;
        let aplicados=0,existentes=0;
        for(const [key,value] of Object.entries(importado.campos)){
          const celda=form.elements.namedItem(key);
          if(!celda)continue;
          if(String(celda.value||"").trim()&&String(celda.value)!==String(value)){existentes++;continue;}
          celda.value=String(value);aplicados++;
        }
        mostrarCredito();
        importado=null;
        preview.hidden=true;
        preview.replaceChildren();
        mensaje.textContent="Se aplicaron "+aplicados+" campos. Se respetaron "+existentes+" valores escritos anteriormente. Revisa antes de guardar.";
        form.scrollIntoView({behavior:"smooth",block:"start"});
      });
    }
    if(archivo&&leer&&mensaje&&preview){
      archivo.addEventListener("change",()=>{leer.disabled=!archivo.files?.length;mensaje.textContent="";});
      form.cuenta.addEventListener("change",()=>{if(importado)mostrarPDF();});
      leer.addEventListener("click",async()=>{
        const file=archivo.files?.[0];
        if(!file||!EC.extraerEstadoPDF)return;
        if(actual){mensaje.textContent="Termina esta edición o pulsa Nuevo registro antes de leer otro PDF.";return;}
        leer.disabled=true;mensaje.textContent="Leyendo PDF localmente…";
        preview.hidden=true;preview.replaceChildren();importado=null;
        try{
          const datos=await EC.extraerEstadoPDF(file);
          importado=datos;
          mensaje.textContent=datos.fiable?"Lectura terminada: revisa las cifras sugeridas.":"No se identificó suficiente información confiable; captura manualmente.";
          mostrarPDF();
        }catch(error){mensaje.textContent="No se pudo leer el PDF: "+String(error?.message||"Error desconocido").slice(0,180);}
        finally{archivo.value="";leer.disabled=true;}
      });
    }
    form.cuenta.addEventListener("change",mostrarCredito);
    mostrarCredito();
    $("#f-est-nuevo").addEventListener("click",()=>{actual=null;form.reset();mostrarCredito();$("#f-est-nuevo").hidden=true;$("#f-est-err").textContent="";});
    el.querySelectorAll("[data-estado-editar]").forEach(b=>b.addEventListener("click",()=>{
      const r=todos.find(x=>x.id===b.dataset.estadoEditar);if(!r)return;
      actual={id:r.id,version:r.version};
      for(const name of ["cuenta","periodo_desde","periodo_hasta","fecha_corte","fecha_pago_limite","saldo_inicial","saldo_final","cargos","abonos","comisiones","intereses","iva","pago_minimo","pago_sin_intereses","nota"]) {
        const v=r[name];form.elements.namedItem(name).value=v==null?"":String(v);
      }
      mostrarCredito();
      $("#f-est-nuevo").hidden=false;
      $("#f-est-err").textContent="Editando versión "+r.version+". Se conservarán las revisiones anteriores.";
      form.scrollIntoView({behavior:"smooth",block:"start"});
    }));
    form.addEventListener("submit",async e=>{
      e.preventDefault();
      const btn=form.querySelector("button[type=submit]"),msg=$("#f-est-err");
      btn.disabled=true;msg.textContent="";
      try {
        const d=Object.fromEntries(new FormData(form).entries());
        if(actual)Object.assign(d,actual);
        await EC.post("finanzas/estados-cuenta",d);
        actual=null;await cargar();
        EC.toast("Estado de cuenta guardado. No se alteraron movimientos.");
      }catch(e){if(e.message!=="sesion")msg.textContent=e.message;}finally{if(btn.isConnected)btn.disabled=false;}
    });
  }
  async function cargar(){
    if(cargando)return;
    cargando=true;
    const el=$("#f-estados-contenido");
    try{
      const r=await EC.api("finanzas/estados-cuenta");
      cuentas=r.cuentas||[];todos=r.estados||[];
      if(el)mostrar();
    }catch(e){if(el && e.message!=="sesion")el.innerHTML="<p class='note'>No se pudieron cargar los estados de cuenta: "+esc(e.message)+"</p>";}
    finally{cargando=false;}
  }
  document.addEventListener("modulo",e=>{if(e.detail==="finanzas")cargar();});
})();
