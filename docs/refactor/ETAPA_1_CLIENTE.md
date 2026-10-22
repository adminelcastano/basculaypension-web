# Etapa 1 — Controladores de Agenda en preparación

Base `b9973b25`. Los controladores de Compras y Pagos fueron extraídos mediante fábrica con dependencias explícitas. Conservan los métodos y rutas actuales de Agenda, estado único de navegación, identidades UID y efectos administrativos; no tocan D1, KV ni flujos productivos.

## Elementos separados

- `07-compras-controlador.js`: lista, memoria visible, carrito, ticket y devolución.
- `07-pagos-controlador.js`: historial, formularios, comprobantes y reintentos.
- `07-agenda.js`: mantiene el estado compartido y puntos de integración públicos.
- `panel-app.js`: concatena controladores antes de Agenda para preservar alcance y orden.

## Límites

Las rutas financieras y validaciones de servidor no se han cambiado. CASTAGRAM, calendario, incidencias y Turno siguen en Agenda. Esto **no cierra Etapa 1**. Sigue pendiente probar navegación en navegadores reales y caracterizar todos los flujos, incluso los de error.

No fusionar ni publicar sin autorización independiente. Para revertir las extracciones, revertir los commits de la rama; no hay migraciones.
