import test from "node:test";
import assert from "node:assert/strict";
import { transfConCuenta } from "../src/finanzas.js";
import { transferenciasMes } from "../src/caja.js";
import { flujosMes } from "../src/cuentas.js";

// Conciliar reduce dos registros del MISMO cobro a una sola entrada al banco.
// El folio por servicio discrimina la misma numeración entre Báscula y Pensión.
test("Ticket de hoja vinculado: una sola entrada y a la cuenta de la transferencia",()=>{
  const ticket={tipo:"ticket",servicio:"bascula",folio:"F100",mes:"2026-10",fecha:"2026-10-18T10:00:00",
    dia:"2026-10-18",turno:"MAÑANA",importe:850,forma:"TRANSFERENCIA",cliente:"ENSAYO"};
  const manual={id:"ensayo-ligada",mes:"2026-10",fecha:"2026-10-18",cliente:"ENSAYO",
    importe:850,ticket_ref:"bascula:F100",cuenta:"bbva-personal"};
  const saldo=transfConCuenta([ticket],[manual],"bbva-pyme");
  assert.equal(saldo.length,1,"El mismo ingreso no se debe sumar dos veces");
  assert.equal(saldo[0].importe,850);
  assert.equal(saldo[0].cuenta,"bbva-personal","Una asignación explícita prevalece sobre la cuenta por defecto");
  const f=flujosMes({tarjeta:[],transf:saldo,admin:[],movs:[],sobres:[]},[
    {id:"bbva-pyme",tipo:"debito"},{id:"bbva-personal",tipo:"debito"}
  ]);
  assert.equal(f.cuentas["bbva-personal"].entradas,850);
  assert.equal(f.cuentas["bbva-pyme"].entradas,0);
  assert.equal(f.sin_cuenta.transferencias,0);
});

test("Transferencia sin vínculo no desaparece ni se suma como ticket de hoja",()=>{
  const ticket={tipo:"ticket",servicio:"pension",folio:"P100",mes:"2026-10",fecha:"2026-10-18T10:00:00",
    dia:"2026-10-18",turno:"MAÑANA",importe:900,forma:"TRANSFERENCIA"};
  const manual={id:"ensayo-otra",mes:"2026-10",fecha:"2026-10-19",cliente:"ENSAYO",
    importe:220,ticket_ref:null,cuenta:"bbva-personal"};
  const tr=transferenciasMes([ticket],[manual]);
  assert.equal(tr.hoja.length,1);
  assert.equal(tr.contadas.length,1);
  assert.equal(tr.total_hoja,900);
  assert.equal(tr.total_manual,220);
  const banco=transfConCuenta([ticket],[manual],"bbva-pyme");
  assert.equal(banco.length,2);
  assert.equal(banco.reduce((sum,x)=>sum+x.importe,0),1120);
  assert.deepEqual(banco.map(x=>[x.importe,x.cuenta]).sort((x,y)=>x[0]-y[0]),[
    [220,"bbva-personal"],[900,"bbva-pyme"]
  ]);
});

test("Folio idéntico entre servicios no mezcla tickets ni cuentas",()=>{
  const mk=(servicio,importe)=>({tipo:"ticket",servicio,folio:"001",mes:"2026-10",
    fecha:"2026-10-18T12:00:00",dia:"2026-10-18",turno:"MAÑANA",importe,forma:"TRANSFERENCIA"});
  const manual={id:"ensayo-pension",mes:"2026-10",fecha:"2026-10-18",cliente:"ENSAYO",importe:300,
    ticket_ref:"pension:001",cuenta:"bbva-personal"};
  const rows=transfConCuenta([mk("bascula",500),mk("pension",300)],[manual],"bbva-pyme");
  assert.equal(rows.length,2);
  assert.equal(rows.find(x=>x.ref==="pension:001").cuenta,"bbva-personal");
  assert.equal(rows.find(x=>x.ref==="bascula:001").cuenta,"bbva-pyme");
  assert.equal(rows.reduce((sum,x)=>sum+x.importe,0),800);
});
