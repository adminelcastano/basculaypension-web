import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const path=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
test("DINERO oculta desglose de caja y salarios operativos, conservando historiales administrativos",()=>{
 const fin=path("src/panel/cliente/05-finanzas.js");
 const caja=path("src/panel/cliente/03-caja.js");
 const salario=path("src/panel/cliente/05c-salarios.js");
 const map=fin.match(/const BLOQUES = (\{[^\n]+\});/)?.[1];
 assert.ok(map);
 assert.ok(map.includes('"fb-resumen": ["resumen"]'));
 assert.ok(map.includes('"fb-bitacora": ["categorias", "admin", "bitacora", "reportes"]'));
 assert.ok(!map.includes('"diferencias"')&&!map.includes('"sueldos"'));
 assert.match(caja,/diferencia|Diferencia/);
 assert.ok(salario.includes('finanzas/salarios'));
 assert.match(fin,/const S =/);
});
