import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { permisoFotoTurno } from "../src/foto-acceso-turno.js";

const fotoAviso = "tf:aviso:01234567-89ab-4cde-8fab-0123456789ab";
const fotoComentario = "tf:inc:11234567-89ab-4cde-8fab-0123456789ab";
const fotoIncidencia = "tf:inc:21234567-89ab-4cde-8fab-0123456789ab";
const paraAna = JSON.stringify({ todos: false, admin: true, turnos: [], personas: ["ANA"] });
const activo = { id: "post1", autor: "admin", para: paraAna, estado: "activo" };
const ana = { persona: "ANA", turno: "MAÑANA" };
const luis = { persona: "LUIS", turno: "MAÑANA" };

function simularDB({ publicacion = activo, comentarioBorrado = false, incidencia = false } = {}) {
  return {
    DB: {
      prepare(sql) {
        return {
          bind(...valores) {
            return {
              async first() {
                const llave = valores[0];
                if (sql.includes("FROM agenda_items i")) {
                  if (llave === fotoAviso || llave === fotoComentario) return publicacion;
                  return null;
                }
                if (sql.includes("FROM aviso_comentarios WHERE"))
                  return llave === fotoComentario ? { borrado: comentarioBorrado ? "2026-10-19T00:00:00Z" : null } : null;
                if (sql.includes("tipo = 'incidencia'"))
                  return llave === fotoIncidencia && incidencia ? { 1: 1 } : null;
                throw new Error("Consulta no prevista en prueba de permiso");
              }
            };
          }
        };
      }
    }
  };
}

test("A-05: un enlace conocido no concede acceso a otro encargado", async () => {
  for (const llave of [fotoAviso, fotoComentario]) {
    const env = simularDB();
    assert.deepEqual(await permisoFotoTurno(env, llave, ana), { permitido: true, castagram: true });
    assert.deepEqual(await permisoFotoTurno(env, llave, luis), { permitido: false, castagram: true });
  }
});

test("A-05: archivar o borrar un comentario invalida la fotografía", async () => {
  assert.equal((await permisoFotoTurno(simularDB({ publicacion: { ...activo, estado: "archivado" } }), fotoAviso, ana)).permitido, false);
  assert.equal((await permisoFotoTurno(simularDB({ comentarioBorrado: true }), fotoComentario, ana)).permitido, false);
});

test("A-05: no se entrega foto huérfana y se respetan incidencias antiguas", async () => {
  assert.equal((await permisoFotoTurno(simularDB({ publicacion: null }), fotoAviso, ana)).permitido, false);
  assert.equal((await permisoFotoTurno(simularDB(), fotoIncidencia, ana)).permitido, false);
  assert.deepEqual(await permisoFotoTurno(simularDB({ incidencia: true }), fotoIncidencia, ana), { permitido: true, castagram: false });
});

test("A-05: la ruta sigue exigiendo PIN, retorna 404 y deshabilita cache de Castagram", () => {
  const src = readFileSync(new URL("../src/turno.js", import.meta.url), "utf8");
  const sesion = src.indexOf("const s = await sesionActual(request, env);");
  const foto = src.indexOf('if (partes[0] === "foto" && request.method === "GET")');
  const permiso = src.indexOf("await permisoFotoTurno(env, llave, s);");
  assert.ok(sesion > 0 && foto > sesion && permiso > foto);
  assert.match(src.slice(foto, foto + 1000), /!decision\.permitido\) return new Response\("No encontrado", \{ status: 404 \}\)/);
  assert.match(src.slice(foto, foto + 1000), /if \(esFotoCastagram\) respuesta\.headers\.set\("Cache-Control", "private, no-store"\)/);
});
