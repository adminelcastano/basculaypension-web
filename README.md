# Báscula y Pensión El Castaño

Página web de basculaypension.com. Sitio estático en `public/`, sin compilación. Se publica en Cloudflare Workers (archivos estáticos) con la configuración de `wrangler.jsonc`.

## Cambiar datos del negocio

Al final de `public/index.html` está el bloque `NEGOCIO` con WhatsApp, teléfono, correo, dirección, enlace de Google Maps y horarios. Al cambiar un valor ahí, la página se actualiza en todos los lugares donde aparece. Los campos vacíos (tarifas, capacidad, plazo de factura) no se muestran.

## Publicación

Cloudflare publica automáticamente cada cambio en la rama `main` (comando de despliegue: `npx wrangler deploy`).

## Archivos (en `public/`)

- `index.html`: la página.
- `404.html`: página para enlaces que no existen.
- `fonts/`: tipografía Barlow servida desde el propio sitio (licencia en `fonts/OFL.txt`).
- `favicon.svg`, `favicon-32.png`, `apple-touch-icon.png`: íconos.
- `og-image.png`: imagen que aparece al compartir el enlace por WhatsApp o redes.
- `robots.txt`, `sitemap.xml`: para buscadores.
- `_headers`: cabeceras de seguridad y caché.

## Panel: Facturación y Personal

`/panel` (protegido con Cloudflare Access) tiene dos secciones:

- **Facturación**: solicitudes de factura (Pendientes, Facturadas, Rechazadas, Histórico).
- **Personal**: expediente laboral de colaboradores. Se da de alta al colaborador con nombre y WhatsApp; el panel genera un enlace personal (`/expediente/<código>`) que se le envía por WhatsApp para que suba la foto de sus documentos (INE frente y reverso, CURP, solicitud de empleo, acta de nacimiento, comprobante de domicilio y comprobante de estudios) y llene sus datos (personales, domicilio, un contacto de emergencia y escolaridad). Cada foto subida palomea su documento y se lee con Workers AI para llenar los campos vacíos. Las fotos se guardan en KV (`x:<id>:<archivo>`) y se borran al eliminar la ficha. También se pueden palomear a mano en el panel. Al crearlo se elige su nacionalidad (Nacional: INE; Naturalizado: pasaporte o tarjeta de residente) y, si tiene correo, se le envía el enlace por correo con el script de `herramientas/aviso-correo.gs` (que solo envía a terceros correos con enlace /expediente/); el WhatsApp se abre con el mensaje listo. Cada colaborador está Activo o Inactivo (con fecha y motivo de baja); el enlace de un inactivo deja de funcionar. Código en `src/personal.js` y `src/expediente.html`; datos en la tabla `colaboradores` de D1.
- **Ingresos y gastos**: cortes por día y turno (mañana 6–14 h, tarde 14–22 h, noche 22–6 h) con los ingresos del mes actual de la hoja de Google "BASCULA Y PENSION 2026" (pestañas FORBAS y FORPEN). El script `herramientas/ingresos-hoja.gs` va pegado en esa hoja y publicado como aplicación web; el Worker lo consulta cada 10 minutos (cron `*/10 * * * *`, secretos `INGRESOS_URL` e `INGRESOS_TOKEN`) y con el botón "Actualizar ahora". Solo suman efectivo y tarjeta; prepago y transferencia se muestran pero no suman. Los registros sin folio numérico (cambio, retiros, sueldos, compras) se tratan como movimientos de caja: se ven aparte y no cuentan como ingresos. Los gastos se capturan en el panel (tabla `caja_gastos`). Las transferencias (cliente, importe, fecha y factura opcional) también se capturan en el panel (tabla `caja_transf`); suman a los ingresos pero no a la caja de ningún turno. Todo se puede filtrar por periodo (hoy, ayer, 7 días, mes o fechas), incluido el Excel. Cada registro va al turno que dice la hoja, en el día cuyo horario de ese turno queda más cerca (una NOCHE de las 2 a.m. cuenta en la noche anterior). Al cambiar de mes se envía por correo el Excel del mes anterior (cortes, báscula, pensión y gastos, leído completo de la hoja) y luego se borra del panel; si el correo falla no se borra nada. Código en `src/caja.js`.


En cada ficha: botón "Recordar lo que falta" (correo + WhatsApp listo) y, en la lista, "Recordar a incompletos" (solo correo). La fecha límite se guarda en KV (`cfg:personal`); el cron de las 14:47 UTC (8:47 en Tapachula) manda el recordatorio automático dos días antes, una sola vez. Con el expediente completo se habilita "Descargar expediente PDF" (se arma en el navegador con pdf-lib de cdnjs, con fotos y PDFs anexos). "Documentos administrativos": PDFs o imágenes que sube la administración, con descripción libre y fecha (KV `xa:<id>:<doc>`, lista en la columna `admin_docs`).

Externos (lavado de trailers, venta de ropa o comida): mismo módulo con el selector Colaboradores / Externos (columna `tipo`). Se les pide INE/identificación, CURP, comprobante de domicilio y fotografía (cámara frontal), y una actividad en lugar de puesto; el correo es opcional y no se les pide escolaridad.

Folio: número consecutivo único (columna `num`) + iniciales del nombre (sin de/del/la/y) + fecha de ingreso DDMMAA para colaboradores (`001_JPL_010224`); externos sin fecha (`002_RM`). Externos: no se les envía nada; el registro y los avisos de estatus (registro completo, pendiente, baja, reactivado) van al encargado de turno: entrada@basculaypension.com y WhatsApp 962 216 5453 (constantes en `src/personal.js`).

Copia en Google Drive: el Apps Script (`herramientas/aviso-correo.gs`, acción `drive`) guarda cada documento en la carpeta raíz → COLABORADORES / EXTERNOS → "<folio> <nombre>". Se activa desde el panel con «Probar conexión con Drive» (`cfg.drive`); «Copiar a Drive» en cada ficha copia lo ya subido. Las relaciones carpeta/archivo se guardan en las propiedades del script.
