import test from "node:test";
import assert from "node:assert/strict";
import { resumenEnterados } from "../src/avisos.js";

test("Enterado nuevo se destaca hasta que admin abre la conversación", () => {
  const recibos=[{persona:"JESC",at:"2026-10-17T05:10:00Z"},{persona:"ERI",at:"2026-10-17T05:15:00Z"}];
  assert.deepEqual(resumenEnterados(recibos,null),{nuevosEnterado:2,ultimoEnterado:"2026-10-17T05:15:00Z"});
  assert.deepEqual(resumenEnterados(recibos,"2026-10-17T05:12:00Z"),{nuevosEnterado:1,ultimoEnterado:"2026-10-17T05:15:00Z"});
  assert.deepEqual(resumenEnterados(recibos,"2026-10-17T05:15:00Z"),{nuevosEnterado:0,ultimoEnterado:"2026-10-17T05:15:00Z"});
});
test("Sin confirmaciones, no genera falsas novedades",()=>{
  assert.deepEqual(resumenEnterados([],"2026-10-17T05:00:00Z"),{nuevosEnterado:0,ultimoEnterado:""});
});
