import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { MANIFIESTO_FINANCIERO, transformarPanelFinanciero } from "../src/panel-financiero.js";

const src = p => readFileSync(new URL("../" + p, import.meta.url), "utf8");

test("Financiero tiene PWA independiente del Panel original y no borra el manifiesto", () => {
  const base = src("src/panel/pagina.html");
  const html = transformarPanelFinanciero(base);
  const link = html.match(/<link rel="manifest"[^>]+>/)?.[0] || "";
  assert.match(link, /href="\/panel\/financiero\.webmanifest"/);
  assert.match(link, /crossorigin="use-credentials"/, "Manifest privado requiere credenciales de Access");
  assert.equal((html.match(/<link rel="manifest"/g)||[]).length,1);
  assert.doesNotMatch(html, /href="\/panel\/app\.webmanifest"/);
  assert.match(base, /href="\/panel\/app\.webmanifest"/, "Panel original sin cambios");
  assert.match(html, /<meta name="apple-mobile-web-app-capable" content="yes">/);
  assert.match(html, /<meta name="apple-mobile-web-app-title" content="Financiero">/);
  assert.match(html, /<link rel="apple-touch-icon" href="\/apple-touch-icon\.png">/);
  assert.match(html, /<title>Panel Financiero · El Castaño<\/title>/);
});

test("Manifiesto de Chrome Android con iconos reales 192/512, id y ámbito separados", () => {
  const m = MANIFIESTO_FINANCIERO;
  assert.equal(m.id, "/panel/financiero");
  assert.equal(m.start_url, "/panel/financiero");
  assert.equal(m.scope, "/panel/financiero");
  assert.equal(m.display, "standalone");
  assert.ok(m.name.includes("Financiero"));
  assert.notEqual(m.prefer_related_applications,true);
  for(const px of [192,512]){
    const ic=m.icons.find(x=>x.sizes===px+"x"+px&&x.type==="image/png");
    assert.ok(ic,"Falta icono "+px);
    assert.ok(existsSync(new URL("../public"+ic.src,import.meta.url)),"Falta recurso "+ic.src);
  }
  assert.ok(existsSync(new URL("../public/apple-touch-icon.png",import.meta.url)));
  assert.notEqual(m.id,"/panel","El Panel original conserva identidad independiente");
});

test("Cloudflare entrega el manifest financiero en ruta privada y sin caché de datos", () => {
  const s=src("src/panel-app.js"),worker=src("src/worker.js");
  assert.match(s,/ruta === "\/panel\/financiero\.webmanifest"/);
  assert.match(s,/JSON\.stringify\(MANIFIESTO_FINANCIERO\)/);
  assert.match(s,/application\/manifest\+json/);
  assert.match(s,/"Cache-Control": "no-store"/);
  const idxAuth=worker.indexOf("const usuario = await verificarAcceso(request, env)");
  const idxManifest=worker.indexOf("await recursoPanel(ruta, url)");
  assert.ok(idxAuth>=0&&idxManifest>idxAuth,"La verificación Access sigue antes del manifest");
  assert.match(worker,/ruta === "\/panel\/financiero"/);
  assert.doesNotMatch(s, /cache\.put\(|caches\.open\(/, "No almacenar respuestas privadas");
});
