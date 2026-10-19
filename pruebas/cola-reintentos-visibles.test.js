import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../src/turno.html", import.meta.url), "utf8");

function pintarPara({ persona = "ANA", pendientes = 2, bloqueada = false, enviando = false } = {}) {
  const inicio = html.indexOf("  function pintarRed() {");
  const fin = html.indexOf('  $("#red").addEventListener("click"', inicio);
  assert.ok(inicio >= 0 && fin > inicio);
  const el = { hidden: false, textContent: "", botones: [], appendChild(b) { this.botones.push(b); } };
  const E = persona ? { persona, turno: "MAÑANA", dia: "2026-10-19" } : null;
  const $ = () => el, document = { createElement: () => ({ dataset: {} }) };
  const cola = () => Array.from({ length: pendientes }, () => ({}));
  const colaAnterior = () => 0;
  const fn = new Function("E", "cola", "colaAnterior", "sinRed", "colaBloqueada", "enviando", "$", "document",
    html.slice(inicio, fin) + "\nreturn pintarRed;")(E, cola, colaAnterior, false, bloqueada, enviando, $, document);
  fn();
  return el;
}

test("A-08: reintentar sólo aparece durante una sesión PIN activa", () => {
  assert.equal(pintarPara({ persona: null }).botones.length, 0);
  const activo = pintarPara();
  assert.equal(activo.botones.length, 1);
  assert.equal(activo.botones[0].textContent, "Reintentar");
  assert.equal(activo.botones[0].disabled, false);
});

test("A-08: un envío en curso no puede disparar otro desde el botón", () => {
  const enCurso = pintarPara({ enviando: true });
  assert.equal(enCurso.botones[0].disabled, true);
  assert.equal(enCurso.botones[0].textContent, "Enviando…");
});

test("A-08: error se señala sin mostrar el contenido de la cola", () => {
  const el = pintarPara({ bloqueada: true });
  assert.match(el.textContent, /Envío detenido; datos conservados/);
  assert.match(el.textContent, /2 por enviar/);
  assert.doesNotMatch(el.textContent, /concepto|nota|comentario|foto/);
  assert.equal(pintarPara({ pendientes: 0 }).botones.length, 0);
});

test("A-08: rechazos no eliminan los registros ni cruzan identidades", () => {
  const inicio = html.indexOf("  async function enviarCola() {");
  const fin = html.indexOf("  function pintarRed()", inicio);
  assert.ok(inicio > 0 && fin > inicio);
  const fuente = html.slice(inicio, fin);
  assert.match(fuente, /colaBloqueada = true/);
  assert.match(fuente, /break; \/\/ no descartar mensajes, fotos ni registros rechazados/);
  assert.match(fuente, /E\.persona === persona && E\.turno === turno && E\.dia === dia/);
  assert.match(html, /colaBloqueada = false;/);
});
