# Proyecto aislado: facturación desde QR emitidos por BASCULAYPENSION local

**Fecha de evaluación:** 24 de octubre de 2026  
**Rama:** `feat/facturacion-qr-local-20261024`  
**Estado:** prototipo revisable; no fusionar, no publicar, no activar envíos reales por pruebas.

## Muestras recibidas

Se decodificaron las cuatro fotografías aportadas (dos tickets, cada uno completo y ampliado). Los códigos son URL HTTPS, no documentos fiscales ni pruebas criptográficas.

| Campo | Báscula (salida) | Pensión (salida) |
|---|---|---|
| Ruta del QR | `https://www.basculaypension.com/factura/` | Misma |
| MODULO | `BASCULA` | `PENSION` |
| FOLIO | `A00003` | `00003` |
| MATRICULA | `QIE6D6CC13` | `QI29132A1C` |
| CLIENTE | `QA IMPRESIÓN` | `QA IMPRESIÓN` |
| TARIFA | `160.00` | `200.00` |
| IMPORTE TOTAL | `160.00` | `200.00` |
| FORMATO | `G7-SYNTHETIC-EXIT-1` | Mismo |
| PAGOS | EFECTIVO 160.00 | EFECTIVO 200.00 |
| AVISO | QA / SINTETICO | QA / SINTETICO |
| BANK_CASE_ID | Valor interno QA no persistido | Valor interno QA no persistido |

**Inconsistencia crítica:** el comprobante físico de pensión declara «PAGO AL ENTRAR $0.00» y «SALDO POR PAGAR $200.00», aunque el QR declara `PAGOS=[{"METODO":"EFECTIVO","IMPORTE":"200.00"}]`. No interpretar **PAGOS** como cobranza confirmada ni asignar automáticamente la forma fiscal de pago, importe facturable final o estatus de pagado.

## Situación actual de Facturación WEB

- `/factura/` recibe foto del ticket, servicio, folio opcional, CSF o datos fiscales, uso de CFDI, forma de pago, correo, consentimiento y solicitudes de una/dos facturas.
- `/api/solicitud` crea una **solicitud pendiente**, pero no emite CFDI ni escribe en SQLite del programa local.
- Administración revisa evidencia, folio/importe y, cuando corresponde, registra facturas emitidas fuera de la web.
- La verificación de duplicados identifica por **servicio + folio normalizado**, conservando ceros iniciales. El QR de báscula requiere admitir el prefijo `A` sin admitir letras arbitrarias.

## Primera fase implementada únicamente en la rama

1. `public/factura/qr.js`: parser de URL acotado a dominios oficiales y al único `FORMATO` observado en QA; no procesa peticiones HTTP ni consulta bases externas. Rechaza duplicados, importes inválidos y folios ajenos al patrón conocido.
2. `public/factura/index.html`: al abrir el QR, precarga **solo el servicio y el folio**; muestra matrícula, cliente e importes como referencia, con aviso **sin verificar / no acredita pago**. No rellena RFC, razón social fiscal, correo ni forma de pago.
3. Sigue siendo obligatorio aportar **foto del ticket** y CSF o datos fiscales. La URL del QR se retira del historial cuando se interpreta; no se guarda URL completa ni `BANK_CASE_ID`. Al enviar una solicitud autorizada en el futuro, una nota identifica la referencia QR como no verificada en `comentario`, sin alterar esquemas.
4. `src/facturacion-reglas.js`, el Worker y el Panel de administración aceptan también folios `A` + dígitos; los folios puramente numéricos siguen funcionando.
5. `public/_headers`: `no-store` y `no-referrer` para las páginas de facturación con parámetros operativos.
6. Pruebas sintéticas: parser, datos QR, detección de pagos no acreditados y navegador Chromium/WebKit. **No efectuar pruebas de envío contra producción.**

## Límites y decisiones pendientes antes de autorizar integración definitiva

- **Formato de producción:** las muestras tienen `QA / SINTETICO`; falta el contrato oficial de QR que emitirá BASCULAYPENSION local en operación real, con versión y campos estables. No se adivina el futuro `FORMATO`.
- **Integridad:** cualquier URL sin firma puede modificarse. En la fase final se debe acordar una firma digital o token verificable por el servidor web, sin exponer secretos en QR/chat y sin escribir en la SQLite operativa local. Hasta entonces la foto y el cotejo manual son obligatorios.
- **Cobranza:** definir semántica fiable de `PAGOS` (pagos realmente confirmados o métodos previstos), saldo por pagar y ajustes. Nunca facturar por presunción de pago.
- **Origen/redirect:** comprobar que `www.basculaypension.com` abre el sitio correcto y conserva la consulta al redirigir; esta ruta no fue verificada en equipos reales.
- **UX en teléfonos:** comprobar lectura por cámara nativa, apertura de enlace y rendimiento en Android/iOS, sin habilitar `camera` en el formulario público.
- **Privacidad:** los QR llevan cliente y matrícula en URL. Valorar reducir identificadores en el QR de producción; no colocarlos en logs, analítica, fragmentos de enlaces o datos fiscales.
- **Emisión fiscal:** no mezclar el «cliente» de pesaje con razón social, RFC o datos fiscales. La página es solo solicitud de facturación, no SAT/CFDI.
- **Publicación:** no fusionar esta rama ni autorizar despliegue automático a `main` hasta que el usuario lo ordene expresamente.

## Separación de sistemas

BASCULAYPENSION WEB y BASCULAYPENSION local son proyectos diferentes. El QR es un medio de transferencia de referencia **de solo lectura**. Esta fase no agrega conexiones, sincronizaciones, rutas de escritura ni secretos entre los sistemas.
