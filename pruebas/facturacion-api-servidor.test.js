import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const worker = readFileSync(new URL("../src/worker.js", import.meta.url), "utf8");
const rules = readFileSync(new URL("../src/facturacion-reglas.js", import.meta.url), "utf8");

// Aislamos únicamente las rutas ya protegidas por Access. Los servicios externos
// y D1 se reemplazan por dobles ficticios: nunca se consulta producción.
const routes = readFileSync(new URL("../src/worker-panel-rutas.js", import.meta.url), "utf8");
const routeBody = routes.match(/async function rutasPanel\(request, env, url, usuario\) \{[\s\S]*?\n\}/);
const importeFuente = readFileSync(new URL("../src/facturacion-entradas.js", import.meta.url), "utf8");
const importeBody = importeFuente.match(/function normalizarImporte\(v\) \{[\s\S]*?\n\}/);
assert.ok(routeBody && importeBody, "Localizar las funciones existentes del Worker");
const factory = new Function("asegurarEsquema", "json", "REGIMENES", "USOS", "SERVICIOS", "FORMAS_PAGO", "limiteHistorico", "DIAS_RETENCION", "listarCfdis", "emitirMultiples", "cancelarRegistro", "sustituirRegistro",
  rules.replace(/^export /gm, "") + "\n" + importeBody[0] + "\n" +
  routeBody[0] + "\nreturn rutasPanel;");

const catalogos = { regimenes: { "612": "Actividad empresarial" }, usos: { G03: "Gastos en general" } };
const uid = n => "00000000-0000-4000-8000-" + String(n).padStart(12, "0");
const base = n => ({
  id: uid(n), estado: "pendiente", servicio: "bascula", folio_ticket: "17-097",
  rfc: "RIGM800101ABC", nombre: "CLIENTE FICTICIO", regimen: "612", cp: "30710",
  uso: "G03", importe: "150.00"
});

function entorno(inicial, opciones = {}) {
  const registros = inicial.map(x => ({ ...x }));
  const folios = [];
  let lecturasConteos = 0;
  const db = {
    prepare(sql) {
      return {
        sql, parametros: [],
        bind(...params) { this.parametros = params; return this; },
        async first() {
          const a = this.parametros;
          if (sql.startsWith("SELECT * FROM solicitudes WHERE id")) return registros.find(x => x.id === a[0]) || null;
          if (sql.includes("FROM caja_pendientes")) return opciones.pendiente || null;
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
        async all() {
          if (sql.includes("GROUP BY grupo")) { lecturasConteos++; return { results: [{ grupo: "pendiente", n: 1 }] }; }
          if (sql.includes("FROM caja_mov")) return { results: opciones.movimientos || [] };
          return { results: [] };
        }
      };
    },
    async batch(preparadas) { for (const p of preparadas) await p.run(); return []; }
  };
  const json = (body, status = 200) => ({ body, status });
  const ruta = factory(async () => {}, json, catalogos.regimenes, catalogos.usos, { bascula: "Báscula", pension: "Pensión" }, {}, () => "2026-10-01T00:00:00.000Z", 90, async()=>[], async()=>({ok:false,status:422}), async()=>({ok:false,status:422}), async()=>({ok:false,status:422}));
  const detalle = async id => ruta(
    { method: "GET" },
    { DB: db },
    { pathname: "/panel/api/solicitudes/" + id },
    { email: "admin@example.invalid" }
  );
  const enviar = async (id, accion, datos = {}) => ruta(
    { method: "POST", json: async () => datos },
    { DB: db },
    { pathname: "/panel/api/solicitudes/" + id + "/" + accion },
    { email: "admin@example.invalid" }
  );
  const listar = async (estado, soloLista) => ruta(
    { method: "GET" }, { DB: db },
    { pathname: "/panel/api/solicitudes", searchParams: {
      get: clave => clave === "estado" ? estado : clave === "solo_lista" ? (soloLista ? "1" : null) : null
    } },
    { email: "admin@example.invalid" }
  );
  return { enviar, detalle, listar, lecturasConteos: () => lecturasConteos, registros, folios };
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

test("Conserva ceros iniciales y rechaza un folio no numérico", async () => {
  const e = entorno([{ ...base(1), folio_ticket: "0017097" }, { ...base(2), folio_ticket: "17097" }]);
  assert.equal((await e.enviar(uid(1), "facturar", { folio_factura: "CFDI-1", importe: "150", folio_ticket: "0017097" })).status, 200);
  assert.equal((await e.enviar(uid(2), "facturar", { folio_factura: "CFDI-2", importe: "150", folio_ticket: "17097" })).status, 200);
  assert.equal(e.folios.length, 2);
  const otro = entorno([{ ...base(3), folio_ticket: "ABC17097" }]);
  assert.equal((await otro.enviar(uid(3), "facturar", { folio_factura: "CFDI-3", importe: "150", folio_ticket: "ABC17097" })).status, 422);
  assert.equal(otro.folios.length, 0);
});

test("Aviso de Caja: distinguir pendiente, parcial, pagado, conciliado y cancelado", async () => {
  const movimientos = [{ folio: "17097", fecha: "2026-10-17", importe: 150, forma: "EFECTIVO" }];
  for (const [estado, esperado] of [
    ["pendiente", "cobro pendiente"], ["parcial", "cobro pendiente"],
    ["pagado", null], ["conciliado", null], ["cancelado", "cancelado"]
  ]) {
    const e = entorno([base(1)], { pendiente: { estado, monto: 150 }, movimientos });
    const r = await e.detalle(uid(1));
    assert.equal(r.status, 200, "Consulta de factura: " + estado);
    const aviso = r.body.contraste?.advertencia || "";
    if (esperado) assert.ok(aviso.includes(esperado), estado + ": " + aviso);
    else assert.equal(aviso, "", "No mostrar advertencia falsa a un cobro " + estado);
  }
});

test("El panel impide abrir Facturador desde una solicitud marcada como duplicada", () => {
  const panel = readFileSync(new URL("../src/panel/cliente/01-facturacion.js", import.meta.url), "utf8");
  assert.match(panel, /const duplicada = !!\(j\.ya_facturado/);
  assert.match(panel, /duplicada \? .*No emitir otro CFDI/);
  assert.match(panel, /disabled title="Ticket ya facturado"/);
});

test("La consulta rápida omite conteos; otras llamadas siguen entregándolos", async () => {
  const e = entorno([base(1)]);
  const rapida = await e.listar("facturada", true);
  assert.equal(rapida.status, 200);
  assert.deepEqual(rapida.body.conteos, {});
  assert.equal(e.lecturasConteos(), 0);
  const completa = await e.listar("pendiente", false);
  assert.equal(completa.status, 200);
  assert.equal(completa.body.conteos.pendiente, 1);
  assert.equal(e.lecturasConteos(), 1);
});
