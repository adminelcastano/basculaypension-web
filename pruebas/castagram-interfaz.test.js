import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const tablet = readFileSync(new URL("../src/turno.html", import.meta.url), "utf8").replace("/*__TURNO_CSS__*/", readFileSync(new URL("../src/turno-estilos.css", import.meta.url), "utf8"));
const panel = readFileSync(new URL("../src/panel/cliente/07-agenda.js", import.meta.url), "utf8") + "\n" + readFileSync(new URL("../src/panel/cliente/07-castagram-controlador.js", import.meta.url), "utf8");
const estilos = readFileSync(new URL("../src/panel/estilos.css", import.meta.url), "utf8");
const inline = tablet.match(/<script>\s*\(\(\)\s*=>\s*\{[\s\S]*?<\/script>/g)?.at(-1);

test("Castagram: el JavaScript de la tablet y del panel compila", () => {
  assert.ok(inline, "Debe existir el script de la tablet");
  assert.doesNotThrow(() => new Function(inline.slice("<script>".length, -"</script>".length)));
  assert.doesNotThrow(() => new Function(panel));
});

test("Castagram: panel y tablet presentan comentarios en hoja inferior", () => {
  for (const fuente of [tablet, panel]) {
    assert.match(fuente, /dlg\.className = "casta-sheet"/);
    assert.match(fuente, /\.showModal\(\)/);
    assert.match(fuente, /data-sheet-cerrar/);
    assert.match(fuente, /casta-sheet-list/);
    assert.match(fuente, /casta-sheet-compose/);
    assert.match(fuente, /data-responder/);
  }
  assert.match(tablet, /dialog\.casta-sheet\[open\]/);
  assert.match(estilos, /dialog\.casta-sheet\[open\]/);
});

test("Castagram: Enterado confirmado es distinto de Enterado pendiente", () => {
  assert.match(tablet, /const confirmado = !!a\.leido && !a\.propio/);
  assert.match(tablet, /confirmado \? "is-enterado" : pendiente \? "is-pendiente"/);
  assert.match(tablet, /if \(r\.enCola\) \{/);
  assert.match(tablet, /if \(a\) a\.leido = true/);
  assert.match(panel, /cantidadEnterados \? "is-enterado" : ""/);
  assert.match(estilos, /\.casta-pulgar\.is-enterado/);
});

test("Castagram: rutas y fotografías de comentarios se conservan", () => {
  assert.match(tablet, /api\(`avisos\/\$\{id\}\/conversacion`\)/);
  assert.match(tablet, /api\(`avisos\/\$\{id\}\/comentar`/);
  assert.match(panel, /post\(`agenda\/\$\{id\}\/comentar`/);
  assert.match(tablet, /data-com-foto/);
  assert.match(panel, /data-com-foto/);
});

test("Castagram: la conversación abierta no se pierde al refrescar sola", () => {
  assert.match(tablet, /sec\(\)\.querySelector\("dialog\.casta-sheet\[open\]"\)/);
  assert.match(tablet, /function repintarSheetTurno/);
  assert.match(panel, /const dlg = el\.querySelector\("dialog\.casta-sheet\[open\]"\)/);
});

test("Castagram: un solo pulgar por publicación y comentario por icono", () => {
  for (const fuente of [tablet, panel]) {
    assert.match(fuente, /casta-pulgar-boton/);
    assert.match(fuente, /aria-label="Confirmar/);
    assert.match(fuente, /casta-comentar/);
    assert.doesNotMatch(fuente, /\$\{pulgar\} Enterado<\/button>/);
    assert.doesNotMatch(fuente, /\$\{ico\("i-chat"\)\}Comentar<\/button>/);
    assert.doesNotMatch(fuente, /\$\{svg\("i-chat"\)\}Comentar<\/button>/);
  }
  assert.match(tablet, /!a\.leido && !pendiente \? `<button type="button" class="casta-pulgar/);
  assert.match(tablet, /const confirmado = !!a\.leido && !a\.propio/);
  assert.match(panel, /cantidadEnterados \? "is-enterado"/);
});
test("Castagram: icono de comentario visible sin texto redundante", () => {
  for (const fuente of [tablet, panel]) {
    assert.match(fuente, /casta-comentar-ico/);
    assert.match(fuente, /aria-label="Abrir comentarios"/);
    assert.doesNotMatch(fuente, /\}Comentar<\/button>/);
  }
  assert.match(tablet, /\.casta-comentar \{[^\n]*color:#f5f5f7/);
  assert.match(estilos, /\.casta-comentar \{[^\n]*color:#f5f5f7/);
});


test("Castagram: PNG del pulgar original, verde redondeado y nueve emojis exactos", () => {
  const icono = readFileSync(new URL("../public/img/castagram-pulgar.png", import.meta.url));
  assert.equal(icono.subarray(0,8).toString("hex"), "89504e470d0a1a0a");
  for (const src of [tablet,panel]) {
    assert.match(src, /castagram-pulgar\.png/);
    assert.match(src, /casta-pulgar-ico/);
    assert.doesNotMatch(src, /<svg class="casta-pulgar-ico"/);
    const bar = src.match(/<div class="casta-emoji-bar" aria-label="Emojis rápidos">([\s\S]*?)<\/div>/);
    assert.ok(bar,"Barra de emojis visible");
    assert.deepEqual([...bar[1].matchAll(/data-com-emoji="([^"]+)"/g)].map(x=>x[1]), ["😅","😡","💩","👽","🙊","🙉","🙈","❤️","🔥"]);
  }
  assert.match(estilos, /\.casta-pulgar\.is-enterado \{ color:#30d158; border-color:#30d158; background:#112e1b; \}/);
  assert.match(tablet, /\.casta-pulgar\.is-enterado \{ color:#30d158; border-color:#30d158; background:#112e1b; \}/);
  assert.match(tablet, /if \(r\.enCola\)/);
});
