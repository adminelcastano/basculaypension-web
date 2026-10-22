import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {execFileSync} from "node:child_process";
const src=p=>readFileSync(new URL("../"+p,import.meta.url));
test("CSS servido conserva bytes exactos de producción antes del refactor",()=>{
 const original=execFileSync("git",["show","b9973b25b18fbd69892eeb84bbfede9b5c57a14a:src/panel/estilos.css"]);
 const b=src("src/panel/estilos.css").toString("utf8"),n=src("src/panel/estilos-navegacion.css").toString("utf8"),casta=src("src/panel/estilos-castagram.css").toString("utf8");
 assert.ok(b.length>100000);assert.ok(n.length>1000);
 assert.deepEqual(Buffer.from(b.replace("/*__CASTAGRAM_CSS__*/", casta)+n),original);
 const panel=src("src/panel-app.js").toString("utf8");
 assert.match(panel,/CSS_BASE\.replace/);
 assert.match(panel,/export \{ CSS \}/);
});
