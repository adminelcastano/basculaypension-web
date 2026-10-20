# Reparación urgente de Facturación — aislamiento y continuidad

**Rama:** `correccion-urgente/facturacion-contacto-fotos-csf-20261019`.
**Origen exacto:** `main` en `8f088fabf506fcdc9d6e4069f6dc0077f979bc47`.
**Estado:** código preparado; sin pruebas de aplicación, sin fusión, sin publicación ni cambios sobre clientes reales.

## Hallazgos comprobados

1. El commit `f920706` del 17 de octubre volvió opcionales correo y WhatsApp; la captura de panel muestra «Correo: Falta». El correo no se eliminó del formulario, pero dejó de exigirse. El panel no permitía corregirlo.
2. Los rechazos de fotografías dependían de heurísticas visuales y clasificación por IA, con reintentos y transferencias duplicadas. El resultado de IA «otro» podía rechazar tickets auténticos cuando no extraía folio/importe.
3. La lectura automática de constancias estaba limitada a PDF con texto. Los JPG, PNG, WebP, HEIC y PDF escaneados carecían de lectura equivalente.
4. También existían límites de envío por IP, tamaño y modo ahorro; no hay evidencia de que sean la causa de los incidentes concretos sin pruebas/registros adicionales.

## Correcciones preparadas

- Correo obligatorio en navegador y servidor; administración puede rellenarlo o corregirlo en solicitudes pendientes o en revisión sin alterar registros históricos automáticamente.
- Subida de fotos sin filtros de calidad bloqueantes ni doble previsualización IA. Revisión de IA en servidor como advertencia, limitada a 7 s. Firma real del archivo para reconocer JPG, PNG, WebP, HEIC/HEIF y PDF aunque el móvil no informe correctamente el MIME.
- Archivos adjuntos conservados en la interfaz ante errores de conexión o respuestas del servidor; selección asíncrona protegida frente a carreras.
- Extracción de datos de CSF desde imagen con el modelo de visión Workers AI ya conectado; PDF con texto sigue extrayéndose localmente y PDF escaneado puede analizar hasta dos páginas rasterizadas. Ningún servicio externo nuevo.
- OCR restringido por Cloudflare Access y `X-Panel`, validación de tamaño/tipo, sin devolución de la imagen completa o texto del documento y sin registrar contenido fiscal en logs.
- Si el OCR propone un valor distinto de uno ya capturado, el panel muestra una advertencia y conserva intacto el valor escrito por administración.
- RFC, nombre, CP y régimen solo como sugerencias; no autoguardar. Varios regímenes exigen selección humana. El resultado anterior nunca pisa valores ya escritos por administración.

## Validación pendiente antes de fusionar

- Pruebas Node de la suite existente y nuevos contratos de correo, subida de imágenes, firmas y extracción; dry-run de Wrangler principal. **No ejecutadas por la indicación vigente de validación conjunta.**
- Pruebas reales: iPhone HEIC, Android JPEG/PNG/WebP, imágenes sin MIME y PDFs de texto/escaneados; teléfonos con poca memoria y conectividad móvil intermitente.
- Verificar formato de RFC con Ñ, CP con cero inicial, régimen múltiple, solicitudes históricas sin correo, recarga del detalle y edición concurrente.
- Confirmar que el alta de una solicitud con correo obligatorio funciona y que el panel lee una constancia sin conservar sugerencias automáticas incorrectas.
- Auditoría de consumo de Workers AI y validación de copias: no usar expedientes reales en ensayos. No modificar D1/KV productivos.

## Límites y publicación

El modelo puede equivocarse, las imágenes HEIC que el navegador no puede decodificar siguen requiriendo conversión o captura manual, y el modo ahorro puede pausar nuevas solicitudes. La fotografía aún debe verificarse manualmente antes de emitir un CFDI. Este cambio no altera la emisión, los folios, contabilidad ni la rama de deuda técnica.

**No fusionar ni desplegar sin pruebas conjuntas satisfactorias y autorización separada.**
