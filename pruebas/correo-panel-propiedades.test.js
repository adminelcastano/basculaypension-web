import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const s=readFileSync(new URL("../herramientas/aviso-correo.gs",import.meta.url),"utf8");
test("Correo Panel: secreto sólo en propiedades y no incrustado",()=>{
  assert.match(s,/getScriptProperties\(\)\.getProperty\('AVISO_TOKEN'\)/);
  assert.match(s,/const tokenActual = TOKEN\(\)/);
  assert.doesNotMatch(s,/const TOKEN = ['"][^'"]+['"]/);
});
test("Correo Panel: probar consulta sin enviar ni borrar",()=>{
  const probar=s.split("function probar() {")[1];
  assert.ok(probar);
  assert.doesNotMatch(probar,/GmailApp|sendEmail|setTrashed|createFile|createFolder|SpreadsheetApp\.create/);
  assert.match(probar,/AVISO_TOKEN: /);
  assert.match(probar,/GOOGLE SHEETS: OK/);
});
