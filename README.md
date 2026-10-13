# Báscula y Pensión El Castaño

Página web de basculaypension.com. Sitio estático en `public/`, sin compilación. Se publica en Cloudflare Workers (archivos estáticos) con la configuración de `wrangler.jsonc`.

## Cambiar datos del negocio

Al final de `public/index.html` está el bloque `NEGOCIO` con WhatsApp, teléfono, correo, dirección, enlace de Google Maps y horarios. Al cambiar un valor ahí, la página se actualiza en todos los lugares donde aparece. Los campos vacíos (tarifas, capacidad, plazo de factura) no se muestran.

## Publicación

Cloudflare publica automáticamente cada cambio en la rama `main` (comando de despliegue: `npx wrangler deploy`).

## Archivos (en `public/`)

- `index.html`: la página.
- `404.html`: página para enlaces que no existen.
- `fonts/`: tipografía Barlow servida desde el propio sitio (licencia en `fonts/OFL.txt`).
- `favicon.svg`, `favicon-32.png`, `apple-touch-icon.png`: íconos.
- `og-image.png`: imagen que aparece al compartir el enlace por WhatsApp o redes.
- `robots.txt`, `sitemap.xml`: para buscadores.
- `_headers`: cabeceras de seguridad y caché.

## Panel: Facturación y Personal

`/panel` (protegido con Cloudflare Access) tiene dos secciones:

- **Facturación**: solicitudes de factura (Pendientes, Facturadas, Rechazadas, Histórico).
- **Personal**: expediente laboral de colaboradores. Se da de alta al colaborador con nombre y WhatsApp; el panel genera un enlace personal (`/expediente/<código>`) que se le envía por WhatsApp para que llene sus datos (personales, domicilio, contacto de emergencia, escolaridad, experiencia y referencias). En el panel se palomean los documentos entregados en físico (2 copias de INE, CURP, solicitud de empleo, acta de nacimiento, comprobante de domicilio y comprobante de estudios). Cada colaborador está Activo o Inactivo (con fecha y motivo de baja); el enlace de un inactivo deja de funcionar. No se guardan escaneos. Código en `src/personal.js` y `src/expediente.html`; datos en la tabla `colaboradores` de D1.
