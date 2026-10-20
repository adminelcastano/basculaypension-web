// Verificación sin servicios reales: UID usado por las colas compartidas del turno.
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const html = readFileSync(new URL("../src/turno.html", import.meta.url), "utf8");
const src = html.match(/  const nuevoUid = \(\) =>[^;]+;/)?.[0];
assert.ok(src, "Falta el generador de UID en turno");
const fabricar = (crypto, Date, Math) => new Function("crypto", "Date", "Math", src+"\nreturn nuevoUid;")(crypto, Date, Math);
test("la cola usa UUID criptográfico sin cambiar su identificador entre reintentos", () => {
  let n = 0;
  const next = fabricar({randomUUID:()=>["01234567-89ab-4cde-8fab-0123456789ab","11234567-89ab-4cde-8fab-0123456789ab"][n++]},Date,Math);
  const a=next(), b=next();
  assert.match(a,/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
  assert.notEqual(a,b);
  // Las operaciones pendientes usan el UID asignado, no vuelven a generar otro.
  const pending={uid:a, ruta:"avisos"};
  assert.equal(pending.uid,a);
  assert.equal(n,2);
});
test("navegadores sin randomUUID conservan el formato anterior y no bloquean la cola", () => {
  const gen=fabricar({}, {now:()=>1700000000000},{random:()=>0.12345678});
  assert.match(gen(),/^[a-z0-9]+-[a-z0-9]+$/);
  const missing=fabricar(undefined,{now:()=>1700000000000},{random:()=>0.12345678});
  assert.equal(gen(),missing());
});
test("no incluir errores externos de Google Drive en los registros de Personal", () => {
  const text=readFileSync(new URL("../src/personal.js",import.meta.url),"utf8");
  assert.match(text,/drive: sincronización pendiente; revisar estado/);
  assert.doesNotMatch(text,/console\.error\("drive",\s*e\s*&&\s*e\.message/);
});
