import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {readFileSync} from "node:fs";

const esc=s=>String(s??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function panelMock(filename,answer){
  const source=readFileSync(new URL("../src/panel/cliente/"+filename,import.meta.url),"utf8");
  const registered={}, events=new Map();
  const view={innerHTML:"",querySelectorAll:()=>[],querySelector:()=>null};
  const button={hidden:true,disabled:false,addEventListener:(type,fn)=>events.set("button:"+type,fn)};
  const formFields=new Map();
  const named=name=>{
    if(!formFields.has(name))formFields.set(name,{value:""});
    return formFields.get(name);
  };
  const cuenta=named("cuenta");cuenta.value="debito-ficticio";cuenta.addEventListener=(type,fn)=>events.set("cuenta:"+type,fn);
  const form={
    cuenta,elements:{namedItem:named},
    querySelectorAll:()=>[],addEventListener:(type,fn)=>events.set("form:"+type,fn),
    reset:()=>{},scrollIntoView:()=>{},querySelector:()=>button
  };
  const selectors={
    "#f-estados-contenido":view,"#f-est-form":form,"#f-est-nuevo":button,
    "#f-est-err":{textContent:""},"#f-salarios-contenido":view
  };
  const sandbox={
    document:{
      querySelector:key=>selectors[key]||null,
      addEventListener:(type,fn)=>{registered[type]=fn;}
    },
    EC:{
      esc,hoyMx:()=> "2026-10-21",api:async()=>structuredClone(answer),post:async()=>({ok:true}),
      confirmar:async()=>false,toast:()=>{}
    },
    Date,Intl,console,queueMicrotask,FormData,
    crypto:{randomUUID:()=> "00000000-0000-4000-8000-000000000002"}
  };
  vm.runInNewContext(source,sandbox,{filename,timeout:2000});
  assert.equal(typeof registered.modulo,"function","El panel debe registrar su activación");
  return{view,selectors,form,events,async activar(seccion="finanzas"){registered.modulo({detail:seccion});await flush();await flush();}};
}
test("Formulario bancario renderiza periodos cruzados, estados negativos, créditos y alerta de continuidad",async()=>{
  const x=panelMock("05b-estados.js",{
    ok:true,cuentas:[
      {id:"debito-ficticio",nombre:"BANCO <script>alert(1)</script>",tipo:"debito",activa:1},
      {id:"credito-ficticio",nombre:"TARJETA DE PRUEBA",tipo:"credito",activa:1}
    ],
    estados:[
      {id:"00000000-0000-4000-8000-000000000002",cuenta:"debito-ficticio",
        periodo_desde:"2026-09-06",periodo_hasta:"2026-10-05",comprobacion:"cuadra",
        saldo_final:-250,version:1,continuidad:"revisar",continuidad_diferencia:-10},
      {id:"00000000-0000-4000-8000-000000000003",cuenta:"credito-ficticio",
        periodo_desde:"2026-09-06",periodo_hasta:"2026-10-05",comprobacion:"incompleto",
        saldo_final:null,version:1,continuidad:"sin_previo"}
    ]
  });
  await x.activar();
  const html=x.view.innerHTML;
  assert.match(html,/Inicio del periodo/);
  assert.match(html,/Fin del periodo/);
  assert.match(html,/Fecha de corte/);
  assert.match(html,/Fecha límite de pago/);
  assert.match(html,/Pago para no generar intereses/);
  assert.match(html,/2026-09-06 → 2026-10-05/);
  assert.match(html,/Diferencia interna por revisar|continuidad|difiere/);
  assert.match(html,/−?\$250\.00|-\$250\.00/);
  assert.match(html,/&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html,/<script>alert\(1\)<\/script>/);
  assert.equal(typeof x.events.get("form:submit"),"function");
  assert.equal(typeof x.events.get("cuenta:change"),"function");
});
test("SALARIOS desconectado renderiza sueldos y retiros sin ningún botón activo de envío",async()=>{
 const x=panelMock("05c-salarios.js",{
   ok:true,habilitado:false,empleados:[],huerfanos:0,
   aviso:"Sincronización SALARIOS suspendida; no hay escrituras.",
   pagos:[{id:"pago-ficticio",dia:"2026-10-20",monto:720,origen:"admin",
     concepto:"SUELDO <img src=x onerror=alert(1)>",vinculo:null}],
   candidatos:[{dia:"2026-10-20",origen:"Retiro de corte",turno:"TARDE",
     concepto:"Sueldo de la tarde",monto:720,solo_revision:true,posible_duplicado:true,
     identificador_estable:true,retiro_id:"00000000-0000-4000-8000-000000000002"}],
   fuentes_no_vinculadas:"Solo se revisan candidatos; no se envían al Sheet."
 });
 await x.activar("config");
 const html=x.view.innerHTML;
 assert.match(html,/Sincronización SALARIOS suspendida/);
 assert.match(html,/Retiro de corte/);
 assert.match(html,/Posible duplicado por fecha e importe/);
 assert.match(html,/La hoja SALARIOS sigue intacta/);
 assert.doesNotMatch(html,/id='f-salarios-sync'/);
 assert.doesNotMatch(html,/data-vincular-retiro=/);
 assert.match(html,/&lt;img src=x onerror=alert\(1\)&gt;/);
 assert.doesNotMatch(html,/<img src=x onerror=alert\(1\)>/);
});
