import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const sourceOf = name => readFileSync(new URL("../src/panel/cliente/" + name, import.meta.url), "utf8");

// Al refactorizar Agenda, la fecha se usaba desde el módulo de Compras, pero
// fDia había quedado definida únicamente dentro de 07-agenda.js.
test("Compras con historial y precio anterior no provoca fDia is not defined", () => {
  const window = { catChip: () => "", medioTxt: () => "Efectivo" };
  const localStorage = { getItem: () => "" };
  vm.runInNewContext(sourceOf("07-compras-controlador.js"), { window, localStorage, setTimeout: () => 1 });
  const st = {
    items: [
      { id: "c1", tipo: "compra", estado: "pendiente", titulo: "Papel térmico", lugar: "", prioridad: "alta", creado: "2026-10-22T12:00:00Z" },
      { id: "c2", tipo: "compra", estado: "comprado", titulo: "Gasolina", lugar: "", gasto_id: "g2", dia_gasto: "2026-10-20", cerrado: "2026-10-20T18:00:00Z", importe: 250, monto_gasto: 250 }
    ],
    memoria: [{ norm: "papel termico", titulo: "Papel térmico", veces: 3, precio: { importe: 120.5, fecha: "2026-10-19" }, ultimo: { lugar: "", cantidad: "1 caja" } }],
    lugares: [], lugarFiltro: "", tienda: null
  };
  const fDia = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", timeZone: "UTC" });
  const api = window.CastaComprasControlador({
    st, abierto: x => x.estado !== "comprado", esc: String, ico: () => "", formEditar: () => "",
    avP: () => "", selLugar: () => "<select></select>", MXN: x => "$" + Number(x).toFixed(2),
    post: async () => {}, toast: () => {}, cargar: async () => {}, pintar: () => {},
    formulario: () => "", $: () => null, fDia
  });
  const html = api.vistaCompras();
  assert.match(html, /Papel térmico/);
  assert.match(html, /Última vez/);
  assert.match(html, /Gasolina/);
  assert.match(html, /Compradas en los últimos 30 días/);
  assert.doesNotMatch(html, /undefined/);
  st.tienda = "todos";
  assert.match(api.vistaCompras(), /En la tienda/);
});

test("Agenda comparte explícitamente fecha y renderer de pagos con sus controladores", () => {
  const agenda = sourceOf("07-agenda.js");
  const compras = sourceOf("07-compras-controlador.js");
  const calendario = sourceOf("07-calendario-controlador.js");
  const pagos = sourceOf("07-pagos-controlador.js");
  assert.match(agenda, /MXN, post, toast, cargar, pintar, formulario, \$, fDia/);
  assert.match(compras, /\$, fDia \} = contexto;/);
  assert.match(calendario, /MXN, filaPagoHecho \} = dependencias;/);
  assert.match(pagos, /return \{ filaPagoHecho, listaPagosHechos/);
});
