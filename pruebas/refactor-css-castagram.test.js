import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {execFileSync} from "node:child_process";
test("CASTAGRAM conserva CSS y versión cacheable exactamente sin cambios visuales",()=>{
 const old=execFileSync("git",["show","9dbfddf2f514b6267e3057ee1c72ea9749c6792d:src/panel/estilos.css"]);
 const base=readFileSync(new URL("../src/panel/estilos.css",import.meta.url),"utf8");
 const cast=readFileSync(new URL("../src/panel/estilos-castagram.css",import.meta.url),"utf8");
 assert.ok(cast.includes(".casta-identidad") && cast.includes(".muro-q"));
 assert.deepEqual(Buffer.from(base.replace("/*__CASTAGRAM_CSS__*/",cast)),old);
 assert.equal((base.match(/\/\*__CASTAGRAM_CSS__\*\//g)||[]).length,1);
});
