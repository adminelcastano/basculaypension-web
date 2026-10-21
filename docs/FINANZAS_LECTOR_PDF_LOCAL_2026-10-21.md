# Lector privado de PDF para estados de cuenta — PR #44 (21/10/2026)

**Estado: BORRADOR, NO PUBLICADO.** Basado en main publicado del PR #43. No añade datos bancarios, secretos, nombres, cuentas ni documentos reales al repositorio.

## Flujo del administrador
1. Abrir **Dinero → Estados de cuenta** dentro del panel protegido por Cloudflare Access.
2. Seleccionar la cuenta bancaria o tarjeta **correcta**.
3. Elegir un archivo PDF local (máximo 12 MB y 30 páginas), pulsar **Leer PDF**.
4. El módulo PDF.js 4.10.38 se carga **del mismo dominio**, mediante `/panel/vendor/pdfjs-4.10.38/pdf.min.mjs` y su worker. Ambas rutas atraviesan verificación de Access. Los bytes del PDF se pasan únicamente al navegador, sin enviarse por HTTP al Worker ni a Google; no se guarda PDF, texto original, imagen ni copia en D1.
5. Se analizan los encabezados y el resumen bancario, no cada cargo individual. Se muestra un **resumen de datos sugeridos con advertencias**.
6. Únicamente si coincide la institución **y el tipo débito/crédito**, el botón **Aplicar sugerencias al formulario** copia campos vacíos sin sobrescribir importes escritos manualmente ni una edición previa. No crea movimientos contables.
7. Se deben revisar fechas, intereses, cargos, abonos, saldos y advertencias antes de guardar **manualmente** con la ruta y auditoría ya existentes del PR #43. La consistencia se recalcula al leer el registro guardado. Un PDF con discrepancia no produce ajustes compensatorios.

## Cobertura inicial deliberadamente conservadora

| Emisor | Fuentes de datos dentro del estado |
|---|---|
| BBVA PYME (débito) | `PERIODO`, `SALDO ANTERIOR`, `DEPOSITOS/ABONOS`, `RETIROS/CARGOS`, `SALDO FINAL`. No agrega `COMISIONES` si el propio estado indica que se aplicarán en el siguiente. |
| Mercado Pago (saldo disponible) | `Saldo inicial`, `Abonos`, `Saldo final`, `Cargos`, `DETALLE DE MOVIMIENTOS: Período`. No presupone que las comisiones ya estén incluidas en cargos. |
| Banorte Crédito y Nu | Resumen de cargos y abonos del periodo; cargos regulares, capital de compras a meses, intereses, comisiones e IVA por separado, sumados una sola vez. Pago mínimo y pago para no generar intereses proceden de la sección de pago requerido. |
| American Express | Periodo de facturación, vencimiento, nuevo total de cargos y desglose de intereses/IVA/comisiones. Como saldos y pagos se presentan en una tabla mixta, permanecen pendientes de captura si no existe una etiqueta inequívoca. |
| Liverpool | **Sin extracción automática verificada.** Captura manual, especialmente si el PDF es imagen. |
| Telcel | **No admitido como estado bancario**: recibos de servicio y no conciliación de cuenta. |

Los nuevos emisores o formatos se mostrarán como **no identificados** y no se aplicarán. Coppel, Elektra y Banjercito podrán añadirse posteriormente con plantillas propias basadas en sus PDF; no se infieren.

## Seguridad y límites
- `src/panel/cliente/05d-estados-pdf.js`: parser local y acceso dinámico a PDF.js propio. No usa `fetch`, `EC.post` ni almacenamiento local con el PDF.
- `src/panel/cliente/05b-estados.js`: selector, vista previa y confirmación; no se añade campo `name` al selector de archivo, y está fuera del formulario de guardado.
- `src/panel-app.js`: sirve dos módulos de texto PDF.js desde rutas versionadas, con Access y caché privada; sin scripts CDN.
- `package.json`: versión exacta `pdfjs-dist=4.10.38`. `wrangler*.jsonc`: regla de texto para `*.mjs`. CI instala la librería con `--ignore-scripts`.
- PDF máximo 12 MB / 30 páginas; sin OCR, sin ejecución de JavaScript embebido en el PDF. Si texto ilegible, informar y capturar manualmente. Los PDF escaneados no se reconocen.
- No se transmite PDF ni se usa un modelo externo ni Workers AI. Solo la biblioteca de terceros PDF.js descargada e integrada en el Worker durante compilación.
- La lectura identifica banco por nombre y cuenta por selección explícita; **nunca** usa números de cuenta ni intenta asignar automáticamente titulares.
- Los campos `cargos` y `abonos` son totales positivos; saldos inicial/final negativos se preservan. El desglose intereses/IVA/comisiones forma parte de cargos y nunca se suma dos veces.
- Las tarjetas pueden incluir compras diferidas aún no exigibles: su saldo deudor total **no equivale** necesariamente al pago para no generar intereses, y la aritmética puede diferir. Si hay diferencia se muestra advertencia; el administrador debe revisar antes de aceptar.
- No se modifica el esquema, saldos, movimientos, deduplicación o cron de D1 ni la hoja SALARIOS. `SALARIOS_SYNC_ACTIVE=NO` se conserva en wrangler.

## Validaciones antes de publicar
- Pruebas unitarias automatizadas **solo con encabezados y cantidades inventadas**, sin PDF originales.
- `node --test pruebas/*.test.js` y ambos Wrangler `deploy --dry-run` deben pasar.
- Pendiente: ejecutar pruebas manuales **desde una sesión real de administración** con PDF reales, comprobando presentación móvil y contenido correcto antes de permitir publicación. No hacer POST durante esta validación sin permiso.
- Pendiente de verificar caracteres/fonts de PDF.js con documentos reales, especialmente páginas a dos columnas y AMEX.
- GitHub Cloudflare PR Preview puede fallar por configuración preexistente `previews`; no confundir con un Worker productivo publicado.
