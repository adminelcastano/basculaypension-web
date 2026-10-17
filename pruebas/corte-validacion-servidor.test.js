import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const server=readFileSync(new URL("../src/turno.js",import.meta.url),"utf8");
const tablet=readFileSync(new URL("../src/turno.html",import.meta.url),"utf8");

test("La tablet envía confirmación expresa de pagos distintos",()=>{
  assert.match(tablet,/pagos_distintos_confirmados:\s*!!\$\("#dup-confirmo"\)\?\.checked/);
  assert.match(tablet,/Confirmo que son pagos distintos/);
  const scripts=[...tablet.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(x=>x[1]);
  scripts.filter(s=>s.trim()).forEach(s=>assert.doesNotThrow(()=>new Function(s)));
});

test("El servidor bloquea la coincidencia salvo confirmación expresa",()=>{
  assert.match(server,/const gastosPrevios = \(await env\.DB\.prepare/);
  assert.match(server,/WHERE dia = \? AND turno = \?/);
  assert.match(server,/AND forma = 'EFECTIVO'/);
  assert.match(server,/coinciden\.length && c\.pagos_distintos_confirmados !== true/);
  assert.match(server,/Posible gasto duplicado al repartir/);
  assert.match(server,/INSERT INTO turno_cortes_hist/);
});

test("No descarta gastos ni retiros ni sobres y mantiene la igualdad del reparto",()=>{
  assert.match(server,/const repartido = sobre \+ cambioSig \+ retiros\.reduce/);
  assert.match(server,/const difRep = Math\.round/);
  assert.match(server,/JSON\.stringify\(retiros\)/);
  assert.doesNotMatch(server,/DELETE FROM caja_gastos WHERE dia = \? AND turno = \?/);
});
