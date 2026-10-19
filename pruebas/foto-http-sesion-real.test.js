import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { webcrypto } from "node:crypto";
import { permisoFotoTurno } from "../src/foto-acceso-turno.js";

// Extrae el código real del Worker: no duplica ni inventa una implementación de ruta/sesión.
const source = readFileSync(new URL("../src/turno.js", import.meta.url), "utf8");
function extraer(inicio) {
  const a = source.indexOf(inicio);
  assert.ok(a >= 0, "Falta " + inicio);
  const b = source.indexOf("\n}\n", a);
  assert.ok(b > a, "Función incompleta: " + inicio);
  return source.slice(a, b + 3).replace(/^export /, "");
}
const funciones = [
  "async function secreto(env)",
  "async function firmar(env, datos)",
  "async function crearSesion(env, persona, turno, dia)",
  "function leerCookie(cab, nombre)",
  "async function sesionActual(request, env)",
  "export async function turnoRuta(request, env, url, h)"
].map(extraer).join("\n\n");

function entorno() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE turno_personas (
      clave TEXT PRIMARY KEY, nombre TEXT, pin_sal TEXT, activo INTEGER,
      avatar TEXT, avatar_base TEXT, foto_ver TEXT, prefs TEXT, ses_gen INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE agenda_items (id TEXT PRIMARY KEY, tipo TEXT, estado TEXT, autor TEXT, para TEXT, foto TEXT, fotos TEXT);
    CREATE TABLE aviso_comentarios (id TEXT PRIMARY KEY, item_id TEXT, foto TEXT, borrado TEXT);
  `);
  for (const [clave, sal] of [["AUDITA", "aabbccdd-uno"], ["AUDITB", "ddeeffaa-dos"]])
    sqlite.prepare("INSERT INTO turno_personas (clave,nombre,pin_sal,activo,prefs) VALUES (?,?,?,?,?)")
      .run(clave, "Usuario sintético", sal, 1, "{}");
  const foto = "tf:aviso:8f909a35-a0dd-4f9b-9929-c45965c048d0";
  const publicacion = "b514b84a-8acf-4f2c-a4a3-42f45f670a61";
  const para = JSON.stringify({todos:false,admin:true,turnos:[],personas:["AUDITA"]});
  sqlite.prepare("INSERT INTO agenda_items (id,tipo,estado,autor,para,foto,fotos) VALUES (?,?,?,?,?,?,?)")
    .run(publicacion, "aviso", "activo", "admin", para, foto, "[]");
  const db = { prepare(sql) { return { bind(...values) { return {
    async first() { return sqlite.prepare(sql).get(...values) ?? null; }
  }; } }; } };
  const env = { DB: db, FILES: { async get(k) {
    assert.equal(k, "turno:secreto");
    return "secreto-sintetico-aislado-sin-validez-en-cloudflare";
  }}};
  let fotosEntregadas = 0;
  const fn = new Function("permisoFotoTurno", "webcrypto", "env", "notificarFoto", `
    const crypto = webcrypto;
    const TURNOS = ["MAÑANA","TARDE","NOCHE"], SESION_HORAS = 14, AVATARES = {};
    const enc = new TextEncoder();
    const hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2,"0")).join("");
    const b64u = s => btoa(s).replace(/\\+/g,"-").replace(/\\//g,"_").replace(/=+$/,"");
    const deB64u = s => atob(s.replace(/-/g,"+").replace(/_/g,"/"));
    const igual = (a,b) => a.length === b.length && [...a].every((c,i) => c === b[i]);
    const avatarValido = x => x;
    const urlAvatar = () => null;
    const leerPrefs = () => ({});
    let secretoCache = null;
    const json = (v,status=200,extra={}) => new Response(JSON.stringify(v),{
      status,headers:{"Content-Type":"application/json",...extra}
    });
    const cookie = (valor,maxAge) => \`turno_ses=\${valor}; Path=/turno; HttpOnly; Secure; SameSite=Strict; Max-Age=\${maxAge}\`;
    const asegurarEsquemaTurno = async () => {};
    const asegurarEsquemaAvisos = async () => {};
    const servirFoto = async () => {
      notificarFoto();
      return new Response("IMAGEN-SINTETICA",{status:200,headers:{"Cache-Control":"private, max-age=3600"}});
    };
    ${funciones}
    return { crearSesion, turnoRuta };
  `);
  const { crearSesion, turnoRuta } = fn(permisoFotoTurno, webcrypto, env, () => { fotosEntregadas++; });
  const h = {
    verificarAcceso: async () => ({}),
    paginaBloqueada: () => "Acceso bloqueado",
    cabeceras: () => ({}),
    html: ""
  };
  const url = "https://auditoria.example/turno/api/foto/" + encodeURIComponent(foto);
  async function pedir(cadenaCookie = "", verificador = h.verificarAcceso) {
    const req = new Request(url,{headers: cadenaCookie ? {Cookie:"turno_ses="+cadenaCookie}:{ }});
    return turnoRuta(req,env,new URL(url),{...h,verificarAcceso:verificador});
  }
  async function cookieDe(clave) {
    const persona=sqlite.prepare("SELECT * FROM turno_personas WHERE clave=?").get(clave);
    return crearSesion(env,persona,"MAÑANA","2026-10-19");
  }
  return { sqlite, pedir, cookieDe, publicacion, get fotosEntregadas() {return fotosEntregadas;} };
}

test("A-05 HTTP: sesión PIN válida ve foto y recibe no-store",async()=>{
  const s=entorno();
  try{
    const res=await s.pedir(await s.cookieDe("AUDITA"));
    assert.equal(res.status,200);
    assert.equal(res.headers.get("Cache-Control"),"private, no-store");
    assert.equal(await res.text(),"IMAGEN-SINTETICA");
    assert.equal(s.fotosEntregadas,1);
  }finally{s.sqlite.close();}
});

test("A-05 HTTP: otra sesión PIN recibe 404 sin lectura de imagen",async()=>{
  const s=entorno();
  try{
    const res=await s.pedir(await s.cookieDe("AUDITB"));
    assert.equal(res.status,404);
    assert.equal(res.headers.get("Cache-Control"),"private, no-store");
    assert.equal(s.fotosEntregadas,0);
  }finally{s.sqlite.close();}
});

test("A-05 HTTP: sin cookie, sesión revocada y Access denegado son distintos",async()=>{
  const s=entorno();
  try{
    assert.equal((await s.pedir()).status,401);
    const c=await s.cookieDe("AUDITA");
    s.sqlite.prepare("UPDATE turno_personas SET ses_gen=1 WHERE clave='AUDITA'").run();
    assert.equal((await s.pedir(c)).status,401);
    const acceso=await s.pedir("", async()=>({error:"No autorizado",status:403}));
    assert.equal(acceso.status,403);
    assert.equal(s.fotosEntregadas,0);
  }finally{s.sqlite.close();}
});

test("A-05 HTTP: foto archivada niega acceso aun con cookie válida",async()=>{
  const s=entorno();
  try{
    const c=await s.cookieDe("AUDITA");
    s.sqlite.prepare("UPDATE agenda_items SET estado='archivado' WHERE id=?").run(s.publicacion);
    assert.equal((await s.pedir(c)).status,404);
    assert.equal(s.fotosEntregadas,0);
  }finally{s.sqlite.close();}
});
