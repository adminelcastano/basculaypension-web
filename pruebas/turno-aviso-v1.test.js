import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const worker = readFileSync(new URL("../src/turno.js", import.meta.url), "utf8");
const tablet = readFileSync(new URL("../src/turno.html", import.meta.url), "utf8");
const aviso = readFileSync(new URL("../public/aviso-de-privacidad-encargados/index.html", import.meta.url), "utf8");

test("v1 digital distingue aviso laboral, CASTAGRAM y firma impresa", () => {
  assert.match(aviso, /Versión digital 1/);
  assert.match(aviso, /17 de octubre de 2026/);
  assert.match(aviso, /no es una firma autógrafa/i);
  assert.match(aviso, /Enterado/);
  assert.match(aviso, /derechos/i);
  assert.match(aviso, /Oscar Manuel Rincon Gallardo Mendoza/);
  assert.match(aviso, /aviso-de-privacidad-colaboradores/);
});

test("Acuses inmutables por persona y versión en la D1, nunca en la caché de la tablet", () => {
  assert.match(worker, /CREATE TABLE IF NOT EXISTS turno_acuses/);
  assert.match(worker, /PRIMARY KEY \(persona, version\)/);
  assert.match(worker, /INSERT OR IGNORE INTO turno_acuses/g);
  assert.match(worker, /AVISO_DIGITAL_V1 = "turno-aviso-v1-2026-10-17"/);
  assert.doesNotMatch(tablet, /guardarLS\(["'](?:turno:)?acuse/i);
  const inicio = worker.indexOf("CREATE TABLE IF NOT EXISTS turno_acuses");
  const fin = worker.indexOf("`).run();", inicio);
  assert.ok(inicio > 0 && fin > inicio);
  assert.doesNotMatch(worker.slice(inicio, fin), /pin_hash|pin_sal|ip_/i);
});

test("Se verifica el PIN antes de exigir y guardar la constancia por primera vez", () => {
  const comienzo = worker.indexOf('if (partes[0] === "entrar" && request.method === "POST")');
  const fin = worker.indexOf("  // Notificaciones push de la tablet", comienzo);
  const acceso = worker.slice(comienzo, fin);
  assert.ok(acceso.indexOf("pinCorrecto(pin") < acceso.indexOf('SELECT 1 FROM turno_acuses'));
  assert.ok(acceso.indexOf('SELECT 1 FROM turno_acuses') < acceso.indexOf("INSERT INTO turno_abierto"));
  assert.match(acceso, /requiere_acuse_v1: true/);
  assert.match(acceso, /return json\([\s\S]*?428\)/);
  assert.match(acceso, /c\.acuse_v1 !== AVISO_DIGITAL_V1/);
  assert.match(acceso, /bind\(clave, AVISO_DIGITAL_V1, ahora\.toISOString\(\), turno, diaNuevo\)/);
});

test("Sesiones ya abiertas no pueden saltarse la pantalla v1 ni ver CASTAGRAM antes del acuse", () => {
  assert.match(worker, /if \(!yaAcusado && partes\[0\] === "estado" && request\.method === "GET"\)/);
  assert.match(worker, /requiere_acuse_v1: true, version_aviso/);
  assert.match(worker, /if \(!yaAcusado\) return json\(/);
  assert.match(worker, /partes\[0\] === "acuse-v1" && request\.method === "POST"/);
  assert.match(worker, /c\.version !== AVISO_DIGITAL_V1 \|\| c\.confirmo !== true/);
  assert.match(worker, /bind\(s\.persona, AVISO_DIGITAL_V1, new Date\(\)\.toISOString\(\), s\.turno, s\.dia\)/);
});

test("La tablet presenta documento completo, casilla sin marcar y confirmación explícita", () => {
  assert.match(tablet, /id="dlg-aviso-v1"/);
  assert.match(tablet, /id="aviso-v1-check"/);
  assert.match(tablet, /aviso-de-privacidad-encargados\//);
  assert.match(tablet, /Confirmar recepción/);
  assert.match(tablet, /check\.checked = false; confirmar\.disabled = true/);
  assert.match(tablet, /if \(e\.datos\?\.requiere_acuse_v1/);
  assert.match(tablet, /await api\("acuse-v1", \{ version: VERSION_AVISO_TURNO, confirmo: true \}/);
  assert.match(tablet, /Date\.now\(\) - inicio > 120e3/);
  for (const [, js] of tablet.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
    if (js.includes("/*__INTERPRETAR__*/")) continue;
    assert.doesNotThrow(() => new Function(js));
  }
});

test("La administración puede consultar quién recibió v1 y en qué fecha", () => {
  assert.match(worker, /acuse_v1_en: p\.acuse_v1_en \|\| null/);
  assert.match(worker, /partes\[1\] === "acuse-v1" && request\.method === "GET"/);
  assert.match(worker, /SELECT p\.clave, p\.nombre, p\.activo, a\.aceptado_en, a\.medio/);
});

test("No altera confirmaciones Leído ni Enterado de CASTAGRAM", () => {
  assert.doesNotMatch(worker, /INSERT INTO agenda_lecturas.*AVISO_DIGITAL_V1/);
  assert.doesNotMatch(worker, /INSERT INTO aviso_vistos.*AVISO_DIGITAL_V1/);
});
