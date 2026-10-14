import { enAhorro } from "./consumo.js";
// Tope diario de Workers AI para no generar cobros.
// Cloudflare regala 10 000 neuronas al día (se reinician a las 00:00 UTC, 6 p.m. en Tapachula).
// Con Workers Paid, lo que pase de ahí se cobra, y Cloudflare no ofrece un tope de gasto.
// Por eso todas las llamadas a la IA pasan por aquí: se lleva la cuenta del día en KV y,
// antes de llamar, se revisa que la llamada quepa en el tope aun en el peor caso.
// Si no cabe, no se llama: el sitio sigue funcionando y los datos se capturan a mano.
//
// El tope es 9 000 y no 10 000 porque la cuenta de KV no es exacta al instante cuando
// llegan varias fotos al mismo tiempo; los 1 000 de margen cubren esa diferencia.

export const TOPE_NEURONAS = 9000;

// Precio de @cf/meta/llama-3.2-11b-vision-instruct en neuronas por token
const POR_TOKEN_ENTRADA = 4410 / 1e6;
const POR_TOKEN_SALIDA = 61493 / 1e6;
// Peor caso de tokens de entrada de una foto más las instrucciones
const TOKENS_ENTRADA_MAX = 8000;

export class SinNeuronas extends Error {
  constructor() { super("Se alcanzó el tope diario de lectura automática"); this.name = "SinNeuronas"; }
}

const llaveDia = () => "ai:neur:" + new Date().toISOString().slice(0, 10);
const peorCaso = maxTokens => TOKENS_ENTRADA_MAX * POR_TOKEN_ENTRADA + (maxTokens || 512) * POR_TOKEN_SALIDA;

export async function neuronasHoy(env) {
  return Number(await env.FILES.get(llaveDia())) || 0;
}

// Igual que env.AI.run, pero se niega (lanza SinNeuronas) si la llamada podría pasarse del tope
export async function correrIA(env, modelo, entrada) {
  if (await enAhorro(env)) throw new SinNeuronas();
  const llave = llaveDia();
  const usadas = Number(await env.FILES.get(llave)) || 0;
  const reserva = peorCaso(entrada && entrada.max_tokens);
  if (usadas + reserva > TOPE_NEURONAS) {
    console.log("ia sin cupo", JSON.stringify({ usadas: Math.round(usadas) }));
    throw new SinNeuronas();
  }
  // Se aparta el peor caso antes de llamar y se corrige con lo que de verdad se gastó
  await env.FILES.put(llave, String(usadas + reserva), { expirationTtl: 3 * 86400 });
  let r, gasto = reserva;
  try {
    r = await env.AI.run(modelo, entrada);
    const u = r && r.usage;
    if (u && isFinite(u.prompt_tokens) && isFinite(u.completion_tokens))
      gasto = u.prompt_tokens * POR_TOKEN_ENTRADA + u.completion_tokens * POR_TOKEN_SALIDA;
  } finally {
    const ahora = Number(await env.FILES.get(llave)) || 0;
    await env.FILES.put(llave, String(Math.max(0, ahora - reserva + gasto)), { expirationTtl: 3 * 86400 });
  }
  return r;
}
