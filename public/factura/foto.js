// Revisión y mejora de fotos de tickets en el teléfono del cliente, antes de enviarlas.
// No sube nada: solo analiza la imagen y genera una versión más legible.
(function () {
  "use strict";

  // Umbrales calibrados con 19 fotos reales de tickets (oct 2026): 6 borrosas rechazadas, 13 legibles aceptadas
  const NITIDEZ_MIN = 17;      // nitidez mínima dentro del ticket (19 fotos reales: borrosas ≤14.5, buenas ≥20)
  const LADO_MIN = 500;        // píxeles del lado corto
  const BRILLO_MIN = 45;       // promedio de gris (0-255)
  const CONTRASTE_MIN = 45;    // diferencia entre tonos claros y oscuros

  async function cargar(file) {
    try { return await createImageBitmap(file, { imageOrientation: "from-image" }); }
    catch {
      return await new Promise((res, rej) => {
        const img = new Image();
        img.onload = () => res(img);
        img.onerror = () => rej(new Error("No se pudo abrir la imagen"));
        img.src = URL.createObjectURL(file);
      });
    }
  }

  function grises(fuente, maxLado) {
    const w0 = fuente.width, h0 = fuente.height;
    const k = Math.min(1, maxLado / Math.max(w0, h0));
    const w = Math.max(1, Math.round(w0 * k)), h = Math.max(1, Math.round(h0 * k));
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(fuente, 0, 0, w, h);
    const d = ctx.getImageData(0, 0, w, h).data;
    const g = new Float32Array(w * h), sat = new Uint8Array(w * h);
    for (let i = 0, j = 0; i < d.length; i += 4, j++) {
      g[j] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      sat[j] = Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]);
    }
    return { g, sat, w, h };
  }

  function percentiles(g, bajo, alto) {
    const hist = new Uint32Array(256);
    for (let i = 0; i < g.length; i++) hist[Math.min(255, Math.max(0, g[i] | 0))]++;
    const n = g.length; let acc = 0, pb = 0, pa = 255;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= n * bajo) { pb = v; break; } }
    acc = 0;
    for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc >= n * (1 - alto)) { pa = v; break; } }
    return [pb, pa];
  }

  // Recuadro del papel: el ticket es la zona clara más grande sobre un fondo más oscuro.
  // Devuelve {x0,y0,x1,y1} en proporción (0-1) o null si no se distingue con seguridad.
  // sat: diferencia entre canales de color; el papel térmico es blanco neutro (sin color)
  function recuadro(g, w, h, sat) {
    const [, p98] = percentiles(g, 0.02, 0.98);
    const umbral = p98 * 0.72;
    // Rejilla reducida (~300 px) con las zonas claras
    const s = Math.max(1, Math.ceil(Math.max(w, h) / 300));
    const gw = Math.floor(w / s), gh = Math.floor(h / s);
    const m = new Uint8Array(gw * gh);
    for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
      let t = 0, c = 0;
      for (let dy = 0; dy < s; dy++) for (let dx = 0; dx < s; dx++) { const i = (gy * s + dy) * w + gx * s + dx; t += g[i]; if (sat) c += sat[i]; }
      m[gy * gw + gx] = t / (s * s) > umbral && c / (s * s) < 38 ? 1 : 0;
    }
    // Manchas claras conectadas
    const etiqueta = new Int32Array(gw * gh), manchas = [], pila = [];
    for (let i = 0; i < m.length; i++) {
      if (!m[i] || etiqueta[i]) continue;
      const k = { n: 0, x0: gw, y0: gh, x1: 0, y1: 0 }; manchas.push(k);
      etiqueta[i] = manchas.length; pila.push(i);
      while (pila.length) {
        const j = pila.pop(), x = j % gw, y = (j / gw) | 0;
        k.n++; if (x < k.x0) k.x0 = x; if (x > k.x1) k.x1 = x; if (y < k.y0) k.y0 = y; if (y > k.y1) k.y1 = y;
        for (const v of [x > 0 ? j - 1 : -1, x < gw - 1 ? j + 1 : -1, y > 0 ? j - gw : -1, y < gh - 1 ? j + gw : -1])
          if (v >= 0 && m[v] && !etiqueta[v]) { etiqueta[v] = manchas.length; pila.push(v); }
      }
    }
    if (!manchas.length) return null;
    // El ticket es la mancha grande que no ocupa todo un costado de la foto (paredes, mesas claras)
    const peso = k => k.n * (((k.x0 === 0) + (k.y0 === 0) + (k.x1 === gw - 1) + (k.y1 === gh - 1)) >= 3 ? 0.05 : 1);
    let r = manchas.reduce((a, k) => peso(k) > peso(a) ? k : a);
    r = { ...r };
    // Unir pedazos del mismo papel (pliegues o sombras que lo cortan)
    for (let vuelta = 0; vuelta < 3; vuelta++) {
      const mx = gw * 0.03, my = gh * 0.03;
      for (const k of manchas) {
        if (k.n < r.n * 0.02) continue;
        if (k.x1 < r.x0 - mx || k.x0 > r.x1 + mx || k.y1 < r.y0 - my || k.y0 > r.y1 + my) continue;
        if (k.x0 < r.x0 || k.y0 < r.y0 || k.x1 > r.x1 || k.y1 > r.y1) {
          if (peso(k) < k.n) continue; // no unir con paredes
          r.x0 = Math.min(r.x0, k.x0); r.y0 = Math.min(r.y0, k.y0); r.x1 = Math.max(r.x1, k.x1); r.y1 = Math.max(r.y1, k.y1);
        }
      }
    }
    const pad = 0.025;
    const out = {
      x0: Math.max(0, r.x0 / gw - pad), x1: Math.min(1, (r.x1 + 1) / gw + pad),
      y0: Math.max(0, r.y0 / gh - pad), y1: Math.min(1, (r.y1 + 1) / gh + pad)
    };
    const area = (out.x1 - out.x0) * (out.y1 - out.y0);
    if (area < 0.03 || area > 0.85) return null; // nada claro, o ya ocupa casi toda la foto
    return out;
  }

  // ¿Dónde está la parte de arriba del ticket? Todos los tickets traen un margen en blanco
  // grande antes del "Folio" y casi nada después de "IDA" o del código de barras.
  // Mide ambos márgenes a lo largo del papel (eje x si está acostado, y si está de pie).
  // Devuelve "inicio", "fin" o "" si no está claro.
  function arribaDelTicket(g, w, h, acostado) {
    const L = acostado ? w : h, C = acostado ? h : w;
    const at = acostado ? (i, j) => g[j * w + i] : (i, j) => g[i * w + j];
    const [, papel] = percentiles(g, 0.1, 0.92);
    const claro = papel * 0.75, tinta = papel * 0.7;
    const c0 = Math.floor(C * 0.2), c1 = Math.ceil(C * 0.8), banda = c1 - c0;
    const esPapel = new Uint8Array(L), masa = new Float32Array(L);
    for (let i = 0; i < L; i++) {
      let b = 0, t = 0;
      for (let j = c0; j < c1; j++) { const v = at(i, j); if (v > claro) b++; else if (v < tinta) t += tinta - v; }
      esPapel[i] = b > banda * 0.5 ? 1 : 0;
      masa[i] = esPapel[i] ? t : 0;
    }
    const p0 = esPapel.indexOf(1), p1 = esPapel.lastIndexOf(1);
    if (p0 < 0 || p1 - p0 < L * 0.5 || p1 - p0 < 900) return ""; // ticket chico en la foto: no es confiable
    const largo = p1 - p0, orilla = Math.round(largo * 0.02);
    let total = 0; for (let i = p0 + orilla; i <= p1 - orilla; i++) total += masa[i];
    if (!total) return "";
    // Donde empieza y termina el grueso de la tinta (ignora grapas, hoyos y sombras sueltas)
    let acc = 0, t0 = -1, t1 = -1;
    for (let i = p0 + orilla; i <= p1 - orilla; i++) {
      acc += masa[i];
      if (t0 < 0 && acc >= total * 0.03) t0 = i;
      if (t1 < 0 && acc >= total * 0.97) t1 = i;
    }
    const mi = (t0 - p0) / largo, mf = (p1 - t1) / largo;
    if (mi > 0.1 && mi > mf * 2.5) return "inicio";
    if (mf > 0.1 && mf > mi * 2.5) return "fin";
    return "";
  }

  // Giro para dejar de pie un ticket acostado: 90, -90 o 0 si no está claro.
  // Solo se gira cuando el ticket está claramente acostado; en duda se deja como está.
  function giroNecesario(g, w, h) {
    if (w <= h * 1.3) return 0;
    const arriba = arribaDelTicket(g, w, h, true);
    return arriba === "inicio" ? 90 : arriba === "fin" ? -90 : 0;
  }

  // Nitidez: desviación estándar del laplaciano tras estirar el contraste,
  // calculada dentro del ticket (o en la zona central si no se encontró el papel).
  function nitidez(g, w, h, rc) {
    const [pb, pa] = percentiles(g, 0.02, 0.98);
    const esc = 255 / Math.max(1, pa - pb);
    const z = rc || { x0: 0.08, x1: 0.92, y0: 0.05, y1: 0.95 };
    const x0 = Math.floor(w * z.x0), x1 = Math.ceil(w * z.x1), y0 = Math.floor(h * z.y0), y1 = Math.ceil(h * z.y1);
    let s = 0, s2 = 0, n = 0;
    const v = (x, y) => (g[y * w + x] - pb) * esc;
    for (let y = Math.max(1, y0); y < Math.min(h - 1, y1); y++) {
      for (let x = Math.max(1, x0); x < Math.min(w - 1, x1); x++) {
        const l = v(x - 1, y) + v(x + 1, y) + v(x, y - 1) + v(x, y + 1) - 4 * v(x, y);
        s += l; s2 += l * l; n++;
      }
    }
    if (!n) return 0;
    const m = s / n;
    return Math.sqrt(Math.max(0, s2 / n - m * m));
  }

  async function analizar(file) {
    const bmp = await cargar(file);
    const corto = Math.min(bmp.width, bmp.height);
    const { g, sat, w, h } = grises(bmp, 1000);
    let suma = 0; for (let i = 0; i < g.length; i++) suma += g[i];
    const brillo = suma / g.length;
    const [p5, p95] = percentiles(g, 0.05, 0.95);
    const rc = recuadro(g, w, h, sat);
    const res = { nitidez: nitidez(g, w, h, rc), brillo, contraste: p95 - p5, corto, recuadro: rc, problemas: [] };
    if (corto < LADO_MIN) res.problemas.push("La foto es muy pequeña. Tómala de cerca, que el ticket ocupe casi toda la pantalla.");
    if (brillo < BRILLO_MIN) res.problemas.push("La foto está muy oscura. Tómala con más luz o activa el flash.");
    else if (res.contraste < CONTRASTE_MIN) res.problemas.push("No se distingue el texto. Busca mejor luz y evita reflejos sobre el ticket.");
    if (res.nitidez < NITIDEZ_MIN) res.problemas.push("La foto está borrosa o desenfocada. Toca la pantalla sobre el ticket para enfocar y mantén el teléfono quieto.");
    res.ok = res.problemas.length === 0;
    return res;
  }

  // Mejora: escala de grises, niveles automáticos y nitidez suave. Devuelve un JPEG.
  async function mejorar(file) {
    const bmp = await cargar(file);
    // Recortar al papel del ticket para que el texto quede más grande
    const p = grises(bmp, 1000);
    const rc = recuadro(p.g, p.w, p.h, p.sat) || { x0: 0, y0: 0, x1: 1, y1: 1 };
    const sx = Math.round(rc.x0 * bmp.width), sy = Math.round(rc.y0 * bmp.height);
    const sw = Math.round((rc.x1 - rc.x0) * bmp.width), sh = Math.round((rc.y1 - rc.y0) * bmp.height);
    const k = Math.min(1, 2000 / Math.max(sw, sh));
    const w = Math.round(sw * k), h = Math.round(sh * k);
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, w, h);
    const img = ctx.getImageData(0, 0, w, h), d = img.data;
    const g = new Float32Array(w * h);
    for (let i = 0, j = 0; i < d.length; i += 4, j++) g[j] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    const [pb, pa] = percentiles(g, 0.01, 0.99);
    const esc = 255 / Math.max(1, pa - pb);
    const n = new Float32Array(w * h);
    for (let i = 0; i < g.length; i++) {
      let v = (g[i] - pb) * esc; v = v < 0 ? 0 : v > 255 ? 255 : v;
      n[i] = 255 * Math.pow(v / 255, 1.15); // oscurece un poco el texto tenue
    }
    // Máscara de enfoque (unsharp) con desenfoque 3x3
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        let sum = 0, cnt = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy; if (yy < 0 || yy >= h) continue;
          for (let dx = -1; dx <= 1; dx++) { const xx = x + dx; if (xx < 0 || xx >= w) continue; sum += n[yy * w + xx]; cnt++; }
        }
        let v = n[i] + 0.7 * (n[i] - sum / cnt);
        v = v < 0 ? 0 : v > 255 ? 255 : v;
        const o = i * 4; d[o] = d[o + 1] = d[o + 2] = v; d[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    // Enderezar si el ticket quedó acostado
    let salida = c;
    const giro = giroNecesario(g, w, h);
    if (giro) {
      const lado = giro === 180;
      salida = document.createElement("canvas"); salida.width = lado ? w : h; salida.height = lado ? h : w;
      const r = salida.getContext("2d");
      r.translate(salida.width / 2, salida.height / 2); r.rotate(giro * Math.PI / 180); r.drawImage(c, -w / 2, -h / 2);
    }
    const blob = await new Promise(r => salida.toBlob(r, "image/jpeg", 0.86));
    if (!blob) return file;
    return new File([blob], (file.name || "ticket").replace(/\.\w+$/, "") + "-mejorado.jpg", { type: "image/jpeg" });
  }

  window.FotoTicket = { analizar, mejorar, _interno: { grises, recuadro, giroNecesario } };
})();
