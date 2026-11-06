// Actualiza las tasas de plazo fijo a 30 días por banco (ArgentinaDatos, datos del BCRA):
//   data/plazo-fijo/historico.json -> una línea por fecha en la que cambió alguna tasa (o cambió la lista
//                                    de bancos). Cada línea rige desde su fecha hasta la siguiente.
//   data/plazo-fijo/actual.json    -> tasas vigentes, de mayor a menor, con desde cuándo rige cada una
//                                    y cuál era la anterior (lo usa la pestaña Plazo Fijo).
//
// Si las tasas no cambiaron respecto de la última línea, no se escribe nada (y el workflow no commitea).
// Si la API falla, no se toca ningún archivo y el script termina con error para que la corrida quede en rojo.
// Uso: node scripts/update-plazo-fijo.mjs   (Node 18+, sin dependencias)

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pedirJson } from './lib/serie.mjs';

const DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../data/plazo-fijo');
const RUTA_HISTORICO = resolve(DIR, 'historico.json');
const RUTA_ACTUAL = resolve(DIR, 'actual.json');
const URL = 'https://api.argentinadatos.com/v1/finanzas/tasas/plazoFijo';
const FUENTE = `ArgentinaDatos (BCRA) - ${URL}`;

// Fecha de hoy en Argentina (el runner de GitHub está en UTC)
const HOY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date());

const redondear = v => Math.round(v * 10000) / 10000;
const pct = v => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : redondear(Number(v) * 100));

// Misma lógica que usaba la web: la tasa del tramo que incluye los 30 días; si no hay tramos,
// la TNA para clientes y, si no, la de no clientes
function tasa30Dias(banco) {
    if (Array.isArray(banco.tasas) && banco.tasas.length > 0) {
        const tramo = banco.tasas.find(t => {
            const min = Number(t.plazoMinDias), max = Number(t.plazoMaxDias);
            return Number.isFinite(min) && Number.isFinite(max) && min <= 30 && max >= 30;
        });
        if (tramo && Number.isFinite(Number(tramo.tna))) return pct(tramo.tna);
    }
    return pct(banco.tnaClientes ?? banco.tnaNoClientes);
}

function normalizar(data) {
    const lista = Array.isArray(data) ? data : Array.isArray(data?.value) ? data.value : Array.isArray(data?.data) ? data.data : null;
    if (!lista) throw new Error('Formato inesperado de la API');
    const porBanco = new Map();
    lista.forEach(b => {
        const entidad = String(b.entidad || '').trim();
        const tna = tasa30Dias(b);
        if (!entidad || !Number.isFinite(tna) || tna <= 0) return;
        porBanco.set(entidad, {
            entidad,
            tna,
            tnaClientes: pct(b.tnaClientes),
            tnaNoClientes: pct(b.tnaNoClientes),
            ...(b.logo ? { logo: String(b.logo) } : {}),
            ...(b.enlace ? { enlace: String(b.enlace) } : {})
        });
    });
    if (porBanco.size === 0) throw new Error('La API no trajo bancos con tasa válida');
    return [...porBanco.values()].sort((a, b) => b.tna - a.tna || a.entidad.localeCompare(b.entidad));
}

async function leerJson(ruta) {
    try {
        return JSON.parse(await readFile(ruta, 'utf8'));
    } catch {
        return null;
    }
}

async function escribirSiCambio(ruta, texto) {
    let previo = null;
    try { previo = await readFile(ruta, 'utf8'); } catch { /* no existe */ }
    if (previo === texto) return false;
    await mkdir(dirname(ruta), { recursive: true });
    await writeFile(ruta, texto);
    return true;
}

// Mapa entidad -> tna ordenado por nombre, para comparar líneas sin importar el orden
const mapaTasas = bancos => Object.fromEntries(bancos.map(b => [b.entidad, b.tna]).sort(([a], [b]) => a.localeCompare(b)));
const iguales = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Para cada banco: desde cuándo rige su tasa actual y cuál era la anterior (recorriendo el histórico)
function vigencias(serie) {
    const estado = new Map(); // entidad -> { tna, desde, anterior }
    serie.forEach(linea => {
        Object.entries(linea.tasas).forEach(([entidad, tna]) => {
            const e = estado.get(entidad);
            if (!e) {
                estado.set(entidad, { tna, desde: linea.fecha, anterior: null });
            } else if (e.tna !== tna) {
                estado.set(entidad, { tna, desde: linea.fecha, anterior: { tna: e.tna, desde: e.desde } });
            }
        });
        // Bancos que dejaron de aparecer: si vuelven, arrancan de cero
        [...estado.keys()].forEach(entidad => { if (!(entidad in linea.tasas)) estado.delete(entidad); });
    });
    return estado;
}

let bancos;
try {
    bancos = normalizar(await pedirJson(URL));
} catch (err) {
    console.error(`ERROR: ${err.message}. No se modificó ningún archivo.`);
    process.exit(1);
}
const tasas = mapaTasas(bancos);

const previo = await leerJson(RUTA_HISTORICO);
const serie = Array.isArray(previo?.serie) ? previo.serie : [];
const ultima = serie[serie.length - 1];

let cambioHistorico = false;
let accion = '';
if (!ultima || !iguales(ultima.tasas, tasas)) {
    cambioHistorico = true;
    if (ultima && ultima.fecha === HOY) {
        // Ya hay una línea de hoy (corrida manual repetida): se reemplaza, y si quedó igual
        // a la del día anterior, se borra (el cambio de hoy se revirtió)
        const anterior = serie[serie.length - 2];
        if (anterior && iguales(anterior.tasas, tasas)) {
            serie.pop();
            accion = `se borró la línea de ${HOY} (las tasas volvieron a las del ${anterior.fecha})`;
        } else {
            serie[serie.length - 1] = { fecha: HOY, tasas };
            accion = `se reemplazó la línea de ${HOY}`;
        }
    } else {
        serie.push({ fecha: HOY, tasas });
        accion = `nueva línea ${HOY}`;
    }
}

const cabecera = {
    descripcion: 'TNA (%) de plazo fijo a 30 días por banco. Cada línea rige desde su fecha hasta la siguiente; solo se agrega una línea cuando cambia alguna tasa.',
    fuente: FUENTE,
    inicio: serie[0].fecha,
    actualizado: serie[serie.length - 1].fecha
};
const textoHistorico = JSON.stringify(cabecera, null, 2).replace(/\n}$/, ',\n  "serie": [\n')
    + serie.map(l => '    ' + JSON.stringify(l)).join(',\n')
    + '\n  ]\n}\n';

const vig = vigencias(serie);
const actual = {
    descripcion: 'Tasas de plazo fijo a 30 días vigentes por banco, de mayor a menor',
    fuente: FUENTE,
    vigentesDesde: serie[serie.length - 1].fecha,
    inicioRegistro: serie[0].fecha,
    bancos: bancos.map(b => {
        const v = vig.get(b.entidad);
        return { ...b, desde: v ? v.desde : HOY, anterior: v && v.anterior ? v.anterior : null };
    })
};
// Un banco por línea
const { bancos: listaActual, ...cabActual } = actual;
const textoActual = JSON.stringify(cabActual, null, 2).replace(/\n}$/, ',\n  "bancos": [\n')
    + listaActual.map(b => '    ' + JSON.stringify(b)).join(',\n')
    + '\n  ]\n}\n';

if (cambioHistorico) await escribirSiCambio(RUTA_HISTORICO, textoHistorico);
const a = await escribirSiCambio(RUTA_ACTUAL, textoActual);

const cambiaron = bancos.filter(b => {
    const v = vig.get(b.entidad);
    return v && v.desde === HOY && v.anterior;
});
console.log(`${bancos.length} bancos · mejor ${bancos[0].entidad} ${bancos[0].tna}% · peor ${bancos[bancos.length - 1].entidad} ${bancos[bancos.length - 1].tna}%`);
if (cambioHistorico) {
    console.log(`historico.json: ${accion}${cambiaron.length ? ` (cambiaron: ${cambiaron.map(b => `${b.entidad} ${vig.get(b.entidad).anterior.tna}% → ${b.tna}%`).join('; ')})` : ''}`);
} else {
    console.log('historico.json: sin cambios en las tasas');
}
console.log(`actual.json: ${a ? 'actualizado' : 'sin cambios'}`);
