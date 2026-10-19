import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../src/turno.html", import.meta.url), "utf8");
const inicio = html.indexOf("  let enviando = false, colaBloqueada = false;");
const fin = html.indexOf("  function pintarRed() {", inicio);
if (inicio < 0 || fin <= inicio) throw new Error("No se encontró el flujo original de reenvío");

function ensayo(handler, registros = {}) {
  const disco = new Map(Object.entries(registros).map(([p, items]) => [p, structuredClone(items)]));
  const envios = [], avisos = [], pintura = [];
  const identidad = clave => ({ persona: clave, turno: "MAÑANA", dia: "2026-10-19" });
  const f = new Function("disco", "envios", "avisos", "pintura", "handler", "identidad", `
    let E = identidad("ANA");
    const clave = () => E && E.persona;
    const cola = () => structuredClone(disco.get(clave()) || []);
    const guardarCola = l => { disco.set(clave(), structuredClone(l)); return true; };
    const api = async (ruta, datos, opciones) => {
      envios.push({ ruta, datos: structuredClone(datos), persona: E.persona, opciones });
      return handler(ruta, datos, opciones);
    };
    const toast = (mensaje, error) => avisos.push({ mensaje, error: !!error });
    const pintarRed = () => pintura.push({ enviando, colaBloqueada });
    const refrescar = async () => {};
    const sec = () => ({ querySelector: () => null });
    const seccion = "inicio";
    const colaAnterior = () => 0;
    ${html.slice(inicio, fin)}
    return {
      enviarCola,
      cambiar: clave => { E = clave ? identidad(clave) : null; },
      estado: () => ({ enviando, colaBloqueada }),
    };
  `);
  const tablet = f(disco, envios, avisos, pintura, handler, identidad);
  return { ...tablet, disco, envios, avisos, pintura };
}
const item = (id, persona = "ANA") => ({
  persona, turno: "MAÑANA", dia: "2026-10-19",
  ruta: "extras", datos: { uid: id, monto: "12.00" }
});

test("A-08: reenvío FIFO correcto y UID original inalterado", async () => {
  const s = ensayo(async () => ({ ok: true }), { ANA: [item("uid-0001"), item("uid-0002")] });
  await s.enviarCola();
  assert.deepEqual(s.envios.map(x => x.datos.uid), ["uid-0001", "uid-0002"]);
  assert.ok(s.envios.every(x => x.opciones.cola === false));
  assert.deepEqual(s.disco.get("ANA"), []);
  assert.equal(s.estado().colaBloqueada, false);
});

test("A-08: un rechazo conserva el registro y detiene los siguientes", async () => {
  let rechazo = true;
  const s = ensayo(async () => {
    if (rechazo) throw Object.assign(new Error("Registro inválido"), { datos: { ok: false } });
    return { ok: true };
  }, { ANA: [item("uid-0003"), item("uid-0004")] });
  await s.enviarCola();
  assert.deepEqual(s.disco.get("ANA").map(x => x.datos.uid), ["uid-0003", "uid-0004"]);
  assert.deepEqual(s.envios.map(x => x.datos.uid), ["uid-0003"]);
  assert.equal(s.estado().colaBloqueada, true);
  rechazo = false;
  await s.enviarCola();
  assert.deepEqual(s.envios.map(x => x.datos.uid), ["uid-0003", "uid-0003", "uid-0004"]);
  assert.deepEqual(s.disco.get("ANA"), []);
  assert.equal(s.estado().colaBloqueada, false);
});

test("A-08: desconexión conserva pendientes y no cuenta un envío exitoso", async () => {
  const s = ensayo(async () => { throw Object.assign(new Error("Sin red"), { red: true }); },
    { ANA: [item("uid-0005")] });
  await s.enviarCola();
  assert.equal(s.envios.length, 1);
  assert.equal(s.disco.get("ANA")[0].datos.uid, "uid-0005");
});

test("A-08: cambiar de encargado durante una respuesta no altera su cola", async () => {
  let liberar;
  const esperando = new Promise(resolve => { liberar = resolve; });
  const s = ensayo(async () => { await esperando; return { ok: true }; }, {
    ANA: [item("uid-0006")], LUIS: [item("uid-0007", "LUIS")]
  });
  const pend = s.enviarCola();
  await Promise.resolve();
  s.cambiar("LUIS");
  liberar();
  await pend;
  assert.equal(s.disco.get("ANA")[0].datos.uid, "uid-0006");
  assert.equal(s.disco.get("LUIS")[0].datos.uid, "uid-0007");
  await s.enviarCola();
  assert.deepEqual(s.disco.get("LUIS"), []);
  assert.equal(s.disco.get("ANA")[0].datos.uid, "uid-0006");
  assert.equal(s.envios.at(-1).datos.uid, "uid-0007");
});

test("A-08: registro de otra sesión nunca se transmite", async () => {
  const s = ensayo(async () => ({ ok: true }), { ANA: [item("uid-0008", "LUIS")] });
  await s.enviarCola();
  assert.equal(s.envios.length, 0);
  assert.equal(s.disco.get("ANA").length, 1);
  assert.match(s.avisos.at(-1).mensaje, /otra sesión/);
});
