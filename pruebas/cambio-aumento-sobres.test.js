import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  calcularCortes, unirConteos, totalesMes, cambiosEntreTurnos, claseHoja, esCambio, movimientosCaja,
  guardarCambioInicio, idAumentoInicio, totalCambioInicio, asegurarEsquemaCaja
} from "../src/caja.js";
import { flujosMes } from "../src/cuentas.js";
import { diferenciasCaja } from "../src/finanzas.js";

const dia = "2026-10-17", turno = "TARDE", persona = "JDOM";
const extra = (monto, ingreso = 0) => ({ id: idAumentoInicio(dia, turno), mes: "2026-10",
  dia, turno, concepto: "Aumento de cambio", monto, ingreso, persona });

test("Recibido 90 + aporte desde sobres 20 = 110 en caja, sin sobrante ni ingreso", () => {
  const corte = calcularCortes([], [], [extra(20)], [{ dia, turno, persona, cambio: 90 }])[0];
  assert.equal(corte.cambio.importe, 90);
  assert.equal(corte.extra.importe, 20);
  assert.equal(corte.extra.ingreso, 0);
  assert.equal(corte.efectivo_caja, 110);
  assert.equal(totalesMes([corte]).otros, 0);
  const cambios = cambiosEntreTurnos(
    [{ dia, turno: "MAÑANA", persona: "ERI", cambio_sig: 90 }],
    [{ dia, turno, persona, cambio: 90 }]
  );
  assert.equal(cambios.get(dia + "|TARDE").dif, 0);
  const conConteo = unirConteos([corte], [{ dia, turno, persona, efectivo: 110, con_cambio: 1 }]);
  assert.equal(conConteo[0].conteo.dif_efectivo, 0);
  assert.deepEqual(diferenciasCaja(conConteo, [...cambios.values()]).lista, []);
  assert.equal(totalCambioInicio(90, 20), 110);
});

test("Aumento adicional a medio turno usa el mismo origen (sobres), sin duplicar venta", () => {
  const extras = [extra(20), { ...extra(15), id: "manual-123", creado: dia + "T19:30:00Z" }];
  const c = calcularCortes([], [], extras, [{ dia, turno, persona, cambio: 90 }])[0];
  assert.equal(c.efectivo_caja, 125);
  assert.equal(c.extra.ingreso, 0);
  assert.equal(totalesMes([c]).otros, 0);
  const flujo = flujosMes({ cambio: extras, sobres: [] }, []);
  assert.equal(flujo.sobres.entradas, 0);
  assert.equal(flujo.sobres.salidas, 35);
  assert.deepEqual(flujo.sobres.movimientos.filter(x => x.tipo === "cambio").map(x => x.salida), [20,15]);
});

test("Aumentos de la hoja salen de sobres y no reemplazan el fondo inicial", () => {
  const m = { id: 123, mes: "2026-10", dia, turno, fecha: dia+"T16:00:00",
    servicio:"bascula", tipo: "caja", importe: 20,
    folio: "SE AGREGÓ AL CAMBIO", cliente: "", matricula: "", forma: "EFECTIVO" };
  assert.equal(claseHoja(m), "de_admin");
  assert.equal(esCambio(m), false); // no debe sobrescribir los $90 de cambio inicial
  const corte = calcularCortes([m], [], [], [{ dia, turno, persona, cambio:90 }])[0];
  assert.equal(corte.cambio.importe, 90);
  assert.equal(corte.caja.importe, 20);
  assert.equal(corte.efectivo_caja, 110);
  assert.equal(movimientosCaja({movs:[m]}).length,1); // queda en bitácora de movimientos
  const flujo = flujosMes({ hojaAdmin: [{ dia, turno, clase: "de_admin", monto: 20, concepto: m.folio }] }, []);
  assert.equal(flujo.sobres.salidas, 20);
  const viejo = { ...m, importe:90, folio:"CAMBIO" };
  assert.equal(esCambio(viejo), true); // preserva los fondos históricos originales
  assert.equal(claseHoja(viejo), "cambio");
});

function dbSimulada() {
  const inicio = new Map(), extras = new Map(), bitacora = [];
  const key = (d,t) => d + "|" + t;
  const DB = {
    prepare(sql) {
      return {
        sql, args: [],
        bind(...args) { this.args = args; return this; },
        async first() {
          if (sql.startsWith("SELECT cambio, persona FROM turno_inicio")) {
            const [d,t] = this.args; return inicio.get(key(d,t)) || null;
          }
          if (sql.startsWith("SELECT monto, concepto, ingreso FROM caja_extra")) {
            const x=extras.get(this.args[0]); return x ? { monto:x.monto, concepto:x.concepto, ingreso:x.ingreso } : null;
          }
          throw Error("Consulta inesperada: " + sql);
        }
      };
    },
    async batch(sentencias) {
      for (const s of sentencias) {
        if (s.sql.includes("INSERT INTO turno_inicio")) {
          const [d,t,mes,p,cambio,creado,actualizado] = s.args;
          inicio.set(key(d,t), { mes, persona:p, cambio, creado, actualizado });
        } else if (s.sql.includes("INSERT INTO caja_extra")) {
          const [id,mes,d,t,monto,p,creado,por] = s.args;
          const anterior = extras.get(id);
          extras.set(id, { id,mes,dia:d,turno:t,monto,persona:p,concepto:"Aumento de cambio",
            ingreso:0, creado: anterior?.creado || creado, creado_por:por });
        } else if (s.sql.startsWith("DELETE FROM caja_extra")) {
          extras.delete(s.args[0]);
        } else if (s.sql.includes("INSERT INTO fin_bitacora")) {
          bitacora.push(s.args);
        } else throw Error("Escritura inesperada: " + s.sql);
      }
      return sentencias.map(() => ({meta:{changes:1}}));
    }
  };
  return { env: { DB }, inicio, extras, bitacora };
}

test("Guardar inicio es atómico, idempotente y separa fondo de aporte", async () => {
  const { env, inicio, extras, bitacora } = dbSimulada();
  const p = {dia,turno,persona,recibido:90,aumento:20};
  const u = idAumentoInicio(dia, turno);
  assert.equal((await guardarCambioInicio(env,p)).total,110);
  assert.equal(inicio.get(dia+"|"+turno).cambio,90);
  assert.equal(extras.get(u).monto,20);
  assert.equal(extras.size,1);
  assert.equal(bitacora.length,1);
  await guardarCambioInicio(env,p); // UID reintentado / doble pulsación
  assert.equal(extras.size,1);
  assert.equal(bitacora.length,1); // no se registra un cambio inexistente
  await guardarCambioInicio(env,{...p,aumento:30});
  assert.equal(extras.get(u).monto,30);
  assert.equal(extras.size,1);
  assert.equal(bitacora.length,2);
  extras.set("manual-2", {...extra(12), id:"manual-2"});
  await guardarCambioInicio(env,{...p,aumento:0});
  assert.equal(extras.has(u),false);
  assert.equal(extras.get("manual-2").monto,12);
  assert.equal(inicio.get(dia+"|"+turno).cambio,90);
  assert.equal(bitacora.length,3);
});

test("Se conserva la protección contra borrar aportes automáticos fuera del inicio", () => {
  const caja = readFileSync(new URL("../src/caja.js", import.meta.url), "utf8");
  const turnoJs = readFileSync(new URL("../src/turno.js", import.meta.url), "utf8");
  const html = readFileSync(new URL("../src/turno.html", import.meta.url), "utf8");
  assert.match(caja,/x\.id === idAumentoInicio\(x\.dia, x\.turno\)/);
  assert.match(turnoJs,/g\.id === idAumentoInicio\(s\.dia, s\.turno\)/);
  assert.match(turnoJs,/c\.aumento === undefined/);
  assert.match(turnoJs,/if \(!\(await sinCorte\(\)\)\)/);
  assert.match(html,/name="cambio"/);
  assert.match(html,/name="aumento"/);
  assert.match(html,/data-borrar/);
  assert.match(html,/Inicio pendiente de conexión/);
  for (const [,s] of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))
    if (s.trim()) assert.doesNotThrow(() => new Function(s.replace("/*__INTERPRETAR__*/","")));
});

test("Dos tabletas con fondos distintos: gana una sin mezclar sobres ni auditoría",async()=>{
  const sqlite=new DatabaseSync(":memory:");
  const stmt=(sql,args=[])=>({
    sql,args,bind(...v){return stmt(sql,v)},
    async first(){return sqlite.prepare(sql).get(...args)??null},
    async all(){return {results:sqlite.prepare(sql).all(...args)}},
    async run(){const z=sqlite.prepare(sql).run(...args);return {meta:{changes:Number(z.changes||0)}}}
  });
  const env={DB:{
    prepare:sql=>stmt(sql),
    async batch(list){
      sqlite.exec("BEGIN IMMEDIATE");
      try{
        const resultado=list.map(x=>{
          const z=sqlite.prepare(x.sql).run(...x.args);
          return {meta:{changes:Number(z.changes||0)}};
        });
        sqlite.exec("COMMIT");
        return resultado;
      }catch(e){sqlite.exec("ROLLBACK");throw e}
    }
  }};
  try{
    await asegurarEsquemaCaja(env);
    const ejecutar=env.DB.batch;
    let esperas=0,continuar;
    const barrera=new Promise(resolve=>continuar=resolve);
    env.DB.batch=async statements=>{
      if(++esperas===2)continuar();
      await barrera;
      return ejecutar(statements);
    };
    const opciones={dia,turno,persona};
    const respuestas=await Promise.allSettled([
      guardarCambioInicio(env,{...opciones,recibido:90,aumento:20}),
      guardarCambioInicio(env,{...opciones,recibido:75,aumento:35})
    ]);
    assert.equal(esperas,2);
    assert.deepEqual(respuestas.map(x=>x.status).sort(),["fulfilled","rejected"]);
    const rechazado=respuestas.find(x=>x.status==="rejected").reason;
    assert.equal(rechazado.code,"INICIO_OBSOLETO");
    const elegido=respuestas.find(x=>x.status==="fulfilled").value;
    const guardado=sqlite.prepare("SELECT cambio FROM turno_inicio WHERE dia=? AND turno=?").get(dia,turno);
    const aporte=sqlite.prepare("SELECT monto FROM caja_extra WHERE id=?").get(idAumentoInicio(dia,turno));
    assert.equal(guardado.cambio,elegido.cambio);
    assert.equal(aporte.monto,elegido.aumento);
    assert.equal(elegido.total,110);
    assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM fin_bitacora WHERE que='Cambio al inicio de turno'").get().n,1);

    env.DB.batch=ejecutar;
    // Otra pestaña reenvía exactamente lo guardado: no duplica la bitácora.
    await guardarCambioInicio(env,{...opciones,recibido:elegido.cambio,aumento:elegido.aumento});
    assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM fin_bitacora WHERE que='Cambio al inicio de turno'").get().n,1);

    // El corte ya se entregó: ni siquiera una edición directa atrasada aplica.
    const now=new Date().toISOString();
    sqlite.prepare("INSERT INTO turno_cortes(dia,turno,mes,persona,efectivo,creado,actualizado) VALUES(?,?,?,?,?,?,?)")
      .run(dia,turno,dia.slice(0,7),persona,110,now,now);
    await assert.rejects(
      ()=>guardarCambioInicio(env,{...opciones,recibido:100,aumento:10}),
      e=>e.code==="INICIO_OBSOLETO"
    );
    assert.equal(sqlite.prepare("SELECT cambio FROM turno_inicio WHERE dia=? AND turno=?").get(dia,turno).cambio,elegido.cambio);
    assert.equal(sqlite.prepare("SELECT monto FROM caja_extra WHERE id=?").get(idAumentoInicio(dia,turno)).monto,elegido.aumento);
    assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM fin_bitacora WHERE que='Cambio al inicio de turno'").get().n,1);
  }finally{sqlite.close()}
});
