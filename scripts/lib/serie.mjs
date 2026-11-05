// Utilidades compartidas por los scripts de actualización de data/*.json.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

export const UA = { 'User-Agent': 'pf-calc (github.com/dev-lang/pf-calc) actualizacion diaria' };

export async function pedirJson(url) {
    const r = await fetch(url, { headers: UA });
    if (!r.ok) throw new Error(`HTTP ${r.status} en ${url}`);
    return r.json();
}

async function leerSerie(ruta) {
    try {
        const json = JSON.parse(await readFile(ruta, 'utf8'));
        return Array.isArray(json.serie) ? json.serie : [];
    } catch {
        return [];
    }
}

// Fusiona `nuevos` con lo que ya hay en `ruta` (nunca borra puntos viejos; si un punto ya existía,
// lo reemplaza por el nuevo) y escribe el archivo solo si cambió. Un punto por línea para diffs chicos.
export async function guardarSerie(ruta, { cabecera, clave, nuevos }) {
    if (!nuevos.length) throw new Error('La fuente no trajo datos válidos');
    const porClave = new Map((await leerSerie(ruta)).map(p => [p[clave], p]));
    nuevos.forEach(p => porClave.set(p[clave], p));
    const serie = [...porClave.values()].sort((a, b) => String(a[clave]).localeCompare(String(b[clave])));

    const cab = { ...cabecera, actualizado: serie.at(-1)[clave] };
    const texto = JSON.stringify(cab, null, 2).replace(/\n}$/, ',\n  "serie": [\n')
        + serie.map(p => '    ' + JSON.stringify(p)).join(',\n')
        + '\n  ]\n}\n';

    let previo = null;
    try { previo = await readFile(ruta, 'utf8'); } catch { /* no existe */ }
    const cambio = previo !== texto;
    if (cambio) {
        await mkdir(dirname(ruta), { recursive: true });
        await writeFile(ruta, texto);
    }
    return { cambio, puntos: serie.length, ultimo: serie.at(-1) };
}
