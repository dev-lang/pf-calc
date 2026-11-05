// Actualiza el histórico de cauciones en pesos que publica Rava (CSV por plazo) en data/cauciones/.
//
// Uso:
//   node scripts/update-caucion.mjs                    -> descarga todos los plazos de Rava
//   node scripts/update-caucion.mjs 1D=archivo.csv     -> usa un CSV local para ese plazo (se puede repetir)
//
// Genera:
//   data/cauciones/1d.json, 2d.json, ... -> serie diaria de cada plazo (un día por línea)
//   data/cauciones/index.json            -> último cierre de cada plazo (para mostrar la curva sin bajar todo)
//
// Fusiona con lo existente: nunca borra días viejos (por si Rava acota la ventana) y,
// si un día ya existía, lo reemplaza por el dato nuevo (por si Rava lo corrigió).
// Si falla un plazo, sigue con los demás; solo termina con error si fallan todos.
// Sin dependencias: requiere Node 18+ (fetch nativo).

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = resolve(RAIZ, 'data/cauciones');
const LEGADO_1D = resolve(RAIZ, 'data/caucion-1d.json'); // formato anterior (solo 1 día)

// Plazos que publica Rava (verificado nov-2026: 6, 8-13, 15+ días no existen)
const PLAZOS = [1, 2, 3, 4, 5, 7, 14, 30];

const especie = dias => `CAUCION ${dias}D`;
const urlCsv = dias => `https://www.rava.com/perfil/descarga-historicos/${encodeURIComponent(especie(dias))}`;
const archivo = dias => resolve(DIR, `${dias}d.json`);

// Argumentos tipo "1D=ruta.csv"
const csvLocales = new Map(process.argv.slice(2).map(arg => {
    const m = arg.match(/^(\d+)d=(.+)$/i);
    if (!m) throw new Error(`Argumento no válido: "${arg}" (esperado algo como 1D=archivo.csv)`);
    return [Number(m[1]), m[2]];
}));

async function obtenerCsv(dias) {
    if (csvLocales.has(dias)) return readFile(csvLocales.get(dias), 'utf8');
    const r = await fetch(urlCsv(dias), {
        headers: { 'User-Agent': 'pf-calc (github.com/dev-lang/pf-calc) actualizacion diaria' }
    });
    if (!r.ok) throw new Error(`Rava respondió ${r.status}`);
    const tipo = r.headers.get('content-type') || '';
    if (!tipo.includes('csv')) throw new Error(`Respuesta inesperada (content-type: ${tipo})`);
    return r.text();
}

function parsearCsv(texto) {
    const lineas = texto.replace(/^﻿/, '').trim().split(/\r?\n/);
    const cab = lineas.shift().split(',').map(c => c.trim().toLowerCase());
    const col = nombre => {
        const i = cab.indexOf(nombre);
        if (i < 0) throw new Error(`Falta la columna "${nombre}" en el CSV (cabecera: ${cab.join(',')})`);
        return i;
    };
    const iFecha = col('fecha'), iAp = col('apertura'), iMax = col('maximo'), iMin = col('minimo'), iCie = col('cierre');

    const num = v => {
        const n = Number(String(v).replace(/"/g, '').trim());
        return Number.isFinite(n) ? n : null;
    };
    const filas = [];
    for (const linea of lineas) {
        // El único campo con comillas es la especie ("CAUCION 1D"), que no tiene comas adentro
        const c = linea.split(',');
        const fecha = String(c[iFecha] || '').replace(/"/g, '').trim();
        const cierre = num(c[iCie]);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !(cierre > 0)) continue;
        filas.push({ fecha, apertura: num(c[iAp]), maximo: num(c[iMax]), minimo: num(c[iMin]), cierre });
    }
    return filas;
}

async function leerSerie(ruta) {
    try {
        const json = JSON.parse(await readFile(ruta, 'utf8'));
        return Array.isArray(json.serie) ? json.serie : null;
    } catch {
        return null;
    }
}

async function escribirSiCambio(ruta, texto) {
    let previo = null;
    try { previo = await readFile(ruta, 'utf8'); } catch { /* no existe */ }
    if (previo === texto) return false;
    await writeFile(ruta, texto);
    return true;
}

function serializar(dias, serie) {
    // Un día por línea: diffs chicos y legibles en cada commit diario
    const cabecera = {
        especie: especie(dias),
        plazo_dias: dias,
        descripcion: `Caución bursátil en pesos a ${dias} día${dias > 1 ? 's' : ''}, TNA % (apertura, máximo, mínimo, cierre)`,
        fuente: `Rava Bursátil - https://www.rava.com/perfil/${encodeURIComponent(especie(dias))}`,
        actualizado: serie.at(-1).fecha
    };
    return JSON.stringify(cabecera, null, 2).replace(/\n}$/, ',\n  "serie": [\n')
        + serie.map(p => '    ' + JSON.stringify(p)).join(',\n')
        + '\n  ]\n}\n';
}

async function actualizarPlazo(dias) {
    const nuevas = parsearCsv(await obtenerCsv(dias));
    if (nuevas.length === 0) throw new Error('El CSV no trajo filas válidas');

    // Lo ya guardado; para 1 día, si todavía no existe el archivo nuevo, se migra el del formato anterior
    let existente = await leerSerie(archivo(dias));
    if (!existente && dias === 1) existente = await leerSerie(LEGADO_1D);

    const porFecha = new Map((existente || []).map(p => [p.fecha, p]));
    nuevas.forEach(p => porFecha.set(p.fecha, p));
    const serie = [...porFecha.values()].sort((a, b) => a.fecha.localeCompare(b.fecha));

    const cambio = await escribirSiCambio(archivo(dias), serializar(dias, serie));
    const ultimo = serie.at(-1);
    console.log(`${especie(dias)}: ${cambio ? 'actualizado' : 'sin cambios'} (${serie.length} días, último ${ultimo.fecha} = ${ultimo.cierre}%)`);
    return { plazo_dias: dias, archivo: `${dias}d.json`, dias_con_dato: serie.length, desde: serie[0].fecha, fecha: ultimo.fecha, cierre: ultimo.cierre };
}

await mkdir(DIR, { recursive: true });

const resumen = [];
const fallidos = [];
for (const dias of PLAZOS) {
    try {
        resumen.push(await actualizarPlazo(dias));
    } catch (err) {
        fallidos.push(dias);
        console.error(`${especie(dias)}: ERROR ${err.message}`);
        // Si falló pero ya había datos guardados, se mantiene su entrada en el índice
        const previa = await leerSerie(archivo(dias));
        if (previa && previa.length) {
            const u = previa.at(-1);
            resumen.push({ plazo_dias: dias, archivo: `${dias}d.json`, dias_con_dato: previa.length, desde: previa[0].fecha, fecha: u.fecha, cierre: u.cierre });
        }
    }
}

if (resumen.length === 0) {
    console.error('No se pudo actualizar ningún plazo.');
    process.exit(1);
}

const indice = {
    descripcion: 'Último cierre (TNA %) de cada plazo de caución bursátil en pesos',
    fuente: 'Rava Bursátil - https://www.rava.com',
    actualizado: resumen.map(r => r.fecha).sort().at(-1),
    plazos: resumen.sort((a, b) => a.plazo_dias - b.plazo_dias)
};
const cambioIndice = await escribirSiCambio(resolve(DIR, 'index.json'), JSON.stringify(indice, null, 2) + '\n');
console.log(`index.json: ${cambioIndice ? 'actualizado' : 'sin cambios'}${fallidos.length ? ` (fallaron: ${fallidos.map(especie).join(', ')})` : ''}`);
