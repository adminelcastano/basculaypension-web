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
7. **Pendiente para cobertura integral:** retiros de sueldo integrados en `turno_cortes.retiros` y renglones de caja importados desde Sheets aún necesitan una referencia inmutable y una conciliación individual. No se enviarán silenciosamente a SALARIOS porque podrían duplicar movimientos o atribuirlos al colaborador equivocado.
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
