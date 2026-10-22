# BASCULAYPENSION WEB · Compatibilidad multiequipo del PR #46

**Rama/commit revisado:** `feat/caja-dinero-integral-20261021` · `c133ead59032c446e4e8f9bbacde128700857d5f`.
**Evidencia:** [GitHub Actions — Chromium/WebKit, 11 perfiles](https://github.com/adminelcastano/basculaypension-web/actions/runs/39704102436).

## Equipos y escenarios de navegación

| Plataforma representativa | Motor | Tamaño de prueba CSS | Resultado |
| --- | --- | ---: | --- |
| Windows escritorio | Chromium | 1440 × 900 | Aprobado |
| macOS escritorio (Safari equivalente) | WebKit | 1512 × 982 | Aprobado |
| iPad mini vertical | WebKit | 744 × 1133 | Aprobado |
| iPad mini horizontal | WebKit | 1133 × 744 | Aprobado |
| iPad 10.ª generación vertical | WebKit | 820 × 1180 | Aprobado |
| iPad 10.ª generación horizontal | WebKit | 1180 × 820 | Aprobado |
| iPhone 17 Pro Max (referencia) | WebKit | 440 × 956 | Aprobado |
| Z Fold7 cerrado, estrecho | Chromium | 360 × 848 | Aprobado |
| Z Fold7 desplegado | Chromium | 768 × 936 | Aprobado |
| Z Flip7 interior | Chromium | 412 × 915 | Aprobado |
| Z Flip7 cubierta compacta | Chromium | 400 × 420 | Aprobado |

Los tamaños son **ventanas representativas de CSS**, no una afirmación de que las dimensiones físicas o los controles del navegador de cada equipo sean exactamente esos. Se probaron versiones emuladas: no Safari físico ni Samsung Browser físico.

## Recorridos automatizados

- Se abre DINERO en el índice o en vista de escritorio según el ancho.
- Se entra a Bancos y luego a Cuentas por pagar y cobrar, se comprueba que «Volver» regrese al índice.
- El enlace externo directo `#dinero/bancos` se abre en una pestaña limpia, sin historial anterior.
- El formulario real de obligaciones carga y sus ocho controles visibles presentan alturas mínimas de 40 px en las resoluciones ensayadas.
- Se navega entre CAJA → Transferencias y AGENDA → Compras. En escritorio se activa el menú con teclado mediante Enter.
- Se comprueba que el menú de seis áreas cabe en su contenedor, que en pantallas hasta 820 px queda anclado abajo y que el documento no crece horizontalmente más allá de su ancho.
- Cero excepciones de JavaScript durante la matriz de navegación probada.

El servidor del ensayo de interfaz carga **el HTML, CSS y JS originales del repositorio**, interceptando todas las API con respuestas **sintéticas**. Esto evita usar Cloudflare Access o datos productivos, pero **no prueba los cálculos bancarios reales ni pagos de punta a punta en hardware físico**.

## Mejoras aplicadas tras hallazgos

1. **iPad mini e iPad 10 vertical:** barra de navegación inferior completa, sin último botón recortado. Se retiró el desenfoque de la cabecera en 641–820 px porque WebKit lo convertía en contenedor de posicionamiento para la barra fija.
2. **iPad horizontal 821–1200 px:** menú superior compacto, botones visibles, navegación por teclado y control de retorno al índice.
3. **Plegables cerrados y iPhone grande:** tarjetas, foco perceptible, áreas táctiles y tamaños adaptados; sin desbordamiento horizontal.
4. **Enlaces profundos:** no expulsan al usuario del panel al pulsar «Volver». Bancos y Obligaciones cargan aunque se entre directamente por URL.
5. **Movimiento:** transiciones discretas en hover para puntero preciso; se respetan las preferencias de movimiento reducido.

## Limitaciones y aceptación restante

La suite **no ejecutó navegación autenticada en Safari/iOS físico**, Samsung Internet, VoiceOver, TalkBack, cambio de tamaño de fuente del sistema, red lenta real ni el comportamiento del teclado físico/pantalla plegable real. Las capturas son de navegador emulado y muestran errores intencionales de API ficticia en módulos sin datos cargados: **no son fallos de la Preview protegida**. Se recomienda comprobación humana de los equipos reales antes de merge/productivo.

**Publicación:** Preview de ensayo aprobada por administración, con D1/KV aislados y Cloudflare Access. Sin autorización para fusionar PR #46 o desplegar producción.
