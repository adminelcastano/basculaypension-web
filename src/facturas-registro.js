// Los CFDI se emiten y cancelan en Facturador, nunca desde esta web.
// Registro informativo, histórico y compatible con las solicitudes anteriores.
export const centavos = n => Math.round(Number(n) * 100);
export function validarCfdis(datos, max = 2) {
  if (!Array.isArray(datos) || datos.length < 1 || datos.length > max) return { error: "Captura una o dos facturas." };
  const facturas = [], vistos = new Set();
  for (const d of datos) {
    const folio = String(d?.folio || "").trim();
    const raw = String(d?.importe ?? "").trim().replace(/[$,\s]/g, "");
    if (!folio || folio.length > 60 || /[\r\n<>]/.test(folio) || !/^\d{1,9}(\.\d{1,2})?$/.test(raw) ||
        !(Number(raw) > 0) || Number(raw) > 1000000)
      return { error: "Cada CFDI requiere un folio/UUID y un importe positivo válido." };
    if (vistos.has(folio.toUpperCase())) return { error: "No repitas el mismo folio de factura." };
    vistos.add(folio.toUpperCase());
    facturas.push({ folio, importe: Number(raw).toFixed(2) });
  }
  return { facturas, suma_centavos: facturas.reduce((a, f) => a + centavos(f.importe), 0) };
}
const fallo = (error, status = 422) => ({ ok: false, error, status });
export async function asegurarEsquemaCfdis(env) {
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS facturas_cfdis (id TEXT PRIMARY KEY, solicitud_id TEXT NOT NULL, folio TEXT NOT NULL, importe TEXT NOT NULL, estado TEXT NOT NULL DEFAULT 'vigente' CHECK(estado IN ('vigente','cancelada')), sustituye_id TEXT, creado TEXT NOT NULL, creado_por TEXT, cancelado_en TEXT, cancelado_por TEXT, cancelacion_motivo TEXT, UNIQUE(solicitud_id,folio))").run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS facturas_cfdis_solicitud ON facturas_cfdis(solicitud_id,creado)").run();
  // La restricción reside en SQLite, no sólo en el formulario: protege dos sesiones concurrentes.
  await env.DB.prepare("CREATE TRIGGER IF NOT EXISTS facturas_cfdis_max_dos BEFORE INSERT ON facturas_cfdis WHEN NEW.estado='vigente' AND (SELECT COUNT(*) FROM facturas_cfdis WHERE solicitud_id=NEW.solicitud_id AND estado='vigente') >= 2 BEGIN SELECT RAISE(ABORT,'LIMITE_DOS_CFDI'); END").run();
}
export async function listarCfdis(env, s) {
  const l = (await env.DB.prepare("SELECT * FROM facturas_cfdis WHERE solicitud_id=? ORDER BY creado,id").bind(s.id).all()).results;
  if (!l.length && ["facturada", "enviada"].includes(s.estado) && s.folio_factura)
    return [{ id: "legacy:" + s.id, solicitud_id: s.id, folio: s.folio_factura, importe: s.importe || "",
      estado: "vigente", creado: s.resuelta_en || s.creado || new Date().toISOString(), legacy: true, sustituye_id: null }];
  return l;
}
export async function emitirMultiples(env, s, d, quien, ahora, ticket) {
  if (!["pendiente","en_revision","rechazada"].includes(s.estado)) return fallo("La solicitud ya fue resuelta.",409);
  if (!d.confirmado_facturador) return fallo("Confirma que ya emitiste los CFDI en Facturador.");
  const v = validarCfdis(d.facturas);
  if (v.error) return fallo(v.error);
  if (v.facturas.length === 2 && Number(s.facturas_solicitadas || 1) !== 2)
    return fallo("La solicitud no pidió dos facturas. Revísala antes de emitir.");
  const importe = String(d.importe_ticket || "").trim().replace(/[$,\s]/g,"");
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(importe) || !(Number(importe)>0))
    return fallo("Verifica el importe total del ticket.");
  if (v.suma_centavos !== centavos(importe))
    return fallo("Los importes capturados no suman el total del ticket. Revisa los documentos.");
  const vence = new Date(ahora); vence.setFullYear(vence.getFullYear()+5);
  const statements = [
    env.DB.prepare("INSERT INTO facturas_folios(servicio,folio_normalizado,solicitud_id,folio_factura,creado,vence) VALUES(?,?,?,?,?,?)")
      .bind(s.servicio,ticket.normalizado,s.id,v.facturas[0].folio,ahora,vence.toISOString()),
    ...v.facturas.map(f=>env.DB.prepare("INSERT INTO facturas_cfdis(id,solicitud_id,folio,importe,creado,creado_por) VALUES(?,?,?,?,?,?)")
      .bind(crypto.randomUUID(),s.id,f.folio,f.importe,ahora,quien)),
    env.DB.prepare("UPDATE solicitudes SET estado='facturada',folio_factura=?,importe=?,folio_ticket=?,resuelta_en=?,motivo=NULL,enviada_en=NULL WHERE id=? AND estado IN ('pendiente','en_revision','rechazada')")
      .bind(v.facturas[0].folio,Number(importe).toFixed(2),ticket.original,ahora,s.id)
  ];
  try {
    const r=await env.DB.batch(statements);
    if(!r[r.length-1]?.meta?.changes) return fallo("La solicitud cambió. Actualiza antes de continuar.",409);
  } catch(e) {
    if(/UNIQUE|constraint/i.test(String(e?.message||""))) return fallo("El ticket o folio ya figura facturado; no se duplicó.",409);
    throw e;
  }
  return {ok:true};
}
export async function cancelarRegistro(env,s,d,quien,ahora) {
  if(!["facturada","enviada","cancelada"].includes(s.estado)) return fallo("No existe factura emitida.",409);
  if(d.confirmado_facturador!==true) return fallo("Primero confirma la cancelación en Facturador.");
  const motivo=String(d.motivo||"").trim();
  if(motivo.length<5||motivo.length>300) return fallo("Describe el motivo (5 a 300 caracteres).");
  const items=await listarCfdis(env,s), c=items.find(x=>x.id===d.cfdi_id);
  if(!c||c.estado!=="vigente") return fallo("Elige un CFDI vigente y actualiza la pantalla.",409);
  const statements=[];
  if(c.legacy) statements.push(env.DB.prepare("INSERT OR IGNORE INTO facturas_cfdis(id,solicitud_id,folio,importe,creado) VALUES(?,?,?,?,?)")
    .bind(c.id,s.id,c.folio,c.importe,c.creado));
  statements.push(env.DB.prepare("UPDATE facturas_cfdis SET estado='cancelada',cancelado_en=?,cancelado_por=?,cancelacion_motivo=? WHERE id=? AND solicitud_id=? AND estado='vigente'")
    .bind(ahora,quien,motivo,c.id,s.id));
  const iCancel=statements.length-1;
  statements.push(env.DB.prepare("UPDATE solicitudes SET estado=CASE WHEN EXISTS(SELECT 1 FROM facturas_cfdis WHERE solicitud_id=? AND estado='vigente') THEN 'facturada' ELSE 'cancelada' END,resuelta_en=?,enviada_en=NULL,aviso_cancelacion_en=NULL WHERE id=? AND estado IN ('facturada','enviada','cancelada')")
    .bind(s.id,ahora,s.id));
  const out=await env.DB.batch(statements);
  if(!out[iCancel]?.meta?.changes) return fallo("Este CFDI ya cambió de estado. Actualiza.",409);
  return {ok:true};
}
export async function sustituirRegistro(env,s,d,quien,ahora,ticketNormalizado) {
  const items=await listarCfdis(env,s);
  const orig=items.find(x=>x.id===d.cfdi_cancelado_id && x.estado==="cancelada");
  if(!orig) return fallo("Selecciona una factura cancelada antes de registrar sustitutos.",409);
  if(!d.confirmado_facturador) return fallo("Confirma que emitiste los sustitutos en Facturador.");
  const v=validarCfdis(d.facturas);
  if(v.error) return fallo(v.error);
  if(items.filter(x=>x.estado==="vigente"&&x.sustituye_id===orig.id).length)
    return fallo("Este CFDI ya tiene una sustitución vigente registrada.",409);
  if(items.filter(x=>x.estado==="vigente").length+v.facturas.length>2)
    return fallo("No pueden quedar más de dos CFDI vigentes por solicitud.");
  const historicos=new Set(items.map(x=>x.folio.toUpperCase()));
  if(v.facturas.some(x=>historicos.has(x.folio.toUpperCase()))) return fallo("Utiliza folios nuevos, distintos de los históricos.",409);
  if (!ticketNormalizado) return fallo("Se necesita el folio del ticket original.",422);
  const reservado=await env.DB.prepare("SELECT solicitud_id FROM facturas_folios WHERE servicio=? AND folio_normalizado=?").bind(s.servicio,ticketNormalizado).first();
  if (reservado && reservado.solicitud_id !== s.id) return fallo("El ticket está reservado por otra solicitud. No se registraron sustitutos.",409);
  const vence=new Date(ahora); vence.setFullYear(vence.getFullYear()+5);
  const statements=[
    ...(!reservado ? [env.DB.prepare("INSERT INTO facturas_folios(servicio,folio_normalizado,solicitud_id,folio_factura,creado,vence) VALUES (?,?,?,?,?,?)").bind(s.servicio,ticketNormalizado,s.id,v.facturas[0].folio,ahora,vence.toISOString())] : []),
    ...v.facturas.map(f=>env.DB.prepare("INSERT INTO facturas_cfdis(id,solicitud_id,folio,importe,estado,sustituye_id,creado,creado_por) VALUES(?,?,?,?,'vigente',?,?,?)")
      .bind(crypto.randomUUID(),s.id,f.folio,f.importe,orig.id,ahora,quien)),
    env.DB.prepare("UPDATE solicitudes SET estado='facturada',folio_factura=?,resuelta_en=?,enviada_en=NULL,aviso_cancelacion_en=NULL WHERE id=? AND estado IN ('facturada','enviada','cancelada')")
      .bind(v.facturas[0].folio,ahora,s.id),
    env.DB.prepare("UPDATE facturas_folios SET folio_factura=? WHERE servicio=? AND folio_normalizado=? AND solicitud_id=?")
      .bind(v.facturas[0].folio,s.servicio,ticketNormalizado,s.id)
  ];
  try{
    const out=await env.DB.batch(statements);
    if(!out[out.length-1]?.meta?.changes) return fallo("La reserva del ticket no corresponde a esta solicitud. Revisa el expediente.",409);
  }catch(e){
    if(/UNIQUE|constraint/i.test(String(e?.message||"")))return fallo("El folio ya existe, actualiza la solicitud.",409);
    throw e;
  }
  return {ok:true};
}
