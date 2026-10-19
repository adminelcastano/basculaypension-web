import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const pagina = readFileSync(new URL("../src/panel/pagina.html", import.meta.url), "utf8");
const config = readFileSync(new URL("../src/panel/cliente/11-configuracion.js", import.meta.url), "utf8");

test("Correo Panel: botón en Configuración → Conexiones con estado accesible", () => {
  const area = pagina.split('id="cfg-conexiones"')[1]?.split('id="cfg-sistema"')[0] || "";
  assert.match(area, /id="cfg-correo-verificar"/);
  assert.match(area, /id="cfg-correo-resultado" role="status" aria-live="polite"/);
});
test("Correo Panel: el botón usa el API privado, sin pedir secretos ni mostrar respuestas externas", () => {
  assert.match(config, /api\("diagnostico\/correo-panel", \{ method: "POST" \}\)/);
  assert.match(config, /verificarCorreo\.disabled = true/);
  assert.match(config, /verificarCorreo\.disabled = false/);
  assert.match(config, /Conexión verificada/);
  assert.match(config, /No se pudo verificar/);
  assert.doesNotMatch(config, /AVISO_TOKEN|GmailApp|localStorage\.setItem/);
});
