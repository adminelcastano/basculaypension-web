// QA de facturación QR en Chromium y WebKit: todas las respuestas HTTP son
// interceptadas con archivos de esta rama. Cero llamadas a producción/D1/KV.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chromium, webkit } from "playwright";
const html=readFileSync(new URL("../public/factura/index.html",import.meta.url));
const qrjs=readFileSync(new URL("../public/factura/qr.js",import.meta.url));
const pago='[{"METODO":"EFECTIVO","IMPORTE":"200.00"}]';
const muestras=[
 {servicio:"BASCULA",folio:"A00003",matricula:"QIE6D6CC13",total:"160.00"},
 {servicio:"PENSION",folio:"00003",matricula:"QI29132A1C",total:"200.00"}
];
for(const [nombre,motor] of [["Android Chromium",chromium],["iPhone WebKit",webkit]]){
 const browser=await motor.launch({headless:true});
 try{
  for(const muestra of muestras){
   const p=new URL("https://www.basculaypension.com/factura/");
   p.searchParams.set("MODULO",muestra.servicio);
   p.searchParams.set("FOLIO",muestra.folio);
   p.searchParams.set("MATRICULA",muestra.matricula);
   p.searchParams.set("CLIENTE","QA IMPRESIÓN");
   p.searchParams.set("TARIFA",muestra.total);
   p.searchParams.set("IMPORTE TOTAL",muestra.total);
   p.searchParams.set("FORMATO","G7-SYNTHETIC-EXIT-1");
   p.searchParams.set("PAGOS",pago);
   const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
   const page=await context.newPage(),errors=[];
   let enviados=0;
   page.on("pageerror",e=>errors.push(e.message));
   await page.route("**/*",route=>{
    const req=route.request(),url=new URL(req.url());
    if(req.method()==="POST"){enviados++;return route.fulfill({status:403,body:"Ensayo sin envíos"});}
    if(url.pathname==="/factura/qr.js")return route.fulfill({status:200,contentType:"text/javascript; charset=utf-8",body:qrjs});
    if(url.pathname==="/factura/" || url.pathname==="/factura")return route.fulfill({status:200,contentType:"text/html; charset=utf-8",body:html});
    return route.fulfill({status:404,body:"Recurso fuera del ensayo"});
   });
   try{
    await page.goto(p.href,{waitUntil:"domcontentloaded"});
    assert.equal(await page.locator("#qr-ticket").isVisible(),true);
    assert.equal(await page.locator("#qr-folio").textContent(),muestra.folio);
    assert.equal(await page.locator("#qr-importe").textContent(),"$"+muestra.total);
    assert.equal(await page.locator("#qr-placa").textContent(),muestra.matricula);
    assert.equal(await page.locator('input[name="folio_ticket"]').inputValue(),muestra.folio);
    assert.equal(await page.locator('input[name="servicio"][value="'+muestra.servicio.toLowerCase()+'"]').isChecked(),true);
    assert.equal(await page.locator('[name="forma_pago"]').inputValue(),"","PAGOS del QR no acredita cobro");
    assert.equal(await page.locator('[name="rfc"]').inputValue(),"","Cliente del ticket no es el RFC");
    assert.equal(await page.evaluate(()=>location.search),"","Eliminar datos de URL del historial");
    assert.match(await page.locator("#qr-mensaje").textContent(),/NO verificados/);
    await page.locator("#enviar").click();
    assert.match(await page.locator('[data-err="ticket"]').textContent(),/Adjunta/);
    assert.equal(enviados,0,"No enviar sin foto y datos fiscales");
    assert.deepEqual(errors,[],"Errores de JS en "+nombre);
    await page.locator("#qr-quitar").click();
    assert.equal(await page.locator("#qr-ticket").isVisible(),false);
    console.log("OK "+nombre+" "+muestra.servicio+" "+muestra.folio+" sin envíos");
   }finally{await context.close();}
  }
 }finally{await browser.close();}
}
