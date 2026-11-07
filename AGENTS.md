# BASCULAYPENSION WEB — El Castaño

El repositorio web es distinto del sistema local BASCULAYPENSION. Mantener arquitectura de Cloudflare Workers, D1 y KV; no cambiar tablas, flujos ni datos por inferencia. No publicar, borrar datos productivos ni cambiar Cloudflare Access sin autorización. Conservar la distinción CASTAGRAM Leído/Enterado y la privacidad por destinatarios.

## Graphify v8, skill de proyecto

Skill oficial de Graphify v8, fijada en `.agents/skills/graphify/SKILL.md` con sus referencias. Fuente: Graphify-Labs/graphify, commit `847a93f3cab5e2c82ea9170014b21cd2c52a4417` (Apache-2.0; LICENSE y NOTICE incluidos); motor CLI Python `graphifyy==0.9.93` no es una dependencia del Worker.

- Cuando exista `graphify-out/graph.json` y el CLI esté disponible, iniciar la exploración de relaciones con consultas acotadas `graphify query`, `graphify path` o `graphify explain`. Después confirmar las conclusiones en los archivos reales y pruebas.
- Si no existe grafo o CLI, usar directamente GitHub/repositorio; NO afirmar que Graphify se ejecutó ni inferir relaciones de un grafo inexistente.
- Tras cambiar código, actualizar el grafo local con `graphify update .` SOLO cuando ya esté construido y haya CLI. No añadir `graphify-out/` al repositorio.
- No subir documentos, gráficos o fragmentos de datos sensibles a Graphify Cloud o a proveedores de IA. Revisar el corpus local antes de análisis semántico; si hay dudas, preferir lectura del código y AST local sin documentos privados.
- Grafo = orientación, no prueba de corrección; verificar seguridad, datos, SQL, rutas y pruebas en fuentes reales. Excepciones de la skill nunca reemplazan los permisos de producción.

Consultar `docs/GRAPHIFY_V8_EN_ESTE_PROYECTO.md` y el handoff vigente de `docs/` antes de cambios sustanciales.
