// Alcance mínimo de la tableta dentro del ensayo privado de Finanzas.
// La habilitación exige ENSAYO_FINANZAS=1 Y ENSAYO_TABLET=1;
// la verificación de Cloudflare Access y PIN siguen siendo obligatorias.
export function permitirRutaTabletEnsayo(ruta, metodo) {
  if (metodo === "GET") {
    return ruta === "/turno" || ruta.startsWith("/turno/");
  }
  if (metodo !== "POST" || !ruta.startsWith("/turno/api/")) return false;
  const accion = ruta.slice("/turno/api/".length);
  if (["entrar", "salir", "inicio", "corte", "gastos", "extras"].includes(accion)) return true;
  return /^(gastos|extras)\/[a-zA-Z0-9-]{8,80}\/eliminar$/.test(accion);
}
