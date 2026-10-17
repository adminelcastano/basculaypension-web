// Lenguaje natural de la agenda del panel (se extrae del código del navegador): node --test pruebas/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
const src = readFileSync(new URL("../src/panel/cliente/07-agenda.js", import.meta.url), "utf8");
const cod = src.slice(src.indexOf("// <interpretar>"), src.indexOf("// </interpretar>"));
const ctx = { window: {} }; vm.runInNewContext(cod, ctx);
const I = (t, hoy = "2026-10-16") => { const r = ctx.window.interpretarAgenda(t, hoy); return { titulo: r.titulo, fecha: r.fecha, hora: r.hora, prioridad: r.prioridad, repetir: r.repetir, para_turno: r.para_turno, turno: r.turno }; };
// 2026-10-16 es viernes

test("mañana a una hora, urgente", () => {
  assert.deepEqual(I("Técnico de la báscula mañana 9:30 urgente"), { titulo: "Técnico de la báscula", fecha: "2026-10-17", hora: "09:30", prioridad: "alta", repetir: null, para_turno: 0, turno: null });
});
test("día de la semana y hora de la tarde", () => {
  const r = I("Junta con proveedor el lunes a las 5");
  assert.equal(r.titulo, "Junta con proveedor"); assert.equal(r.fecha, "2026-10-19"); assert.equal(r.hora, "17:00");
  assert.equal(I("Pagar luz viernes").fecha, "2026-10-23");
  assert.equal(I("Pagar luz este viernes").fecha, "2026-10-16");
});
test("fechas con mes y con diagonal", () => {
  assert.equal(I("Renovar extintores 3 de noviembre").fecha, "2026-11-03");
  assert.equal(I("Renovar extintores 15/10").fecha, "2027-10-15");
  assert.equal(I("Inventario 20/10 10am").hora, "10:00");
});
test("relativas: en 3 días, próxima semana, pasado mañana, fin de mes", () => {
  assert.equal(I("Revisar cámaras en 3 días").fecha, "2026-10-19");
  assert.equal(I("Revisar cámaras la próxima semana").fecha, "2026-10-19");
  assert.equal(I("Revisar cámaras pasado mañana").fecha, "2026-10-18");
  assert.equal(I("Cerrar mes fin de mes").fecha, "2026-10-31");
});
test("repetición y tablet", () => {
  const r = I("Barrer la báscula cada lunes tablet turno mañana");
  assert.equal(r.titulo, "Barrer la báscula"); assert.equal(r.repetir, "semanal"); assert.equal(r.fecha, "2026-10-19"); assert.equal(r.para_turno, 1); assert.equal(r.turno, "MAÑANA");
  assert.equal(I("Revisar extintores cada mes").repetir, "mensual");
  assert.equal(I("Limpiar baños todos los días para el encargado").repetir, "diaria");
});
test("los números del título no se toman como hora", () => {
  assert.deepEqual([I("Comprar 3 cubetas").titulo, I("Comprar 3 cubetas").hora], ["Comprar 3 cubetas", null]);
});
