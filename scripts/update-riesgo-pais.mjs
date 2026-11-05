// Actualiza data/riesgo-pais.json con el riesgo país diario de ArgentinaDatos.
// Uso: node scripts/update-riesgo-pais.mjs   (Node 18+, sin dependencias)
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pedirJson, guardarSerie } from './lib/serie.mjs';

const RUTA = resolve(dirname(fileURLToPath(import.meta.url)), '../data/riesgo-pais.json');
const URL = 'https://api.argentinadatos.com/v1/finanzas/indices/riesgo-pais';

const data = await pedirJson(URL);
if (!Array.isArray(data)) throw new Error('Formato inesperado');
const nuevos = data
    .map(p => ({ fecha: String(p.fecha || '').slice(0, 10), valor: Number(p.valor) }))
    .filter(p => /^\d{4}-\d{2}-\d{2}$/.test(p.fecha) && Number.isFinite(p.valor));

const r = await guardarSerie(RUTA, {
    clave: 'fecha',
    nuevos,
    cabecera: {
        descripcion: 'Riesgo país (EMBI Argentina), puntos básicos, dato diario',
        fuente: `ArgentinaDatos - ${URL}`
    }
});
console.log(`riesgo-pais.json: ${r.cambio ? 'actualizado' : 'sin cambios'} (${r.puntos} días, último ${r.ultimo.fecha} = ${r.ultimo.valor} pb)`);
