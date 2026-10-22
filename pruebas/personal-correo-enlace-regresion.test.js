import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
// Ejecuta el generador puro sin importar fotos ni plantillas HTML del Worker.
const modulo = readFileSync(new URL("../src/personal.js", import.meta.url), "utf8");
const SITIO = "https://basculaypension.com";
const plantilla = modulo.match(/export function correoEnlace\(nombre, token, admin, tipoPersona\) \{[\s\S]*?\n\}/)?.[0];
assert.ok(plantilla, "No se encontró correoEnlace");
const nombresDocs = (admin) => ({ ine: admin?.nacionalidad === "Naturalizado" ? "Pasaporte o tarjeta de residente" : "INE", curp: "CURP" });
const escH = s => String(s ?? "").replace(/[&<>"']/g, x => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[x]));
const correoEnlace = new Function("SITIO", "nombresDocs", "DIAS_ALTA", "escH", plantilla.replace(/^export /, "") + "\nreturn correoEnlace;")(
  SITIO, nombresDocs, 14, escH
);

const token = "f".repeat(32); // Identificador ficticio, nunca un token de expediente real.
const enlace = SITIO + "/expediente/" + token;

test("Personal prepara correo para colaborador sin variable soloAcuse inexistente", () => {
  const correo = correoEnlace("Colaborador Ficticio", token, { nacionalidad: "Nacional" }, "colaborador");
  assert.match(correo.asunto, /Tu expediente laboral/);
  assert.match(correo.texto, /Colaborador/);
  assert.ok(correo.html.includes(enlace));
  assert.ok(correo.texto.includes(enlace));
  assert.match(correo.html, /Subir mis documentos/);
  assert.doesNotMatch(correo.html, /Leer y confirmar aviso v1|undefined|href="undefined"/);
  assert.doesNotMatch(correo.html, /<script/i);
});

test("Personal respeta los documentos de colaboradores naturalizados", () => {
  const correo = correoEnlace("Persona Sintética", token, { nacionalidad: "Naturalizado" }, "colaborador");
  assert.ok(correo.html.includes(enlace));
  assert.match(correo.html, /Subir mis documentos/);
  assert.match(correo.texto, /El enlace estará abierto 14 días/);
});

test("El correo de registro externo se puede formar sin consultar expedientes reales", () => {
  const correo = correoEnlace("Persona Sintética", token, {}, "externo");
  assert.ok(correo.html.includes(enlace));
  assert.match(correo.html, /Subir mis documentos/);
  assert.match(correo.texto, /completar tu registro/);
  assert.doesNotMatch(correo.html, /Leer y confirmar aviso v1|undefined/);
});

test("Contrato del correo exige confirmación ok-para y no marca envío anticipadamente", () => {
  const worker = readFileSync(new URL("../src/worker.js", import.meta.url), "utf8");
  const personal = readFileSync(new URL("../src/personal.js", import.meta.url), "utf8");
  const apps = readFileSync(new URL("../herramientas/aviso-correo.gs", import.meta.url), "utf8");
  const funcion = personal.split("export function correoEnlace(")[1].split("// Correos al encargado")[0];
  assert.doesNotMatch(funcion, /\bsoloAcuse\b/);
  assert.match(worker, /if \(cuerpo === "ok-para"\) return;/);
  assert.match(apps, /confirmacion = 'ok-para';/);
  assert.match(apps, /https:\/\/basculaypension\.com\/expediente\//);
  const emisor = personal.split("async function enviarEnlacePorCorreo(")[1].split("// ---------------------------------------------------------------------------")[0];
  assert.ok(emisor.indexOf("await enviar(env,") < emisor.indexOf("UPDATE colaboradores SET correo_enviado"));
  assert.ok(emisor.includes("return { error:"));
});
