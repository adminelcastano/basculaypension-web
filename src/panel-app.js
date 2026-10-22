// Panel de la administración armado por partes (desde el 15 oct 2026):
//   src/panel/pagina.html   el HTML (sin estilos ni código)
//   src/panel/estilos.css   todos los estilos, con la base de diseño (tamaños de letra y colores con nombre)
//   src/panel/cliente/*.js  el código del navegador, uno por sección, en el orden de su número
// El Worker sirve el HTML sin caché y los estilos y el código en /panel/app.css y /panel/app.js con una versión
// (huella del contenido) en la URL: el navegador los guarda un año y solo los vuelve a bajar cuando cambian.
// Todo pasa por la verificación de Cloudflare Access igual que antes.
import PAGINA from "./panel/pagina.html";
import CSS_BASE from "./panel/estilos.css";
import CSS_NAVEGACION from "./panel/estilos-navegacion.css";
const CSS = CSS_BASE + CSS_NAVEGACION;
import J00 from "./panel/cliente/00-base.js";
import J00P from "./panel/cliente/00-perfil-admin.js";
import J01 from "./panel/cliente/01-facturacion.js";
import J02 from "./panel/cliente/02-personal.js";
import J03 from "./panel/cliente/03-caja.js";
import J04 from "./panel/cliente/04-desplazamiento.js";
import J05 from "./panel/cliente/05-finanzas.js";
import J05B from "./panel/cliente/05b-estados.js";
import J05C from "./panel/cliente/05c-salarios.js";
import J05E from "./panel/cliente/05e-obligaciones.js";
import J06 from "./panel/cliente/06-inicio.js";
import J07C from "./panel/cliente/07-compras-controlador.js";
import J07P from "./panel/cliente/07-pagos-controlador.js";
import J07 from "./panel/cliente/07-agenda.js";
import J08 from "./panel/cliente/08-navegacion.js";
import J09 from "./panel/cliente/09-ocultar.js";
import J10 from "./panel/cliente/10-avisos-push.js";
import J11 from "./panel/cliente/11-configuracion.js";
import J12 from "./panel/cliente/12-submenu.js";
import { swPush } from "./push.js";

export const JS = [J00, J00P, J01, J02, J03, J04, J05, J05B, J05C, J05E, J06, J07C, J07P, J07, J08, J09, J10, J11, J12].join("\n;\n");
// Para instalar el panel como app en el celular ("Agregar a pantalla principal")
const MANIFIESTO = {
  id: "/panel", name: "Panel · El Castaño", short_name: "El Castaño", start_url: "/panel", scope: "/panel", display: "standalone",
  background_color: "#111214", theme_color: "#111214", orientation: "portrait",
  icons: [{ src: "/img/turno-192.png", sizes: "192x192", type: "image/png", purpose: "any" }, { src: "/img/turno-512.png", sizes: "512x512", type: "image/png", purpose: "any" }]
};
// Service worker del panel: solo notificaciones (no guarda páginas; el panel siempre se pide a internet)
const SW = `self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));` + swPush("/panel");
export { CSS };

let version = null;
async function huella() {
  if (version) return version;
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(CSS + "\u0000" + JS));
  version = [...new Uint8Array(d)].slice(0, 6).map(b => b.toString(16).padStart(2, "0")).join("");
  return version;
}

export async function paginaPanel() {
  const v = await huella();
  return PAGINA.replace("{{CSS}}", `/panel/app.css?v=${v}`).replace("{{JS}}", `/panel/app.js?v=${v}`);
}

// /panel/app.css y /panel/app.js (null si no es uno de ellos)
export async function recursoPanel(ruta, url) {
  if (ruta === "/panel/app.webmanifest") return new Response(JSON.stringify(MANIFIESTO), { headers: { "Content-Type": "application/manifest+json", "Cache-Control": "no-cache" } });
  if (ruta === "/panel/sw.js") return new Response(SW, { headers: { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-cache", "Service-Worker-Allowed": "/panel", "X-Content-Type-Options": "nosniff" } });
  const tipo = ruta === "/panel/app.css" ? "text/css" : ruta === "/panel/app.js" ? "text/javascript" : null;
  if (!tipo) return null;
  const v = await huella();
  const conVersion = url.searchParams.get("v") === v;
  return new Response(tipo === "text/css" ? CSS : JS, {
    headers: {
      "Content-Type": tipo + "; charset=utf-8",
      // Con la versión correcta en la URL se guarda un año; sin ella, no se guarda
      "Cache-Control": conVersion ? "private, max-age=31536000, immutable" : "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex, nofollow"
    }
  });
}
