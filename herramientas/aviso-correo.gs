/**
 * Aviso por correo de nuevas solicitudes de factura (Báscula y Pensión El Castaño).
 * Se instala en script.google.com con la cuenta administracion@basculaypension.com.
 * El sitio llama a este script cuando un cliente envía el formulario, y el script
 * te manda un correo a ti mismo. No guarda ningún dato.
 *
 * TOKEN: cópialo igual en Cloudflare como secreto AVISO_TOKEN.
 */
const TOKEN = 'PEGA_AQUI_EL_TOKEN';

function doPost(e) {
  let datos = {};
  try { datos = JSON.parse(e.postData.contents); } catch (err) { return respuesta('error'); }
  if (!datos.token || datos.token !== TOKEN) return respuesta('no autorizado');
  const destino = Session.getEffectiveUser().getEmail();
  GmailApp.sendEmail(destino, String(datos.asunto || 'Nueva solicitud de factura').slice(0, 200), String(datos.texto || ''), {
    name: 'Facturas El Castaño',
    htmlBody: String(datos.html || '')
  });
  return respuesta('ok');
}

function respuesta(t) { return ContentService.createTextOutput(t); }

/** Ejecuta esta función una vez desde el editor para autorizar el envío de correos. */
function probar() {
  GmailApp.sendEmail(Session.getEffectiveUser().getEmail(), 'Prueba de aviso · El Castaño', 'Si recibes esto, el aviso de solicitudes está listo.');
}
