import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const fuente=nombre=>readFileSync(new URL("../"+nombre,import.meta.url),"utf8");
test("SALARIOS queda en área administrativa sin duplicar el panel ni cambiar su API",()=>{
  const pagina=fuente("src/panel/pagina.html");
  assert.equal((pagina.match(/id="f-salarios-contenido"/g)||[]).length,1);
  const dinero=pagina.split('id="mod-finanzas"')[1].split('id="mod-agenda"')[0];
  assert.ok(!dinero.includes('id="fb-salarios"'));
  const config=pagina.split('id="cfg-conexiones"')[1].split('id="cfg-sistema"')[0];
  assert.ok(config.includes('id="fb-salarios"'));
  const salario=fuente("src/panel/cliente/05c-salarios.js");
  assert.match(salario,/EC\.api\("finanzas\/salarios"\)/);
  assert.match(salario,/e\.detail==="config"/);
  const base=fuente("src/panel/cliente/00-base.js");
  assert.ok(base.includes('h === "dinero/salarios"'));
});
