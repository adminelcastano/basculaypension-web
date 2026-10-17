import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = p => readFileSync(new URL("../" + p, import.meta.url), "utf8");
test("Inicio: cuenta pendientes, no todas las publicaciones", () => {
 const api=read("src/agenda.js"), ui=read("src/panel/cliente/06-inicio.js");
 assert.match(api,/avisos_sin_leer = \(await avisosSinLeer\(env\)\)\.length/);
 assert.match(ui,/a\.avisos_sin_leer/);assert.match(ui,/a\.abiertos\.aviso/);
});
test("Tablet: contador después del PIN sin fusionar Leído y Enterado",()=>{
 const html=read("src/turno.html");
 assert.match(html,/class="casta-alertas"/);
 assert.match(html,/const sinLeer = \(\) => E\.avisos\.filter/);
 assert.match(html,/avisos\/\$\{en\.dataset\.enterado\}\/enterado/);
});
test("Logotipo sin título grande duplicado",()=>{
 const html=read("src/turno.html"),panel=read("src/panel/cliente/07-agenda.js");
 assert.match(html,/castagram-texto\.png/);assert.match(panel,/castagram-texto\.png/);
 assert.doesNotMatch(html,/titulo\("Castagram\."/);
});
