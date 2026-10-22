import assert from "node:assert/strict";
import {readFileSync,writeFileSync} from "node:fs";
const ACC="ff18e14a20fef8a9c6e49eb88f19cf46",WORKER="basculaypension-web";
const D1="665db15f-b688-4d34-9632-a264a8fe9637",KV="3eac28ac69aa4756bc1762072bfb0d05";
const AUD="a0dcf0e931c7b6a7b64cae835ae329cb05fc3bdbdc972c1af99c4619ee3fba1d";
const PREVIOUS="8083307f-9ebd-4120-a824-8d97b78077a9";
const token=process.env.CLOUDFLARE_API_TOKEN;
assert.ok(token,"Se necesita CLOUDFLARE_PRODUCTION_TOKEN, distinto del token del Worker de ensayo");
async function cf(path){
 const r=await fetch("https://api.cloudflare.com/client/v4/accounts/"+ACC+path,{headers:{Authorization:"Bearer "+token}});
 const j=await r.json().catch(()=>null);
 if(!r.ok||!j?.success)throw Error("Cloudflare HTTP "+r.status+"; token sin permiso de producción. No se desplegó nada.");
 return j.result;
}
const config=readFileSync("wrangler.jsonc","utf8");
for(const s of ['"name": "basculaypension-web"','"database_name": "castano-facturas"','"binding": "FILES"','"SALARIOS_SYNC_ACTIVE": "NO"','"ACCESS_AUD": "'+AUD+'"'])assert.ok(config.includes(s),"Config de producción inesperada");
assert.ok(!config.includes('"ENSAYO_FINANZAS": "1"'));
const settings=await cf("/workers/scripts/"+WORKER+"/settings");
const bind=n=>(settings?.bindings||[]).find(b=>b.name===n);
assert.equal(bind("DB")?.id,D1,"D1 incorrecta");
assert.equal(bind("FILES")?.namespace_id,KV,"KV incorrecta");
assert.equal(bind("ACCESS_AUD")?.text,AUD,"Access cambiado");
assert.equal(bind("SALARIOS_SYNC_ACTIVE")?.text,"NO","SALARIOS activo");
for(const s of ["CF_API_TOKEN","INGRESOS_TOKEN","AVISO_TOKEN","AVISO_URL"])
 assert.equal(bind(s)?.type,"secret_text","Falta secreto productivo "+s);
const deploy=await cf("/workers/scripts/"+WORKER+"/deployments?per_page=1");
const current=(deploy?.deployments||deploy||[])[0]?.versions?.[0]?.version_id;
assert.equal(current,PREVIOUS,"La versión productiva cambió desde el respaldo; abortar publicación");
const a='"database_name": "castano-facturas"';
const b='"kv_namespaces": [{ "binding": "FILES" }]';
assert.equal(config.split(a).length,2);
assert.equal(config.split(b).length,2);
const pinned=config.replace(a,a+', "database_id": "'+D1+'"')
 .replace(b,'"kv_namespaces": [{ "binding": "FILES", "id": "'+KV+'" }]');
assert.ok(pinned.includes('"database_id": "'+D1+'"'));
assert.ok(pinned.includes('"id": "'+KV+'"'));
writeFileSync("wrangler.pr46-publicacion.generated.jsonc",pinned,{mode:0o600});
console.log("Control de producción aprobado: Worker, bindings D1/KV fijos, Access, secretos y SALARIOS=NO.");
console.log("Versión anterior conservada para reversión:",current);
