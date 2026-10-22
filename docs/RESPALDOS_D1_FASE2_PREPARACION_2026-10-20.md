# Fase 2 — Respaldo y recuperación D1, preparación aislada

**Estado:** preparado en rama de trabajo, **NO operativo ni autorizado para producción**. Fecha: 20/10/2026.
**Base:** `main@008f18601820d8e4d89d5b52a5d2d35eb1092376` (Worker 160 al iniciar).
**Origen:** selección de herramientas de `deuda-tecnica/fases-1-4-20261019`, no fusión de esa rama.

## Qué queda incorporado

- `herramientas/respaldo-portable.sh`: SHA-256 portable entre macOS y Linux, validación estricta del manifiesto.
- `herramientas/respaldo-d1-cifrado.sh`: un **único caso de exportación remota de una D1 sintética aislada**, con interruptores desactivados por defecto, comprobación previa de nombre y UUID, restauración SQLite local de prueba, cifrado age, hash e instalación del cifrado completo sin sobrescribir copias.
- `herramientas/verificar-restauracion-d1-local.sh`: verifica hash, descifra únicamente en directorio temporal privado, restaura SQL en SQLite local y comprueba `quick_check`, `integrity_check` y presencia de tablas. No existe conexión a Cloudflare en este script.
- `pruebas/respaldo-d1-seguro.test.js`: escenarios sintéticos con comandos ficticios; Python emplea SQLite real para validar exportación/importación. El simulador de age **NO cifra ni demuestra seguridad criptográfica**.

**Estas herramientas no hacen un respaldo de producción, no restauran una D1 remota y no transfieren a Drive.**

## Bloqueos de seguridad

1. `BACKUP_ACTIVE=SI` y `BACKUP_MODO=ENSAYO` deben darse **juntos**; por defecto se rechaza toda ejecución.
2. Se acepta únicamente `castano-respaldo-sintetico-AAAAMMDD`. Se exige el UUID de esta base y el UUID distinto de la D1 productiva; no están hardcodeados en el repositorio.
3. La configuración `wrangler.respaldo-ensayo.jsonc` debe ser un archivo **externo al repositorio, no symlink, con JSON estricto**, `name=castano-respaldo-ensayo` y exactamente un binding D1 `DB` con nombre y UUID coincidentes. Se rechazan `env`, `kv_namespaces`, `triggers`, `routes` y `assets`.
4. Las rutas de configuración y salida se revisan físicamente; la salida debe existir, pertenecer al usuario actual, tener permisos **700** y estar fuera del código. Los archivos temporales usan `umask 077`, se eliminan al salir y el destino final sólo recibe `.sql.age` y `.sha256`.
5. El cifrado y el manifiesto se publican con enlaces físicos sin sobrescribir; si un fallo deja cifrado sin manifiesto, **conservarlo sin tratarlo como válido** hasta revisión. Nunca borrar huérfanos automáticamente.
6. No hay PowerShell, instalación WSL, OAuth, rclone ni tareas programadas. La clave privada `age` existente en la Mac **no se genera ni se modifica**.

### Formato de la configuración aislada

Crear **fuera del repositorio** el archivo `wrangler.respaldo-ensayo.jsonc`, en un directorio privado, sólo después de contar con una D1 sintética **nueva y autorizada**. El contenido es JSON estándar (válido también como JSONC):

```json
{
  "name": "castano-respaldo-ensayo",
  "d1_databases": [{
    "binding": "DB",
    "database_name": "castano-respaldo-sintetico-AAAAMMDD",
    "database_id": "UUID-DE-ESA-D1-SINTETICA"
  }]
}
```

Los textos `AAAAMMDD` y `UUID-...` son ejemplos **no ejecutables**: deben sustituirse únicamente después de verificar la identidad de la base de ensayo y la cuenta con Cloudflare. No copiar el archivo productivo `wrangler.jsonc`. No guardar tokens, clave privada ni respaldos SQL en GitHub o chats.

Para un ensayo futuro, el ejecutor exigirá `BACKUP_TEST_DATABASE`, `BACKUP_TEST_DATABASE_ID`, `BACKUP_PRODUCTION_DATABASE_ID`, `BACKUP_TEST_CONFIG` (ruta absoluta), `BACKUP_DEST`, `AGE_RECIPIENT` (clave pública ya existente) y `CLOUDFLARE_API_TOKEN` temporal con alcance mínimo, además de `BACKUP_ACTIVE=SI` y `BACKUP_MODO=ENSAYO`.

## Procedimiento de validación futura — segunda D1 distinta

**Preparado, NO realizado.** Se necesita autorización específica para la infraestructura remota y los datos ficticios.

1. Comprobar cuenta, nombre y UUID actuales de la D1 productiva, y **no usarlos como fuente ni destino**. No reutilizar `castano-restore-sintetico-20261019` ni las D1 de Finanzas/CASTAGRAM/auditoría existentes.
2. Crear una D1 **fuente nueva** denominada `castano-respaldo-sintetico-AAAAMMDD`, aislada de Workers públicos y con pocos registros ficticios conocidos. Crear una **segunda D1 destino diferente** para la restauración, con nombre, UUID, estado inicial y permisos comprobados.
3. Con el permiso adecuado, ejecutar manualmente el exportador contra la **fuente sintética** usando únicamente la configuración privada autorizada. Cloudflare advierte que una exportación puede bloquear consultas durante el proceso; no ejecutar nunca contra producción sin otra autorización.
4. Verificar los archivos cifrados y manifiesto, luego descifrar en la **Mac custodia existente**, confirmar que `age` auténtico funciona y comprobar estructura, índices, filas, sumas, `quick_check` y `integrity_check`. Nunca almacenar la clave privada en el equipo exportador ni en Drive.
5. Tras **otra verificación inmediatamente anterior**, importar la SQL sintética mediante Wrangler a la **segunda D1 aislada** y comparar conteos, índices, integridad y datos ficticios. No ejecutar comandos remotos destructivos sobre D1 productiva.
6. Documentar resultados mínimos sin valores privados, revisar custodia, frecuencia, retención y alarmas; no activar Windows/WSL, programaciones ni rclone hasta autorización por separado. Una restauración D1 **no restaura** KV o Google Drive.

## Pruebas y límites

- Prueba local: `node --test pruebas/respaldo-d1-seguro.test.js` (Node 22 y Python 3).
- CI: `node --test pruebas/*.test.js` y dos compilaciones Wrangler `4.151.2 --dry-run` sin publicar.
- **Pendiente:** `age` real en la Mac, `sqlite3` auténtico por CLI en equipo custodio, Wrangler contra dos D1 nuevas de prueba, cifrado y descifrado reales, importación remota aislada, Drive privado y Windows/WSL.
- Un SHA-256 correcto prueba integridad del ciphertext existente, **no** disponibilidad de clave, recuperabilidad remota ni consistencia con KV/Drive.

Fuentes de operación consultadas:
- https://developers.cloudflare.com/workers/wrangler/commands/d1/
- https://developers.cloudflare.com/d1/best-practices/import-export-data/
- https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/export/

**Publicar código de documentación en `main` no concede autorización para exportar, restaurar, programar, crear D1 ni tocar claves o credenciales.**

## Ensayo D1 real de 20/10/2026 — verificación selectiva

**Autorización recibida:** crear dos D1 nuevas con registros exclusivamente ficticios y ensayar exportación y recuperación sin tocar producción. Se trabajó mediante la API D1 conectada con autorización de administración. No se utilizó la clave privada age ni token compartido por chat. Los UUID específicos se conservan en Cloudflare, no en este documento público.

### Recursos efectivamente creados

- **Fuente:** `castano-respaldo-sintetico-20261020`.
- **Destino independiente:** `castano-restauracion-sintetico-20261020`.
- Antes de cualquier escritura, se verificaron los nombres y UUID de ambas y su separación de `castano-facturas`. Ambas comenzaron sin tablas de ensayo; Cloudflare incluye su propia tabla interna `_cf_KV`.
- Se confirmó finalmente que el binding `DB` del Worker productivo continúa conectado **sólo a `castano-facturas`**, sin apuntar a la fuente ni al destino de ensayo. El Worker productivo permaneció en **versión 160**, despliegue `99ffa6cf-dcff-43f0-8c4e-bc746aa6ea09`, al 100 %.
- **No borrar automáticamente estas dos D1:** contienen únicamente fixtures sintéticas y quedan disponibles para una validación posterior. Toda destrucción requiere autorización específica.

### Datos y comprobaciones realizadas

Se cargaron exclusivamente en la fuente dos tablas de ensayo, `ensayo_turnos` y `ensayo_movimientos`, más el índice `idx_ensayo_mov_turno`. Dos turnos ficticios con fondos iniciales de 10 000 y 8 000 centavos, y seis movimientos con tipos de venta, retiro administrativo e ingreso administrativo:

| Métrica | Fuente | Destino |
| --- | ---: | ---: |
| Turnos | 2 | 2 |
| Movimientos | 6 | 6 |
| Índices explícitos de ensayo | 1 | 1 |
| Ventas (centavos) | 34 600 | 34 600 |
| Retiro administrativo (centavos) | 20 000 | 20 000 |
| Ingresos administrativos (centavos) | 7 500 | 7 500 |
| Saldo turno MAÑANA (centavos) | 22 000 | 22 000 |
| Saldo turno TARDE (centavos) | 18 100 | 18 100 |
| `PRAGMA quick_check` | `ok` | `ok` |
| `PRAGMA foreign_key_check` | Sin anomalías | Sin anomalías |

Las consultas compararon **independientemente en ambas D1** el SQL completo de las dos tablas y del índice, filas ordenadas, agregaciones de importes, cálculos de saldos e integridad rápida. Los resultados fueron iguales.

**Exportación D1:** se ejecutó `POST /d1/database/{source}/export` con `output_format=polling` y filtro a las dos tablas ficticias. La API devolvió estado **`complete`**, nombre de SQL y URL temporal de descarga. **No se descargó el archivo:** el entorno de herramientas rechazó el acceso a esa URL firmada, y no se copió ni registró la URL/credencial en el repositorio.

**Reconstrucción del destino:** se leyó de la fuente el esquema SQLite y las filas ficticias vía `POST .../query`, se reprodujeron en la **segunda D1** mediante 11 sentencias SQL (tablas, filas e índice) y se compararon de nuevo las dos bases. Las 11 sentencias y todas las comprobaciones posteriores finalizaron correctamente. **Esto demuestra una reconstrucción lógica consistente por API, no una importación real del archivo SQL exportado.**

**Limitación adicional:** Cloudflare rechazó `PRAGMA integrity_check` por `SQLITE_AUTH`; `quick_check` y `foreign_key_check` sí pudieron ejecutarse. `integrity_check` completo deberá hacerse sobre el SQLite exportado al descargarlo, no presentarse como realizado.

### Estado de certificación

- **Aprobado:** separación de dos D1 nuevas, fixtures ficticias, consulta/export API con estado completo, reconstrucción SQL por consultas, igualdad de tablas/índice/filas/totales/saldos, `quick_check` y claves foráneas.
- **NO certificado:** descarga de los bytes del SQL exportado, SHA-256 del fichero real, cifrado/descifrado con `age` auténtico, restauración desde ese fichero mediante el importador remoto oficial D1, cotejo de hashes del archivo y copia privada en Drive. No se han realizado esas operaciones.
- **Sin cambios:** D1 productiva, Worker, KV, Drive, Mac, Windows/WSL, claves privadas, credenciales y programaciones. No se generó ningún archivo para descargar al usuario.

**Próximo paso bloqueado por el entorno:** usar un ejecutor autorizado que pueda **descargar la exportación SQL y cargar exactamente sus bytes a la D1 de destino**; podrá ser una sesión controlada en la Mac custodia, sin regenerar su clave. Verificar de nuevo el destino antes de importar (actualmente **ya contiene fixtures**; para una importación completa habría que utilizar una **tercera D1 vacía expresamente autorizada**, o autorizar una limpieza específica del destino antes de reimportar). No sobreescribir ni limpiar automáticamente la base ya construida. Repetir `quick_check`, `integrity_check` local, conteos y hashes. No ejecutar en `castano-facturas` ni reutilizar D1 de Finanzas.
