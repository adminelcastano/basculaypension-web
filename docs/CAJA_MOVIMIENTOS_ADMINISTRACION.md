# Caja ↔ Administración: movimientos internos y saldo

**Estado:** PR #40 en borrador; no fusionado ni publicado. Base inicial `main@d7907d7`.

## Contrato contable

- **Ingreso de administración** (`caja_admin_movs.tipo='entrada'`): entra efectivo a caja y sale del efectivo de administración.
- **Retiro de administración** (`tipo='salida'`): sale efectivo de caja y entra al efectivo de administración.
- Ambos movimientos son **traspasos internos**: no generan ingreso por venta ni gasto del negocio.
- **Gastos reales** siguen en `caja_gastos`; las ventas siguen en `caja_mov` desde Sheets y los ingresos reales adicionales en `caja_extra`.
- **Saldo esperado del turno** = fondo inicial + cobros en efectivo sincronizados + ingresos extra + movimientos de hoja en efectivo + transferencias internas *entrantes* − gastos pagados de caja − transferencias internas *salientes*. Esta fórmula reside en `calcularCortes()` y es compartida por Caja, Finanzas y reportes.
- El campo interno heredado `sobre` no se renombra: sólo se cambian etiquetas visibles a «entrega a administración».

## Seguridad, identidad y conservación

- Tabla nueva aditiva `caja_admin_movs`: UID idempotente, identidad, turno, fecha, nota, estado de anulación, responsable y momento de anulación.
- El encargado opera tras Access + PIN, únicamente en su turno; administración usa sus rutas del Panel.
- La SQL impide crear o anular movimientos nuevos de un turno ya cerrado, incluso ante peticiones simultáneas.
- Al anular se conserva el registro y su folio; deja de sumar en Caja y Finanzas.
- Las operaciones offline mantienen su UID en la cola existente, separada por persona, turno y día; pendientes no se anuncian como saldo confirmado.
- No se reclasifican ni borran asientos antiguos. En particular, los movimientos de pruebas del 19/10/2026 conservan su clasificación histórica.
- El alta manual heredada de «Aumento de cambio» se bloquea en las rutas de ingresos extra; los aportes del **inicio** de turno siguen funcionando y mantienen su registro anterior. Evita contabilizaciones duplicadas.
- No activar purgas de esta tabla sin definir y aprobar retención de sus registros de auditoría.

## Precisión y límites

El saldo muestra **efectivo esperado según registros recibidos**. Los movimientos internos guardados en D1 aparecen en la siguiente lectura del Panel (sondeo cada 20 segundos). Los cobros en la hoja de Google se reflejan únicamente después de su sincronización; el panel muestra fecha de sincronización o aviso de fallo. Esto **no sustituye** el conteo físico ciego del encargado.

Las pruebas con SQLite real y CI son sintéticas. No son una prueba de tablet física, reconexión offline en dispositivos ni de un corte real en producción.

**Sin despliegue permitido** mientras el PR esté en borrador. Antes de publicar, revisar CI, compilaciones `--dry-run`, rama y SHA, así como que el Worker productivo no ha cambiado inesperadamente.