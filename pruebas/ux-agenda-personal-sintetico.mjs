// Navegación y renderizado de Agenda + Personal con registros sintéticos reales en estructura.
// Servidor local: no usa Cloudflare, no carga expedientes ni modifica D1 productiva.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { chromium, webkit } from "playwright";
const root=process.cwd(), read=p=>readFileSync(join(root,p),"utf8");
const names=[...read("src/panel-app.js").matchAll(/import J\w+ from "\.\/panel\/cliente\/([^"]+)";/g)].map(m=>m[1]);
const js=names.map(n=>read("src/panel/cliente/"+n)).join("\n;\n");
const html=read("src/panel/pagina.html").replace("{{CSS}}","/panel/app.css").replace("{{JS}}","/panel/app.js");
const css=read("src/panel/estilos.css")+read("src/panel/estilos-navegacion.css");
const fecha="2026-10-22";
const normal={ok:true,items:[
 {id:"c1",tipo:"compra",titulo:"Papel térmico sintético",estado:"pendiente",lugar:"",prioridad:"normal",creado:"2026-10-22T10:00:00Z",categoria:""},
 {id:"c2",tipo:"compra",titulo:"Refacción sintética",estado:"comprado",lugar:"",gasto_id:"g2",dia_gasto:"2026-10-21",monto_gasto:350,importe:350,cerrado:"2026-10-21T14:00:00Z"},
 {id:"t1",tipo:"tarea",titulo:"Revisar equipo sintético",estado:"pendiente",fecha,prioridad:"normal",creado:"2026-10-22T10:00:00Z"},
 {id:"i1",tipo:"incidencia",titulo:"Incidencia sintética",estado:"pendiente",fecha,gravedad:"leve",prioridad:"normal",creado:"2026-10-22T10:00:00Z"}
],hoy:fecha,pagos_hechos:[{id:"ph1",titulo:"Pago sintético",fecha,importe:125.25,forma:"EFECTIVO",categoria:"",nota:"",comprobante:null}],
 meses_abiertos:["2026-10"],categorias:[],cuentas:[],frecuencias:{mensual:"Mensual"},lugares:[],
 memoria_compras:[{norm:"papel termico sintetico",titulo:"Papel térmico sintético",veces:3,
 precio:{importe:120.5,fecha:"2026-10-20"},ultimo:{lugar:"",cantidad:"1 caja"}}],
 abiertos:{tarea:1,incidencia:1,aviso:0},avisos_sin_leer:0};
const persona={id:"12345678-1234-4234-8234-123456789012",folio:"COL-001",tipo:"colaborador",
 nombre:"Colaborador de ensayo",telefono:"",puesto:"Báscula",estatus:"activo",entregados:2,total:6,completo:false,llenado_en:null};
const externo={...persona,id:"22345678-1234-4234-8234-123456789012",folio:"EXT-001",tipo:"externo",nombre:"Externo de ensayo",puesto:"",actividad:"Mantenimiento"};
const conteos={colaborador:1,externo:1,activo:1,inactivo:0,todos:1,incompletos:1,completos:0};
const json=(res,value)=>{res.writeHead(200,{"Content-Type":"application/json","Cache-Control":"no-store"});res.end(JSON.stringify(value));};
const server=createServer((req,res)=>{
 const url=new URL(req.url,"http://127.0.0.1"),p=url.pathname;
 if(p==="/panel"){res.writeHead(200,{"Content-Type":"text/html"});return res.end(html);}
 if(p==="/panel/app.css"){res.writeHead(200,{"Content-Type":"text/css"});return res.end(css);}
 if(p==="/panel/app.js"){res.writeHead(200,{"Content-Type":"application/javascript"});return res.end(js);}
 if(p==="/panel/api/agenda")return json(res,normal);
 if(p==="/panel/api/agenda/avisos-feed")return json(res,{ok:true,items:[],cursor:"",mas:false});
 if(p==="/panel/api/colaboradores")return json(res,{ok:true,colaboradores:url.searchParams.get("tipo")==="externo"?[externo]:[persona],conteos,config:{drive:false}});
 if(p==="/panel/api/colaboradores/campanas")return json(res,{ok:true,campanas:[],hoy:fecha,documentos:[]});
 if(p==="/panel/api/turno/vinculos")return json(res,{ok:true,vinculos:{}});
 if(p==="/panel/api/turno")return json(res,{ok:true,personas:[]});
 if(p==="/panel/api/yo")return json(res,{ok:true,email:"ensayo@ejemplo.invalid"});
 if(p==="/panel/api/perfil-admin")return json(res,{ok:true,perfil:{nombre:"Administración",acento:"amarillo",letra:"normal"}});
 if(p.startsWith("/panel/api/"))return json(res,{ok:false,error:"No disponible en ensayo"});
 res.writeHead(404);res.end("Sólo prueba sintética");
});
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
const base="http://127.0.0.1:"+server.address().port+"/panel";
try {
 for(const [name,engine,size] of [["Chromium escritorio",chromium,{width:1440,height:900}],["WebKit móvil",webkit,{width:390,height:844}]]){
   const browser=await engine.launch({headless:true});
   const ctx=await browser.newContext({viewport:size,isMobile:size.width<500,hasTouch:size.width<500,reducedMotion:"reduce"});
   const page=await ctx.newPage(),errors=[];
   page.on("pageerror",e=>errors.push(e.message));
   try {
     await page.goto(base+"#agenda/calendario",{waitUntil:"domcontentloaded"});
     await page.waitForFunction(()=>document.querySelector("#ab-calendario").textContent.includes("Pago sintético"),{timeout:12000});
     assert.equal(await page.locator("#ag-error").count(),0,"Error Agenda calendario");
     const textoCal=await page.locator("#ab-calendario").innerText();
     assert.match(textoCal,/Pago sintético/);
     await page.evaluate(()=>window.irA("agenda",{historia:"push",vista:"compras"}));
     await page.waitForFunction(()=>document.querySelector("#pg-comp").textContent.includes("Papel térmico sintético"));
     const textoCompras=await page.locator("#pg-comp").innerText();
     assert.match(textoCompras,/Última vez/);
     assert.match(await page.locator("#pg-comp").textContent(),/Refacción sintética/);
     assert.equal(await page.locator("#ag-error").count(),0,"Error Agenda compras");
     await page.evaluate(()=>window.irA("agenda",{historia:"push",vista:"tarea"}));
     assert.match(await page.locator("#ab-tarea").innerText(),/Revisar equipo sintético/);
     await page.evaluate(()=>window.irA("agenda",{historia:"push",vista:"incidencia"}));
     assert.match(await page.locator("#ab-incidencia").innerText(),/Incidencia sintética/);
     await page.evaluate(()=>window.irA("agenda",{historia:"push",vista:"aviso"}));
     await page.waitForFunction(()=>document.querySelector("#ab-aviso").textContent.includes("Nueva publicación"));
     await page.evaluate(()=>window.irA("personal",{historia:"push",vista:"colaborador"}));
     await page.waitForFunction(()=>document.querySelector("#p-lista").textContent.includes("Colaborador de ensayo"),{timeout:12000});
     const t=await page.locator("#p-lista").innerText();
     assert.match(t,/Externo de ensayo/);
     assert.match(t,/Campañas/);
     assert.doesNotMatch(t,/No se pudo cargar/);
     assert.equal(errors.length,0,"Errores JS: "+errors.join("; "));
     console.log("OK "+name+": calendario, pagos, compras, tareas, incidencias, Castagram y Personal");
   }finally{await ctx.close();await browser.close();}
 }
}finally{server.close();}
