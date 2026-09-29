// netlify/functions/caucion.js
// Proxy hacia MAE Market Data: la API key vive en variables de entorno de Netlify
// (MAE_API_KEY) y nunca llega al navegador.
//
// Devuelve la última tasa de caución en pesos, por plazo:
// { porPlazo: { "001": { tna, fecha, volumen }, "007": {...} }, actualizado }

const BASE_URL = process.env.MAE_BASE_URL || 'https://api.mae.com.ar';
const ENDPOINT = '/MarketData/v1/mercado/cotizaciones/cauciones';
const TTL_MS = 5 * 60 * 1000; // cache en memoria mientras la función esté "caliente"
const MAX_PAGES = 10;

let cache = null; // { ts, payload }

// El PDF documenta "Ultimatasa", pero el JSON de ejemplo de Repo viene en camelCase
// ("ultimaTasa"). Buscamos la clave sin distinguir mayúsculas para no depender de eso.
function pick(obj, name) {
  const key = Object.keys(obj).find((k) => k.toLowerCase() === name.toLowerCase());
  return key === undefined ? undefined : obj[key];
}

async function fetchPage(page, apiKey) {
  const res = await fetch(`${BASE_URL}${ENDPOINT}?pageNumber=${page}`, {
    headers: { 'x-api-key': apiKey, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`MAE respondió ${res.status}`);

  // Header x-pagination: objeto con TotalPages (según el PDF)
  let totalPages = 1;
  const h = res.headers.get('x-pagination');
  if (h) {
    try {
      const p = JSON.parse(h);
      totalPages = Number(p.TotalPages ?? p.totalPages) || 1;
    } catch {
      /* header con otro formato: nos quedamos con 1 página */
    }
  }
  const data = await res.json();
  return { items: Array.isArray(data) ? data : [], totalPages };
}

function buildPayload(items) {
  const porPlazo = {};
  for (const it of items) {
    if (pick(it, 'moneda') !== '$') continue; // solo pesos
    const tipo = pick(it, 'tipoEmision');
    if (tipo && tipo !== 'CAU') continue;

    const tasa = Number(pick(it, 'ultimaTasa'));
    if (!Number.isFinite(tasa) || tasa <= 0) continue;

    const plazo = String(pick(it, 'codigoPlazo') ?? pick(it, 'plazo') ?? '').padStart(3, '0');
    const fecha = String(pick(it, 'fecha') || '');
    const volumen = Number(pick(it, 'volumenAcumulado')) || 0;

    // Por plazo nos quedamos con el registro más reciente (desempata el de más volumen)
    const prev = porPlazo[plazo];
    if (!prev || fecha > prev.fecha || (fecha === prev.fecha && volumen > prev.volumen)) {
      porPlazo[plazo] = { tna: tasa, fecha, volumen };
    }
  }
  return { porPlazo, actualizado: new Date().toISOString() };
}

function respond(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      ...(statusCode === 200 ? { 'Cache-Control': 'public, max-age=300' } : {}),
    },
    body: JSON.stringify(body),
  };
}

exports.handler = async () => {
  const apiKey = process.env.MAE_API_KEY;
  if (!apiKey) return respond(500, { error: 'Falta la variable de entorno MAE_API_KEY' });

  if (cache && Date.now() - cache.ts < TTL_MS) return respond(200, cache.payload);

  try {
    const first = await fetchPage(1, apiKey);
    let items = first.items;
    for (let p = 2; p <= Math.min(first.totalPages, MAX_PAGES); p++) {
      items = items.concat((await fetchPage(p, apiKey)).items);
    }
    const payload = buildPayload(items);
    cache = { ts: Date.now(), payload };
    return respond(200, payload);
  } catch (err) {
    console.error('Error consultando MAE:', err.message); // nunca loguear la key
    return respond(502, { error: 'No se pudo consultar MAE' });
  }
};

exports._buildPayload = buildPayload; // solo para tests
