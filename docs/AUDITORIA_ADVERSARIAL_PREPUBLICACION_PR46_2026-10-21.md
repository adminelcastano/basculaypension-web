# Auditoría adversarial prepublicación · PR #46

**Fecha:** 21 de octubre de 2026 (México) / 22 de octubre UTC.
**Base:** `main@916ed4366cf34abfab0557a9dada3fe53c3b52d3`.
**Rama:** `feat/caja-dinero-integral-20261021`.
**Alcance:** cambios del PR #46 y contratos con CAJA, AGENDA, movimientos administrativos, D1, KV, Access, estados bancarios manuales y navegación. No constituye auditoría certificada de todo el sistema externo ni de la exactitud de los registros reales.

## Resultado y hallazgos

| Riesgo | Impacto adversarial | Mitigación aplicada |
|---|---|---|
| ALTO · Interpretación ambigua de pesos | `1,50` se convertía silenciosamente en 150, multiplicando el valor contable | Parser de pesos valida miles de tres dígitos, punto decimal y hasta dos centavos; rechaza separadores ambiguos, objetos, arreglos y precisión excesiva |
| ALTO · Liquidez erróneamente completa | Se podía presentar «Disponible» aunque hubiese movimientos bancarios sin cuenta | Resumen financiero ahora presenta «Incompleto»; tarjeta y escenario no se muestran como totales verificados |
| MEDIO-ALTO · Conciliación de saldos engañosa | Podía aparecer una diferencia de banco pese a operaciones sin asignación | `cotejarCuentasMes` devuelve «No comparable» y `diferencia=null` cuando existe entrada/salida sin cuenta |
| MEDIO-ALTO · Historia de abonos incompleta | Al depurar `agenda_pagos` después de 13 meses sobrevivía el importe, pero se perdían fecha efectiva/medio/concepto | Nuevos campos históricos persistentes por abono, actualización por trigger al corregir pago y migración aditiva; la retención anterior mantiene cifras intactas |
| MEDIO · Fechas históricas aparentes | En abonos viejos sin fecha real se enseñaba la fecha de alta como si fuera de pago | Diferenciar explícitamente «Pagado», «Registrado» y «Fecha efectiva no disponible» |
| MEDIO · JSON hostil | `null` o arreglos en API de obligaciones/estados podían generar 500 | Respuestas controladas 400/422 y validación del tipo de los campos |
| MEDIO · Compatibilidad de esquema | Preview previa contenía `fin_obl_abonos` sin campos históricos | Lectura de `PRAGMA table_info` y `ALTER TABLE ADD COLUMN` solo para columnas faltantes, sin recrear ni borrar abonos; prueba de SQLite preexistente |
| MEDIO · Navegación y vista reducida | Pantallas plegables/iPad y enlaces profundos podían esconder acciones o salir del panel | UX ya validada con 11 perfiles Chromium/WebKit; retorno protegido, controles táctiles y menú íntegro |

## Pruebas adversariales y garantías

- SQLite de ensayo: abonos parciales, sobrepago rechazado con rollback completo, reintentos UID, edición concurrente optimista, anulación y conservación histórica después de borrar un recibo operativo.
- SQLite de esquema antiguo: migración solo aditiva, abono histórico de 125 centavos intacto, sin generar fecha ni medio inexistentes.
- Entradas hostiles: JSON `null`, texto, arrays, campos objeto, fecha inexistente, importes negativos, más de dos decimales y comas mal agrupadas; nunca generan nuevos pagos o estados.
- Separación de cifras: deudas reales distintas de programas estimados, dinero de sobres/débito separado de tarjetas, cuentas por cobrar de CAJA en solo lectura, comparación bancaria solo con fechas equivalentes y movimientos asignados.
- Protección: rutas administrativas tras Cloudflare Access; API de estados/obligaciones `no-store`, cabeceras de panel contra escrituras ajenas, configuración de Preview sin integraciones externas ni crons.
- Navegación sintética: Windows Chrome, macOS WebKit, iPad mini/iPad 10 ambas orientaciones, iPhone grande y Z Fold7/Z Flip7 en formato compacto/desplegado; menú, teclado y áreas táctiles sin desbordamientos.
- Las pruebas deben tomarse de la ejecución en la **cabeza final** del PR #46; no inferir aprobación de la ejecución de un commit anterior.

## Riesgos residuales y decisión de publicación

1. **Conservación histórica preexistente:** los recibos que ya fueron depurados antes de esta migración no pueden recuperar automáticamente la fecha, medio o concepto real que no se guardó. Nunca inventarlos.
2. **Deuda de tarjeta frente a una factura:** si la misma compra se registra como pasivo confirmado y aparece en la deuda de la tarjeta, no se deben sumar las dos referencias sin una conciliación humana. El tablero las muestra por separado y explica el límite, pero no las vincula automáticamente.
3. **Fuentes externas:** sincronización de tickets, cierres y saldos bancarios reales requieren observación administrativa; el CI usa datos sintéticos, no certifica valores históricos productivos.
4. **Despliegue D1:** no se ha ejecutado ninguna migración nueva contra la D1 productiva. Antes de autorizar la publicación debe existir punto de recuperación D1 verificado, plan de rollback y validación postdespliegue con lecturas no destructivas.
5. **Seguridad de CI:** mantener API Token Cloudflare en GitHub Secrets, limitado en permisos y duración; jamás exponerlo por chat, logs o repositorio. La Preview dispone de D1 y KV independientes y Access administrativo.
6. **Dispositivos físicos:** la comprobación del usuario confirma uso satisfactorio; la matriz automática emula navegadores/tamaños y no reemplaza por sí sola pruebas nativas de sistemas operativos y lectores de pantalla.

### Puerta de publicación

**Código candidato:** sujeto a CI verde final y aceptación del administrador. **No equivale a autorización de producción.**

**Orden después de recibir autorización explícita:** validar `main` y la cabeza del PR; comprobar D1/backup previo y bindings; fusionar solo el PR autorizado; desplegar `wrangler.jsonc` a producción en ventana controlada; validar acceso, CAJA, DINERO, obligaciones, saldo/conciliación y encabezados de caché con consultas no destructivas; comprobar que CASTAGRAM, Personal y Facturas sigan intactos; detener y revertir Worker si los smoke tests fallan.

**Prohibido** fusionar, publicar, modificar saldos/filas reales o desactivar Access sin autorización diferenciada.
