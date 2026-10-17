import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../src/turno.html", import.meta.url), "utf8");
const worker = readFileSync(new URL("../src/turno.js", import.meta.url), "utf8");
const aviso = readFileSync(new URL("../public/aviso-de-privacidad-colaboradores/index.html", import.meta.url), "utf8");

test("El aviso v1 se puede consultar desde la entrada y el perfil del encargado", () => {
  assert.equal((html.match(/href="\/aviso-de-privacidad-colaboradores\/"/g) || []).length, 2);
  assert.match(html, /id="entrada"/);
  assert.match(html, /Consultar aviso de privacidad para colaboradores/);
  assert.match(html, /Las constancias se gestionan exclusivamente en Personal y Campañas/);
  assert.match(aviso, /personal-aviso-v1-2026-10-17/);
});
test("Los enlaces abren el aviso sin introducir capturas de datos ni acuses en Turno", () => {
  assert.equal((html.match(/href="\/aviso-de-privacidad-colaboradores\/" target="_blank" rel="noopener"/g) || []).length, 2);
  assert.doesNotMatch(worker, /turno_acuses|INSERT INTO personal_constancias|requiere_acuse_v1|acuse-v1/);
  assert.doesNotMatch(html, /dlg-aviso-v1|id="acuse-v1-check"/);
});
test("El PIN, la sesión y Enterado permanecen operativos", () => {
  assert.match(worker, /pinCorrecto\(pin, p\.pin_sal, p\.pin_hash\)/);
  assert.match(worker, /INSERT OR IGNORE INTO agenda_lecturas/);
  assert.match(html, /const COLA_RUTAS/);
  assert.match(html, /async function abrirApp\(\)/);
});
test("Los scripts originales de Turno conservan sintaxis válida", () => {
  for(const [,js] of html.matchAll(/<script>([\s\S]*?)<\/script>/g)){
    if(js.includes("/*__INTERPRETAR__*/")) continue;
    assert.doesNotThrow(() => new Function(js));
  }
});
