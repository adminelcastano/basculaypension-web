// Pruebas de los cálculos de dinero (sin base de datos): node --test pruebas/
import { test } from "node:test";
import assert from "node:assert/strict";
import { calcularCortes, unirConteos, totalesMes, transferenciasMes, cambiosEntreTurnos, turnoAnterior, turnoSiguiente } from "../src/caja.js";
import { flujosMes, encadenarSaldos, comisionDe } from "../src/cuentas.js";
import { diferenciasCaja, retirosDeCortes, resumenSueldos, transfConCuenta } from "../src/finanzas.js";

const ticket = (servicio, folio, dia, turno, importe, forma) => ({ tipo: "ticket", servicio, folio, fecha: dia + "T10:00:00", dia, turno, importe, forma, mes: dia.slice(0, 7) });
const MP = { id: "mdo-pago", nombre: "MDO PAGO", tipo: "debito", tarjeta: 1, def_transf: 0, comision_pct: 3.49, comision_iva: 1, activa: 1 };
const PYME = { id: "bbva-pyme", nombre: "BBVA PYME", tipo: "debito", tarjeta: 0, def_transf: 1, activa: 1 };
const BANORTE = { id: "banorte-credito", nombre: "BANORTE CREDITO", tipo: "credito", tarjeta: 0, def_transf: 0, activa: 1 };
const CUENTAS = [MP, PYME, BANORTE];

test("comisión de Mercado Pago: 3.49% + IVA por cobro, redondeada", () => {
  assert.equal(comisionDe(1000, MP), 40.48);
  assert.equal(comisionDe(350, MP), 14.17);
  assert.equal(comisionDe(1000, { ...MP, comision_pct: null }), 0);
  assert.equal(comisionDe(1000, { ...MP, comision_iva: 0 }), 34.9);
});

test("transferencias: tickets de la hoja + capturadas, sin contar dos veces", () => {
  const movs = [ticket("pension", "100", "2026-10-05", "TARDE", 600, "TRANSFERENCIA"), ticket("bascula", "200", "2026-10-06", "MAÑANA", 150, "TRANSFERENCIA")];
  const transf = [
    { id: "a", fecha: "2026-10-05", importe: 600, cliente: "Transportes X", ticket_ref: "pension:100", cuenta: "bbva-pyme" }, // ligada: no cuenta otra vez
    { id: "b", fecha: "2026-10-06", importe: 150, cliente: "Y", ticket_ref: null },                                         // suelta igual a un ticket: posible duplicado
    { id: "c", fecha: "2026-10-07", importe: 999, cliente: "Z", ticket_ref: "pension:999" }                                 // su ticket ya no está: cuenta ella
  ];
  const tr = transferenciasMes(movs, transf);
  assert.equal(tr.total_hoja, 750);
  assert.deepEqual(tr.contadas.map(x => x.id), ["b", "c"]);
  assert.deepEqual(tr.posibles, [{ id: "b", tickets: ["bascula:200"] }]);
  const cortes = calcularCortes(movs, []);
  const t = totalesMes(cortes, tr.contadas);
  assert.equal(t.transferencias, 750 + 150 + 999);
  assert.equal(t.transf_hoja, 750);
  assert.equal(t.efectivo, 0); // la transferencia no entra a la caja del turno
  // Cuenta a la que llega cada una
  const cc = transfConCuenta(movs, transf, "bbva-pyme");
  assert.equal(cc.find(x => x.ref === "pension:100").cuenta, "bbva-pyme");
  assert.equal(cc.find(x => x.ref === "bascula:200").cuenta, "bbva-pyme");
});

test("cambio entre turnos: lo que dejó uno contra lo que recibió el siguiente", () => {
  assert.deepEqual(turnoAnterior("2026-10-01", "MAÑANA"), { dia: "2026-09-30", turno: "NOCHE" });
  assert.deepEqual(turnoSiguiente("2026-10-31", "NOCHE"), { dia: "2026-11-01", turno: "MAÑANA" });
  const conteos = [{ dia: "2026-10-05", turno: "MAÑANA", persona: "ANA", cambio_sig: 500 }];
  const inicios = [{ dia: "2026-10-05", turno: "TARDE", persona: "LUIS", cambio: 450 }, { dia: "2026-10-05", turno: "NOCHE", persona: "PEDRO", cambio: 300 }];
  const m = cambiosEntreTurnos(conteos, inicios);
  assert.equal(m.size, 1); // la noche no tiene corte de la tarde con qué comparar
  assert.equal(m.get("2026-10-05|TARDE").dif, -50);
});

test("corte, diferencias de caja y retiros del corte", () => {
  const movs = [ticket("pension", "1", "2026-10-05", "MAÑANA", 1000, "EFECTIVO"), ticket("bascula", "2", "2026-10-05", "MAÑANA", 1000, "TARJETA")];
  const inicios = [{ dia: "2026-10-05", turno: "MAÑANA", persona: "ANA", cambio: 500 }];
  const gastos = [{ dia: "2026-10-05", turno: "MAÑANA", monto: 100, forma: "EFECTIVO", categoria: "Sueldos", persona: "ANA" }];
  const conteos = [{ dia: "2026-10-05", turno: "MAÑANA", persona: "ANA", efectivo: 1350, con_cambio: 1, sobre: 800, cambio_sig: 500, retiros: JSON.stringify([{ concepto: "Taxi", monto: 50 }, { concepto: "Sueldo Ana", monto: 0 }]) }];
  const cortes = unirConteos(calcularCortes(movs, gastos, [], inicios), conteos);
  assert.equal(cortes[0].efectivo_caja, 1400);       // 500 cambio + 1000 efectivo − 100 gasto
  assert.equal(cortes[0].conteo.dif_efectivo, -50);  // contó 1350: faltaron 50
  const dif = diferenciasCaja(cortes, [{ dia: "2026-10-05", turno: "TARDE", de: { persona: "ANA" }, dejado: 500, recibio: "LUIS", recibido: 450, dif: -50 }]);
  assert.equal(dif.faltantes, 100);
  assert.equal(dif.sobrantes, 0);
  const ret = retirosDeCortes(conteos);
  assert.deepEqual(ret.map(r => [r.concepto, r.monto]), [["Taxi", 50]]); // el de monto 0 no cuenta
  const s = resumenSueldos(gastos, [{ persona: "ANA", monto: 200, categoria: "Sueldos" }], [{ concepto: "Pago: Sueldo mantenimiento Juan", monto: 1500, categoria: "Sueldos" }]);
  assert.equal(s.total_caja, 300);
  assert.equal(s.caja[0].persona, "ANA");
  assert.equal(s.admin[0].concepto, "Sueldo mantenimiento Juan");
  assert.equal(s.total, 1800);
});

test("flujos del mes: tarjeta neta, transferencias, pagos, sobres y movimientos", () => {
  const f = flujosMes({
    tarjeta: [{ dia: "2026-10-05", importe: 1000 }, { dia: "2026-10-06", importe: 1000 }],
    transf: [{ fecha: "2026-10-05", importe: 600, cuenta: "bbva-pyme" }, { fecha: "2026-10-06", importe: 50, cuenta: null }],
    admin: [
      { dia: "2026-10-07", forma: "TRANSFERENCIA", cuenta: "bbva-pyme", monto: 300, concepto: "Luz" },
      { dia: "2026-10-07", forma: "TARJETA", cuenta: "banorte-credito", monto: 200, concepto: "Refacción" },
      { dia: "2026-10-08", forma: "EFECTIVO", cuenta: null, monto: 1500, concepto: "Sueldo mantenimiento", cat: "no_programado" }
    ],
    movs: [
      { tipo: "pago_tarjeta", origen: "bbva-pyme", destino: "banorte-credito", importe: 150, fecha: "2026-10-09", creado: "1" },
      { tipo: "deposito", origen: "sobres", destino: "bbva-pyme", importe: 1000, fecha: "2026-10-10", creado: "2" },
      { tipo: "retiro", origen: "mdo-pago", destino: "sobres", importe: 400, fecha: "2026-10-11", creado: "3" }
    ],
    sobres: [{ dia: "2026-10-05", turno: "MAÑANA", persona: "ANA", sobre: 800 }],
    cambio: [{ dia: "2026-10-06", turno: "TARDE", monto: 200 }]
  }, CUENTAS);
  assert.equal(f.tarjeta, 2000);
  assert.equal(f.comision, 80.96);
  assert.equal(f.cuentas["mdo-pago"].entradas, 1919.04);
  assert.equal(f.cuentas["mdo-pago"].salidas, 400);
  assert.equal(f.cuentas["bbva-pyme"].entradas, 1600);   // 600 transferencia + 1000 depósito
  assert.equal(f.cuentas["bbva-pyme"].salidas, 450);     // 300 luz + 150 pago de tarjeta
  assert.equal(f.cuentas["banorte-credito"].salidas, 200);   // cargo
  assert.equal(f.cuentas["banorte-credito"].entradas, 150);  // pago
  assert.equal(f.sin_cuenta.transferencias, 50);
  assert.equal(f.sobres.entradas, 800 + 400);
  assert.equal(f.sobres.salidas, 1500 + 1000 + 200);
});

test("saldos encadenados: pasan solos al mes siguiente y la captura muestra el ajuste", () => {
  const meses = ["2026-09", "2026-10", "2026-11"];
  const flujos = { "2026-09": { sobres: { entradas: 1000, salidas: 300 }, "banorte-credito": { entradas: 100, salidas: 500 } }, "2026-10": { sobres: { entradas: 500, salidas: 0 } }, "2026-11": { sobres: { entradas: 0, salidas: 100 } } };
  const capturas = { "2026-09": { sobres: 2000, "banorte-credito": 1000 }, "2026-11": { sobres: 3100 } };
  const r = encadenarSaldos(meses, ["sobres", "banorte-credito", "bbva-pyme"], capturas, flujos, new Set(["banorte-credito"]));
  // sobres: sep 2000 → 2700; oct 2700 → 3200; nov contado 3100 (ajuste −100) → 3000
  assert.equal(r.sobres.inicial, 3100);
  assert.equal(r.sobres.calculado, 3200);
  assert.equal(r.sobres.ajuste, -100);
  assert.equal(r.sobres.saldo, 3000);
  // crédito: deuda 1000 + cargos 500 − pagos 100 = 1400 y se queda igual
  assert.equal(r["banorte-credito"].saldo, 1400);
  assert.equal(r["banorte-credito"].capturado, false);
  // sin ninguna captura no hay saldo
  assert.equal(r["bbva-pyme"].saldo, null);
});
