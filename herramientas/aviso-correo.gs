/**
 * Aviso por correo de nuevas solicitudes de factura (Báscula y Pensión El Castaño).
 * Se instala en script.google.com con la cuenta administracion@basculaypension.com.
 * El sitio llama a este script cuando un cliente envía el formulario, y el script
 * te manda un correo a ti mismo. También recibe el respaldo en Excel antes de
 * borrar registros con más de 90 días, y envía a cada colaborador el correo con
 * el enlace de su expediente laboral. No guarda ningún dato.
 *
 * TOKEN: cópialo igual en Cloudflare como secreto AVISO_TOKEN.
 */
const TOKEN = 'PEGA_AQUI_EL_TOKEN';

function doPost(e) {
  let datos = {};
  try { datos = JSON.parse(e.postData.contents); } catch (err) { return respuesta('error'); }
  if (!datos.token || datos.token !== TOKEN) return respuesta('no autorizado');
  const yo = Session.getEffectiveUser().getEmail();
  let destino = yo;
  let confirmacion = 'ok';
  const opciones = { name: 'Facturas El Castaño', htmlBody: String(datos.html || '') };
  // Envío a un colaborador: solo correos con su enlace personal del expediente laboral
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

function respuesta(t) { return ContentService.createTextOutput(t); }

/** Ejecuta esta función una vez desde el editor para autorizar el envío de correos. */
function probar() {
  GmailApp.sendEmail(Session.getEffectiveUser().getEmail(), 'Prueba de aviso · El Castaño', 'Si recibes esto, el aviso de solicitudes está listo.');
}
