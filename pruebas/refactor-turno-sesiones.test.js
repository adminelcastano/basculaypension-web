import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {execFileSync} from "node:child_process";
import {webcrypto} from "node:crypto";
import {crearSesionesTurno} from "../src/turno-sesion.js";
test("Sesión firmada conserva el bloque original, HttpOnly y SameSite=Strict",()=>{
 const previous=execFileSync("git",["show","c29f61ff8c9369f8722e27f2e1de16a02a74bcc3:src/turno.js"],{encoding:"utf8"});
 const a=previous.indexOf("let secretoCache = null;"),b=previous.indexOf("// ---------------------------------------------------------------------------\n// Fotos (llegan",a);
 const text=readFileSync(new URL("../src/turno-sesion.js",import.meta.url),"utf8");
 assert.ok(a>0&&b>a&&text.includes(previous.slice(a,b)));
 assert.match(text,/HttpOnly; Secure; SameSite=Strict/);
 assert.match(text,/persona\.ses_gen/);
});
test("Sesión cambia al cambiar PIN y al revocarla; no acepta firma alterada",async()=>{
 const enc=new TextEncoder(),hex=b=>[...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,"0")).join("");
 const b64u=s=>btoa(s).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
 const deB64u=s=>atob(s.replace(/-/g,"+").replace(/_/g,"/"));
 const igual=(a,b)=>a.length===b.length && [...a].every((c,i)=>c===b[i]);
 const p={clave:"ENSAYO",nombre:"Persona ficticia",pin_sal:"sal-segura-ficticia",ses_gen:0,activo:1,prefs:"{}"};
 const kv=new Map(),env={FILES:{async get(k){return kv.get(k)||null},async put(k,v){kv.set(k,v)}},
 DB:{prepare(){return{bind(){return{first:async()=>p}}}}}};
 const sec=crearSesionesTurno({crypto:webcrypto,enc,hex,b64u,deB64u,SESION_HORAS:14,igual,
  TURNOS:["MAÑANA","TARDE","NOCHE"],avatarValido:()=>null,AVATARES:{},urlAvatar:()=>null,leerPrefs:()=>({})});
 const token=await sec.crearSesion(env,p,"MAÑANA","2026-10-22");
 const req=(v)=>({headers:{get:()=>sec.cookie(v,86400)}});
 const valid=await sec.sesionActual(req(token),env);
 assert.equal(valid.persona,"ENSAYO");
 assert.equal(valid.turno,"MAÑANA");
 assert.match(sec.cookie(token,10),/HttpOnly; Secure; SameSite=Strict/);
 assert.equal(await sec.sesionActual(req(token+"alterada"),env),null);
 p.ses_gen=1;
 assert.equal(await sec.sesionActual(req(token),env),null);
 p.ses_gen=0;p.pin_sal="nuevo-sal-distinto";
 assert.equal(await sec.sesionActual(req(token),env),null);
});
