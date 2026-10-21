import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {cotejarCuentasMes} from "../src/finanzas-cotejo.js";
const cuentas=[{id:"debito",nombre:"Banco sintético",tipo:"debito",saldo:300.25},{id:"credito",nombre:"Tarjeta de prueba",tipo:"credito",saldo:null}];
test("Cotejo solo compara si fechas y referencias coinciden, sin inventar saldos",()=>{
 const estados=[
  {cuenta:"debito",periodo_desde:"2026-09-01",periodo_hasta:"2026-09-30",fecha_corte:"2026-09-30",saldo_final:30125},
  {cuenta:"credito",periodo_desde:"2026-09-01",periodo_hasta:"2026-09-30",fecha_corte:"2026-09-30",saldo_final:9900}
 ];
 const x=cotejarCuentasMes(cuentas,estados,"2026-09","2026-10-21");
 assert.equal(x[0].comparable,true);
 assert.equal(x[0].saldo_calculado,300.25);
 assert.equal(x[0].saldo_confirmado,301.25);
 assert.equal(x[0].diferencia,1);
 assert.equal(x[1].diferencia,null);
 assert.match(x[1].observacion,/Sin saldo calculado/);
 const cruce=cotejarCuentasMes(cuentas,[{...estados[0],fecha_corte:"2026-09-25",periodo_hasta:"2026-09-25"}],"2026-09","2026-10-21");
 assert.equal(cruce[0].comparable,false);
 assert.equal(cruce[0].diferencia,null);
 assert.equal(cruce[0].fecha_corte_confirmada,"2026-09-25");
 const mesEnCurso=cotejarCuentasMes(cuentas,estados,"2026-09","2026-09-30");
 assert.equal(mesEnCurso[0].comparable,false);
 assert.equal(mesEnCurso[0].diferencia,null);
});
test("Interfaz y ruta leen dos referencias, sin UPDATE compensatorio",()=>{
 const fin=readFileSync(new URL("../src/finanzas.js",import.meta.url),"utf8");
 const ui=readFileSync(new URL("../src/panel/cliente/05b-estados.js",import.meta.url),"utf8");
 assert.match(fin,/cotejarCuentasMes\(datos\.banco\.lista/);
 assert.ok(fin.includes("ROW_NUMBER() OVER(PARTITION BY cuenta"));
 assert.ok(fin.includes("WHERE rn=1"));
 assert.match(fin,/if \(partes\[1\] === "cotejo-estados"/);
 assert.match(ui,/Saldo calculado/);
 assert.match(ui,/Saldo confirmado/);
 assert.match(ui,/No comparable/);
 assert.match(ui,/finanzas\/cotejo-estados\?mes=/);
});
