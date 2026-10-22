import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { idFinanciero, centavosIguales } from "../src/finanzas-idempotencia.js";
import { validarTicketRef } from "../src/caja.js";

const source = p => readFileSync(new URL(p, import.meta.url), "utf8");

test("Identificador financiero estable: actor y tipo aíslan reintentos", async () => {
  const uid="11111111-2222-4333-8444-555555555555";
  const pago=await idFinanciero("pago-suelto",uid,"administracion@example.com");
  assert.match(pago,/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
  assert.equal(await idFinanciero("pago-suelto",uid,"administracion@example.com"),pago);
  assert.notEqual(await idFinanciero("pago-suelto",uid,"otra@example.com"),pago);
  assert.notEqual(await idFinanciero("gasto-pago-suelto",uid,"administracion@example.com"),pago);
  assert.notEqual(await idFinanciero("pago-programado",uid,"administracion@example.com","item1"),await idFinanciero("pago-programado",uid,"administracion@example.com","item2"));
  await assert.rejects(idFinanciero("mov","BAD!","admin"),/inválido/);
  await assert.rejects(idFinanciero("mov",{},"admin"),/inválido/);
  assert.equal(centavosIguales(10.5,"10.50"),true);
  assert.equal(centavosIguales(10.5,10.51),false);
});

function fixtureTickets(tickets=[],ligado=null) {
  const queries=[];
  const env={DB:{prepare(sql){
    return {bind(...args){queries.push({sql,args});return {
      async all(){ if(!sql.includes("SELECT forma, importe FROM caja_mov"))throw Error("SQL inesperado "+sql);return {results:tickets}; },
      async first(){ if(!sql.includes("SELECT cliente FROM caja_transf"))throw Error("SQL inesperado "+sql);return ligado; }
    };}};
  }}};
  return {env,queries};
}

test("Conciliar transferencia solo con un ticket único e importe exacto",async()=>{
  const uno=fixtureTickets([{forma:"TRANSFERENCIA",importe:950}]);
  assert.deepEqual(await validarTicketRef(uno.env,"bascula:AB-100","2026-10",null,950),{ref:"bascula:AB-100"});
  assert.deepEqual(uno.queries[0].args,["2026-10","bascula","AB-100"]);
  const noCuadra=fixtureTickets([{forma:"TRANSFERENCIA",importe:950}]);
  const dif=await validarTicketRef(noCuadra.env,"bascula:AB-100","2026-10",null,900);
  assert.match(dif.error,/no coincide/);
  assert.equal(noCuadra.queries.length,1,"Rechaza el importe antes de intentar ligar");
  const otros=fixtureTickets([{forma:"EFECTIVO",importe:950}]);
  assert.match((await validarTicketRef(otros.env,"bascula:AB-100","2026-10",null,950)).error,/no está en la hoja/);
  const duplicados=fixtureTickets([{forma:"TRANSFERENCIA",importe:950},{forma:"EFECTIVO",importe:950}]);
  assert.match((await validarTicketRef(duplicados.env,"bascula:AB-100","2026-10",null,950)).error,/varios tickets/);
  const ajeno=fixtureTickets([{forma:"TRANSFERENCIA",importe:950}],{cliente:"Otra transferencia"});
  assert.match((await validarTicketRef(ajeno.env,"bascula:AB-100","2026-10",null,950)).error,/ya está ligado/);
  assert.equal(await validarTicketRef(uno.env,"","2026-10",null,950),null);
  assert.match((await validarTicketRef(uno.env,"bascula:AB-100","2026-10",null,NaN)).error,/importe válido/);
});

test("Escrituras financieras conservan uid y limitan duplicados en servidor",()=>{
  const cuentas=source("../src/cuentas.js");
  const caja=source("../src/caja.js");
  const agenda=source("../src/agenda.js");
  const uiFin=source("../src/panel/cliente/05-finanzas.js");
  const uiAgenda=source("../src/panel/cliente/07-pagos-controlador.js");
  for(const src of [cuentas,caja,agenda]) {
    assert.match(src,/idFinanciero\(/);
    assert.match(src,/repetid[oa]\(/);
    assert.match(src,/centavosIguales/);
  }
  assert.match(uiFin,/fm\.dataset\.uid \|\| \(fm\.dataset\.uid = crypto\.randomUUID\(\)\)/);
  assert.match(uiFin,/ft\.dataset\.uid \|\| \(ft\.dataset\.uid = crypto\.randomUUID\(\)\)/);
  assert.match(uiAgenda,/const uidPago = crypto\.randomUUID\(\)/);
  assert.match(agenda,/const previo = await repetido\(\); if \(previo\) return previo;/);
  assert.match(agenda,/const importeRetry = leerMonto\(c\.importe\)/);
});

test("Cuentas usadas o roles históricos impiden reinterpretación de saldos",()=>{
  const cuentas=source("../src/cuentas.js");
  assert.match(cuentas,/EXISTS\(SELECT 1 FROM fin_movs/);
  assert.match(cuentas,/EXISTS\(SELECT 1 FROM fin_saldos_cuenta/);
  assert.match(cuentas,/EXISTS\(SELECT 1 FROM caja_gastos/);
  assert.match(cuentas,/EXISTS\(SELECT 1 FROM agenda_pagos/);
  assert.match(cuentas,/EXISTS\(SELECT 1 FROM caja_transf/);
  assert.match(cuentas,/Cambiarla entre débito y crédito reinterpretaría meses anteriores/);
  assert.match(cuentas,/Cambiar su cuenta por defecto alteraría saldos anteriores/);
});

test("Caja del panel conserva identidad al reintentar y asienta la bitácora",()=>{
  const caja=source("../src/caja.js");
  const uiCaja=source("../src/panel/cliente/03-caja.js");
  for(const tipo of ["gasto-turno-admin","extra-turno-admin"])assert.match(caja,new RegExp("idFinanciero\\(\""+tipo+"\""));
  assert.match(caja,/que:"Gasto de caja"/);
  assert.match(caja,/que:"Ingreso extra de caja"/);
  assert.match(uiCaja,/f\.dataset\.uid \|\| \(f\.dataset\.uid = crypto\.randomUUID\(\)\)/);
  assert.doesNotMatch(uiCaja,/delete f\.dataset\.uid/); // no perder protección si falla recarga
  assert.doesNotThrow(()=>new Function(uiCaja));
});

test("Compra agrupada puede reintentarse sin duplicar ticket ni perder cuenta",()=>{
  const agenda=source("../src/agenda.js");
  const ui=source("../src/panel/cliente/07-compras-controlador.js");
  assert.match(source("../src/panel/cliente/07-agenda.js"),/window\.CastaComprasControlador\(\{/);
  const a=agenda.indexOf('if (partes[1] === "compras" && request.method');
  const b=agenda.indexOf("// Archivo de avisos:",a);
  assert.ok(a>0&&b>a);
  const bloque=agenda.slice(a,b);
  assert.match(bloque,/idFinanciero\("compra-ticket"/);
  assert.match(bloque,/const anterior = await repetido\(\); if \(anterior\) return anterior/);
  assert.match(bloque,/const ya = await repetido\(\); if \(ya\) return ya/);
  assert.equal((bloque.match(/await normalizarMedio\(env, c\)/g)||[]).length,1);
  assert.match(bloque,/gid = gidOperacion/);
  assert.match(ui,/uidCompra = f\.dataset\.uid \|\| \(f\.dataset\.uid = crypto\.randomUUID\(\)\)/);
  assert.match(ui,/uid: uidCompra/);
  assert.doesNotThrow(()=>new Function(ui));
});

test("Saldos parcialmente conocidos y sincronización no aparentan cifras completas",()=>{
  const finanzas=source("../src/finanzas.js");
  const ui=source("../src/panel/cliente/05-finanzas.js");
  assert.match(finanzas,/dinero_parcial: deb\.some/);
  assert.match(finanzas,/deuda_parcial: cred\.some/);
  assert.match(finanzas,/d\.ensayo_finanzas = env\.ENSAYO_FINANZAS === "1"/);
  assert.match(finanzas,/d\.sync = d\.ensayo_finanzas \? null : await env\.FILES\.get\("caja:sync"/);
  assert.match(ui,/Total parcial: faltan saldos/);
  assert.match(ui,/Última actualización registrada de ingresos/);
  assert.match(ui,/Puede haber consultas de la hoja sin cambios/);
  assert.match(ui,/ENSAYO: solo datos ficticios\. La hoja de ingresos está desconectada intencionalmente/);
  assert.match(ui,/const fuenteAlerta = !modoEnsayo/);
  assert.doesNotThrow(()=>new Function(ui));
});

test("Una compra agrupada no se presenta como si el gasto completo fuera un solo artículo",async()=>{
  const {clasificarAdmin}=await import("../src/finanzas.js");
  const gasto={id:"ticket-1",mes:"2026-10",dia:"2026-10-18",forma:"EFECTIVO",cuenta:null,
    concepto:"Compra en papelería: papel, plumones",monto:850,categoria:"Papelería"};
  const db = {
    prepare(sql) {
      return {
        bind() {
          return {
            async all() {
              if (sql.includes("FROM agenda_pagos")) return {results:[]};
              if (sql.includes("FROM agenda_items")) return {results:[
                {id:"a",gasto_id:"ticket-1",titulo:"Papel",cantidad:"2"},
                {id:"b",gasto_id:"ticket-1",titulo:"Plumones",cantidad:"1"}
              ]};
              throw Error("SQL no reconocida " + sql);
            }
          };
        }
      };
    }
  };
  const [fila]=await clasificarAdmin({DB:db},[gasto]);
  assert.equal(fila.cat,"compra");
  assert.equal(fila.monto,850);
  assert.equal(fila.concepto,gasto.concepto);
  assert.ok(!fila.concepto.startsWith("Plumones (1)"));
});

test("Si otro administrador corrigió el saldo, el panel recupera el dato confirmado",()=>{
  const cliente=source("../src/panel/cliente/05-finanzas.js");
  assert.match(cliente,/const res = await post\("finanzas\/saldo-cuenta"/);
  assert.match(cliente,/res\.sin_cambios \? "Saldo sin cambios"/);
  assert.match(cliente,/if \(\/otra sesión\/\.test\(e\.message\)\) await cargar\(\)/);
  assert.match(cliente,/if \(inp\.disabled\) return/);
  assert.doesNotThrow(()=>new Function(cliente));
});

test("Interfaz móvil: controles de cuentas revierten valores rechazados y bloquean reenvíos",()=>{
  const ui=source("../src/panel/cliente/05-finanzas.js");
  assert.match(ui,/x\.dataset\.confirmado = x\.value/);
  assert.match(ui,/control\.value = control\.dataset\.confirmado/);
  assert.match(ui,/if \(control\?\.disabled\) return false/);
  assert.match(ui,/const bt = fm\.querySelector\("\[type=submit\]"\);\s*if \(bt\.disabled\) return;\s*bt\.disabled = true/);
  assert.match(ui,/if \(b\.disabled\) return; b\.disabled = true; ft\.querySelector/);
  assert.match(ui,/if \(bt\.disabled\) return;\s*bt\.disabled = true;\s*try \{\s*if \(!\(await EC\.confirmar/);
  assert.match(ui,/res\.borrados \? "Movimiento eliminado" : "Movimiento ya eliminado"/);
  assert.match(ui,/res\.sin_cambios \? "El ticket ya tenía ese vínculo"/);
  assert.match(ui,/\/otra sesión\|cambió\/\.test\(e\.message\)/);
  assert.doesNotThrow(()=>new Function(ui));
});
test("Pago modal: evitar doble confirmación y recuperar el estado tras conflicto",()=>{
  const ui=source("../src/panel/cliente/07-agenda.js");
  const modal=source("../src/panel/cliente/07-pagos-controlador.js");
  assert.match(ui,/window\.CastaPagosControlador/);
  assert.match(modal,/const b = f\.querySelector\("\[type=submit\]"\);\s*if \(b\.disabled\) return;\s*b\.disabled = true/);
  assert.match(ui,/c\.querySelectorAll\("\[data-borrar-pago\]"\)/);
  assert.match(ui,/if \(b\.disabled\) return;\s*const p = \(st\.pagosHechos/);
  assert.match(ui,/if \(b\.isConnected\) b\.disabled = false/);
  assert.match(ui,/\/otra sesión\|cambió\|ya no existe\/\.test\(e\.message\)/);
  assert.doesNotThrow(()=>new Function(ui));
  assert.doesNotThrow(()=>new Function(modal));
});

test("El campo móvil conserva saldo original para rechazar formularios obsoletos",()=>{
 const ui=source("../src/panel/cliente/05-finanzas.js");
 const servidor=source("../src/cuentas.js");
 assert.match(ui,/data-original="\$\{c\.capturado \? esc\(c\.inicial\)/);
 assert.match(ui,/esperado: inp\.dataset\.original === "" \? null : inp\.dataset\.original/);
 assert.match(servidor,/Object\.hasOwn\(c, "esperado"\)/);
 assert.match(servidor,/El saldo cambió en otra sesión/);
 assert.doesNotThrow(()=>new Function(ui));
});

test("Eliminar en móvil exige confirmación visible, no una doble pulsación invisible",()=>{
 const ui=source("../src/panel/cliente/05-finanzas.js");
 assert.match(ui,/EC\.confirmar\(\s*"¿Eliminar este movimiento\?"/);
 assert.match(ui,/EC\.confirmar\(\s*"¿Eliminar transferencia\?"/);
 assert.doesNotMatch(ui,/classList\.contains\("armed"\)/);
 assert.doesNotMatch(ui,/Eliminar movimiento \(toca dos veces\)/);
 assert.match(ui,/if \(bt\.disabled\) return/);
 assert.match(ui,/if \(b\.disabled\) return/);
 assert.doesNotThrow(()=>new Function(ui));
});

test("Finanzas móvil: cifras monetarias sin redondear al peso en tarjetas de resumen",()=>{
 const ui=source("../src/panel/cliente/05-finanzas.js");
 assert.match(ui,/const D0 = v => EC\.dinero\(v, Math\.round\(Math\.abs\(Number\(v\) \|\| 0\) \* 100\) % 100 \? 2 : 0\)/);
 assert.match(ui,/EC\.bloqueInfo\("finanzas", "resumen", \{ valor: disponible == null \? null : D0/);
 assert.match(ui,/EC\.bloqueInfo\("finanzas", "bancos", \{ valor: b\.dinero != null && !b\.dinero_parcial \? D0/);
 const n=v=>Math.round(Math.abs(Number(v)||0)*100)%100?2:0;
 assert.equal(n(8064.50),2);
 assert.equal(n(564.50),2);
 assert.equal(n(850),0);
 assert.equal(n(-275.25),2);
 assert.doesNotThrow(()=>new Function(ui));
});

test("Transferencias móvil: ayuda accesible expandible y eliminación con etiqueta visible",()=>{
 const ui=source("../src/panel/cliente/05-finanzas.js");
 const css=source("../src/panel/estilos.css");
 assert.match(ui,/<details class="ftransf-ayuda">/);
 assert.match(ui,/<summary>¿Cuándo vincular un ticket\?<\/summary>/);
 assert.match(ui,/class="ftransf-ayuda-texto"/);
 assert.doesNotMatch(ui,/<p class="note" style="margin:4px 0 10px">Los tickets que en la hoja/);
 assert.match(ui,/class="alist ftransf-lista"/);
 assert.match(ui,/class="del ftransf-eliminar"[^\n]*data-tdel/);
 assert.match(ui,/<span>Eliminar<\/span><\/button>/);
 assert.match(css,/\.ftransf-lista \.ftransf-eliminar/);
 assert.match(css,/min-height: 44px/);
 assert.match(css,/\.ftransf-ayuda summary:focus-visible/);
 assert.doesNotThrow(()=>new Function(ui));
});

test("Saldos del celular: advertencias legibles y sin botón flotante sobre importes",()=>{
  const ui=source("../src/panel/cliente/05-finanzas.js");
  const nav=source("../src/panel/cliente/08-navegacion.js");
  const css=source("../src/panel/estilos.css");
  const sub=source("../src/panel/cliente/12-submenu.js");
  assert.match(ui,/<details class="f-guia-saldos">/);
  assert.match(ui,/<summary>Cómo se calculan los saldos y las deudas<\/summary>/);
  assert.match(ui,/<p class="note" data-nl="1">Débito/);
  assert.match(ui,/class="f-aviso-saldos" role="status"/);
  assert.match(ui,/Faltan saldos iniciales de/);
  assert.match(ui,/<summary>Ver cuáles faltan/);
  assert.match(ui,/b\.faltan_saldo\.map\(nombre => `<li>\$\{esc\(nombre\)\}<\/li>`\)/);
  assert.doesNotMatch(ui,/Sin saldo de partida: \$\{esc\(b\.faltan_saldo\.join/);
  assert.match(sub,/p\.note:not\(\[data-nl\]\)/);
  assert.match(nav,/const finanzasPequeno = matchMedia\("\(max-width: 820px\)"\)\.matches/);
  assert.match(nav,/!document\.getElementById\("mod-finanzas"\)\?\.hidden/);
  assert.match(nav,/!finanzasPequeno && !!fuente/);
  assert.match(css,/\.f-guia-saldos > summary/);
  assert.match(css,/\.f-aviso-saldos summary/);
  assert.match(css,/min-height: 44px/);
  assert.doesNotThrow(()=>new Function(ui));
  assert.doesNotThrow(()=>new Function(nav));
});

test("Movimiento bancario en celular exige cuentas seleccionadas y confirma origen, destino e importe",()=>{
  const ui = source("../src/panel/cliente/05-finanzas.js");
  assert.match(ui,/<option value="">Selecciona una cuenta<\/option>/);
  assert.doesNotMatch(ui,/fm\.origen\.innerHTML = opc\([^\n]+, t === "traspaso" \? mp/);
  assert.doesNotMatch(ui,/fm\.destino\.innerHTML = opc\([^\n]+, t === "traspaso" \? pyme/);
  assert.match(ui,/if \(!origen \|\| !destino \|\| origen === destino\)/);
  assert.match(ui,/máximo dos decimales/);
  assert.match(ui,/const detalle = `\$\{D\(Number\(importe\)\)\} · \$\{nombre\(origen\)\} → \$\{nombre\(destino\)\}/);
  assert.match(ui,/await EC\.confirmar\(titulo, detalle, yaExiste \? "Registrar otro" : "Registrar"\)/);
  assert.match(ui,/if \(bt\.isConnected\) bt\.disabled = false/);
  assert.doesNotThrow(()=>new Function(ui));
});

test("Capturas de celular: pagos sin redondear y papelera de movimientos con texto",()=>{
  const agenda=source("../src/panel/cliente/07-agenda.js");
  const fin=source("../src/panel/cliente/05-finanzas.js");
  const css=source("../src/panel/estilos.css");
  assert.match(agenda,/const D0 = v => EC\.dinero\(v, Math\.round\(Math\.abs\(Number\(v\) \|\| 0\) \* 100\) % 100 \? 2 : 0\)/);
  assert.match(agenda,/bloqueInfo\("finanzas", "movimientos", \{ valor: D0\(hechos\.reduce/);
  assert.match(agenda,/bloqueInfo\("finanzas", "movimientos".+D0\(porPagar\)/);
  const decimales=v=>Math.round(Math.abs(Number(v)||0)*100)%100?2:0;
  assert.equal(decimales(285.50),2,"Un pago de 285.50 no puede mostrarse como 286");
  assert.equal(decimales(850),0);
  assert.equal(decimales(0.01),2);
  assert.equal(decimales(564.50),2);
  assert.match(fin,/bloqueInfo\("finanzas", "bancos", \{ valor: b\.dinero != null && !b\.dinero_parcial/);
  assert.match(fin,/sobres sin saldo/);
  assert.match(fin,/class="alist fmov-lista"/);
  assert.match(fin,/class="del fmov-eliminar"[^\n]*data-mdel/);
  assert.match(fin,/<span>Eliminar<\/span><\/button>/);
  assert.match(css,/\.fmov-lista \.fmov-eliminar/);
  assert.match(css,/min-height: 44px/);
  assert.doesNotThrow(()=>new Function(agenda));
  assert.doesNotThrow(()=>new Function(fin));
});

test("Tarjeta móvil de transferencias no afirma Al corriente sin consultar Google",()=>{
  const ui=source("../src/panel/cliente/05-finanzas.js");
  const expression=ui.match(/const estadoTransferencias = ([\s\S]*?);\s*EC\.bloqueN\("caja", "transferencias"/)?.[1];
  assert.ok(expression,"La tarjeta debe tener una política explícita de estado");
  const estado=new Function("modoEnsayo","fuenteAlerta","pendientesConciliacion","hojaSinLigar","j","return "+expression+";");
  const sinTickets={transf_hoja:[]};
  assert.equal(estado(true,false,0,[],sinTickets),"Ensayo · hoja desconectada");
  assert.equal(estado(false,true,0,[],sinTickets),"Hoja sin sincronización verificada");
  assert.match(estado(false,false,2,[],sinTickets),/2 conciliaciones por revisar/);
  assert.match(estado(false,false,0,[{ref:"bascula:01"}],sinTickets),/1 tickets por ligar/);
  assert.equal(estado(false,false,0,[],sinTickets),"Sin tickets de transferencia en la hoja");
  assert.equal(estado(false,false,0,[],{transf_hoja:[{ref:"bascula:01"}]}),"Sin tickets pendientes de vincular");
  assert.match(ui,/pendientesConciliacion > 0 \|\| fuenteAlerta \|\| hojaSinLigar\.length > 0/);
  assert.doesNotMatch(ui,/texto: hojaSinLigar\.length \? hojaSinLigar\.length \+ " por ligar" : "Al corriente"/);
  assert.doesNotThrow(()=>new Function(ui));
});

test("Notificación blanca: texto centrado en móvil sin cubrir la navegación",()=>{
  const css=source("../src/panel/estilos.css");
  const page=source("../src/panel/pagina.html");
  const base=source("../src/panel/cliente/00-base.js");
  const bloque=css.match(/(?:^|\n)\.toast\s*\{([^}]*)\}/)?.[1];
  assert.ok(bloque,"La notificación debe tener estilo propio");
  for(const declaracion of [
    /display:\s*flex\s*;/,
    /align-items:\s*center\s*;/,
    /justify-content:\s*center\s*;/,
    /text-align:\s*center\s*;/,
    /max-width:\s*calc\(100vw\s*-\s*32px\)\s*;/,
    /white-space:\s*normal\s*;/,
    /overflow-wrap:\s*anywhere\s*;/
  ]) assert.match(bloque,declaracion);
  assert.match(css,/\.toast \{ bottom: calc\(84px \+ env\(safe-area-inset-bottom, 0px\)\); \}/);
  assert.match(page,/class="toast" id="toast" role="status" aria-live="polite"/);
  assert.match(base,/t\.textContent = msg/);
});


test("Finanzas avisa si el usuario intenta registrar dos veces el mismo movimiento",()=>{
  const ui=source("../src/panel/cliente/05-finanzas.js");
  const expr=ui.match(/const mismoMovimiento = \(a, b\) => ([\s\S]*?);/)?.[1];
  assert.ok(expr,"Comparador puro de movimientos requerido");
  const coinciden=new Function("a","b","return "+expr);
  const base={tipo:"traspaso",origen:"bbva-pyme",destino:"mdo-pago",fecha:"2026-10-18",importe:1.23};
  assert.equal(coinciden(base,{...base,importe:"1.23"}),true);
  assert.equal(coinciden(base,{...base,importe:1.24}),false);
  assert.equal(coinciden(base,{...base,origen:"mdo-pago",destino:"bbva-pyme"}),false);
  assert.equal(coinciden(base,{...base,fecha:"2026-10-19"}),false);
  assert.equal(coinciden(base,{...base,tipo:"retiro"}),false);
  assert.match(ui,/const yaExiste = \(st\.datos\?\.banco\?\.movs \|\| \[\]\)\.some/);
  assert.match(ui,/¿Registrar otro movimiento idéntico\?/);
  assert.match(ui,/Registrar otro volverá a modificar ambos saldos/);
  assert.doesNotThrow(()=>new Function(ui));
});

test("Efectivo en sobres muestra ayuda desplegable, nunca una nota truncada",()=>{
  const ui=source("../src/panel/cliente/05-finanzas.js");
  const css=source("../src/panel/estilos.css");
  assert.match(ui,/efectivo: \(\) => `[\s\S]*?<details class="f-guia-saldos">/);
  assert.match(ui,/<summary>¿Qué entra y sale de los sobres\?<\/summary>/);
  assert.match(ui,/Captura el saldo inicial solo después de contar los sobres/);
  assert.doesNotMatch(ui,/<p class="note" style="margin:4px 0 10px">Entra lo que/);
  assert.match(css,/\.f-guia-saldos > summary/);
  assert.doesNotThrow(()=>new Function(ui));
});

test("Dinero: ayudas de pagos hechas desplegables sin frases recortadas en móvil",()=>{
  const ui=source("../src/panel/cliente/07-agenda.js");
  const css=source("../src/panel/estilos.css");
  assert.match(ui,/<summary>¿Qué pagos se registran aquí\?<\/summary>/);
  assert.match(ui,/<summary>¿De dónde salen estos pagos\?<\/summary>/);
  assert.match(ui,/<p class="note" data-nl="1">Registra gastos ya realizados/);
  assert.match(ui,/<p class="note" data-nl="1">Los pagos programados son previsiones aproximadas/);
  assert.doesNotMatch(ui,/<p class="note" style="margin:10px 0 0">Para lo que ya pagaste/);
  assert.match(css,/\.f-guia-saldos > summary/);
  assert.doesNotThrow(()=>new Function(ui));
});

test("Dinero: diferencias, sueldos y reportes mantienen ayudas completas en móvil",()=>{
  const ui=source("../src/panel/cliente/05-finanzas.js");
  const css=source("../src/panel/estilos.css");
  for(const titulo of [
    "¿Cómo se calculan las diferencias de caja?",
    "¿Qué incluyen los sueldos del mes?",
    "¿Qué contienen los reportes mensuales?"
  ]) assert.ok(ui.includes("<summary>"+titulo+"</summary>"),titulo);
  assert.match(ui,/data-nl="1"[^>]*>Aquí puedes consultar quién registró/);
  assert.match(ui,/data-nl="1"[^>]*>Una cuenta puede cumplir los tres usos/);
  assert.match(css,/\.f-guia-saldos > summary/);
  assert.doesNotThrow(()=>new Function(ui));
});

test("Notas de cuentas: mensaje inequívoco si ya se guardaron y conflicto visible por pestaña",()=>{
  const ui=source("../src/panel/cliente/05-finanzas.js");
  const api=source("../src/finanzas.js");
  assert.match(ui,/esperado:\s*cu\.dataset\.original/);
  assert.match(ui,/res\.sin_cambios \? "Estas notas ya estaban guardadas" : "Notas guardadas"/);
  assert.match(ui,/cu\.querySelector\("\.err"\)\.textContent = e\.message/);
  assert.match(api,/if \(esperado !== actual\)/);
  assert.match(api,/Las notas de las cuentas cambiaron en otra sesión/);
  assert.doesNotThrow(()=>new Function(ui));
});
