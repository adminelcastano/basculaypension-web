# Integración aislada — Fase 1 de archivos y Facturación

**Fecha:** 20 de octubre de 2026.
**Rama:** `integracion/fase1-archivos-facturacion-20261020`.
**Base:** `main@4613ec3112106ef56c0d1f808931828654e03833`, incluye la reparación de Facturación del PR #35.
**Fuente de Fase 1:** `d361e12d0bfbb42207dd8ffad13a908aa704c6cb`, sin fusionar la rama completa.

## Alcance exacto

- `src/fotos.js`: implementación preparada de versiones inmutables KV, índices D1, conservación de copias y lectura de archivos antiguos, copiada de la rama de auditoría.
- `src/worker.js`: se conservan íntegros correo obligatorio, análisis orientativo de fotografías, detección de formatos y lectura fiscal asistida del `main`; únicamente se adapta la subida del ticket y la constancia a `guardarArchivo`.
- `src/personal.js`: se adaptan exclusivamente las dos rutas de documentos que persistían directamente en KV.
- `src/turno.js` y `src/agenda.js`: se adaptan únicamente las cargas de fotos operativas al almacenamiento versionado.
- `pruebas/archivos-retencion-fallos.test.js`: se incorpora el contrato sintético preparado, **no ejecutado**.

## Exclusiones y límites

No se fusionó `deuda-tecnica/fases-1-4-20261019`; sus cambios de reportes, UI, respaldos y Apps Script quedan fuera de esta integración aislada. El Apps Script remoto **no se modificó**: la idempotencia de cargas en Drive depende de verificar su contrato y de una autorización posterior específica para actualizarlo.

**Esta rama no está probada, aprobada ni publicada.** Se efectuó únicamente inspección estática del código y de sus interfaces. La validación de fallos y concurrencia está reservada para la sesión conjunta; también faltan pruebas de KV/D1/Drive aislados, compatibilidad móvil y comprobaciones de Facturación. Las versiones en KV pueden no ser visibles de inmediato en otra región. D1, KV y Drive no participan de una transacción distribuida. No activar purgas de versiones sin una reconciliación segura.

**Operaciones no realizadas:** merge a `main`, despliegue Cloudflare, publicación Apps Script, cambios en D1/KV/Drive productivos, ejecución de pruebas reservadas, respaldo real o creación de recursos remotos.

## Revisión obligatoria antes de aprobar

1. Inspeccionar el diff contra `main` y preservar íntegramente las correcciones del PR #35.
2. Revisar simultaneidad de subidas, eliminación, reemplazo, propagación KV, casos sin puntero en D1 y recuperación de copias huérfanas.
3. Validar sintaxis y suites sintéticas de forma conjunta cuando se autorice, usando datos ficticios.
4. Verificar contrato y despliegue existente de Apps Script antes de activar idempotencia.
5. Ensayar la lectura y retención de tickets, constancias fiscales, documentos, fotos de tablet y CASTAGRAM con servicios aislados.
6. Solo después evaluar integración y publicación con autorización expresa.
