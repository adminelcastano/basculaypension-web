import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {execFileSync} from "node:child_process";
import {rutasComprasAgenda} from "../src/agenda-compras-rutas.js";
const src=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
test("Las rutas de compra conservaron literalmente la transacción original, UID y retorno a pendiente",()=>{
 const old=execFileSync("git",["show","545f12ec90397a9909f3868e87b68bead62ef600:src/agenda.js"],{encoding:"utf8"});
 const a=old.indexOf("  // ---- Lista de compras: carrito y terminar la compra con un solo ticket ----");
 const b=old.indexOf("  // Archivo de avisos: todos los archivados con su conversación",a);
 const mod=src("src/agenda-compras-rutas.js"),coordinador=src("src/agenda.js");
 assert.ok(a>=0&&b>a&&mod.includes(old.slice(a,b)));
 assert.match(coordinador,/return res;/);
 assert.match(coordinador,/rutasComprasAgenda\(request, env, partes, usuario, ahora/);
 for(const clave of ['idFinanciero("compra-ticket"','stmtHistorialCompra','stmtBitacoraSiCambio','await normalizarMedio(env, c)','const ya = await repetido(); if (ya) return ya'])assert.ok(mod.includes(clave),clave);
});
test("Compras: ruta desconocida sigue delegando 404 sin tocar D1",async()=>{
 const result=await rutasComprasAgenda({method:"POST"},null,["agenda","compras","inexistente"],null,"2026-10-21T12:00:00Z",{});
 assert.equal(result,null);
});
