# Etapa 1 — Extracción de CASTAGRAM (en revisión)

Se extrajo el bloque de muro y archivo (606 líneas funcionales) de `src/panel/cliente/07-agenda.js` a `07-castagram-controlador.js`, preservando su texto original, incluida la UI de Leído/Enterado, comentarios, permisos y galerías.

El ensamblado sigue concatenando JavaScript en el panel protegido por Cloudflare Access. La fábrica recibe estado y utilidades comunes por interfaces explícitas; no crea un segundo almacén ni cambia rutas HTTP o tablas.

### Verificación requerida
- Comparación literal del bloque original con el extraído.
- Suite completa, incluyendo pruebas existentes que consultaban el archivo antiguo.
- Navegadores móviles Chromium y WebKit con datos sintéticos.
- Escenarios con destinatarios privados, fotos, archivo, reintentos de comentarios, Leído frente a Enterado y tablet compartida.

Aún no declara completada la Etapa 1; resta separar calendario y tareas y revisar el coordinador. No fusionar a `main` ni desplegar sin autorización expresa.
