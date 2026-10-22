#!/usr/bin/env node
// Inventario estático reproducible desde un commit inmutable. Solo lectura Git.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
const git = (...args) => execFileSync("git", args, { maxBuffer: 32*1024*1024, timeout: 20000, env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" } });
const hash = b => createHash("sha256").update(b).digest("hex");
export function caracterizar(ruta, blob, data) {
  const fuente = new TextDecoder("utf-8",{fatal:true}).decode(data);
  const lineas = fuente.replace(/\n$/,"").split("\n");
  const candidatos = (re, grupo=1) => [...fuente.matchAll(re)].map(m=>m[grupo]).filter(Boolean);
  return {
    ruta, blob, bytes:data.length, lineas:lineas.length, sha256:hash(data),
    exports_candidatos:candidatos(/\bexport\s+(?:async\s+)?(?:function|const|class|let)\s+([\w$]+)/g),
    imports_candidatos:candidatos(/\bfrom\s+["']([^"']+)["']/g),
    funciones_candidatas:candidatos(/\b(?:async\s+)?function\s+([\w$]+)\s*\(/g),
    rutas_candidatas:candidatos(/["'](\/(?:panel|api|turno|expediente)[^\s"'$]*)["']/g)
  };
}
export function inventario(ref) {
  if (!/^[a-f\d]{40}$/.test(ref)) throw new Error("Se exige commit SHA-40, nunca ramas ni HEAD móvil.");
  if (git("cat-file","-t",ref).toString().trim() !== "commit") throw new Error("La referencia no es commit.");
  const filas=git("ls-tree","-r","-l",ref,"--","src").toString("utf8").trim().split("\n");
  const archivos=[];
  for (const fila of filas) {
    const m=/^100(?:644|755) blob ([a-f\d]{40})\s+(\d+)\t(.+)$/.exec(fila);
    if (!m) continue;
    const ruta=m[3]; if (!/\.(?:js|mjs|html|css)$/.test(ruta)) continue;
    const data=git("cat-file","blob",m[1]);
    if (data.length !== Number(m[2])) throw new Error("Tamaño Git inconsistente: "+ruta);
    archivos.push(caracterizar(ruta,m[1],data));
  }
  if (!archivos.length) throw new Error("No hay fuentes analizables en este commit.");
  return {formato:1,ref,tree:git("rev-parse",ref+"^{tree}").toString().trim(),tipo:"candidatos_lexicos_no_contratos_http",
    advertencia:"No demuestra equivalencia, permisos, respuestas JSON ni reglas de negocio.",
    totales:{archivos:archivos.length,bytes:archivos.reduce((a,x)=>a+x.bytes,0),lineas:archivos.reduce((a,x)=>a+x.lineas,0)},
    archivos};
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
 try {
   const args=process.argv.slice(2);
   if (args.length!==2 || args[0]!=="--ref") throw new Error("Uso: node scripts/refactor-inventario.mjs --ref <SHA40>");
   process.stdout.write(JSON.stringify(inventario(args[1]))+"\n");
 } catch(e){ console.error(e.message); process.exitCode=1; }
}