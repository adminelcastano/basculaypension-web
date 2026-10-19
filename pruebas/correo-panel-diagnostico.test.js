import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const worker = readFileSync(new URL("../src/worker.js", import.meta.url), "utf8");
const bloque = worker.split('if (partes[0] === "diagnostico" && partes[1] === "correo-panel"')[1]?.split('if (partes[0] === "colaboradores")')[0];
test("Correo Panel: diagnóstico aislado por POST en panel privado", () => {
  assert.ok(bloque, "Falta ruta diagnóstica");
  assert.match(bloque, /request\.method !== "POST"/);
  assert.match(worker, /const usuario = await verificarAcceso\(request, env\)/);
  assert.match(worker, /request\.headers\.get\("X-Panel"\) !== "1"/);
});
test("Correo Panel: sólo consulta drive probar sin correos, hojas ni archivos", () => {
  assert.match(bloque, /accion: "drive", op: "probar"/);
  assert.doesNotMatch(bloque, /accion: "archivos"|op: "hoja"|op: "guardar"|GmailApp|sendEmail/);
  assert.match(bloque, /texto === "ok-drive"/);
});
test("Correo Panel: resultado sin exponer token, cuerpo o redirección", () => {
  assert.match(bloque, /JSON\.stringify\(\{ token: env\.AVISO_TOKEN\.trim\(\)/);
  assert.doesNotMatch(bloque, /console\.log|console\.error|respuesta\.url|texto\.slice/);
  assert.match(bloque, /conexion: "no_confirmada"/);
});
