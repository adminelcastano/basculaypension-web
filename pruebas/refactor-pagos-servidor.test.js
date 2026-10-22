import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {execFileSync} from "node:child_process";
const leer=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
test("Rutas de pagos preservan literalmente transacciones y contratos HTTP",()=>{
 const original=execFileSync("git",["show","c8c924f1ce6e9f6143064360a5343472b60efa2d:src/agenda.js"],{encoding:"utf8"});
 const firma="async function pagosHechosRutas(request, env, partes, usuario, ahora) {";
 const a=original.indexOf(firma),b=original.indexOf("// Rutas: /panel/api/agenda",a);
 const module=leer("src/agenda-pagos-rutas.js"),coordinator=leer("src/agenda.js");
 // Conserva todo el contrato anterior salvo asignación inicial de categoría
 // vigente y el respeto explícito a los registros sin categoría al editar.
 const exacto=module
   .replace('const cat = (await resolverCategoria(env, c.categoria)) || await sugerirCategoriaVigente(env, v.titulo);',
     'const cat = (await resolverCategoria(env, c.categoria)) || adivinarCategoria(v.titulo);')
   .replace('const cat = "categoria" in c ? await resolverCategoria(env, c.categoria) : pago.categoria;',
     'const cat = (await resolverCategoria(env, c.categoria)) || pago.categoria || adivinarCategoria(titulo);');
 assert.match(module,/sugerirCategoriaVigente/);
 assert.match(module,/"categoria" in c/);
 assert.ok(a>0&&b>a&&exacto.includes(original.slice(a+firma.length,b)),"Cambios inesperados en la lógica de pagos");
 assert.match(coordinator,/pagosHechosRutas\(request, env, partes, usuario, ahora, dependenciasPagos\(\)\)/);
 for(const term of ["idFinanciero", "stmtVincularAbono", "centavosIguales", "guardarArchivo", "borrarArchivo", "stmtBitacoraSiCambio", "asegurarEsquemaObligaciones", "errorSaldoObligacion"])assert.ok(module.includes(term),term);
});
