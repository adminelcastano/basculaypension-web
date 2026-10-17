import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { posiblesPagosRepetidos } from "../src/caja.js";

const gasto = (concepto, monto, forma = "EFECTIVO", origen = null) =>
  ({ concepto, monto, forma, origen });
const retiro = (concepto, monto) => ({ concepto, monto });

test("Identifica la coincidencia de sueldo registrado y retirado", () => {
  assert.deepEqual(
    posiblesPagosRepetidos([gasto("Sueldo", 1000)], [retiro("Sueldo", 1000)]),
    [retiro("Sueldo", 1000)]
  );
});

test("Nombres con acentos, mayúsculas y espacios son equivalentes", () => {
  assert.equal(posiblesPagosRepetidos(
    [gasto("NÓMINA  del turno", 150)],
    [retiro("nomina del turno", 150)]
  ).length, 1);
});

test("No bloquea retiros diferentes del gasto original", () => {
  assert.equal(posiblesPagosRepetidos(
    [gasto("Sueldo", 1000)], [retiro("Taxi", 1000), retiro("Sueldo", 800)]
  ).length, 0);
});

test("No considera gastos de tarjeta ni administración como egresos físicos del turno", () => {
  assert.equal(posiblesPagosRepetidos(
    [gasto("Sueldo",1000,"TARJETA"),gasto("Sueldo",1000,"EFECTIVO","admin")],
    [retiro("Sueldo",1000)]
  ).length, 0);
});

test("Detecta sin deduplicar ni borrar pagos legítimos coincidentes", () => {
  const gastos = [gasto("Sueldo",100),gasto("Taxi",50)];
  const retiros = [retiro("Sueldo",100),retiro("Taxi",50)];
  const originales=JSON.stringify({gastos,retiros});
  assert.equal(posiblesPagosRepetidos(gastos,retiros).length,2);
  assert.equal(JSON.stringify({gastos,retiros}),originales);
});

test("Servidor exige declaración explícita y audita dos pagos distintos", () => {
  const servidor=readFileSync(new URL("../src/turno.js", import.meta.url),"utf8");
  assert.match(servidor,/SELECT concepto, monto, forma, origen FROM caja_gastos/);
  assert.match(servidor,/const coincidencias = posiblesPagosRepetidos\(gastosPrevios, retiros\)/);
  assert.match(servidor,/coincidencias\.length && c\.pagos_distintos !== true/);
  assert.match(servidor,/pagos_distintos_confirmados: coincidencias\.map/);
  assert.match(servidor,/INSERT INTO turno_cortes_hist/);
});

test("Tablet transmite la declaración y mantiene el corte ciego", () => {
  const html=readFileSync(new URL("../src/turno.html", import.meta.url),"utf8");
  assert.match(html,/pagos_distintos: coincidencias\(\)\.length > 0/);
  assert.match(html,/dup-confirmo/);
  assert.match(html,/const ef = importe\(f\.efectivo\.value\)/);
  assert.match(html,/Sobre: \$\{dinero\(num\(f\.sobre\.value\)\)\}/);
  const scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)];
  for(const m of scripts) if(m[1].trim()) assert.doesNotThrow(()=>new Function(m[1]));
});
