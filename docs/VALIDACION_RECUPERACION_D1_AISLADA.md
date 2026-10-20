# Validación D1 restaurable en una segunda base aislada

**Estado: procedimiento preparado, NO ejecutado.** Continuidad de la auditoría
del 19 de octubre de 2026. Este texto no autoriza ejecutar pruebas,
crear bases Cloudflare, modificar datos ni publicar.

## Separación estricta

- Producción: la D1 `castano-facturas` y el Worker `basculaypension-web`.
  Nunca ejecutar en ellos `d1 execute`, restauraciones ni limpiezas.
- Finanzas ensayo: `castano-finanzas-integral-ensayo-20261018`. **No usarla**
  como destino: contiene su propio estado de pruebas.
- Destino: crear **otra D1 nueva y vacía** solo tras autorización específica;
  sugerencia `castano-recuperacion-verificacion-AAAAMMDD`. Comprobar UUID
  único, sin Worker público, configuración separada y contenido inicialmente vacío.
- No modificar SQLite operativo de BASCULAYPENSION local, carpeta/libro
  `BASCULA Y PENSION 2026` ni carpetas productivas de documentos.

## Secuencia para la validación conjunta

1. Revisar SHA de trabajo, cuenta Cloudflare y autorización para pruebas.
   Comenzar exclusivamente con datos y documentos sintéticos.
2. Solicitar permiso para crear la D1 exclusiva de recuperación. Antes
   de importar, verificar su nombre, UUID, configuración y ausencia de
   tablas de usuario. No reutilizar bases existentes.
3. Ejecutar el ciclo de ensayo completo: exportar fuente sintética →
   descargar SQL → importar mediante Wrangler `d1 execute --remote --file`
   con configuración aislada → consultar y comparar. Inspeccionar el
   destino nuevamente inmediatamente antes de la importación.
4. Conciliar esquema, índices, tablas, conteos, consultas de muestra
   y `PRAGMA quick_check`; registrar solo identificadores de prueba.
5. Cifrar el respaldo con la clave pública age de la Mac y verificar
   SHA-256, transferencia resumible y recuperación con la clave privada
   en la Mac. No almacenar SQL plano en Drive ni dentro del repositorio.
6. La exportación de producción requiere **autorización separada y
   ventana operativa**: Cloudflare advierte que exportar D1 puede
   bloquear temporalmente consultas. El contenido restaurado sería
   igualmente privado y no debe conectarse a un Worker público.
7. Al cierre, conciliar referencias D1 ↔ Drive ↔ KV y dejar un acta
   sin datos personales. No destruir la D1 aislada ni los artefactos
   hasta recibir una autorización posterior específica.

## Criterios y límites

Éxito solo si la segunda D1 reconstruye los datos esperados y los
controles criptográficos coinciden, sin tocar datos productivos.
`quick_check=ok` y Time Travel por separado no prueban restauración.
No se ha creado la D1 objetivo ni hecho ninguna importación; Windows/WSL
y la automatización siguen suspendidos. D1 no incluye los binarios
guardados fuera de su base en KV o Drive.

Referencias:
- https://developers.cloudflare.com/d1/best-practices/import-export-data/
- https://developers.cloudflare.com/workers/wrangler/commands/d1/
- https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/export/
