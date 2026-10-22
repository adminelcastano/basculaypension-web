import {archivoAvisos, idOperacionCastagram, conversacion, marcarVisto, comentar, enterarComentario, editarComentario, borrarComentario} from "./avisos.js";
import {notificar} from "./push.js";
import {borrarArchivo} from "./fotos.js";

// Solo despacho: la comprobación Access y selección de registro siguen en agendaPanel.
export async function rutaArchivoCastagramAdmin(request, env, url, partes, { json }) {
  // Archivo de avisos: todos los archivados con su conversación (no se borran)
  if (partes[1] === "avisos-archivo" && request.method === "GET") {
    const sp = url.searchParams;
    return json({ ok: true, ...(await archivoAvisos(env, { q: sp.get("q") || "", persona: sp.get("persona") || "", desde: sp.get("desde") || "", hasta: sp.get("hasta") || "", pagina: sp.get("pagina") || 0 })) });
  }

  return null;
}
export async function rutaConversacionCastagramAdmin(request, env, url, partes, usuario, ahora, fila,
  { json, guardarFotosInc, normalizarPara, listaFotos }) {
  // ---- Conversación de un aviso ----
  if (fila.tipo === "aviso" && partes[2] === "conversacion" && request.method === "GET") {
    const historial = url.searchParams.get("historial") === "1";
    const r = await conversacion(env, fila, "ADMIN", { historial });
    if (fila.estado === "activo" && !historial) await marcarVisto(env, fila.id, "ADMIN", ahora);
    return json({ ok: true, aviso: { ...fila, para: normalizarPara(fila.para), autor: fila.autor || "admin", fotos: listaFotos(fila) }, ...r });
  }
  if (fila.tipo === "aviso" && partes[2] === "comentar" && request.method === "POST") {
    let c; try { c = await request.json(); } catch { return json({ ok: false, error: "Datos inválidos." }, 400); }
    if (Object.hasOwn(c, "uid") && c.uid != null && c.uid !== "" && !/^[a-z0-9-]{8,40}$/i.test(String(c.uid))) return json({ ok:false, error:"Identificador de comentario inválido." },422);
    if (c.uid) {
      const uidId = await idOperacionCastagram("comentar", c.uid, "admin", fila.id);
      const anterior = await env.DB.prepare("SELECT * FROM aviso_comentarios WHERE id = ?").bind(uidId).first();
      if (anterior) {
        if (anterior.item_id !== fila.id || anterior.autor !== "admin")
          return json({ ok:false, error:"Identificador de comentario reutilizado." },409);
        return json({ok:true,repetido:true,comentario:{...anterior,etiquetas:(()=>{try{return JSON.parse(anterior.etiquetas||"[]");}catch{return [];}})()},etiquetadas:[],post_enterado:!!(await env.DB.prepare("SELECT 1 FROM agenda_lecturas WHERE item_id = ? AND persona = 'ADMIN'").bind(fila.id).first())});
      }
    }
    let foto = null;
    if (c.foto) { try { [foto] = await guardarFotosInc(env, [c.foto], "Comentario " + fila.titulo); } catch (er) { return json({ ok: false, error: er.message }, 422); } }
    const claves = (await env.DB.prepare("SELECT clave FROM turno_personas WHERE activo = 1").all().catch(() => ({ results: [] }))).results.map(r => r.clave);
    let r; try { r = await comentar(env, fila, "admin", { texto: c.texto, foto, etiquetas: c.etiquetas, confirmar_ampliacion: c.confirmar_ampliacion === true, uid: c.uid }, claves, ahora); }
    catch (er) { if (foto) await borrarArchivo(env, foto).catch(() => {}); return json({ ok: false, error: er.message }, 422); }
    if (r.notificar.tablet) await notificar(env, "tablet", { titulo: "Nueva actividad en Castagram", cuerpo: "Abre Castagram para consultar la conversación.", sec: "avisos", url: "/turno?sec=avisos", etiqueta: "aviso-" + fila.id });
    return json({ ok: true, comentario: r.comentario, etiquetadas: r.etiquetadas, post_enterado: true });
  }
  if (fila.tipo === "aviso" && partes[2] === "comentarios" && partes[3] && partes[4] === "enterado" && request.method === "POST") {
    let datos; try { datos = await request.json(); } catch { datos = {}; }
    try { return json({ ok:true, ...(await enterarComentario(env, fila, partes[3], "ADMIN", ahora, datos.activo ?? true)) }); }
    catch (er) { return json({ ok:false, error:er.message },422); }
  }
  if (fila.tipo === "aviso" && partes[2] === "comentarios" && partes[3] && ["editar", "borrar"].includes(partes[4]) && request.method === "POST") {
    let c = {}; try { c = await request.json(); } catch {}
    try {
      if (partes[4] === "editar") return json({ ok: true, comentario: await editarComentario(env, fila, partes[3], c.texto, usuario && usuario.email, ahora) });
      await borrarComentario(env, fila, partes[3], usuario && usuario.email, ahora);
      return json({ ok: true });
    } catch (er) { return json({ ok: false, error: er.message }, 422); }
  }

  return null;
}
