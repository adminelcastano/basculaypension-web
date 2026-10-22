import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {execFileSync} from "node:child_process";
import {readFileSync} from "node:fs";
const src=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
test("Calendario y tareas conservan cuerpo original y enlaces externos",()=>{
 const antiguo=execFileSync("git",["show","73aa77080ee464cdc85117df03d80170fa13fa99:src/panel/cliente/07-agenda.js"],{encoding:"utf8"});
 const a=antiguo.indexOf("  function vistaCalendario() {"),b=antiguo.indexOf("  // Al volver a la app, la agenda y Dinero se actualizan",a);
 const actualizado=src("src/panel/cliente/07-agenda.js"),mod=src("src/panel/cliente/07-calendario-controlador.js");
 assert.ok(a>=0&&b>a);
 assert.ok(mod.includes(antiguo.slice(a,b)),"Se alteró lógica del calendario o tareas");
 assert.match(actualizado,/window\.CastaCalendarioControlador\(\{/);
 assert.match(actualizado,/window\.agendaAbrir/);
 assert.match(src("src/panel-app.js"),/J07A, J07K, J07, J08/);
 for(const fragmento of ["function vistaCalendario()","function vistaAgendaLista()","function vistaTareas()","function reprogramar(","function toastAccion("])assert.ok(mod.includes(fragmento),fragmento);
 assert.doesNotThrow(()=>new vm.Script(mod));
 assert.doesNotThrow(()=>new vm.Script(actualizado));
});
