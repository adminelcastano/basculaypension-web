import { leerArchivo, guardarArchivo, borrarArchivo } from "./fotos.js";
import { asegurarEsquemaCaja, mesesAbiertos } from "./caja.js";
import { resolverCategoria, adivinarCategoria } from "./categorias.js";
import { stmtBitacora, stmtBitacoraSiCambio } from "./bitacora.js";
import { idFinanciero, centavosIguales } from "./finanzas-idempotencia.js";
import { asegurarEsquemaObligaciones, stmtVincularAbono, vinculoPago, errorSaldoObligacion } from "./finanzas-obligaciones.js";

// Pagos administrativos: rutas y transacciones existentes, sin asientos paralelos.
export async function pagosHechosRutas(request, env, partes, usuario, ahora, dependencias) {
  const { normalizarMedio, json, MESES_FREC, sumarMeses, validarPagoHecho, stmtGastoAdmin, pagoEliminado, errorBancoEnEscritura, conflictoBanco, cuentaDe, errorCuentaEgreso, TIPOS_COMP, cabeceraComprobanteValida } = dependencias;
  await asegurarEsquemaObligaciones(env);
  // Pago hecho sin programar
  if (partes[2] === "hecho" && partes.length === 3 && request.method === "POST") {
    let c; try { c = await request.json(); } catch { return json({ ok: false, error: "Datos inválidos." }, 400); }
    await normalizarMedio(env, c);
    const obligacionId=c.obligacion_id==null||c.obligacion_id===""?null:String(c.obligacion_id);
    if(obligacionId && !/^[0-9a-f-]{36}$/i.test(obligacionId))
      return json({ok:false,error:"Identificador de obligación inválido."},422);
    const v = await validarPagoHecho(env, c, null);
    if (Object.keys(v.errores).length) return json({ ok: false, error: Object.values(v.errores).join(" "), errores: v.errores }, 422);
    const quien = usuario && usuario.email || null;
    let gid, pid;
    try {
      gid = await idFinanciero("gasto-pago-suelto", c.uid, quien);
      pid = await idFinanciero("pago-suelto", c.uid, quien);
    } catch (er) { return json({ok:false,error:er.message},422); }
    const cat = (await resolverCategoria(env, c.categoria)) || adivinarCategoria(v.titulo);
    const cta = await cuentaDe(env, c, null, v.forma);
    const repetido = async () => {
      const p = c.uid ? await env.DB.prepare("SELECT * FROM agenda_pagos WHERE id = ?").bind(pid).first() : null;
      if (!p) return null;
      const vinculo = await vinculoPago(env,pid);
      const igual = (vinculo?.obligacion_id||null)===obligacionId && (!vinculo||vinculo.activo===1) &&
        p.item_id === "" && p.fecha === v.fecha && p.titulo === v.titulo
        && p.forma === v.forma && centavosIguales(p.importe, v.importe)
        && (p.cuenta || null) === (cta || null) && (p.categoria || null) === (cat || null)
        && (p.nota || null) === (v.nota || null) && p.gasto_id === gid;
      return igual ? json({ok:true,id:pid,repetido:true}) :
        json({ok:false,error:"Esta operación ya registró otro pago o importe. Actualiza los pagos hechos y verifica antes de repetirla."},409);
    };
    const previo = await repetido(); if (previo) return previo;
    if (await pagoEliminado(env,pid,"Pago no programado"))
      return json({ok:false,error:"Este pago fue eliminado. Actualiza Pagos hechos antes de registrar otro."},409);
    const errorCuenta = await errorCuentaEgreso(env, c, v.forma, cta);
    if (errorCuenta) return json({ ok:false, error:errorCuenta },422);
    // Egreso y pago en una sola operación: o quedan los dos o ninguno.
    try {
      await env.DB.batch([
        stmtGastoAdmin(env, gid, v.fecha.slice(0, 7), v.fecha, ("Pago: " + v.titulo).slice(0, 120), v.importe, v.forma, ahora, quien, cat, cta, null, {id:pid,que:"Pago no programado"}),
        env.DB.prepare("INSERT INTO agenda_pagos (id, item_id, fecha, programado, importe, forma, gasto_id, creado, creado_por, titulo, nota, categoria, cuenta) VALUES (?, '', ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
          .bind(pid, v.fecha, v.importe, v.forma, gid, ahora, quien, v.titulo, v.nota, cat, cta),
        ...(obligacionId ? [stmtVincularAbono(env,{pagoId:pid,obligacionId,importeCentavos:Math.round(v.importe*100),
          fecha:v.fecha,forma:v.forma,titulo:v.titulo,ahora,quien})] : []),
        stmtBitacora(env, { quien, accion: "crear", que: "Pago no programado", ref: pid, mes: v.fecha.slice(0, 7), detalle: { fecha: v.fecha, concepto: v.titulo, importe: v.importe, forma: v.forma, cuenta: cta, categoria: cat, obligacion_id: obligacionId } })
      ]);
    } catch (er) {
      const previo = await repetido(); if (previo) return previo;
      if (errorSaldoObligacion(er))
        return json({ok:false,error:"No se pudo aplicar el abono: obligación inexistente, cancelada o saldo insuficiente. Actualiza DINERO antes de repetir."},409);
      if (errorBancoEnEscritura(er))
        return await pagoEliminado(env,pid,"Pago no programado")
          ? json({ok:false,error:"Este pago fue eliminado en otra sesión. Actualiza Pagos hechos."},409)
          : conflictoBanco();
      throw er;
    }
    return json({ ok: true, id: pid });
  }
  const pid = partes[2];
  const pago = pid ? await env.DB.prepare("SELECT * FROM agenda_pagos WHERE id = ?").bind(pid).first() : null;
  if (!pago) return json({ ok: false, error: "No existe ese pago." }, 404);
  const accion = partes[3];
  if (accion === "comprobante" && request.method === "GET") {
    if (!pago.comprobante) return new Response("Sin comprobante.", { status: 404 });
    const { value, metadata } = await leerArchivo(env, pago.comprobante);
    if (!value) return new Response("Archivo no disponible.", { status: 404 });
    const tipo = (metadata && metadata.tipo) || pago.comp_tipo || "application/octet-stream";
    return new Response(value, { headers: { "Content-Type": tipo, "Content-Disposition": "inline", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'self'" } });
  }
  if (request.method !== "POST") return json({ ok: false, error: "Ruta no encontrada." }, 404);
  await asegurarEsquemaCaja(env);
  const meses = await mesesAbiertos(env);
  if (!meses.includes(pago.fecha.slice(0, 7))) return json({ ok: false, error: "Ese pago es de un mes ya cerrado; ya no se puede cambiar." }, 409);

  if (accion === "comprobante") {
    const tipo = (request.headers.get("Content-Type") || "").split(";")[0].trim().toLowerCase();
    if (!TIPOS_COMP.includes(tipo)) return json({ ok: false, error: "Sube una foto (JPG, PNG, HEIC) o un PDF." }, 415);
    const bytes = await request.arrayBuffer();
    if (!bytes.byteLength || bytes.byteLength > 10 * 1024 * 1024) return json({ ok: false, error: "El archivo está vacío o pesa más de 10 MB." }, 413);
    if (!cabeceraComprobanteValida(bytes, tipo))
      return json({ok:false,error:"El archivo no coincide con el formato de foto o PDF indicado. Elige el archivo original."},415);
    // Llave única por versión: dos sesiones no sobrescriben el mismo archivo
    // antes de ganar la actualización condicional del recibo.
    const llave = "pc:" + pago.id + ":" + crypto.randomUUID();
    const nombre = `${pago.fecha} ${String(pago.titulo || "Pago").replace(/[^\p{L}\p{N} .-]/gu, "").slice(0, 60)}.${tipo === "application/pdf" ? "pdf" : (tipo.split("/")[1] || "jpg").replace("jpeg", "jpg")}`;
    await guardarArchivo(env, llave, bytes, { tipo, nombre, carpeta: ["Comprobantes de pago", pago.fecha.slice(0, 7)] });
    let guardado;
    try {
      const resultados = await env.DB.batch([
        env.DB.prepare(`UPDATE agenda_pagos SET comprobante = ?, comp_tipo = ?
          WHERE id = ? AND COALESCE(comprobante, '') = ?`)
          .bind(llave, tipo, pago.id, pago.comprobante || ""),
        stmtBitacoraSiCambio(env, {
          quien: usuario?.email, accion: pago.comprobante ? "editar" : "crear",
          que: "Comprobante de pago", ref: pago.id, mes: pago.fecha.slice(0, 7),
          detalle: { tipo, operacion: pago.comprobante ? "reemplazo" : "adjuntar" }
        })
      ]);
      guardado = resultados[0];
    } catch (e) {
      await borrarArchivo(env, llave).catch(() => {});
      throw e;
    }
    if (!guardado.meta?.changes) {
      await borrarArchivo(env, llave).catch(() => {});
      return json({ok:false,error:"El comprobante cambió o el pago fue eliminado en otra sesión. Actualiza Pagos hechos."},409);
    }
    // Solo borrar la versión anterior DESPUÉS de vincular la nueva.
    if (pago.comprobante) await borrarArchivo(env, pago.comprobante).catch(e => console.error("Comprobante antiguo", e?.message));
    return json({ ok: true });
  }
  if (accion === "quitar-comprobante") {
    if (!pago.comprobante) return json({ok:true,sin_cambios:true});
    const resultados = await env.DB.batch([
      env.DB.prepare(`UPDATE agenda_pagos SET comprobante = NULL, comp_tipo = NULL
        WHERE id = ? AND comprobante = ?`).bind(pago.id, pago.comprobante),
      stmtBitacoraSiCambio(env, {
        quien: usuario?.email, accion: "borrar", que: "Comprobante de pago",
        ref: pago.id, mes: pago.fecha.slice(0, 7), detalle: { operacion: "retirar" }
      })
    ]);
    const guardado = resultados[0];
    if (!guardado.meta?.changes)
      return json({ok:false,error:"El comprobante cambió en otra sesión. Actualiza Pagos hechos antes de quitarlo."},409);
    await borrarArchivo(env, pago.comprobante).catch(e => console.error("Comprobante retirado", e?.message));
    return json({ ok: true });
  }
  if (accion === "editar") {
    let c; try { c = await request.json(); } catch { return json({ ok: false, error: "Datos inválidos." }, 400); }
    await normalizarMedio(env, c);
    const v = await validarPagoHecho(env, { ...c, titulo: c.titulo ?? pago.titulo }, pago.item_id ? pago : null);
    if (Object.keys(v.errores).length) return json({ ok: false, error: Object.values(v.errores).join(" "), errores: v.errores }, 422);
    const titulo = pago.item_id ? pago.titulo : v.titulo;
    const cat = (await resolverCategoria(env, c.categoria)) || pago.categoria || adivinarCategoria(titulo);
    const cta = await cuentaDe(env, c, pago.cuenta, v.forma);
    const errorCuenta = await errorCuentaEgreso(env, c, v.forma, cta);
    if (errorCuenta) return json({ok:false,error:errorCuenta},422);
    const mismo = pago.fecha === v.fecha && centavosIguales(pago.importe, v.importe)
      && pago.forma === v.forma && (pago.nota || null) === (v.nota || null)
      && (pago.titulo || "") === (titulo || "") && (pago.categoria || null) === (cat || null)
      && (pago.cuenta || null) === (cta || null);
    if (mismo) return json({ok:true,sin_cambios:true});
    // Dos sesiones pueden abrir el mismo recibo: solo una modifica la versión
    // que ambas vieron. El cambio del gasto comparte D1.batch y depende del
    // UPDATE condicional, evitando gastos huérfanos o auditorías falsas.
    const st = [
      env.DB.prepare(`UPDATE agenda_pagos SET fecha=?, importe=?, forma=?, nota=?, titulo=?, categoria=?, cuenta=?
        WHERE id=? AND fecha=? AND importe=? AND forma=?
        AND COALESCE(nota,'')=? AND COALESCE(titulo,'')=? AND COALESCE(categoria,'')=?
        AND COALESCE(cuenta,'')=? AND (gasto_id IS NULL OR EXISTS (SELECT 1 FROM caja_gastos WHERE id=agenda_pagos.gasto_id))
        AND (? IS NULL OR EXISTS (SELECT 1 FROM fin_cuentas WHERE id = ? AND activa = 1 AND tipo = ?))`)
        .bind(v.fecha,v.importe,v.forma,v.nota,titulo,cat,cta,
          pago.id,pago.fecha,pago.importe,pago.forma,
          pago.nota||"",pago.titulo||"",pago.categoria||"",pago.cuenta||"",
          cta,cta,v.forma === "TARJETA" ? "credito" : "debito"),
      stmtBitacoraSiCambio(env, { quien: usuario && usuario.email, accion:"editar",
        que: pago.item_id ? "Pago programado" : "Pago no programado",
        ref:pago.id,mes:v.fecha.slice(0,7),
        detalle:{concepto:titulo,antes:{fecha:pago.fecha,importe:pago.importe,forma:pago.forma,cuenta:pago.cuenta,categoria:pago.categoria},
          ahora:{fecha:v.fecha,importe:v.importe,forma:v.forma,cuenta:cta,categoria:cat}}})
    ];
    if (pago.gasto_id) st.push(
      env.DB.prepare("UPDATE caja_gastos SET mes=?, dia=?, monto=?, forma=?, concepto=?, categoria=?, cuenta=? WHERE id=? AND changes()>0")
        .bind(v.fecha.slice(0,7),v.fecha,v.importe,v.forma,("Pago: "+titulo).slice(0,120),cat,cta,pago.gasto_id)
    );
    let resultado;
    try { resultado = await env.DB.batch(st); }
    catch(er) { if(errorSaldoObligacion(er))return json({ok:false,error:"El cambio supera el saldo de la obligación. Actualiza antes de editar."},409);throw er; }
    if (!resultado[0]?.meta?.changes)
      return json({ok:false,error:"Este pago cambió o fue eliminado en otra sesión. Actualiza la lista antes de corregirlo."},409);
    return json({ ok: true });
  }
  if (accion === "eliminar") {
    // Compare-and-delete: si otra sesión corrigió o eliminó el pago tras abrir
    // el diálogo, no destruir su versión más reciente ni duplicar la bitácora.
    const st = [
      env.DB.prepare(`DELETE FROM agenda_pagos WHERE id = ? AND fecha = ? AND importe = ? AND forma = ?
        AND COALESCE(cuenta, '') = ? AND COALESCE(nota, '') = ?
        AND COALESCE(titulo, '') = ? AND COALESCE(categoria, '') = ?
        AND COALESCE(comprobante, '') = ?
        AND (gasto_id IS NULL OR EXISTS (SELECT 1 FROM caja_gastos WHERE id = agenda_pagos.gasto_id))`)
        .bind(pago.id, pago.fecha, pago.importe, pago.forma, pago.cuenta || "", pago.nota || "",
          pago.titulo || "", pago.categoria || "", pago.comprobante || ""),
      stmtBitacoraSiCambio(env, { quien: usuario && usuario.email, accion: "borrar",
        que: pago.item_id ? "Pago programado" : "Pago no programado", ref: pago.id,
        mes: pago.fecha.slice(0, 7),
        detalle: { concepto: pago.titulo, fecha: pago.fecha, importe: pago.importe, forma: pago.forma, cuenta: pago.cuenta } })
    ];
    // changes() es el de la bitácora anterior: si DELETE = 0, todo sigue intacto.
    if (pago.gasto_id) st.push(
      env.DB.prepare("DELETE FROM caja_gastos WHERE id = ? AND changes() > 0").bind(pago.gasto_id)
    );
    let regreso = null;
    if (pago.item_id && pago.programado) {
      const it = await env.DB.prepare("SELECT * FROM agenda_items WHERE id = ?").bind(pago.item_id).first();
      const otro = await env.DB.prepare("SELECT 1 FROM agenda_pagos WHERE item_id = ? AND creado > ? LIMIT 1").bind(pago.item_id, pago.creado).first();
      if (it && !otro) {
        const n = MESES_FREC[it.frecuencia || "mensual"];
        if (!n && it.estado === "pagado") {
          st.push(env.DB.prepare("UPDATE agenda_items SET estado = 'pendiente', cerrado = NULL, fecha = ?, actualizado = ? WHERE id = ? AND changes() > 0")
            .bind(pago.programado, ahora, it.id));
          regreso = pago.programado;
        } else if (n && it.fecha === sumarMeses(pago.programado, n)) {
          st.push(env.DB.prepare("UPDATE agenda_items SET fecha = ?, avisado = NULL, actualizado = ? WHERE id = ? AND changes() > 0")
            .bind(pago.programado, ahora, it.id));
          regreso = pago.programado;
        }
      }
    }
    // Solo la anulación manual libera saldo. La depuración a 13 meses
    // conserva el abono histórico de obligaciones ya liquidadas.
    st.push(env.DB.prepare(`UPDATE fin_obl_abonos SET activo=0,anulado_en=? WHERE pago_id=? AND activo=1
      AND NOT EXISTS(SELECT 1 FROM agenda_pagos WHERE id=?)`).bind(ahora,pago.id,pago.id));
    const resultados = await env.DB.batch(st);
    if (!resultados[0]?.meta?.changes)
      return json({ ok:false, error:"Este pago ya cambió o fue eliminado en otra sesión. Actualiza la lista antes de intentar borrarlo." },409);
    if (pago.comprobante) await borrarArchivo(env, pago.comprobante).catch(() => {});
    return json({ ok:true, regreso });
  }
  return json({ ok: false, error: "Ruta no encontrada." }, 404);
}

