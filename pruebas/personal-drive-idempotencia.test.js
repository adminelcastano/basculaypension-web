import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import { webcrypto } from "node:crypto";

const code=readFileSync(new URL("../src/personal.js",import.meta.url),"utf8");
const body=code.split("async function idOperacionDrive(fila, slot, bytes) {")[1]
  ?.split("\n// Sube a Drive")[0]?.replace(/\n}\s*$/,"");
assert.ok(body,"Falta función idempotente en Personal");
const digest=new Function("crypto","TextEncoder","return async function idOperacionDrive(fila,slot,bytes) {"+body+"\n}")(webcrypto,TextEncoder);

test("reintentos idénticos producen la misma marca SHA-256",async()=>{
 const persona={id:"persona-sintetica"};
 const b=new Uint8Array([1,2,3]);
 const primero=await digest(persona,"d:ine",b.buffer);
 const segundo=await digest(persona,"d:ine",b.buffer);
 assert.match(primero,/^[0-9a-f]{64}$/);
 assert.equal(primero,segundo);
});
test("otra versión u otro slot no reutiliza la misma operación",async()=>{
 const persona={id:"persona-sintetica"};
 const a=await digest(persona,"d:ine",new Uint8Array([1,2]).buffer);
 const b=await digest(persona,"d:ine",new Uint8Array([1,3]).buffer);
 const c=await digest(persona,"a:ine",new Uint8Array([1,2]).buffer);
 assert.notEqual(a,b);
 assert.notEqual(a,c);
});
