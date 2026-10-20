import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=p=>readFileSync(new URL(p,import.meta.url),"utf8");
test("Producción obliga SALARIOS_SYNC_ACTIVE=NO hasta autorización independiente",()=>{
  const wr=read("../wrangler.jsonc");
  const w=wr.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm,"");
  const j=JSON.parse(w);
  assert.equal(j.name,"basculaypension-web");
  assert.equal(j.vars.SALARIOS_SYNC_ACTIVE,"NO");
  const api=read("../src/finanzas-salarios.js");
  assert.match(api,/env\.SALARIOS_SYNC_ACTIVE==="SI"/);
  assert.match(api,/if\(!habilitado\)return json\(\{ok:false,error:"La conexión de SALARIOS está suspendida/);
  const gs=read("../herramientas/aviso-correo.gs");
  assert.match(gs,/getProperty\('SALARIOS_SYNC_ACTIVE'\)!=='SI'/);
  assert.match(gs,/getProperty\('SALARIOS_SHEET_ID'\)/);
});
test("La configuración de ensayo no hereda una autorización de salarios",()=>{
  const c=read("../wrangler.finanzas-ensayo.jsonc");
  assert.doesNotMatch(c,/"SALARIOS_SYNC_ACTIVE":\s*"SI"/);
  assert.match(c,/"ENSAYO_FINANZAS":\s*"1"/);
});
