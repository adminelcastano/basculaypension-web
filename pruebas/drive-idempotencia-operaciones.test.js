import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const s=readFileSync(new URL("../herramientas/aviso-correo.gs",import.meta.url),"utf8");
const body=s.split("function archivos(d) {")[1]?.split("\n// ---- Reporte mensual")[0]?.replace(/\n}\s*$/,"");
assert.ok(body,"Falta el controlador de archivos");
function preparar({existe=false,falloMarca=false,falloLock=false}={}) {
  const eventos=[];
  const archivoViejo={getId:()=>"drive-existente",getDescription:()=>"castano-operacion-v1:"+"a".repeat(64),isTrashed:()=>false};
  const archivoNuevo={getId:()=>"drive-nuevo",setDescription(){eventos.push("marcar");if(falloMarca)throw Error("error-marca");},setTrashed(){eventos.push("retirar-nuevo");}};
  const carpeta={getFilesByName(){eventos.push("buscar");const l=existe?[archivoViejo]:[];return {hasNext:()=>l.length>0,next:()=>l.shift()};},createFile(){eventos.push("crear");return archivoNuevo;}};
  const lockService={getScriptLock:()=>({
    waitLock(){eventos.push("lock");if(falloLock)throw Error("fallo-lock");},
    releaseLock(){eventos.push("unlock");}
  })};
  const fn=new Function("raizArchivos","subcarpeta","Utilities","hojaMensual","DriveApp","dentroDeRaiz","LockService",
    "return function archivos(d) {"+body+"\n}");
  const archivos=fn(()=>carpeta,()=>carpeta,{base64Decode:()=>new Uint8Array([1]),newBlob:()=>({})},()=>{}, {getFileById:()=>archivoNuevo},()=>true,lockService);
  const peticion={op:"guardar",nombre:"foto-sintetica",operacion:"a".repeat(64),base64:"AQ=="};
  return {run:()=>archivos(peticion),eventos};
}
test("reintento idéntico reutiliza el ID ya guardado sin crear duplicado",()=>{
 const x=preparar({existe:true});
 assert.equal(x.run().id,"drive-existente");
 assert.deepEqual(x.eventos,["lock","buscar","unlock"]);
});
test("subida nueva marca el ID de operación",()=>{
 const x=preparar();
 assert.equal(x.run().id,"drive-nuevo");
 assert.deepEqual(x.eventos,["lock","buscar","crear","marcar","unlock"]);
});
test("fallo de marca retira sólo el archivo nuevo, no uno anterior",()=>{
 const x=preparar({falloMarca:true});
 assert.throws(x.run,/error-marca/);
 assert.deepEqual(x.eventos,["lock","buscar","crear","marcar","retirar-nuevo","unlock"]);
});

test("si no se obtiene el bloqueo, no se crea ni modifica ningún archivo",()=>{
  const x=preparar({falloLock:true});
  assert.throws(x.run,/fallo-lock/);
  assert.deepEqual(x.eventos,["lock"]);
});
