import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {readFileSync} from "node:fs";
const src=readFileSync(new URL("../src/panel/cliente/05-finanzas.js",import.meta.url),"utf8");
test("Resumen financiero diferencia disponible calculado, deuda y cobros",()=>{
 assert.doesNotThrow(()=>new vm.Script(src));
 for(const s of ["Disponible calculado (sobres + débito)","Por pagar · deuda confirmada",
  "Vencido · obligaciones","Próximos 7 días · obligaciones","Próximos 30 días · obligaciones",
  "Por cobrar a clientes · CAJA","Deuda en tarjetas","Escenario tras pagos exigibles a 30 días"])
   assert.ok(src.includes(s),s);
 assert.ok(src.includes("b.dinero != null && !b.dinero_parcial"));
 assert.ok(src.includes("e.saldo != null"));
 assert.ok(src.includes("j.por_cobrar_caja?.total??null"));
 assert.ok(src.includes('api("finanzas/obligaciones").catch(() => null)'));
 assert.match(src,/<summary>Ver detalle operativo del mes/);
 assert.match(src,/sin sumar cobros futuros|Sin sumar cobros futuros/);
});
