# Graphify v8 en BASCULAYPENSION WEB

**Origen y licencia:** [Graphify-Labs/graphify](https://github.com/Graphify-Labs/graphify/tree/v8), rama `v8`, commit `847a93f3cab5e2c82ea9170014b21cd2c52a4417`. El skill de proyecto es copia de la fuente oficial `graphify/skill.md` y de las ocho referencias de `graphify/skills/agents/references/`; se conservan LICENSE Apache-2.0 y NOTICE del upstream.

**Tipo de integración:** herramienta del agente de desarrollo, **no** módulo del sitio web. No cambia la aplicación, `wrangler.jsonc`, D1, KV, Cloudflare Access, secretos, publicaciones ni paquetes de Node. No es una conexión Graphify Cloud ni instala por sí misma el ejecutable Python. Permite a herramientas compatibles con Agent Skills (por ejemplo Codex) leer `.agents/skills/graphify/SKILL.md`.

## Puesta en marcha, solo en un equipo de desarrollo con copia del repositorio

1. Revisar que el directorio local no tenga archivos productivos privados, backups, `.env`, `.dev.vars` ni exportaciones D1/KV que vayan a indexarse. El repositorio publicado en GitHub contiene código; no traer datos privados.
2. Instalar el CLI oficial en entorno aislado: `uv tool install graphifyy==0.9.93` (alternativa: `pipx install graphifyy==0.9.93`). Requiere Python 3.10+. **No incorporar esta dependencia al Worker ni a `package.json`.**
3. En una herramienta de codificación compatible con Agent Skills, usar el skill `graphify` con el repositorio como entrada (en Codex, `$graphify .`; en clientes que admiten slash-skills, `/graphify .`). Si el agente no reconoce la skill versionada, la instalación upstream es `graphify install --project --platform agents`; revisar cambios antes de reemplazar el skill fijado.
4. Verificar salida local `graphify-out/graph.json`, `graphify-out/GRAPH_REPORT.md` y `graphify-out/graph.html`. **No confirmar ni publicar esa carpeta.**
5. Para mantenimiento incremental, seguir `graphify update .` y consultar `graphify query`, `graphify path`, `graphify explain` con el CLI instalado. Usar `GRAPH_REPORT.md` para orientación amplia.
6. Revisar dependencias reales en `src/worker.js`, `src/worker-panel-rutas.js`, `src/panel-app.js`, `src/panel-financiero.js`, `src/agenda*.js`, `src/caja*.js`, `src/finanzas*.js`, `src/avisos.js`, `src/turno*.js`, `src/facturas*.js` y tests. El grafo ayuda a explorar, pero no sustituye la comprobación de permisos y contratos.

## Límites de seguridad

- `graphify-out/` está en `.gitignore`, porque JSON/HTML pueden conservar nombres de rutas, estructuras y documentación sensible.
- El análisis AST de código de Graphify funciona localmente y sin API LLM. La extracción semántica de documentos, imágenes o PDFs puede recurrir al modelo del agente o a un proveedor externo **si se configura**; no incluir documentación con datos privados ni servicios de Graphify Cloud.
- En este entorno de ChatGPT se verificaron las instrucciones oficiales, pero **no se construyó un grafo real**: el ejecutable `graphify` no está instalado y la consola aislada no puede clonar repositorios desde internet. La skill quedó incorporada como archivos del proyecto para uso donde exista el CLI.
- Solo una sesión autenticada como administración puede consultar los endpoints privados. El Panel Financiero es una vista separada del **mismo backend**, no un rol de seguridad independiente.

## Preguntas útiles al continuar

- `graphify query "worker routes access auth factura"`: buscar dependencia entre Worker, Access, rutas de facturación y su lista.
- `graphify query "agenda pago compra caja finanzas"`: dependencias de conciliación y pagos.
- `graphify path "crearRutasPanel" "DIAS_RETENCION"`: verificar inyección de la constante tras el hotfix (los nombres reales de nodos deben comprobarse en el grafo).
- `graphify explain "transformarPanelFinanciero"`: mapa del segundo panel; confirmar contra código.

Los ejemplos de consulta son objetivos; **no son resultados obtenidos**. Graphify etiqueta relaciones `EXTRACTED`, `INFERRED` y `AMBIGUOUS`. No tratar inferencias como hechos.
