import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {readFileSync} from "node:fs";

const codigo=readFileSync(new URL("../src/panel/cliente/05d-estados-pdf.js",import.meta.url),"utf8");
function lector() {
  const EC={};
  vm.runInNewContext(codigo,{EC,Date,Number,String,RegExp,console,Uint8Array,Error}, {timeout:3000});
  return EC;
}
function validarCampos(r,{banco,desde,hasta}){
  assert.equal(r.institucion,banco);
  assert.equal(r.campos.periodo_desde,desde);
  assert.equal(r.campos.periodo_hasta,hasta);
  assert.equal(r.campos.fecha_corte,hasta);
  assert.equal(r.fiable,true);
}
test("BBVA PYME: saldo anterior, depósitos, retiros y saldo final sin inventar comisiones",()=>{
 const r=lector().analizarEstadoTexto(
  "MAESTRA PYME BBVA MN\nPERIODO 01/09/2026 AL 30/09/2026\nFECHA DE CORTE 30/09/2026\nCOMPORTAMIENTO\n"+
  "SALDO ANTERIOR 25.00\nDEPOSITOS/ABONOS(+) 7 1,125.75\nRETIROS/CARGOS (-) 4 950.50\n"+
  "SALDO FINAL 200.25\nCOMISIONES 3.50-\nDETALLE DE MOVIMIENTOS\n",{paginas:7});
 validarCampos(r,{banco:"BBVA",desde:"2026-09-01",hasta:"2026-09-30"});
 assert.equal(r.tipo,"debito");assert.equal(r.campos.saldo_inicial,"25.00");
 assert.equal(r.campos.cargos,"950.50");assert.equal(r.campos.abonos,"1125.75");
 assert.equal(r.campos.saldo_final,"200.25");assert.equal(r.campos.comisiones,undefined);
 assert.match(r.advertencias.join(" "),/siguiente estado/i);
});
test("Sobregiro o saldo a favor conserva el signo y los retiros no se vuelven negativos",()=>{
 const t="MAESTRA PYME BBVA MN\nPERIODO 01/09/2026 AL 30/09/2026\n"+
   "SALDO ANTERIOR -100.00\nDEPOSITOS/ABONOS(+) 2 10.00\n"+
   "RETIROS/CARGOS (-) 5 1,500.50\nSALDO FINAL 1,590.50-\n";
 const a=lector().analizarEstadoTexto(t);
 assert.equal(a.campos.saldo_inicial,"-100.00");
 assert.equal(a.campos.saldo_final,"-1590.50");
 assert.equal(a.campos.cargos,"1500.50");
 assert.equal(a.campos.abonos,"10.00");
});
test("Mercado Pago: periodo cruza meses y resumen con cantidades en siguiente renglón",()=>{
 const r=lector().analizarEstadoTexto(
  "Mercadolibre, S.A. DE C.V., Institución de Fondos de Pago Electrónico\n"+
  "Saldo inicial:\n$ 100.00\nAbonos:\n$ 2,300.25\nComisiones totales:\n$ 18.40\n"+
  "Saldo final:\n$ 225.00\nCargos:\n$ 2,175.25\n"+
  "DETALLE DE MOVIMIENTOS Período: Del 31 de agosto al 30 de septiembre de 2026");
 validarCampos(r,{banco:"MERCADO PAGO",desde:"2026-08-31",hasta:"2026-09-30"});
 assert.equal(r.campos.saldo_inicial,"100.00");
 assert.equal(r.campos.saldo_final,"225.00");
 assert.equal(r.campos.abonos,"2300.25");
 assert.equal(r.campos.cargos,"2175.25");
 assert.equal(r.campos.comisiones,undefined);
});
test("Banorte: capital a meses, comisiones, interés e IVA no se suman dos veces",()=>{
 const r=lector().analizarEstadoTexto(
  "BANORTE CREDITO\nTU PAGO REQUERIDO ESTE PERIODO\nPeriodo: 11-SEP-2026 al 09-OCT-2026\n"+
  "Fecha de corte: 09-OCT-2026\nFecha límite de pago:1 JUEVES, 29-OCT-2026\n"+
  "Pago para no generar intereses:2 $3,145.00\nPago mínimo:4 $450.50\n"+
  "RESUMEN DE CARGOS Y ABONOS DEL PERIODO\n"+
  "Adeudo del periodo anterior $2,000.00\nCargos regulares (no a meses) + $600.00\n"+
  "Cargos compras a meses (capital)7 + $200.00\nMonto de intereses8 + $100.00\n"+
  "Monto de comisiones + $30.00\nIVA de intereses y comisiones + $20.80\n"+
  "Pagos y abonos - $500.00\nSaldo cargos a meses: $50.00\nSaldo deudor total:12 $2,450.80");
 validarCampos(r,{banco:"BANORTE",desde:"2026-09-11",hasta:"2026-10-09"});
 assert.equal(r.campos.fecha_pago_limite,"2026-10-29");
 assert.equal(r.campos.cargos,"950.80");
 assert.equal(r.campos.intereses,"100.00");assert.equal(r.campos.comisiones,"30.00");
 assert.equal(r.campos.iva,"20.80");assert.equal(r.campos.abonos,"500.00");
 assert.equal(r.campos.pago_minimo,"450.50");assert.equal(r.campos.pago_sin_intereses,"3145.00");
 assert.equal(r.campos.saldo_final,"2450.80");
});
test("Nu: etiquetas con superíndices, fechas con palabras y pago requerido separado",()=>{
 const r=lector().analizarEstadoTexto(
  "Producto: Tarjeta de Crédito Nu, Oro\nTU PAGO REQUERIDO ESTE PERIODO\n"+
  "Periodo: 15 SEP 2026 al 14 OCT 2026\nFecha de corte: 14 OCT 2026\n"+
  "Fecha límite de pago1: Lunes, 26 OCT 2026\nPago para no generar intereses2:\n$2,500.50\n"+
  "Pago mínimo4: $126.00\nRESUMEN DE CARGOS Y ABONOS DEL PERIODO\n"+
  "Adeudo del periodo anterior = $1,000.00\nCargos regulares (no a meses) + $700.00\n"+
  "Cargos y compras a meses (capital)7 + $200.00\nMonto de intereses8 + $10.00\n"+
  "Monto de comisiones + $0.00\nIVA de intereses y comisiones9 + $1.60\n"+
  "Pagos y abonos - $100.00\nSaldo deudor total12 $1,811.60");
 validarCampos(r,{banco:"NU",desde:"2026-09-15",hasta:"2026-10-14"});
 assert.equal(r.campos.fecha_pago_limite,"2026-10-26");
 assert.equal(r.campos.cargos,"911.60");
 assert.equal(r.campos.pago_minimo,"126.00");
 assert.equal(r.campos.pago_sin_intereses,"2500.50");
});
test("American Express: reconocer tabla pero no inventar saldos y pagos mezclados",()=>{
 const r=lector().analizarEstadoTexto(
  "American Express\nPago Mínimo: $120.00\nFecha límite de pago: 12 de Octubre 2026\n"+
  "Interés Financiero: 50.00\nComisiones: 0.00\nNuevos Cargos incluyen los siguientes conceptos:\n"+
  "Nuevas transacciones: 0.00\nInterés Financiero: 50.00\nIVA: 8.00\n"+
  "Comisiones: 0.00\nTotal Nuevos Cargos: 58.00\n"+
  "Saldo Actual / Saldo Anterior Pagos y Créditos Nuevos Cargos Pago para no generar intereses\n"+
  "Período de Facturación Del 23 de Agosto al 22 de Septiembre de 2026");
 validarCampos(r,{banco:"AMEX",desde:"2026-08-23",hasta:"2026-09-22"});
 assert.equal(r.campos.fecha_pago_limite,"2026-10-12");
 assert.equal(r.campos.cargos,"58.00");
 assert.equal(r.campos.intereses,"50.00");
 assert.equal(r.campos.iva,"8.00");
 assert.equal(r.campos.saldo_inicial,undefined);
 assert.match(r.advertencias.join(" "),/manualmente/);
});
test("La lectura alerta diferencias bancarias sin crear ningún movimiento para compensarlas",()=>{
 const r=lector().analizarEstadoTexto(
  "MAESTRA PYME BBVA MN\nPERIODO 01/09/2026 AL 30/09/2026\n"+
  "SALDO ANTERIOR 100.00\nDEPOSITOS/ABONOS(+) 2 200.00\n"+
  "RETIROS/CARGOS (-) 3 50.00\nSALDO FINAL 249.00");
 assert.equal(r.fiable,true);
 assert.match(r.advertencias.join(" "),/diferencia de \$1\.00/);
 assert.equal(r.campos.saldo_final,"249.00");
});
test("PDF.js se sirve con versión fija bajo el mismo dominio y Cloudflare Access",()=>{
 const a=readFileSync(new URL("../src/panel-app.js",import.meta.url),"utf8");
 const prod=readFileSync(new URL("../wrangler.jsonc",import.meta.url),"utf8");
 const ensayo=readFileSync(new URL("../wrangler.finanzas-ensayo.jsonc",import.meta.url),"utf8");
 assert.match(codigo,/const PDFJS = "\/panel\/vendor\/pdfjs-4\.10\.38\/"/);
 assert.match(a,/pdfjs-dist\/build\/pdf\.min\.mjs/);
 assert.match(a,/pdfjs-dist\/build\/pdf\.worker\.min\.mjs/);
 assert.match(a,/ruta === "\/panel\/vendor\/pdfjs-4\.10\.38\/pdf\.min\.mjs"/);
 assert.match(a,/Cache-Control": "private, max-age=31536000, immutable"/);
 assert.match(prod,/"\*\*\/\*\.mjs"/);assert.match(ensayo,/"\*\*\/\*\.mjs"/);
 assert.doesNotMatch(codigo,/cdnjs|jsdelivr|https:\/\//i);
 assert.equal(JSON.parse(readFileSync(new URL("../package.json",import.meta.url),"utf8")).dependencies["pdfjs-dist"],"4.10.38");
});
test("Liverpool e imágenes sin texto no generan propuestas peligrosas",()=>{
 const ec=lector();
 assert.equal(ec.analizarEstadoTexto("LIVERPOOL TIENDA DEPARTAMENTAL").fiable,false);
 assert.equal(ec.analizarEstadoTexto("PDF SIN TEXTO RECONOCIBLE").fiable,false);
 assert.deepEqual(Object.keys(ec.analizarEstadoTexto("PDF SIN TEXTO RECONOCIBLE").campos),[]);
});
test("Nunca hay una ruta automática de guardado ni se usa el nombre del PDF como cuenta",()=>{
 const ec=lector();
 assert.equal(typeof ec.extraerEstadoPDF,"function");
 assert.doesNotMatch(codigo,/EC\.post\s*\(|fetch\s*\(\s*file|localStorage|sessionStorage/);
 const ui=readFileSync(new URL("../src/panel/cliente/05b-estados.js",import.meta.url),"utf8");
 assert.match(ui,/type='file' id='f-est-pdf-archivo'/);
 assert.match(ui,/Aplicar sugerencias al formulario/);
 assert.match(ui,/if\(actual\|\|!importado\?\.fiable/);
 assert.match(ui,/String\(celda\.value\|\|""\)\.trim\(\)/);
 assert.match(ui,/No se aplicarán datos a una institución distinta/);
 assert.match(ui,/Guardar estado de cuenta/);
});
test("Cabecera falsa, archivo enorme y formato ajeno se rechazan antes de leer PDF.js",async()=>{
 const ec=lector();
 await assert.rejects(ec.extraerEstadoPDF({name:"falso.pdf",size:10,type:"application/pdf",arrayBuffer:async()=>new TextEncoder().encode("NO-PDF").buffer}),/cabecera PDF/);
 await assert.rejects(ec.extraerEstadoPDF({name:"imagen.jpg",size:1,type:"image/jpeg"}),/Selecciona un archivo PDF/);
 await assert.rejects(ec.extraerEstadoPDF({name:"grande.pdf",size:12*1024*1024+1,type:"application/pdf"}),/12 MB/);
});
