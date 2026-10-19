// No se debe subir por error el panel integral sobre la D1 usada en
// diagnósticos ni con secretos, URLs o tareas productivas.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const raw=readFileSync(new URL("../wrangler.finanzas-ensayo.jsonc",import.meta.url),"utf8");
const cfg=JSON.parse(raw.replace(/^\s*\/\/.*$/gm,""));
const product=readFileSync(new URL("../wrangler.jsonc",import.meta.url),"utf8");

test("Configuración de ensayo jamás apunta a D1 productiva ni a la base de diagnóstico",()=>{
  assert.equal(cfg.name,"castano-finanzas-ensayo-20261018");
  assert.notEqual(cfg.name,"basculaypension-web");
  assert.equal(cfg.d1_databases.length,1);
  assert.equal(cfg.d1_databases[0].binding,"DB");
  assert.equal(cfg.d1_databases[0].database_id,"bb6fac21-f3e9-44b3-8e67-770c14796532");
  assert.equal(cfg.d1_databases[0].database_name,"castano-finanzas-integral-ensayo-20261018");
  assert.notEqual(cfg.d1_databases[0].database_name,"castano-facturas");
  assert.notEqual(cfg.d1_databases[0].database_id,"fc96fc85-e43a-4ca2-9c39-06de973ce437");
  assert.match(raw,/D1 INTEGRAL NUEVA/);
  assert.match(product,/castano-facturas/,"No modificar el nombre productivo");
});
test("El ensayo tiene únicamente KV propia y cero procesos o servicios productivos",()=>{
  assert.deepEqual(cfg.kv_namespaces,[{binding:"FILES",id:"06093f14870a4df89ab81b0246dec74a"}]);
  assert.deepEqual(cfg.triggers.crons,[]);
  assert.equal(cfg.workers_dev,true); // Solo en subdominio protegido por Access, sin previews.
  assert.equal(cfg.preview_urls,false);
  assert.equal(cfg.vars.ENSAYO_FINANZAS,"1");
  assert.equal(cfg.vars.ADMIN_EMAILS,"administracion@basculaypension.com");
  assert.equal(cfg.vars.TURNO_EMAILS,"");
  assert.equal(cfg.vars.ACCESS_TEAM_DOMAIN,"odd-math-3ae5.cloudflareaccess.com");
  assert.equal(cfg.vars.ACCESS_AUD,"61906c005bbf2883bafb408d577211fe96ceef4e7ddc9b0a179e484fef8e390b");
  for(const key of ["INGRESOS_URL","INGRESOS_TOKEN","AVISO_URL","AVISO_TOKEN","CF_API_TOKEN","AI","CF_ACCOUNT_ID","SENDGRID_API_KEY"])
    assert.ok(!Object.hasOwn(cfg.vars,key),"No incluir "+key);
  assert.ok(!Object.hasOwn(cfg,"ai"));
  assert.equal(cfg.main,"src/worker.js");
  assert.ok(cfg.assets?.run_worker_first?.includes("/panel/*"));
});

test("El Worker de ensayo deniega endpoints públicos, crons y escrituras ajenas a Finanzas",()=>{
  const code=readFileSync(new URL("../src/worker.js",import.meta.url),"utf8");
  assert.match(code,/env\.ENSAYO_FINANZAS === "1"/);
  assert.match(code,/ruta\.startsWith\("\/api\/"\)/);
  assert.match(code,/ruta\.startsWith\("\/expediente\/"\)/);
  assert.match(code,/ruta === "\/turno"/);
  assert.match(code,/if \(env\.ENSAYO_FINANZAS === "1"\) return;/);
  assert.match(code,/ENTORNO DE ENSAYO FINANCIERO/);
  assert.match(code,/Solo se permiten operaciones financieras sintéticas/);
  assert.doesNotMatch(readFileSync(new URL("../wrangler.jsonc",import.meta.url),"utf8"),/ENSAYO_FINANZAS/);
});

test("La salud del Worker integral se consulta después de Access y exige enlaces sintéticos",()=>{
  const code=readFileSync(new URL("../src/worker.js",import.meta.url),"utf8");
  assert.match(code,/ruta === "\/panel\/api\/ensayo\/estado"/);
  assert.match(code,/entorno:"FINANZAS_INTEGRAL_ENSAYO"/);
  assert.match(code,/kv_aislada:kv\?\.entorno==="KV-FINANZAS-ENSAYO"/);
  assert.match(code,/servicios_productivos:false/);
  assert.match(code,/Configuración insegura del ensayo/);
  const inicioPanel=code.indexOf("async function panel(request, env, url)");
  const verificar=code.indexOf("const usuario = await verificarAcceso(request, env);",inicioPanel);
  const estado=code.indexOf('ruta === "/panel/api/ensayo/estado"',inicioPanel);
  assert.ok(verificar>inicioPanel && estado>verificar,"Nadie consulta D1 o KV de ensayo sin validar JWT de Access");
});
