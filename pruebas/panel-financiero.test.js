import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { transformarPanelFinanciero } from "../src/panel-financiero.js";

const leer = ruta => readFileSync(new URL("../" + ruta, import.meta.url), "utf8");

test("Panel Financiero utiliza los mismos assets que Panel y solo muestra Caja, Dinero y Compras", () => {
  const base = leer("src/panel/pagina.html")
    .replace("{{CSS}}", "/panel/app.css?v=ensayo")
    .replace("{{JS}}", "/panel/app.js?v=ensayo");
  const financiero = transformarPanelFinanciero(base);
  assert.match(financiero, /<title>Panel Financiero · El Castaño<\/title>/);
  assert.match(financiero, /<body data-panel-financiero="1">/);
  assert.match(financiero, /data-mod="caja"/);
  assert.match(financiero, /data-mod="dinero"/);
  assert.match(financiero, /data-mod="agenda"/);
  const menu = financiero.match(/<nav class="modulos"[\s\S]*?<\/nav>/)?.[0] || "";
  assert.equal((menu.match(/<button/g) || []).length, 3);
  assert.doesNotMatch(menu, /data-mod="(?:personal|facturacion|inicio)"/);
  assert.match(financiero, /#mod-facturacion/);
  assert.match(financiero, /#mod-personal/);
  assert.match(financiero, /#mod-config/);
  assert.match(financiero, /#mod-agenda \.bloque\[data-bloque\]:not\(\[data-bloque="compras"\]\)/);
  assert.match(financiero, /\/panel\/app\.css\?v=ensayo/);
  assert.match(financiero, /\/panel\/app\.js\?v=ensayo/);
  assert.equal(base.includes('data-panel-financiero="1"'), false, "Se modificó el panel original");
});

test("Panel Financiero conserva rutas y autentica ANTES de enviar HTML", () => {
  const worker = leer("src/worker.js");
  const app = leer("src/panel-app.js");
  assert.match(worker, /if \(url\.pathname === "\/panel" \|\| url\.pathname\.startsWith\("\/panel\/"\)\) return await panel\(/);
  assert.ok(worker.indexOf("const usuario = await verificarAcceso(request, env);") <
    worker.indexOf('if (ruta === "/panel/financiero"'));
  assert.match(app, /return transformarPanelFinanciero\(await paginaPanel\(\)\)/);
  assert.match(worker, /const rutasPanel = crearRutasPanel\(/);
});

test("Solo Panel completo activa módulos excluidos y carga Facturas", () => {
  const nav=leer("src/panel/cliente/02-personal.js");
  const base=leer("src/panel/cliente/00-base.js");
  const fact=leer("src/panel/cliente/01-facturacion.js");
  const agenda=leer("src/panel/cliente/07-agenda.js");
  assert.match(nav, /document\.body\?\.dataset\.panelFinanciero === "1"/);
  assert.match(nav, /!\["caja", "finanzas", "agenda"\]\.includes\(mod\)/);
  assert.match(base, /dataset\.panelFinanciero === "1" \? "caja" : "inicio"/);
  assert.match(fact, /dataset\.panelFinanciero !== "1"\) cargarLista\(\)/);
  assert.match(agenda, /dataset\.panelFinanciero !== "1"\) \$\("#recargar"\)\.click\(\)/);
});
