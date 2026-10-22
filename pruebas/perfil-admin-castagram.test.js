import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const code = readFileSync(new URL("../src/perfil-admin.js", import.meta.url), "utf8");
const worker = readFileSync(new URL("../src/worker.js", import.meta.url), "utf8") + "\n" + readFileSync(new URL("../src/worker-panel-rutas.js", import.meta.url), "utf8");
const turno = readFileSync(new URL("../src/turno.js", import.meta.url), "utf8");
const panel = readFileSync(new URL("../src/panel/cliente/00-perfil-admin.js", import.meta.url), "utf8");
const app = readFileSync(new URL("../src/panel-app.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../src/panel/pagina.html", import.meta.url), "utf8");
const css = readFileSync(new URL("../src/panel/estilos.css", import.meta.url), "utf8");
const agenda = readFileSync(new URL("../src/panel/cliente/07-agenda.js", import.meta.url), "utf8") + "\n" + readFileSync(new URL("../src/panel/cliente/07-castagram-controlador.js", import.meta.url), "utf8");
const routines = new Function(code.replace(/^export /gm, "") +
  "\nreturn {leerPerfilAdmin, servirFotoAdmin, rutaPerfilAdmin};")();

function entorno() {
  const storage = new Map();
  const env = { FILES: {
    async get(k, opts = {}) {
      const value = storage.get(k) ?? null;
      if (opts.type === "json" && typeof value === "string") return JSON.parse(value);
      return value;
    },
    async put(k, v) { storage.set(k, v); },
    async delete(k) { storage.delete(k); }
  }};
  const post = async (body, accion = "") => {
    const request = new Request("https://preview.example/panel/api/perfil-admin" + (accion ? "/"+accion:""), {
      method:"POST", headers:{"Content-Type":"application/json"},
      body:JSON.stringify(body)
    });
    const r = await routines.rutaPerfilAdmin(request, env, accion);
    return { status:r.status, json:await r.json() };
  };
  return { env, storage, post };
}

test("Por defecto muestra Administración y el logotipo sin escribir datos", async () => {
  const { env, storage } = entorno();
  const p = await routines.leerPerfilAdmin(env);
  assert.equal(p.nombre,"Administración");
  assert.equal(p.acento,"amarillo");
  assert.equal(p.letra,"normal");
  assert.equal(p.foto_url,"/img/logo.png");
  assert.equal(storage.size,0);
});

test("El nombre, color y tamaño se conservan en KV y sobreviven a otra lectura", async () => {
  const { env,post,storage } = entorno();
  const resultado = await post({nombre:"Mi perfil",acento:"azul",letra:"muy-grande"});
  assert.equal(resultado.status,200);
  assert.equal(resultado.json.perfil.nombre,"Mi perfil");
  assert.equal((await routines.leerPerfilAdmin(env)).letra,"muy-grande");
  assert.equal((await routines.leerPerfilAdmin(env)).acento,"azul");
  assert.ok(storage.has("panel:perfil-admin:v1"));
});

test("Las entradas no válidas no cambian preferencias ni admiten nombres HTML sin ejecutar código", async () => {
  const {env,post} = entorno();
  assert.equal((await post({nombre:"",acento:"amarillo",letra:"normal"})).status,422);
  assert.equal((await post({nombre:"Admin",acento:"cualquier",letra:"normal"})).status,422);
  assert.equal((await post({nombre:"Admin",acento:"amarillo",letra:"enorme"})).status,422);
  assert.equal((await routines.leerPerfilAdmin(env)).nombre,"Administración");
  assert.match(panel,/\.textContent = p\.nombre/);
});

test("La fotografía JPEG comprimida se puede guardar, consultar y quitar de forma separada", async () => {
  const {env,post,storage} = entorno();
  const jpg = Buffer.from([255,216,255,...new Array(510).fill(0)]);
  const r = await post({nombre:"Administración",acento:"naranja",letra:"grande",
    foto:"data:image/jpeg;base64,"+jpg.toString("base64")});
  assert.equal(r.status,200);
  assert.ok(r.json.perfil.foto_ver);
  assert.ok(storage.has("panel:perfil-admin:foto"));
  const photo = await routines.servirFotoAdmin(env);
  assert.equal(photo.status,200);
  assert.equal(photo.headers.get("Content-Type"),"image/jpeg");
  assert.equal(photo.headers.get("Cache-Control"),"private, no-store");
  assert.equal((await photo.arrayBuffer()).byteLength,jpg.byteLength);
  const fuera = await post({nombre:"Administración",acento:"amarillo",letra:"normal",foto:""});
  assert.equal(fuera.status,200);
  assert.equal(fuera.json.perfil.foto_url,"/img/logo.png");
  assert.equal(storage.has("panel:perfil-admin:foto"),false);
});

test("Rechaza formatos falsos o fotografías demasiado grandes", async () => {
  const {env,post,storage} = entorno();
  const fake=Buffer.from([80,78,71,...new Array(510).fill(0)]).toString("base64");
  assert.equal((await post({nombre:"Admin",acento:"azul",letra:"normal",foto:"data:image/jpeg;base64,"+fake})).status,422);
  assert.equal((await post({nombre:"Admin",acento:"azul",letra:"normal",foto:"data:text/html;base64,PHNjcmlwdD4="})).status,422);
  assert.equal(storage.size,0);
  assert.equal((await routines.leerPerfilAdmin(env)).foto_url,"/img/logo.png");
});

test("El perfil sólo entra por las rutas ya autenticadas de Panel y Turno", () => {
  assert.match(worker,/const usuario = await verificarAcceso\(request, env\)/);
  assert.match(worker,/if \(usuario\.error\)/);
  assert.match(worker,/if \(partes\[0\] === "perfil-admin"\) return await rutaPerfilAdmin/);
  assert.match(worker,/request\.headers\.get\("X-Panel"\) !== "1"/);
  assert.match(turno,/if \(clave === "ADMIN"\) return servirFotoAdmin\(env\)/);
  assert.match(turno,/admin_perfil: await leerPerfilAdmin\(env\)/);
  assert.match(turno,/const acceso = await h\.verificarAcceso\(request, env, "turno"\)/);
  assert.doesNotMatch(worker,/INSERT INTO turno_acuses/);
});

test("El panel y CASTAGRAM utilizan el mismo perfil e imagen", () => {
  assert.match(app,/import J00P from "\.\/panel\/cliente\/00-perfil-admin\.js"/);
  assert.match(app,/J00, J00P, J01/);
  assert.match(html,/id="perfil-admin-dialog"/);
  assert.match(html,/id="perfil-admin-cabecera-foto"/);
  assert.match(panel,/api\("perfil-admin"\)/);
  assert.match(panel,/EC\.nombreAdmin =/);
  assert.match(agenda,/EC\.nombreAdmin\?\.\(\)/);
  assert.match(css,/:root\[data-admin-acento="azul"\]/);
  assert.match(css,/:root\[data-admin-letra="muy-grande"\]/);
  assert.doesNotThrow(() => new Function(panel));
});
