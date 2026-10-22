// Dos referencias bancarias sin asientos compensatorios.
// Un saldo mensual operativo sólo se compara con un estado que cierre el MISMO día.
// Estados que cruzan meses conservan su fecha real y no se imputan a otro periodo.
export function cotejarCuentasMes(cuentas, documentos, mes, hoy, sinCuenta = {}) {
  // Si hay salidas/entradas bancarias sin asignación, ningún saldo individual
  // puede probarse completo: una diferencia numérica sería engañosa.
  const asignacionPendiente=["pagos","transferencias"].some(k=>{
    const n=Number(sinCuenta?.[k]||0);
    return !Number.isFinite(n)||Math.abs(n)>=0.005;
  });
  const [anio,m]=mes.split("-").map(Number);
  const cierre=new Date(Date.UTC(anio,m,0)).toISOString().slice(0,10);
  const porCuenta=new Map();
  for(const r of documentos){
    if(r.fecha_corte>cierre||r.periodo_hasta>cierre)continue;
    const p=porCuenta.get(r.cuenta);
    if(!p || r.fecha_corte>p.fecha_corte || r.fecha_corte===p.fecha_corte && r.periodo_hasta>p.periodo_hasta)
      porCuenta.set(r.cuenta,r);
  }
  return cuentas.map(c=>{
    const r=porCuenta.get(c.id),calculado=Number.isFinite(Number(c.saldo))&&c.saldo!=null
      ? Math.round(Number(c.saldo)*100) : null;
    const confirmado=r?.saldo_final==null?null:Number(r.saldo_final);
    const comparable=calculado!==null&&Number.isSafeInteger(calculado)&&
      confirmado!==null&&Number.isSafeInteger(confirmado)&&
      r.fecha_corte===cierre&&r.periodo_hasta===cierre&&cierre<hoy&&!asignacionPendiente;
    const porQue=asignacionPendiente?"Hay pagos o transferencias sin cuenta asignada; no se calcula diferencia":
      !r?"Sin estado de cuenta capturado":
      confirmado===null?"Estado sin saldo final capturado":
      calculado===null?"Sin saldo calculado verificable":
      cierre>=hoy?"Mes aún sin cierre completo":
      r.fecha_corte!==cierre||r.periodo_hasta!==cierre?"Fechas distintas: no se calcula diferencia":
      "Ambos saldos corresponden al mismo cierre de mes";
    return {cuenta:c.id,nombre:c.nombre,tipo:c.tipo,
      fecha_calculo:cierre,saldo_calculado:calculado==null?null:calculado/100,
      fecha_corte_confirmada:r?.fecha_corte||null,
      periodo_estado:r?{desde:r.periodo_desde,hasta:r.periodo_hasta}:null,
      saldo_confirmado:confirmado==null?null:confirmado/100,
      comparable,diferencia:comparable?(confirmado-calculado)/100:null,
      observacion:porQue};
  });
}
