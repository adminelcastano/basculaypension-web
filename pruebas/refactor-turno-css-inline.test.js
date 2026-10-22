import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {execFileSync} from "node:child_process";
const src=p=>readFileSync(new URL("../"+p,import.meta.url));
test("La tablet recibe exactamente el HTML anterior, con CSS en línea y sin fetch adicional",()=>{
 const before=execFileSync("git",["show","625ddf66228de65ff76b9954f909355c11d535d8:src/turno.html"]);
 const template=src("src/turno.html").toString("utf8");
 const styles=src("src/turno-estilos.css").toString("utf8");
 assert.ok(styles.length>30000);
 assert.deepEqual(Buffer.from(template.replace("/*__TURNO_CSS__*/",styles)),before);
 const runtime=src("src/turno.js").toString("utf8");
 assert.match(runtime,/import CSS_TURNO from "\.\/turno-estilos\.css"/);
 assert.match(runtime,/html\.replace\("\/\*__INTERPRETAR__\*\/"\, INTERPRETAR\)\.replace\("\/\*__TURNO_CSS__\*\/"\, CSS_TURNO\)/);
 assert.equal(template.match(/<style>/g)?.length,1);
 assert.equal(template.match(/<script>/g)?.length,3);
 assert.ok(!template.includes('<link rel="stylesheet" href="/turno'));
});
