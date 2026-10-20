// Puente opcional con Google Sheets SALARIOS: nunca origina un pago nuevo.
// Requiere configuración privada y consentimiento expreso para sincronizar.
(() => {
  const $ = q=>document.querySelector(q), esc=EC.esc;
  const money=v=>"$"+Number(v||0).toLocaleString("es-MX",{minimumFractionDigits:2,maximumFractionDigits:2});
  let busy=false, recargarPendiente=false;
  async function cargar(){
    if(busy){recargarPendiente=true;return;}
    busy=true;
    const div=$("#f-salarios-contenido");
    if(!div){busy=false;return;}
    try{
      const x=await EC.api("finanzas/salarios");
      const pagos=x.pagos||[], empleados=x.empleados||[];
      div.innerHTML="<p class='note'>Los movimientos de Sueldos ya registrados se reflejarán aquí. Vincularlos a un colaborador no genera gastos nuevos. La conexión a SALARIOS exige una autorización y verificación adicionales.</p>"+
        (x.aviso?"<p class='note' role='status'>"+esc(x.aviso)+"</p>":"")+
        (x.fuentes_no_vinculadas?"<p class='note'>"+esc(x.fuentes_no_vinculadas)+"</p>":"")+
        (pagos.length?"<div class='alist'>"+pagos.map(p=>{
          const vinc=p.vinculo,desfasado=vinc&&!p.vinculo_actual;
          const activo=x.habilitado&&!vinc?.sincronizado_en;
          return "<div class='aitem'><b class='tt'>"+esc(p.dia)+" · "+esc(p.concepto)+"</b>"+
            "<span class='mm'><span>"+money(p.monto)+" · "+esc(p.origen==="admin"?"Administración":"Caja o turno")+(p.forma?" · "+esc(p.forma):"")+(p.cuenta?" · "+esc(p.cuenta):"")+"</span>"+
            "<span>"+(desfasado?"Origen modificado: revisar antes de sincronizar":vinc?.sincronizado_en?"Reflejado en SALARIOS":vinc?"Vinculación pendiente de sincronizar":"Colaborador sin confirmar")+"</span></span>"+
            (activo?"<span class='acc'><label class='note'>Colaborador<select data-pago-id='"+esc(p.id)+"'><option value=''>Selecciona en SALARIOS</option>"+
              empleados.map(c=>"<option value='"+esc(c.id)+"' "+(vinc?.colaborador_id===c.id?"selected":"")+">"+esc(c.nombre)+"</option>").join("")+
              "</select></label><button type='button' class='btn btn-line' data-vincular='"+esc(p.id)+"'>Confirmar</button></span>":"")+
            "</div>";
        }).join("")+"</div>":"<p class='note'>No hay gastos con categoría Sueldos identificados en la fuente estable. Los retiros del corte requieren revisión aparte.</p>")+
        "<h4 class='fsub'>Candidatos para revisar: cortes y hoja de caja</h4>" +
        "<p class='note'>Estas referencias pueden repetirse o cambiar al corregir un corte. NO se sincronizan con SALARIOS ni se suman al sueldo pagado verificado.</p>" +
        ((x.candidatos||[]).length?"<div class='alist'>"+x.candidatos.map(c=>
          "<div class='aitem'><b class='tt'>"+esc(c.dia)+" · "+esc(c.origen)+"</b>"+
          "<span class='mm'><span>"+esc(c.turno||"")+" · "+esc(c.concepto)+" · "+money(c.monto)+"</span>"+
          "<span class='note'>"+(c.posible_duplicado?"Posible duplicado por fecha e importe: revisar fuente":"Pendiente de identificar colaborador y movimiento único")+"</span></span></div>"
        ).join("")+"</div>":"<p class='note'>No aparecen candidatos salariales recientes en esas fuentes.</p>")+
        (x.habilitado?"<div class='row'><button id='f-salarios-sync' type='button' class='btn btn-primary'>Reflejar pagos confirmados en SALARIOS</button></div>":
          "<p class='note'>La hoja SALARIOS sigue intacta; ningún pago se enviará mientras el puente esté desactivado.</p>")+
        "<p id='f-salarios-error' class='err' role='alert'></p>";
      div.querySelectorAll("[data-vincular]").forEach(b=>b.addEventListener("click",async()=>{
        const sel=div.querySelector("[data-pago-id='"+b.dataset.vincular+"']");
        if(!sel?.value){EC.toast("Elige el colaborador correcto desde SALARIOS.");return;}
        b.disabled=true;
        try{await EC.post("finanzas/salarios/vincular",{gasto_id:b.dataset.vincular,colaborador_id:sel.value});EC.toast("Vinculación registrada, sin nuevo gasto.");await cargar();}
        catch(e){if(e.message!=="sesion")$("#f-salarios-error").textContent=e.message;}
        finally{if(b.isConnected)b.disabled=false;}
      }));
      $("#f-salarios-sync")?.addEventListener("click",async e=>{
        if(!(await EC.confirmar("¿Reflejar pagos en SALARIOS?","Solo se enviarán los movimientos vinculados y revisados. No modifica gastos de la web.","Sincronizar")))return;
        const b=e.currentTarget;b.disabled=true;
        try{const r=await EC.post("finanzas/salarios/sincronizar",{confirmado:true});EC.toast(r.sin_cambios?"Sin pagos nuevos para sincronizar.":"Pagos reflejados en la hoja privada.");await cargar();}
        catch(e){if(e.message!=="sesion")$("#f-salarios-error").textContent=e.message;}
        finally{if(b.isConnected)b.disabled=false;}
      });
    }catch(e){if(e.message!=="sesion")div.innerHTML="<p class='note'>No se pudo consultar el puente SALARIOS: "+esc(e.message)+"</p>";}
    finally{busy=false;if(recargarPendiente){recargarPendiente=false;queueMicrotask(cargar);}}
  }
  document.addEventListener("modulo",e=>{if(e.detail==="finanzas")cargar();});
})();
