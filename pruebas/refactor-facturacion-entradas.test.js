import test from "node:test";
import assert from "node:assert/strict";
import {MAX_ARCHIVO,normalizarImporte,texto,archivo,tipoArchivo,validarArchivo} from "../src/facturacion-entradas.js";
import {readFileSync} from "node:fs";
test("El Worker conserva importación y límites de archivo sin acoplarlos a D1",()=>{
 const worker=readFileSync(new URL("../src/worker.js",import.meta.url),"utf8");
 assert.match(worker,/from "\.\/facturacion-entradas\.js"/);
 assert.match(worker,/MAX_PETICION = 22 \* 1024 \* 1024/);
 assert.equal(MAX_ARCHIVO,10*1024*1024);
});
test("Normalización y mensajes de entrada siguen idénticos",()=>{
 assert.equal(normalizarImporte("$1,250.50"),"1250.50");
 assert.equal(normalizarImporte("1250,5"),"1250.50");
 assert.equal(normalizarImporte(""),"");
 assert.equal(normalizarImporte("1.234"),null);
 const form=new Map([["nombre","  Ejemplo  "],["archivo",null]]);
 assert.equal(texto(form,"nombre"),"Ejemplo");
 assert.equal(archivo(form,"archivo"),null);
 assert.equal(validarArchivo(null,null,true,"ticket"),"Adjunta ticket.");
 assert.match(validarArchivo({size:MAX_ARCHIVO+1},"image/png",true,"ticket"),/más de 10 MB/);
 assert.match(validarArchivo({size:10},null,true,"ticket"),/JPG, PNG, WebP, HEIC o PDF válido/);
});
test("Firma real JPEG, PNG, PDF reconocida sin red ni almacenamiento",async()=>{
 const jpg=new Blob([Uint8Array.of(255,216,255,1,2)],{type:""});
 const png=new Blob([Uint8Array.of(137,80,78,71,13,10,26,10)],{type:""});
 const pdf=new Blob([new TextEncoder().encode("%PDF-1.7")],{type:""});
 assert.equal(await tipoArchivo(jpg),"image/jpeg");
 assert.equal(await tipoArchivo(png),"image/png");
 assert.equal(await tipoArchivo(pdf),"application/pdf");
 assert.equal(await tipoArchivo(new Blob(["texto"])) ,null);
});