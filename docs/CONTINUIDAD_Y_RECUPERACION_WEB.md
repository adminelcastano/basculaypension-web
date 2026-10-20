# BASCULAYPENSION WEB — continuidad y recuperación verificada

> **Estado posterior verificado (20/10/2026):** La rama productiva llegó a `main@723e0e267daac3e26ebcb978840f83a1cc3f7931`, Worker **158**, antes del lote de cierre administrativo. La Fase 1 y la Fase 3 ya fueron publicadas, con las limitaciones de pruebas remotas explicitadas; no interpretar los encabezados históricos de «sin publicar» como estado actual. La automatización Windows/WSL continúa suspendida. El documento `docs/ESTADO_AUDITORIA_Y_PENDIENTES_2026-10-20.md` registra el estado y las tareas restantes, sujeto a nuevos despliegues.

> **Estado actualizado (20 de octubre de 2026).** Este documento conserva evidencias históricas del 19 de octubre, pero no las presenta como verificaciones actuales. La versión productiva verificada es Cloudflare Worker **156**, despliegue `09ec9e9d-a972-4f14-b3c6-50cf08d7cf98`, publicado desde `main@78fbc77f3a486b06e9bf577cdc08966386cb9a49` mediante PR #36. En GitHub Actions, 376/376 pruebas sintéticas terminaron correctamente. **La restauración completa en una segunda D1 aislada sigue pendiente.** No ejecutar Time Travel ni restauraciones en la base productiva; no reutilizar la D1 de ensayo de Finanzas.

**Alcance:** repositorio `adminelcastano/basculaypension-web`; no corresponde a la SQLite de BASCULAYPENSION local. No ejecutar procedimientos destructivos sobre producción sin autorización y ventana operativa.

**Verificación:** 19 de octubre de 2026. Base productiva en `main` `3032b0f`, protegida por regla de PR y `node-tests`. Este documento no constituye un respaldo ni una orden de restauración.

## 1. Fuentes de datos separadas

- **D1 del Worker productivo:** facturación, operaciones del panel, CASTAGRAM, turnos, caja y datos financieros según sus respectivas tablas.
- **KV `FILES`:** archivos pendientes o de respaldo y claves del sistema; no se restaura automáticamente al restaurar D1.
- **Google Drive/Apps Script:** archivos externos y sincronizaciones. La tabla D1 `archivos` contiene referencias; una recuperación D1 puede dejar referencias inconsistentes si Drive y KV cambiaron desde el momento elegido.
- **D1/KV del ensayo financiero (PR #18):** distintos de producción.
- **D1/KV del ensayo adversarial:** distintos de producción y de ensayo financiero. Datos ficticios, sin cron ni credenciales externas.
- **D1 temporal de restauración:** `castano-restore-sintetico-20261019`, creada exclusivamente para ensayar Time Travel. No forma parte del Worker productivo.

**Invariante:** ninguna integración WEB escribe en la SQLite operativa de BASCULAYPENSION local.

## 2. Pruebas de recuperación realizadas

### 2.1 Time Travel en D1 aislada — aprobado

Se creó una tabla de prueba con `(id, marca, monto_centavos)`, sin datos personales:

1. Estado inicial: una fila por **7,600 centavos**.
2. Se obtuvo un bookmark de D1 mediante lectura de la API de Cloudflare.
3. Se añadió una segunda fila por 2,500 centavos; total **10,100 centavos**.
4. Se restauró la **D1 temporal**, mediante `POST /accounts/{account_id}/d1/database/{database_id}/time_travel/restore` con el `bookmark` previo en la consulta.
5. La lectura posterior confirmó **una sola fila y 7,600 centavos**. Cloudflare devolvió `success=true`, un nuevo bookmark y un bookmark anterior útil para revertir esa restauración en el entorno de prueba.

**No se ejecutó Time Travel sobre D1 productiva** ni se alteraron los movimientos contables reales.

### 2.2 Exportación SQL — funcionamiento de la API comprobado

Se llamó `POST /accounts/{account_id}/d1/database/{database_id}/export` con `output_format: polling` y filtro a la tabla ficticia. Cloudflare devolvió `status: complete` y una referencia de descarga temporal.

La prueba **no equivale a haber descargado, inspeccionado, cifrado y restaurado un archivo SQL**; esos pasos siguen pendientes. No registrar URLs firmadas ni bookmarks en el repositorio público.

### 2.3 Disponibilidad de bookmarks productivos — lectura correcta

Se comprobó mediante la API que las D1 productiva y de ensayo poseen bookmarks de Time Travel. Esto indica que la API responde; **no garantiza** que un instante específico siga dentro de la ventana de recuperación ni que los sistemas externos estén sincronizados.

### 2.4 Integridad SQLite — consulta de solo lectura

Se ejecutó `PRAGMA quick_check` en la D1 productiva y en la D1 privada de auditoría. Ambas devolvieron **`ok`**. Es una comprobación rápida de integridad de SQLite, no una auditoría contable, validación de relaciones externas ni sustituto de respaldo/restauración.

## 3. Procedimiento antes de una recuperación productiva

1. Confirmar identidad de la D1 mediante su vinculación `DB` en el Worker correspondiente; **nunca copiar IDs desde ensayos ni asumir el nombre**.
2. Declarar ventana y responsable; suspender o coordinar temporalmente capturas de turnos, conciliaciones y sincronizaciones durante la restauración (no desactivar operaciones sin autorización).
3. Capturar un punto de recuperación *actual* y obtener un respaldo o exportación externa en ubicación privada con control de acceso, retención y verificación de integridad.
4. Inventariar transacciones posteriores al punto objetivo, cierres/cortes, idempotencias, referencias `archivos`, estado KV, conciliaciones de Sheets y archivos en Drive. Un Time Travel revierte **la D1 completa**, no sólo una tabla.
5. Ensayar primero la recuperación en una D1 distinta con datos autorizados y comprobar conteos, importes, fórmulas y referencias externas; no apuntar un Worker de ensayo a producción.
6. Si se aprueba restaurar D1 productiva, conservar el bookmark de **antes de la restauración**, registrar el nuevo bookmark y comprobar posteriormente datos y servicios. No repetir escrituras o ingresos sin revisar idempotencia.
7. Conciliar D1 con Google Sheets, Drive y KV, y verificar desde sesiones de administración y tablet, incluido `Leído` frente a `Enterado`.
8. Sólo reanudar operación una vez documentadas las diferencias y la conformidad del responsable.

**Prohibido:** reemplazar saldos con importes supuestos, sobrescribir datos productivos con una base ficticia, subir respaldos privados al repositorio público o fusionar el PR #18 experimental para resolver un incidente.

## 4. Historial público Wrangler — comprobación A-03

- El commit `1e7fe3d9` introdujo **18 blobs** SQLite/WAL/SHM de Miniflare; los hashes y rutas coinciden con los del commit `30be44e`. Se retiraron de la rama productiva al publicar `3032b0f`.
- Total **340,856 bytes**. Los 18 blobs se pudieron examinar en base64 mediante el conector de GitHub, **sin imprimir su contenido**.
- La inspección heurística de cadenas legibles no identificó patrones reconocibles de correos, cabeceras de autorización, tokens, nombres de tablas operativas ni marcadores de datos personales. **Esto no certifica ausencia de secretos o contenido binario sensible**: se requiere análisis forense adicional si aparece nueva evidencia.
- `.gitignore` y el check de CI impiden nuevas inclusiones inadvertidas de archivos locales. Los blobs anteriores siguen accesibles en commits públicos. No reescribir historial ni rotar credenciales por conjetura; valorar contención según hallazgos concretos.

## 5. Pendientes de auditoría externa

- **Cumplido:** se utilizó la conexión Drive de la cuenta administrativa `administracion@basculaypension.com` para corroborar carpetas y permisos, sin descargar documentos fiscales (véanse §6 y §6.1).
- Ensayar exportación SQL **descargada y restaurada** en D1 aislada, con comprobaciones de integridad.
- Verificar un ciclo real y aislado de Google Sheets/Drive: éxito, falla de conexión, reconciliación y recuperación; no enviar transacciones sintéticas a servicios productivos.
- Probar sesiones simultáneas y conectividad offline real en dispositivos, sin dar por cerrada la auditoría integral a partir de CI.
- Establecer calendario de respaldos, responsables, retención, cifrado y periodicidad de pruebas de restauración.
- **Fijación de herramientas en despliegue:** GitHub Actions valida Wrangler `4.151.2`, pero Cloudflare Builds de producción ejecuta `npx wrangler deploy` sin versión fija; cualquier modificación de ese comando requiere autorización administrativa y nueva comprobación de despliegue. No se modificó su configuración.

## 6. Permisos y acceso a respaldos de Google (19 de octubre de 2026)

- **Cuenta verificada:** `administracion@basculaypension.com` mediante Google Drive conectado, sin descargar documentos.
- **Carpeta `El Castaño · Archivos del panel`:** localizada con cuatro subcarpetas operativas (facturas, personal, tablet y comprobantes). En las subcarpetas mensuales inspeccionadas se localizaron 31 archivos y Google los clasificó como no compartidos; no se leyó su contenido.
- **Permisos corregidos por administración y verificados después:** `FINANZAS 2026`, `ADMIN FINANZAS 2026`, `TURNOS 2026`, `FACTURACION 2026`, `COLABORADORES`, `EXTERNOS`, hojas `Finanzas 2026-10` y `Turnos 2026-10`. Google devuelve dueño presente y ninguna concesión tipo `anyone` para esos ocho recursos.
- **Exclusión explícita:** `BASCULA Y PENSION 2026` conserva sus permisos actuales a solicitud del administrador; no modificar.
- **Compatibilidad verificada de solo lectura:** la cuenta administrativa puede abrir metadatos de las hojas de Finanzas (8 pestañas), Turnos (16 pestañas) y Reporte mensual (19 pestañas) tras la restricción. `herramientas/aviso-correo.gs` utiliza `DriveApp`/`SpreadsheetApp` para guardar y leer con su cuenta ejecutora y no contiene `setSharing`; la configuración desplegada del proyecto Apps Script no se comprobó directamente.
- **Límite importante:** no se envió ningún archivo ni se regeneraron reportes para evitar borrar o sustituir hojas existentes. La capacidad de escritura del Apps Script productivo, sus disparadores y la conciliación D1→Drive requieren validación no destructiva posterior.

### 6.1 Conciliación real D1 ↔ Google Drive (sin leer contenidos)

Verificación administrativa adicional posterior a la conexión de Correo Panel:

- `archivos` en D1 productiva: **87** referencias vigentes; cero entradas en `archivos_borrar`.
- Google Drive, carpetas operativas de octubre y personal: **89** archivos privados. **87/87 referencias D1 encontradas físicamente** por identificador, cero ausencias.
- **Dos archivos adicionales sin referencia D1**: uno en Tablet de turno y otro en Expedientes del personal. Los dos aparecen como privados y comparten tamaño con otro archivo de su área, lo cual sugiere posible duplicación pero **no la demuestra**. No se inspeccionaron bytes, no se borraron y no se propone eliminarlos automáticamente.
- Cuatro prefijos operativos de KV (`f:`, `tf:`, `x:`, `xa:`): sin entradas pendientes al consultar metadatos. Los identificadores y nombres personales no se trasladaron al repositorio.
- `PRAGMA quick_check` de D1 productiva y D1 de ensayo: `ok`. La API Cloudflare → Correo Panel, consulta `accion=drive, op=probar`, también se validó desde el panel administrativo en producción sin envío de correo.
- **Riesgo mitigado (19 de octubre):** `hojaMensual` crea, llena y mueve el nuevo reporte antes de archivar la versión anterior (PR #31, Apps Script actualizado y diagnóstico autenticado confirmado). PR #34 incorporó un ensayo automático adicional: si falla `moveTo`, el reporte anterior permanece intacto. **No se ha hecho una sustitución real de hojas**; conservar esta salvedad.

### 6.2 Continuidad posterior a la corrección de documentos y reportes

- PR #33, ya incorporado a `main`, retrasa el envío a papelera del documento de personal anterior hasta después de crear el reemplazo y actualizar su referencia. Apps Script actualizado manualmente y conexión verificada en el panel; no se ejecutó una sustitución real.
- PR #34, incorporado a `main` como commit `8f088fa`, prueba el fallo sintético al mover el reporte nuevo. **342/342 pruebas automatizadas aprobadas** y Cloudflare Builds confirmó `outcome: success`.
- D1 productiva mantiene **87** referencias a Drive y cero entradas en `archivos_borrar`, así como cero candidatas de limpieza según consulta de solo lectura posterior al despliegue. No implica auditoría de contenido ni verificación de un archivo por hash.
- Se mantiene prohibido borrar automáticamente los dos archivos de Drive adicionales sin referencia D1; pueden ser copias conservadas.

## 7. Criterio de publicación

Las acciones productivas (merge a `main`, despliegue, restore, limpieza de registros, modificación de Cloudflare Access o historial Git) requieren autorización particular. Las pruebas sintéticas aquí documentadas no conceden autorización para restaurar producción.


## 8. Revisión de continuidad a partir de Worker 156 (20 de octubre de 2026)

- El esquema aditivo de almacenamiento ya incorpora `archivos_actual`, `archivos_copias`, `archivos_legacy`, `archivos_eliminados`, `archivos_huerfanos` y `archivos_recorrido`; las versiones físicas `fv:` en KV se registran mediante un puntero D1, con detección conservadora de copias sin índice.
- **No** inferir que `archivos` por sí sola representa todas las copias; durante una restauración verificar el conjunto de índices y los objetos KV/Drive, respetar eliminaciones marcadas y no publicar automáticamente copias huérfanas.
- Se mantienen separados los respaldos de D1, documentos en Drive, índices D1 y KV; un Time Travel de D1 no revierte Drive ni KV.
- `AVISO_TOKEN` se encuentra en propiedades privadas de Apps Script y en secretos de Cloudflare; no copiar sus valores, URLs firmadas ni credenciales a GitHub o chats.
- La Mac conserva la clave privada `age` ya validada; no generarla de nuevo. La instalación Windows/WSL permanece suspendida y los respaldos automáticos desactivados (`BACKUP_ACTIVE=NO`). La USB con copia cifrada **no** constituye una copia de D1.
- La hoja y el índice KV de reportes tampoco participan de transacción distribuida: el panel debe distinguir un archivo de Sheets creado de una indexación KV fallida, sin afirmar que generar la hoja completa falló ni disparar duplicados.
- **Aceptación futura de recuperación:** exportar datos sintéticos, cifrar, descargar, verificar, descifrar y restaurar en una segunda D1 exclusiva y aislada, comparando esquema, recuentos y contenido. La prueba histórica de Time Travel en una D1 sintética no sustituye ese ciclo.
- Datos numéricos de inventarios, permisos y estado KV de los apartados históricos son observaciones del **19 de octubre**; no representan contadores actualizados a esta versión.

## 9. Criterios de publicación

Esta documentación informa el estado, no habilita operaciones destructivas. Los nuevos cambios de código en Panel y Reportes deben probarse con la suite Node y compilación Wrangler sin publicar antes de fusionar. Para actualizar `drive(d)` y `hojaMensual(d)` en el Apps Script existente, se exige un procedimiento separado que mantenga URL y propiedades; no sustituirlo sin acceso y validación reales del proyecto `Correo Panel`.
