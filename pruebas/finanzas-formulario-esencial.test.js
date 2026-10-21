import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {readFileSync} from "node:fs";

const src=readFileSync(new URL("../src/panel/cliente/05b-estados.js",import.meta.url),"utf8");
const css=readFileSync(new URL("../src/panel/estilos.css",import.meta.url),"utf8");
const esc=s=>String(s??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/'/g,"&#39;");
const siguiente=()=>new Promise(r=>setImmediate(r));

function escenario(banco){
  const handlers=new Map(),labels=new Map(),registered={};
  let confirmacion=null,botonAplicar=null,envios=0;
  const vista={innerHTML:"",querySelectorAll:()=>[]};
  const vistaPrevia={
    hidden:true,_html:"",
    get innerHTML(){return this._html;},
    set innerHTML(html){
      this._html=html;
      confirmacion=html.includes("id='f-est-pdf-cuenta-confirmada'")
        ? {checked:false,addEventListener:(tipo,fn)=>handlers.set("confirmar:"+tipo,fn)}:null;
      botonAplicar={disabled:true,addEventListener:(tipo,fn)=>handlers.set("aplicar:"+tipo,fn)};
    },
    replaceChildren(){this._html="";confirmacion=null;botonAplicar=null;}
  };
  const campos=new Map();
  const campo=n=>{if(!campos.has(n))campos.set(n,{value:""});return campos.get(n);};
  const cuenta=campo("cuenta"); cuenta.value="otra";
  cuenta.addEventListener=(tipo,fn)=>{
    const k="cuenta:"+tipo,prev=handlers.get(k);
    handlers.set(k,prev?()=>{prev();fn();}:fn);
  };
  const form={
    cuenta,elements:{namedItem:campo},querySelectorAll:()=>[],
    querySelector:selector=>{
      if(selector.startsWith("[data-est-label=")){
        if(!labels.has(selector))labels.set(selector,{textContent:""});
        return labels.get(selector);
      }
      return {disabled:false};
    },
    addEventListener:(tipo,fn)=>handlers.set("form:"+tipo,fn),
    reset:()=>{},scrollIntoView:()=>{}
  };
  const archivo={files:[{name:"muestra.pdf"}],value:"",addEventListener:(t,fn)=>handlers.set("archivo:"+t,fn)};
  const leer={disabled:false,addEventListener:(t,fn)=>handlers.set("leer:"+t,fn)};
  const nuevo={hidden:true,addEventListener:(t,fn)=>handlers.set("nuevo:"+t,fn)};
  const selectores={
    "#f-estados-contenido":vista,"#f-est-form":form,"#f-est-nuevo":nuevo,
    "#f-est-pdf-preview":vistaPrevia,"#f-est-pdf-archivo":archivo,
    "#f-est-pdf-leer":leer,"#f-est-pdf-mensaje":{textContent:""},
    "#f-est-pdf-cuenta-confirmada":()=>confirmacion,
    "#f-est-pdf-aplicar":()=>botonAplicar,
    "#f-est-err":{textContent:""},"#f-est-explicacion":{textContent:""}
  };
  const doc={
    querySelector:key=>typeof selectores[key]==="function"?selectores[key]():selectores[key]||null,
    addEventListener:(tipo,fn)=>registered[tipo]=fn
  };
  vm.runInNewContext(src,{document:doc,EC:{
    esc,api:async()=>({cuentas:[
      {id:"otra",nombre:"BANORTE CREDITO",tipo:"credito",activa:1},
      {id:"bbva",nombre:"BBVA PYME",tipo:"debito",activa:1},
      {id:"mdo",nombre:"MDO PAGO",tipo:"debito",activa:1}
    ],estados:[]}),extraerEstadoPDF:async()=>banco,
    post:async()=>{envios++;},toast:()=>{}
  },console,Date,Intl},{filename:"05b-estados.js",timeout:3000});
  return {
    cuenta,handlers,vista,vistaPrevia,labels,
    get confirmacion(){return confirmacion;},
    get botonAplicar(){return botonAplicar;},
    get envios(){return envios;},
    async iniciar(){registered.modulo({detail:"finanzas"});await siguiente();await siguiente();},
    async leer(){await handlers.get("leer:click")();}
  };
}
const simulado={institucion:"BBVA",tipo:"debito",fiable:true,paginas:2,
  campos:{periodo_desde:"2026-09-01",periodo_hasta:"2026-09-30",saldo_inicial:"10.00",
    abonos:"30.00",cargos:"25.00",saldo_final:"15.00"},advertencias:[]};

test("Datos esenciales primero y desglose opcional; sin alterar nombres de API",()=>{
  assert.ok(src.indexOf("f-est-cuenta")<src.indexOf("est-pdf-caja wide"));
  for(const nombre of ["saldo_inicial","abonos","cargos","saldo_final","comisiones","intereses","iva"])
    assert.match(src,new RegExp('"'+nombre+'"'));
  assert.match(src,/f-est-detalles/);
  assert.match(src,/f-est-credito/);
  assert.match(css,/#fb-estados \.est-pdf-caja button:disabled \{ cursor:not-allowed; \}/);
  assert.match(css,/#fb-estados \.cform label\.est-pdf-confirmar \{ display:flex;flex-direction:row;/);
});

test("Banco distinto bloquea y la cuenta BBVA correcta exige confirmación",async()=>{
  const s=escenario(simulado); await s.iniciar(); await s.leer();
  assert.match(s.vistaPrevia.innerHTML,/Cuenta seleccionada: BANORTE CREDITO/);
  assert.equal(s.confirmacion,null);
  assert.equal(s.botonAplicar.disabled,true);
  s.cuenta.value="bbva";s.handlers.get("cuenta:change")();
  assert.ok(s.confirmacion);
  assert.equal(s.botonAplicar.disabled,true);
  s.confirmacion.checked=true;s.handlers.get("confirmar:change")();
  assert.equal(s.botonAplicar.disabled,false);
  assert.equal(s.envios,0,"Leer y confirmar nunca deben guardar en el servidor");
});

test("El alias real MDO PAGO coincide solo con Mercado Pago de débito",async()=>{
  const s=escenario({...simulado,institucion:"MERCADO PAGO"});await s.iniciar();
  s.cuenta.value="mdo";s.handlers.get("cuenta:change")();await s.leer();
  assert.ok(s.confirmacion);
  s.cuenta.value="bbva";s.handlers.get("cuenta:change")();
  assert.equal(s.confirmacion,null);
});
