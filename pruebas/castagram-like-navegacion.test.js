import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const leer = p => readFileSync(new URL(p, import.meta.url), "utf8");
const pagina = leer("../src/panel/pagina.html");
const inicio = leer("../src/panel/cliente/06-inicio.js");
const panel = leer("../src/panel/cliente/07-agenda.js") + "\n" + leer("../src/panel/cliente/07-castagram-controlador.js");
const tablet = leer("../src/turno.html");
const avisos = leer("../src/avisos.js");
const agenda = leer("../src/agenda.js");
const turno = leer("../src/turno.js");
const css = leer("../src/panel/estilos.css");

test("Acciones rápidas abre Castagram usando la navegación existente", () => {
  const i = pagina.indexOf('<div class="acc-grid">');
  const j = pagina.indexOf("</div>", i);
  assert.ok(i > 0 && j > i);
  assert.match(pagina.slice(i,j), /class="accion" data-agenda="aviso"/);
  assert.match(pagina.slice(i,j), />Castagram<\/button>/);
  assert.match(inicio, /#mod-inicio \[data-agenda\]/);
  assert.match(inicio, /window\.agendaAbrir\(el\.dataset\.agenda\)/);
});

test("Me gusta tiene solo corazón visible y alterna por estado confirmado", () => {
  for(const ui of [panel,tablet]){
    const i=ui.indexOf('class="casta-com-enterado');
    assert.ok(i > 0);
    const boton=ui.slice(i,ui.indexOf('</button>',i)+9);
    assert.match(boton, /<svg class="casta-like-corazon"/);
    assert.doesNotMatch(boton, /<img|> Enterado /);
    assert.match(boton, /aria-pressed/);
    assert.match(ui, /class="casta-like-cuenta"/);
    assert.match(ui, /Quitar Me gusta/);
    assert.match(ui, /activo:deseado/);
    assert.match(ui, /const antes=!!c\.mi_enterado/);
    assert.match(ui, /pintar\(antes,totalAntes\)/);
    assert.match(ui, /c\.enterados=Math\.max\(0,Number\(/);
  }
  assert.match(css, /\.casta-com-enterado\.is-enterado/);
  assert.match(css, /min-height:44px/);
  assert.match(css, /prefers-reduced-motion:reduce/);
});

test("Reaccionar no cambia permisos ni deja borrar Enterados históricos", () => {
  assert.match(avisos, /CREATE TABLE IF NOT EXISTS aviso_com_enterados/);
  assert.match(avisos, /ALTER TABLE aviso_com_enterados ADD COLUMN quitado TEXT/);
  assert.match(avisos, /AND quitado IS NULL/);
  assert.match(avisos, /stmtHistorial\(env, item\.id, persona, activo \? "like-comentario" : "quitar-like-comentario"/);
  const desde=avisos.indexOf('export async function enterarComentario(');
  const hasta=avisos.indexOf('// ¿Puede esta persona ver',desde);
  const funcion=avisos.slice(desde,hasta);
  assert.match(funcion, /if \(!com\) throw new Error/);
  assert.match(funcion, /if \(typeof activo !== "boolean"\)/);
  assert.match(funcion, /if \(estabaActivo !== activo\)/);
  assert.match(funcion, /INSERT OR IGNORE INTO agenda_lecturas/);
  assert.doesNotMatch(funcion, /DELETE FROM aviso_com_enterados|DELETE FROM agenda_lecturas/);
  assert.match(agenda, /datos\.activo \?\? true/);
  assert.match(turno, /c\.activo \?\? true/);
  assert.match(turno, /!avisoParaEncargado\(a, s\.persona, s\.turno\)/);
});

test("Abrir conversa sin confirmar y post Enterado sigue siendo una constancia distinta", () => {
  const visto=avisos.slice(avisos.indexOf("export async function marcarVisto("),avisos.indexOf("// Reacción tipo Instagram"));
  assert.match(visto,/INSERT INTO aviso_vistos/);
  assert.doesNotMatch(visto,/agenda_lecturas/);
  assert.match(avisos,/Publicar un comentario es una acción inequívoca/);
  assert.match(turno,/partes\[2\] === "enterado"/);
  assert.match(agenda,/partes\[2\] === "enterado"/);
});
