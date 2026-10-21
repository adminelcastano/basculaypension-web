// Inspección estática y sintáctica, NO sustituye prueba visual en celular real.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {readFileSync} from "node:fs";
const leer=path=>readFileSync(new URL(path,import.meta.url),"utf8");

test("Ambas pantallas nuevas contienen JavaScript válido y están ensambladas en el panel",()=>{
  const a=leer("../src/panel/cliente/05b-estados.js");
  const b=leer("../src/panel/cliente/05c-salarios.js");
  assert.doesNotThrow(()=>new vm.Script(a,{filename:"05b-estados.js"}));
  assert.doesNotThrow(()=>new vm.Script(b,{filename:"05c-salarios.js"}));
  const ensamblado=leer("../src/panel-app.js");
  assert.match(ensamblado,/import J05B from ".\/panel\/cliente\/05b-estados\.js"/);
  assert.match(ensamblado,/import J05C from ".\/panel\/cliente\/05c-salarios\.js"/);
  assert.match(ensamblado,/J05, J05B, J05C, J05E, J06/);
  assert.ok(ensamblado.includes('import J05E from "./panel/cliente/05e-obligaciones.js";'));
});
test("Captura bancaria expone fechas independientes del mes, campos de crédito y avisos",()=>{
  const ui=leer("../src/panel/cliente/05b-estados.js");
  for(const k of ["periodo_desde","periodo_hasta","fecha_corte","fecha_pago_limite",
    "saldo_inicial","saldo_final","cargos","abonos","comisiones","intereses","iva",
    "pago_minimo","pago_sin_intereses","version"]){
    if(k==="version")assert.match(ui,/r\.version/);
    else assert.ok(ui.includes(k),"falta campo "+k);
  }
  assert.match(ui,/Datos parciales/);
  assert.match(ui,/No se alteraron movimientos/);
  assert.match(ui,/f-est-credito/);
  assert.match(ui,/solo|incompleto|revisar/);
});
test("Sueldos de turnos sólo se muestran como candidatos: sin botón de confirmar pago",()=>{
  const ui=leer("../src/panel/cliente/05c-salarios.js");
  assert.match(ui,/c\.solo_revision|candidatos/);
  assert.match(ui,/NO se sincronizan con SALARIOS/);
  assert.match(ui,/Posible duplicado por fecha e importe/);
  assert.match(ui,/recargarPendiente/);
  assert.doesNotMatch(ui,/EC\.post\("caja\/gastos/);
});
test("Bloques financieros y modo móvil conservan espacio y controles accesibles",()=>{
  const page=leer("../src/panel/pagina.html");
  const css=leer("../src/panel/estilos.css");
  assert.match(page,/data-bloque="bancos"/);
  assert.match(page,/id="fb-estados"/);
  assert.match(page,/id="f-estados-contenido"/);
  assert.doesNotMatch(page.split('id="mod-finanzas"')[1].split('id="mod-agenda"')[0],/data-bloque="salarios"/);
  assert.ok(page.split('id="cfg-conexiones"')[1].split('id="cfg-sistema"')[0].includes('id="fb-salarios"'));
  assert.match(page,/id="f-salarios-contenido"/);
  assert.match(css,/@media\(max-width:540px\)/);
  assert.match(css,/#fb-estados \.cform/);
  assert.match(css,/#fb-salarios #f-salarios-sync/);
});
