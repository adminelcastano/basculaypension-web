import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {readFileSync} from "node:fs";
const ui=readFileSync(new URL("../src/panel/cliente/05e-obligaciones.js",import.meta.url),"utf8");
test("Obligaciones conserva formularios sin guardar y UID ante consultas simultáneas",()=>{
 assert.doesNotThrow(()=>new vm.Script(ui));
 for(const fragmento of [
  'previo?.dataset.dirty==="1"',
  'Object.fromEntries(new FormData(previo).entries())',
  'creandoUid=borrador.uid',
  'f.dataset.id=borrador.id;f.dataset.version=borrador.version',
  'f.dataset.dirty="1"',
  'delete f.dataset.dirty',
  'const token=++sec,el=$("#fb-obligaciones")',
  'if(token===sec)pintar(r)'
 ])assert.ok(ui.includes(fragmento),fragmento);
 assert.ok(!ui.includes('if(cargando)return'));
 assert.ok(!ui.includes('creandoUid=null;\n        await cargar();'));
 assert.match(ui,/Si la escritura se completó pero la lectura posterior falla/);
});
