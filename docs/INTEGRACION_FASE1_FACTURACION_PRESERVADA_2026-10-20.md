# Integración aislada — Fase 1 de archivos y Facturación

**Fecha:** 20 de octubre de 2026.
**Rama:** `integracion/fase1-archivos-facturacion-20261020`.
**Base:** `main@4613ec3112106ef56c0d1f808931828654e03833`, incluye la reparación de Facturación del PR #35.
**Fuente de Fase 1:** `d361e12d0bfbb42207dd8ffad13a908aa704c6cb`, sin fusionar la rama completa.

## Alcance exacto

- `src/fotos.js`: implementación preparada de versiones inmutables KV, índices D1, conservación de copias y lectura de archivos antiguos, copiada de la rama de auditoría.
- `src/worker.js`: se conservan íntegros correo obligatorio, análisis orientativo de fotografías, detección de formatos y lectura fiscal asistida del `main`; únicamente se adapta la subida del ticket y la constancia a `guardarArchivo`.
- `src/personal.js`: se adaptan exclusivamente las dos rutas de documentos que persistían directamente en KV.
- `src/turno.js` y `src/agenda.js`: se adaptan únicamente las cargas de fotos operativas al almacenamiento versionado.
- `pruebas/archivos-retencion-fallos.test.js`: se incorpora el contrato sintético preparado, **no ejecutado**.

## Exclusiones y límites

No se fusionó `deuda-tecnica/fases-1-4-20261019`; sus cambios de reportes, UI, respaldos y Apps Script quedan fuera de esta integración aislada. El Apps Script remoto **no se modificó**: la idempotencia de cargas en Drive depende de verificar su contrato y de una autorización posterior específica para actualizarlo.

**Esta rama no está probada, aprobada ni publicada.** Se efectuó únicamente inspección estática del código y de sus interfaces. La validación de fallos y concurrencia está reservada para la sesión conjunta; también faltan pruebas de KV/D1/Drive aislados, compatibilidad móvil y comprobaciones de Facturación. Las versiones en KV pueden no ser visibles de inmediato en otra región. D1, KV y Drive no participan de una transacción distribuida. No activar purgas de versiones sin una reconciliación segura.

**Operaciones no realizadas:** merge a `main`, despliegue Cloudflare, publicación Apps Script, cambios en D1/KV/Drive productivos, ejecución de pruebas reservadas, respaldo real o creación de recursos remotos.

## Revisión obligatoria antes de aprobar

1. Inspeccionar el diff contra `main` y preservar íntegramente las correcciones del PR #35.
2. Revisar simultaneidad de subidas, eliminación, reemplazo, propagación KV, casos sin puntero en D1 y recuperación de copias huérfanas.
3. Validar sintaxis y suites sintéticas de forma conjunta cuando se autorice, usando datos ficticios.
4. Verificar contrato y despliegue existente de Apps Script antes de activar idempotencia.
5. Ensayar la lectura y retención de tickets, constancias fiscales, documentos, fotos de tablet y CASTAGRAM con servicios aislados.
6. Solo después evaluar integración y publicación con autorización expresa.

## Ajuste de seguridad estática posterior (20 de octubre)

- Se detectó que `borrarArchivo` escribía la marca de eliminación sin verificar en la misma transacción que su puntero inicial no hubiese sido reemplazado. Se condicionó su escritura al puntero leído y se detiene la purga física cuando el borrado resulta obsoleto.
- La marca de borrado incorpora un UUID junto a la fecha para impedir que dos operaciones con idéntico milisegundo aparenten ser la misma generación lógica.
- El envío a papelera y el reintento de limpieza consultan también `archivos_copias`, evitando descartar una referencia histórica todavía registrada bajo otra llave.
- Se agregaron contratos sintéticos para esta protección, **preparados y no ejecutados**, según la reserva vigente de pruebas.
- Continúan pendientes ensayos de concurrencia real, restauración de copias sin índice y conciliación entre D1, KV y Drive. La revisión estática no garantiza transacciones distribuidas.

## Recuperación de versiones sin índice (código preparado)

El nuevo recorrido `reconciliarVersionesKV` enumera de forma paginada (40 entradas por ejecución) únicamente claves físicas `fv:`, mantiene un cursor en D1 y registra en `archivos_huerfanos` las que no aparecen en `archivos_copias` ni `archivos_actual`. Respeta marcas de eliminación. No inspecciona bytes ni metadatos privados, no publica archivos huérfanos y **no borra datos**. `estadoArchivos` expone el contador `versiones_sin_indice` para conciliación administrativa. El recorrido se ejecutaría durante el mantenimiento programado existente únicamente después de la publicación autorizada. La tabla guarda evidencias, no restaura versiones automáticamente.

Se incorporó una prueba con SQLite en memoria y KV falso para comprobar fallo D1 tras guardado KV, idempotencia del recorrido, sustitución concurrente y marca de borrado. La prueba no conecta servicios reales. Estado de ejecución: pendiente de GitHub Actions del PR #36.

## Adaptación de pruebas históricas sin debilitar verificaciones

La suite financiera suponía que una llave lógica `pc:` correspondía directamente a una clave física KV. El nuevo almacenamiento conserva las llaves lógicas para sus consumidores, pero guarda físicamente en `fv:` y lee mediante `leerArchivo`. Se modificó solo el doble aislado de KV para admitir `getWithMetadata` y se verifican los mismos invariantes financieros y archivos accesibles a través de la API pública del módulo, incluidos borrados y sustituciones. La prueba A-11B continúa exigiendo mensajes sin nombres ni claves privadas, con el nuevo texto de fallback seguro.
