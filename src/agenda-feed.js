// Lectura de feed administrativo; autorización Access se conserva en worker/agendaPanel.
// Sin estado global propio; dependencias explícitas para pruebas sintéticas.
export async function feedCastagramAdmin(env, url, deps) {
  const { asegurarEsquemaAvisos, resumenConversaciones, normalizarPara, json } = deps;
  await asegurarEsquemaAvisos(env);
  const cursor = url.searchParams.get("cursor") || "";
  const m = /^(\d{4}-\d\d-\d\dT[^|]{8,28})\|([A-Za-z0-9_-]{8,80})$/.exec(cursor);
  const condiciones = ["tipo = 'aviso'", "estado = 'activo'"], args = [];
  if(m){condiciones.push("(creado < ? OR (creado = ? AND id < ?))");args.push(m[1],m[1],m[2]);}
  const rows = (await env.DB.prepare("SELECT * FROM agenda_items WHERE "+condiciones.join(" AND ")+" ORDER BY creado DESC,id DESC LIMIT 26").bind(...args).all()).results;
  const items = rows.slice(0,25);
  if(items.length){
    const ids=items.map(x=>x.id),q=ids.map(()=>"?").join(",");
    const [lect,vistos]=await Promise.all([
      env.DB.prepare("SELECT item_id, persona, at FROM agenda_lecturas WHERE item_id IN ("+q+")").bind(...ids).all().then(x=>x.results),
      env.DB.prepare("SELECT item_id FROM aviso_vistos WHERE persona = 'ADMIN' AND item_id IN ("+q+")").bind(...ids).all().then(x=>x.results)
    ]);
    const v=new Set(vistos.map(x=>x.item_id)), conv=await resumenConversaciones(env,items,"ADMIN");
    for(const it of items){it.lecturas=lect.filter(x=>x.item_id===it.id);it.visto_admin=v.has(it.id);
      it.para=normalizarPara(it.para);it.autor=it.autor||"admin";it.conv=conv[it.id];}
  }
  const ultimo=items[items.length-1];
  return json({ok:true,items,mas:rows.length>25,cursor:ultimo?ultimo.creado+"|"+ultimo.id:""});
}
