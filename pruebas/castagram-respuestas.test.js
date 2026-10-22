import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const tablet = readFileSync(new URL("../src/turno.html", import.meta.url), "utf8").replace("/*__TURNO_CSS__*/", readFileSync(new URL("../src/turno-estilos.css", import.meta.url), "utf8"));
const panel = readFileSync(new URL("../src/panel/cliente/07-agenda.js",import.meta.url),"utf8") + "\n" + readFileSync(new URL("../src/panel/cliente/07-castagram-controlador.js",import.meta.url),"utf8");
const styles = readFileSync(new URL("../src/panel/estilos.css",import.meta.url),"utf8");
const inlineCss = tablet.match(/<style>([\s\S]*?)<\/style>/)?.[1] || "";
const getHelpers=(str,start,end,first,second)=>{
  const i=str.indexOf(start),j=str.indexOf(end,i);
  assert.ok(i>=0 && j>i,"Funciones para respuestas disponibles");
  return new Function(str.slice(i,j)+";return {a:"+first+",b:"+second+"};")();
};
test("Castagram: logotipo reducido 20% y proporcional",()=>{
  for(const css of [styles,inlineCss]){
    assert.match(css,/\.casta-identidad img\s*\{[^}]*width:min\(210px,60vw\)/);
    assert.match(css,/\.casta-identidad img\s*\{[^}]*height:auto/);
  }
});
test("Castagram: se pueden insertar emojis en comentarios y respuestas",()=>{
  for(const text of [tablet,panel]){
    assert.match(text,/data-com-emoji/);
    assert.match(text, /(?:\.dataset|\bd)\.comEmoji/);
    assert.match(text,/setRangeText\(emoji/);
    assert.match(text,/\b❤️\b|❤️/);
  }
});
test("Castagram: las respuestas no adjuntan fotografías",()=>{
  for(const text of [tablet,panel]){
    assert.match(text,/!h\.responderA && h\.foto/);
    assert.match(text,/!h\.responderA \? `<label class="btn/);
    assert.match(text,/foto: h\.responderA \? null : h\.foto/);
    assert.match(text,/if \(h\.responderA\) \{ inp\.value = ""; return; \}/);
  }
});
test("Castagram: responder conserva el comentario y su foto para después",()=>{
  const panelFn=getHelpers(panel,"function comenzarReplyAdmin(","function insertarEmojiCastagram(","comenzarReplyAdmin","terminarReplyAdmin");
  const tabFn=getHelpers(tablet,"function comenzarReplyTurno(","function insertarEmojiTurno(","comenzarReplyTurno","terminarReplyTurno");
  for(const f of [panelFn,tabFn]){
    const h={borrador:"Texto con 😄",foto:"data:image/jpeg;base64,abc",etq:["ERI"]};
    f.a(h,"JESC");
    assert.equal(h.responderA,"JESC");
    assert.equal(h.foto,null);
    assert.equal(h.borrador,"@JESC ");
    assert.deepEqual(h.etq,[]);
    f.b(h);
    assert.equal(h.responderA,null);
    assert.equal(h.borrador,"Texto con 😄");
    assert.equal(h.foto,"data:image/jpeg;base64,abc");
    assert.deepEqual(h.etq,["ERI"]);
  }
});
