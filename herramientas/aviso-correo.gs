/**
 * Script de Báscula y Pensión El Castaño (script.google.com, cuenta administracion@basculaypension.com).
 * - Te avisa por correo de nuevas solicitudes de factura y de expedientes del personal.
 * - Envía a colaboradores y al encargado de turno los correos con su enlace de expediente.
 * - Guarda una copia de los documentos del personal en Google Drive:
 *   COLABORADORES / EXTERNOS → carpeta de cada persona (la busca por su número) → documentos.
 * - Crea cada mes los reportes en Google Sheets, uno por área y cada uno en su carpeta: TURNOS, ADMIN FINANZAS y
 *   FACTURACION (constante CARPETAS_REPORTES). También guarda ahí el respaldo de las facturas que se borran a los 90 días.
 * - Es el almacén de fotos y PDFs del panel y la tablet: carpeta dedicada "El Castaño · Archivos del panel"
 *   en el Drive de esta cuenta (tickets y constancias, expedientes, fotos de la tablet). No la renombres;
 *   puedes moverla de lugar dentro de tu Drive.
 *
 * TOKEN: cópialo igual en Cloudflare como secreto AVISO_TOKEN.
 */
// Mismo valor configurado en Cloudflare; nunca incluirlo en Git ni en logs.
const TOKEN = () => PropertiesService.getScriptProperties().getProperty('AVISO_TOKEN');

function doPost(e) {
  let datos = {};
  try { datos = JSON.parse(e.postData.contents); } catch (err) { return respuesta('error'); }
  const tokenActual = TOKEN();
  if (!tokenActual || !datos.token || datos.token !== tokenActual) return respuesta('no autorizado');
  if (datos.accion === 'archivos') {
    try { return json(archivos(datos)); } catch (err) { return json({ ok: false, error: String(err && err.message || err).slice(0, 200) }); }
  }
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
// Carpetas de los reportes mensuales (las de 2026). Para otro año se usa (o se crea) una carpeta hermana con el
// mismo nombre y el año cambiado, por ejemplo "TURNOS 2027" junto a "TURNOS 2026".
const CARPETAS_REPORTES = {
  turnos: '1SaOmOySTHHSg2Yh6rk6yM5E-JCIS3rkZ',      // TURNOS 2026
  finanzas: '1o66iaZDsvCumHzyUGX2sSW78SlXxw4Om',    // ADMIN FINANZAS 2026
  facturacion: '10UnjBm4XAiOB3zhm6510ocrgl6UZz8P6'  // FACTURACION 2026
};

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
  if (d.op === 'borrar') {
    if (anterior) {
      DriveApp.getFileById(anterior).setTrashed(true);
      props.deleteProperty(llaveArchivo);
    }
    return 'ok-drive';
  }
  if (d.op === 'subir') {
    const carpeta = carpetaDePersona(d);
    const blob = Utilities.newBlob(Utilities.base64Decode(d.base64), d.tipoArchivo || 'application/octet-stream', String(d.nombre || 'documento'));
    // Conservar el documento anterior si falla la carga o la actualización del índice.
    const archivo = carpeta.createFile(blob);
    props.setProperty(llaveArchivo, archivo.getId());
    if (anterior && anterior !== archivo.getId()) {
      // La copia nueva ya quedó registrada: si falla la papelera, conservar ambas copias.
      try { DriveApp.getFileById(anterior).setTrashed(true); } catch (err) {}
    }
    return 'ok-drive';
  }
  return 'error drive: operación';
}

function respuesta(t) { return ContentService.createTextOutput(t); }
function json(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

// ---- Almacén de archivos del panel (carpeta dedicada) ----
function raizArchivos(nombre) {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('raiz_archivos');
  if (id) { try { const c = DriveApp.getFolderById(id); if (!c.isTrashed()) return c; } catch (err) {} }
  const it = DriveApp.getFoldersByName(nombre);
  const c = it.hasNext() ? it.next() : DriveApp.createFolder(nombre);
  props.setProperty('raiz_archivos', c.getId());
  return c;
}
function subcarpeta(raiz, ruta) {
  const props = PropertiesService.getScriptProperties();
  let actual = raiz, camino = '';
  for (const parte of (ruta || [])) {
    const n = String(parte).replace(/[\\/]/g, '-').slice(0, 120);
    if (!n) continue;
    camino += '/' + n;
    const llave = 'sc_' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, camino));
    const id = props.getProperty(llave);
    let c = null;
    if (id) { try { c = DriveApp.getFolderById(id); if (c.isTrashed()) c = null; } catch (err) { c = null; } }
    if (!c) { const it = actual.getFoldersByName(n); c = it.hasNext() ? it.next() : actual.createFolder(n); props.setProperty(llave, c.getId()); }
    actual = c;
  }
  return actual;
}
function archivos(d) {
  if (d.op === 'probar') { const r = raizArchivos(String(d.raiz || 'El Castaño · Archivos del panel')); return { ok: true, url: r.getUrl() }; }
  if (d.op === 'guardar') {
    const nombre = String(d.nombre || 'archivo');
    const operacion = String(d.operacion || '');
    if (operacion && !/^[0-9a-f]{64}$/.test(operacion)) return { ok: false, error: 'operación inválida' };
    const marca = operacion ? 'castano-operacion-v1:' + operacion : '';
    // La búsqueda y la creación deben ser una unidad lógica: dos reintentos
    // simultáneos no pueden crear dos IDs diferentes para la misma operación.
    const lock = marca ? LockService.getScriptLock() : null;
    if (lock) lock.waitLock(15000);
    try {
      const carpeta = subcarpeta(raizArchivos(String(d.raiz || 'El Castaño · Archivos del panel')), d.carpeta);
      if (marca) {
        const encontrados = carpeta.getFilesByName(nombre);
        while (encontrados.hasNext()) {
          const previo = encontrados.next();
          if (!previo.isTrashed() && previo.getDescription() === marca) {
            return { ok: true, id: previo.getId(), repetido: true };
          }
        }
      }
      const blob = Utilities.newBlob(Utilities.base64Decode(d.base64), d.tipoArchivo || 'application/octet-stream', nombre);
      const creado = carpeta.createFile(blob);
      if (marca) {
        try { creado.setDescription(marca); }
        catch (err) {
          // Nunca retirar un documento anterior cuando falla el etiquetado.
          try { creado.setTrashed(true); } catch (limpiezaErr) {}
          throw err;
        }
      }
      return { ok: true, id: creado.getId() };
    } finally { if (lock) lock.releaseLock(); }
  }
  if (d.op === 'hoja') return hojaMensual(d);
  if (!d.id || !/^[A-Za-z0-9_-]{10,}$/.test(String(d.id))) return { ok: false, error: 'id inválido' };
  const archivo = DriveApp.getFileById(String(d.id));
  // Solo archivos que están dentro de la carpeta dedicada
  if (!dentroDeRaiz(archivo)) return { ok: false, error: 'fuera de la carpeta del panel' };
  if (d.op === 'leer') { const b = archivo.getBlob(); return { ok: true, tipo: b.getContentType(), base64: Utilities.base64Encode(b.getBytes()) }; }
  if (d.op === 'borrar') { archivo.setTrashed(true); return { ok: true }; }
  return { ok: false, error: 'operación' };
}
// ---- Reporte mensual en Google Sheets ----
// Carpeta "El Castaño · Reportes mensuales" / AAAA. Si ya existe la hoja de ese mes, la anterior va a la papelera.
function carpetaReportes(nombre, anio) {
  const props = PropertiesService.getScriptProperties();
  let raiz = null;
  const id = props.getProperty('raiz_reportes');
  if (id) { try { raiz = DriveApp.getFolderById(id); if (raiz.isTrashed()) raiz = null; } catch (err) { raiz = null; } }
  if (!raiz) { const it = DriveApp.getFoldersByName(nombre); raiz = it.hasNext() ? it.next() : DriveApp.createFolder(nombre); props.setProperty('raiz_reportes', raiz.getId()); }
  if (!anio) return raiz;
  const it = raiz.getFoldersByName(String(anio));
  return it.hasNext() ? it.next() : raiz.createFolder(String(anio));
}
// Carpeta del área para un año: la de la constante, o su hermana con el año cambiado (se crea si no existe)
function carpetaArea(destino, anio) {
  const base = DriveApp.getFolderById(CARPETAS_REPORTES[destino]);
  const nombre = base.getName(), m = nombre.match(/(19|20)\d{2}/);
  if (!anio || !m || m[0] === String(anio)) return base;
  const props = PropertiesService.getScriptProperties(), llave = 'rep_' + destino + '_' + anio;
  const id = props.getProperty(llave);
  if (id) { try { const c = DriveApp.getFolderById(id); if (!c.isTrashed()) return c; } catch (err) {} }
  const otro = nombre.replace(m[0], String(anio));
  const padres = base.getParents(), padre = padres.hasNext() ? padres.next() : DriveApp.getRootFolder();
  const it = padre.getFoldersByName(otro);
  const c = it.hasNext() ? it.next() : padre.createFolder(otro);
  props.setProperty(llave, c.getId());
  return c;
}
function hojaMensual(d) {
  const nombre = String(d.nombre || 'Reporte').slice(0, 150);
  const destino = CARPETAS_REPORTES[d.destino] ? String(d.destino) : '';
  const carpeta = destino ? carpetaArea(destino, String(d.anio || '')) : carpetaReportes(String(d.raiz || 'El Castaño · Reportes mensuales'), (d.carpeta || [])[0]);
  // Primero crear y completar el nuevo reporte. Si falla, conservar el anterior intacto.
  const ss = SpreadsheetApp.create(nombre);
  const hojas = d.hojas || [];
  hojas.forEach(function (h, i) {
    const sh = i === 0 ? ss.getSheets()[0].setName(String(h.nombre).slice(0, 90)) : ss.insertSheet(String(h.nombre).slice(0, 90));
    const filas = h.filas || [];
    if (!filas.length) return;
    const ancho = filas.reduce(function (m, f) { return Math.max(m, f.length); }, 1);
    const datos = filas.map(function (f) { const r = f.slice(); while (r.length < ancho) r.push(''); return r; });
    sh.getRange(1, 1, datos.length, ancho).setValues(datos);
    sh.getRange(1, 1, 1, ancho).setFontWeight('bold').setBackground('#fff4c2');
    sh.setFrozenRows(1);
    if (datos.length < 2000) sh.autoResizeColumns(1, ancho);
  });
  const archivo = DriveApp.getFileById(ss.getId());
  archivo.moveTo(carpeta);
  // Sólo después de guardar el nuevo reporte correctamente, archivar versiones anteriores.
  // Google Drive puede devolver también el nuevo archivo en esta consulta: nunca eliminarlo.
  const viejos = carpeta.getFilesByName(nombre);
  while (viejos.hasNext()) {
    const previo = viejos.next();
    if (previo.getId() !== ss.getId()) previo.setTrashed(true);
  }
  return { ok: true, id: ss.getId(), url: ss.getUrl(), destino: destino || null };
}

function dentroDeRaiz(archivo) {
  const raiz = PropertiesService.getScriptProperties().getProperty('raiz_archivos');
  const vistos = {};
  let pendientes = [archivo.getParents()];
  for (let n = 0; n < 8 && pendientes.length; n++) {
    const sig = [];
    for (const it of pendientes) while (it.hasNext()) { const c = it.next(); const id = c.getId(); if (id === raiz) return true; if (!vistos[id]) { vistos[id] = 1; sig.push(c.getParents()); } }
    pendientes = sig;
  }
  return false;
}

/**
 * Verificación no destructiva; nunca envía correos, crea hojas ni borra archivos.
 * El token solo se verifica como presente y nunca se imprime.
 */
function probar() {
  const resultados = [];
  const verificar = (nombre, id) => {
    try {
      const carpeta = DriveApp.getFolderById(id);
      resultados.push(nombre + ': ' + (carpeta.isTrashed() ? 'ERROR' : 'OK'));
    } catch {
      resultados.push(nombre + ': ERROR');
    }
  };
  resultados.push('AVISO_TOKEN: ' + (TOKEN() ? 'CONFIGURADO' : 'FALTA'));
  verificar('COLABORADORES', CARPETA_COLABORADORES);
  verificar('EXTERNOS', CARPETA_EXTERNOS);
  verificar('TURNOS', CARPETAS_REPORTES.turnos);
  verificar('ADMIN FINANZAS', CARPETAS_REPORTES.finanzas);
  verificar('FACTURACION', CARPETAS_REPORTES.facturacion);
  try {
    resultados.push('ARCHIVOS DEL PANEL: ' +
      (DriveApp.getFoldersByName('El Castaño · Archivos del panel').hasNext() ? 'OK' : 'NO ENCONTRADO'));
  } catch { resultados.push('ARCHIVOS DEL PANEL: ERROR'); }
  try {
    const carpeta = DriveApp.getFolderById(CARPETAS_REPORTES.finanzas);
    const hojas = carpeta.getFilesByName('Finanzas 2026-10 · El Castaño');
    if (!hojas.hasNext()) throw new Error('Hoja no encontrada');
    SpreadsheetApp.openById(hojas.next().getId()).getSheets();
    resultados.push('GOOGLE SHEETS: OK');
  } catch { resultados.push('GOOGLE SHEETS: ERROR'); }
  resultados.forEach(x => Logger.log(x));
}
