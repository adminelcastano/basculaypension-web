#!/usr/bin/env node
// Inspección léxica, solo lectura. NO crea ni modifica una base D1 real.
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {resolve,dirname} from "node:path";
export const MODULOS=["agenda","caja","finanzas","turno","personal","compras","avisos","worker","cuentas","finanzas-obligaciones"];
export function inspeccionar(repo=resolve(dirname(fileURLToPath(import.meta.url)),"..")){
  return MODULOS.map(x=>{
    const s=readFileSync(resolve(repo,"src",x+".js"),"utf8");
    const contar=r=>(s.match(r)||[]).length;
    return {modulo:x,crear_tablas:contar(/CREATE TABLE IF NOT EXISTS/g),
      crear_indices:contar(/CREATE INDEX IF NOT EXISTS/g),
      alterar_tablas:contar(/ALTER TABLE/g),
      drop_table:contar(/\bDROP TABLE\b/g),
      banderas_inicializacion:contar(/\blet (?:listo|esquemaListo)\s*=/g)};
  });
}
if(process.argv[1] && fileURLToPath(import.meta.url)===process.argv[1]){
  if(process.argv.length!==2)throw Error("Sin opciones: inspección de fuentes locales únicamente.");
  process.stdout.write(JSON.stringify({tipo:"inspeccion_lexica_no_migracion",modulos:inspeccionar()})+"\n");
}