# Revisión Fase 3 — Personal y reportes seguros

Fecha de corte: 20 de octubre de 2026. Rama `integracion/personal-drive-reportes-20261020`, nacida de `main@a221c77e26f7fa331abce6903ea5dab4db92359d` (Worker 157).

## Alcance
- `src/personal.js`: identificador SHA-256 determinista de persona + slot + bytes para reintentos de la misma carga, sin incluir datos personales en el identificador enviado a Apps Script.
- `herramientas/aviso-correo.gs` **versión candidata, no desplegada**: se sustituye únicamente la función `drive(d)` por la implementación previamente preparada de bloqueo `LockService`, recuperación de una operación marcada, protección frente a respuestas perdidas y conservación de documentos sustituidos; se refuerza `hojaMensual(d)` con `SpreadsheetApp.flush()` y contador de fallos al archivar versiones anteriores.
- Pruebas sintéticas de Drive y Sheets más prueba de hash determinista.

## Dependencias operativas
La URL, despliegue y propiedades del proyecto de Google Apps Script **Correo Panel** deben conservarse. En el momento de preparar esta rama, el proyecto real sigue usando las funciones de reemplazo anteriores; **el código del repositorio no actualiza automáticamente Apps Script**. No fusionar ni publicar el nuevo contrato de Personal hasta confirmar que el script remoto recibió la actualización y sus pruebas ficticias no destructivas. Mantener `AVISO_TOKEN` en propiedades privadas y Cloudflare; nunca copiar su valor al repositorio.

## Verificaciones antes de publicación
1. Ejecutar suite Node + dos compilaciones Wrangler sin despliegue.
2. Entregar el script íntegro preparado para actualizar una nueva versión **del mismo despliegue** de Correo Panel; no crear otro Apps Script ni cambiar URL.
3. Verificar `probar()` sin escrituras, luego operación idempotente con archivo ficticio en carpeta aislada mediante un procedimiento aprobado.
4. Comprobar integración real del Worker con Personal con una carpeta de ensayo y comprobar que el documento anterior no se envía a papelera por fallo de carga, reintento ni sustitución.
5. Solo entonces fusionar esta rama y dejar que Cloudflare publique, verificando el commit exacto. No borrar copias anteriores sin reconciliación o aprobación.

## Límites
D1, KV y Google Drive no comparten transacción. El bloqueo serializa las peticiones del mismo script, pero no asegura efectos exactamente-una-vez ante errores externos o copias heredadas. Un reintento de bytes idénticos intencional debe distinguirse de una carga repetida según el contexto; no se sustituirá una versión posterior automáticamente.
