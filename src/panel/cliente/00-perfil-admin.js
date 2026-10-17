// Mi perfil de administración: identidad visual compartida entre el panel y CASTAGRAM.
// La fotografía se recorta en el navegador; no se guardan borradores ni archivos locales.
(() => {
  const { $, api, post, toast } = EC;
  const dialog = $("#perfil-admin-dialog"), form = $("#perfil-admin-form");
  if (!dialog || !form) return;
  let perfil = { nombre:"Administración", acento:"amarillo", letra:"normal", foto_url:"/img/logo.png", foto_ver:"" };
  let cambioFoto = null;
  const colores = ["amarillo","naranja","rosa","morado","azul","turquesa"];
  const letras = ["normal","grande","muy-grande"];
  const fotoUrl = p => p.foto_ver ? "/panel/api/perfil-admin/foto?v=" + encodeURIComponent(p.foto_ver) : "/img/logo.png";
  function aplicar(p) {
    perfil = { ...perfil, ...p };
    EC.perfilAdmin = perfil;
    document.documentElement.dataset.adminAcento = colores.includes(p.acento) ? p.acento : "amarillo";
    document.documentElement.dataset.adminLetra = letras.includes(p.letra) ? p.letra : "normal";
    $("#perfil-admin-cabecera-nombre").textContent = p.nombre || "Administración";
    const img = $("#perfil-admin-cabecera-foto");
    img.src = fotoUrl(p);
    img.alt = "";
    document.dispatchEvent(new CustomEvent("perfil-admin-actualizado", { detail: { nombre: perfil.nombre } }));
  }
  function abrir() {
    cambioFoto = null;
    $("#perfil-admin-error").textContent = "";
    $("#perfil-admin-nombre").value = perfil.nombre;
    $("#perfil-admin-acento").value = perfil.acento;
    $("#perfil-admin-letra").value = perfil.letra;
    $("#perfil-admin-vista").src = fotoUrl(perfil);
    dialog.showModal();
    $("#perfil-admin-nombre").focus({ preventScroll:true });
  }
  function cerrar() { if (dialog.open) dialog.close(); cambioFoto = null; }
  $("#perfil-admin-abrir").addEventListener("click", abrir);
  $("#perfil-admin-cerrar").addEventListener("click", cerrar);
  $("#perfil-admin-cancelar").addEventListener("click", cerrar);
  dialog.addEventListener("close", () => { cambioFoto = null; $("#perfil-admin-archivo").value = ""; });
  // Canvas quita metadatos y evita guardar fotografías originales de alta resolución.
  async function procesarFoto(file) {
    if (!file.type.startsWith("image/") || file.size > 12 * 1024 * 1024) throw Error("Elige una foto de hasta 12 MB.");
    const u = URL.createObjectURL(file);
    try {
      const img = await new Promise((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = () => reject(Error("No se pudo abrir la imagen."));
        i.src = u;
      });
      const canvas = document.createElement("canvas"); canvas.width = 320; canvas.height = 320;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw Error("No se pudo procesar la fotografía.");
      const lado = Math.min(img.naturalWidth, img.naturalHeight);
      ctx.drawImage(img, (img.naturalWidth-lado)/2, (img.naturalHeight-lado)/2, lado, lado, 0, 0, 320, 320);
      const out = canvas.toDataURL("image/jpeg", .78);
      if (out.length > 270000) throw Error("La imagen procesada sigue siendo demasiado grande.");
      return out;
    } finally { URL.revokeObjectURL(u); }
  }
  $("#perfil-admin-archivo").addEventListener("change", async e => {
    const file = e.target.files?.[0]; if (!file) return;
    $("#perfil-admin-error").textContent = "";
    try { cambioFoto = await procesarFoto(file); $("#perfil-admin-vista").src = cambioFoto; }
    catch (er) { $("#perfil-admin-error").textContent = er.message; }
    e.target.value = "";
  });
  $("#perfil-admin-quitar").addEventListener("click", () => { cambioFoto = ""; $("#perfil-admin-vista").src = "/img/logo.png"; });
  form.addEventListener("submit", async e => {
    e.preventDefault();
    const b = $("#perfil-admin-guardar"); b.disabled = true; $("#perfil-admin-error").textContent = "";
    const data = { nombre: $("#perfil-admin-nombre").value.trim(), acento:$("#perfil-admin-acento").value,
      letra:$("#perfil-admin-letra").value };
    if (cambioFoto !== null) data.foto = cambioFoto;
    try {
      const result = await post("perfil-admin", data);
      aplicar(result.perfil);
      cerrar(); toast("Perfil administrativo guardado");
    } catch (er) { $("#perfil-admin-error").textContent = er.message || "No se pudo guardar el perfil."; }
    b.disabled = false;
  });
  window.EC.perfilAdmin = perfil;
  window.EC.nombreAdmin = () => perfil.nombre || "Administración";
  window.EC.fotoAdmin = () => fotoUrl(perfil);
  api("perfil-admin").then(r => aplicar(r.perfil)).catch(() => {});
})();
