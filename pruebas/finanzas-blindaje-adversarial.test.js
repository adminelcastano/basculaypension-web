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
  const uiAgenda=source("../src/panel/cliente/07-agenda.js");
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
  const ui=source("../src/panel/cliente/07-agenda.js");
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
  assert.match(ui,/if \(bt\.disabled\) return; bt\.disabled = true; fm\.querySelector/);
  assert.match(ui,/if \(b\.disabled\) return; b\.disabled = true; ft\.querySelector/);
  assert.match(ui,/if \(bt\.disabled\) return;\s*bt\.disabled = true;\s*try \{\s*const res = await post/);
  assert.match(ui,/res\.borrados \? "Movimiento eliminado" : "Movimiento ya eliminado"/);
  assert.match(ui,/res\.sin_cambios \? "El ticket ya tenía ese vínculo"/);
  assert.match(ui,/\/otra sesión\|cambió\/\.test\(e\.message\)/);
  assert.doesNotThrow(()=>new Function(ui));
});
test("Pago modal: evitar doble confirmación y recuperar el estado tras conflicto",()=>{
  const ui=source("../src/panel/cliente/07-agenda.js");
  assert.match(ui,/const b = f\.querySelector\("\[type=submit\]"\);\s*if \(b\.disabled\) return;\s*b\.disabled = true/);
  assert.match(ui,/c\.querySelectorAll\("\[data-borrar-pago\]"\)/);
  assert.match(ui,/if \(b\.disabled\) return;\s*const p = \(st\.pagosHechos/);
  assert.match(ui,/if \(b\.isConnected\) b\.disabled = false/);
  assert.match(ui,/\/otra sesión\|cambió\|ya no existe\/\.test\(e\.message\)/);
  assert.doesNotThrow(()=>new Function(ui));
});
