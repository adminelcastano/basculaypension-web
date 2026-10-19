// Control de acceso para imágenes de CASTAGRAM e incidencias en tabletas.
// Se invoca con la sesión PIN ya validada y después de asegurarEsquemaAvisos().
import { fotoAvisoPermitida } from "./avisos.js";

export async function permisoFotoTurno(env, llave, sesion) {
  if (!/^tf:(aviso|inc):[0-9a-f-]{36}$/.test(llave))
    return { permitido: false, castagram: false }; // Fuera del ámbito de esta verificación: negar por defecto.

  const publicacion = await env.DB.prepare(`SELECT i.id, i.autor, i.para, i.estado FROM agenda_items i
    WHERE i.tipo = 'aviso' AND (i.foto = ? OR i.fotos LIKE ? OR EXISTS
    (SELECT 1 FROM aviso_comentarios c WHERE c.item_id = i.id AND c.foto = ?)) LIMIT 1`)
    .bind(llave, '%"' + llave + '"%', llave).first();

  if (publicacion) {
    const comentario = await env.DB.prepare("SELECT borrado FROM aviso_comentarios WHERE item_id = ? AND foto = ? LIMIT 1")
      .bind(publicacion.id, llave).first();
    return {
      permitido: fotoAvisoPermitida(publicacion, sesion.persona, sesion.turno, !!(comentario && comentario.borrado)),
      castagram: true
    };
  }

  // Una foto de aviso sin publicación reconocida nunca puede abrirse por enlace directo.
  if (llave.startsWith("tf:aviso:")) return { permitido: false, castagram: false };

  // tf:inc también se utiliza en incidencias normales; preservar esa compatibilidad.
  const incidencia = await env.DB.prepare(`SELECT 1 FROM agenda_items
    WHERE tipo = 'incidencia' AND (foto = ? OR fotos LIKE ?) LIMIT 1`)
    .bind(llave, '%"' + llave + '"%').first();
  return { permitido: !!incidencia, castagram: false };
}
