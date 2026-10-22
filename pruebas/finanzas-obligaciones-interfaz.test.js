// Comprobaciones de interfaz de obligaciones, sin datos privados ni navegador productivo.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {readFileSync} from "node:fs";
const leer=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
test("La vista de obligaciones compila, está montada una sola vez y funciona en móvil",()=>{
 const ui=leer("src/panel/cliente/05e-obligaciones.js");
 const html=leer("src/panel/pagina.html");
 const css=leer("src/panel/estilos.css");
 const bundle=leer("src/panel-app.js");
 assert.doesNotThrow(()=>new vm.Script(ui,{filename:"05e-obligaciones.js"}));
 assert.equal((html.match(/id="fb-obligaciones"/g)||[]).length,1);
 assert.match(html,/data-bloque="obligaciones"/);
 assert.ok(bundle.includes("J05E"));
 assert.ok(css.includes("#fb-obligaciones"));
 assert.match(css,/@media\(max-width:540px\)/);
 for(const k of ["acreedor","concepto","total","vencimiento","emision","referencia","nota"])
  assert.ok(ui.includes('name="'+k+'"'),"Falta "+k);
});
test("Abonar una obligación utiliza el pago administrativo con UID y sin doble gasto",()=>{
 const agenda=leer("src/panel/cliente/07-pagos-controlador.js");
 const coordinador=leer("src/panel/cliente/07-agenda.js");
 assert.match(coordinador,/window\.agendaPagarObligacion/);
 const backend=leer("src/agenda.js");
 const pagos=leer("src/finanzas-obligaciones.js");
 assert.ok(agenda.includes('modo === "obligacion" ? { obligacion_id: it.id } : {}'));
 assert.ok(agenda.includes('post("agenda/pagos/hecho", cuerpo)'));
 assert.ok(backend.includes("stmtGastoAdmin(env, gid"));
 assert.ok(backend.includes("stmtVincularAbono(env,"));
 assert.ok(pagos.includes("OBLIGACION_SALDO_INSUFICIENTE"));
 assert.ok(pagos.includes("AFTER UPDATE OF importe ON agenda_pagos"));
 assert.ok(backend.includes("fin_obl_abonos SET activo=0"));
});
