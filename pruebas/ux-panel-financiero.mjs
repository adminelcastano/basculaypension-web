// Panel Financiero: navegador real + API enteramente ficticia en localhost.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { chromium, webkit } from "playwright";
import { transformarPanelFinanciero } from "../src/panel-financiero.js";

const root=process.cwd(),leer=p=>readFileSync(join(root,p),"utf8");
const fuentes=[...leer("src/panel-app.js").matchAll(/import J\w+ from "\.\/panel\/cliente\/([^"]+)";/g)]
  .map(m=>m[1]);
const js=fuentes.map(p=>leer("src/panel/cliente/"+p)).join("\n;\n");
const html=transformarPanelFinanciero(leer("src/panel/pagina.html")
 .replace("{{CSS}}","/panel/app.css").replace("{{JS}}","/panel/app.js"));
const css=leer("src/panel/estilos.css")+leer("src/panel/estilos-navegacion.css");
const pedidos=[];
const server=createServer((req,res)=>{
 const ruta=new URL(req.url,"http://localhost").pathname;
 if(ruta==="/panel/financiero"){
  res.writeHead(200,{"Content-Type":"text/html; charset=utf-8"});return res.end(html);
 }
 if(ruta==="/panel/app.css"){
  res.writeHead(200,{"Content-Type":"text/css; charset=utf-8"});return res.end(css);
 }
 if(ruta==="/panel/app.js"){
  res.writeHead(200,{"Content-Type":"application/javascript; charset=utf-8"});return res.end(js);
 }
 if(ruta.startsWith("/panel/api/")){
  pedidos.push(ruta);
  let datos={ok:false,error:"Servicio no simulado (sin acceso a datos reales)"};
  if(ruta==="/panel/api/yo") datos={ok:true,email:"finanzas@ejemplo.invalid"};
  if(ruta==="/panel/api/perfil-admin") datos={ok:true,perfil:{nombre:"Administración",acento:"amarillo",letra:"normal"}};
  if(ruta==="/panel/api/turno") datos={ok:true,personas:[]};
  if(ruta==="/panel/api/agenda") datos={
   ok:true,items:[],hoy:"2026-10-22",pagos_hechos:[],meses_abiertos:[],
   categorias:[],cuentas:[],frecuencias:{mensual:"Mensual"},lugares:[],memoria_compras:[],
   abiertos:{tarea:0,incidencia:0,aviso:0},avisos_sin_leer:0
  };
  if(ruta==="/panel/api/finanzas/obligaciones") datos={ok:true,obligaciones:[],resumen:{cantidad:0,pendiente:0,vencido:0}};
  res.writeHead(200,{"Content-Type":"application/json","Cache-Control":"no-store"});
  return res.end(JSON.stringify(datos));
 }
 res.writeHead(404);res.end("Solo contenido ficticio");
});
await new Promise(ok=>server.listen(0,"127.0.0.1",ok));
const base="http://127.0.0.1:"+server.address().port+"/panel/financiero";
try{
 for(const [nombre,motor,width,height] of [
  ["Chromium escritorio",chromium,1440,900],
  ["WebKit teléfono",webkit,390,844]
 ]){
  const b=await motor.launch({headless:true});
  try{
   const c=await b.newContext({viewport:{width,height},isMobile:width<800,hasTouch:width<800,reducedMotion:"reduce"});
   const page=await c.newPage(),errores=[];page.on("pageerror",e=>errores.push(e.message));
   page.setDefaultTimeout(12000);
   await page.goto(base,{waitUntil:"domcontentloaded"});
   await page.waitForFunction(()=>location.hash==="#caja");
   const opciones=await page.locator('header.bar .modulos button[data-mod]').evaluateAll(bs=>bs.map(b=>b.dataset.mod));
   assert.deepEqual(opciones,["caja","dinero","agenda"],"Menú financiero incorrecto");
   assert.equal(await page.locator("#mod-caja").isVisible(),true,"Caja no visible");
   for(const id of ["mod-facturacion","mod-personal","mod-config","mod-inicio"]){
    assert.equal(await page.locator("#"+id).isVisible(),false,id+" aparece en Panel Financiero");
   }
   await page.locator('header.bar .modulos button[data-mod="dinero"]').click();
   await page.waitForFunction(()=>!document.querySelector("#mod-finanzas").hidden);
   assert.equal(await page.locator("#mod-finanzas").isVisible(),true);
   await page.locator('header.bar .modulos button[data-mod="agenda"]').click();
   await page.waitForFunction(()=>!document.querySelector("#mod-agenda").hidden);
   assert.equal(await page.locator('#mod-agenda [data-bloque="compras"]').isVisible(),width>=1200);
   assert.equal(await page.locator('#mod-agenda [data-bloque="aviso"]').isVisible(),false);
   assert.equal(await page.locator('#mod-agenda [data-bloque="tarea"]').isVisible(),false);
   await page.evaluate(()=>window.irA("facturacion",{historia:"push"}));
   await page.waitForFunction(()=>!document.querySelector("#mod-caja").hidden);
   assert.equal(await page.locator("#mod-facturacion").isVisible(),false);
   const scroll=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth}));
   assert.ok(scroll.document<=scroll.viewport+4,"Desborda pantalla: "+JSON.stringify(scroll));
   assert.equal(errores.length,0,"Errores JS "+errores.join("; "));
   console.log("OK PANEL FINANCIERO "+nombre+" "+width+"x"+height+" erroresJS=0");
   await c.close();
  }finally{await b.close();}
 }
 assert.equal(pedidos.filter(p=>p.startsWith("/panel/api/solicitudes")).length,0,"El panel financiero consultó facturas");
 assert.equal(pedidos.filter(p=>p.startsWith("/panel/api/colaboradores")).length,0,"El panel financiero consultó personal");
}finally{server.close();}
