/**
 * Script de Báscula y Pensión El Castaño (script.google.com, cuenta administracion@basculaypension.com).
 * - Te avisa por correo de nuevas solicitudes de factura y de expedientes del personal.
 * - Recibe el respaldo en Excel antes de borrar registros con más de 90 días.
 * - Envía a colaboradores y al encargado de turno los correos con su enlace de expediente.
 * - Guarda una copia de los documentos del personal en Google Drive:
 *   carpeta raíz → COLABORADORES / EXTERNOS → "<folio> <nombre>" → documentos.
 *
 * TOKEN: cópialo igual en Cloudflare como secreto AVISO_TOKEN.
 */
const TOKEN = 'PEGA_AQUI_EL_TOKEN';
const CARPETA_RAIZ = '1EqXZ8H4reTabdzR8P3bwH-9qDz19019I';

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
function drive(d) {
  const props = PropertiesService.getScriptProperties();
  const raiz = DriveApp.getFolderById(CARPETA_RAIZ);
  if (d.op === 'probar') { raiz.getName(); return 'ok-drive'; }
  if (!d.id || !/^[0-9a-f-]{36}$/.test(d.id)) return 'error drive: id';

  const llave = 'c_' + d.id;
  let carpeta = null;
  const fid = props.getProperty(llave);
  if (fid) { try { carpeta = DriveApp.getFolderById(fid); if (carpeta.isTrashed()) carpeta = null; } catch (err) { carpeta = null; } }

  if (d.op === 'borrar-carpeta') {
    if (carpeta) carpeta.setTrashed(true);
    props.deleteProperty(llave);
    return 'ok-drive';
  }
  if (!carpeta) {
    const grupoNombre = d.tipo === 'externo' ? 'EXTERNOS' : 'COLABORADORES';
    const it = raiz.getFoldersByName(grupoNombre);
    const grupo = it.hasNext() ? it.next() : raiz.createFolder(grupoNombre);
    carpeta = grupo.createFolder(String(d.carpeta || d.id));
    props.setProperty(llave, carpeta.getId());
  }
  if (d.carpeta && carpeta.getName() !== d.carpeta) carpeta.setName(d.carpeta); // el folio puede cambiar (nombre o fecha de ingreso)
  if (d.op === 'carpeta') return 'ok-drive';

  const llaveArchivo = 'f_' + d.id + '_' + String(d.slot || '');
  const anterior = props.getProperty(llaveArchivo);
  if (anterior) { try { DriveApp.getFileById(anterior).setTrashed(true); } catch (err) {} props.deleteProperty(llaveArchivo); }
  if (d.op === 'borrar') return 'ok-drive';

  if (d.op === 'subir') {
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
  DriveApp.getFolderById(CARPETA_RAIZ).getName();
  GmailApp.sendEmail(Session.getEffectiveUser().getEmail(), 'Prueba de aviso · El Castaño', 'Si recibes esto, el aviso de solicitudes y la carpeta de Drive están listos.');
}
