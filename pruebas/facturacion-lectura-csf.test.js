// Contratos sintéticos de la extracción fiscal; preparados, NO ejecutados.
import test from "node:test";
import assert from "node:assert/strict";
import { normalizarCsfSugerido } from "../src/lectura-csf.js";

test("acepta RFC, razón social, CP fiscal y un régimen permitido", () => {
  const r = normalizarCsfSugerido({ rfc:"GUM A760831R8A", nombre:"PERSONA DE EJEMPLO",
    cp:"72100", regimenes:["612"] });
  assert.deepEqual(r.datos, { rfc:"GUMA760831R8A", nombre:"PERSONA DE EJEMPLO", cp:"72100", regimen:"612" });
});
test("varios regímenes no son seleccionados automáticamente", () => {
  const r = normalizarCsfSugerido({ regimenes:["612", "626"] });
  assert.equal(r.varios_regimenes, true);
  assert.equal("regimen" in r.datos, false);
});
test("no inventa ni conserva RFC/CP/regímenes inválidos", () => {
  const r = normalizarCsfSugerido({ rfc:"INVÁLIDO", cp:"123", nombre:null, regimenes:["999"] });
  assert.deepEqual(r.datos, {});
});

test("preserva Ñ en RFC y acentos en el nombre", () => {
  const r = normalizarCsfSugerido({ rfc:"MUÑ A760831R8A", nombre:"RAZÓN DE PRUEBA", cp:"30710", regimenes:["626"] });
  assert.equal(r.datos.rfc,"MUÑA760831R8A");
  assert.equal(r.datos.nombre,"RAZÓN DE PRUEBA");
});

test("descarta datos de tipo objeto y admite regímenes en texto separado por comas", () => {
  const r = normalizarCsfSugerido({ rfc: { hack: true }, nombre: {texto:"falso"}, cp:"72100", regimenes:"612,626" });
  assert.equal("rfc" in r.datos, false);
  assert.equal("nombre" in r.datos, false);
  assert.equal(r.varios_regimenes, true);
});

test("una lista devuelta por IA con dos códigos en el mismo elemento exige elegir", () => {
  const r = normalizarCsfSugerido({ regimenes: ["612, 626"] });
  assert.equal(r.varios_regimenes, true);
  assert.equal("regimen" in r.datos, false);
});
test("un nombre fiscal exclusivamente numérico no se sugiere", () => {
  assert.deepEqual(normalizarCsfSugerido({ nombre: "12345" }).datos, {});
});
