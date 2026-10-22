import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const panel=readFileSync(new URL("../src/panel/cliente/07-agenda.js",import.meta.url),"utf8") + "\n" + readFileSync(new URL("../src/panel/cliente/07-castagram-controlador.js",import.meta.url),"utf8");
const turno=readFileSync(new URL("../src/turno.html", import.meta.url), "utf8").replace("/*__TURNO_CSS__*/", readFileSync(new URL("../src/turno-estilos.css", import.meta.url), "utf8"));
const estilos=readFileSync(new URL("../src/panel/estilos.css",import.meta.url),"utf8");

function funciones(fuente) {
  const a=fuente.indexOf("const castaFotoActual = new Map();"), b=fuente.indexOf("function postHtml(",a);
  assert.ok(a>=0 && b>a,"Se conserva el helper de Castagram");
  const codigo=fuente.slice(a,b);
  return new Function("urlFoto","esc","matchMedia","requestAnimationFrame",codigo+
    "\nreturn {castaFotos,castaMover,castaSincronizar,castaRestaurar};")(
      k=>"/foto/"+encodeURIComponent(k), s=>String(s).replace(/&/g,"&amp;").replace(/"/g,"&quot;"),
      ()=>({matches:true}), f=>f()
    );
}
for(const [nombre,fuente] of [["administración",panel],["tablet",turno]]) {
  test("Castagram "+nombre+": 1 foto conserva formato original",()=>{
    const h=funciones(fuente).castaFotos(["foto1"],"id1");
    assert.match(h,/class="post-fotos"/);
    assert.doesNotMatch(h,/data-casta-carrusel/);
    assert.match(h,/Abrir foto 1 de 1/);
  });
  test("Castagram "+nombre+": 2 y 8 fotos navegan sin perder imágenes",()=>{
    const fotos=Array.from({length:8},(_,i)=>"foto"+(i+1));
    const render=funciones(fuente).castaFotos(fotos,"item-8");
    assert.equal((render.match(/class="casta-carrusel-slide"/g)||[]).length,8);
    assert.equal((render.match(/data-casta-ir=/g)||[]).length,8);
    assert.match(render,/1 \/ 8/);
    assert.match(render,/aria-label="Foto siguiente"/);
    assert.match(render,/aria-label="Foto anterior"/);
    assert.match(render,/Abrir foto 8 de 8/);
    const two=funciones(fuente).castaFotos(fotos.slice(0,2),"item-2");
    assert.equal((two.match(/class="casta-carrusel-slide"/g)||[]).length,2);
    assert.match(two,/1 \/ 2/);
  });
  test("Castagram "+nombre+": flechas, contador y límites",()=>{
    const f=funciones(fuente),count={textContent:""},prev={disabled:false},next={disabled:false};
    const dots=Array.from({length:3},(_,i)=>({dataset:{castaIr:String(i)},attrs:{},setAttribute(k,v){this.attrs[k]=v},removeAttribute(k){delete this.attrs[k]}}));
    const track={clientWidth:320,scrollLeft:0,children:[{},{},{}],scrollTo({left}){this.scrollLeft=left}};
    const box={isConnected:true,dataset:{castaCarrusel:"test"},querySelector(q){
      if(q===".casta-carrusel-pista")return track;
      if(q===".casta-carrusel-num")return count;
      if(q.includes('"-1"'))return prev;
      if(q.includes('"1"'))return next;
      return null;
    },querySelectorAll(q){return q==="[data-casta-ir]"?dots:[]}};
    f.castaSincronizar(box);
    assert.equal(count.textContent,"1 / 3");assert.equal(prev.disabled,true);assert.equal(next.disabled,false);
    f.castaMover({dataset:{castaPaso:"1"},closest:()=>box});
    f.castaSincronizar(box);
    assert.equal(track.scrollLeft,320);assert.equal(count.textContent,"2 / 3");
    assert.equal(dots[1].attrs["aria-current"],"true");
    f.castaMover({dataset:{castaIr:"2"},closest:()=>box});
    f.castaSincronizar(box);
    assert.equal(count.textContent,"3 / 3");assert.equal(next.disabled,true);
    f.castaMover({dataset:{castaPaso:"1"},closest:()=>box});
    assert.equal(track.scrollLeft,640);
    f.castaRestaurar({querySelectorAll:()=>[box]});
    assert.equal(track.scrollLeft,640);
  });
}
test("Castagram: deslizamiento táctil y accesibilidad en ambos clientes",()=>{
  assert.match(estilos,/scroll-snap-type:x mandatory/);
  assert.match(turno,/scroll-snap-type:x mandatory/);
  for(const fuente of [panel,turno]){
    assert.match(fuente,/data-casta-paso/);
    assert.match(fuente,/data-casta-ir/);
    assert.match(fuente,/aria-roledescription="carrusel"/);
    assert.match(fuente,/castaSincronizar/);
    assert.match(fuente,/castaRestaurar/);
    assert.match(fuente,/aria-live="polite"/);
  }
});
test("Castagram: carrusel limitado a publicaciones, sin modificar incidencias",()=>{
  assert.match(panel,/\$\{castaFotos\(fotosDe\(it\),it.id\)\}/);
  assert.match(turno,/\$\{castaFotos\(f,a.id\)\}/);
  assert.match(panel,/inc-gal/);
  assert.match(turno,/function filaIncidencia/);
});