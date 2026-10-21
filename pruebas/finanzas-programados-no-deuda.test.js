import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const src=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
test("Lo programado se etiqueta estimado sin convertirlo en deuda real",()=>{
 const agenda=src("src/panel/cliente/07-agenda.js");
 const inicio=src("src/panel/cliente/06-inicio.js");
 const pagina=src("src/panel/pagina.html");
 const api=src("src/agenda.js");
 assert.ok(agenda.includes("Pagos previstos este mes · estimado"));
 assert.ok(agenda.includes("previsiones aproximadas, no deudas confirmadas"));
 assert.ok(agenda.includes("previstos este mes (estimado)"));
 assert.ok(pagina.includes("Pagos previstos · estimado"));
 assert.ok(inicio.includes("pagos previstos"));
 assert.ok(api.includes('por_pagar_mes_tipo: "estimado_programado"'));
 assert.ok(api.includes("por_pagar_mes: pendMes.reduce"));
});
