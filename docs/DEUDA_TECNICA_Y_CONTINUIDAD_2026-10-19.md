# Continuidad y deuda técnica — implementación preparada (19 de octubre de 2026)

> **ESTADO:** cambios únicamente en `deuda-tecnica/fases-1-4-20261019`. Sin pruebas ejecutadas, sin despliegue y sin escrituras sobre datos productivos. No confundir código preparado con código publicado.

## Fase 1. Archivos Drive / KV / D1

- `src/fotos.js`: la carga directa a Drive confirma primero el índice D1; la limpieza de archivos antiguos ya no activa por accidente el fallback.
- Si Drive falla, la **escritura nueva en KV se confirma primero**. La copia anterior de Drive y su referencia D1 se conservan hasta que la tarea programada termine la migración. Evita que la propagación eventual de KV deje temporalmente un archivo sin respaldo.
- La migración comprueba el contenido KV nuevamente antes de indexar el archivo remoto; si cambió durante la carga, conserva la versión más reciente y descarta la subida vieja.
- Las cargas a Drive incluyen un identificador SHA-256 determinista para la pareja clave/bytes. Apps Script busca la marca en la descripción de archivos de **la carpeta de destino**: si un reintento repite exactamente la misma operación, devuelve el mismo ID.
- `estadoArchivos` ofrece `pendientes_borrar` y Configuración muestra una alerta si la cola de papelera no está vacía.
- **Límite que requiere validación:** D1, KV y Drive no soportan transacciones distribuidas. KV tampoco soporta borrado condicional por versión. La comparación de contenido mitiga carreras pero no garantiza atomicidad si dos escrituras simultáneas pasan entre comprobación y borrado. No prometer seguridad absoluta hasta los ensayos de concurrencia.
- **Criterio de aceptación final:** fallas de Drive, de KV, de índice D1, reintentos idénticos, sustituciones simultáneas, recarga de tablet y lectura desde diferentes ubicaciones, sin perder la última copia confirmada.

## Fase 2. Respaldo D1 restaurable

- `herramientas/respaldo-d1-cifrado.sh` prepara un respaldo externo cifrado con `age`, usando Wrangler **4.151.2**, comprueba que el SQL exportado restaura en SQLite local y exige `PRAGMA quick_check=ok` **antes** del cifrado.
- Nunca guarda SQL ni secretos en GitHub, no restaura producción, no publica ni modifica bases. Requiere `BACKUP_DEST` **fuera del repositorio**, `AGE_RECIPIENT` (clave **pública**) y `CLOUDFLARE_API_TOKEN` configurados en el entorno administrativo. La clave privada se custodia separadamente.
- `.gitignore` y la protección de CI impiden nuevos respaldos o binarios SQLite en commits públicos.
- **Destino Drive creado y comprobado:** carpeta exclusiva `El Castaño · Respaldos D1 cifrados` en la raíz de `administracion@basculaypension.com`. Sus metadatos indican propietario único, no compartida y vacía. El ID exacto se mantiene fuera del repositorio público.
- **Transporte preparado:** `herramientas/subir-respaldo-cifrado-drive.sh` únicamente sube `.sql.age` y `.sha256` a la carpeta privada mediante un remote de `rclone` previamente autorizado y limitado a esa carpeta (`root_folder_id`). Verifica SHA-256 local y MD5 remoto. No descarga ni sube SQL plano ni borra objetos; las comprobaciones de existencia previas a copia no constituyen una operación atómica frente a ejecutores concurrentes. El script principal lo invoca sólo cuando `BACKUP_DRIVE_REMOTE` está configurada.
- **Pendiente de infraestructura:** configurar la autorización OAuth de rclone en el equipo administrativo (sin compartir tokens), custodios de clave privada `age`, política de retención y programador de ejecuciones. Propuesta inicial para aprobación: respaldo diario, 35 diarios y 12 mensuales, auditoría semanal de legibilidad, recuperación completa trimestral. No configurar ni borrar backups sin resolver custodios.
- **Prueba final:** descargar el archivo SQL real exportado de una D1 de ensayo, restaurarlo en **una segunda D1 aislada** y comparar esquema, conteos y datos sintéticos. El éxito de un `quick_check` local no sustituye esta prueba.

## Fase 3. Google Apps Script y privacidad operativa

- `herramientas/aviso-correo.gs`: token sólo en Propiedades del script, sin copiar secretos.
- Reemplazo de documento personal: si falla registrar la nueva referencia en Propiedades, retira sólo el nuevo archivo; conserva la referencia y el documento anterior.
- Reporte mensual: `SpreadsheetApp.flush()` confirma celdas antes del traslado; si Google Drive rechaza enviar un reporte anterior a papelera, la generación nueva se considera terminada y registra `pendientes_archivar`, evitando repetir una generación ya completada.
- Las subidas a archivos del panel usan la marca hash para evitar crear copias múltiples tras un timeout; no incorpora una red social pública, ni altera los destinatarios de CASTAGRAM.
- **Necesita intervención del administrador después de pruebas:** sustituir `Código.gs` completo en el proyecto *Correo Panel*, ejecutar `probar()`, crear nueva versión de la misma implementación y comprobar botón «Verificar Correo Panel». Nunca crear un segundo despliegue con otra URL.
- **Prueba final de dispositivos:** administración y dos identidades distintas de tablet; fotografía privada, destinatarios, `Leído` frente a `Enterado`, cambio de encargado, borrador y cola offline, reconexión e historial; probar Chrome móvil, tablet, plegable cerrado y escritorio. No usar datos ni personas reales.

## Fase 4. Mantenimiento y publicación

- CASTAGRAM ya contiene filtrado de destinatarios antes del límite, cursores para historial y reglas responsive; se conserva la arquitectura y la ruta interna `avisos`.
- Se fortalece el UUID de nuevas operaciones offline mediante `crypto.randomUUID()`; el fallback conserva compatibilidad.
- El test de CI usa Wrangler **4.151.2**. **Deuda externa pendiente:** en Cloudflare Builds, cambiar el comando administrativamente a `npx --yes wrangler@4.151.2 deploy`, tras verificar su configuración real. No hacerlo de forma silenciosa sobre producción.
- Conservar las PR experimentales #18 y #25 sin mezclar datos de ensayo. Integrar la documentación de recuperación del PR #27 sólo después de revisar su vigencia.
- **Pruebas al cierre:** suite Node completa, dry-run Workers principal y ensayo, UI responsiva, comunicaciones Apps Script, recuperación en D1 aislada y despliegue seguido de diagnóstico. No afirmar que ninguna ha pasado en esta rama antes de ejecutarlas.

## Separación obligatoria

- Producción: Cloudflare Access, Worker `basculaypension-web`, D1 y KV vinculadas al Worker productivo.
- Ensayos: otras D1/Workers, datos sintéticos y sin credenciales de operación.
- `BASCULA Y PENSION 2026` permanece excluida de cambios de permisos, contenido y escrituras.
- La web no escribe en SQLite de BASCULAYPENSION local.

## Decisiones pendientes que no pueden suplirse con código

1. **Destino creado** en la cuenta administrativa, sin documentos todavía. Pendientes: clave privada de recuperación custodiada fuera de Drive, configuración OAuth externa del remote rclone y ubicación local segura para ejecuciones.
2. Instalar la nueva versión íntegra del Apps Script, después de validación técnica, porque GitHub no modifica automáticamente ese proyecto.
3. Validación en los dispositivos físicos que usan los encargados.
4. Permiso separado de publicación productiva después de pruebas y comparación de commits.
