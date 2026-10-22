# Línea base de contratos — Etapa 0 (en preparación)
**Referencia inmutable:** `b9973b25b18fbd69892eeb84bbfede9b5c57a14a`.

Esta etapa NO autoriza una refactorización contable ni certifica equivalencia. El inventario de `scripts/refactor-inventario.mjs` solo reconoce señales léxicas de exports, rutas y dependencias; no constituye una tabla de endpoints ejecutados.

| Área | Módulos principales | Invariantes protegidas | Validación existente |
|---|---|---|---|
| CAJA | `src/caja.js` | Cierres, transferencias, cortes, reintentos, centavos, una contabilización | `caja-administracion-saldo`, `finanzas-cierre-pendientes-integracion`, `finanzas-rutas-ejecutadas` |
| DINERO | `src/finanzas.js`, `src/cuentas.js` | Saldos sin doble gasto, obligaciones confirmadas, traspasos internos y cuentas históricas | `finanzas-sqlite-integracion`, `finanzas-rutas-mov-cuentas-integracion` |
| AGENDA | `src/agenda.js`, `src/compras.js` | UID, no duplicar tickets, memoria, estados programados y reversión | `compras`, `finanzas-rutas-pagos-compras-integracion` |
| FACTURACIÓN | `src/worker.js`, `src/facturas-registro.js` | Folios, identidades, autorización, adjuntos y retención | `facturacion-api-servidor`, `facturacion-cancelacion-multiple` |
| PERSONAL/TURNO | `src/personal.js`, `src/turno.js` | PIN, aislamiento, offline, constancias y acceso | `personal-constancias-v1`, `turno-uid-privacidad-drive` |
| CASTAGRAM | `src/avisos.js`, `src/agenda.js` | Audiencia privada, Leído distinto de Enterado, archivo y fotografías autorizadas | `castagram-privacidad`, `castagram-fases-adversarial`, `foto-http-sesion-real` |

Se consideran **pendientes** las capturas normalizadas de solicitudes/respuestas HTTP y JSON sintéticos para los seis dominios, así como la validación de navegador con Chromium/WebKit antes de declarar completa la Etapa 0.

La referencia previa de CI para este commit registró 465 pruebas correctas y dos compilaciones Wrangler sin publicación. Nuevas pruebas y refactorizaciones tienen que superar su propia CI. No se modifican D1/KV productivas, recursos de fotografía, secretos ni integraciones deshabilitadas.
