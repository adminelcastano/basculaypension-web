// Perfil visual único de administración. Sólo accesible desde rutas autenticadas.
// Persistencia entre dispositivos en la KV del Worker; no modifica colaboradores ni PIN.
const KEY = "panel:perfil-admin:v1";
const FOTO = "panel:perfil-admin:foto";
const COLORES = ["amarillo", "naranja", "rosa", "morado", "azul", "turquesa"];
const LETRAS = ["normal", "grande", "muy-grande"];
const porDefecto = { nombre: "Administración", acento: "amarillo", letra: "normal", foto_ver: "" };
const limpiarNombre = v => String(v || "").trim().replace(/\s+/g, " ").slice(0, 32);

export async function leerPerfilAdmin(env) {
  const raw = await env.FILES.get(KEY, { type: "json" }).catch(() => null);
  const p = raw && typeof raw === "object" ? raw : {};
  const nombre = limpiarNombre(p.nombre) || porDefecto.nombre;
  return {
    nombre,
    acento: COLORES.includes(p.acento) ? p.acento : porDefecto.acento,
    letra: LETRAS.includes(p.letra) ? p.letra : porDefecto.letra,
    foto_ver: /^[a-z0-9]{8,24}$/.test(p.foto_ver || "") ? p.foto_ver : "",
    foto_url: /^[a-z0-9]{8,24}$/.test(p.foto_ver || "")
      ? "/panel/api/perfil-admin/foto?v=" + p.foto_ver : "/img/logo.png"
  };
}
export async function servirFotoAdmin(env) {
  const bytes = await env.FILES.get(FOTO, { type: "arrayBuffer" });
  if (!bytes) return new Response(null, { status: 302, headers: { Location: "/img/logo.png", "Cache-Control": "private, no-store" } });
  return new Response(bytes, { headers: {
    "Content-Type": "image/jpeg", "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff", "X-Robots-Tag": "noindex"
  } });
}
export async function rutaPerfilAdmin(request, env, accion) {
  const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
    status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
  });
  if (accion === "foto" && request.method === "GET") return servirFotoAdmin(env);
  if (!accion && request.method === "GET") return json({ ok: true, perfil: await leerPerfilAdmin(env) });
  if (accion || request.method !== "POST") return json({ ok: false, error: "Método no permitido." }, 405);
  if (Number(request.headers.get("Content-Length") || 0) > 360000) return json({ ok: false, error: "Foto demasiado grande." }, 413);
  const b = await request.json().catch(() => null);
  if (!b || typeof b !== "object") return json({ ok: false, error: "Datos inválidos." }, 422);
  const nombre = limpiarNombre(b.nombre);
  if (!nombre || nombre.length < 2) return json({ ok: false, error: "Escribe un nombre de perfil válido." }, 422);
  if (!COLORES.includes(b.acento) || !LETRAS.includes(b.letra)) return json({ ok: false, error: "Preferencia no válida." }, 422);
  const perfil = await leerPerfilAdmin(env);
  let ver = perfil.foto_ver;
  if (b.foto !== undefined && b.foto !== null) {
    if (b.foto === "") {
      await env.FILES.delete(FOTO);
      ver = "";
    } else {
      if (typeof b.foto !== "string" || b.foto.length > 300000 ||
          !/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(b.foto))
        return json({ ok: false, error: "Envía una fotografía JPEG válida." }, 422);
      let texto;
      try { texto = atob(b.foto.slice("data:image/jpeg;base64,".length)); }
      catch { return json({ ok: false, error: "Fotografía inválida." }, 422); }
      if (texto.length < 500 || texto.length > 200000 || texto.charCodeAt(0) !== 255 ||
          texto.charCodeAt(1) !== 216 || texto.charCodeAt(2) !== 255)
        return json({ ok: false, error: "La fotografía debe ser JPEG y pesar menos de 200 KB." }, 422);
      const bytes = Uint8Array.from(texto, c => c.charCodeAt(0));
      await env.FILES.put(FOTO, bytes.buffer);
      ver = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
    }
  }
  await env.FILES.put(KEY, JSON.stringify({ nombre, acento: b.acento, letra: b.letra, foto_ver: ver }));
  return json({ ok: true, perfil: await leerPerfilAdmin(env) });
}
