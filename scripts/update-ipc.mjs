// Actualiza los datos de inflación:
//   data/ipc.json       -> IPC Nivel General, índice mensual base dic-2016 = 100 (INDEC vía datos.gob.ar)
//   data/inflacion.json -> inflación mensual % publicada (ArgentinaDatos; la usa la banda cambiaria)
// Uso: node scripts/update-ipc.mjs   (Node 18+, sin dependencias)
// Si falla una de las dos fuentes, igual guarda la otra y termina con error para que el workflow avise.
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pedirJson, guardarSerie } from './lib/serie.mjs';

const DATA = resolve(dirname(fileURLToPath(import.meta.url)), '../data');
const IPC_SERIES_ID = '148.3_INIVELNAL_DICI_M_26';
const URL_INFLACION = 'https://api.argentinadatos.com/v1/finanzas/indices/inflacion';

const tareas = [
    async () => {
        const json = await pedirJson(`https://apis.datos.gob.ar/series/api/series/?ids=${IPC_SERIES_ID}&start_date=2016-12&format=json&limit=1000`);
        if (!Array.isArray(json.data)) throw new Error('Formato inesperado');
        const nuevos = json.data
            .map(([fecha, indice]) => ({ mes: String(fecha).slice(0, 7), indice: Number(indice) }))
            .filter(p => /^\d{4}-\d{2}$/.test(p.mes) && Number.isFinite(p.indice));
        const r = await guardarSerie(resolve(DATA, 'ipc.json'), {
            clave: 'mes',
            nuevos,
            cabecera: {
                descripcion: 'IPC Nivel General, Nacional, índice base dic-2016 = 100 (INDEC)',
                fuente: `API de Series de Tiempo (datos.gob.ar) - serie ${IPC_SERIES_ID}`
            }
        });
        return `ipc.json: ${r.cambio ? 'actualizado' : 'sin cambios'} (${r.puntos} meses, último ${r.ultimo.mes} = ${r.ultimo.indice})`;
    },
    async () => {
        const data = await pedirJson(URL_INFLACION);
        if (!Array.isArray(data)) throw new Error('Formato inesperado');
        const nuevos = data
            .map(p => ({ fecha: String(p.fecha || '').slice(0, 10), valor: Number(p.valor) }))
            .filter(p => /^\d{4}-\d{2}-\d{2}$/.test(p.fecha) && Number.isFinite(p.valor));
        const r = await guardarSerie(resolve(DATA, 'inflacion.json'), {
            clave: 'fecha',
            nuevos,
            cabecera: {
                descripcion: 'Inflación mensual (variación % del IPC publicada por INDEC)',
                fuente: `ArgentinaDatos - ${URL_INFLACION}`
            }
        });
        return `inflacion.json: ${r.cambio ? 'actualizado' : 'sin cambios'} (${r.puntos} meses, último ${r.ultimo.fecha} = ${r.ultimo.valor}%)`;
    }
];

let fallas = 0;
for (const tarea of tareas) {
    try {
        console.log(await tarea());
    } catch (err) {
        fallas++;
        console.error(`ERROR: ${err.message}`);
    }
}
if (fallas) process.exit(1);
