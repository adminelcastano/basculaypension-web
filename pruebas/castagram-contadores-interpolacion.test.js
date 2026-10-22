import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

for (const archivo of ["turno.html", "panel/cliente/07-castagram-controlador.js"]) {
  test("CASTAGRAM: contador de Me gusta interpolado correctamente en " + archivo, () => {
    const src = readFileSync(new URL("../src/" + archivo, import.meta.url), "utf8");
    const linea = src.split("\n").find(x => x.includes('class="casta-com-enterado ${c.mi_enterado'));
    assert.ok(linea, "Falta plantilla de comentario");
    assert.match(linea, /aria-label="\$\{Number\(c\.enterados\)\|\|0\} Me gusta"/);
    assert.match(linea, />\$\{Number\(c\.enterados\)\|\|0\}<\/small>/);
    assert.doesNotMatch(linea, /\\\$\{/);
    assert.match(linea, /data-com-enterado="\$\{esc\(c\.id\)\}"/);
  });
}
