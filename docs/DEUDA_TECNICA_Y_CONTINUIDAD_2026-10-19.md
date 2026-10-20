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

### Revisión de Fase 1 — versiones de archivos (20 de octubre, solo rama de trabajo)

- Preparado un índice aditivo de versiones vigentes en D1 (archivos_actual), con copias físicas independientes por operación en KV (prefijo fv:) y un registro de copias para conciliación. Las rutas públicas y las claves lógicas de fotografías/documentos permanecen iguales.
- El flujo nuevo exige confirmar la escritura de la copia inmutable en KV **antes** de señalarla en D1. La publicación del puntero emplea compare-and-swap condicionado al estado leído al iniciar: otra sustitución o eliminación concurrente impide que la solicitud atrasada lo sobreescriba, conservando la copia KV huérfana para conciliación. Una falla de KV/D1 no retira la versión anterior. Los reintentos de Drive confirman el índice solo si la versión sigue vigente.
- La migración conserva y reconoce las claves KV antiguas; no las borra automáticamente. Se retienen también versiones de Drive sustituidas. Las eliminaciones expresas siguen siendo posibles, con controles de referencias.
- Facturas, fotografías de tablet y CASTAGRAM, incidencias, expedientes y documentos administrativos usan ahora el mismo flujo versionado. Los demás usos de KV (PIN, sesiones, preferencias, límites y configuración) no son archivos y mantienen sus rutas y semántica.
- **Sin garantía distribuida de visibilidad inmediata:** KV tiene consistencia eventual; una nueva copia podría no leerse desde otra región hasta que se propague. D1, KV y Drive siguen sin transacción única.
- La retención de copias históricas es temporal mientras no exista una política probada de reconciliación, limpieza y recuperación. Vigilar crecimiento y almacenamiento antes de activar esta rama.
- Eliminaciones explícitas registran una marca persistente en D1; se verifica también antes de servir bytes, evitando que una lectura eventual de KV resucite una clave legada. El índice conserva identificadores anteriores de Drive para conciliación y borrado explícito de las referencias conocidas.
- Las claves legadas ya trasladadas se revisan periódicamente con límite de lecturas; no se asume que una lectura KV equivale a una transacción. No se eliminan de forma automática ni se prometen resultados hasta la validación conjunta.
- **Estado:** cambios de código preparados en rama, sin pruebas de aplicación, sin instalación de Apps Script y sin publicación. La configuración Windows/WSL permanece suspendida a petición del administrador.

### Estado de custodia (20 de octubre de 2026)

- Mac: FileVault y `age` instalados; clave privada ya creada y validada localmente, sin compartirla ni reemplazarla. La copia cifrada con contraseña en USB `TRANSFERENC` fue descifrada y comparada con el original exitosamente. **Pendiente de confirmar:** la expulsión y custodia física de la USB, separada de la Mac, y el resguardo independiente de la contraseña. No se solicita ni comparte esa contraseña en el chat.
- Windows/Ubuntu WSL: instalación y automatización **suspendidas expresamente** porque interfieren con otra operación de desarrollo. WSL aún no estaba instalado al suspender. No instalar, configurar credenciales ni activar tareas hasta instrucción de reanudación. `BACKUP_ACTIVE=NO` continúa obligatorio.
- Respaldo D1 real cifrado y transferido a Drive: **pendiente**, sin ejecución ni pruebas. No confundir la copia cifrada de la **llave privada** en USB con un respaldo de la base D1.

## Fase 2. Respaldo D1 restaurable

- `herramientas/respaldo-d1-cifrado.sh` prepara un respaldo externo cifrado con `age`, usando Wrangler **4.151.2**, comprueba que el SQL exportado restaura en SQLite local y exige `PRAGMA quick_check=ok` **antes** del cifrado.
- Nunca guarda SQL ni secretos en GitHub, no restaura producción, no publica ni modifica bases. Requiere `BACKUP_DEST` **fuera del repositorio**, `AGE_RECIPIENT` (clave **pública**) y `CLOUDFLARE_API_TOKEN` configurados en el entorno administrativo. La clave privada se custodia separadamente.
- `.gitignore` y la protección de CI impiden nuevos respaldos o binarios SQLite en commits públicos.
- **Destino Drive creado y comprobado:** carpeta exclusiva `El Castaño · Respaldos D1 cifrados` en la raíz de `administracion@basculaypension.com`. Sus metadatos indican propietario único, no compartida y vacía. El ID exacto se mantiene fuera del repositorio público.
- **Ejecutor elegido:** Windows/Ubuntu WSL, porque es la computadora normalmente encendida; macOS custodia la clave privada de recuperación. Los lanzadores de Windows requieren credencial DPAPI y `BACKUP_ACTIVE=SI` después de las pruebas; macOS no tendrá tarea activa de respaldo por defecto.
- **Transporte preparado:** `herramientas/subir-respaldo-cifrado-drive.sh` únicamente sube `.sql.age` y `.sha256` a la carpeta privada mediante un remote de `rclone` previamente autorizado y limitado a esa carpeta (`root_folder_id`). Verifica SHA-256 local y MD5 remoto. Si una subida se interrumpe después del cifrado y antes del manifiesto, puede reanudarse: valida hashes existentes, acepta solo copias idénticas y sube lo faltante con `--immutable`. No descarga ni sube SQL plano ni borra objetos; las comprobaciones de existencia previas a copia no son atómicas frente a ejecutores concurrentes. El script principal solo lo invoca cuando `BACKUP_DRIVE_REMOTE` está configurada.
- **Pendiente de infraestructura:** configurar la autorización OAuth de rclone en el equipo administrativo (sin compartir tokens), custodios de clave privada `age`, política de retención y programador de ejecuciones. Propuesta inicial para aprobación: respaldo diario, 35 diarios y 12 mensuales, auditoría semanal de legibilidad, recuperación completa trimestral. No configurar ni borrar backups sin resolver custodios.
- **Prueba final:** descargar el archivo SQL real exportado de una D1 de ensayo, restaurarlo en **una segunda D1 aislada** y comparar esquema, conteos y datos sintéticos. El éxito de un `quick_check` local no sustituye esta prueba.

### 2.1 Carpeta privada de respaldos y custodia externa (preparado, sin ejecutar)

La carpeta `El Castaño · Respaldos D1 cifrados` ya fue creada en el Drive administrativo y verificada sin elementos, sin enlaces públicos y sólo con permiso del propietario. Su identificador es privado: **no copiarlo a este repositorio**.

En **un equipo administrativo confiable**, fuera de carpetas sincronizadas con Drive y fuera de GitHub:

1. Instalar `age`, `rclone`, `wrangler` (se invoca fijado a `4.151.2`), `sqlite3` y utilidades POSIX. Estos scripts están pensados para Linux o WSL.
2. Elegir un directorio **local exclusivo** para la clave, guardado con el sistema de custodia administrativa; fijar `AGE_KEY_DIR` fuera del repositorio y de Google Drive. Ejecutar `bash herramientas/preparar-clave-respaldo-local.sh` **una única vez**. Conservar una copia segura independiente de la clave privada y ensayar su recuperación antes de programar ningún trabajo.
3. Configurar un remote de rclone `castano-d1-backups:` utilizando el acceso Google de la cuenta administrativa. En la opción avanzada `root_folder_id`, usar el ID de la carpeta privada que figura en su URL. **Esta opción restringe las rutas que muestra rclone, pero no reduce automáticamente los permisos OAuth concedidos a Google Drive.** Mantener `rclone.conf` y el token OAuth **fuera de GitHub y del chat**, y usar los permisos mínimos que permitan la operación.
4. Configurar `BACKUP_DEST` a una carpeta privada local, `AGE_RECIPIENT` a la clave **pública** que imprime age-keygen, `BACKUP_DRIVE_REMOTE=castano-d1-backups:` y `CLOUDFLARE_API_TOKEN` a una credencial Cloudflare de permisos mínimos. No escribir tokens en el repositorio ni compartirlos.
5. Después de las pruebas finales y de confirmar la identidad de la D1 de producción, ejecutar `bash herramientas/respaldo-d1-cifrado.sh`. Exporta SQL a directorio temporal, lo importa en SQLite **local**, comprueba `quick_check`, cifra el SQL, guarda un SHA-256 y opcionalmente sube **sólo** los dos artefactos cifrados a Drive mediante `herramientas/subir-respaldo-cifrado-drive.sh`. La subida usa `--immutable` para rechazar sobreescrituras y compara MD5 local/remoto. El respaldo local se conserva si la subida falla.
6. Recuperación de comprobación sin conexión a producción: descargar el par `.sql.age`/`.sha256` a una carpeta privada local, configurar `AGE_KEY_FILE` desde la custodia externa y ejecutar `bash herramientas/verificar-restauracion-d1-local.sh ruta/al/respaldo.sql.age`. El ensayo descifra a un directorio temporal y restaura SQLite **local**, sin escribir Cloudflare.
7. Sólo después, programar la ejecución diaria desde un equipo seguro con credenciales supervisadas y con alertas. No se incluye ninguna eliminación automática por retención hasta validar respaldos y autorizar custodios.

**Límite actual:** no es posible completar el alta OAuth ni crear y custodiar la clave **privada** desde el conector del chat sin asumir indebidamente el control de secretos. El equipo administrativo debe ejecutar esos pasos. Los scripts y la carpeta están preparados pero **no existe todavía ningún respaldo automatizado en Drive**.

Documentación de referencia: [Cloudflare D1 export](https://developers.cloudflare.com/workers/wrangler/commands/d1/), [rclone Drive root_folder_id](https://rclone.org/drive/) y [rclone copyto](https://rclone.org/commands/rclone_copyto/).

## Fase 3. Google Apps Script y privacidad operativa

- `herramientas/aviso-correo.gs`: token sólo en Propiedades del script, sin copiar secretos.
- Las copias documentales del flujo `drive(d)` incorporan una marca SHA-256 determinista por persona, slot y contenido; los reintentos buscan esa marca en la misma carpeta. LockService serializa las sustituciones; al recuperar un archivo marcado compara su fecha de creación con el archivo actualmente indexado para no retroceder ante un reintento obsoleto. Se deja la versión anterior intacta hasta conciliación. Los uploads legados sin marca y la reintroducción intencional de bytes idénticos requieren validación. Preparado en GitHub: Apps Script productivo SIN actualizar.
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
