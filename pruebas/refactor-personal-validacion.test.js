import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {execFileSync} from "node:child_process";
import {crearValidadoresPersonal} from "../src/personal-validacion.js";
const src=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
test("Validación Personal conserva literalmente el bloque original",()=>{
 const orig=execFileSync("git",["show","e94e2612235eb46697b7bbf3162afdb6399b2c8c:src/personal.js"],{encoding:"utf8"});
 const a=orig.indexOf("function limpiar(valor, largo, tipo) {"),b=orig.indexOf("// Fotos que se pueden subir por documento",a);
 assert.ok(a>0&&b>a&&src("src/personal-validacion.js").includes(orig.slice(a,b)));
 assert.match(src("src/personal.js"),/crearValidadoresPersonal\(\{ RE_CURP, RE_EMAIL, LISTAS \}\)/);
});
test("Expediente valida correo, CURP, campos requeridos y listas sintéticas",()=>{
 const v=crearValidadoresPersonal({RE_CURP:/^[A-Z]{4}\d{6}[HMX][A-Z]{5}[A-Z0-9]\d$/,RE_EMAIL:/^[^\s@]+@[^\s@]+\.[^\s@]+$/,LISTAS:{puesto:["Báscula","Administración"]}});
 assert.equal(v.limpiar("  Ejemplo  ",60),"Ejemplo");
 assert.equal(v.limpiar("(123) 456 7890",10,"tel"),"1234567890");
 assert.equal(v.validar("123","tel"),"Debe tener 10 dígitos.");
 assert.equal(v.validar("invalido","email"),"Correo inválido.");
 assert.equal(v.validar("Otro","lista:puesto"),"Elige una opción.");
 const a=v.leerCampos({nombre:"Nombre sintético",telefono:"123"},[["nombre",120],["telefono",10,"tel"]],["nombre","telefono"]);
 assert.equal(a.datos.nombre,"Nombre sintético"); assert.ok(a.errores.telefono);
 const b=v.leerCampos({},[["nombre",120]],["nombre"]);assert.equal(b.errores.nombre,"Este dato es obligatorio.");
});
