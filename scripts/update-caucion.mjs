// Actualiza data/caucion-1d.json con el histórico de "CAUCION 1D" que publica Rava (CSV).
// Uso:
//   node scripts/update-caucion.mjs              -> descarga el CSV de Rava
//   node scripts/update-caucion.mjs archivo.csv  -> usa un CSV local (p. ej. el bajado a mano)
//
// Fusiona con lo que ya hay en el JSON: nunca borra días viejos (por si Rava acota la ventana)
// y, si un día ya existía, lo reemplaza por el dato nuevo (por si Rava lo corrigió).
// Sin dependencias: requiere Node 18+ (fetch nativo).

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SALIDA = resolve(RAIZ, 'data/caucion-1d.json');
const URL_CSV = 'https://www.rava.com/perfil/descarga-historicos/CAUCION%201D';

async function obtenerCsv() {
    const local = process.argv[2];
    if (local) return readFile(local, 'utf8');
    const r = await fetch(URL_CSV, {
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

async function leerExistente() {
    try {
        const json = JSON.parse(await readFile(SALIDA, 'utf8'));
        return Array.isArray(json.serie) ? json.serie : [];
    } catch {
        return [];
    }
}

const nuevas = parsearCsv(await obtenerCsv());
if (nuevas.length === 0) throw new Error('El CSV no trajo filas válidas; no se toca el archivo');

const porFecha = new Map((await leerExistente()).map(p => [p.fecha, p]));
const antes = JSON.stringify([...porFecha.values()]);
nuevas.forEach(p => porFecha.set(p.fecha, p));
const serie = [...porFecha.values()].sort((a, b) => a.fecha.localeCompare(b.fecha));

if (JSON.stringify(serie) === antes) {
    console.log(`Sin cambios (${serie.length} días, último ${serie.at(-1).fecha}).`);
} else {
    await mkdir(dirname(SALIDA), { recursive: true });
    // Un día por línea: diffs chicos y legibles en cada commit diario
    const cabecera = {
        especie: 'CAUCION 1D',
        descripcion: 'Caución bursátil en pesos a 1 día, TNA % (apertura, máximo, mínimo, cierre)',
        fuente: 'Rava Bursátil - https://www.rava.com/perfil/CAUCION%201D',
        actualizado: serie.at(-1).fecha
    };
    const texto = JSON.stringify(cabecera, null, 2).replace(/\n}$/, ',\n  "serie": [\n')
        + serie.map(p => '    ' + JSON.stringify(p)).join(',\n')
        + '\n  ]\n}\n';
    await writeFile(SALIDA, texto);
    console.log(`Actualizado: ${serie.length} días, último ${serie.at(-1).fecha}.`);
}
