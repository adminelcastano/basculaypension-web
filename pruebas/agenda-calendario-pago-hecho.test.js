import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const src = path => readFileSync(new URL("../" + path, import.meta.url), "utf8");

// Reproduce exactamente el caso de producción: calendario mensual con un pago hecho
// el día seleccionado. La función vive en Pagos y debe inyectarse en Calendario.
test("Agenda abre calendario con pagos ya registrados sin ReferenceError", () => {
  const window = {
    catChip: () => "",
    medioTxt: () => "Efectivo (sobres)"
  };
  const sandbox = { window, setTimeout: () => 1 };
  vm.runInNewContext(src("src/panel/cliente/07-pagos-controlador.js"), sandbox);
  vm.runInNewContext(src("src/panel/cliente/07-calendario-controlador.js"), sandbox);

  const fecha = "2026-10-22";
  const st = {
    hoy: fecha, sel: fecha, mes: "2026-10", vistaCal: "mes",
    items: [], mesesAbiertos: ["2026-10"],
    pagosHechos: [{ id: "pago-prueba", titulo: "Pago de luz de prueba", fecha,
      importe: 123.45, forma: "EFECTIVO", categoria: "", comprobante: null }]
  };
  const esc = x => String(x ?? "");
  const formateador = new Intl.DateTimeFormat("es-MX", { dateStyle: "long", timeZone: "UTC" });
  const mes = new Intl.DateTimeFormat("es-MX", { month: "long", year: "numeric", timeZone: "UTC" });
  const MXN = v => "$" + Number(v).toFixed(2);
  const pagos = window.CastaPagosControlador({
    st, ico: () => "", esc, MXN, diaTxt: d => d, mayus: x => x,
    fMes: mes, post: () => {}, cargar: () => {}, toast: () => {}
  });
  assert.equal(typeof pagos.filaPagoHecho, "function");
  const calendario = window.CastaCalendarioControlador({
    st, $: () => null, esc, toast: () => {}, post: () => {},
    fLargo: formateador, fMes: mes, mayus: x => x, ico: () => "",
    abierto: () => true, cargar: () => {}, pintar: () => {},
    formulario: () => "", item: () => "", MXN,
    filaPagoHecho: pagos.filaPagoHecho
  });
  const html = calendario.vistaCalendario();
  assert.match(html, /Pago de luz de prueba/);
  assert.match(html, /123\.45/);
  assert.match(html, /data-editar-pago="pago-prueba"/);
  assert.match(html, /data-borrar-pago="pago-prueba"/);
  assert.match(html, /con pagos hechos/);

  // Un día sin pagos y la vista Agenda siguen abriendo con los mismos datos.
  st.sel = "2026-10-23";
  assert.doesNotMatch(calendario.vistaCalendario(), /Pago de luz de prueba/);
  st.vistaCal = "agenda";
  assert.doesNotThrow(() => calendario.vistaCalendario());
});

test("Agenda enlaza el renderizador compartido sin globales ni copias de pagos", () => {
  const agenda = src("src/panel/cliente/07-agenda.js");
  const pagos = src("src/panel/cliente/07-pagos-controlador.js");
  const calendario = src("src/panel/cliente/07-calendario-controlador.js");
  assert.match(pagos, /return \{ filaPagoHecho, listaPagosHechos, ventanaPago, ventanaProgramar \}/);
  assert.match(agenda, /const \{ filaPagoHecho, listaPagosHechos, ventanaPago, ventanaProgramar \} = window\.CastaPagosControlador/);
  assert.match(agenda, /formulario, item, MXN, filaPagoHecho\s*\}\);/);
  assert.match(calendario, /\bMXN, filaPagoHecho \} = dependencias/);
});
