// Vista independiente de los componentes económicos del Panel.
// Conserva la misma aplicación y base de datos, sin duplicar movimientos.
export function transformarPanelFinanciero(documento) {
  if (typeof documento !== "string" || !documento.includes('id="mod-finanzas"') ||
      !documento.includes('id="mod-caja"') || !documento.includes('id="mod-agenda"') ||
      !documento.includes('<nav class="modulos" aria-label="Sección">') ||
      !documento.includes('href="/panel/app.webmanifest"')) {
    throw new Error("Cambió la estructura del Panel; revisar Panel Financiero.");
  }

  const menu = [
    '<nav class="modulos" aria-label="Secciones financieras">',
    '<button type="button" data-mod="caja" aria-current="page"><svg class="mi" aria-hidden="true"><use href="#i-billete"/></svg><span>Caja</span></button>',
    '<button type="button" data-mod="dinero"><svg class="mi" aria-hidden="true"><use href="#i-tendencia"/></svg><span>Dinero</span></button>',
    '<button type="button" data-mod="agenda"><svg class="mi" aria-hidden="true"><use href="#i-carrito"/></svg><span>Compras</span></button>',
    '</nav>'
  ].join("\n");
  // Elementos ocultos conservan anclas internas para los controladores
  // compartidos. No se exponen como secciones navegables.
  const estilos = [
    '<style id="panel-financiero-estilo">',
    'body[data-panel-financiero="1"] #mod-inicio,',
    'body[data-panel-financiero="1"] #mod-facturacion,',
    'body[data-panel-financiero="1"] #mod-personal,',
    'body[data-panel-financiero="1"] #mod-config,',
    'body[data-panel-financiero="1"] #cfg-abrir,',
    'body[data-panel-financiero="1"] #perfil-admin-abrir,',
    'body[data-panel-financiero="1"] .cfg-ir,',
    'body[data-panel-financiero="1"] #perfil-admin-dialog,',
    'body[data-panel-financiero="1"] #undo { display:none!important }',
    'body[data-panel-financiero="1"] #mod-agenda .bloque[data-bloque]:not([data-bloque="compras"]),',
    'body[data-panel-financiero="1"] #mod-agenda .sub-nav [data-ir]:not([data-ir="todo"]):not([data-ir="compras"]),',
    'body[data-panel-financiero="1"] #mod-agenda .sub-idx [data-ir]:not([data-ir="compras"]) { display:none!important }',
    'body[data-panel-financiero="1"] #mod-agenda .sub-volver { display:none!important }',
    'body[data-panel-financiero="1"] .bar h1 { font-size:clamp(1rem,2.4vw,1.35rem) }',
    '</style>'
  ].join("\n");

  return documento
    .replace("<title>Panel · El Castaño</title>", "<title>Panel Financiero · El Castaño</title>")
    .replace("<body>", '<body data-panel-financiero="1">')
    .replace(/<nav class="modulos" aria-label="Sección">[\s\S]*?<\/nav>/, menu)
    .replace(/<h1>El Castaño<\/h1>/, "<h1>Panel Financiero</h1>")
    // Identidad PWA independiente: instalar Finanzas no reemplaza al Panel general.
    // Se conserva crossorigin para que Chrome solicite el manifest con Cloudflare Access.
    .replace(/<link rel="manifest" href="\/panel\/app\.webmanifest"[^>]*>\s*/,
      '<link rel="manifest" href="/panel/financiero.webmanifest" crossorigin="use-credentials">\n')
    .replace("</head>", [
      '<meta name="application-name" content="Panel Financiero">',
      '<meta name="apple-mobile-web-app-capable" content="yes">',
      '<meta name="apple-mobile-web-app-title" content="Financiero">',
      '<meta name="apple-mobile-web-app-status-bar-style" content="black">',
      '<link rel="apple-touch-icon" href="/apple-touch-icon.png">',
      estilos,
      "</head>"
    ].join("\n"));
}
