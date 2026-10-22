import { asegurarEsquemaCaja, mesesAbiertos } from "./caja.js";
import { asegurarEsquemaCompras, stmtHistorialCompra, cuentasTicket } from "./compras.js";
import { stmtBitacora, stmtBitacoraSiCambio } from "./bitacora.js";
import { idFinanciero, centavosIguales } from "./finanzas-idempotencia.js";
import { resolverCategoria, adivinarCategoria } from "./categorias.js";
import { notificar } from "./push.js";

// Compras: este módulo es el único propietario de las rutas del ticket agrupado.
// Conserva la transacción atómica y los UID; no crea un registro financiero alternativo.
export async function rutasComprasAgenda(request,env,partes,usuario,ahora,dependencias) {
  const { json, normalizarMedio, diaFinancieroValido, hoyMx, listaLugares, stmtGastoAdmin, pagoEliminado, errorBancoEnEscritura, conflictoBanco, cuentaDe, errorCuentaEgreso } = dependencias;
  // ---- Lista de compras: carrito y terminar la compra con un solo ticket ----
  // Regresar a pendiente todos los artículos de un ticket (se borra su egreso).
  // Solo afecta a la compra exacta si aún tiene sus artículos comprados:
  // una petición atrasada NO puede borrar el historial de una recompra posterior.
  if (partes[1] === "compras" && partes[2] === "regresar-ticket" && request.method === "POST") {
    let c; try { c = await request.json(); } catch { return json({ ok: false, error: "Datos inválidos." }, 400); }
    await asegurarEsquemaCaja(env); await asegurarEsquemaCompras(env);
    const gid = String(c.gasto_id || "");
    const g = await env.DB.prepare("SELECT * FROM caja_gastos WHERE id = ? AND origen = 'admin'").bind(gid).first();
    const its = (await env.DB.prepare("SELECT id, titulo, estado FROM agenda_items WHERE tipo = 'compra' AND gasto_id = ?").bind(gid).all()).results;
    if (!g || !its.length) return json({ ok: false, error: "Ese ticket ya no está disponible. Actualiza la lista antes de repetir." }, 409);
    if (!(await mesesAbiertos(env)).includes(g.mes))
      return json({ ok: false, error: "Ese ticket es de un mes ya cerrado; ya no se puede regresar a pendiente." }, 409);
    if (its.some(it => it.estado !== "comprado"))
      return json({ok:false,error:"El ticket cambió en otra sesión. Actualiza la lista."},409);
    const resultado = await env.DB.batch([
      // La compra debe seguir completa: impide que una sesión vieja retire
      // artículos que fueron movidos a otro gasto por una sesión más reciente.
      env.DB.prepare(`DELETE FROM caja_gastos WHERE id = ? AND mes = ? AND origen = 'admin'
        AND (SELECT COUNT(*) FROM agenda_items WHERE tipo = 'compra' AND estado = 'comprado' AND gasto_id = ?) = ?`)
        .bind(gid, g.mes, gid, its.length),
      stmtBitacoraSiCambio(env, { quien: usuario && usuario.email, accion: "borrar", que: "Compra", ref: gid, mes: g.mes,
        detalle: { dia: g.dia, concepto: g.concepto, importe: g.monto, forma: g.forma, cuenta: g.cuenta } }),
      // changes() en este paso pertenece a la bitácora insertada solo si DELETE ganó.
      env.DB.prepare(`UPDATE agenda_items SET estado = 'pendiente', cerrado = NULL, importe = NULL,
        gasto_id = NULL, actualizado = ? WHERE tipo = 'compra' AND estado = 'comprado'
        AND gasto_id = ? AND changes() > 0`).bind(ahora, gid),
      // Solo liberar las claves históricas de este ticket después de devolver sus artículos.
      env.DB.prepare("DELETE FROM compras_historial WHERE gasto_id = ? AND changes() > 0").bind(gid)
    ]);
    if (!resultado[0]?.meta?.changes)
      return json({ok:false,error:"Ese ticket ya fue devuelto o cambió en otra sesión. Actualiza la lista."},409);
    return json({ ok: true, n: Number(resultado[2]?.meta?.changes || 0) });
  }
  if (partes[1] === "compras" && request.method === "POST" && ["carrito", "terminar"].includes(partes[2])) {
    let c; try { c = await request.json(); } catch { return json({ ok: false, error: "Datos inválidos." }, 400); }
    const ids = [...new Set((Array.isArray(c.ids) ? c.ids : []).map(String))].slice(0, 80);
    if (!ids.length) return json({ ok: false, error: "No hay artículos." }, 422);
    let gidOperacion = null;
    let repetido = async () => null;
    if (partes[2] === "terminar") {
      const quien = usuario && usuario.email || null;
      try { gidOperacion = await idFinanciero("compra-ticket", c.uid, quien); }
      catch (er) { return json({ok:false,error:er.message},422); }
      await asegurarEsquemaCaja(env);
      const total = cuentasTicket(ids, c.total, c.precios || {});
      if (total.error) return json({ok:false,error:total.error},422);
      await normalizarMedio(env, c);
      const forma = ["EFECTIVO","TARJETA","TRANSFERENCIA"].includes(c.forma) ? c.forma : "EFECTIVO";
      const dia = c.fecha_compra == null || c.fecha_compra === "" ? hoyMx() : String(c.fecha_compra);
      if (!diaFinancieroValido(dia)) return json({ok:false,error:"La fecha de compra no existe. Revisa el calendario."},422);
      repetido = async () => {
        const gasto = c.uid ? await env.DB.prepare("SELECT * FROM caja_gastos WHERE id = ?").bind(gidOperacion).first() : null;
        if (!gasto) return null;
        const filasPrev = (await env.DB.prepare("SELECT id, importe FROM agenda_items WHERE tipo = 'compra' AND gasto_id = ?").bind(gidOperacion).all()).results;
        // Dos tickets pueden sumar lo mismo con precios individuales distintos.
        // El UID identifica también el desglose, no solo el total bancario.
        const mismosPrecios = filasPrev.every(f => f.importe == null
          ? total.precios[f.id] == null
          : total.precios[f.id] != null && centavosIguales(f.importe, total.precios[f.id]));
        const coinciden = filasPrev.length === ids.length && filasPrev.every(f => ids.includes(f.id))
          && mismosPrecios && centavosIguales(gasto.monto,total.total) && gasto.dia === dia && gasto.forma === forma
          && (c.cuenta == null || (gasto.cuenta || null) === (c.cuenta || null));
        return coinciden ? json({ok:true,gasto_id:gidOperacion,total:total.total,repetido:true}) :
          json({ok:false,error:"Esta compra ya quedó registrada con otros datos. Revisa el ticket antes de intentar repetirla."},409);
      };
      const anterior = await repetido(); if (anterior) return anterior;
      if (await pagoEliminado(env,gidOperacion,"Compra"))
        return json({ok:false,error:"Este ticket fue devuelto a pendientes. Actualiza Compras antes de intentar registrarlo de nuevo."},409);
    }
    const q = ids.map(() => "?").join(",");
    const filas = (await env.DB.prepare(`SELECT * FROM agenda_items WHERE tipo = 'compra' AND estado = 'pendiente' AND id IN (${q})`).bind(...ids).all()).results;
    if (partes[2] === "carrito") {
      await env.DB.prepare(`UPDATE agenda_items SET en_carrito = ?, actualizado = ? WHERE tipo = 'compra' AND estado = 'pendiente' AND id IN (${q})`).bind(c.v ? 1 : null, ahora, ...ids).run();
      return json({ ok: true, n: filas.length });
    }
    if (filas.length !== ids.length) return json({ ok: false, error: "Algún artículo ya no está pendiente. Actualiza la lista." }, 409);
    const cu = cuentasTicket(ids, c.total, c.precios || {});
    if (cu.error) return json({ ok: false, error: cu.error }, 422);
    // La forma se normalizó una sola vez antes de verificar el retry.
    // Normalizar dos veces perdería la cuenta de C:<id>.
    const forma = ["EFECTIVO", "TARJETA", "TRANSFERENCIA"].includes(c.forma) ? c.forma : "EFECTIVO";
    await asegurarEsquemaCaja(env); await asegurarEsquemaCompras(env);
    const dia = c.fecha_compra == null || c.fecha_compra === "" ? hoyMx() : String(c.fecha_compra);
    if (!diaFinancieroValido(dia) || dia > hoyMx() || !(await mesesAbiertos(env)).includes(dia.slice(0, 7)))
      return json({ ok: false, error: "La fecha de la compra debe existir, ser de un mes abierto y no futura." }, 422);
    const lugares = await listaLugares(env), lugarIds = [...new Set(filas.map(f => f.lugar).filter(Boolean))];
    const lugarN = lugarIds.length === 1 ? (lugares.find(l => l.id === lugarIds[0]) || {}).nombre : null;
    const orden = ids.map(id => filas.find(f => f.id === id));
    const lista = orden.map(f => f.titulo + (f.cantidad ? ` (${f.cantidad})` : "")).join(", ");
    const concepto = ((lugarN ? `Compra en ${lugarN}: ` : "Compra: ") + lista).slice(0, 120);
    // Categoría del egreso: la que más se repite entre los artículos
    const cats = {}; for (const f of orden) { const k = f.categoria; if (k) cats[k] = (cats[k] || 0) + 1; }
    const cat = (await resolverCategoria(env, c.categoria)) || Object.entries(cats).sort((a, b) => b[1] - a[1]).map(x => x[0])[0] || null;
    const cta = await cuentaDe(env, c, null, forma), quien = usuario && usuario.email || null, gid = gidOperacion;
    const errorCuenta = await errorCuentaEgreso(env, c, forma, cta);
    if (errorCuenta) return json({ok:false,error:errorCuenta},422);
    const st = [stmtGastoAdmin(env, gid, dia.slice(0, 7), dia, concepto, cu.total, forma, ahora, quien, cat, cta, null, {id:gid,que:"Compra"})];
    for (const f of orden) {
      const imp = cu.precios[f.id] ?? null;
      st.push(env.DB.prepare("UPDATE agenda_items SET estado = 'comprado', cerrado = ?, actualizado = ?, importe = ?, gasto_id = ?, pospuesta = NULL, en_carrito = NULL WHERE id = ?").bind(ahora, ahora, imp, gid, f.id));
      st.push(stmtHistorialCompra(env, f, { importe: imp, fecha: dia, gasto_id: gid, exclusiva: true }));
    }
    st.push(stmtBitacora(env, { quien, accion: "crear", que: "Compra", ref: gid, mes: dia.slice(0, 7), detalle: { dia, concepto, importe: cu.total, forma, cuenta: cta, categoria: cat, articulos: orden.length } }));
    try { await env.DB.batch(st); }
    catch (er) {
      const ya = await repetido(); if (ya) return ya;
      if (errorBancoEnEscritura(er))
        return await pagoEliminado(env,gid,"Compra")
          ? json({ok:false,error:"Este ticket fue devuelto en otra sesión. Actualiza Compras antes de registrar otro."},409)
          : conflictoBanco();
      if (/UNIQUE constraint failed: compras_historial\.id/i.test(String(er?.message || "")))
        return json({ok:false,error:"Uno de los artículos ya fue comprado por otra sesión. Actualiza la lista antes de volver a registrar el ticket."},409);
      throw er;
    }
    const deTablet = orden.filter(f => f.reporto);
    if (deTablet.length) await notificar(env, "tablet", { titulo: deTablet.length === 1 ? "Ya se compró: " + deTablet[0].titulo : `Ya se compraron ${deTablet.length} cosas que pidieron`, cuerpo: deTablet.map(f => `${f.titulo} (pidió ${f.reporto})`).join(", ").slice(0, 200), sec: "inicio", url: "/turno", etiqueta: "compra-" + gid });
    return json({ ok: true, gasto_id: gid, total: cu.total });
  }

  return null; // Ruta desconocida: el coordinador conserva su 404 anterior.
}
