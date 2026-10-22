import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";

const fuente = ruta => readFileSync(new URL("../" + ruta, import.meta.url), "utf8");

function despachadorFicticio() {
  const src = fuente("src/worker-panel-rutas.js")
    .replace(/^import .*;$/gm, "")
    .replace(/^export function crearRutasPanel/m, "function crearRutasPanel");
  const contexto = { URL, Request };
  vm.runInNewContext(src + "\n;globalThis.crearRutasPanelEnsayo = crearRutasPanel;", contexto);
  const consultas = [];
  const env = { DB: {
    prepare(sql) {
      const stmt = {
        bind(...args) { this.args = args; return this; },
        async all() {
          consultas.push({ sql, args: this.args || [] });
          if (sql.includes("GROUP BY grupo")) return { results: [{ grupo: "pendiente", n: 1 }] };
          if (sql.includes("FROM solicitudes WHERE")) return {
            results: [{ id: "solicitud-ficticia", folio: "PRUEBA-001", estado: "pendiente" }]
          };
          throw new Error("Consulta no simulada: " + sql);
        }
      };
      return stmt;
    }
  } };
  const json = (datos, status = 200) => ({ datos, status });
  const rutas = contexto.crearRutasPanelEnsayo({
    DIAS_RETENCION: 90,
    asegurarEsquema: async () => {},
    limiteHistorico: () => "2026-10-15",
    json
  });
  const consultar = async query => {
    const url = new URL("https://ejemplo.invalid/panel/api/solicitudes" + query);
    return rutas(new Request(url), env, url, { email: "administracion@ejemplo.invalid" });
  };
  return { consultar, consultas };
}

test("El Worker inyecta la retención al despachador de Facturas", () => {
  assert.match(fuente("src/worker.js"), /const rutasPanel = crearRutasPanel\(\{ DIAS_RETENCION,/);
  assert.match(fuente("src/worker-panel-rutas.js"), /const \{ DIAS_RETENCION, LEER_TICKET_IA,/);
});

test("Facturas devuelve solicitudes y conteos completos sin error 500", async () => {
  const { consultar, consultas } = despachadorFicticio();
  const r = await consultar("?estado=pendiente");
  assert.equal(r.status, 200);
  assert.equal(r.datos.ok, true);
  assert.equal(r.datos.dias_retencion, 90);
  assert.equal(r.datos.solicitudes[0].folio, "PRUEBA-001");
  assert.equal(r.datos.conteos.pendiente, 1);
  assert.equal(consultas.length, 2);
});

test("Facturas permite listas adicionales sin conteos y archivo histórico", async () => {
  const { consultar, consultas } = despachadorFicticio();
  const mas = await consultar("?estado=facturada&solo_lista=1");
  assert.equal(mas.status, 200);
  assert.equal(mas.datos.dias_retencion, 90);
  assert.equal(Object.keys(mas.datos.conteos).length, 0);
  assert.equal(consultas.length, 1);
  const historico = await consultar("?estado=historico&solo_lista=1");
  assert.equal(historico.status, 200);
  assert.equal(historico.datos.dias_retencion, 90);
  assert.ok(consultas[1].sql.includes("resuelta_en < ?"));
});
