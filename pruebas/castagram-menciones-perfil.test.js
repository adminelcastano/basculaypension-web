import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const tablet = readFileSync(new URL("../src/turno.html", import.meta.url), "utf8");
const panel = readFileSync(new URL("../src/panel/cliente/07-agenda.js", import.meta.url), "utf8") + "\n" + readFileSync(new URL("../src/panel/cliente/07-castagram-controlador.js", import.meta.url), "utf8");
const turno = readFileSync(new URL("../src/turno.js", import.meta.url), "utf8");
const server = readFileSync(new URL("../src/avisos.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../src/panel/estilos.css", import.meta.url), "utf8");

const personas = [
  { clave: "ERI", nombre: "eve", perfil: "Eve", avatar_url: "/perfil/eri.webp" },
  { clave: "JDOM", nombre: "alex", perfil: "Alex", avatar_url: "/perfil/jdom.webp" },
  { clave: "JESC", nombre: "Jess", perfil: "Jess", avatar_url: "/perfil/jesc.webp" },
  { clave: "JOESC", nombre: "Koki", perfil: "Koki", avatar_url: "/perfil/joesc.webp" },
  { clave: "JURB", nombre: "Jacky", perfil: "Jacky", avatar_url: "/perfil/jurb.webp" }
];

function obtenerBuscador(fuente) {
  const codigo = fuente.match(/const buscarMencion = \(ta, personas\) => \{[\s\S]*?\n  \};/);
  assert.ok(codigo, "Autocompletado de menciones existe");
  return new Function("perfilMencion", codigo[0] + "\nreturn buscarMencion;")(p => p.perfil || p.nombre || p.clave);
}

test("La tablet y administración sugieren nombres al escribir únicamente @", () => {
  for (const src of [tablet,panel]) {
    const fn = obtenerBuscador(src);
    const r = fn({ value: "Hola @", selectionStart: 6 }, personas);
    assert.deepEqual(r.personas.map(p => p.clave), ["ERI","JDOM","JESC","JOESC","JURB"]);
    assert.equal(r.inicio, 5);
    assert.equal(r.fin, 6);
  }
});

test("Se puede filtrar por nombre con acentos o por clave, sin escribir carácter por carácter", () => {
  for (const src of [tablet,panel]) {
    const fn = obtenerBuscador(src);
    assert.deepEqual(fn({ value: "Para @j", selectionStart: 7 }, personas).personas.map(p => p.clave), ["JDOM","JESC","JOESC","JURB"]);
    assert.deepEqual(fn({ value: "@JDO", selectionStart: 4 }, personas).personas.map(p => p.clave), ["JDOM"]);
    assert.deepEqual(fn({ value: "@Alex", selectionStart: 5 }, personas).personas.map(p => p.clave), ["JDOM"]);
    assert.equal(fn({ value: "correo@empresa.com", selectionStart: 6 }, personas), null);
    assert.equal(fn({ value: "hola sin arroba", selectionStart: 16 }, personas), null);
  }
});

test("Ambos lados insertan la clave estable, pero renderizan la foto y el perfil", () => {
  for (const src of [tablet,panel]) {
    assert.match(src, /ta\.setRangeText\("@" \+ p\.clave \+ " "/);
    assert.match(src, /data-mention-pick/);
    assert.match(src, /data-mention-list/);
    assert.match(src, /data-mention-selected/);
    assert.match(src, /perfilMencion\(p\)/);
    assert.match(src, /tarjetaMencion\(p\)/);
    assert.match(src, /conMenciones\(c\.texto\)|parrafos\(c\.texto\)/);
    assert.match(src, /aria-selected/);
    assert.match(src, /ArrowDown/);
    assert.match(src, /Escape/);
  }
});

test("Etiquetas de publicaciones, comentarios y respuestas muestran perfil, sin alterar destinatarios", () => {
  assert.match(tablet, /etqParaHtml\(a\.para \|\| \{\}\)/);
  assert.match(panel, /etqParaHtml\(p\)/);
  assert.match(panel, /etqParaHtml\(it\.para \|\| \{\}\)/);
  assert.match(tablet, /c\.etiquetas\.map\(k => conMenciones\("@" \+ k\)\)/);
  assert.match(panel, /c\.etiquetas\.map\(k => conMenciones\("@" \+ k\)\)/);
  assert.match(tablet, /Respondiendo a \$\{conMenciones/);
  assert.match(panel, /Respondiendo a \$\{conMenciones/);
  assert.match(server, /etiquetasNuevas\(item\.para, pedidas, claves, item\.autor\)/);
  assert.match(server, /INSERT INTO aviso_comentarios/);
});

test("Los perfiles se obtienen solo de endpoints de sesión y se conserva el PIN", () => {
  assert.match(turno, /SELECT clave, nombre, avatar, foto_ver, prefs FROM turno_personas WHERE activo = 1/);
  assert.match(turno, /perfil: nombrePerfil\(p\)/);
  assert.match(turno, /pinCorrecto\(pin, p\.pin_sal, p\.pin_hash\)/);
  assert.doesNotMatch(turno, /UPDATE agenda_lecturas.*perfil/);
  assert.doesNotMatch(turno, /UPDATE personal_constancias.*perfil/);
});

test("Las interfaces y estilos conservan sintaxis válida", () => {
  assert.doesNotThrow(() => new Function(panel));
  for (const [, js] of tablet.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
    assert.doesNotThrow(() => new Function(js.replace("/*__INTERPRETAR__*/", "")));
  }
  assert.match(css, /\.casta-mention-list/);
  assert.match(tablet, /\.casta-mention-list/);
  assert.match(css, /max-height:150px/);
});

test("Cada mención renderizada lleva la foto y el nombre de perfil, no la clave interna", () => {
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  for (const src of [tablet,panel]) {
    const avatar = src.match(/  const avatarMencion = p => [^\n]+;/);
    const html = src.match(/  const tarjetaMencion = p => [^\n]+;/);
    assert.ok(avatar && html);
    const tarjeta = new Function("perfilMencion","esc", avatar[0] + "\n" + html[0] + "\nreturn tarjetaMencion;")(
      p => p.perfil || p.nombre || p.clave, esc
    );
    const presentado = tarjeta(personas[1]);
    assert.match(presentado, /<img /);
    assert.match(presentado, /jdom\.webp/);
    assert.match(presentado, /<b>@Alex<\/b>/);
    assert.doesNotMatch(presentado, /<b>@JDOM<\/b>/);
    const malicioso = tarjeta({ clave:"ERI", nombre:"Eve", perfil:"<img src=x onerror=alert(1)>" });
    assert.match(malicioso, /&lt;img/);
    assert.doesNotMatch(malicioso, /<b>@<img/);
  }
});

test("El selector es accesible y aparece en comentarios de ambas interfaces", () => {
  for (const src of [tablet,panel]) {
    assert.match(src, /aria-autocomplete="list" aria-controls="casta-men-/);
    assert.match(src, /role="listbox"/);
    assert.match(src, /aria-expanded="false"/);
    assert.match(src, /ta\.setAttribute\("aria-expanded", String\(!caja\.hidden\)\)/);
  }
});
