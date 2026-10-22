import { estadoConsumo } from "./consumo.js";
import { faltantesParaFacturar } from "./facturacion-reglas.js";
import { listarCfdis, emitirMultiples, cancelarRegistro, sustituirRegistro } from "./facturas-registro.js";
import { estadoArchivos } from "./fotos.js";
import { reconocerCsfImagen } from "./lectura-csf.js";
import { personalPanel } from "./personal.js";
import { cajaPanel } from "./caja.js";
import { agendaPanel } from "./agenda.js";
import { turnoAdmin } from "./turno.js";
import { rutaPerfilAdmin } from "./perfil-admin.js";
import { reporteArea, listaReportes, TIPOS_REPORTE } from "./reporte.js";
import { finanzasPanel } from "./finanzas.js";
import { categoriasPanel } from "./categorias.js";
import { hoyPanel } from "./hoy.js";
import { clavePublica, suscribir, desuscribir, aparatos, enviarPush } from "./push.js";

// Panel interno: la autorización Access y la validación Origin/X-Panel permanecen en el Worker.
export function crearRutasPanel(deps) {
  const { LEER_TICKET_IA, RE_CP, RE_EMAIL, RE_RFC, TIPOS_IMAGEN, TIPO_PDF, asegurarEsquema, cabecerasPanel, enviarCorreoA, hReporte, json, leerTicket, limiteHistorico, limpiarPlacas, aceptarLicenciaModelo, normalizarImporte, texto, archivo, tipoArchivo, normalizarFolioTicket, folioTicketValido, leerArchivo, borrarArchivo, REGIMENES, USOS, SERVICIOS, FORMAS_PAGO } = deps;
async function rutasPanel(request, env, url, usuario) {
  const ruta = url.pathname.replace(/\/+$/, "");
  await asegurarEsquema(env);
  const partes = ruta.split("/").slice(3); // tras /panel/api/

  // En el ensayo: ningún formulario ajeno al flujo financiero puede escribir.
  if (env.ENSAYO_FINANZAS === "1" && request.method !== "GET" && request.method !== "HEAD") {
    const financiero = ["finanzas", "caja", "categorias"].includes(partes[0]);
    const agendaDinero = partes[0] === "agenda" && (
      partes[1] === "pagos" || partes[1] === "compras" ||
      (partes.length === 3 && partes[2] === "pagar") ||
      (partes.length === 3 && partes[2] === "lugar") ||
      (partes.length === 3 && partes[2] === "posponer")
    );
    if (!financiero && !agendaDinero)
      return json({ok:false,error:"Solo se permiten operaciones financieras sintéticas en el ensayo."},403);
  }

  if (partes[0] === "yo") return json({ ok: true, email: usuario.email });
  if (partes[0] === "perfil-admin") return await rutaPerfilAdmin(request, env, partes[1] || "");
  // Notificaciones push del celular del administrador
  if (partes[0] === "push") {
    if (partes.length === 1 && request.method === "GET") return json({ ok: true, clave: await clavePublica(env), aparatos: await aparatos(env, "admin") });
    const c = request.method === "POST" ? await request.json().catch(() => ({})) : {};
    if (partes.length === 1 && request.method === "POST") {
      try { await suscribir(env, "admin", c.sub, c.aparato); } catch (e) { return json({ ok: false, error: e.message }, 422); }
      return json({ ok: true });
    }
    if (partes[1] === "quitar" && request.method === "POST") { await desuscribir(env, c.endpoint); return json({ ok: true }); }
    if (partes[1] === "prueba" && request.method === "POST") {
      const n = await enviarPush(env, "admin", { titulo: "Notificaciones activadas", cuerpo: "Así te llegarán las incidencias, avisos y tareas de la tablet.", sec: "incidencia", etiqueta: "prueba" });
      return json({ ok: true, enviados: n });
    }
  }
  // Tablero de Hoy: una sola llamada que junta lo que pide atención (las demás rutas se consultan aquí mismo)
  if (partes[0] === "hoy" && request.method === "GET") {
    const interno = async r => { const u = new URL("/panel/api/" + r, url.origin); return (await rutasPanel(new Request(u, { method: "GET" }), env, u, usuario)).json(); };
    return json(await hoyPanel(env, interno));
  }
  // Diagnóstico privado, explícito y no destructivo de Correo Panel.
  // Nunca llama a la función "probar()" de Apps Script, que en versiones antiguas envía correo.
  // Sólo invoca drive(op=probar): leer nombre de las dos carpetas del personal.
  if (partes[0] === "diagnostico" && partes[1] === "correo-panel" && partes.length === 2) {
    if (request.method !== "POST") return json({ ok: false, error: "Método no permitido." }, 405);
    if (!env.AVISO_URL || !env.AVISO_TOKEN) return json({ ok: false, error: "Correo Panel no configurado." }, 503);
    try {
      const respuesta = await fetch(env.AVISO_URL.trim(), {
        method: "POST", redirect: "follow",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: env.AVISO_TOKEN.trim(), accion: "drive", op: "probar" }),
        signal: AbortSignal.timeout(12000)
      });
      const texto = (await respuesta.text()).trim();
      // No devolver nunca el cuerpo, la URL, los secretos ni detalles del proveedor.
      return json({ ok: respuesta.ok && texto === "ok-drive",
        conexion: respuesta.ok && texto === "ok-drive" ? "verificada" : "no_confirmada" },
        respuesta.ok && texto === "ok-drive" ? 200 : 502);
    } catch {
      return json({ ok: false, conexion: "no_confirmada" }, 502);
    }
  }
  if (partes[0] === "colaboradores") return await personalPanel(request, env, url, partes, enviarCorreoA);
  // Reportes mensuales en Google Sheets (Turnos, Finanzas y Facturación): lista y generación a demanda
  if (partes[0] === "reportes") {
    const tipo = TIPOS_REPORTE[url.searchParams.get("tipo")] ? url.searchParams.get("tipo") : null;
    if (request.method === "GET") return json({ ok: true, reportes: await listaReportes(env, tipo), script: !!(env.AVISO_URL && env.AVISO_TOKEN) });
    if (request.method === "POST") {
      const c = await request.json().catch(() => ({}));
      const mes = String(c.mes || ""), t = String(c.tipo || "");
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) return json({ ok: false, error: "Elige el mes." }, 422);
      if (!TIPOS_REPORTE[t]) return json({ ok: false, error: "Elige el reporte." }, 422);
      if (!env.AVISO_URL || !env.AVISO_TOKEN) return json({ ok: false, error: "Falta conectar el script de Google." }, 503);
      try { return json({ ok: true, ...(await reporteArea(env, t, mes, hReporte)) }); }
      catch (e) { return json({ ok: false, error: String(e && e.message || e).slice(0, 300) }, 502); }
    }
  }
  if (partes[0] === "finanzas") return await finanzasPanel(request, env, url, partes, usuario);
  if (partes[0] === "categorias" && partes.length === 1) return await categoriasPanel(request, env);
  if (partes[0] === "caja") return await cajaPanel(request, env, url, partes, usuario, {});
  if (partes[0] === "agenda") return await agendaPanel(request, env, url, partes, usuario);
  if (partes[0] === "turno") return await turnoAdmin(request, env, url, partes);
  if (partes[0] === "consumo" && request.method === "GET") {
    const [consumo, archivos] = await Promise.all([estadoConsumo(env), estadoArchivos(env).catch(e => ({ error: e.message }))]);
    return json({ ok: true, consumo, archivos });
  }

  if (partes[0] === "solicitudes" && partes.length === 1 && request.method === "GET") {
    const estado = ["pendiente", "facturada", "enviada", "rechazada", "cancelada", "historico"].includes(url.searchParams.get("estado")) ? url.searchParams.get("estado") : "pendiente";
    const q = (url.searchParams.get("q") || "").trim().slice(0, 60);
    const lim = limiteHistorico();
    let sql = "SELECT id, folio, creado, estado, servicio, folio_ticket, modo, rfc, nombre, email, folio_factura, resuelta_en, importe, tarifa, cliente, facturas_solicitadas FROM solicitudes WHERE ";
    const args = [];
    if (estado === "pendiente") sql += "estado IN ('pendiente','en_revision')";
    else if (estado === "historico") { sql += "estado IN ('facturada','enviada','rechazada') AND resuelta_en < ?"; args.push(lim); }
    else { sql += "estado = ? AND resuelta_en >= ?"; args.push(estado, lim); }
    if (q) {
      sql += " AND (rfc LIKE ? OR nombre LIKE ? OR folio LIKE ? OR email LIKE ? OR folio_ticket LIKE ? OR folio_factura LIKE ?)";
      const like = "%" + q.replace(/[%_]/g, "") + "%";
      args.push(like, like, like, like, like, like);
    }
    // Por páginas: el panel pide más con "Ver más" (antes se cortaba en 300 sin avisar)
    const limite = Math.min(2000, Math.max(50, Number(url.searchParams.get("limite")) || 200));
    sql += (estado === "pendiente" ? " ORDER BY creado ASC" : " ORDER BY resuelta_en DESC") + ` LIMIT ${limite + 1}`;
    const { results: todos } = await env.DB.prepare(sql).bind(...args).all();
    const hayMas = todos.length > limite, results = todos.slice(0, limite);
    // Las pantallas de Facturación cargan cinco grupos a la vez. Sólo la primera
    // necesita los conteos; otros clientes mantienen la respuesta completa por defecto.
    const soloLista = url.searchParams.get("solo_lista") === "1";
    const conteos = soloLista ? null : await env.DB.prepare(
      "SELECT CASE WHEN estado IN ('facturada','enviada','rechazada') AND resuelta_en < ? THEN 'historico' WHEN estado = 'en_revision' THEN 'pendiente' ELSE estado END AS grupo, COUNT(*) AS n FROM solicitudes GROUP BY grupo"
    ).bind(lim).all();
    return json({ ok: true, solicitudes: results, hay_mas: hayMas, limite,
      conteos: conteos ? Object.fromEntries(conteos.results.map(r => [r.grupo, r.n])) : {},
      dias_retencion: DIAS_RETENCION });
  }

  const id = partes[1];
  if (partes[0] === "solicitudes" && id && /^[0-9a-f-]{36}$/.test(id)) {
    const fila = await env.DB.prepare("SELECT * FROM solicitudes WHERE id = ?").bind(id).first();
    if (!fila) return json({ ok: false, error: "No existe esa solicitud." }, 404);

    if (partes.length === 2 && request.method === "GET") {
      let duplicados = [];
      if (fila.folio_ticket) {
        const r = await env.DB.prepare("SELECT folio, estado, folio_factura, creado FROM solicitudes WHERE REPLACE(REPLACE(UPPER(TRIM(folio_ticket)), ' ', ''), '-', '') = ? AND id != ? AND (servicio = ? OR servicio = 'ambos' OR ? = 'ambos') ORDER BY creado DESC LIMIT 5")
          .bind(normalizarFolioTicket(fila.folio_ticket), id, fila.servicio, fila.servicio).all();
        duplicados = r.results;
      }
      const normalizado = normalizarFolioTicket(fila.folio_ticket);
      let yaFacturado = null, contraste = null;
      if (normalizado) {
        yaFacturado = await env.DB.prepare("SELECT solicitud_id, folio_factura FROM facturas_folios WHERE servicio = ? AND folio_normalizado = ?")
          .bind(fila.servicio, normalizado).first();
        if (!yaFacturado) {
          // Registros históricos todavía presentes, antes de la nueva reserva única.
          yaFacturado = await env.DB.prepare("SELECT id AS solicitud_id, folio_factura FROM solicitudes WHERE id != ? AND servicio=? AND estado IN ('facturada','enviada') AND REPLACE(REPLACE(UPPER(TRIM(folio_ticket)), ' ', ''), '-', '') = ? LIMIT 1")
            .bind(fila.id, fila.servicio, normalizado).first();
        }
        // La hoja de ingresos es una referencia para aclaraciones, no una autorización
        // automática para facturar ni una prueba concluyente de pago.
        try {
          const movimientos = (await env.DB.prepare("SELECT folio, importe, forma, fecha FROM caja_mov WHERE servicio = ? AND tipo = 'ticket' AND REPLACE(REPLACE(UPPER(TRIM(folio)), ' ', ''), '-', '') = ? ORDER BY fecha DESC LIMIT 3")
            .bind(fila.servicio, normalizado).all()).results;
          const pend = (await env.DB.prepare("SELECT estado, monto FROM caja_pendientes WHERE servicio = ? AND REPLACE(REPLACE(UPPER(TRIM(folio)), ' ', ''), '-', '') = ? AND origen_activo = 1 LIMIT 1")
            .bind(fila.servicio, normalizado).first());
          contraste = movimientos.length
            ? { encontrado: true, registros: movimientos, advertencia: null }
            : { encontrado: false, registros: [], advertencia: "El folio no aparece entre los tickets de ingresos sincronizados. Verifica el número en la foto; puedes continuar después de aclararlo." };
          if (pend && ["pendiente", "parcial"].includes(pend.estado))
            contraste.advertencia = "El folio aparece con un cobro pendiente o parcialmente abonado. Verifica antes de emitir.";
          else if (pend && pend.estado === "cancelado")
            contraste.advertencia = "El registro de cobro pendiente fue cancelado. Comprueba la situación del ticket antes de emitir.";
          if (movimientos.length && fila.importe && !movimientos.some(m => Math.abs(Number(m.importe) - Number(fila.importe)) < 0.01))
            contraste.advertencia = "El importe capturado no coincide con el registrado en ingresos. Comprueba la foto del ticket.";
        } catch (e) {
          contraste = { encontrado: null, registros: [], advertencia: "No se pudo consultar ingresos. Verifica manualmente el folio del ticket." };
        }
      }
      return json({ ok: true, solicitud: fila, cfdis: await listarCfdis(env, fila), duplicados, ya_facturado: yaFacturado, contraste, regimenes: REGIMENES, usos: USOS, servicios: SERVICIOS, formas_pago: FORMAS_PAGO });
    }

    if (partes[2] === "archivo" && ["ticket", "csf"].includes(partes[3]) && request.method === "GET") {
      const { value, metadata } = await leerArchivo(env, `f:${id}:${partes[3]}`);
      if (!value) return new Response("Archivo no disponible (pudo haberse borrado por antigüedad).", { status: 404, headers: cabecerasPanel() });
      const tipo = metadata && (TIPOS_IMAGEN.includes(metadata.tipo) || metadata.tipo === TIPO_PDF) ? metadata.tipo : "application/octet-stream";
      const ext = tipo === TIPO_PDF ? "pdf" : (tipo.split("/")[1] || "bin");
      // Se permite mostrar el archivo dentro del propio panel (mismo sitio), nunca en otros sitios
      return new Response(value, {
        headers: {
          "Content-Type": tipo,
          "Content-Disposition": `inline; filename="${fila.folio}-${partes[3]}.${ext}"`,
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
          "X-Robots-Tag": "noindex, nofollow",
          "Referrer-Policy": "no-referrer",
          "X-Frame-Options": "SAMEORIGIN",
          "Content-Security-Policy": "frame-ancestors 'self'"
        }
      });
    }

    // OCR de constancias exclusivo del panel protegido: no almacena la imagen procesada,
    // no expone texto completo de documentos y NO guarda campos fiscales automáticamente.
    if (partes[2] === "leer-csf-imagen" && partes.length === 3 && request.method === "POST") {
      if (fila.modo !== "csf" || fila.archivos_borrados || ["facturada", "enviada"].includes(fila.estado))
        return json({ ok: false, error: "Esta constancia no está disponible para revisión." }, 409);
      if (!env.AI) return json({ ok: false, error: "La lectura asistida no está disponible. Captura los datos viendo la constancia." }, 503);
      if (Number(request.headers.get("Content-Length") || 0) > 7 * 1024 * 1024)
        return json({ ok: false, error: "La imagen de la constancia supera el límite de lectura." }, 413);
      const cuerpo = await request.json().catch(() => null);
      if (!cuerpo || typeof cuerpo !== "object" || Array.isArray(cuerpo))
        return json({ ok: false, error: "Solicitud de lectura inválida." }, 422);
      let bytes, tipo;
      if (Object.hasOwn(cuerpo, "imagen")) {
        // Imagen JPEG generada dentro del navegador a partir de PDF escaneado o HEIC.
        const txt = cuerpo.imagen;
        if (typeof txt !== "string" || txt.length > 6_500_000 || !/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(txt))
          return json({ ok: false, error: "La página escaneada debe enviarse como imagen JPEG." }, 422);
        try { bytes = Uint8Array.from(atob(txt.slice(txt.indexOf(",") + 1)), c => c.charCodeAt(0)); }
        catch { return json({ ok: false, error: "Imagen codificada incorrectamente." }, 422); }
        tipo = await tipoArchivo(new Blob([bytes]));
        if (tipo !== "image/jpeg") return json({ ok: false, error: "El archivo no es una imagen JPEG válida." }, 422);
      } else {
        const archivo = await leerArchivo(env, "f:" + id + ":csf");
        if (!archivo?.value) return json({ ok: false, error: "La constancia ya no está disponible." }, 404);
        bytes = new Uint8Array(archivo.value);
        tipo = await tipoArchivo(new Blob([bytes]));
        if (!["image/jpeg", "image/png", "image/webp"].includes(tipo))
          return json({ ok: false, error: "Este formato no admite lectura directa. Captura los datos o convierte la imagen a JPG." }, 422);
      }
      if (bytes.byteLength < 500 || bytes.byteLength > 5 * 1024 * 1024)
        return json({ ok: false, error: "La imagen debe pesar entre 500 bytes y 5 MB para lectura asistida." }, 413);
      try {
        await aceptarLicenciaModelo(env);
        const resultado = await reconocerCsfImagen(env, bytes, tipo);
        return json({ ok: true, ...resultado });
      } catch {
        // La IA puede estar saturada o sin cupo; no registrar contenido personal en logs.
        return json({ ok: false, error: "No se pudo leer la constancia automáticamente. Captura o revisa los datos manualmente." }, 503);
      }
    }

    if (request.method === "POST" && partes.length === 3) {
      const cuerpo = await request.json().catch(() => ({}));
      const ahora = new Date().toISOString();


      // Registro administrativo, nunca emisión ni cancelación fiscal automática.
      if (partes[2] === "facturas-multiples") {
        const ft = String(cuerpo.folio_ticket ?? fila.folio_ticket ?? "").trim().slice(0, 40);
        const faltan = faltantesParaFacturar({ ...fila, folio_ticket: ft }, { regimenes: REGIMENES, usos: USOS });
        if (faltan.length) return json({ok:false,error:"Verifica los datos fiscales y el ticket: "+faltan.join(", ")+".",faltantes:faltan},422);
        const n = normalizarFolioTicket(ft);
        const reservado = await env.DB.prepare("SELECT solicitud_id FROM facturas_folios WHERE servicio=? AND folio_normalizado=?").bind(fila.servicio,n).first();
        if(reservado) return json({ok:false,error:"Ese ticket ya está reservado. Consulta los CFDI existentes.",duplicado:true},409);
        const anterior = await env.DB.prepare("SELECT id FROM solicitudes WHERE id!=? AND servicio=? AND estado IN ('facturada','enviada','cancelada') AND REPLACE(REPLACE(UPPER(TRIM(folio_ticket)),' ',''),'-','')=? LIMIT 1").bind(id,fila.servicio,n).first();
        if(anterior)return json({ok:false,error:"El ticket figura facturado en otra solicitud.",duplicado:true},409);
        const resultado=await emitirMultiples(env,fila,cuerpo,usuario?.email||"Administración",ahora,{normalizado:n,original:ft});
        return json(resultado,resultado.status||200);
      }
      if (partes[2] === "cancelar-cfdi") {
        const resultado=await cancelarRegistro(env,fila,cuerpo,usuario?.email||"Administración",ahora);
        return json(resultado,resultado.status||200);
      }
      if (partes[2] === "sustituir-cfdi") {
        const resultado=await sustituirRegistro(env,fila,cuerpo,usuario?.email||"Administración",ahora,normalizarFolioTicket(fila.folio_ticket));
        return json(resultado,resultado.status||200);
      }
      if (partes[2] === "confirmar-aviso-cancelacion") {
        const cfdis=await listarCfdis(env,fila);
        if(!cfdis.some(x=>x.estado==="cancelada"))return json({ok:false,error:"No hay cancelación que avisar."},409);
        if(cuerpo.confirmado!==true)return json({ok:false,error:"Confirma que avisaste al cliente fuera de esta web."},422);
        await env.DB.prepare("UPDATE solicitudes SET aviso_cancelacion_en=?,aviso_cancelacion_por=? WHERE id=?").bind(ahora,usuario?.email||null,id).run();
        return json({ok:true});
      }
      if (partes[2] === "en-revision") {
        if (fila.estado !== "pendiente") return json({ ok: false, error: "Sólo puedes iniciar revisión de una solicitud recibida." }, 409);
        await env.DB.prepare("UPDATE solicitudes SET estado='en_revision' WHERE id=?").bind(id).run();
        return json({ ok: true });
      }
      if (partes[2] === "enviada") {
        if (fila.estado !== "facturada") return json({ ok: false, error: "Primero registra el CFDI emitido en Facturador." }, 409);
        await env.DB.prepare("UPDATE solicitudes SET estado='enviada', enviada_en=? WHERE id=?").bind(ahora, id).run();
        return json({ ok: true });
      }
      if (partes[2] === "facturar") {
        if (![ "pendiente", "en_revision", "rechazada" ].includes(fila.estado)) return json({ ok: false, error: "Esta solicitud ya está facturada o enviada." }, 409);
        const folioFactura = String(cuerpo.folio_factura || "").trim().slice(0, 60);
        if (!folioFactura) return json({ ok: false, error: "Escribe el folio o UUID de la factura." }, 422);
        const importe = normalizarImporte(cuerpo.importe);
        if (importe === null || !importe || Number(importe) <= 0) return json({ ok: false, error: "Indica un importe válido mayor a cero antes de marcar facturada." }, 422);
        const folioTicket = String(cuerpo.folio_ticket ?? fila.folio_ticket ?? "").trim().slice(0, 40);
        const incompletos = faltantesParaFacturar({ ...fila, folio_ticket: folioTicket }, { regimenes: REGIMENES, usos: USOS });
        if (incompletos.length) return json({ ok: false, error: "Antes de marcar facturada verifica: " + incompletos.join(", ") + ".", faltantes: incompletos }, 422);
        const n = normalizarFolioTicket(folioTicket);
        const ya = await env.DB.prepare("SELECT folio_factura FROM facturas_folios WHERE servicio=? AND folio_normalizado=?")
          .bind(fila.servicio, n).first();
        if (ya) return json({ ok: false, error: "Este ticket ya está facturado con el folio " + ya.folio_factura + ". Revisa y rechaza esta solicitud duplicada.", duplicado: true }, 409);
        // Incluye facturas recientes previas a la introducción del índice.
        const anterior = await env.DB.prepare("SELECT folio_factura FROM solicitudes WHERE id != ? AND servicio=? AND estado IN ('facturada','enviada') AND REPLACE(REPLACE(UPPER(TRIM(folio_ticket)), ' ', ''), '-', '') = ? LIMIT 1")
          .bind(id, fila.servicio, n).first();
        if (anterior) return json({ ok: false, error: "El ticket ya se facturó en otra solicitud (" + anterior.folio_factura + "). No se permite una segunda factura.", duplicado: true }, 409);
        const vence = new Date();
        vence.setFullYear(vence.getFullYear() + 5);
        try {
          // D1 ejecuta batch transaccional: una segunda petición simultánea
          // no puede reservar el mismo ticket dos veces.
          await env.DB.batch([
            env.DB.prepare("INSERT INTO facturas_folios (servicio, folio_normalizado, solicitud_id, folio_factura, creado, vence) VALUES (?, ?, ?, ?, ?, ?)")
              .bind(fila.servicio, n, id, folioFactura, ahora, vence.toISOString()),
            env.DB.prepare("UPDATE solicitudes SET estado='facturada', folio_factura=?, importe=?, folio_ticket=?, resuelta_en=?, motivo=NULL WHERE id=?")
              .bind(folioFactura, importe, folioTicket, ahora, id)
          ]);
        } catch (e) {
          if (/UNIQUE|constraint/i.test(String(e?.message || ""))) return json({ ok: false, error: "El folio ya quedó reservado como facturado. No se permite duplicarlo.", duplicado: true }, 409);
          throw e;
        }
        return json({ ok: true });
      }
      if (partes[2] === "rechazar") {
        if (![ "pendiente", "en_revision" ].includes(fila.estado)) return json({ ok: false, error: "Sólo pueden rechazarse solicitudes no facturadas." }, 409);
        const motivo = String(cuerpo.motivo || "").trim().slice(0, 300);
        if (!motivo) return json({ ok: false, error: "Escribe el motivo." }, 422);
        await env.DB.prepare("UPDATE solicitudes SET estado='rechazada', motivo=?, resuelta_en=? WHERE id=?").bind(motivo, ahora, id).run();
        return json({ ok: true });
      }
      if (partes[2] === "reabrir") {
        if (fila.estado !== "rechazada") return json({ ok: false, error: "Una factura emitida no se reabre sin gestionar antes su cancelación en Facturador." }, 409);
        if (fila.archivos_borrados) return json({ ok: false, error: "Los archivos de esta solicitud ya se borraron; pide al cliente que la envíe de nuevo." }, 409);
        await env.DB.prepare("UPDATE solicitudes SET estado='pendiente', resuelta_en=NULL WHERE id=?").bind(id).run();
        return json({ ok: true });
      }
      if (partes[2] === "leer-ticket") {
        if (!LEER_TICKET_IA || !env.AI) return json({ ok: false, error: "La lectura automática del ticket está desactivada: captura los datos a mano." }, 410);
        const r = await leerTicket(env, id, true);
        if (r.error) return json({ ok: false, error: r.error }, 422);
        return json({ ok: true, datos: r.datos });
      }
      if (partes[2] === "eliminar") {
        if (fila.estado !== "rechazada") return json({ ok: false, error: "Solo se pueden eliminar solicitudes rechazadas." }, 409);
        await borrarArchivo(env, `f:${id}:ticket`);
        await borrarArchivo(env, `f:${id}:csf`);
        await env.DB.prepare("DELETE FROM solicitudes WHERE id = ?").bind(id).run();
        return json({ ok: true });
      }
      if (partes[2] === "datos") {
        if (![ "pendiente", "en_revision", "rechazada" ].includes(fila.estado)) return json({ ok: false, error: "Los datos de un CFDI ya emitido no se pueden alterar desde la solicitud." }, 409);
        const rfc = String(cuerpo.rfc || "").toUpperCase().replace(/[\s-]/g, "");
        const nombre = String(cuerpo.nombre || "").replace(/\s+/g, " ").trim().slice(0, 254);
        // Solicitudes históricas pueden estar sin correo: permitir corregir otros datos
        // mientras el administrador localiza el contacto, pero validar todo correo escrito.
        const email = "email" in cuerpo ? String(cuerpo.email || "").trim().toLowerCase().slice(0, 254) : (fila.email || "");
        const regimen = String(cuerpo.regimen || "");
        const cp = String(cuerpo.cp || "").trim();
        const errores = {};
        if (rfc && !RE_RFC.test(rfc)) errores.rfc = "RFC con formato inválido.";
        if (email && !RE_EMAIL.test(email)) errores.email = "Correo electrónico inválido.";
        if (regimen && !REGIMENES[regimen]) errores.regimen = "Régimen inválido.";
        if (cp && !RE_CP.test(cp)) errores.cp = "Código postal inválido.";
        const importe = "importe" in cuerpo ? normalizarImporte(cuerpo.importe) : (fila.importe || "");
        if (importe === null) errores.importe = "Importe inválido.";
        const telefono = "telefono" in cuerpo ? String(cuerpo.telefono || "").replace(/\D/g, "").slice(-10) : (fila.telefono || "");
        if (telefono && telefono.length !== 10) errores.telefono = "El WhatsApp debe tener 10 dígitos.";
        const folioTicket = "folio_ticket" in cuerpo ? String(cuerpo.folio_ticket || "").trim().slice(0, 40) : (fila.folio_ticket || "");
        if (folioTicket && !folioTicketValido(folioTicket)) errores.folio_ticket = "Escribe únicamente el número del ticket.";
        const placas = "placas" in cuerpo ? limpiarPlacas(cuerpo.placas) : (fila.placas || "");
        const descripcion = "descripcion" in cuerpo ? String(cuerpo.descripcion || "").replace(/\s+/g, " ").trim().slice(0, 120) : (fila.descripcion || "");
        const tarifa = "tarifa" in cuerpo ? String(cuerpo.tarifa || "").replace(/\s+/g, " ").trim().slice(0, 60) : (fila.tarifa || "");
        const cliente = "cliente" in cuerpo ? String(cuerpo.cliente || "").replace(/\s+/g, " ").trim().slice(0, 120) : (fila.cliente || "");
        const formaPago = "forma_pago" in cuerpo ? String(cuerpo.forma_pago || "") : (fila.forma_pago || "");
        if (formaPago && !FORMAS_PAGO[formaPago]) errores.forma_pago = "Forma de pago inválida.";
        const anotacion = "anotacion" in cuerpo ? String(cuerpo.anotacion || "").replace(/\s+/g, " ").trim().slice(0, 80) : (fila.anotacion || "");
        if (Object.keys(errores).length) return json({ ok: false, error: "Revisa los datos.", errores }, 422);
        await env.DB.prepare("UPDATE solicitudes SET rfc=?, nombre=?, regimen=?, cp=?, datos_de_csf=?, importe=?, telefono=?, folio_ticket=?, placas=?, descripcion=?, tarifa=?, anotacion=?, cliente=?, forma_pago=?, email=? WHERE id=?")
          .bind(rfc || null, nombre || null, regimen || null, cp || null, cuerpo.de_csf ? 1 : 0, importe || null, telefono || null, folioTicket || null, placas || null, descripcion || null, tarifa || null, anotacion || null, cliente || null, formaPago || null, email, id).run();
        return json({ ok: true });
      }
    }
  }
  return json({ ok: false, error: "Ruta no encontrada." }, 404);
}

  return rutasPanel;
}
