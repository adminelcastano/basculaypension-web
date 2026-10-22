# Etapa 7 — Diagnóstico de inicialización D1 (sin migraciones)

Ref de trabajo: `b9973b25b18fbd69892eeb84bbfede9b5c57a14a`. Las diez fuentes revisadas contienen comprobaciones `CREATE TABLE IF NOT EXISTS`, `ALTER TABLE`, índices y una bandera global por módulo. La inspección detectó **40 instrucciones CREATE TABLE**, **24 CREATE INDEX** y **18 ALTER TABLE** en estas fuentes, y ninguna expresión `DROP TABLE` (cifras léxicas: no garantizan ejecución ni reflejan el esquema entero).

**Decisión de seguridad:** no sustituir ahora `asegurarEsquema...` por migraciones versionadas sin observar primero la compatibilidad del esquema D1 anterior y el comportamiento concurrente en un entorno aislado. Esas funciones públicas permanecen intactas. La futura estrategia necesita pruebas de creación limpia, conservación de filas, índices, triggers, idempotencia y carreras de escrituras; una reversión del código nunca basta para revertir una migración.

Se agrega inspección reproducible, sin credenciales, sin conexiones de red, y una prueba SQLite exclusivamente `:memory:` para compras. No cambia SQL del Worker ni tablas productivas. Etapa 7 **en evaluación**; no completada.
