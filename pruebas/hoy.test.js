// Pruebas del tablero de Hoy (sin base de datos): node --test pruebas/
import { test } from "node:test";
import assert from "node:assert/strict";
import { armarHoy, turnoEn } from "../src/hoy.js";

const corte = (dia, turno, extra = {}) => ({ dia, turno, efectivo: 1000, tarjeta: 200, registros: 3, gastos: { EFECTIVO: 50 }, extra: { importe: 0, ingreso: 0 }, cambio: { n: 1, importe: 500 }, efectivo_caja: 1450, fuera: { formas: { TRANSFERENCIA: 300 } }, ...extra });

test("turno de operación: la noche después de medianoche es del día anterior", () => {
  assert.deepEqual(turnoEn(new Date("2026-10-15T08:00:00Z")), { dia: "2026-10-14", turno: "NOCHE", fecha: "2026-10-15" }); // 2:00 a. m.
  assert.equal(turnoEn(new Date("2026-10-15T13:00:00Z")).turno, "MAÑANA"); // 7:00
  assert.equal(turnoEn(new Date("2026-10-15T21:00:00Z")).turno, "TARDE");   // 15:00
});

test("Hoy: lo urgente primero, cortes sin entregar agrupados y gracia del turno que acaba de terminar", () => {
  const ahora = new Date("2026-10-15T20:30:00Z"); // 14:30, turno de la tarde (media hora de gracia para la mañana)
  const r = armarHoy({
    caja: { conectado: true, sync: { at: ahora.toISOString() }, cortes: [
      corte("2026-10-15", "TARDE"),
      corte("2026-10-15", "MAÑANA"),                                        // recién terminado: todavía no se marca
      corte("2026-10-14", "NOCHE"), corte("2026-10-14", "TARDE"),           // sin corte: se agrupan
      corte("2026-10-13", "TARDE", { conteo: { persona: "ANA", dif_efectivo: -120 } })
    ] },
    facturas: { solicitudes: [{ creado: "2026-10-12T20:00:00Z" }], conteos: { pendiente: 1 } },
    agenda: { abiertos: { compra: 2 }, compras: [{ titulo: "Garrafones" }], vencidas: 0 },
    pagos: { vencidos: 0, proximos: [{ titulo: "Luz", fecha: "2026-10-17", importe: 900 }] },
    avisos: [], finanzas: null, personal: { conteos: { incompletos: 0 } }
  }, ahora);
  const claves = r.atencion.map(x => x.clave);
  assert.deepEqual(r.atencion.find(x => x.clave === "sin-corte").n, 2);
  assert.ok(!r.atencion.find(x => x.clave === "sin-corte").detalle.includes("mañana"));
  assert.ok(claves.indexOf("sin-corte") < claves.indexOf("pagos-pronto"));
  assert.ok(claves.includes("difs") && claves.includes("facturas") && claves.includes("compras"));
  assert.equal(r.atencion.find(x => x.clave === "facturas").nivel, "alta"); // más de 48 horas
  assert.equal(r.atencion[r.atencion.length - 1].nivel, "info");
  assert.equal(r.numeros.ingresos, 2 * (1000 + 200 + 300));
  assert.equal(r.turno.en_caja, 1450);
  assert.equal(r.semana.length, 7);
});
