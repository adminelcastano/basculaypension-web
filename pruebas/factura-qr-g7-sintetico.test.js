import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { folioTicketValido, normalizarFolioTicket, claveTicket } from "../src/facturacion-reglas.js";

const source=readFileSync(new URL("../public/factura/qr.js",import.meta.url),"utf8");
const page=readFileSync(new URL("../public/factura/index.html",import.meta.url),"utf8");
const worker=readFileSync(new URL("../src/worker.js",import.meta.url),"utf8");
const config=readFileSync(new URL("../public/_headers",import.meta.url),"utf8");
const env={ window:{}, URL };
vm.runInNewContext(source,env);
const {leerUrlQR,notaRevision}=env.window.CastaTicketQR;

// Textos decodificados de comprobantes QA/SINTÉTICO recibidos el 24 oct 2026.
// Son datos ficticios; nunca contienen RFC, credenciales ni tokens reales.
const params = (modulo,folio,importe,caseid) => {
 const u=new URL("https://www.basculaypension.com/factura/");
 const p=u.searchParams;p.set("CASO",modulo==="BASCULA"?"4":"1");p.set("RUN","2");
 p.set("MODULO",modulo);p.set("FOLIO",folio);
 p.set("MATRICULA",modulo==="BASCULA"?"QIE6D6CC13":"QI29132A1C");
 p.set("CLIENTE","QA IMPRESIÓN");p.set("TARIFA",importe);
 p.set("IMPORTE TOTAL",importe);p.set("BANK_CASE_ID",caseid);
 p.set("AVISO","QA / SINTETICO");p.set("FORMATO","G7-SYNTHETIC-EXIT-1");
 p.set("PAGOS",JSON.stringify([{METODO:"EFECTIVO",IMPORTE:importe}]));
 return u;
};
const bascula=params("BASCULA","A00003","160.00","IMPRESION-C35A7FCC5E");
const pension=params("PENSION","00003","200.00","IMPRESION-5BAD93EE4D");

test("QR báscula: folio alfanumérico, matrícula, servicio e importe declarativo",()=>{
 const q=leerUrlQR(bascula.href);
 assert.equal(q.ok,true);assert.equal(q.servicio,"bascula");assert.equal(q.folio,"A00003");
 assert.equal(q.matricula,"QIE6D6CC13");assert.equal(q.cliente,"QA IMPRESIÓN");
 assert.equal(q.importe,"160.00");assert.equal(q.tarifa,"160.00");
 assert.equal(q.pagoConfirmado,false);
 assert.match(notaRevision(q),/PAGO NO ACREDITADO/);
 assert.doesNotMatch(notaRevision(q),/BANK_CASE_ID|IMPRESION-C35A7FCC5E/);
});

test("QR pensión: PAGOS=200 no implica pagado: ticket físico indica saldo pendiente",()=>{
 const q=leerUrlQR(pension.href);
 assert.equal(q.ok,true);assert.equal(q.servicio,"pension");
 assert.equal(q.folio,"00003");assert.equal(q.importe,"200.00");
 assert.equal(q.pagoConfirmado,false);
 assert.match(notaRevision(q),/PAGO NO ACREDITADO/);
 assert.notEqual(q.cliente,"","Cliente del ticket visible como dato no fiscal");
});

test("QR sintético no autoriza enlaces ajenos, duplicados ni importes hostiles",()=>{
 const evil=[
  pension.href.replace("https://","http://"),
  pension.href.replace("www.basculaypension.com","basculaypension.example"),
  pension.href.replace("/factura/","/panel/"),
  pension.href+"&FOLIO=00004",
  pension.href.replace("FORMATO=G7-SYNTHETIC-EXIT-1","FORMATO=DESCONOCIDO"),
  pension.href.replace("IMPORTE+TOTAL=200.00","IMPORTE+TOTAL=NaN"),
  pension.href.replace("IMPORTE+TOTAL=200.00","IMPORTE+TOTAL=-200.00"),
  pension.href.replace("MODULO=PENSION","MODULO=ADMIN"),
  pension.href.replace("FOLIO=00003","FOLIO=ABC1234"),
  pension.href.replace("MATRICULA=QI29132A1C","MATRICULA=%3Cscript%3E"),
  pension.href+"&PAGOS=duplicado"
 ];
 for(const input of evil){assert.equal(leerUrlQR(input).ok,false,input.slice(0,170));}
 assert.equal(leerUrlQR("https://basculaypension.com/factura/").sinQr,true);
 assert.equal(leerUrlQR("x".repeat(4100)).ok,false);
});

test("Formulario integra QR pero exige ticket, correo, CSF o datos fiscales y forma de pago",()=>{
 assert.match(page,/src="\/factura\/qr.js"/);
 assert.match(page,/precargarQR\(\)/);
 assert.match(page,/form\.folio_ticket\.value = qr\.folio/);
 assert.match(page,/radio\.checked = true/);
 assert.match(page,/history\.replaceState\(history\.state, "", location\.pathname \+ location\.hash\)/);
 assert.match(page,/datos\.append\("comentario",/);
 assert.match(page,/notaRevision\(qrActual\)/);
 assert.match(page,/if \(!archivos\.ticket\) e\.ticket/);
 assert.match(page,/if \(!form\.forma_pago\.value\) e\.forma_pago/);
 assert.match(page,/if \(!RE_EMAIL\.test\(form\.email\.value\.trim\(\)\)\) e\.email/);
 assert.match(page,/if \(modo\(\) === "csf" && !archivos\.csf\)/);
 assert.match(worker,/const errTicket = validarArchivo\(ticket, tipoTicket, true,/);
 assert.match(worker,/if \(!USOS\[uso\]\)/);
 assert.match(config,/\/factura\/\*\s+Cache-Control: no-store\s+Referrer-Policy: no-referrer/);
});

test("Folios numéricos antiguos no cambian; sólo prefijo A adicional para báscula",()=>{
 assert.equal(folioTicketValido("A00003"),true);
 assert.equal(folioTicketValido("a00003"),true);
 assert.equal(normalizarFolioTicket("a-00003"),"A00003");
 assert.equal(folioTicketValido("00003"),true);
 assert.equal(folioTicketValido("00003")&&folioTicketValido("A00003"),true);
 assert.equal(claveTicket("bascula","A00003"),"bascula:A00003");
 assert.equal(claveTicket("pension","00003"),"pension:00003");
 assert.equal(folioTicketValido("ABC17097"),false);
 assert.equal(folioTicketValido("AB00003"),false);
 assert.equal(folioTicketValido("A"),false);
 assert.equal(folioTicketValido("123x"),false);
 const adm=readFileSync(new URL("../src/panel/cliente/01-facturacion.js",import.meta.url),"utf8");
 assert.match(adm,/\(\?:\\d\+\|A\\d\+\)/);
});
