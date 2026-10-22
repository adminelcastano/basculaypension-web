# CAJA y DINERO · integración candidata a aprobación

**Fecha de corte:** 21 de octubre de 2026 · **Rama:** `feat/caja-dinero-integral-20261021` · **Base:** `main@916ed4366cf34abfab0557a9dada3fe53c3b52d3`

> **No fusionar ni desplegar por este documento.** El PR propone código para revisión; ninguna prueba sobre bases sintéticas demuestra por sí sola exactitud de saldos productivos.

## Qué cambia

CAJA sigue siendo el único origen de tickets, cobros de clientes, abonos de pendientes, gastos de turno, cortes y diferencias. DINERO muestra liquidez y recursos financieros, cuentas y tarjetas, obligaciones reales y pagos, **sin registrar ventas ni cobros otra vez**.

DINERO dispone de cuatro bloques principales: **Resumen financiero**, **Bancos y tarjetas**, **Cuentas por pagar y cobrar**, **Movimientos y pagos**. Las transferencias de clientes se capturan en CAJA con las mismas rutas de API; los enlaces viejos de DINERO redirigen a CAJA. Las compras por hacer pasan a AGENDA. SALARIOS está en Configuración → Conexiones, con sincronización **desactivada**.

Los estados bancarios se capturan **manualmente**; se retira el lector local de PDF bancario y su dependencia, no los comprobantes PDF de gastos. Las dos referencias (saldo operativo calculado y estado bancario capturado) se muestran por separado, y una diferencia solo se calcula si ambos corresponden al mismo cierre mensual completo. No hay ajustes implícitos de saldos.

Las obligaciones confirmadas tienen acreedor, concepto, principal MXN en centavos, emisión opcional, vencimiento, referencia, estado, versiones y registro de abonos parciales. Los pagos reutilizan `agenda_pagos` y su **único gasto administrativo** en `caja_gastos`, con inserción condicional, prevención de sobrepagos, reintentos idempotentes, auditoría y anulación. DINERO consulta las cuentas por cobrar originadas en CAJA en modo solo lectura. Los programados se etiquetan como **estimaciones**, no como deuda.

## Correspondencia con los 22 criterios del traspaso

| N.º | Requisito | Estado del código |
| --- | --- | --- |
| 1 | Separar CAJA y DINERO | Aplicado; contratos preservados |
| 2 | Cuatro apartados financieros | Aplicado; accesos antiguos compatibles |
| 3 | Simplificar resumen mensual | Aplicado; detalle operativo secundario |
| 4 | Retirar lector PDF de bancos | Aplicado; comprobantes PDF conservados |
| 5 | Formulario manual de débito y crédito | Aplicado; campos opcionales y validación |
| 6 | Conciliación de dos saldos | Aplicado; lectura sin asientos |
| 7 | Depósitos, retiros, traspasos y pago de tarjetas | Flujos originales conservados; pruebas de no duplicación |
| 8 | Obligaciones confirmadas | Esquema aditivo y controles añadidos |
| 9 | Previstos distintos de deuda | Etiquetas y agregaciones diferenciadas |
| 10 | Abonos y liquidación | Vinculados a pago real, con límites transaccionales |
| 11 | Por cobrar CAJA en DINERO | Consulta sin duplicar el ingreso |
| 12 | Transferencias de clientes a CAJA | Relocalizadas; misma API y alertas |
| 13 | Compras futuras a AGENDA | Reubicadas sin cambiar identificadores internos |
| 14 | Pago administrativo de una sola fuente | Reutiliza ruta de Agenda y un gasto |
| 15 | Diferencias y turnos en CAJA | El detalle no se duplica en resumen |
| 16 | SALARIOS fuera del menú | En Configuración, sin activar la sincronización |
| 17 | Tablero con indicadores y proyección | Calculado; parciales/desconocidos distinguidos |
| 18 | Configuración, auditoría, informes secundarios | Conservados; historial de obligaciones añadido |
| 19 | Inicio, rutas y adaptabilidad | Rutas verificadas con tests; **validación visual pendiente** |
| 20 | Seguridad, datos y privacidad | Sin migración destructiva ni secretos nuevos; protección Access existente |
| 21 | Pruebas integrales | CI/SQLite sintético y builds; **Preview y aceptación visual pendientes** |
| 22 | Una entrega autorizable | Rama única; preparar PR individual; **sin fusionar ni desplegar** |

## Invariantes monetarios y conservación

- El alta de una obligación **no** crea gasto ni salida bancaria.
- Un abono se vincula a **un** pago administrativo, que crea **un** egreso en el libro existente; reintentar con el mismo UID no duplica.
- Los triggers D1 impiden abonos que superen principal y reducciones de deuda por debajo de pagos vigentes.
- Un pago borrado por la administración anula su vínculo en el mismo lote y devuelve su importe al saldo exigible. La depuración regular de recibos de más de 13 meses **no reabre automáticamente** obligaciones: sus importes históricos vinculados subsisten, aunque el comprobante operativo ya no esté disponible.
- La retención del historial existente es de 13 meses donde así se aplicaba. Las nuevas versiones de obligaciones se conservan en su propia tabla; no se afirma recuperación de versiones anteriores a su creación.
- Las cuentas por cobrar siguen perteneciendo a CAJA y no se suman como ingreso realizado antes de su cobro.
- El saldo de débito se separa de deuda de crédito y de montos desconocidos. Los estados bancarios son evidencia de otra fecha, no asientos contables.
- El campo «previsto» de AGENDA representa programación aproximada, no pasivo exigible.
- Cualquier obligación manual correspondiente a una tarjeta requiere revisión humana para no interpretarla junto a la deuda de esa misma tarjeta como deudas independientes.

## Evidencia técnica

CI de GitHub Actions: `node --test pruebas/*.test.js` (incluye SQLite sintético, idempotencia, rutas, contratos de CAJA, salarios, CASTAGRAM y estados manuales) y dos compilaciones `wrangler deploy --dry-run` (producción y `wrangler.finanzas-ensayo.jsonc` **sin publicar**). La ejecución precisa y conteo de pruebas deben verificarse en la cabeza final de este PR.

## Pendiente de aceptación por administración

- **Vista previa aislada y protegida**, con D1/KV de ensayo exclusivamente sintéticos y bloqueo de escritura ajena al módulo financiero. No se ha desplegado ninguna Preview de esta nueva rama sin autorización.
- Revisar en navegador con administración: iPhone/celular estrecho, Android/plegable cerrado, tablet y escritorio; navegación por teclado y lector de pantalla. Comprobar las cuatro tarjetas, los grupos desplegables, CAJA → Transferencias, AGENDA → Compras, Configuración → SALARIOS y pago vinculado a obligación.
- Revisar los cierres y diferencias con registros ficticios. No comprobar datos productivos individuales ni alterar D1 real.
- Decidir si se autoriza posterior ensayo Preview y, tras su aceptación, la fusión y publicación. **Cada acción requiere autorización expresa**.

## Fuera de alcance y estado del PR anterior

CASTAGRAM, Facturas, Personal, cortes existentes y BASCULAYPENSION local deben quedar intactos. El PR **#45**, abierto y con un lector PDF del enfoque antiguo, **no se fusiona, fuerza ni cierra automáticamente**. Su Preview temporal **no valida** el PR integral.

**Punto de detención:** PR listo para revisión de código y CI; **no autorizar publicación con base exclusivamente en dry-run**.
