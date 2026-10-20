# Estado y cierre selectivo de auditoría — 20 de octubre de 2026

> **Referencia de inicio:** `main@723e0e267daac3e26ebcb978840f83a1cc3f7931`, Cloudflare Worker 158. Verificar el SHA y la versión actual antes de cada operación; este inventario no se actualiza automáticamente.

## Terminados en código y publicados (pendientes de validación operativa remota)

- **Fase 1 — conservación:** versión física KV `fv:` inmutable, puntero D1, copias históricas, marca de borrado, detección de copias sin índice y pantalla de indicadores. No se reintroducen ni purgan automáticamente versiones huérfanas.
- **Fase 3 — Personal y Google Apps Script:** SHA-256 para reintentos del mismo documento/slot, bloqueo en el proyecto `Correo Panel` según código publicado, respuesta a reintentos, conservación de versiones anteriores y creación de reportes con indicador de archivados pendientes. Scripts en GitHub no garantizan por sí solos el estado remoto, pero la administración informó que actualizó la implementación existente y ejecutó `probar()` satisfactoriamente.
- **Fase 4 — privacidad:** CASTAGRAM preserva sus destinatarios, fotos privadas, control de sesión, `Leído` y `Enterado` separados; la cola offline distingue encargados, turnos y fechas. Siete PR históricos ya cubiertos fueron cerrados sin fusionar sus versiones antiguas.
- **Reportes y panel:** PR #37 publicado para no confundir una hoja ya creada con un fallo del índice KV y para distinguir versiones, pendientes y copias huérfanas.

## Cierre seguro de este lote

- **UID offline:** preferir `crypto.randomUUID()` en navegadores compatibles, conservando fallback para versiones anteriores. No transformar ni purgar mensajes ya pendientes.
- **Privacidad de logs Drive Personal:** no guardar respuestas externas ni mensajes de error que podrían contener nombres o identificadores. Conservar señal genérica para diagnóstico.
- **Cloudflare Builds:** fijar explícitamente la misma versión de Wrangler utilizada por CI, solo en configuración de build productivo; no editar binding D1/KV/Access ni la URL de Apps Script.
- **Documentación:** anotar cronología real de publicaciones, sin presentar los estados pasados como pendientes actuales.

## Pendientes por prioridad, sin contar pruebas automatizadas

| Prioridad | Fase | Estado | Avance cualitativo | Próxima decisión |
| --- | --- | --- | --- | --- |
| **P0** | 2 · Respaldo D1 cifrado y restaurable | No operativo | Código de respaldo disponible solo en rama de auditoría; no en main | Conservar ejecución WSL suspendida, definir custodios y destino; autorizar reanudación antes de instalación |
| **P0** | 2 · Recuperación completa aislada | Sin certificar | Time Travel en D1 sintética y export API verificados históricamente, sin ciclo extremo a extremo | Descarga cifrada, restauración aislada independiente, conteos, hashes y verificación |
| **P1** | 1 · Conciliación y restauración de versiones huérfanas KV/Drive/D1 | Detección publicada; recuperación manual pendiente | `archivos_huerfanos` y `estadoArchivos` disponibles | Definir procedimiento y pruebas con datos ficticios, sin eliminación automática |
| **P1** | 3 · Documentos reales y retención de copias | Publicado, pendiente de aceptación funcional | Reintentos protegidos en código | Validar reemplazo en carpeta aislada, elaborar política de conservación antes de purgar |
| **P1** | 4 · Protección de rama y exposición histórica | Parcialmente corregido | `.gitignore` y CI activos; estado de protección administrativa debe revisarse | Comprobar reglas de GitHub; evaluar 18 blobs Miniflare del historial sin divulgar contenidos |
| **P2** | 4 · Operación offline y privacidad multidispositivo | Código preparado y/o publicado | Sesiones separadas y cola visible; falta verificación física | Probar cambio de PIN y reconexión con identidades ficticias |
| **P2** | 4 · PR históricos aún abiertos | No publicables directamente | #5 Caja histórica, #6 deduplicación insegura, #18 Finanzas experimental, #25 lote adversarial | Mantener separados; nunca fusionar íntegramente |
| **P2** | 4 · CASTAGRAM experiencia responsiva | Función principal publicada | Pendientes ajustes visuales y pruebas en plegable/tablet | Continuar UI sin cambiar rutas, tablas ni privacidad |

## Restricciones que continúan vigentes

- No ejecutar, instalar ni programar respaldos Windows/WSL: suspensión previa aún vigente. `BACKUP_ACTIVE=NO`.
- No crear ni regenerar claves privadas `age`; custodia Mac y copia cifrada USB permanecen bajo control administrativo.
- No borrar archivos duplicados por coincidencia de tamaño, no reescribir historial público sin investigación, no alterar base SQLite del sistema local.
- No migrar, fusionar o desplegar los PR #5, #6, #18, #25 como un solo lote.
- Los números de avance no son porcentajes calculados ni certificados.
