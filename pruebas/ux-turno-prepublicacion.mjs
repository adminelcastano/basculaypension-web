// Revisión prepublicación de Turno con navegador real, exclusivamente sintético.
// Comprueba montaje HTML/CSS, selección del encargado, PIN rechazado y limpieza
// de datos legados al recargar una tablet compartida; no consulta Cloudflare/D1/KV.
import assert from "node:assert/strict";
import {readFileSync,mkdirSync} from "node:fs";
import {createServer} from "node:http";
import {join} from "node:path";
import {chromium,webkit} from "playwright";

const root=process.cwd();
const leer=p=>readFileSync(join(root,p),"utf8");
const agenda=leer("src/panel/cliente/07-agenda.js");
const inicio=agenda.indexOf("// <interpretar>"),fin=agenda.indexOf("// </interpretar>");
assert.ok(inicio>=0 && fin>inicio,"La tablet necesita el intérprete de Agenda");
const css=leer("src/turno-estilos.css");
const plantilla=leer("src/turno.html");
assert.equal((plantilla.match(/\/\*__TURNO_CSS__\*\//g)||[]).length,1);
assert.equal((plantilla.match(/\/\*__INTERPRETAR__\*\//g)||[]).length,1);
const html=plantilla.replace("/*__INTERPRETAR__*/",agenda.slice(inicio,fin))
  .replace("/*__TURNO_CSS__*/",css);
assert.ok(html.includes("--bg: #000"));
assert.ok(!html.includes("__TURNO_CSS__")&&!html.includes("__INTERPRETAR__"));
const respuesta=(res,status,body)=>{
  res.writeHead(status,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"});
  res.end(JSON.stringify(body));
};
const consultas=[];
const servidor=createServer((req,res)=>{
  const ruta=new URL(req.url,"http://127.0.0.1").pathname;
  if(ruta==="/turno"){
    res.writeHead(200,{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store"});
    return res.end(html);
  }
  if(ruta==="/turno/api/estado")return respuesta(res,401,{ok:false,error:"Sesión sintética terminada",sesion:false});
  if(ruta==="/turno/api/personas")return respuesta(res,200,{
    ok:true,sugerido:"MAÑANA",abierto:null,turnos:["MAÑANA","TARDE","NOCHE"],
    personas:[{clave:"ENSAYO",nombre:"Encargado ficticio",tiene_pin:true,avatar_url:null}]
  });
  if(ruta==="/turno/api/entrar"){
    consultas.push({ruta,metodo:req.method});
    return respuesta(res,401,{ok:false,error:"PIN incorrecto sintético",bloqueado:false});
  }
  if(ruta.startsWith("/turno/api/"))return respuesta(res,404,{ok:false,error:"Ruta sintética no disponible"});
  res.writeHead(404,{"Content-Type":"text/plain"});res.end("Recurso ficticio no disponible");
});
await new Promise(ok=>servidor.listen(0,"127.0.0.1",ok));
const origen="http://127.0.0.1:"+servidor.address().port;
const casos=[["Chromium plegable cerrado",chromium,360,848],["WebKit iPad vertical",webkit,820,1180]];
mkdirSync(join(root,"ux-artifacts"),{recursive:true});
try{
 for(const [nombre,motor,ancho,alto] of casos){
  const browser=await motor.launch({headless:true});
  try{
   const context=await browser.newContext({viewport:{width:ancho,height:alto},
      isMobile:true,hasTouch:true,serviceWorkers:"block",reducedMotion:"reduce"});
   const pagina=await context.newPage(),errores=[];
   pagina.on("pageerror",e=>errores.push(e.message));
   pagina.setDefaultTimeout(10000);
   await pagina.goto(origen+"/turno",{waitUntil:"domcontentloaded"});
   await pagina.locator('#personas .persona[data-clave="ENSAYO"]').waitFor({state:"visible"});
   const estilos=await pagina.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue("--bg").trim());
   assert.equal(estilos,"#000",nombre+" no recibió el CSS de Turno");
   assert.equal(await pagina.locator("#entrada").isVisible(),true);
   assert.equal(await pagina.locator("#app").isVisible(),false);
   await pagina.locator('#personas .persona[data-clave="ENSAYO"]').click();
   await pagina.locator("#paso-pin").waitFor({state:"visible"});
   for(const n of ["1","2","3","4"]) await pagina.locator('#teclado button[data-k="'+n+'"]').click();
   await pagina.locator("#err-pin").getByText("PIN incorrecto sintético").waitFor();
   assert.equal(await pagina.locator("#app").isVisible(),false,"Un PIN rechazado abrió contenido privado");
   // Una tablet compartida no puede rehidratar el estado de otro encargado.
   await pagina.evaluate(()=>localStorage.setItem("turno:estado",JSON.stringify({persona:"OTRO",privado:"NO-REHIDRATAR"})));
   await pagina.reload({waitUntil:"domcontentloaded"});
   await pagina.locator('#personas .persona[data-clave="ENSAYO"]').waitFor({state:"visible"});
   const legado=await pagina.evaluate(()=>localStorage.getItem("turno:estado"));
   assert.ok(!legado||!legado.includes("NO-REHIDRATAR"),"Se conservó contenido privado legado");
   assert.equal(await pagina.locator("#app").isVisible(),false);
   assert.equal(errores.length,0,nombre+": errores JS: "+errores.join(" | "));
   const ruta=join(root,"ux-artifacts","turno-"+(motor===chromium?"chromium-fold":"webkit-ipad")+".png");
   await pagina.screenshot({path:ruta});
   console.log("OK TURNO "+nombre+" "+ancho+"x"+alto);
   await context.close();
  }finally{await browser.close();}
 }
 assert.equal(consultas.length,2,"Un solo intento rechazado por dispositivo");
 assert.ok(consultas.every(x=>x.metodo==="POST"));
}finally{servidor.close();}
