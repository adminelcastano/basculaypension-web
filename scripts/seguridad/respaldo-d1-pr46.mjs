// Copia restaurable de D1 SOLO en otra D1 de la misma cuenta.
// Nunca modifica la DB de producción. Datos binarios solo en memoria de runner.
import { createHash } from "node:crypto";
const ACCOUNT="ff18e14a20fef8a9c6e49eb88f19cf46";
const SOURCE="665db15f-b688-4d34-9632-a264a8fe9637";
const TOKEN=process.env.CLOUDFLARE_D1_BACKUP_TOKEN||process.env.CLOUDFLARE_API_TOKEN;
const RUN=String(process.env.GITHUB_RUN_ID||"local");
if(!TOKEN||!/^[0-9]+$/.test(RUN))throw new Error("Falta token de D1 o identificador de Actions");
const base="https://api.cloudflare.com/client/v4/accounts/"+ACCOUNT;
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const query=async(path,body,method="POST")=>{
 const response=await fetch(base+path,{method,headers:{Authorization:"Bearer "+TOKEN,"Content-Type":"application/json"},
   ...(body!==undefined?{body:JSON.stringify(body)}:{})});
 let payload;try{payload=await response.json();}catch{throw new Error("Respuesta Cloudflare no JSON, fase "+path.split("/").at(-1));}
 if(!response.ok||!payload.success)throw new Error("Cloudflare "+method+" "+path.split("/").at(-1)+
   " HTTP "+response.status+" (códigos "+(payload.errors||[]).map(e=>e.code).join(",")+")");
 return payload.result;
};
const sourceMeta=await query("/d1/database/"+SOURCE,undefined,"GET");
if(sourceMeta?.uuid!==SOURCE)throw new Error("D1 de origen inesperada");
console.log("Origen: D1 productiva identificada (solo lectura)");
const endpoint="/d1/database/"+SOURCE+"/export";
const first=await query(endpoint,{output_format:"polling"});
if(!first?.at_bookmark)throw new Error("Cloudflare no dio bookmark de exportación");
let progress=first,location;
for(let i=0;i<35;i++){
 if(progress.status==="complete"&&progress.result?.signed_url){location=progress.result.signed_url;break;}
 if(progress.status==="error"||progress.success===false)throw new Error("Falló exportación D1");
 await pause(1200);
 progress=await query(endpoint,{output_format:"polling",current_bookmark:first.at_bookmark});
}
if(!location)throw new Error("Exportación no terminada: no se creó base destino");
const download=await fetch(location);
if(!download.ok)throw new Error("No se pudo descargar exportación D1; HTTP "+download.status);
const data=Buffer.from(await download.arrayBuffer());
if(data.length<1024)throw new Error("Exportación inesperadamente pequeña; se aborta sin crear respaldo");
const checksum=createHash("md5").update(data).digest("hex");
console.log("Exportación D1 recibida en memoria: "+data.length+" bytes");
const name="castano-respaldo-pr46-20261022-"+RUN;
const created=await query("/d1/database",{name});
if(!created?.uuid||created.uuid===SOURCE)throw new Error("ID de copia inexistente o igual a producción");
const destination=created.uuid;
console.log("Copia aislada creada: "+name+" ("+destination+")");
const importPath="/d1/database/"+destination+"/import";
const init=await query(importPath,{action:"init",etag:checksum});
const upload=init?.result||init;
if(!upload?.upload_url||!upload?.filename)
 throw new Error("Import init no dio upload_url/filename, campos: "+Object.keys(upload||{}).join(","));
const sent=await fetch(upload.upload_url,{method:"PUT",body:data});
if(!sent.ok)throw new Error("Carga del respaldo falló; HTTP "+sent.status);
console.log("Exportación transferida a copia aislada, sin registrar contenido");
let job=await query(importPath,{action:"ingest",etag:checksum,filename:upload.filename});
for(let i=0;i<70&&job?.status!=="complete";i++){
 if(job?.status==="error"||job?.success===false)throw new Error("Falló importación D1");
 const bookmark=job?.at_bookmark||job?.current_bookmark;
 if(!bookmark)throw new Error("Importación no devolvió bookmark; status "+job?.status);
 await pause(1200);
 job=await query(importPath,{action:"poll",current_bookmark:bookmark});
}
if(job?.status!=="complete")throw new Error("Importación sin estado completo");
const sql=async(id,statement)=>{
 const result=await query("/d1/database/"+id+"/query",{sql:statement});
 const first=Array.isArray(result)?result[0]:result;
 return first?.results||[];
};
const check=await sql(destination,"PRAGMA quick_check;");
if(!check.some(r=>Object.values(r).includes("ok")))throw new Error("PRAGMA quick_check no confirmó integridad");
const sourceSchema=await sql(SOURCE,"SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%';");
const backupSchema=await sql(destination,"SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%';");
const left=Number(sourceSchema[0]?.n||0),right=Number(backupSchema[0]?.n||0);
if(!right||right!==left)throw new Error("La copia aislada no coincide con el esquema del origen");
console.log("RESTAURACIÓN COMPROBADA: "+right+" tablas, PRAGMA quick_check=ok");
console.log("Respaldo completo y aislado: "+name+" UUID="+destination);
console.log("Datos nunca guardados como artefacto ni impresos en Actions.");
