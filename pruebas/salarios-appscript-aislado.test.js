// Este test ejecuta la función REAL de Apps Script contra una hoja simulada.
// Ningún conector ni archivo de Google Drive se utiliza durante las pruebas.
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";

const fuente=readFileSync(new URL("../herramientas/aviso-correo.gs",import.meta.url),"utf8");
const inicio=fuente.indexOf("function salariosPrivados(d) {");
assert.ok(inicio>0,"Debe existir la operación SALARIOS del script real");
const codigo=fuente.slice(inicio);
class Hoja {
  constructor(nombre){this.nombre=nombre;this.filas=[];this.frozen=0;}
  set(row,col,val){if(!this.filas[row-1])this.filas[row-1]=[];this.filas[row-1][col-1]=val;}
  get(row,col){return this.filas[row-1]?.[col-1]??"";}
  getLastRow(){
    for(let i=this.filas.length;i>0;i--)if((this.filas[i-1]||[]).some(v=>v!==""&&v!=null))return i;
    return 0;
  }
  getRange(...args){
    let row,col,n,m;
    if(typeof args[0]==="string"){
      const a=args[0].match(/^([A-Z]+)([0-9]+)$/);
      if(!a)throw Error("Referencia fuera del simulador");
      row=Number(a[2]);col=[...a[1]].reduce((s,c)=>s*26+c.charCodeAt(0)-64,0);n=m=1;
    }else [row,col,n=1,m=1]=args;
    const h=this;
    return {
      getValue(){return h.get(row,col);},
      setValue(v){if(n!==1||m!==1)throw Error("Rango amplio");h.set(row,col,v);return this;},
      getValues(){return Array.from({length:n},(_,i)=>Array.from({length:m},(_,j)=>h.get(row+i,col+j)));},
      setValues(values){
        if(values.length!==n||values.some(x=>x.length!==m))throw Error("Dimensiones inválidas");
        values.forEach((line,i)=>line.forEach((x,j)=>h.set(row+i,col+j,x)));return this;
      },
      clearContent(){for(let i=0;i<n;i++)for(let j=0;j<m;j++)h.set(row+i,col+j,"");return this;}
    };
  }
  setFrozenRows(n){this.frozen=n;}
}
function entorno({enabled=true, sheetId="SIMULACION_SALARIOS",missingBase=false}={}){
  const hojas=new Map(), acc={locks:0,opens:0,flushes:0}, props={
    SALARIOS_SYNC_ACTIVE:enabled?"SI":"NO", SALARIOS_SHEET_ID:sheetId
  };
  if(!missingBase){
    const base=new Hoja("Hoja 1");
    base.set(2,1,"ID");base.set(2,2,"NOMBRE");base.set(2,11,"SUELDO SEMANAL");
    base.set(3,1,"001_FICTICIO_A");base.set(3,2,"PERSONA FICTICIA A");base.set(3,11,1200);
    base.set(4,1,"002_FICTICIO_B");base.set(4,2,"PERSONA FICTICIA B");base.set(4,11,1800);
    hojas.set("Hoja 1",base);
  }
  const libro={
    getSheetByName(n){return hojas.get(n)||null;},
    insertSheet(n){if(hojas.has(n))throw Error("Ya existe");const v=new Hoja(n);hojas.set(n,v);return v;}
  };
  const context={
    PropertiesService:{getScriptProperties:()=>({getProperty:k=>props[k]||null})},
    SpreadsheetApp:{openById:k=>{acc.opens++;if(k!==sheetId)throw Error("ID incorrecto");return libro;},flush:()=>{acc.flushes++;}},
    LockService:{getScriptLock:()=>({waitLock:()=>{acc.locks++;},releaseLock:()=>{acc.locks--;}})},
    Utilities:{formatDate:()=>"2026-10"},Date,Number,String,Set,Map,Math,Array,Object,
  };
  const ejecutar=vm.runInNewContext(codigo+"\nsalariosPrivados;",context,{timeout:2000});
  const baseJson=()=>JSON.stringify(hojas.get("Hoja 1")?.filas||[]);
  return{ejecutar,hojas,acc,props,baseJson};
}
const pago=(id="pago-202610-001",data={})=>({
  id,fecha:"2026-10-17",origen:"caja_gastos",concepto:"Pago de sueldo",
  importe:1200.50,colaborador_id:"001_FICTICIO_A",forma:"TRANSFERENCIA",cuenta:"bbva-pyme",...data
});
test("SALARIOS apagado: no abre Drive, no crea hojas y rechaza la operación",()=>{
  const x=entorno({enabled:false});
  const r=x.ejecutar({op:"pagos",filas:[pago()]});
  assert.equal(r.ok,false);assert.equal(x.acc.opens,0);assert.equal(x.hojas.size,1);
});
test("Catálogo ficticio recupera IDs sin escribir ninguna pestaña",()=>{
  const x=entorno(),antes=x.baseJson(),r=x.ejecutar({op:"catalogo"});
  assert.equal(r.ok,true);assert.equal(r.colaboradores.length,2);
  assert.equal(r.colaboradores[0].id,"001_FICTICIO_A");
  assert.equal(x.baseJson(),antes);assert.equal(x.hojas.size,1);
});
test("Primer reflejo, reintentos y totales: una fila por ID sin afectar Hoja 1",()=>{
  const x=entorno(),antes=x.baseJson();
  const r=x.ejecutar({op:"pagos",filas:[pago()]});
  assert.equal(r.ok,true);assert.equal(r.agregados,1);
  assert.equal(x.hojas.get("PAGOS WEB").getLastRow(),2);
  assert.equal(x.hojas.get("PAGOS WEB").get(2,6),1200.50);
  assert.equal(x.hojas.get("PAGOS WEB").get(2,10),"TRANSFERENCIA");
  assert.equal(x.hojas.get("PAGOS WEB").get(2,11),"bbva-pyme");
  assert.match(x.hojas.get("RESUMEN SALARIAL").get(3,4),/^=SUMIFS\(/);
  assert.equal(x.hojas.get("RESUMEN SALARIAL").get(3,3),1200);
  assert.equal(x.ejecutar({op:"pagos",filas:[pago()]}).agregados,0);
  assert.equal(x.hojas.get("PAGOS WEB").getLastRow(),2);
  assert.equal(x.hojas.get("RESUMEN SALARIAL").getLastRow(),4);
  assert.equal(x.baseJson(),antes);
  assert.equal(x.acc.locks,0);
  x.hojas.get("RESUMEN SALARIAL").set(2,10,"2026-09");
  x.ejecutar({op:"pagos",filas:[pago("pago-202610-002",{fecha:"2026-10-18",importe:33.30})]});
  assert.equal(x.hojas.get("PAGOS WEB").getLastRow(),3);
  assert.equal(x.hojas.get("RESUMEN SALARIAL").get(2,10),"2026-09","Mes elegido permanece");
});
test("ID repetido con importe o colaborador diferente detiene sin sobrescribir",()=>{
  const x=entorno();x.ejecutar({op:"pagos",filas:[pago()]});
  const a=x.hojas.get("PAGOS WEB").get(2,6);
  assert.equal(x.ejecutar({op:"pagos",filas:[pago("pago-202610-001",{importe:999})]}).ok,false);
  assert.equal(x.ejecutar({op:"pagos",filas:[pago("pago-202610-001",{colaborador_id:"002_FICTICIO_B"})]}).ok,false);
  assert.equal(x.ejecutar({op:"pagos",filas:[pago("pago-202610-001",{cuenta:"otra-cuenta"})]}).ok,false);
  assert.equal(x.ejecutar({op:"pagos",filas:[pago("pago-202610-001",{forma:"EFECTIVO"})]}).ok,false);
  assert.equal(x.hojas.get("PAGOS WEB").get(2,6),a);
  assert.equal(x.hojas.get("PAGOS WEB").getLastRow(),2);
});
test("Entrada inválida, duplicada o con colaborador inexistente no escribe",()=>{
  for(const entradas of [
    [pago("pago-202610-001",{colaborador_id:"003_DESCONOCIDO"})],
    [pago("pago-202610-001",{importe:-4})],
    [pago("pago-202610-001"),pago("pago-202610-001")],
    [pago("pago-202610-001",{origen:"tarjeta_credito"})]
  ]){
    const x=entorno();
    assert.equal(x.ejecutar({op:"pagos",filas:entradas}).ok,false);
    assert.equal(x.hojas.size,1);assert.equal(x.acc.locks,0);
  }
});
test("Texto que parece fórmula se conserva como texto, no se ejecuta",()=>{
  const x=entorno();
  assert.equal(x.ejecutar({op:"pagos",filas:[pago("pago-202610-004",{concepto:"=HIPERVINCULO(1,2)"})]}).ok,true);
  assert.match(x.hojas.get("PAGOS WEB").get(2,5),/^'=HIPERVINCULO/);
});
test("Si faltan controles internos se rechaza sin crear hojas",()=>{
  const x=entorno({missingBase:true});
  assert.equal(x.ejecutar({op:"catalogo"}).ok,false);
  assert.equal(x.ejecutar({op:"pagos",filas:[pago()]}).ok,false);
  assert.equal(x.hojas.size,0);
});
