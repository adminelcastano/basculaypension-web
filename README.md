# Báscula y Pensión El Castaño

Página web de basculaypension.com. Sitio estático en `public/`, sin compilación. Se publica en Cloudflare Workers (archivos estáticos) con la configuración de `wrangler.jsonc`.

## Cambiar datos del negocio

Al final de `public/index.html` está el bloque `NEGOCIO` con WhatsApp, teléfono, correo, dirección, enlace de Google Maps y horarios. Al cambiar un valor ahí, la página se actualiza en todos los lugares donde aparece. Los campos vacíos (tarifas, capacidad, plazo de factura) no se muestran.

## Publicación

Cloudflare publica automáticamente cada cambio en la rama `main` (comando de despliegue: `npx wrangler deploy`).

Plan: **Workers Paid** (5 USD al mes, desde el 14 oct 2026). `wrangler.jsonc` fija `limits.cpu_ms` en 30 000; si el plan se cancela, el despliegue falla en lugar de publicar algo que no cabe en el plan gratuito.

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
- **Inicio** (sección por defecto): tablero del día con ingresos de hoy, facturas pendientes, efectivo en caja del turno en curso, gastos de hoy, expedientes incompletos, acciones rápidas, gráficas circulares (forma de pago, servicio, solicitudes de factura), comparativo del turno, ingresos de la semana con promedio y resumen de la agenda. Colores validados para daltonismo sobre fondo oscuro.
- **Agenda**: calendario de eventos, por hacer, compras e incidencias (tabla `agenda_items`, código en `src/agenda.js`). Eventos y tareas pueden llevar recordatorio por correo (15 min, 1 h o 1 día antes; se revisa cada 10 minutos) y cada mañana a las 8:47 llega el resumen del día si hay pendientes.
- Un solo botón **Sincronizar** arriba lee la hoja de ingresos y recarga todas las secciones.
- **Ingresos y gastos**: cortes por día y turno (mañana 6–14 h, tarde 14–22 h, noche 22–6 h) con los ingresos del mes actual de la hoja de Google "BASCULA Y PENSION 2026" (pestañas FORBAS y FORPEN). El script `herramientas/ingresos-hoja.gs` va pegado en esa hoja y publicado como aplicación web; el Worker lo consulta cada 10 minutos (cron `*/10 * * * *`, secretos `INGRESOS_URL` e `INGRESOS_TOKEN`) y con el botón "Actualizar ahora". Solo suman efectivo y tarjeta; prepago y transferencia se muestran pero no suman. Los registros sin folio numérico (cambio, retiros, sueldos, compras) se tratan como movimientos de caja: se ven aparte y no cuentan como ingresos. Los gastos se capturan en el panel (tabla `caja_gastos`). Las transferencias (cliente, importe, fecha y factura opcional) también se capturan en el panel (tabla `caja_transf`); suman a los ingresos pero no a la caja de ningún turno. Todo se puede filtrar por periodo (hoy, ayer, 7 días, mes o fechas), incluido el Excel. Cada registro va al turno que dice la hoja, en el día cuyo horario de ese turno queda más cerca (una NOCHE de las 2 a.m. cuenta en la noche anterior). Al cambiar de mes se envía por correo el Excel del mes anterior (cortes, báscula, pensión y gastos, leído completo de la hoja) y luego se borra del panel; si el correo falla no se borra nada. Código en `src/caja.js`.


En cada ficha: botón "Recordar lo que falta" (correo + WhatsApp listo) y, en la lista, "Recordar a incompletos" (solo correo). La fecha límite se guarda en KV (`cfg:personal`); el cron de las 14:47 UTC (8:47 en Tapachula) manda el recordatorio automático dos días antes, una sola vez. Con el expediente completo se habilita "Descargar expediente PDF" (se arma en el navegador con pdf-lib de cdnjs, con fotos y PDFs anexos). "Documentos administrativos": PDFs o imágenes que sube la administración, con descripción libre y fecha (KV `xa:<id>:<doc>`, lista en la columna `admin_docs`).

Externos (lavado de trailers, venta de ropa o comida): mismo módulo con el selector Colaboradores / Externos (columna `tipo`). Se les pide INE/identificación, CURP, comprobante de domicilio y fotografía (cámara frontal), y una actividad en lugar de puesto; el correo es opcional y no se les pide escolaridad.

Folio: número consecutivo único (columna `num`) + iniciales del nombre (sin de/del/la/y) + fecha de ingreso DDMMAA para colaboradores (`001_JPL_010224`); externos sin fecha (`002_RM`). Externos: no se les envía nada; el registro y los avisos de estatus (registro completo, pendiente, baja, reactivado) van al encargado de turno: entrada@basculaypension.com y WhatsApp 962 216 5453 (constantes en `src/personal.js`).

Copia en Google Drive: el Apps Script (`herramientas/aviso-correo.gs`, acción `drive`) guarda cada documento en la carpeta raíz → COLABORADORES / EXTERNOS → "<folio> <nombre>". Se activa desde el panel con «Probar conexión con Drive» (`cfg.drive`); «Copiar a Drive» en cada ficha copia lo ya subido. Las relaciones carpeta/archivo se guardan en las propiedades del script.

## Tablet de turno (`/turno`)

Para el encargado de turno. Entra con la cuenta `entrada@basculaypension.com` (Cloudflare Access) y luego cada encargado elige su nombre, su turno y escribe su PIN de 4 números. Cinco PIN equivocados bloquean a esa persona 15 minutos; tras 30 minutos sin tocar la tablet se cierra la sesión.

- **Avisos**: los publica la administración en Agenda → Avisos; cada encargado marca "Enterado" y el panel muestra quién ya lo leyó.
- **Tareas**: las tareas de la Agenda marcadas "Que la haga el encargado (tablet)", opcionalmente solo para un turno. Se cierran con comentario y foto opcional.
- **Incidencias**: con área, gravedad y foto opcional. Las graves mandan correo al momento.
- **Gastos de caja chica**: en efectivo, siempre con foto del comprobante. Entran directo a Ingresos y gastos, a nombre del encargado.
- **Corte ciego**: el encargado captura el efectivo contado (sin fondo) y, si quiere, los vouchers. No ve lo esperado; el panel muestra la diferencia en Ingresos y gastos y en Agenda → Tablet de turno.

Los encargados y sus PIN se administran en Agenda → Tablet de turno. Cambiar un PIN cierra al momento la sesión abierta de esa persona. Las fotos se guardan 100 días como máximo. En la Agenda, lo terminado (tareas hechas, compras, incidencias resueltas, avisos archivados) y los eventos pasados se borran por completo a los 30 días, con sus fotos; lo que sigue abierto no se toca. Las fotos de gastos se borran con el cierre de mes de Ingresos y gastos.
