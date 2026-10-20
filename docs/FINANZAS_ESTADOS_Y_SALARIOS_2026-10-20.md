# Finanzas — captura manual de estados de cuenta y reflejo SALARIOS

**Estado:** desarrollo aislado en PR #43, sin publicar ni modificar datos productivos. Código base: `main@3805749c14a8bbf083adfcdc024490b1dae0554e` (Worker 161). Fecha: 20/10/2026.

## 1. Estados de cuenta: cada banco lleva su calendario

El administrador abrirá **Dinero → Estados de cuenta** cuando tenga el PDF correspondiente; podrá capturar fechas reales de inicio y fin del periodo, fecha de corte, fecha límite de pago cuando aplique, saldo anterior, abonos, cargos, saldo al corte, desglose opcional de intereses/comisiones/IVA y nota privada.

- El **periodo bancario** puede cruzar dos meses y no se atribuye por defecto al mes del calendario operativo.
- El día de disponibilidad o de captura **no altera el periodo** del documento. La fecha de captura se registra por separado.
- Se admiten campos monetarios sin capturar: vacío es «desconocido», no cero. Cuando los cuatro totales están presentes, se muestra si **las cifras del propio estado cuadran**, y la diferencia si existe.
- Débito: `saldo_final = saldo_anterior + abonos - cargos`; crédito: `deuda_final = deuda_anterior + cargos - abonos`. **No confundir esta revisión interna con una conciliación completa contra todos los registros D1.**
- Los cargos **ya incluyen** cualquier IVA, intereses y comisiones del extracto; los desgloses se muestran como informativos y no se suman otra vez.
- Los estados guardados no crean cargos, gastos, traspasos ni ingresos. No actualizan `fin_saldos_cuenta`, `fin_movs`, `caja_gastos` ni los meses cerrados.
- Los cambios conservan historial por versión y autor, y se rechazan ediciones concurrentes o periodos superpuestos, también a nivel de SQLite.
- Coppel, Elektra y Banjercito: el administrador podrá **crear sus productos como cuentas de tipo Crédito desde Configuración**; no se inventarán saldos, datos de titulares ni fechas. Las cuentas ya existentes siguen intactas.

## 2. Hoja privada SALARIOS

La hoja administrativa SALARIOS consultada previamente contiene la pestaña `Hoja 1`, con identificadores, nombres, turnos y salario semanal de referencia. **No reemplazarla ni trasladar sus cifras individuales a GitHub.**

Se prepararon dos pestañas **que aún NO se han creado en el original**:

- `PAGOS WEB`: filas por movimiento existente de sueldo, con ID fuente idempotente, periodo/fecha, origen, concepto, importe, identificador del colaborador previamente validado y momento del reflejo.
- `RESUMEN SALARIAL`: vinculación por ID a la pestaña original, sueldo semanal de referencia, pagos reflejados del mes que el administrador elija y total histórico reflejado. **No interpreta el valor semanal como deuda acumulada ni deduce prestaciones, impuestos o pagos faltantes por inferencia.**

### Seguridad del puente

1. El Worker necesita `SALARIOS_SYNC_ACTIVE=SI` en su configuración privada y el proyecto Google Apps Script también `SALARIOS_SYNC_ACTIVE=SI` en Script Properties. Ambos están **ausentes/desactivados** actualmente; no se ha autorizado su activación.
2. El identificador del Sheet debe configurarse **solo** como `SALARIOS_SHEET_ID` en Script Properties. No se guarda en un archivo público, ni se copia la clave privada, OAuth o estados de cuenta a GitHub.
3. La pestaña de referencia se identifica como `Hoja 1`. Si cambia su nombre, el puente **se detiene** en lugar de adivinar.
4. Solo se ofrecen como candidatos automáticos los registros de `caja_gastos` con categoría **Sueldos** y referencia fuente estable. Se mantiene el gasto original: **ninguna acción genera otro egreso ni pago en la web**.
5. Administración selecciona el colaborador desde el catálogo real de SALARIOS. No se asigna por coincidencia del nombre, creador del gasto o encargado del turno.
6. Si un pago cambia de fecha, concepto o monto después de vincularlo, la sincronización se bloquea hasta nueva confirmación. Si un ID ya llegó a la hoja, un reintento con datos iguales no lo duplica; si el contenido cambió, Apps Script detiene el lote y solicita conciliación.
7. **Cobertura delimitada:** los retiros nuevos de `turno_cortes.retiros` cuentan con ID propio, y pueden vincularse a un colaborador tras revisión explícita. Los retiros antiguos sin identificador y los renglones de caja importados desde Sheets siguen sujetos a conciliación individual y **no se sincronizan** porque podrían duplicar pagos o atribuirlos al colaborador equivocado.
8. Al no estar activada la integración, el panel muestra la lista de pagos candidatos y que SALARIOS está suspendido. No crea pestañas ni ejecuta llamadas externas de nómina.
9. La actualización del proyecto Google Apps Script remoto tampoco ha sido realizada. El archivo `herramientas/aviso-correo.gs` en GitHub **no es** por sí mismo la versión desplegada.

## 3. Verificaciones antes de autorizar publicación y activación

- Suite `node --test pruebas/*.test.js` con ensayos sintéticos, incluyendo SQLite y periodos superpuestos.
- Builds Wrangler `4.151.2 --dry-run` del Worker principal y de Finanzas ensayo.
- Validar el resumen **sin escribir** registros reales, con colaboradores ficticios en un libro de prueba aislado y esquema compatible.
- Verificar comportamiento móvil/tablet para los formularios de estados y vinculación salarial.
- Para activar SALARIOS más adelante, confirmar permisos del ejecutor de Correo Panel sobre la hoja privada, realizar primero una prueba de un pago ficticio en un **Sheet aislado**, verificar reintentos y solo entonces considerar la conexión original. **No encender ambos interruptores ni modificar el Apps Script productivo sin autorización específica.**
- No hacer importación automática de PDFs bancarios, ni incorporar titulares, números de cuenta, CLABE o nombres de empleados al código público. Los estados del 6 en adelante son referencias para la captura manual, no una fecha de creación automática.

**Se mantienen separados** BASCULAYPENSION WEB (D1, Drive) y BASCULAYPENSION local (SQLite).

## Avance de validación aislada — continuación 20/10/2026

Se añadió una **prueba ejecutable del código real** de `salariosPrivados` (no una copia reescrita de su lógica), usando un libro de Google Sheets ficticio dentro de un simulador Node, sin acceso de red ni creación de archivos en Drive. `pruebas/salarios-appscript-aislado.test.js` verificó:

- Protección del doble interruptor: con Apps Script apagado no abre ningún libro.
- Lectura del catálogo de dos colaboradores **ficticios**, sin alterar la pestaña salarial base.
- Primera creación de `PAGOS WEB` y `RESUMEN SALARIAL`, fórmulas de sumas por mes y conservación del periodo elegido.
- Reintentos con el mismo ID: no duplican pagos ni sobrescriben filas previas; los cambios de importe, origen o colaborador se rechazan.
- Intentos de fórmula en concepto: se tratan como texto. Identificadores de colaborador desconocidos o importes inválidos: no escriben.

**Límite:** este es un ensayo simulado de Apps Script, **no** una ejecución de Apps Script desplegado contra un Google Sheet de prueba real. Tampoco crea pestañas en el documento original SALARIOS.

### Identificación sin sumar dos veces sueldos

La sección SALARIOS ahora también **lista exclusivamente para revisión**:

- Retiros de `turno_cortes.retiros` cuyo concepto menciona explícitamente sueldo, salario o nómina.
- Renglones tipo gasto de la hoja de caja con esos conceptos.
- Posibles duplicados cuando comparten fecha e importe con otro candidato o con un gasto ya registrado.

Los candidatos sólo se acumulan en SALARIOS después de revisión y vínculo explícito cuando tienen UUID individual. Los retiros históricos sin ID y la hoja importada siguen **sin vinculación automática**. Ninguna fuente se suma dos veces: se preserva el movimiento original y se detectan cambios o posibles duplicados sin usar posiciones de renglón como identidad.

Se reforzó el puente ya preparado para detectar **cambios de importe, fecha, concepto, categoría, origen, forma de pago o cuenta interna en cualquier pago previamente vinculado**, incluso si no figura entre los 400 pagos recientes del listado. `PAGOS WEB` conserva ahora columnas adicionales de forma de pago y código interno de cuenta, sin números bancarios completos. Un pago borrado o reclasificado se señala y detiene la sincronización, no se altera la hoja automáticamente.

### Revisión de UI y pruebas

Los nuevos scripts `05b-estados.js` y `05c-salarios.js` se validan sintácticamente con Node, junto con la presencia de campos de periodo bancario, campos de crédito, estados parciales y adaptación CSS para pantallas estrechas. Se corrigió la actualización de la lista tras confirmar un vínculo salarial; una recarga solicitada durante otra carga se atiende al terminar.

**Pruebas verificadas en el commit `7364d2135a9bc745bc0f59fd8ac186982795ca4d`: 426/426 aprobadas, 0 fallidas, ambas compilaciones Wrangler `--dry-run` correctas.** Se repetirá CI tras este último ajuste de documentación.

**Pendiente:** prueba con navegador/teléfono/tablet reales, ensayo de Apps Script desplegado contra Sheet *nuevo* y totalmente ficticio, conciliación de retiros antiguos sin identificador y autorización explícita antes de modificar código productivo y activar el puente SALARIOS.

## Identidad estable para retiros nuevos y vinculación salarial (20/10/2026)

Los retiros salariales capturados en **cortes nuevos de tablet** ya incorporan un UUID individual dentro del JSON `turno_cortes.retiros`. El formulario móvil preserva ese UUID al corregir el mismo retiro y `leerRetiros` lo conserva en las lecturas del panel. Los retiros históricos sin UUID se siguen mostrando normalmente y **nunca** reciben un ID por posición ni se reinterpretan automáticamente. Los folios de movimientos `MC-*` existentes no se modificaron.

La sección SALARIOS permite al administrador seleccionar un colaborador para un retiro nuevo identificado y confirmar explícitamente que recibió el pago. Si coincide con otro gasto o retiro del mismo día e importe, requiere además aclarar que se trata de un pago diferente. No se infiere el beneficiario desde el encargado del turno ni del autor de la captura.

Los vínculos de `fin_nomina_retiros` guardan el UUID, fecha, turno, concepto e importe original, el colaborador confirmado, fecha/responsable de revisión y estado de reflejo. Un retiro vinculado que se edite o se elimine del corte detiene la sincronización hasta conciliarlo. **Nunca se agrega un segundo gasto al sistema para reflejar el salario**.

El Apps Script preparado acepta únicamente dos orígenes respaldados por una referencia estable: `caja_gastos` y `turno_cortes`. Los retiros usan IDs `ret-<UUID>` para evitar colisiones con pagos administrativos; un reintento idéntico no genera dos renglones. Los renglones importados desde la hoja de caja sin identidad estable siguen como candidatos sólo informativos.

Se aclaró en «Sueldos del mes» que sus cifras son **registros operativos de salida**, no una confirmación del beneficiario del sueldo. La atribución correcta se valida en la sección privada SALARIOS.

En estados de cuenta se admite también saldo inicial/final negativo (sobregiro bancario o saldo a favor en crédito), sin permitir cargos, abonos o comisiones negativos. Esto conserva la conciliación exacta en centavos.

### Pruebas de esta etapa

- Los flujos de retiro nuevo, formulario móvil, ID persistido, coexistencia con retiros históricos sin ID, corrección del corte, vínculo a colaborador y sincronización idempotente se ensayaron mediante SQLite y un conector de Apps Script simulado sin red.
- Se ejecutó también la lógica real del archivo `herramientas/aviso-correo.gs` en un Google Sheet falso de pruebas, comprobando los dos orígenes, IDs repetidos, importes y cambios de fuente.
- El último commit funcional `653d7a0e224c9c017fba7ea34fc7fcf0bea712df` obtuvo **435/435 pruebas aprobadas**, 0 fallidas, y `dry-run` correcto del Worker principal y Finanzas ensayo en GitHub Actions 39499814959.
- **Aún falta un ensayo de Apps Script desplegado en un libro real pero completamente ficticio**, y pruebas visuales en móvil físico. No se autoriza considerar el puente real SALARIOS listo para activación por los ensayos simulados.

**Prohibiciones conservadas:** no fusiones ni publicaciones, cambios en SALARIOS original, creación de datos financieros productivos o conexión con BASCULAYPENSION SQLite local sin autorización específica.
