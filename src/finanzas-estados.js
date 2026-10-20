// Estados de cuenta capturados MANUALMENTE, independientes del libro de movimientos.
// La captura informa conciliación: jamás aumenta ingresos, gastos, dinero ni deuda.
import { asegurarEsquemaBitacora, stmtBitacoraSiCambio } from "./bitacora.js";
const respuesta = (o,s=200)=>new Response(JSON.stringify(o),{status:s,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}});
const DIA=/^\d{4}-\d{2}-\d{2}$/;
export const fechaReal = s => typeof s==="string" && DIA.test(s) && !Number.isNaN(Date.parse(s+"T12:00:00Z")) &&
  new Date(s+"T12:00:00Z").toISOString().slice(0,10)===s;
export function dineroCentavos(x,{opcional=false}={}) {
  if(opcional && (x==null||x==="")) return null;
  const s=String(x??"").trim().replace(/[$,\s]/g,"");
  if(!/^\d{1,9}(\.\d{1,2})?$/.test(s))return NaN;
  const [p,c=""]=s.split(".");
  const v=Number(p)*100+Number(c.padEnd(2,"0"));
  return Number.isSafeInteger(v)&&v<=10000000000?v:NaN;
}
const pesos=v=>v==null?null:Number((v/100).toFixed(2));
const CAMPOS=["saldo_inicial","saldo_final","cargos","abonos","comisiones","intereses","iva","pago_minimo","pago_sin_intereses"];
const COLS=["cuenta","periodo_desde","periodo_hasta","fecha_corte","fecha_pago_limite",...CAMPOS,"nota"];
export function calcularEstado(e,tipo) {
  const completo=["saldo_inicial","saldo_final","cargos","abonos"].every(k=>Number.isSafeInteger(e[k]));
  const calculado=completo?e.saldo_inicial+(tipo==="credito"?e.cargos-e.abonos:e.abonos-e.cargos):null;
  return {...e,saldo_calculado_centavos:calculado,diferencia_centavos:calculado==null?null:e.saldo_final-calculado,
    comprobacion:calculado==null?"incompleto":calculado===e.saldo_final?"cuadra":"revisar"};
}
export function validarEstado(c,cuenta) {
  if(!cuenta||!["credito","debito"].includes(cuenta.tipo))return{error:"Selecciona una cuenta o tarjeta válida."};
  if(!fechaReal(c.periodo_desde)||!fechaReal(c.periodo_hasta)||c.periodo_desde>c.periodo_hasta)
    return{error:"Revisa las fechas reales del periodo del estado de cuenta."};
  if(!fechaReal(c.fecha_corte)||c.fecha_corte<c.periodo_desde||c.fecha_corte>c.periodo_hasta)
    return{error:"La fecha de corte debe estar dentro del periodo."};
  if(c.fecha_pago_limite&&(!fechaReal(c.fecha_pago_limite)||c.fecha_pago_limite<c.fecha_corte))
    return{error:"La fecha límite de pago no es válida."};
  const valores={};
  for(const campo of CAMPOS){
    valores[campo]=dineroCentavos(c[campo],{opcional:true});
    if(Number.isNaN(valores[campo]))return{error:"Revisa el valor de "+campo.replaceAll("_"," ")+". Utiliza pesos y centavos."};
  }
  if(cuenta.tipo!=="credito"&&(valores.pago_minimo!=null||valores.pago_sin_intereses!=null))
    return{error:"Los pagos mínimos sólo corresponden a cuentas de crédito."};
  // El desglose está YA incluido en los cargos; nunca se suma dos veces.
  if(valores.cargos!=null && (valores.comisiones||0)+(valores.intereses||0)+(valores.iva||0)>valores.cargos)
    return{error:"El desglose de intereses, IVA y comisiones excede los cargos."};
  if(String(c.nota||"").length>300)return{error:"La nota es demasiado larga."};
  return{datos:{cuenta:cuenta.id,periodo_desde:c.periodo_desde,periodo_hasta:c.periodo_hasta,
    fecha_corte:c.fecha_corte,fecha_pago_limite:c.fecha_pago_limite||null,...valores,nota:String(c.nota||"").trim()}};
}
export async function asegurarEsquemaEstados(env) {
  await asegurarEsquemaBitacora(env);
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS fin_estados_cuenta (id TEXT PRIMARY KEY, cuenta TEXT NOT NULL, periodo_desde TEXT NOT NULL, periodo_hasta TEXT NOT NULL, fecha_corte TEXT NOT NULL, fecha_pago_limite TEXT, saldo_inicial INTEGER, saldo_final INTEGER, cargos INTEGER, abonos INTEGER, comisiones INTEGER, intereses INTEGER, iva INTEGER, pago_minimo INTEGER, pago_sin_intereses INTEGER, nota TEXT NOT NULL DEFAULT '', version INTEGER NOT NULL DEFAULT 1, creado TEXT NOT NULL, actualizado TEXT NOT NULL, creado_por TEXT, actualizado_por TEXT, UNIQUE(cuenta,periodo_desde,periodo_hasta))").run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS fin_estados_cuenta_fecha ON fin_estados_cuenta(cuenta,periodo_hasta)").run();
  await env.DB.prepare("CREATE TRIGGER IF NOT EXISTS fin_estados_no_solape_insert BEFORE INSERT ON fin_estados_cuenta WHEN EXISTS(SELECT 1 FROM fin_estados_cuenta WHERE cuenta=NEW.cuenta AND periodo_desde<=NEW.periodo_hasta AND periodo_hasta>=NEW.periodo_desde) BEGIN SELECT RAISE(ABORT,'PERIODO_SUPERPUESTO'); END").run();
  await env.DB.prepare("CREATE TRIGGER IF NOT EXISTS fin_estados_no_solape_update BEFORE UPDATE OF periodo_desde,periodo_hasta,cuenta ON fin_estados_cuenta WHEN EXISTS(SELECT 1 FROM fin_estados_cuenta WHERE cuenta=NEW.cuenta AND id!=OLD.id AND periodo_desde<=NEW.periodo_hasta AND periodo_hasta>=NEW.periodo_desde) BEGIN SELECT RAISE(ABORT,'PERIODO_SUPERPUESTO'); END").run();
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS fin_estados_cuenta_hist (id TEXT PRIMARY KEY, estado_id TEXT NOT NULL, version INTEGER NOT NULL, foto TEXT NOT NULL, cuando TEXT NOT NULL, quien TEXT, UNIQUE(estado_id,version))").run();
}
export async function estadosCuentaRuta(request,env,partes,usuario) {
  await asegurarEsquemaEstados(env);
  if(request.method==="GET" && partes.length===2) {
    const [accounts,list]=await Promise.all([
      env.DB.prepare("SELECT id,nombre,tipo,activa FROM fin_cuentas ORDER BY orden,nombre").all(),
      env.DB.prepare("SELECT * FROM fin_estados_cuenta ORDER BY periodo_hasta DESC,cuenta LIMIT 240").all()
    ]);
    const por=Object.fromEntries(accounts.results.map(x=>[x.id,x]));
    return respuesta({ok:true,cuentas:accounts.results,estados:list.results.map(row=>{
      const v=calcularEstado(row,por[row.cuenta]?.tipo||"debito");
      return {...v,...Object.fromEntries(CAMPOS.map(k=>[k,pesos(v[k])])),saldo_calculado:pesos(v.saldo_calculado_centavos),diferencia:pesos(v.diferencia_centavos)};
    })});
  }
  if(request.method!=="POST"||partes.length!==2)return respuesta({ok:false,error:"Operación no permitida."},405);
  let c;try{c=await request.json();}catch{return respuesta({ok:false,error:"Datos inválidos."},400);}
  const cuentaId=String(c.cuenta||"");
  const cuenta=await env.DB.prepare("SELECT id,nombre,tipo,activa FROM fin_cuentas WHERE id=?").bind(cuentaId).first();
  if(!cuenta||!cuenta.activa)return respuesta({ok:false,error:"Cuenta no disponible; actualiza Finanzas."},409);
  const validacion=validarEstado(c,cuenta);
  if(validacion.error)return respuesta({ok:false,error:validacion.error},422);
  const datos=validacion.datos,ahora=new Date().toISOString(),quien=usuario?.email||null;
  const id=String(c.id||"");
  if(id&&!/^[a-z0-9-]{36}$/i.test(id))return respuesta({ok:false,error:"Identificador de registro inválido."},422);
  const previo=id?await env.DB.prepare("SELECT * FROM fin_estados_cuenta WHERE id=?").bind(id).first():null;
  if(id&&!previo)return respuesta({ok:false,error:"Registro inexistente. Actualiza Finanzas."},404);
  if(previo&&previo.cuenta!==cuentaId)return respuesta({ok:false,error:"No se puede cambiar la cuenta del estado guardado."},409);
  const solape=await env.DB.prepare("SELECT id FROM fin_estados_cuenta WHERE cuenta=? AND id!=? AND periodo_desde<=? AND periodo_hasta>=? LIMIT 1")
    .bind(cuentaId,id,datos.periodo_hasta,datos.periodo_desde).first();
  if(solape)return respuesta({ok:false,error:"Existe otro estado de esa cuenta con fechas superpuestas."},409);
  if(previo&&(!Number.isSafeInteger(Number(c.version))||Number(c.version)!==previo.version))
    return respuesta({ok:false,error:"Otra sesión cambió este registro. Actualiza antes de editar."},409);
  const key=id||crypto.randomUUID(),values=COLS.map(k=>datos[k]??null);
  if(previo&&COLS.every(k=>(previo[k]??null)===(datos[k]??null)))return respuesta({ok:true,sin_cambios:true,id:key,version:previo.version});
  const revision=previo?previo.version+1:1;
  const sql=previo?"UPDATE fin_estados_cuenta SET "+COLS.map(k=>k+"=?").join(",")+",version=version+1,actualizado=?,actualizado_por=? WHERE id=? AND version=?":
    "INSERT INTO fin_estados_cuenta(id,"+COLS.join(",")+",version,creado,actualizado,creado_por,actualizado_por) VALUES("+Array(COLS.length+6).fill("?").join(",")+")";
  const primero=previo?env.DB.prepare(sql).bind(...values,ahora,quien,key,previo.version):
    env.DB.prepare(sql).bind(key,...values,1,ahora,ahora,quien,quien);
  const stmts=[primero,
    env.DB.prepare("INSERT INTO fin_estados_cuenta_hist(id,estado_id,version,foto,cuando,quien) SELECT ?,?,?,?,?,? WHERE changes()>0")
      .bind(crypto.randomUUID(),key,revision,JSON.stringify(Object.fromEntries(COLS.map(k=>[k,datos[k]??null]))),ahora,quien),
    stmtBitacoraSiCambio(env,{quien,accion:previo?"editar":"crear",que:"Estado de cuenta",ref:key,
      mes:datos.periodo_hasta.slice(0,7),detalle:{cuenta:cuenta.nombre,periodo:datos.periodo_desde+" a "+datos.periodo_hasta,version:revision}})
  ];
  try{
    const resultado=await env.DB.batch(stmts);
    if(!resultado[0]?.meta?.changes)return respuesta({ok:false,error:"El estado cambió en otra sesión; recarga antes de guardar."},409);
  }catch(e){
    if(/UNIQUE|constraint/i.test(String(e?.message||"")))return respuesta({ok:false,error:"Periodo duplicado o edición concurrente. Actualiza antes de guardar."},409);
    throw e;
  }
  return respuesta({ok:true,id:key,version:revision});
}
