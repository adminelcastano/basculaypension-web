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
      "<p class='note'>Elige la cuenta, registra las fechas reales de tu estado de cuenta y captura sus cifras cuando estén disponibles. Puedes guardar campos parciales. Un saldo a favor o saldo deudor puede capturarse con signo negativo; cargos y abonos siempre son positivos. Este registro no genera cargos, gastos ni movimientos.</p>" +
      "<form class='cform' id='f-est-form' novalidate>" +
      "<label class='wide'>Cuenta o tarjeta<select name='cuenta' required>" +
      cuentas.filter(x=>x.activa).map(x=>"<option value='"+esc(x.id)+"'>"+esc(x.nombre)+(x.tipo==="credito"?" · crédito":" · débito")+"</option>").join("")+
      "</select></label>" +
      "<label>Inicio del periodo<input name='periodo_desde' type='date' required></label>" +
      "<label>Fin del periodo<input name='periodo_hasta' type='date' required></label>" +
      "<label>Fecha de corte<input name='fecha_corte' type='date' required></label>" +
      "<label class='f-est-credito'>Fecha límite de pago<input name='fecha_pago_limite' type='date'></label>" +
      datosCampos.map(([name,title,hint])=>"<label data-estado-campo='"+name+"'><span>"+title+"</span><input name='"+name+"' inputmode='decimal' autocomplete='off' placeholder='"+hint+"'></label>").join("")+
      "<label class='f-est-credito'>Pago mínimo<input name='pago_minimo' inputmode='decimal' placeholder='Opcional'></label>" +
      "<label class='f-est-credito'>Pago para no generar intereses<input name='pago_sin_intereses' inputmode='decimal' placeholder='Opcional'></label>" +
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
      form.querySelectorAll(".f-est-credito").forEach(x=>x.hidden=c?.tipo!=="credito");
      const etiquetas=c?.tipo==="credito"
        ? {saldo_inicial:"Deuda al inicio",abonos:"Pagos y abonos",cargos:"Compras y cargos",saldo_final:"Deuda al corte"}
        : {saldo_inicial:"Saldo inicial",abonos:"Depósitos y abonos",cargos:"Retiros y cargos",saldo_final:"Saldo al corte (estado de cuenta)"};
      Object.entries(etiquetas).forEach(([nombre,texto])=>{
        const span=form.querySelector('[data-estado-campo="'+nombre+'"] span');
        if(span)span.textContent=texto;
      });
      if(c?.tipo!=="credito") for(const name of ["fecha_pago_limite","pago_minimo","pago_sin_intereses"])form.elements.namedItem(name).value="";
    };

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
