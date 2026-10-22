// Libro de obligaciones confirmadas. Centavos enteros y pagos enlazados al libro
// existente agenda_pagos/caja_gastos; nunca se crea aquí un segundo egreso.
import { fechaReal, dineroCentavos } from "./finanzas-estados.js";
import { asegurarEsquemaBitacora, stmtBitacora, stmtBitacoraSiCambio } from "./bitacora.js";
import { idFinanciero } from "./finanzas-idempotencia.js";

const json = (obj, status=200) => new Response(JSON.stringify(obj), {status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}});
const cents = v => Number(v||0) / 100;
const nom = (v,n) => String(v||"").replace(/\s+/g," ").trim().slice(0,n);
const UID = /^[0-9a-f-]{36}$/i;
const hoyMx = () => new Intl.DateTimeFormat("en-CA",{timeZone:"America/Mexico_City"}).format(new Date());
let esquemaListo = false;
export async function asegurarEsquemaObligaciones(env) {
  if (esquemaListo) return;
  await asegurarEsquemaBitacora(env);
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS fin_obligaciones (
    id TEXT PRIMARY KEY, acreedor TEXT NOT NULL, concepto TEXT NOT NULL,
    total_centavos INTEGER NOT NULL CHECK(total_centavos > 0),
    emision TEXT, vencimiento TEXT NOT NULL, referencia TEXT, nota TEXT,
    estado TEXT NOT NULL DEFAULT 'activa' CHECK(estado IN ('activa','cancelada')),
    version INTEGER NOT NULL DEFAULT 1, creado TEXT NOT NULL, actualizado TEXT NOT NULL,
    creado_por TEXT, actualizado_por TEXT)`).run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS fin_obligaciones_vencimiento ON fin_obligaciones(estado,vencimiento)").run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS fin_obligaciones_hist (
    id TEXT PRIMARY KEY, obligacion_id TEXT NOT NULL, version INTEGER NOT NULL,
    foto TEXT NOT NULL, accion TEXT NOT NULL, cuando TEXT NOT NULL, quien TEXT,
    UNIQUE(obligacion_id,version))`).run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS fin_obligaciones_hist_ref ON fin_obligaciones_hist(obligacion_id,version)").run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS fin_obl_abonos (
    pago_id TEXT PRIMARY KEY, obligacion_id TEXT NOT NULL, importe_centavos INTEGER NOT NULL CHECK(importe_centavos>0),
    activo INTEGER NOT NULL DEFAULT 1, creado TEXT NOT NULL, creado_por TEXT, anulado_en TEXT,
    fecha_pago TEXT, forma_pago TEXT, concepto_pago TEXT)`).run();
  // Migración aditiva: en una Preview previa puede existir la tabla sin estos
  // campos. Nunca borrar/reescribir abonos ni asumir que el historial antiguo
  // contiene una fecha de pago que no se guardó.
  const campos=(await env.DB.prepare("PRAGMA table_info(fin_obl_abonos)").all()).results;
  for(const campo of ["fecha_pago","forma_pago","concepto_pago"]){
    if(campos.some(x=>x.name===campo))continue;
    try{await env.DB.prepare("ALTER TABLE fin_obl_abonos ADD COLUMN "+campo+" TEXT").run();}
    catch(er){if(!/duplicate column name/i.test(String(er?.message||"")))throw er;}
  }
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS fin_obl_abonos_obligacion ON fin_obl_abonos(obligacion_id,activo)").run();
  // Las consultas previas no son suficientes en dos sesiones simultáneas.
  // El trigger evalúa la suma vigente DENTRO del INSERT transaccional.
  await env.DB.prepare(`CREATE TRIGGER IF NOT EXISTS fin_obl_abono_validar BEFORE INSERT ON fin_obl_abonos BEGIN
    SELECT RAISE(ABORT,'OBLIGACION_NO_DISPONIBLE')
      WHERE NOT EXISTS(SELECT 1 FROM fin_obligaciones WHERE id=NEW.obligacion_id AND estado='activa');
    SELECT RAISE(ABORT,'OBLIGACION_PAGO_INVALIDO')
      WHERE NOT EXISTS(SELECT 1 FROM agenda_pagos p JOIN caja_gastos g ON g.id=p.gasto_id
        WHERE p.id=NEW.pago_id AND p.item_id='' AND g.origen='admin'
          AND ROUND(p.importe*100)=NEW.importe_centavos AND ROUND(g.monto*100)=NEW.importe_centavos);
    SELECT RAISE(ABORT,'OBLIGACION_SALDO_INSUFICIENTE')
      WHERE NEW.importe_centavos + COALESCE((SELECT SUM(importe_centavos) FROM fin_obl_abonos
        WHERE obligacion_id=NEW.obligacion_id AND activo=1),0)
        > (SELECT total_centavos FROM fin_obligaciones WHERE id=NEW.obligacion_id);
  END`).run();
  await env.DB.prepare(`CREATE TRIGGER IF NOT EXISTS fin_obl_pago_editar BEFORE UPDATE OF importe ON agenda_pagos
    WHEN EXISTS(SELECT 1 FROM fin_obl_abonos WHERE pago_id=OLD.id AND activo=1)
    BEGIN
      SELECT RAISE(ABORT,'OBLIGACION_SALDO_INSUFICIENTE') WHERE EXISTS(
        SELECT 1 FROM fin_obl_abonos a JOIN fin_obligaciones o ON o.id=a.obligacion_id
        WHERE a.pago_id=OLD.id AND a.activo=1
          AND COALESCE((SELECT SUM(b.importe_centavos) FROM fin_obl_abonos b
            WHERE b.obligacion_id=o.id AND b.activo=1 AND b.pago_id<>OLD.id),0)
              + ROUND(NEW.importe*100)>o.total_centavos
      );
  END`).run();
  await env.DB.prepare(`CREATE TRIGGER IF NOT EXISTS fin_obl_pago_actualizar AFTER UPDATE OF importe ON agenda_pagos
    BEGIN UPDATE fin_obl_abonos SET importe_centavos=ROUND(NEW.importe*100)
      WHERE pago_id=NEW.id AND activo=1; END`).run();
  await env.DB.prepare(`CREATE TRIGGER IF NOT EXISTS fin_obl_pago_snapshot_editar
    AFTER UPDATE OF fecha,forma,titulo ON agenda_pagos
    BEGIN UPDATE fin_obl_abonos
      SET fecha_pago=NEW.fecha,forma_pago=NEW.forma,concepto_pago=NEW.titulo
      WHERE pago_id=NEW.id AND activo=1;
    END`).run();
  await env.DB.prepare(`CREATE TRIGGER IF NOT EXISTS fin_obl_principal_proteger BEFORE UPDATE OF total_centavos,estado ON fin_obligaciones
    BEGIN SELECT RAISE(ABORT,'OBLIGACION_CON_ABONOS')
      WHERE (NEW.total_centavos < COALESCE((SELECT SUM(importe_centavos) FROM fin_obl_abonos
          WHERE obligacion_id=OLD.id AND activo=1),0))
        OR (NEW.estado='cancelada' AND EXISTS(SELECT 1 FROM fin_obl_abonos
          WHERE obligacion_id=OLD.id AND activo=1)); END`).run();
  esquemaListo = true;
}
export const stmtVincularAbono = (env,{pagoId,obligacionId,importeCentavos,fecha,forma,titulo,ahora,quien}) =>
  env.DB.prepare(`INSERT INTO fin_obl_abonos
    (pago_id,obligacion_id,importe_centavos,fecha_pago,forma_pago,concepto_pago,creado,creado_por)
    VALUES(?,?,?,?,?,?,?,?)`).bind(pagoId,obligacionId,importeCentavos,fecha,forma,titulo,ahora,quien);
export const errorSaldoObligacion = e => /OBLIGACION_(?:SALDO_INSUFICIENTE|NO_DISPONIBLE|PAGO_INVALIDO|CON_ABONOS)|fin_obl_abonos.pago_id/i.test(String(e?.message||""));
export async function vinculoPago(env,pagoId) {
  return env.DB.prepare("SELECT obligacion_id,importe_centavos,activo FROM fin_obl_abonos WHERE pago_id=?")
    .bind(pagoId).first();
}
function validar(c) {
  if(typeof c.acreedor!=="string"||typeof c.concepto!=="string"
    ||typeof c.vencimiento!=="string"
    ||(c.emision!=null&&typeof c.emision!=="string")
    ||(c.referencia!=null&&typeof c.referencia!=="string")
    ||(c.nota!=null&&typeof c.nota!=="string"))
    return {error:"Los campos de texto deben tener valores válidos."};
  const acreedor=nom(c.acreedor,120),concepto=nom(c.concepto,160);
  const total_centavos=dineroCentavos(c.total);
  const emision=c.emision || null,vencimiento=String(c.vencimiento||"");
  if(acreedor.length<2 || concepto.length<2) return {error:"Indica acreedor y concepto."};
  if(!Number.isSafeInteger(total_centavos)||total_centavos<=0) return {error:"Confirma un principal positivo en pesos y centavos."};
  if(!fechaReal(vencimiento)||emision && (!fechaReal(emision)||emision>vencimiento)) return {error:"Revisa emisión y vencimiento."};
  if(String(c.referencia||"").length>100||String(c.nota||"").length>300) return {error:"La referencia o nota es demasiado larga."};
  return {datos:{acreedor,concepto,total_centavos,emision,vencimiento,referencia:nom(c.referencia,100)||null,nota:nom(c.nota,300)||null}};
}
const sqlSaldos=`SELECT o.*, COALESCE((
    SELECT SUM(a.importe_centavos) FROM fin_obl_abonos a
    WHERE a.obligacion_id=o.id AND a.activo=1),0) AS pagado_centavos
  FROM fin_obligaciones o`;
export async function obligacionesRuta(request,env,partes,usuario) {
  await asegurarEsquemaObligaciones(env);
  if(request.method==="GET"&&partes.length===2){
    const todas=(await env.DB.prepare(sqlSaldos+" ORDER BY CASE WHEN o.estado='activa' THEN 0 ELSE 1 END,o.vencimiento,o.creado DESC LIMIT 501").all()).results;
    const hoy=hoyMx(),mas7=new Date(hoy+"T12:00:00Z"),mas30=new Date(mas7);
    mas7.setUTCDate(mas7.getUTCDate()+7);mas30.setUTCDate(mas30.getUTCDate()+30);
    const f7=mas7.toISOString().slice(0,10),f30=mas30.toISOString().slice(0,10);
    // El listado sí está paginado, pero el total SIEMPRE recorre todas las
    // obligaciones. Nunca publicar un indicador recortado a 500 filas.
    const agregados=await env.DB.prepare(`WITH b AS (${sqlSaldos})
      SELECT COUNT(*) AS total,
        COALESCE(SUM(CASE WHEN estado='activa' THEN MAX(0,total_centavos-pagado_centavos) ELSE 0 END),0) AS pendiente,
        COALESCE(SUM(CASE WHEN estado='activa' AND vencimiento<? THEN MAX(0,total_centavos-pagado_centavos) ELSE 0 END),0) AS vencido,
        COALESCE(SUM(CASE WHEN estado='activa' AND vencimiento>=? AND vencimiento<=? THEN MAX(0,total_centavos-pagado_centavos) ELSE 0 END),0) AS proximos_7,
        COALESCE(SUM(CASE WHEN estado='activa' AND vencimiento>=? AND vencimiento<=? THEN MAX(0,total_centavos-pagado_centavos) ELSE 0 END),0) AS proximos_30,
        COALESCE(SUM(CASE WHEN estado='activa' THEN pagado_centavos ELSE 0 END),0) AS pagado,
        COALESCE(SUM(CASE WHEN estado='activa' AND total_centavos>pagado_centavos THEN 1 ELSE 0 END),0) AS cantidad
      FROM b`).bind(hoy,hoy,f7,hoy,f30).first();
    const resto=o=>Math.max(0,o.total_centavos-o.pagado_centavos);
    return json({ok:true,incompleto:todas.length>500,
      obligaciones:todas.slice(0,500).map(o=>({...o,total:cents(o.total_centavos),pagado:cents(o.pagado_centavos),
        saldo:cents(resto(o)),situacion:o.estado==="cancelada"?"cancelada":resto(o)===0?"liquidada":o.vencimiento<hoy?"vencida":"pendiente"})),
      resumen:{pendiente:cents(agregados.pendiente),vencido:cents(agregados.vencido),
        proximos_7:cents(agregados.proximos_7),proximos_30:cents(agregados.proximos_30),
        pagado:cents(agregados.pagado),cantidad:Number(agregados.cantidad),
        actualizado:new Date().toISOString()}});
  }
  if(request.method==="GET"&&partes.length===3){
    const id=partes[2];
    if(!UID.test(id))return json({ok:false,error:"Referencia inválida."},422);
    const obligacion=await env.DB.prepare(sqlSaldos+" WHERE o.id=?").bind(id).first();
    if(!obligacion)return json({ok:false,error:"Obligación no encontrada."},404);
    const [pagos,cambios]=await Promise.all([
      env.DB.prepare(`SELECT a.pago_id,a.importe_centavos,a.activo,a.creado,a.creado_por,a.anulado_en,
        COALESCE(p.fecha,a.fecha_pago) AS fecha,
        COALESCE(p.titulo,a.concepto_pago) AS titulo,
        COALESCE(p.forma,a.forma_pago) AS forma,p.nota
        FROM fin_obl_abonos a LEFT JOIN agenda_pagos p ON p.id=a.pago_id
        WHERE a.obligacion_id=? ORDER BY a.creado DESC,a.pago_id DESC LIMIT 500`).bind(id).all(),
      env.DB.prepare("SELECT version,foto,accion,cuando,quien FROM fin_obligaciones_hist WHERE obligacion_id=? ORDER BY version DESC LIMIT 500").bind(id).all()
    ]);
    return json({ok:true,obligacion:{...obligacion,total:cents(obligacion.total_centavos),
        pagado:cents(obligacion.pagado_centavos),saldo:cents(Math.max(0,obligacion.total_centavos-obligacion.pagado_centavos))},
      abonos:pagos.results.map(x=>({...x,importe:cents(x.importe_centavos)})),
      historial:cambios.results.map(x=>{
        let foto=null;try{foto=JSON.parse(x.foto);}catch{}
        return {version:x.version,accion:x.accion,cuando:x.cuando,quien:x.quien,
          foto:foto?{...foto,total:cents(foto.total_centavos)}:null};
      }),limite:pagos.results.length>=500||cambios.results.length>=500});
  }
  if(request.method!=="POST"||partes.length<2||partes.length>3)
    return json({ok:false,error:"Ruta no permitida."},405);
  let c;try{c=await request.json();}catch{return json({ok:false,error:"Datos inválidos."},400);}
  if(!c||typeof c!=="object"||Array.isArray(c))
    return json({ok:false,error:"Se esperaba un objeto de datos válido."},400);
  const quien=usuario?.email||null,ahora=new Date().toISOString();
  if(partes.length===2){
    const v=validar(c);if(v.error)return json({ok:false,error:v.error},422);
    let id;try{id=await idFinanciero("obligacion",c.uid,quien);}catch(e){return json({ok:false,error:e.message},422);}
    const actual=await env.DB.prepare("SELECT * FROM fin_obligaciones WHERE id=?").bind(id).first();
    const d=v.datos,keys=Object.keys(d);
    if(actual){
      if(keys.every(k=>(actual[k]??null)===(d[k]??null)))return json({ok:true,id,version:actual.version,repetido:true});
      return json({ok:false,error:"El identificador ya se usó en otra obligación."},409);
    }
    try{await env.DB.batch([
      env.DB.prepare(`INSERT INTO fin_obligaciones(id,acreedor,concepto,total_centavos,emision,vencimiento,referencia,nota,creado,actualizado,creado_por,actualizado_por)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id,d.acreedor,d.concepto,d.total_centavos,d.emision,d.vencimiento,d.referencia,d.nota,ahora,ahora,quien,quien),
      env.DB.prepare(`INSERT INTO fin_obligaciones_hist(id,obligacion_id,version,foto,accion,cuando,quien)
        SELECT ?,id,version,json_object('acreedor',acreedor,'concepto',concepto,'total_centavos',total_centavos,
          'emision',emision,'vencimiento',vencimiento,'referencia',referencia,'nota',nota),
          'crear',?,? FROM fin_obligaciones WHERE id=? AND changes()>0`)
        .bind(crypto.randomUUID(),ahora,quien,id),
      stmtBitacora(env,{quien,accion:"crear",que:"Obligación",ref:id,mes:d.vencimiento.slice(0,7),
        detalle:{acreedor:d.acreedor,concepto:d.concepto,principal:cents(d.total_centavos),vencimiento:d.vencimiento}})
    ]);}catch(e){
      const previo=await env.DB.prepare("SELECT * FROM fin_obligaciones WHERE id=?").bind(id).first();
      if(previo && keys.every(k=>(previo[k]??null)===(d[k]??null)))return json({ok:true,id,version:previo.version,repetido:true});
      return json({ok:false,error:"Conflicto de creación. Actualiza antes de repetir."},409);
    }
    return json({ok:true,id,version:1});
  }
  const id=partes[2];
  if(!UID.test(id))return json({ok:false,error:"Referencia inválida."},422);
  const actual=await env.DB.prepare("SELECT * FROM fin_obligaciones WHERE id=?").bind(id).first();
  if(!actual)return json({ok:false,error:"Obligación no encontrada."},404);
  const version=Number(c.version);
  if(!Number.isSafeInteger(version)||version!==actual.version)return json({ok:false,error:"Otra sesión cambió la obligación."},409);
  if(actual.estado!=="activa")return json({ok:false,error:"Obligación cancelada."},409);
  const cancel=c.accion==="cancelar";
  if(!cancel&&c.accion!=="editar")return json({ok:false,error:"Acción no permitida."},422);
  const v=cancel?null:validar(c);
  if(v?.error)return json({ok:false,error:v.error},422);
  const d=v?.datos,keys=d?Object.keys(d):[];
  if(!cancel && keys.every(k=>(actual[k]??null)===(d[k]??null)))return json({ok:true,sin_cambios:true,version});
  const st=cancel?env.DB.prepare(`UPDATE fin_obligaciones SET estado='cancelada',version=version+1,actualizado=?,actualizado_por=?
    WHERE id=? AND version=? AND estado='activa' AND NOT EXISTS(
      SELECT 1 FROM fin_obl_abonos WHERE obligacion_id=? AND activo=1)`).bind(ahora,quien,id,version,id):
    env.DB.prepare(`UPDATE fin_obligaciones SET acreedor=?,concepto=?,total_centavos=?,emision=?,vencimiento=?,referencia=?,nota=?,
      version=version+1,actualizado=?,actualizado_por=? WHERE id=? AND version=? AND estado='activa'
      AND ? >= COALESCE((SELECT SUM(importe_centavos) FROM fin_obl_abonos
        WHERE obligacion_id=? AND activo=1),0)`).bind(d.acreedor,d.concepto,d.total_centavos,d.emision,d.vencimiento,d.referencia,d.nota,
          ahora,quien,id,version,d.total_centavos,id);
  let results;
  try{results=await env.DB.batch([st,
    env.DB.prepare(`INSERT INTO fin_obligaciones_hist(id,obligacion_id,version,foto,accion,cuando,quien)
      SELECT ?,id,version,json_object('acreedor',acreedor,'concepto',concepto,'total_centavos',total_centavos,
        'emision',emision,'vencimiento',vencimiento,'referencia',referencia,'nota',nota),
        ?,?,? FROM fin_obligaciones WHERE id=? AND changes()>0`)
      .bind(crypto.randomUUID(),cancel?"cancelar":"editar",ahora,quien,id),
    stmtBitacoraSiCambio(env,{quien,accion:cancel?"borrar":"editar",que:"Obligación",ref:id,
    mes:(d?.vencimiento||actual.vencimiento).slice(0,7),detalle:cancel?{estado:"cancelada"}:
      {acreedor:d.acreedor,principal:cents(d.total_centavos),vencimiento:d.vencimiento}})]);}
  catch(e){if(errorSaldoObligacion(e))return json({ok:false,error:"El principal no puede ser menor que sus abonos; tampoco puedes cancelar una obligación pagada."},409);throw e;}
  if(!results[0]?.meta?.changes)return json({ok:false,error:"Otra sesión registró un abono o modificó la obligación. Actualiza."},409);
  return json({ok:true,id,version:version+1});
}
