import test from 'node:test';
import assert from 'node:assert/strict';
import { pushTablet, avisoParaEncargado } from '../src/agenda.js';
test('Castagram: push general sin contenido privado', () => {
  const d={titulo:'ASUNTO_RESERVADO_93',detalle:'MENSAJE_PRIVADO_41',prioridad:'alta',para:{todos:false,admin:false,turnos:[],personas:['ANA']}};
  const push=pushTablet('aviso',d,'id123');
  assert.ok(push); assert.equal(push.grave,true); assert.equal(push.sec,'avisos');
  assert.doesNotMatch(JSON.stringify(push),/ASUNTO_RESERVADO_93|MENSAJE_PRIVADO_41|ANA/);
});
test('Castagram: solo administración no genera push tablet',()=>{
  assert.equal(pushTablet('aviso',{titulo:'Solo admin',para:{todos:false,admin:true,personas:[],turnos:[]}},'id123'),null);
});
test('Castagram: destino autoriza acceso',()=>{
  const a={autor:'admin',para:{todos:false,admin:false,turnos:[],personas:['ANA']}};
  assert.equal(avisoParaEncargado(a,'ANA','MAÑANA'),true);
  assert.equal(avisoParaEncargado(a,'LUIS','MAÑANA'),false);
});
