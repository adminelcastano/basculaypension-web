import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const source=readFileSync(new URL("../herramientas/aviso-correo.gs",import.meta.url),"utf8");
const body=source.split("function drive(d) {")[1]?.split("\nfunction respuesta(")[0]?.replace(/\n}\s*$/,"");
assert.ok(body);

function ensayo(fallar=false){
  const acciones=[], properties=new Map([["f_01234567-89ab-4cde-8fab-0123456789ab_ine","antiguo"]]);
  const viejo={setTrashed(){acciones.push("archivar-viejo");}};
  const nuevo={getId:()=>"nuevo"};
  const folder={createFile(){acciones.push("crear-nuevo");if(fallar)throw Error("fallo-carga");return nuevo;}};
  const props={getProperty(k){return properties.get(k)||null;},setProperty(k,v){acciones.push("registrar-nuevo");properties.set(k,v);},deleteProperty(k){acciones.push("borrar-indice");properties.delete(k);}};
  const script=new Function("PropertiesService","DriveApp","Utilities","carpetaDePersona","CARPETA_COLABORADORES","CARPETA_EXTERNOS", "return function drive(d){"+body+"\n}");
  const fn=script({getScriptProperties:()=>props},{getFolderById:()=>folder,getFileById:()=>viejo},{base64Decode:()=>new Uint8Array([1]),newBlob:()=>({})},()=>folder,"c","e");
  const d={op:"subir",id:"01234567-89ab-4cde-8fab-0123456789ab",slot:"ine",base64:"AQ==",nombre:"Sintetico"};
  return {run:()=>fn(d),acciones,properties};
}
test("documento: conserva anterior si falla creación del nuevo",()=>{
 const x=ensayo(true);
 assert.throws(x.run,/fallo-carga/);
 assert.deepEqual(x.acciones,["crear-nuevo"]);
 assert.equal(x.properties.get("f_01234567-89ab-4cde-8fab-0123456789ab_ine"),"antiguo");
});
test("documento: registrar nuevo antes de archivar anterior",()=>{
 const x=ensayo();assert.equal(x.run(),"ok-drive");
 assert.deepEqual(x.acciones,["crear-nuevo","registrar-nuevo","archivar-viejo"]);
 assert.equal(x.properties.get("f_01234567-89ab-4cde-8fab-0123456789ab_ine"),"nuevo");
});
