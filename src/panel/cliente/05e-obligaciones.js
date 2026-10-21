// Obligaciones confirmadas. Solo administra el principal y la referencia; los
// abonos usan la misma operación transaccional de Pagos hechos de Agenda.
(() => {
  const $=q=>document.querySelector(q), esc=EC.esc, api=EC.api, post=EC.post;
  const fmt=n=>n==null?"Sin confirmar":EC.dinero(n);
  const hoy=()=>EC.hoyMx();
  let lista=[], sec=0, creandoUid=null, cargando=false;
  function pintar(r) {
    const el=$("#fb-obligaciones");if(!el)return;
    const t=r.resumen||{},pend=r.obligaciones||[];
    lista=pend;
    const filas=pend.map(o=>{
      const activo=o.estado==="activa",sinSaldo=o.saldo===0,estado=o.situacion;
      return `<article class="aitem fin-ob-item">
        <span class="tt">${esc(o.acreedor)} · ${esc(o.concepto)}</span>
        <span class="mm">
          <span><b>${esc(fmt(o.saldo))}</b> pendiente de ${esc(fmt(o.total))}</span>
          <span>${esc(estado==="liquidada"?"Liquidada":estado==="vencida"?"Vencida":estado==="cancelada"?"Cancelada":"Pendiente")}
             · vencimiento ${esc(o.vencimiento)}</span>
          <span>Abonado ${esc(fmt(o.pagado))}${o.referencia?" · Ref. "+esc(o.referencia):""}</span>
          ${o.nota?`<span>Nota: ${esc(o.nota)}</span>`:""}
        </span>
        <span class="acc">
          ${activo&&!sinSaldo?`<button class="btn btn-primary" type="button" data-ob-abonar="${esc(o.id)}">Abonar</button>`:""}
          ${activo?`<button class="btn btn-line" type="button" data-ob-editar="${esc(o.id)}">Editar</button>`:""}
          ${activo&&!o.pagado?`<button class="btn btn-line" type="button" data-ob-cancelar="${esc(o.id)}">Cancelar</button>`:""}
        </span>
      </article>`;
    }).join("");
    el.innerHTML=`<section class="card">
      <h3>Cuentas por pagar confirmadas</h3>
      <p class="note">Solo facturas u obligaciones cuyo importe realmente conoces. No mezclar con pagos programados aproximados; registrar una obligación no mueve dinero.</p>
      <div class="ctot">
        <div class="k"><span>Saldo exigible pendiente</span><b>${fmt(t.pendiente)}</b></div>
        <div class="k"><span>Vencido</span><b>${fmt(t.vencido)}</b></div>
        <div class="k"><span>Próximos 7 días</span><b>${fmt(t.proximos_7)}</b></div>
        <div class="k"><span>Próximos 30 días</span><b>${fmt(t.proximos_30)}</b></div>
      </div>
      ${r.incompleto?'<p role="alert" class="note">Hay más de 500 obligaciones. La lista es parcial; los totales anteriores sí incluyen todas las obligaciones.</p>':""}
      <p class="note">Importes en MXN · actualización de consulta ${esc(new Date(t.actualizado||Date.now()).toLocaleString("es-MX"))}. Los abonos se reflejan en egresos solo cuando confirmas el pago.</p>
    </section>
    <section class="card">
      <h3 id="fin-ob-titulo">Registrar obligación real</h3>
      <form id="fin-ob-form" class="cform" novalidate>
        <label class="wide">Acreedor<input name="acreedor" required maxlength="120" autocomplete="off" placeholder="Proveedor o persona"></label>
        <label class="wide">Concepto<input name="concepto" required maxlength="160" autocomplete="off" placeholder="Factura o servicio confirmado"></label>
        <label>Importe total confirmado (MXN)<input name="total" inputmode="decimal" required autocomplete="off" placeholder="0.00"></label>
        <label>Vencimiento<input name="vencimiento" type="date" required></label>
        <label>Fecha de emisión (opcional)<input name="emision" type="date"></label>
        <label>Referencia (opcional)<input name="referencia" maxlength="100" autocomplete="off"></label>
        <label class="wide">Nota privada (opcional)<textarea name="nota" maxlength="300" rows="2"></textarea></label>
        <span class="err wide" role="alert" id="fin-ob-error"></span>
        <div class="row wide"><button type="submit" class="btn btn-primary">Registrar obligación</button>
          <button type="button" class="btn btn-line" id="fin-ob-reset" hidden>Cancelar edición</button></div>
      </form>
    </section>
    <section class="card"><h3>Obligaciones e historial</h3>
      ${filas?`<div class="alist">${filas}</div>`:'<p class="note">Sin obligaciones confirmadas todavía.</p>'}
    </section>`;
    EC.bloqueN("finanzas","obligaciones",Number(t.cantidad)||0,Number(t.vencido)>0);
    EC.bloqueInfo("finanzas","obligaciones",{valor:t.pendiente!=null?fmt(t.pendiente):null,
      texto:Number(t.vencido)>0?"Hay importes vencidos":"Sin duplicar gastos"});
    const f=el.querySelector("#fin-ob-form");
    const reset=()=>{f.reset();delete f.dataset.id;delete f.dataset.version;
      creandoUid=crypto.randomUUID();el.querySelector("#fin-ob-titulo").textContent="Registrar obligación real";
      f.querySelector("[type=submit]").textContent="Registrar obligación";
      el.querySelector("#fin-ob-reset").hidden=true;el.querySelector("#fin-ob-error").textContent="";};
    reset();
    el.querySelector("#fin-ob-reset").addEventListener("click",reset);
    f.addEventListener("submit",async ev=>{
      ev.preventDefault();const b=f.querySelector("[type=submit]"),err=el.querySelector("#fin-ob-error");
      if(b.disabled)return;b.disabled=true;err.textContent="";
      try{
        const datos=Object.fromEntries(new FormData(f).entries());
        const id=f.dataset.id;
        if(id){datos.accion="editar";datos.version=Number(f.dataset.version);}
        else datos.uid=creandoUid;
        await post("finanzas/obligaciones"+(id?"/"+encodeURIComponent(id):""),datos);
        EC.toast(id?"Obligación actualizada":"Obligación registrada");
        await cargar();
      }catch(e){if(e.message!=="sesion")err.textContent=e.message;}
      finally{if(b.isConnected)b.disabled=false;}
    });
    el.querySelectorAll("[data-ob-editar]").forEach(b=>b.addEventListener("click",()=>{
      const o=lista.find(x=>x.id===b.dataset.obEditar);if(!o)return;
      f.dataset.id=o.id;f.dataset.version=o.version;
      for(const campo of ["acreedor","concepto","total","vencimiento","emision","referencia","nota"])
        f.elements.namedItem(campo).value=o[campo]??"";
      el.querySelector("#fin-ob-titulo").textContent="Editar obligación";
      f.querySelector("[type=submit]").textContent="Guardar cambios";
      el.querySelector("#fin-ob-reset").hidden=false;
      f.scrollIntoView({behavior:"smooth",block:"center"});f.elements.namedItem("acreedor").focus();
    }));
    el.querySelectorAll("[data-ob-abonar]").forEach(b=>b.addEventListener("click",async()=>{
      const o=lista.find(x=>x.id===b.dataset.obAbonar);if(!o)return;
      if(!window.agendaPagarObligacion){EC.toast("No se cargó el formulario de pagos.");return;}
      await window.agendaPagarObligacion(o);
    }));
    el.querySelectorAll("[data-ob-cancelar]").forEach(b=>b.addEventListener("click",async()=>{
      const o=lista.find(x=>x.id===b.dataset.obCancelar);if(!o)return;
      if(!(await EC.confirmar("¿Cancelar obligación?","Conservará su historial, sin borrar pagos ni movimientos.","Cancelar obligación",true)))return;
      b.disabled=true;
      try{await post("finanzas/obligaciones/"+encodeURIComponent(o.id),{accion:"cancelar",version:o.version});EC.toast("Obligación cancelada");await cargar();}
      catch(e){if(e.message!=="sesion")EC.toast(e.message);if(b.isConnected)b.disabled=false;}
    }));
  }
  async function cargar(){
    if(cargando)return;const token=++sec;cargando=true;
    const el=$("#fb-obligaciones");
    try{const r=await api("finanzas/obligaciones");if(token===sec)pintar(r);}
    catch(e){if(el&&e.message!=="sesion")el.innerHTML='<p class="note" role="alert">No se pudieron cargar las obligaciones: '+esc(e.message)+'</p>';}
    finally{cargando=false;}
  }
  document.addEventListener("modulo",e=>{if(e.detail==="finanzas")cargar();});
  document.addEventListener("obligaciones-actualizadas",cargar);
})();
