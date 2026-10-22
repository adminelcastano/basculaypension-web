# Integración de refactorización — ensayo previo a publicación

Punto de partida: `884d15c03af07f152daf172b35b863e055dfb193` (rama Etapa 1, descendiente de `main@b9973b25`). Otras etapas incorporadas como árboles verificados por SHA de los PR #48–54, sin fusionar esos PR ni modificar `main`.

Los PR individuales #47–54 son revisiones de alcance acotado, no publicaciones. Esta rama debe superar integralmente pruebas de Node, compilación Wrangler de producción **dry-run**, compilación Wrangler de Finanzas ensayo **dry-run** y navegación sintética Chromium/WebKit en 11 perfiles. No se conectará a D1/KV productivas ni escribirá en Google o SALARIOS.

**Ajuste de convivencia único:** `src/panel-app.js` combina el ensamblado de Compras/Pagos de #47 y el CSS Base+Navegación de #53. Se exige igualdad byte a byte del CSS con `main` mediante prueba.

**Alcance no concluido:** los cambios no completan todas las etapas 0–7. Faltan caracterizaciones HTTP/JSON en varios dominios, separación del resto de Agenda (CASTAGRAM, calendario/tareas), reducción adicional del núcleo CAJA/DINERO y Worker, Personal/Turno, componentes CSS y análisis de evolución D1. No inferir equivalencia de producción solo de pruebas sintéticas.

**PROHIBIDO fusionar o publicar sin autorización expresa e independiente.**
