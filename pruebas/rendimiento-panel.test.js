import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { leerMes } from "../src/caja.js";
import { hoyPanel } from "../src/hoy.js";

test("Caja consulta sus seis fuentes independientes sin bloquearse entre sí", async () => {
  const abiertas = [];
  const env = {
    DB: {
      prepare(sql) {
        return {
          bind(...args) {
            return {
              all() {
                return new Promise(resolve => abiertas.push({ sql, args, resolve }));
              }
            };
          }
        };
      }
    }
  };
  const promesa = leerMes(env, ["2026-10"], { desde: "2026-10-01", hasta: "2026-10-17" });
  // Si las peticiones fueran secuenciales, aquí sólo habría una iniciada.
  assert.equal(abiertas.length, 6);
  for (const p of abiertas) {
    assert.deepEqual(p.args, ["2026-10-01", "2026-10-17"]);
    p.resolve({ results: p.sql.includes("caja_gastos") ?
      [{ origen: "caja", monto: 10 }, { origen: "admin", monto: 25 }] : [] });
  }
  const d = await promesa;
  assert.equal(d.gastos.length, 1);
  assert.equal(d.gastosAdmin.length, 1);
  assert.equal(d.gastos[0].monto, 10);
  assert.equal(d.gastosAdmin[0].monto, 25);
  for (const k of ["movs", "transf", "conteos", "extras", "inicios"]) assert.deepEqual(d[k], []);
});

test("Hoy pide calendario al mismo tiempo que sus otras fuentes", async () => {
  const rutas = [];
  let terminarFactura;
  const promesa = hoyPanel({}, ruta => {
    rutas.push(ruta);
    if (ruta.startsWith("solicitudes?")) return new Promise(resolve => { terminarFactura = resolve; });
    return Promise.resolve({ ok: false });
  });
  await Promise.resolve();
  assert.ok(rutas.some(x => x.startsWith("agenda?desde=")), "El calendario debe iniciar sin esperar facturas");
  assert.ok(rutas.some(x => x.includes("resumen=1")), "Hoy debe pedir el resumen ligero de Caja");
  terminarFactura({ ok: false });
  const data = await promesa;
  assert.equal(data.ok, true);
  assert.ok(data.fuentes);
});

test("El modo resumido de Caja evita folios y catálogos, sin caché de dinero", () => {
  const src = readFileSync(new URL("../src/caja.js", import.meta.url), "utf8");
  const inicio = src.indexOf('if (partes.length === 1 && request.method === "GET")');
  const fin = src.indexOf('if (partes[1] === "corte" && request.method === "GET")', inicio);
  const bloque = src.slice(inicio, fin);
  assert.ok(inicio >= 0 && fin > inicio);
  assert.match(bloque, /esResumenHoy\s*=\s*url\.searchParams\.get\("resumen"\) === "1"/);
  assert.match(bloque, /esResumenHoy \? Promise\.resolve\(null\) : listaCategorias\(env\)/);
  assert.ok(bloque.indexOf("if (esResumenHoy)") < bloque.indexOf("await conFolios("));
  assert.match(bloque, /env\.FILES\.get\("caja:sync"/);
  assert.match(bloque, /leerCobrosAdmin\(env,/);
  assert.match(bloque, /cortes,\s*\n\s*transferencias:/);
});
