// Puente de salarios: SOLO refleja gastos ya capturados, jamás crea otro egreso.
// No infiere a quién se pagó. Requiere vinculación explícita y doble habilitación
// antes de enviar filas al Sheet privado SALARIOS mediante Apps Script.
import { asegurarEsquemaBitacora,stmtBitacoraSiCambio } from "./bitacora.js";
import { scriptArchivos } from "./fotos.js";
import { leerRetiros, claseHoja, conceptoHoja } from "./caja.js";
const json=(x,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}});
const ID=/^[a-z0-9][a-z0-9_:-]{2,79}$/i;
export const validarPagoSalario = (r) => r && r.id && /^\d{4}-\d{2}-\d{2}$/.test(r.dia||"") &&
  Number.isFinite(Number(r.monto)) && Number(r.monto)>0 && r.categoria==="Sueldos";
export async function asegurarEsquemaSalarios(env){
  await asegurarEsquemaBitacora(env);
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS fin_nomina_vinculos (gasto_id TEXT PRIMARY KEY,colaborador_id TEXT NOT NULL, revisado_en TEXT NOT NULL,revisado_por TEXT, importe_centavos INTEGER NOT NULL, fecha_fuente TEXT NOT NULL, concepto_fuente TEXT NOT NULL, origen_fuente TEXT NOT NULL DEFAULT '', forma_fuente TEXT NOT NULL DEFAULT '', cuenta_fuente TEXT NOT NULL DEFAULT '', sincronizado_en TEXT)").run();
}
async function leerPagos(env){
  const datos=(await env.DB.prepare("SELECT id,mes,dia,concepto,monto,origen,forma,cuenta,categoria FROM caja_gastos WHERE categoria='Sueldos' ORDER BY dia DESC,creado DESC LIMIT 400").all()).results;
  const vinculos=(await env.DB.prepare("SELECT gasto_id,colaborador_id,revisado_en,sincronizado_en,importe_centavos,fecha_fuente,concepto_fuente,origen_fuente,forma_fuente,cuenta_fuente FROM fin_nomina_vinculos").all()).results;
  const por=Object.fromEntries(vinculos.map(x=>[x.gasto_id,x]));
  return datos.filter(validarPagoSalario).map(x=>({...x,vinculo:por[x.id]||null,
    vinculo_actual:!por[x.id]||(por[x.id].importe_centavos===Math.round(x.monto*100)&&por[x.id].fecha_fuente===x.dia&&por[x.id].concepto_fuente===x.concepto&&por[x.id].origen_fuente===(x.origen||'')&&por[x.id].forma_fuente===(x.forma||'')&&por[x.id].cuenta_fuente===(x.cuenta||''))}));
}
// Un corte o un renglón importado NO equivale a un pago individual verificado.
// Sólo se muestran candidatos con palabras explícitas; no se crean IDs persistentes
// ni vínculos de colaborador porque el origen puede editarse/reimportarse.
const esConceptoSueldo=t=>/(sueldo|salario|n[oó]mina)/i.test(String(t||""));
export function candidatosSalariales(cortes,hoja,gastos) {
  const candidatos=[];
  for(const c of cortes||[]) {
    const retiros=leerRetiros(c.retiros);
    retiros.forEach((r,i)=>{
      if(!esConceptoSueldo(r.concepto))return;
      candidatos.push({origen:"Retiro de corte",dia:c.dia,turno:c.turno||"",concepto:r.concepto,
        monto:r.monto,orden:i+1});
    });
  }
  for(const m of hoja||[]) {
    if(claseHoja(m)!=="gasto")continue;
    const concepto=conceptoHoja(m);
    if(!esConceptoSueldo(concepto))continue;
    candidatos.push({origen:"Hoja de caja",dia:m.dia,turno:m.turno||"",concepto,
      monto:Math.round(-Number(m.importe)*100)/100});
  }
  for(const c of candidatos) {
    const empates=(gastos||[]).filter(g=>g.dia===c.dia&&Math.round(g.monto*100)===Math.round(c.monto*100));
    const otros=candidatos.filter(x=>x!==c&&x.dia===c.dia&&Math.round(x.monto*100)===Math.round(c.monto*100));
    c.posible_duplicado=empates.length>0||otros.length>0;
    c.solo_revision=true;
  }
  return candidatos.sort((a,b)=>b.dia.localeCompare(a.dia)).slice(0,120);
}
async function buscarCandidatos(env,gastos) {
  // Ventana acotada, ningún dato de un periodo histórico se reescribe.
  const limite=new Date(Date.now()-90*86400000).toISOString().slice(0,10);
  const [cortes,hoja]=await Promise.all([
    env.DB.prepare("SELECT dia,turno,retiros FROM turno_cortes WHERE dia>=? AND retiros IS NOT NULL ORDER BY dia DESC,turno LIMIT 300").bind(limite).all(),
    env.DB.prepare("SELECT dia,turno,tipo,folio,cliente,matricula,importe FROM caja_mov WHERE tipo='caja' AND dia>=? ORDER BY dia DESC LIMIT 500").bind(limite).all()
  ]);
  return candidatosSalariales(cortes.results,hoja.results,gastos);
}
const activo=env=>env.SALARIOS_SYNC_ACTIVE==="SI"&&!!env.AVISO_URL&&!!env.AVISO_TOKEN;
export async function rutaSalarios(request,env,partes,usuario){
  await asegurarEsquemaSalarios(env);
  const habilitado=activo(env);
  if(request.method==="GET"&&partes.length===2){
    const pagos=await leerPagos(env);
    const candidatos=await buscarCandidatos(env,pagos);
    const huerfanos=(await env.DB.prepare("SELECT v.gasto_id FROM fin_nomina_vinculos v LEFT JOIN caja_gastos g ON g.id=v.gasto_id WHERE g.id IS NULL OR g.categoria!='Sueldos' OR g.dia!=v.fecha_fuente OR g.concepto!=v.concepto_fuente OR CAST(ROUND(g.monto*100) AS INTEGER)!=v.importe_centavos OR COALESCE(g.origen,'')!=v.origen_fuente OR COALESCE(g.forma,'')!=v.forma_fuente OR COALESCE(g.cuenta,'')!=v.cuenta_fuente").all()).results.length;
    let empleados=[],aviso=null;
    if(habilitado)try{
      const r=await scriptArchivos(env,{accion:"salarios",op:"catalogo"},20000);
      empleados=r.colaboradores||[];
    }catch{aviso="La conexión privada SALARIOS no está disponible. No se enviaron pagos.";}
    return json({ok:true,habilitado,empleados,pagos,candidatos,huerfanos,
      aviso:huerfanos?String(huerfanos)+" referencia(s) salariales borradas, reclasificadas o corregidas. Conciliar antes de sincronizar.":aviso||(!habilitado?"Sincronización SALARIOS suspendida; puedes consultar pagos ya registrados sin duplicarlos.":"Los pagos sin colaborador confirmado no se sincronizan."),
      fuentes_no_vinculadas:"Los retiros de cortes y renglones de hoja se muestran como candidatos, no como pagos confirmados. No se sincronizan con SALARIOS."});
  }
  if(request.method!=="POST"||partes.length!==3)return json({ok:false,error:"Operación no permitida."},405);
  if(!habilitado)return json({ok:false,error:"La conexión de SALARIOS está suspendida. Ningún dato se escribió en Google Sheets."},409);
  let c;try{c=await request.json();}catch{return json({ok:false,error:"Datos inválidos."},400);}
  const quien=usuario?.email||null,ahora=new Date().toISOString();
  if(partes[2]==="vincular"){
    const pagoId=String(c.gasto_id||""), colaborador=String(c.colaborador_id||"");
    if(!ID.test(pagoId)||!ID.test(colaborador))return json({ok:false,error:"Selecciona un pago y un colaborador válidos."},422);
    const pago=await env.DB.prepare("SELECT id,dia,monto,concepto,origen,forma,cuenta,categoria FROM caja_gastos WHERE id=?").bind(pagoId).first();
    if(!validarPagoSalario(pago))return json({ok:false,error:"El movimiento ya no corresponde a Sueldos. Actualiza Finanzas."},409);
    // Verificar el ID contra la hoja privada. No comparar nombres por inferencia.
    const catalogo=await scriptArchivos(env,{accion:"salarios",op:"catalogo"},20000);
    if(!(catalogo.colaboradores||[]).some(x=>x.id===colaborador))
      return json({ok:false,error:"El colaborador no figura en la hoja SALARIOS. Verifica el identificador."},409);
    const previa=await env.DB.prepare("SELECT * FROM fin_nomina_vinculos WHERE gasto_id=?").bind(pagoId).first();
    if(previa?.sincronizado_en)return json({ok:false,error:"Ya está en SALARIOS. No se puede reasignar silenciosamente: requiere procedimiento de corrección."},409);
    const centavos=Math.round(Number(pago.monto)*100);
    if(previa?.colaborador_id===colaborador&&previa.importe_centavos===centavos&&previa.fecha_fuente===pago.dia&&previa.concepto_fuente===pago.concepto&&previa.origen_fuente===(pago.origen||'')&&previa.forma_fuente===(pago.forma||'')&&previa.cuenta_fuente===(pago.cuenta||''))return json({ok:true,sin_cambios:true});
    const r=await env.DB.batch([
      env.DB.prepare("INSERT INTO fin_nomina_vinculos(gasto_id,colaborador_id,revisado_en,revisado_por,importe_centavos,fecha_fuente,concepto_fuente,origen_fuente,forma_fuente,cuenta_fuente) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(gasto_id) DO UPDATE SET colaborador_id=excluded.colaborador_id,revisado_en=excluded.revisado_en,revisado_por=excluded.revisado_por,importe_centavos=excluded.importe_centavos,fecha_fuente=excluded.fecha_fuente,concepto_fuente=excluded.concepto_fuente,origen_fuente=excluded.origen_fuente,forma_fuente=excluded.forma_fuente,cuenta_fuente=excluded.cuenta_fuente WHERE fin_nomina_vinculos.sincronizado_en IS NULL")
        .bind(pagoId,colaborador,ahora,quien,centavos,pago.dia,pago.concepto,pago.origen||'',pago.forma||'',pago.cuenta||''),
      stmtBitacoraSiCambio(env,{quien,accion:previa?"editar":"crear",que:"Vinculación de sueldo",ref:pagoId,mes:pago.dia.slice(0,7),detalle:{colaborador_id:colaborador}})
    ]);
    if(!r[0]?.meta?.changes)return json({ok:false,error:"El pago cambió de vinculación mientras guardabas."},409);
    return json({ok:true});
  }
  if(partes[2]==="sincronizar"){
    if(c.confirmado!==true)return json({ok:false,error:"Confirma que revisaste los pagos y su colaborador."},422);
    const orf=await env.DB.prepare("SELECT 1 FROM fin_nomina_vinculos v LEFT JOIN caja_gastos g ON g.id=v.gasto_id WHERE g.id IS NULL OR g.categoria!='Sueldos' OR g.dia!=v.fecha_fuente OR g.concepto!=v.concepto_fuente OR CAST(ROUND(g.monto*100) AS INTEGER)!=v.importe_centavos OR COALESCE(g.origen,'')!=v.origen_fuente OR COALESCE(g.forma,'')!=v.forma_fuente OR COALESCE(g.cuenta,'')!=v.cuenta_fuente LIMIT 1").first();
    if(orf)return json({ok:false,error:"Existen pagos vinculados cuyo origen se borró, reclasificó o corrigió. Concilia antes de sincronizar."},409);
    const todos=await leerPagos(env);
    if(todos.some(x=>x.vinculo&&x.vinculo.sincronizado_en&&!x.vinculo_actual))return json({ok:false,error:'Un pago ya sincronizado fue modificado en su origen. Requiere conciliación manual.'},409);
    const pendientes=todos.filter(x=>x.vinculo&&!x.vinculo.sincronizado_en);
    if(pendientes.some(x=>!x.vinculo_actual))return json({ok:false,error:'Un sueldo fue modificado después de vincularlo. Revisa y confirma al colaborador nuevamente.'},409);
    if(!pendientes.length)return json({ok:true,sin_cambios:true});
    const lote=pendientes.slice(0,40);
    const filas=lote.map(x=>({id:x.id,fecha:x.dia,origen:"caja_gastos",concepto:x.concepto,
      importe:Number(x.monto),colaborador_id:x.vinculo.colaborador_id,forma:x.forma||'',cuenta:x.cuenta||''}));
    // Apps Script anexa por ID; reintentos idénticos no duplican pagos. Ante
    // fallo de red, las filas ya guardadas se recuperan en el siguiente intento.
    const r=await scriptArchivos(env,{accion:"salarios",op:"pagos",filas},60000);
    const aceptados=new Set(r.aceptados||[]);
    if(lote.some(x=>!aceptados.has(x.id)))return json({ok:false,error:"Google no confirmó todos los registros. Reintenta sin crear nuevos gastos."},503);
    const stmts=lote.map(x=>env.DB.prepare("UPDATE fin_nomina_vinculos SET sincronizado_en=? WHERE gasto_id=? AND colaborador_id=? AND sincronizado_en IS NULL")
      .bind(ahora,x.id,x.vinculo.colaborador_id));
    await env.DB.batch(stmts);
    return json({ok:true,sincronizados:lote.length,pendientes:pendientes.length-lote.length});
  }
  return json({ok:false,error:"Ruta no encontrada."},404);
}
