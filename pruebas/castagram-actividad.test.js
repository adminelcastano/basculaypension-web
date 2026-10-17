import test from "node:test";
import assert from "node:assert/strict";
import { incorporarEnteradosPendientes } from "../src/agenda.js";

test("Enterado genera una novedad para la administración", () => {
  const v=incorporarEnteradosPendientes([],[{id:"a",titulo:"Revisión de báscula",personas:"JESC",actividad:"2026-10-17T04:30:00Z",prioridad:"alta"}]);
  assert.equal(v.length,1);
  assert.match(v[0].titulo,/JESC dio Enterado: Revisión de báscula/);
  assert.equal(v[0].creado,"2026-10-17T04:30:00Z");
});
test("Varias confirmaciones cuentan una sola publicación",()=>{
  const v=incorporarEnteradosPendientes([],[{id:"a",titulo:"Aviso",personas:"JESC,ERI,JDOM",actividad:"2026-10-17T04:40:00Z"}]);
  assert.equal(v.length,1);
  assert.match(v[0].titulo,/JESC y 2 más dieron Enterado/);
});
test("No duplica publicaciones que también tenían comentarios nuevos",()=>{
  const post={id:"a",titulo:"Comentario nuevo",autor:"JESC"};
  const old=[post],result=incorporarEnteradosPendientes(old,[{id:"a",titulo:"Aviso",personas:"ERI"}]);
  assert.equal(result.length,1);
  assert.equal(result[0],post);
  assert.equal(old.length,1);
});
