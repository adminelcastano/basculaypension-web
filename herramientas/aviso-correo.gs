/**
 * Script de Báscula y Pensión El Castaño (script.google.com, cuenta administracion@basculaypension.com).
 * - Te avisa por correo de nuevas solicitudes de factura y de expedientes del personal.
 * - Recibe el respaldo en Excel antes de borrar registros con más de 90 días.
 * - Envía a colaboradores y al encargado de turno los correos con su enlace de expediente.
 * - Guarda una copia de los documentos del personal en Google Drive:
 *   COLABORADORES / EXTERNOS → carpeta de cada persona (la busca por su número) → documentos.
 *
 * TOKEN: cópialo igual en Cloudflare como secreto AVISO_TOKEN.
 */
const TOKEN = 'PEGA_AQUI_EL_TOKEN';

function doPost(e) {
  let datos = {};
  try { datos = JSON.parse(e.postData.contents); } catch (err) { return respuesta('error'); }
  if (!datos.token || datos.token !== TOKEN) return respuesta('no autorizado');
  if (datos.accion === 'drive') {
    try { return respuesta(drive(datos)); } catch (err) { return respuesta('error drive: ' + err.message); }
  }
  const yo = Session.getEffectiveUser().getEmail();
  let destino = yo;
  let confirmacion = 'ok';
  const opciones = { name: 'Facturas El Castaño', htmlBody: String(datos.html || '') };
  // Envío a otra persona: solo correos con un enlace del expediente
  if (datos.para) {
    const para = String(datos.para).trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(para)) return respuesta('correo inválido');
    if (String(datos.html || '').indexOf('https://basculaypension.com/expediente/') === -1) return respuesta('no autorizado');
    destino = para;
    opciones.name = 'Báscula y Pensión El Castaño';
    opciones.replyTo = yo;
    confirmacion = 'ok-para';
  }
  if (datos.adjunto && datos.adjunto.base64) {
    opciones.attachments = [Utilities.newBlob(Utilities.base64Decode(datos.adjunto.base64), datos.adjunto.tipo, datos.adjunto.nombre)];
  }
  GmailApp.sendEmail(destino, String(datos.asunto || 'Nueva solicitud de factura').slice(0, 200), String(datos.texto || ''), opciones);
  return respuesta(confirmacion);
}

// ---- Copia en Drive ----
// Carpetas creadas por la oficina: COLABORADORES y EXTERNOS, con una carpeta por persona
// cuyo nombre empieza con su número (ej. "001_JPL_010224 Juan Pérez López").
// El script solo sube documentos: busca la carpeta por número y nunca la renombra.
// Si alguien nuevo aún no tiene carpeta, la crea una sola vez al subir su primer documento.
const CARPETA_COLABORADORES = '1erpAnbQmscqHW_JiwtRMTOX_K6o12vhB';
const CARPETA_EXTERNOS = '1IoBUDd1YET3ZlvK7YyHNmtgSo9OCedQi';

function carpetaDePersona(d) {
  const props = PropertiesService.getScriptProperties();
  const llave = 'c_' + d.id;
  const fid = props.getProperty(llave);
  if (fid) { try { const c = DriveApp.getFolderById(fid); if (!c.isTrashed()) return c; } catch (err) {} }
  const grupo = DriveApp.getFolderById(d.tipo === 'externo' ? CARPETA_EXTERNOS : CARPETA_COLABORADORES);
  const num = String(d.num || '');
  let carpeta = null;
  if (num) {
    const it = grupo.getFolders();
    while (it.hasNext()) { const c = it.next(); const n = c.getName(); if (n.indexOf(num + '_') === 0 || n.indexOf(num + ' ') === 0 || n === num) { carpeta = c; break; } }
  }
  if (!carpeta) carpeta = grupo.createFolder(String(d.carpeta || num || d.id));
  props.setProperty(llave, carpeta.getId());
  return carpeta;
}

function drive(d) {
  const props = PropertiesService.getScriptProperties();
  if (d.op === 'probar') { DriveApp.getFolderById(CARPETA_COLABORADORES).getName(); DriveApp.getFolderById(CARPETA_EXTERNOS).getName(); return 'ok-drive'; }
  if (!d.id || !/^[0-9a-f-]{36}$/.test(d.id)) return 'error drive: id';
  if (d.op === 'carpeta' || d.op === 'borrar-carpeta') return 'ok-drive'; // la oficina administra las carpetas
  const llaveArchivo = 'f_' + d.id + '_' + String(d.slot || '');
  const anterior = props.getProperty(llaveArchivo);
  if (anterior) { try { DriveApp.getFileById(anterior).setTrashed(true); } catch (err) {} props.deleteProperty(llaveArchivo); }
  if (d.op === 'borrar') return 'ok-drive';
  if (d.op === 'subir') {
    const carpeta = carpetaDePersona(d);
    const blob = Utilities.newBlob(Utilities.base64Decode(d.base64), d.tipoArchivo || 'application/octet-stream', String(d.nombre || 'documento'));
    const archivo = carpeta.createFile(blob);
    props.setProperty(llaveArchivo, archivo.getId());
    return 'ok-drive';
  }
  return 'error drive: operación';
}

function respuesta(t) { return ContentService.createTextOutput(t); }

/** Ejecuta esta función una vez desde el editor para autorizar correo y Drive. */
function probar() {
  DriveApp.getFolderById(CARPETA_COLABORADORES).getName();
  DriveApp.getFolderById(CARPETA_EXTERNOS).getName();
  GmailApp.sendEmail(Session.getEffectiveUser().getEmail(), 'Prueba de aviso · El Castaño', 'Si recibes esto, el aviso de solicitudes y la carpeta de Drive están listos.');
}
