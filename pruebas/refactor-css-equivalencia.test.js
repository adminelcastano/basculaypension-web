import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {execFileSync} from "node:child_process";
const src=p=>readFileSync(new URL("../"+p,import.meta.url));
test("CSS servido conserva bytes exactos de producción antes del refactor",()=>{
 const original=execFileSync("git",["show","b9973b25b18fbd69892eeb84bbfede9b5c57a14a:src/panel/estilos.css"]);
 const b=src("src/panel/estilos.css"),n=src("src/panel/estilos-navegacion.css");
 assert.ok(b.length>100000);assert.ok(n.length>1000);
 // La base CSS y el CSS de navegación mantienen sus bytes originales.
 // Sólo admitimos el apéndice aislado de la nueva interfaz de sobres.
 const marca=Buffer.from("\n/* Confirmación física de sobres:");
 const inicio=b.indexOf(marca);
 assert.ok(inicio>100000,"No aparece el apéndice autorizado de recepción de sobres");
 assert.deepEqual(Buffer.concat([b.subarray(0,inicio),n]),original);
 const extra=b.subarray(inicio).toString("utf8");
 assert.match(extra,/\.c-sobre-recepcion/);
 assert.match(extra,/\.ini-sobres-ir/);
 const panel=src("src/panel-app.js").toString("utf8");
 assert.match(panel,/CSS_BASE \+ CSS_NAVEGACION/);
 assert.match(panel,/export \{ CSS \}/);
});
