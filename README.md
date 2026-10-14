# Báscula y Pensión El Castaño

Página web de basculaypension.com. Sitio estático en `public/`, sin compilación. Se publica en Cloudflare Workers (archivos estáticos) con la configuración de `wrangler.jsonc`.

## Cambiar datos del negocio

Al final de `public/index.html` está el bloque `NEGOCIO` con WhatsApp, teléfono, correo, dirección, enlace de Google Maps y horarios. Al cambiar un valor ahí, la página se actualiza en todos los lugares donde aparece. Los campos vacíos (tarifas, capacidad, plazo de factura) no se muestran.

## Publicación

Cloudflare publica automáticamente cada cambio en la rama `main` (comando de despliegue: `npx wrangler deploy`).

Plan: **Workers Paid** (5 USD al mes, desde el 14 oct 2026). `wrangler.jsonc` fija `limits.cpu_ms` en 30 000; si el plan se cancela, el despliegue falla en lugar de publicar algo que no cabe en el plan gratuito.

Workers AI (lectura de tickets y documentos) tiene tope diario de 9 000 neuronas (`src/neuronas.js`), debajo de las 10 000 gratis, para que nunca genere cobro. Al llegar al tope, la lectura automática se apaga hasta las 6 p.m. de Tapachula (00:00 UTC) y los datos se capturan a mano; lo demás sigue funcionando.

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
- **Ingresos y gastos**: cortes por día y turno (mañana 6–14 h, tarde 14–22 h, noche 22–6 h) con los ingresos del mes actual de la hoja de Google "BASCULA Y PENSION 2026" (pestañas FORBAS y FORPEN). El script `herramientas/ingresos-hoja.gs` va pegado en esa hoja y publicado como aplicación web; el Worker lo consulta cada 10 minutos (cron `*/10 * * * *`, secretos `INGRESOS_URL` e `INGRESOS_TOKEN`) y con el botón "Actualizar ahora". Solo suman efectivo y tarjeta; prepago y transferencia se muestran pero no suman. Los registros sin folio numérico (retiros, sueldos, compras) se tratan como movimientos de caja: se ven aparte y no cuentan como ingresos. El **cambio inicial** (registro que dice CAMBIO o FONDO en folio, cliente, matrícula o forma de pago) se suma siempre al efectivo en caja del turno, aunque la forma de pago venga vacía, y no cuenta como ingreso; el corte ciego se compara sin él porque el encargado cuenta sin fondo. Los gastos se capturan en el panel (tabla `caja_gastos`). Las transferencias (cliente, importe, fecha y factura opcional) también se capturan en el panel (tabla `caja_transf`); suman a los ingresos pero no a la caja de ningún turno. Todo se puede filtrar por periodo (hoy, ayer, 7 días, mes o fechas), incluido el Excel. Cada registro va al turno que dice la hoja, en el día cuyo horario de ese turno queda más cerca (una NOCHE de las 2 a.m. cuenta en la noche anterior). Al cambiar de mes se envía por correo el Excel del mes anterior (cortes, báscula, pensión y gastos, leído completo de la hoja) y luego se borra del panel; si el correo falla no se borra nada. Código en `src/caja.js`.


En cada ficha: botón "Recordar lo que falta" (correo + WhatsApp listo) y, en la lista, "Recordar a incompletos" (solo correo). La fecha límite se guarda en KV (`cfg:personal`); el cron de las 14:47 UTC (8:47 en Tapachula) manda el recordatorio automático dos días antes, una sola vez. Con el expediente completo se habilita "Descargar expediente PDF" (se arma en el navegador con pdf-lib de cdnjs, con fotos y PDFs anexos). "Documentos administrativos": PDFs o imágenes que sube la administración, con descripción libre y fecha (KV `xa:<id>:<doc>`, lista en la columna `admin_docs`).

Externos (lavado de trailers, venta de ropa o comida): mismo módulo con el selector Colaboradores / Externos (columna `tipo`). Se les pide INE/identificación, CURP, comprobante de domicilio y fotografía (cámara frontal), y una actividad en lugar de puesto; el correo es opcional y no se les pide escolaridad.

Folio: número consecutivo único (columna `num`) + iniciales del nombre (sin de/del/la/y) + fecha de ingreso DDMMAA para colaboradores (`001_JPL_010224`); externos sin fecha (`002_RM`). Externos: no se les envía nada; el registro y los avisos de estatus (registro completo, pendiente, baja, reactivado) van al encargado de turno: entrada@basculaypension.com y WhatsApp 962 216 5453 (constantes en `src/personal.js`).

Copia en Google Drive: el Apps Script (`herramientas/aviso-correo.gs`, acción `drive`) guarda cada documento en la carpeta raíz → COLABORADORES / EXTERNOS → "<folio> <nombre>". Se activa desde el panel con «Probar conexión con Drive» (`cfg.drive`); «Copiar a Drive» en cada ficha copia lo ya subido. Las relaciones carpeta/archivo se guardan en las propiedades del script.

Navegación del panel: en cada detalle (factura, colaborador, corte) hay una barra fija con «‹ Lista», la posición («3 de 12») y flechas ‹ › para pasar al anterior o siguiente sin volver a la lista; en computadora también con las teclas ← → (Esc vuelve a la lista). En el celular el botón atrás cierra el detalle y luego regresa a la sección anterior, deslizar el detalle a la derecha vuelve a la lista y el menú de secciones va abajo. Las fichas largas traen un índice de secciones y hay un botón ↑ para subir. Código en el último `<script>` de `src/panel.html`.

## Tablet de turno (`/turno`)

Para el encargado de turno. Entra con la cuenta `entrada@basculaypension.com` (Cloudflare Access, código por correo) y luego cada encargado elige su nombre, su turno y escribe su PIN de 4 números. Cinco PIN equivocados bloquean a esa persona 15 minutos; tras 30 minutos sin tocar la tablet se cierra la sesión. Se instala como app desde Chrome (manifiesto público en `public/turno.webmanifest`). Mismo estilo que el panel; en tablet vertical y celular las secciones van abajo.

- **Inicio**: estado del corte, tareas pendientes, avisos nuevos, incidencias abiertas, gastos e ingresos extra del turno (con borrar mientras no se entregue el corte) y acciones rápidas: agregar gasto, agregar ingreso extra, reportar incidencia, dejar aviso, hacer corte.
- **Gastos** (foto opcional) e **ingresos extra** (Renta, Aumento de cambio u Otro ingreso, con "de quién"): se capturan desde botones, sin sección propia. Los ingresos extra suman al efectivo del turno; Renta y Otro también cuentan como ingreso del negocio, el Aumento de cambio solo como caja (tabla `caja_extra`). El panel también los captura en el detalle de cada corte.
- **Avisos y tareas**: tareas de la Agenda marcadas para la tablet, urgentes primero, con la nota de la administración. Al marcarlas se manda un informe (cumplida, en parte o no se pudo, con observaciones y foto opcional; tabla `agenda_reportes`) que llega por correo y se ve en Agenda → Por hacer; solo "cumplida" cierra la tarea. Avisos de ida y vuelta: la administración y los encargados eligen destinatarios (todos, turnos o personas; los encargados también "Administración"). Columnas `autor` y `para` de `agenda_items`. La administración ve todos, marca "Enterado" en los que le mandan y puede responder.
- **Incidencias**: ¿qué pasó?, ¿dónde?, ¿quién reporta? (columna `quien`), detalles, gravedad y foto opcional. Se ven las abiertas de todos los turnos hasta que la administración las resuelve. Las graves mandan correo al momento.
- **Corte ciego**: el encargado captura el efectivo físico **incluido el cambio inicial** (`con_cambio = 1`; los cortes anteriores al 14 oct se comparan sin el cambio) y, si quiere, los vouchers. Informe final: efectivo en sobre, retiros extra (concepto y monto) y cambio para el siguiente turno, con aviso de si lo repartido cuadra con lo contado (columnas `sobre`, `retiros`, `cambio_sig` de `turno_cortes`). No ve lo esperado; el panel muestra la diferencia y el reparto en Ingresos y gastos y en Agenda → Tablet de turno.

Los encargados y sus PIN se administran en Agenda → Tablet de turno. Cambiar un PIN cierra al momento la sesión abierta de esa persona. Las fotos se guardan 100 días como máximo. En la Agenda, lo terminado (tareas hechas, compras, incidencias resueltas, avisos archivados) y los eventos pasados se borran por completo a los 30 días, con sus fotos; lo que sigue abierto no se toca. Las fotos de gastos se borran con el cierre de mes de Ingresos y gastos.
