# BASCULAYPENSION WEB — continuidad y recuperación verificada

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

- Corroborar existencia y permisos de las carpetas y hojas reales desde **la misma cuenta Google que utiliza Apps Script**. **Se comprobó que la conexión Drive de este chat es una cuenta personal Gmail distinta de `administracion@basculaypension.com`**; por ello los resultados de búsqueda de esa conexión no sirven para acreditar ni descartar la carpeta `El Castaño · Archivos del panel`. Se necesita autorización y conexión directa de la cuenta administrativa para verificar metadatos y permisos (sin descargar documentos fiscales).
- Ensayar exportación SQL **descargada y restaurada** en D1 aislada, con comprobaciones de integridad.
- Verificar un ciclo real y aislado de Google Sheets/Drive: éxito, falla de conexión, reconciliación y recuperación; no enviar transacciones sintéticas a servicios productivos.
- Probar sesiones simultáneas y conectividad offline real en dispositivos, sin dar por cerrada la auditoría integral a partir de CI.
- Establecer calendario de respaldos, responsables, retención, cifrado y periodicidad de pruebas de restauración.
- **Fijación de herramientas en despliegue:** GitHub Actions valida Wrangler `4.151.2`, pero Cloudflare Builds de producción ejecuta `npx wrangler deploy` sin versión fija; cualquier modificación de ese comando requiere autorización administrativa y nueva comprobación de despliegue. No se modificó su configuración.

## 6. Criterio de publicación

Las acciones productivas (merge a `main`, despliegue, restore, limpieza de registros, modificación de Cloudflare Access o historial Git) requieren autorización particular. Las pruebas sintéticas aquí documentadas no conceden autorización para restaurar producción.
