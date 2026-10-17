import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { armarHoy } from "../src/hoy.js";
import { entregasAdmin } from "../src/caja.js";
import {
  leerTablaHistoricos, evaluarHistorico, esTurnoHistorico
} from "../src/caja-historicos.js";

test("Los 40 turnos históricos terminan en 14/oct mañana", () => {
  let total = 0;
  for (let d = 1; d <= 13; d++) for (const turno of ["MAÑANA", "TARDE", "NOCHE"]) {
    assert.equal(esTurnoHistorico("2026-10-" + String(d).padStart(2,"0"), turno), true);
    total++;
  }
  assert.ok(esTurnoHistorico("2026-10-14", "MAÑANA"));
  total++;
  assert.equal(total, 40);
  assert.equal(esTurnoHistorico("2026-10-14", "TARDE"), false);
  assert.equal(esTurnoHistorico("2026-10-15", "MAÑANA"), false);
});

test("Guion significa desconocido y cero significa valor conocido", () => {
  const a = leerTablaHistoricos("01-oct\tMañana\t—\t—\t—\t—");
  const b = leerTablaHistoricos("01-oct\tTarde\t0\t0\t0\t0");
  assert.equal(a.filas.length,1);
  assert.equal(a.filas[0].estado, "sin_datos");
  assert.equal(a.filas[0].sobre, null);
  assert.equal(b.filas[0].estado, "por_verificar");
  assert.equal(b.filas[0].sobre, 0);
  assert.equal(b.filas[0].reparto, 0);
});

test("Un reparto completo sólo cuadra con total contado independiente", () => {
  const t = "03-oct\tNoche\t0\t0\t500\t130";
  const pendiente = leerTablaHistoricos(t).filas[0];
  assert.equal(pendiente.estado, "por_verificar");
  const exacto = leerTablaHistoricos(t + "\t630").filas[0];
  assert.equal(exacto.estado, "cuadra");
  assert.equal(exacto.diferencia, 0);
  const diferencia = leerTablaHistoricos(t + "\t600").filas[0];
  assert.equal(diferencia.estado, "no_cuadra");
  assert.equal(diferencia.diferencia, 30);
});

test("No inventa ceros donde faltan sueldo o retiro", () => {
  const r = leerTablaHistoricos("01-oct\tTarde\t3500\t200\t—\t130\t3830");
  assert.equal(r.filas[0].estado, "incompleto");
  assert.equal(r.filas[0].sueldo, null);
});

test("Asterisco significa dato por verificar y no cifra confirmada", () => {
  const x = leerTablaHistoricos("07-oct\tMañana\t0\t0\t0\t239*\t239");
  assert.equal(x.filas[0].estado, "por_verificar");
  assert.equal(x.filas[0].dudoso, true);
});

test("No admite turnos duplicados, fechas ajenas ni importes malformados", () => {
  const r = leerTablaHistoricos(
    "01-oct\tMañana\t0\t0\t0\t0\n" +
    "01-oct\tMañana\t0\t0\t0\t0\n" +
    "14-oct\tTarde\t0\t0\t0\t0\n" +
    "05-oct\tNoche\tSI\t0\t0\t0"
  );
  assert.equal(r.filas.length, 1);
  assert.equal(r.errores.length, 3);
});

test("No se escribe en las tablas que alimentan Caja y Dinero", () => {
  const src = readFileSync(new URL("../src/caja-historicos.js", import.meta.url), "utf8");
  for (const t of ["caja_mov", "turno_cortes", "caja_gastos", "fin_saldos", "caja_extra"]) {
    assert.doesNotMatch(src, new RegExp("(INSERT INTO|UPDATE|DELETE FROM)\\s+" + t + "\\b", "i"));
  }
  assert.match(src, /INSERT INTO caja_cortes_historicos_hist/);
  const ui = readFileSync(new URL("../src/panel/cliente/03-caja.js", import.meta.url), "utf8");
  assert.doesNotThrow(() => new Function(ui));
  assert.match(ui, /caja\/historicos/);
  assert.match(ui, /Revisar sin guardar/);
});

test("La carga histórica no se guarda si octubre ya está cerrado", () => {
  const src = readFileSync(new URL("../src/caja.js", import.meta.url), "utf8");
  assert.match(src, /c\.aplicar === true && !meses\.includes\("2026-10"\)/);
  assert.match(src, /procesarHistoricos\(env, c\.texto/);
  const ui = readFileSync(new URL("../src/panel/cliente/03-caja.js", import.meta.url), "utf8");
  assert.match(ui, /No registra sobres, ingresos, retiros ni gastos contables/);
  assert.match(ui, /const historicos = new Set/);
  assert.match(ui, /j\.historico && !k/);
});

test("Los turnos anteriores a la tablet no generan alertas falsas de corte sin entregar", () => {
  const corte = (dia, turno, registros) => ({
    dia, turno, registros, conteo:null, efectivo:0, tarjeta:0,
    bascula:{EFECTIVO:0,TARJETA:0}, pension:{EFECTIVO:0,TARJETA:0},
    gastos:{EFECTIVO:0,TARJETA:0,TRANSFERENCIA:0},
    extra:{ingreso:0,importe:0}, caja:{n:0,importe:0},
    cambio:{n:0,importe:0}, efectivo_caja:0, fuera:{formas:{}}
  });
  const cortes=[
    corte("2026-10-13","TARDE",5),
    corte("2026-10-14","MAÑANA",3),
    corte("2026-10-14","TARDE",4)
  ];
  // 15/oct a las 12:00 en México, antes de que venza la gracia de turno siguiente.
  const p = armarHoy({ caja: { cortes }, agenda:{}, pagos:{} }, new Date("2026-10-15T18:00:00Z"));
  const avisos = p.atencion.filter(x => x.clave === "sin-corte");
  assert.equal(avisos.length, 1);
  assert.match(avisos[0].titulo, /14|ayer/);
  assert.ok(!avisos[0].detalle.includes("13 oct"));
});

test("El importador antiguo no puede convertir los 40 turnos históricos en dinero", async () => {
  const consultas=[];
  const env={
    DB:{
      prepare(sql){
        consultas.push(sql);
        return { bind(){return { all:async()=>({results:[]})}} };
      },
      batch(){throw new Error("No debía escribir en D1");}
    }
  };
  const r=await entregasAdmin(env, "13-oct\tNoche\t2000\t200\t100\t150", {
    aplicar:true, meses:["2026-10"], hoy:"2026-10-17", quien:"admin"
  });
  assert.equal(r.aplicado,true);
  assert.equal(r.totales.turnos,0);
  assert.equal(r.filas[0].estado,"fuera");
  assert.match(r.filas[0].avisos.join(" "), /Cortes históricos/);
  assert.equal(consultas.some(x => /INSERT INTO turno_cortes/i.test(x)), false);
});

test("Caja presenta la falta de documentos antiguos sin exigir tablet", () => {
  const ui = readFileSync(new URL("../src/panel/cliente/03-caja.js",import.meta.url),"utf8");
  assert.match(ui,/const esAnteriorTablet/);
  assert.match(ui,/Registro histórico pendiente/);
  assert.match(ui,/!anteriorTablet && !j\.historico/);
});
