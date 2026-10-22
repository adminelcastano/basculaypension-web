import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
const read=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
test("Volver al índice no sale del panel en rutas profundas directas",()=>{
 const js=read("src/panel/cliente/12-submenu.js");
 assert.doesNotThrow(()=>new vm.Script(js));
 assert.match(js,/history\.state\?\.desdeIndice && history\.state\.mod === mod/);
 assert.match(js,/history\.state\?\.desdeIndice && history\.state\.mod === "inicio"/);
 assert.ok(js.includes('history.replaceState({ mod, vista: null }'));
 assert.ok(js.includes('history.pushState({ mod, vista: b.dataset.ir, desdeIndice: true }'));
 assert.ok(js.includes('aria-current","page"'));
});
test("Las tablets 821–1200px muestran Volver y el plegable dispone de tacto y foco",()=>{
 const css=read("src/panel/estilos.css");
 const s=css.slice(css.lastIndexOf("/* Navegación premium"));
 assert.match(s,/@media \(min-width:821px\) and \(max-width:1200px\)/);
 assert.match(s,/\.mod\.uno:not\(\.en-idx\) \.sub-volver/);
 assert.match(s,/display:inline-flex/);
 assert.match(s,/@media\(max-width:390px\)/);
 assert.match(s,/focus-visible/);
 assert.match(s,/prefers-reduced-motion:reduce/);
});
