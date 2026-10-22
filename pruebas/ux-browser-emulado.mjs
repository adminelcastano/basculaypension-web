// UI real del proyecto, servidor local exclusivamente sintético.
import assert from "node:assert/strict";
import {readFileSync,mkdirSync} from "node:fs";
import {createServer} from "node:http";
import {join} from "node:path";
import {chromium,webkit} from "playwright";
const root=process.cwd(),read=p=>readFileSync(join(root,p),"utf8");
const imports=[...read("src/panel-app.js").matchAll(/import J\w+ from "\.\/panel\/cliente\/([^"]+)";/g)].map(m=>m[1]);
assert.ok(imports.includes("12-submenu.js"));
const js=imports.map(p=>read("src/panel/cliente/"+p)).join("\n;\n");
const html=read("src/panel/pagina.html").replace("{{CSS}}","/panel/app.css").replace("{{JS}}","/panel/app.js");
const css=read("src/panel/estilos.css");
const rjson=(res,obj)=>{res.writeHead(200,{"Content-Type":"application/json"});res.end(JSON.stringify(obj));};
const server=createServer((req,res)=>{
 const p=new URL(req.url,"http://127.0.0.1").pathname;
 if(p==="/panel"){res.writeHead(200,{"Content-Type":"text/html"});return res.end(html);}
 if(p==="/panel/app.css"){res.writeHead(200,{"Content-Type":"text/css"});return res.end(css);}
 if(p==="/panel/app.js"){res.writeHead(200,{"Content-Type":"application/javascript"});return res.end(js);}
 if(p==="/panel/api/finanzas/obligaciones")return rjson(res,{ok:true,obligaciones:[{
   id:"00000000-0000-4000-8000-000000000001",acreedor:"Proveedor ficticio",concepto:"Factura sintética",
   total:150.25,pagado:50,saldo:100.25,estado:"activa",situacion:"pendiente",vencimiento:"2026-11-01",version:1
 }],resumen:{pendiente:100.25,vencido:0,proximos_7:0,proximos_30:100.25,cantidad:1,actualizado:"2026-10-21T12:00:00Z"}});
 if(p.startsWith("/panel/api/"))return rjson(res,{ok:false,error:"API sintética deliberadamente sin operaciones"});
 res.writeHead(404);res.end("No disponible");
});
const devices=[
 ["Windows Chrome","chromium",1440,900,false],
 ["macOS Safari","webkit",1512,982,false],
 ["iPad mini vertical","webkit",744,1133,true],
 ["iPad mini horizontal","webkit",1133,744,true],
 ["iPad 10 vertical","webkit",820,1180,true],
 ["iPad 10 horizontal","webkit",1180,820,true],
 ["iPhone 17 Pro Max representativo","webkit",440,956,true],
 ["Z Fold7 cubierta angosta","chromium",360,848,true],
 ["Z Fold7 desplegado","chromium",768,936,true],
 ["Z Flip7 interior","chromium",412,915,true],
 ["Z Flip7 cubierta compacta","chromium",400,420,true]
];
const browsers={},failures=[];
mkdirSync(join(root,"ux-artifacts"),{recursive:true});
const URLbase=()=> "http://127.0.0.1:"+server.address().port+"/panel";
async function run(d,i){
 const [name,engine,width,height,mobile]=d;
 const browser=browsers[engine] ||= await (engine==="webkit"?webkit:chromium).launch({headless:true});
 const ctx=await browser.newContext({viewport:{width,height},isMobile:mobile,hasTouch:mobile,deviceScaleFactor:mobile?2:1,reducedMotion:"reduce"});
 const page=await ctx.newPage(),errors=[];
 page.setDefaultTimeout(6500);page.setDefaultNavigationTimeout(10000);
 console.log("INICIO "+name+" "+width+"x"+height);
 page.on("pageerror",e=>errors.push(e.message));
 try{
  await page.goto(URLbase()+"#dinero",{waitUntil:"domcontentloaded"});
  await page.waitForSelector('#mod-finanzas .sub-idx [data-ir="bancos"]',{state:"attached",timeout:12000});
  const uno=width<=1200;
  const first=await page.evaluate(()=>({hidden:document.querySelector("#mod-finanzas").hidden,uno:document.querySelector("#mod-finanzas").classList.contains("uno"),index:document.querySelector("#mod-finanzas").classList.contains("en-idx")}));
  assert.equal(first.hidden,false,"DINERO oculto");
  assert.equal(first.uno,uno,"Modo de navegación incorrecto");
  if(uno){
   assert.equal(first.index,true,"No abrió índice");
   await page.locator('#mod-finanzas .sub-idx [data-ir="bancos"]').click();
   await page.waitForFunction(()=>document.querySelector("#mod-finanzas").dataset.activo==="bancos");
   const b=page.locator("#mod-finanzas .sub-volver");
   assert.equal(await b.isVisible(),true,"Botón volver oculto");
   assert.ok((await b.boundingBox()).height>=40,"Volver demasiado pequeño");
   await b.click();
   await page.waitForFunction(()=>document.querySelector("#mod-finanzas").classList.contains("en-idx"));
   await page.locator('#mod-finanzas .sub-idx [data-ir="obligaciones"]').click();
   await page.waitForFunction(()=>document.querySelector("#mod-finanzas").dataset.activo==="obligaciones");
  }else await page.locator('#mod-finanzas .sub-nav [data-ir="obligaciones"]').click();
  await page.waitForSelector("#fb-obligaciones #fin-ob-form",{state:"visible",timeout:12000});
  const result=await page.evaluate(()=>{
   const width=innerWidth,docWidth=document.documentElement.scrollWidth;
   const fields=[...document.querySelectorAll("#fin-ob-form input,#fin-ob-form textarea,#fin-ob-form button")]
     .filter(x=>x.getClientRects().length).map(x=>({name:x.name||x.textContent.trim().slice(0,10),height:Math.round(x.getBoundingClientRect().height)}));
   return {width,docWidth,fields};
  });
  assert.ok(result.docWidth<=result.width+3,"Desbordamiento global "+JSON.stringify(result));
  assert.ok(result.fields.every(x=>x.height>=40),"Control demasiado bajo "+JSON.stringify(result.fields));
  if(uno){
   // Nuevo tab sin historial anterior: reproduce un enlace exterior real.
   const deep=await ctx.newPage();
   deep.setDefaultTimeout(6500);
   try{
    await deep.goto(URLbase()+"#dinero/bancos",{waitUntil:"domcontentloaded"});
    await deep.locator("#mod-finanzas .sub-volver").waitFor({state:"visible"});
    await deep.locator("#mod-finanzas .sub-volver").click();
    await deep.waitForFunction(()=>location.hash==="#dinero"&&document.querySelector("#mod-finanzas").classList.contains("en-idx"));
   }finally{await deep.close();}
  }
  // Rutas de negocio reales: cambio entre CAJA y AGENDA sin doble navegación.
  for(const [mod,dest] of [["caja","transferencias"],["agenda","compras"]]){
   await page.locator('header.bar .modulos button[data-mod="'+mod+'"]').click();
   await page.waitForFunction(id=>!document.querySelector("#mod-"+id).hidden,mod);
   if(uno){
    const tile=page.locator('#mod-'+mod+' .sub-idx [data-ir="'+dest+'"]');
    await tile.waitFor({state:"visible"});
    await tile.click();
    await page.waitForFunction(([m,v])=>document.querySelector("#mod-"+m).dataset.activo===v,[mod,dest]);
    const volver=page.locator("#mod-"+mod+" .sub-volver");
    assert.equal(await volver.isVisible(),true,"Sin regreso al índice de "+mod);
    await volver.click();
    await page.waitForFunction(id=>document.querySelector("#mod-"+id).classList.contains("en-idx"),mod);
   }else{
    const link=page.locator('#mod-'+mod+' .sub-nav [data-ir="'+dest+'"]');
    await link.focus();
    await link.press("Enter");
    assert.equal(await link.getAttribute("aria-current"),"true","Teclado sin activar "+mod+"/"+dest);
   }
   const doc=await page.evaluate(()=>({screen:innerWidth,full:document.documentElement.scrollWidth}));
   assert.ok(doc.full<=doc.screen+3,mod+" desborda "+JSON.stringify(doc));
  }
  assert.equal(errors.length,0,"Excepciones del navegador: "+errors.join("; "));
  await page.screenshot({path:join(root,"ux-artifacts",String(i).padStart(2,"0")+"-"+name.replace(/[^a-z0-9]/gi,"-")+".png")});
  console.log("OK "+name+" "+width+"x"+height+" campos="+result.fields.length+" erroresJS="+errors.length);
 }catch(e){
  failures.push(name+": "+e.message);
  console.error("FALLO "+name+" "+e.stack);
  await page.screenshot({path:join(root,"ux-artifacts",String(i).padStart(2,"0")+"-ERROR.png")}).catch(()=>{});
 }finally{await ctx.close();}
}
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
try{for(let i=0;i<devices.length;i++)await run(devices[i],i);}
finally{await Promise.all(Object.values(browsers).map(b=>b.close()));server.close();}
if(failures.length){console.error(failures.join("\n"));process.exitCode=1;}
