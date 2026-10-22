import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
test("Transferencias de clientes solo en CAJA y API preservada",()=>{
 const html=read("src/panel/pagina.html");
 const caja=html.split('id="mod-caja"')[1].split('id="mod-finanzas"')[0];
 const din=html.split('id="mod-finanzas"')[1].split('id="mod-agenda"')[0];
 assert.ok(caja.includes('data-bloque="transferencias"')&&caja.includes('id="fb-transf"'));
 assert.ok(!din.includes('id="fb-transf"'));
 assert.equal((html.match(/id="fb-transf"/g)||[]).length,1);
 const fin=read("src/panel/cliente/05-finanzas.js");
 assert.ok(fin.includes('post("caja/transferencias"'));
 assert.ok(fin.includes('EC.bloqueN("caja", "transferencias"'));
 assert.ok(fin.includes('e.detail === "caja"'));
 const base=read("src/panel/cliente/00-base.js");
 assert.ok(base.includes('h === "dinero/transferencias"'));
});
