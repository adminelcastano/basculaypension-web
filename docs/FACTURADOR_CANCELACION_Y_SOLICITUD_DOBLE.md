# Facturación informativa — una o dos facturas, cancelaciones y sustitutos

**Estado:** desarrollo en PR #42 (borrador), no publicado. Base: `main@008f1860`. Este módulo **no emite ni cancela CFDI en Facturador o SAT**.

## Cliente: una sola solicitud

El formulario público de `/factura/` mantiene las preguntas y la evidencia actuales: servicio, foto del ticket, folio, CSF o datos escritos, uso CFDI, forma de pago, correo, WhatsApp opcional y privacidad. Añade:

- **Una factura**, predeterminada.
- **Solicitar dos facturas**, con aclaración opcional de 300 caracteres. No exige dividir importes ni enviar por segunda vez CSF/ticket.
- Se conserva **un folio de solicitud**. La opción de dos se envía a administración como intención, no autorización fiscal.

El umbral de $1,999 expresado por el contador **no se transforma en regla automática**. Administración revisa si procede conforme al caso y al procedimiento de su contador. Se evita crear CFDI como remedio automático para requisitos de deducción.

## Administración: información confirmada fuera de la web

1. Revisa foto, folio de ticket, datos fiscales e importe del documento; decide emitir uno o dos CFDI.
2. Emite los comprobantes **en Facturador externo**.
3. Registra cada folio/UUID y su importe manualmente. En una solicitud de dos facturas, el sistema comprueba que la suma de importes ingresados corresponda al total del ticket **sin calcular ni sugerir una división**.
4. Si una factura debe cancelarse, el administrador realiza primero la cancelación fiscal fuera de la web; confirma que ya está cancelada y registra el motivo. **No existe botón de comunicación al SAT**.
5. Los folios anteriores se conservan con estado de cancelada, motivo, fecha y responsable; los sustitutos ya emitidos se registran por separado vinculados al CFDI cancelado.
6. La sección prepara un texto de WhatsApp o un correo para abrir en el programa de correo del administrador. **Ningún mensaje se envía automáticamente.** Se marca «Avisé al cliente» únicamente después del aviso real.

## Integridad

- `solicitudes`: se añaden campos `facturas_solicitadas`, `facturas_motivo`, `aviso_cancelacion_en` y `aviso_cancelacion_por` sin cambiar las rutas ni valores anteriores.
- `facturas_cfdis`: tabla nueva vinculada a la solicitud, con folio, importe, fecha, autor, estado, cancelación y vínculo `sustituye_id`. Mantiene lo emitido aunque la factura deje de estar vigente.
- `facturas_folios`: reserva original de servicio+ticket continúa activa; la cancelación no la elimina. Las sustituciones solo se permiten para esa misma solicitud.
- Máximo dos CFDI **vigentes** por solicitud, protegido además por un disparador SQLite para impedir carreras entre pestañas. Se pueden conservar CFDI históricos cancelados.
- Facturas anteriores a la ampliación aparecen como «legacy», por lectura, **sin reinterpretar automáticamente la D1**. Al confirmar cancelación, el registro histórico se materializa conservando su folio original.
- `enviada` sigue significando confirmación humana de entrega, no envío automático.
- El reporte mensual incorpora una hoja «CFDI registrados» con folios, importes, estados, cancelaciones y vínculos; no modifica los reportes archivados anteriormente.

## Límites y revisión previa a publicación

- Las cancelaciones son informativas y dependen de que el administrador confirme la operación real externa; la web no consulta el estado del SAT.
- `mailto:` abre el cliente de correo configurado; WhatsApp abre un mensaje preparado. La confirmación de aviso no certifica recepción por el cliente.
- **Retención:** el sistema existente archiva y elimina solicitudes resueltas a los 90 días tras respaldo confirmado en Sheets. Los CFDI vinculados permanecen en la tabla nueva; las solicitudes en estado `cancelada` no se purgan mientras exista una cancelación sin resolución. Antes de implantar una conservación indefinida de datos personales habrá que definir una política de retención explícita.
- No hay pruebas con sesiones reales, celular físico ni Facturador auténtico. Las pruebas del backend usan SQLite ficticia.
- No realizar merge, despliegue Cloudflare ni mutaciones productivas sin autorización posterior.

## Archivos del cambio

`public/factura/index.html`, `src/worker.js`, `src/facturas-registro.js`, `src/panel/cliente/01-facturacion.js`, `src/panel/pagina.html`, `src/panel/estilos.css`, `src/reporte.js`, pruebas existentes actualizadas y pruebas de CFDI sintéticos.
