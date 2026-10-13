// Revisión y mejora de fotos de tickets en el teléfono del cliente, antes de enviarlas.
// No sube nada: solo analiza la imagen y genera una versión más legible.
(function () {
  "use strict";

  // Umbrales calibrados con tickets térmicos reales (ver README)
  const NITIDEZ_MIN = 14;      // nitidez mínima tras normalizar contraste
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
    const g = new Float32Array(w * h);
    for (let i = 0, j = 0; i < d.length; i += 4, j++) g[j] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    return { g, w, h };
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

  // Nitidez: desviación estándar del laplaciano tras estirar el contraste,
  // calculada en la zona central (donde suele estar el texto del ticket).
  function nitidez(g, w, h) {
    const [pb, pa] = percentiles(g, 0.02, 0.98);
    const esc = 255 / Math.max(1, pa - pb);
    const x0 = Math.floor(w * 0.08), x1 = Math.ceil(w * 0.92), y0 = Math.floor(h * 0.05), y1 = Math.ceil(h * 0.95);
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
    const { g, w, h } = grises(bmp, 1000);
    let suma = 0; for (let i = 0; i < g.length; i++) suma += g[i];
    const brillo = suma / g.length;
    const [p5, p95] = percentiles(g, 0.05, 0.95);
    const res = { nitidez: nitidez(g, w, h), brillo, contraste: p95 - p5, corto, problemas: [] };
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
    const k = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * k), h = Math.round(bmp.height * k);
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0, w, h);
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
    const blob = await new Promise(r => c.toBlob(r, "image/jpeg", 0.86));
    if (!blob) return file;
    return new File([blob], (file.name || "ticket").replace(/\.\w+$/, "") + "-mejorado.jpg", { type: "image/jpeg" });
  }

  window.FotoTicket = { analizar, mejorar };
})();
