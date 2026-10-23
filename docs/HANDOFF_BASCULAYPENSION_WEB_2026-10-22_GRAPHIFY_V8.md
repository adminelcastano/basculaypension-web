# Handoff — BASCULAYPENSION WEB, 22 de octubre de 2026

## Próxima sesión: punto de partida

**Repositorio:** https://github.com/adminelcastano/basculaypension-web  
**Producto publicado:** https://basculaypension.com  
**Versión de producción verificada antes de integrar Graphify:** `main@8b7437d388e1fabb453fdd4afdc4c045b7db2998`. Cloudflare Workers Builds terminó con `success` el 2026-10-22 a las 09:02:49 UTC; Worker en esa versión al 100 %. Preview Builds permanecen deshabilitadas.  
**Rama de trabajo Graphify:** `tool/graphify-v8-handoff-20261022` (NO publicar automáticamente).  
**Último CI en main:** GitHub Actions run `39752292158`, 518/518 Node aprobadas, 2/2 dry-run Wrangler. Su job UX fue omitido en evento push (solo aplica en PR); el PR de Panel Financiero sí tuvo run `39750584846` exitoso.

## Hecho hasta ahora

- **Refactorización del sitio** integrada en PR #55, commit `8fcbacddd0475134aeec6252af1247ecdf0c86de`. Conserva módulos, rutas y datos, separa lógica del Worker/Agenda/CASTAGRAM/Finanzas/Turno/Personal/Facturación.
- **Facturas reparadas en producción**: la lista fallaba con HTTP 500 por `DIAS_RETENCION` fuera del módulo extraído `src/worker-panel-rutas.js`. PR #71, commit `9455eff746b375f40b1816e722b49fc0d44b1813`, pasó 515/515. El usuario confirmó explícitamente «funciona».
- **Panel Financiero publicado**: PR #72, commit `8b7437d388e1fabb453fdd4afdc4c045b7db2998`, nueva URL `/panel/financiero` tras Access. Reutiliza Caja, Dinero, Compras, CSS/JS y API del panel administrativo; no crea otra D1 ni registros. Oculta visualmente Personal, Facturas, Configuración y Agenda no económica. **No es una separación de permisos por backend**: continúa autorizado mediante el mismo Access administrativo. No se debe ofrecer a usuarios con privilegios restringidos sin revisar endpoints y roles. Autorizaron su publicación el 2026-10-22 a las 08:59 UTC.
- **Graphify v8 aplicado como skill de proyecto** en esta rama: `.agents/skills/graphify/SKILL.md` y las ocho referencias oficiales, `AGENTS.md`, `.graphifyrc`, `.gitignore`, `docs/GRAPHIFY_V8_EN_ESTE_PROYECTO.md`; fuente Graphify-Labs `847a93f3cab5e2c82ea9170014b21cd2c52a4417`, CLI recomendado `graphifyy==0.9.93`. **No se ejecutó Graphify ni se generó graph.json en el entorno actual**, porque no existe CLI ni acceso de clonación de repositorio en la consola; se preparó instalación de proyecto para máquinas de desarrollo.

## Qué falta comprobar en el próximo chat

1. Leer este handoff y obtener **nuevos SHAs, PRs y CI** de GitHub; no asumir que estos siguen actuales. Confirmar estado de la rama de Graphify y su PR, si lo hay.
2. Revisar la instalación de la skill y su ajuste a Codex/Agent Skills; ejecutar un grafo **local** en un checkout legítimo, sin archivos sensibles ni conexión con producción; validar reportes y utilidad para preguntas de arquitectura.
3. Revisar el funcionamiento real autenticado de `/panel/financiero` en teléfono/tablet/ordenador: Caja, Dinero, Compras, pagos, balances, enlaces profundos y perfil; probar sin escritura innecesaria. La UX sintética del PR anterior fue verde, pero el acceso autenticado real necesita sesión del administrador.
4. Si se quiere que Panel Financiero tenga una **cuenta distinta de administración** o prohibición real de endpoints de Facturación/Personal, diseñar permisos del Worker por ruta y Cloudflare Access. Ocultar botones mediante CSS no es control de autorización.
5. No fusionar Graphify a `main` ni publicar nueva versión por esa integración salvo aprobación explícita para **estos cambios**. No tocar producción D1/KV, secretos, cron, trabajadores de Turno ni datos operativos.

## Reglas de continuidad

BASCULAYPENSION WEB es distinto de BASCULAYPENSION local, que usa SQLite: la web no debe escribir en esa base. El sistema web ya tiene Facturación, Personal, Caja, Finanzas, Cortes, Agenda y CASTAGRAM; nunca borrar módulos ni modificar la arquitectura solo por inferencia.

CASTAGRAM: destinatarios deciden quién ve contenido; notificaciones generales sin divulgar mensajes privados; diferenciar `Leído` de `Enterado`; conservar imágenes, autores, comentarios, archivo e historial; tablet compartida sin mezclar datos entre encargados. Mantener Access, PIN y límites de fotos y datos personales.

Para cada cambio, entregar **HECHO / ARCHIVOS / PRUEBAS / PUBLICACIÓN / SIGUIENTE**. Los archivos y pruebas deben revisarse en su commit real. No prometer tareas futuras sin ejecutor.

## Flujo recomendado en nueva conversación

«Continúa BASCULAYPENSION WEB desde `docs/HANDOFF_BASCULAYPENSION_WEB_2026-10-22_GRAPHIFY_V8.md`; consulta `main` y la rama `tool/graphify-v8-handoff-20261022`, revisa CI y aplica la skill Graphify v8 en un entorno local donde exista el CLI, sin datos productivos. Prioriza Panel Financiero y seguridad. No publiques ni toques datos sin autorización.»

### Referencias

- [GitHub principal](https://github.com/adminelcastano/basculaypension-web)
- [Graphify v8](https://github.com/Graphify-Labs/graphify/tree/847a93f3cab5e2c82ea9170014b21cd2c52a4417)
- [PR #55](https://github.com/adminelcastano/basculaypension-web/pull/55)
- [PR #71](https://github.com/adminelcastano/basculaypension-web/pull/71)
- [PR #72](https://github.com/adminelcastano/basculaypension-web/pull/72)
- [CI publicado](https://github.com/adminelcastano/basculaypension-web/actions/runs/39752292158)
