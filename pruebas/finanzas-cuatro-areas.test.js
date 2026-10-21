import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const leer=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
test("DINERO expone cuatro secciones sin borrar formularios internos",()=>{
 const html=leer("src/panel/pagina.html"), fin=html.split('id="mod-finanzas"')[1].split('id="mod-agenda"')[0];
 assert.deepEqual([...fin.matchAll(/class="bloque" data-bloque="([^"]+)"/g)].map(m=>m[1]),["resumen","bancos","obligaciones","movimientos"]);
 for(const id of ["fb-resumen","fb-cuentas","fb-efectivo","fb-estados","fb-obligaciones","fb-por-cobrar","pg-prog","pg-hechos","fb-bitacora"])
  assert.equal((fin.match(new RegExp('id="'+id+'"','g'))||[]).length,1,id);
});
test("Antiguos destinos apuntan a las cuatro vistas y transferencias a CAJA",()=>{
 const base=leer("src/panel/cliente/00-base.js");
 const nav=leer("src/panel/cliente/02-personal.js");
 const agenda=leer("src/panel/cliente/07-agenda.js");
 assert.ok(base.includes('ALIAS_DINERO'));
 assert.ok(base.includes('if (v === "transferencias")'));
 assert.ok(nav.includes('programados:"movimientos"'));
 assert.ok(agenda.includes('["finanzas", "movimientos", "pg-prog"]'));
 assert.ok(agenda.includes('["finanzas", "movimientos", "pg-hechos"]'));
});
