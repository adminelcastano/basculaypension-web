// Campañas y comunicaciones de Personal: reciben las dependencias ya protegidas.
// No crean almacén paralelo ni modifican el acceso al expediente o constancias.
export function crearControladorCampanas(deps) {
  const { VERSION_AVISO_PERSONAL_V1, DOC_AVISO_PERSONAL, DOCUMENTOS, folioDe, parse, json, SITIO, escH, estaCompleto, fechaLarga, hoyLocal, sumarDias, nuevoIdCampana, leerCampana, estadoEnCampana } = deps;
async function crearCampanaFilas(env, camp, ids, ahora) {
  const id = nuevoIdCampana();
  await env.DB.prepare("INSERT INTO campanas (id, nombre, creado, limite, docs) VALUES (?, ?, ?, ?, ?)").bind(id, camp.nombre, ahora, camp.limite, JSON.stringify(camp.docs)).run();
  if (ids.length) await env.DB.batch(ids.map(c => env.DB.prepare("INSERT OR IGNORE INTO campana_personas (campana_id, colaborador_id) VALUES (?, ?)").bind(id, c)));
  return id;
}

function correoCampana(fila, camp, pendientes, recordatorio) {
  const enlace = `${SITIO}/expediente/${fila.token}`;
  const primer = String(fila.nombre || "").split(" ")[0];
  const lim = fechaLarga(camp.limite);
  const soloAcuse = camp.docs.length === 1 && camp.docs[0] === "acuse_v1";
  const asunto = recordatorio ? `Recordatorio: ${camp.nombre} · antes del ${lim}` : `${camp.nombre} · Báscula y Pensión El Castaño`;
  const intro = recordatorio ? `Te recordamos que tu enlace para «${camp.nombre}» se cierra el ${lim}. Te falta:` : `Abrimos «${camp.nombre}». Tienes hasta el ${lim} para ${soloAcuse ? "confirmar" : "entregar"}:`;
  const texto = `Hola ${primer}:\n\n${intro}\n${pendientes.map(x => "- " + x).join("\n")}\n\n${soloAcuse ? "Lee el aviso y confirma su recepción desde tu enlace personal" : "Sube tus documentos y revisa tus datos en tu enlace personal"} (no lo compartas):\n${enlace}\n\nDespués de esa fecha el enlace se cierra.${soloAcuse ? " La confirmación digital no reemplaza la firma de documentos impresos." : " Entrega también las copias físicas con Josué."}\n\nBáscula y Pensión El Castaño\n962 564 2170`;
  const html = `<div style="background:#000;padding:24px 12px;font-family:-apple-system,BlinkMacSystemFont,'Helvetica Neue',Arial,sans-serif;color:#f5f5f7">
<div style="max-width:520px;margin:0 auto;background:#161617;border-radius:18px;padding:28px 24px">
<img src="${SITIO}/img/logo.png" alt="El Castaño" width="56" style="display:block;margin-bottom:16px">
<p style="margin:0 0 4px;color:#ffcc00;font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase">${recordatorio ? "Recordatorio" : soloAcuse ? "Aviso de privacidad" : "Solicitud de documentos"}</p>
<h1 style="margin:0 0 14px;font-size:26px;line-height:1.15;color:#f5f5f7">Hola, ${escH(primer)}.</h1>
<p style="margin:0 0 14px;font-size:16px;line-height:1.5;color:#a1a1a6">${recordatorio ? `Te recordamos que tu enlace para <b style="color:#f5f5f7">${escH(camp.nombre)}</b> se cierra el <b style="color:#f5f5f7">${escH(lim)}</b>. Te falta:` : `Abrimos <b style="color:#f5f5f7">${escH(camp.nombre)}</b>. Tienes hasta el <b style="color:#f5f5f7">${escH(lim)}</b> para ${soloAcuse ? "confirmar" : "entregar"}:`}</p>
<ul style="margin:0 0 22px;padding-left:20px;font-size:15px;line-height:1.6;color:#f5f5f7">${pendientes.map(x => `<li>${escH(x)}</li>`).join("")}</ul>
<p style="margin:0 0 24px"><a href="${enlace}" style="display:inline-block;background:#ffcc00;color:#111;padding:14px 24px;border-radius:999px;text-decoration:none;font-weight:700;font-size:16px">${soloAcuse ? "Leer y confirmar aviso v1" : "Subir mis documentos"}</a></p>
<p style="margin:0 0 10px;font-size:13px;color:#86868b">Después de esa fecha el enlace se cierra. ${soloAcuse ? "La recepción digital no sustituye documentos firmados en papel." : "Entrega también las copias físicas con Josué."} No compartas este enlace.</p>
<p style="margin:0;font-size:13px;color:#86868b">Si el botón no abre, copia este enlace:<br><span style="color:#a1a1a6;word-break:break-all">${enlace}</span></p>
</div>
<p style="max-width:520px;margin:14px auto 0;font-size:12px;color:#86868b;text-align:center">Báscula y Pensión El Castaño · Carretera Costera km 287, Tapachula, Chiapas · 962 564 2170</p>
</div>`;
  return { asunto, texto, html };
}

// Manda el correo de la campaña a quien tenga correo y aún tenga pendientes
async function enviarCampana(env, camp, filas, enviar, recordatorio) {
  const res = { enviados: 0, sin_correo: [], completos: 0, errores: 0, error: "" };
  // Consulta una sola vez la evidencia v1, también para recordatorios de campaña.
  const acuses = camp.docs.includes("acuse_v1") ? new Set((await env.DB.prepare("SELECT colaborador_id FROM personal_constancias WHERE documento = ? AND version = ?").bind(DOC_AVISO_PERSONAL, VERSION_AVISO_PERSONAL_V1).all()).results.map(x => x.colaborador_id)) : new Set();
  for (const f of filas) {
    const { completo, pendientes } = estadoEnCampana({ ...f, acuse_v1_en: f.acuse_v1_en || (acuses.has(f.id) ? "registrado" : null) }, camp);
    if (completo) { res.completos++; continue; }
    const para = parse(f.datos).correo;
    if (!para) { res.sin_correo.push(f.nombre); continue; }
    if (!env.AVISO_URL || !env.AVISO_TOKEN) { res.errores++; res.error = "El envío de correos no está configurado."; continue; }
    try {
      await enviar(env, { para, ...correoCampana(f, camp, pendientes, recordatorio) });
      const ahora = new Date().toISOString();
      res.enviados++;
      await env.DB.prepare("UPDATE campana_personas SET enviado = ? WHERE campana_id = ? AND colaborador_id = ?").bind(ahora, camp.id, f.id).run();
      if (recordatorio) await env.DB.prepare("UPDATE colaboradores SET recordado = ? WHERE id = ?").bind(ahora, f.id).run();
    } catch (e) {
      console.error("correo campaña", e && e.message);
      res.errores++; res.error = e.desactualizado ? "Falta actualizar el script de correo en Google." : "No se pudieron enviar algunos correos.";
    }
  }
  return res;
}

async function personasDe(env, campId) {
  const { results } = await env.DB.prepare(`SELECT c.*, p.enviado AS camp_enviado, a.aceptado_en AS acuse_v1_en
    FROM campana_personas p JOIN colaboradores c ON c.id = p.colaborador_id
    LEFT JOIN personal_constancias a ON a.colaborador_id = c.id AND a.documento = ? AND a.version = ?
    WHERE p.campana_id = ? ORDER BY c.nombre COLLATE NOCASE`).bind(DOC_AVISO_PERSONAL, VERSION_AVISO_PERSONAL_V1, campId).all();
  return results;
}

function vistaCampana(c, filas) {
  const hoy = hoyLocal();
  const abierta = c.estado === "activa" && c.limite >= hoy;
  const personas = filas.map(f => {
    const e = estadoEnCampana(f, c);
    return { id: f.id, nombre: f.nombre, folio: folioDe(f), telefono: f.telefono || "", correo: parse(f.datos).correo || "", token: f.token, enviado: f.camp_enviado || "", acuse_v1_en: f.acuse_v1_en || null, estatus: f.estatus === "inactivo" ? "inactivo" : "activo", completo: e.completo, pendientes: e.pendientes };
  });
  return {
    id: c.id, nombre: c.nombre, creado: c.creado, limite: c.limite, docs: c.docs, recordada: c.recordada || "", cerrada: c.cerrada || "",
    abierta, estado: abierta ? "activa" : "cerrada",
    total: personas.length, completos: personas.filter(p => p.completo).length, personas
  };
}

// Panel: /panel/api/colaboradores/campanas[/<id>[/accion]]
async function campanasPanel(request, env, partes, enviar) {
  const hoy = hoyLocal();
  if (partes.length === 2 && request.method === "GET") {
    const { results } = await env.DB.prepare("SELECT * FROM campanas ORDER BY creado DESC LIMIT 60").all();
    const lista = [];
    for (const c of results.map(leerCampana)) { const v = vistaCampana(c, await personasDe(env, c.id)); delete v.personas; lista.push(v); }
    return json({ ok: true, campanas: lista, hoy, documentos: DOCUMENTOS });
  }
  if (partes.length === 2 && request.method === "POST") {
    const b = await request.json().catch(() => ({}));
    const nombre = limpiar(b.nombre, 80);
    const limite = String(b.limite || "");
    const errores = {};
    if (!nombre) errores.nombre = "Ponle un nombre a la campaña.";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(limite) || limite < hoy) errores.limite = "Elige una fecha de hoy en adelante.";
    else if (limite > sumarDias(hoy, 90)) errores.limite = "Máximo 90 días.";
    const docs = Array.isArray(b.docs) ? [...new Set(b.docs.filter(k => k === "datos" || k === "acuse_v1" || DOCUMENTOS[k]))] : [];
    const { results } = await env.DB.prepare("SELECT * FROM colaboradores WHERE estatus != 'inactivo' AND COALESCE(tipo, 'colaborador') = 'colaborador'").all();
    let filas = results;
    if (b.destino === "incompletos") filas = results.filter(f => !estaCompleto(f));
    else if (b.destino === "elegidos") { const ids = new Set(Array.isArray(b.ids) ? b.ids : []); filas = results.filter(f => ids.has(f.id)); }
    if (!filas.length) errores.destino = b.destino === "elegidos" ? "Elige al menos a una persona." : "No hay colaboradores activos para esta campaña.";
    if (Object.keys(errores).length) return json({ ok: false, error: "Revisa los datos de la campaña.", errores }, 422);
    const id = await crearCampanaFilas(env, { nombre, limite, docs }, filas.map(f => f.id), new Date().toISOString());
    const camp = leerCampana(await env.DB.prepare("SELECT * FROM campanas WHERE id = ?").bind(id).first());
    const envio = b.enviar === false ? null : await enviarCampana(env, camp, filas, enviar, false);
    return json({ ok: true, id, envio, campana: vistaCampana(camp, await personasDe(env, id)) });
  }
  const id = partes[2];
  if (!/^c[0-9a-f]{16}$/.test(id || "")) return json({ ok: false, error: "Campaña no encontrada." }, 404);
  const fila = await env.DB.prepare("SELECT * FROM campanas WHERE id = ?").bind(id).first();
  if (!fila) return json({ ok: false, error: "Campaña no encontrada." }, 404);
  const camp = leerCampana(fila);
  if (partes.length === 3 && request.method === "GET") return json({ ok: true, campana: vistaCampana(camp, await personasDe(env, id)), hoy });
  if (request.method !== "POST" || partes.length !== 4) return json({ ok: false, error: "Ruta no encontrada." }, 404);
  const b = await request.json().catch(() => ({}));
  const abierta = camp.estado === "activa" && camp.limite >= hoy;
  if (partes[3] === "recordar") {
    if (!abierta) return json({ ok: false, error: "La campaña ya está cerrada." }, 409);
    const filas = (await personasDe(env, id)).filter(f => f.estatus !== "inactivo");
    const r = await enviarCampana(env, camp, filas, enviar, true);
    return json({ ok: true, ...r });
  }
  if (partes[3] === "cerrar") {
    await env.DB.prepare("UPDATE campanas SET estado = 'cerrada', cerrada = ? WHERE id = ?").bind(new Date().toISOString(), id).run();
    return json({ ok: true });
  }
  if (partes[3] === "limite") {
    const limite = String(b.limite || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(limite) || limite < hoy || limite > sumarDias(hoy, 90)) return json({ ok: false, error: "Elige una fecha entre hoy y 90 días." }, 422);
    await env.DB.prepare("UPDATE campanas SET limite = ?, estado = 'activa', cerrada = NULL, recordada = NULL WHERE id = ?").bind(limite, id).run();
    return json({ ok: true });
  }
  if (partes[3] === "agregar") {
    const ids = Array.isArray(b.ids) ? b.ids.filter(x => /^[0-9a-f-]{36}$/.test(x)) : [];
    if (!ids.length) return json({ ok: false, error: "Elige a alguien." }, 422);
    await env.DB.batch(ids.map(c => env.DB.prepare("INSERT OR IGNORE INTO campana_personas (campana_id, colaborador_id) VALUES (?, ?)").bind(id, c)));
    let envio = null;
    if (abierta && b.enviar !== false) {
      const marc = ids.map(() => "?").join(",");
      const { results } = await env.DB.prepare(`SELECT * FROM colaboradores WHERE id IN (${marc}) AND estatus != 'inactivo'`).bind(...ids).all();
      envio = await enviarCampana(env, camp, results, enviar, false);
    }
    return json({ ok: true, envio });
  }
  if (partes[3] === "quitar") {
    await env.DB.prepare("DELETE FROM campana_personas WHERE campana_id = ? AND colaborador_id = ?").bind(id, String(b.colaborador || "")).run();
    return json({ ok: true });
  }
  if (partes[3] === "eliminar") {
    await env.DB.batch([env.DB.prepare("DELETE FROM campana_personas WHERE campana_id = ?").bind(id), env.DB.prepare("DELETE FROM campanas WHERE id = ?").bind(id)]);
    return json({ ok: true });
  }
  return json({ ok: false, error: "Ruta no encontrada." }, 404);
}

// ---------------------------------------------------------------------------
  return { crearCampanaFilas, enviarCampana, personasDe, campanasPanel };
}
