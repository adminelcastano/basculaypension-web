// Contratos de saldos bancarios usando el motor de cálculo REAL del sitio.
// Fixture exclusiva de ensayo: concuerda con registros ENSAYO-INTEGRAL-* en D1 aislada.
import test from "node:test";
import assert from "node:assert/strict";
import { flujosMes, encadenarSaldos } from "../src/cuentas.js";

const mes="2026-10";
const cuentas=[
 {id:"bbva-pyme",nombre:"BBVA PYME",tipo:"debito",tarjeta:0,activa:1},
 {id:"mdo-pago",nombre:"MDO PAGO",tipo:"debito",tarjeta:1,activa:1,comision_pct:3.5,comision_iva:1},
 {id:"banorte-credito",nombre:"BANORTE CREDITO",tipo:"credito",tarjeta:0,activa:1},
 {id:"bbva-personal",nombre:"BBVA PERSONAL",tipo:"debito",tarjeta:0,activa:1}
];

function escenario(){
 return {
   tarjeta:[],
   transf:[{id:"ENSAYO-INTEGRAL-TRANSF-20261018",fecha:"2026-10-18",cuenta:"bbva-pyme",importe:850}],
   admin:[{id:"ENSAYO-INTEGRAL-GASTO-20261018",forma:"TRANSFERENCIA",cuenta:"bbva-pyme",monto:275.50}],
   movs:[{id:"ENSAYO-INTEGRAL-TRASPASO-20261018",tipo:"traspaso",fecha:"2026-10-18",creado:"2026-10-18T23:59:00Z",origen:"bbva-pyme",destino:"mdo-pago",importe:300}],
   sobres:[],cobrosAdmin:[],hojaAdmin:[],cambio:[]
 };
}

test("Saldos de ensayo: transferencia + pago + traspaso internos sin doble contabilización",()=>{
 const f=flujosMes(escenario(),cuentas);
 assert.deepEqual({in:f.cuentas["bbva-pyme"].entradas,out:f.cuentas["bbva-pyme"].salidas},{in:850,out:575.50});
 assert.deepEqual({in:f.cuentas["mdo-pago"].entradas,out:f.cuentas["mdo-pago"].salidas},{in:300,out:0});
 assert.deepEqual({in:f.cuentas["banorte-credito"].entradas,out:f.cuentas["banorte-credito"].salidas},{in:0,out:0});
 const saldos=encadenarSaldos([mes],["sobres",...cuentas.map(c=>c.id)],{
  [mes]:{"bbva-pyme":6000,"mdo-pago":1500,"banorte-credito":1000}
 },{
  [mes]:{sobres:f.sobres,...f.cuentas}
 },new Set(["banorte-credito"]));
 assert.equal(saldos["bbva-pyme"].saldo,6274.50);
 assert.equal(saldos["mdo-pago"].saldo,1800);
 assert.equal(saldos["banorte-credito"].saldo,1000);
 assert.equal(saldos["bbva-personal"].saldo,null,"sin saldo inicial no se inventa saldo");
 assert.equal(saldos["bbva-pyme"].saldo+saldos["mdo-pago"].saldo,8074.50);
 assert.equal(f.cuentas["bbva-pyme"].detalle.transferencias,850);
 assert.equal(f.cuentas["bbva-pyme"].detalle.pagos,275.50);
 assert.equal(f.cuentas["bbva-pyme"].detalle.enviado,300);
 assert.equal(f.cuentas["mdo-pago"].detalle.recibido,300);
 assert.equal(f.sin_cuenta.transferencias,0);
 assert.equal(f.sin_cuenta.pagos,0);
});

test("Un traspaso no crea ni ingresos ni egresos globales; conserva total de cuentas",()=>{
 const f=flujosMes({...escenario(),transf:[],admin:[]},cuentas);
 assert.equal(f.cuentas["bbva-pyme"].salidas,300);
 assert.equal(f.cuentas["mdo-pago"].entradas,300);
 assert.equal(Object.values(f.cuentas).reduce((sum,c)=>sum+c.entradas-c.salidas,0),0);
 assert.equal(f.sobres.entradas,0);
 assert.equal(f.sobres.salidas,0);
});

test("Crédito: cargo aumenta deuda y pago desde débito la reduce",()=>{
 const d={...escenario(),transf:[],admin:[
   {cuenta:"banorte-credito",forma:"TARJETA",monto:400}
 ],movs:[
   {tipo:"pago_tarjeta",origen:"bbva-pyme",destino:"banorte-credito",importe:150,fecha:"2026-10-18",creado:"2026-10-18T00:00:00Z"}
 ]};
 const f=flujosMes(d,cuentas);
 const saldos=encadenarSaldos([mes],["bbva-pyme","banorte-credito"],{
   [mes]:{"bbva-pyme":6000,"banorte-credito":1000}
 },{
   [mes]:{"bbva-pyme":f.cuentas["bbva-pyme"],"banorte-credito":f.cuentas["banorte-credito"]}
 },new Set(["banorte-credito"]));
 assert.equal(saldos["bbva-pyme"].saldo,5850);
 assert.equal(saldos["banorte-credito"].saldo,1250);
 assert.equal(f.cuentas["banorte-credito"].salidas,400);
 assert.equal(f.cuentas["banorte-credito"].entradas,150);
});
