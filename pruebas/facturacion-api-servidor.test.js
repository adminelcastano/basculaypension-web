import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const worker = readFileSync(new URL("../src/worker.js", import.meta.url), "utf8");
const rules = readFileSync(new URL("../src/facturacion-reglas.js", import.meta.url), "utf8");

// Aislamos únicamente las rutas ya protegidas por Access. Los servicios externos
// y D1 se reemplazan por dobles ficticios: nunca se consulta producción.
const routeBody = worker.match(/async function rutasPanel\(request, env, url, usuario\) \{[\s\S]*?\n\}\n\nfunction cabecerasPanel/);
const importeBody = worker.match(/function normalizarImporte\(v\) \{[\s\S]*?\n\}/);
assert.ok(routeBody && importeBody, "Localizar las funciones existentes del Worker");
const factory = new Function("asegurarEsquema", "json", "REGIMENES", "USOS", "SERVICIOS", "FORMAS_PAGO",
  rules.replace(/^export /gm, "") + "\n" + importeBody[0] + "\n" +
  routeBody[0].replace(/\nfunction cabecerasPanel$/, "") + "\nreturn rutasPanel;");

const catalogos = { regimenes: { "612": "Actividad empresarial" }, usos: { G03: "Gastos en general" } };
const uid = n => "00000000-0000-4000-8000-" + String(n).padStart(12, "0");
const base = n => ({
  id: uid(n), estado: "pendiente", servicio: "bascula", folio_ticket: "17-097",
  rfc: "RIGM800101ABC", nombre: "CLIENTE FICTICIO", regimen: "612", cp: "30710",
  uso: "G03", importe: "150.00"
});

function entorno(inicial) {
  const registros = inicial.map(x => ({ ...x }));
  const folios = [];
  const db = {
    prepare(sql) {
      return {
        sql, parametros: [],
        bind(...params) { this.parametros = params; return this; },
        async first() {
          const a = this.parametros;
          if (sql.startsWith("SELECT * FROM solicitudes WHERE id")) return registros.find(x => x.id === a[0]) || null;
          if (sql.includes("FROM facturas_folios")) return folios.find(x => x.servicio === a[0] && x.folio_normalizado === a[1]) || null;
          if (sql.includes("FROM solicitudes WHERE id != ?")) return registros.find(x =>
            x.id !== a[0] && x.servicio === a[1] && ["facturada", "enviada"].includes(x.estado) &&
            x.folio_ticket.replace(/[\s-]/g, "").toUpperCase() === a[2]) || null;
          return null;
        },
        async run() {
          const a = this.parametros;
          if (sql.includes("INSERT INTO facturas_folios")) {
            if (folios.some(x => x.servicio === a[0] && x.folio_normalizado === a[1])) throw Error("UNIQUE constraint");
            folios.push({ servicio: a[0], folio_normalizado: a[1], solicitud_id: a[2], folio_factura: a[3] });
          }
          if (sql.startsWith("UPDATE solicitudes SET estado='en_revision'")) registros.find(x => x.id === a[0]).estado = "en_revision";
          if (sql.startsWith("UPDATE solicitudes SET estado='facturada'")) Object.assign(registros.find(x => x.id === a[4]), {
            estado: "facturada", folio_factura: a[0], importe: a[1], folio_ticket: a[2], resuelta_en: a[3]
          });
          if (sql.startsWith("UPDATE solicitudes SET estado='enviada'")) Object.assign(registros.find(x => x.id === a[1]), { estado: "enviada", enviada_en: a[0] });
          if (sql.startsWith("UPDATE solicitudes SET estado='rechazada'")) registros.find(x => x.id === a[2]).estado = "rechazada";
          return { success: true };
        },
        async all() { return { results: [] }; }
      };
    },
    async batch(preparadas) { for (const p of preparadas) await p.run(); return []; }
  };
  const json = (body, status = 200) => ({ body, status });
  const ruta = factory(async () => {}, json, catalogos.regimenes, catalogos.usos, { bascula: "Báscula", pension: "Pensión" }, {});
  const enviar = async (id, accion, datos = {}) => ruta(
    { method: "POST", json: async () => datos },
    { DB: db },
    { pathname: "/panel/api/solicitudes/" + id + "/" + accion },
    { email: "admin@example.invalid" }
  );
  return { enviar, registros, folios };
}

test("Registro y entrega: sólo después de emitir CFDI", async () => {
  const e = entorno([base(1)]);
  assert.equal((await e.enviar(uid(1), "enviada")).status, 409);
  assert.equal((await e.enviar(uid(1), "en-revision")).status, 200);
  assert.equal((await e.enviar(uid(1), "facturar", { folio_factura: "CFDI-1", importe: "150.00", folio_ticket: "17-097" })).status, 200);
  assert.equal((await e.enviar(uid(1), "enviada")).status, 200);
  assert.equal(e.registros[0].estado, "enviada");
  assert.ok(e.registros[0].enviada_en);
});

test("Validaciones en servidor: importe positivo y datos fiscales completos", async () => {
  const e = entorno([base(1)]);
  assert.equal((await e.enviar(uid(1), "facturar", { folio_factura: "CFDI-1", importe: "", folio_ticket: "17-097" })).status, 422);
  e.registros[0].cp = "";
  assert.equal((await e.enviar(uid(1), "facturar", { folio_factura: "CFDI-1", importe: "150", folio_ticket: "17-097" })).status, 422);
  assert.equal(e.folios.length, 0);
});

test("No factura dos veces el mismo servicio y folio normalizado", async () => {
  const e = entorno([base(1), { ...base(2), folio_ticket: "17097" }]);
  assert.equal((await e.enviar(uid(1), "facturar", { folio_factura: "CFDI-1", importe: "150", folio_ticket: "17-097" })).status, 200);
  const respuesta = await e.enviar(uid(2), "facturar", { folio_factura: "CFDI-2", importe: "150", folio_ticket: "17097" });
  assert.equal(respuesta.status, 409);
  assert.equal(respuesta.body.duplicado, true);
  assert.equal(e.folios.length, 1);
  assert.equal(e.registros[1].estado, "pendiente");
});
