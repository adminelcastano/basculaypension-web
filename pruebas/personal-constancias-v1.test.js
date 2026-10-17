import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../src/personal.js", import.meta.url), "utf8");
const form = readFileSync(new URL("../src/expediente.html", import.meta.url), "utf8");
const panel = readFileSync(new URL("../src/panel/cliente/02-personal.js", import.meta.url), "utf8");
const aviso = readFileSync(new URL("../public/aviso-de-privacidad-colaboradores/index.html", import.meta.url), "utf8");

test("Constancia v1 se registra solo en el expediente y su fecha no se sobreescribe", () => {
  assert.match(src, /VERSION_AVISO_PERSONAL_V1 = "personal-aviso-v1-2026-10-17"/);
  assert.match(src, /CREATE TABLE IF NOT EXISTS personal_constancias/);
  assert.match(src, /PRIMARY KEY \(colaborador_id, documento, version\)/);
  assert.match(src, /INSERT OR IGNORE INTO personal_constancias/);
  assert.doesNotMatch(src, /UPDATE personal_constancias SET aceptado_en/);
  assert.match(src, /'expediente-web'/);
});
test("No presume aceptación retroactiva ni crea acuses al capturar datos desde panel", () => {
  assert.match(src, /SELECT version, aceptado_en, medio, campana_id FROM personal_constancias/);
  assert.match(src, /c\.version !== VERSION_AVISO_PERSONAL_V1 \|\| c\.confirmo !== true/);
  assert.match(src, /!cuerpo\.acepto && !\(await constanciaPersonalV1\(env, fila\.id\)\)/);
  assert.match(form, /casillaForm\.closest\("label"\)\.hidden = !!c/);
  assert.match(src, /env\.DB\.batch\(\[/);
  assert.doesNotMatch(src, /INSERT OR REPLACE INTO personal_constancias/);
});
test("El formulario permite confirmar v1 sin subir documentos ni completar datos", () => {
  assert.match(form, /id="acuse-v1"/);
  assert.match(form, /Registrar recepción v1/);
  assert.match(form, /api \+ "\/constancia"/);
  assert.match(form, /id="acuse-v1-check"/);
  assert.match(form, /pintarConstancia\(j\.constancia_v1\)/);
  assert.match(form, /no sustituye la firma de documentos impresos/i);
  for (const [,js] of form.matchAll(/<script>([\s\S]*?)<\/script>/g)) assert.doesNotThrow(() => new Function(js));
});
test("El panel muestra pendiente o recibida y permite solicitar por campaña", () => {
  assert.match(panel, /Constancias digitales · Personal y Campañas/);
  assert.match(panel, /c\.acuse_v1_en/);
  assert.match(panel, /Solicitar constancia por campaña/);
  assert.match(panel, /irACampanas\(\[c\.id\], \["acuse_v1"\]\)/);
  assert.doesNotThrow(() => new Function(panel));
});
test("La campaña puede pedir solo v1 y su estado depende de evidencia real", () => {
  assert.match(src, /k === "acuse_v1"/);
  assert.match(src, /k === "acuse_v1" \|\| DOCUMENTOS\[k\]/);
  assert.match(src, /LEFT JOIN personal_constancias a ON a\.colaborador_id = c\.id/);
  assert.match(panel, /cp\.docs\.includes\("acuse_v1"\)/);
  assert.match(src, /camp\.docs\.includes\("acuse_v1"\)/);
});
test("Aviso v1 describe responsable y distingue firmas impresas de lectura digital", () => {
  assert.match(aviso, /versión 1/);
  assert.match(aviso, /personal-aviso-v1-2026-10-17/);
  assert.match(aviso, /Oscar Manuel Rincon Gallardo Mendoza/);
  assert.match(aviso, /no es una firma autógrafa/i);
  assert.match(aviso, /CASTAGRAM/);
});

test("La recepción exige confirmación booleana y devuelve la hora real del servidor", () => {
  assert.match(src, /cuerpo\.acepto !== true/);
  assert.match(src, /return json\(\{ ok: true, constancia: await constanciaPersonalV1\(env, fila\.id\) \}\)/);
  assert.match(form, /pintarConstancia\(j\.constancia\)/);
  assert.doesNotMatch(form, /pintarConstancia\(\{ aceptado_en: new Date\(\)\.toISOString\(\) \}\)/);
});

test("Atribuye constancia v1 a la campaña correcta aunque haya otras campañas abiertas", async () => {
  const found = src.match(/async function campanaDeConstanciaV1\(env, fila, acceso\) \{[\s\S]*?\n\}/);
  assert.ok(found);
  const helper = new Function("leerCampana", "hoyLocal", found[0] + "\nreturn campanaDeConstanciaV1")(
    c => ({ ...c, docs: JSON.parse(c.docs || "[]") }), () => "2026-10-17"
  );
  let consulted = 0;
  const env = { DB: { prepare(sql) {
    assert.match(sql, /JOIN campana_personas p ON/);
    return { bind(id, date) {
      assert.equal(id, "ficticio-1");
      assert.equal(date, "2026-10-17");
      return { async all() {
        consulted++;
        return { results: [
          { id: "c-otras", docs: '["datos","ine"]' },
          { id: "c-aviso", docs: '["acuse_v1"]' }
        ] };
      } };
    } };
  } } };
  assert.equal(await helper(env, { id: "ficticio-1" }, { campana: { id: "c-otras", docs: ["datos"] } }), "c-aviso");
  assert.equal(await helper(env, { id: "ficticio-1" }, { campana: { id: "c-ya", docs: ["acuse_v1"] } }), "c-ya");
  assert.equal(consulted, 1);
  assert.match(src, /const campanaId = await campanaDeConstanciaV1\(env, fila, acceso\)/);
});

test("La tablet y CASTAGRAM siguen fuera de la captura de constancias", () => {
  assert.doesNotMatch(src, /INSERT INTO turno_acuses/);
  assert.doesNotMatch(src, /INSERT INTO aviso_vistos/);
});
