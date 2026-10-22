import test from "node:test";
import assert from "node:assert/strict";
import {turnoSugerido,diaDeTurno,local,TZ} from "../src/turno-tiempo.js";
import {turnoSugerido as publico,diaDeTurno as diaPublico} from "../src/turno.js";
test("Noche cruza medianoche sin cambiar el día del corte",()=>{
 const antes=new Date("2026-10-21T11:00:00Z");
 assert.equal(TZ,"America/Mexico_City");assert.equal(local(antes).dia,"2026-10-21");
 assert.equal(turnoSugerido(antes),"NOCHE");assert.equal(diaDeTurno("NOCHE",antes),"2026-10-20");
 assert.equal(publico(antes),turnoSugerido(antes));assert.equal(diaPublico("NOCHE",antes),diaDeTurno("NOCHE",antes));
});
test("Mañana, tarde, noche mantienen margen de treinta minutos",()=>{
 assert.equal(turnoSugerido(new Date("2026-10-21T12:00:00Z")),"MAÑANA");
 assert.equal(turnoSugerido(new Date("2026-10-21T21:00:00Z")),"TARDE");
 assert.equal(turnoSugerido(new Date("2026-10-22T05:00:00Z")),"NOCHE");
});
