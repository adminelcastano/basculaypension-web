# PR #46 · Respaldo, reversión y seguridad antes de autorizar
Fecha: 21 de octubre de 2026 (zona México) / 22 de octubre UTC.

## Alcance autorizado
La administración autorizó **solo** estas tres acciones previas:
1. Respaldo D1 y prueba de recuperación en D1 independiente.
2. Plan de regreso al Worker actual sin tocar datos de D1.
3. Validación de Cloudflare Access, claves de integración y bindings.

**Excluido por instrucción expresa:** el punto 4 de comprobación operacional pospublicación. **No hay permiso para fusionar el PR, publicar producción, restaurar la base real o modificar sus datos.**

## 1 · Respaldo D1 — preparado, pendiente de completar
- D1 origen: `castano-facturas` (`665db15f-b688-4d34-9632-a264a8fe9637`).
- Time Travel: bookmark disponible por lectura. **No constituye prueba de restauración** y restablecer el bookmark en producción podría eliminar datos posteriores.
- Una copia anterior del 17/10/2026 tiene tamaño y esquema distintos; **no se utiliza como evidencia suficiente** para esta versión.
- Conexión Cloudflare: genera exportación consistente de D1, pero la descarga de su URL firmada se bloquea por la restricción de acceso al dominio temporal de almacenamiento R2.
- Preparado un script auditable: `scripts/seguridad/respaldo-d1-pr46.mjs`, y workflow `.github/workflows/d1-respaldo-verificable-pr46.yml`, ejecución inicial https://github.com/adminelcastano/basculaypension-web/actions/runs/39711151511.
- La primera ejecución terminó con **HTTP 401 en verificación GET de D1** usando el token de Workers; **no se exportó contenido en ese runner ni se creó la D1 destino**.
- Para completar: crear **otro API Token** en Cloudflare con permisos de cuenta **D1 Read y D1 Edit**, limitado a esta cuenta y de duración breve; colocarlo solo como secreto GitHub Actions `CLOUDFLARE_D1_BACKUP_TOKEN`. No dar permisos adicionales de DNS o Access.
- Luego reejecutar el workflow fallido. Este descarga la exportación en memoria de GitHub Actions, crea una D1 nueva identificable por el ID de ejecución, importa el SQL dentro de Cloudflare, valida `PRAGMA quick_check` y compara cantidad de tablas (metadatos), sin imprimir registros ni guardar archivo en artefactos.
- El respaldo solo se dará por **verificado** cuando el workflow concluya correctamente y se haya anotado el UUID de la D1 recuperada. La copia debe mantenerse desvinculada de cualquier Worker. No se eliminará automáticamente.
- **Precaución de datos**: esta copia contendrá información real de la empresa. Se conserva bajo la seguridad de la cuenta Cloudflare, no se comparte por enlaces públicos.

## 2 · Reversión del Worker — preparada, no ejecutada
- Worker de producción: `basculaypension-web`.
- Versión estable actual: `8083307f-9ebd-4120-a824-8d97b78077a9`, 100 % del tráfico.
- Deployment base: `a8ab7752-61ac-4a1f-a7b5-b7167546a3c2`.
- Confirmado por API que esa versión está en el conjunto de versiones **deployable** (historial de hasta 100 versiones).
- Procedimiento para incidente, **solo tras autorización para revertir**: en Cloudflare Dashboard → Workers & Pages → `basculaypension-web` → Deployments / Versions → seleccionar versión `8083307f-9ebd-4120-a824-8d97b78077a9` → Rollback. Alternativa operativa con Wrangler, **no ejecutada**:
  `npx wrangler rollback 8083307f-9ebd-4120-a824-8d97b78077a9 --name basculaypension-web --message "Reversión controlada PR46"`
- Rollback de Worker **no revierte D1/KV**: las nuevas tablas de PR46 son aditivas. Restaurar D1 de forma destructiva requiere un plan y aprobación específicos, por riesgo de borrar operaciones más recientes.

## 3 · Seguridad y privacidad — comprobada por lectura
- App Access panel: `basculaypension.com/panel`, política de permiso identificada como «Solo administración», sin regla «everyone».
- La política Access contiene reglas de email para administrador y turno, que permiten iniciar sesión; **la validación del Worker separa `ADMIN_EMAILS` para `/panel` de `TURNO_EMAILS` para `/turno`**. No se modificó la política porque podría interrumpir tablets compartidas.
- `ADMIN_EMAILS` tiene una cuenta; `TURNO_EMAILS` tiene una cuenta. Audiencia Access verificada respecto de configuración y aplicación.
- D1 Worker `DB`: `665db15f-b688-4d34-9632-a264a8fe9637`.
- KV Worker `FILES`: `3eac28ac69aa4756bc1762072bfb0d05`.
- `SALARIOS_SYNC_ACTIVE=NO`; secretos `CF_API_TOKEN`, `INGRESOS_TOKEN`, `AVISO_TOKEN`, `AVISO_URL` presentes como bindings secretos (no se han consultado sus valores).
- La lectura de crons confirmó 3 horarios existentes; no se activó ningún cron ni sincronización nuevos.
- La Preview PR46 sigue en D1 y KV separadas con Access privado. La producción no se desplegó.

## Puerta administrativa
**Puntos 2 y 3: verificados. Punto 1: pendiente de reejecución con token D1 y recuperación real.**
No afirmar que el respaldo está verificado antes del resultado positivo. No publicar producción ni fusionar PR46 sin autorización posterior e independiente.
