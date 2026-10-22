import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {readFileSync} from "node:fs";
import {execFileSync} from "node:child_process";
const src=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
test("Despachador panel se extrajo literalmente, Access y origen siguen en Worker",()=>{
 const before=execFileSync("git",["show","dc65b7e1d6185357b5a795c9e4b35331509ebf35:src/worker.js"],{encoding:"utf8"});
 const a=before.indexOf("async function rutasPanel(request, env, url, usuario) {"),b=before.indexOf("\nfunction cabecerasPanel",a);
 const module=src("src/worker-panel-rutas.js"),worker=src("src/worker.js");
 // La ruta sigue intacta salvo que ahora pasa la identidad del administrador
 // a la bitácora de eliminación y recategorización.
 assert.match(module,/categoriasPanel\(request, env, usuario\)/);
 const originalRutas=module.replace("return await categoriasPanel(request, env, usuario);","return await categoriasPanel(request, env);");
 assert.ok(a>0&&b>a&&originalRutas.includes(before.slice(a,b)),"No se conservó cada rama de ruta");
 assert.match(worker,/const usuario = await verificarAcceso\(request, env\)/);
 assert.match(worker,/request.headers.get\("X-Panel"\) !== "1"/);
 assert.match(worker,/const rutasPanel = crearRutasPanel\(\{/);
 assert.match(worker,/if \(!ruta.startsWith\("\/panel\/api\/"\)\)/);
 assert.doesNotThrow(()=>new vm.Script(module.replace(/^import .*$/gm,"").replace(/^export /gm,"")));
});