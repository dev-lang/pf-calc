// ==========================================
// CAUCIONES (HISTÓRICO)
// ==========================================
// Usa los JSON que actualiza a diario el workflow de cauciones (data/cauciones/{plazo}d.json, cierre
// diario de Rava) y la inflación mensual (data/inflacion.json). Cada plazo se descarga recién cuando
// hace falta (al tildarlo, al elegirlo en un selector o al abrir la curva por plazo).
//
// Partes de la pestaña:
//   1. Resumen del plazo elegido (último cierre, variación, promedio 30 días, mín./máx. del período)
//   2. Gráfico: diaria (con media móvil de 5 días y franja mín.–máx.), promedio mensual o curva por plazo
//   3. Caución vs inflación: tasa del mes (TNA promedio capitalizada a diario) contra el IPC, y tasa real
//   4. Tabla mensual por plazo (promedio, mín.–máx. y días con dato)

/* global Chart, parametroCompartido, leerDatosLocales */

const CH_PLAZOS = [1, 2, 3, 4, 5, 7, 14, 30];
const CH_COLORES = { 1: '#667eea', 2: '#9f7aea', 3: '#f7931e', 4: '#c9a227', 5: '#e67e22', 7: '#d946ef', 14: '#e74c3c', 30: '#2b8fd9' };
const CH_STORAGE_KEY = 'pfcalc.caucionesHistorico';
const CH_DEFECTO = [1, 7];

const chSeries = {};          // plazo -> [{ fecha, apertura, maximo, minimo, cierre }]
const chPromesas = {};        // plazo -> Promise (evita pedir dos veces el mismo archivo)
let chInflacion = null;       // Map('YYYY-MM' -> % mensual)
let chInicializado = false;
let chartCaucionesInstance = null;
let chartCaucionesRealInstance = null;

// ------------------------------------------
// Formato
// ------------------------------------------

const chNum = (v, d = 2) => v.toLocaleString('es-AR', { minimumFractionDigits: d, maximumFractionDigits: d });
const chPct = (v, d = 2) => (Number.isFinite(v) ? `${chNum(v, d)}%` : '—');
const chPctS = (v, d = 2) => (Number.isFinite(v) ? `${v > 0 ? '+' : ''}${chPct(v, d)}` : '—');
const chFecha = f => String(f).slice(0, 10).split('-').reverse().join('/');
const chMes = m => `${['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'][Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
const chDias = d => `${d} día${d === 1 ? '' : 's'}`;
const chMesActual = () => {
    const h = new Date();
    return `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, '0')}`;
};

function chAlpha(hex, a) {
    const n = parseInt(hex.replace('#', ''), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

// Fecha ISO de hace n días respecto de otra fecha ISO
function chRestarDias(fechaIso, n) {
    const d = new Date(`${fechaIso}T00:00:00`);
    d.setDate(d.getDate() - n);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function chColorTexto() {
    return getComputedStyle(document.documentElement).getPropertyValue('--text-title').trim() || '#33404d';
}

// ------------------------------------------
// Datos
// ------------------------------------------

function chCargarPlazo(dias) {
    if (chSeries[dias]) return Promise.resolve(chSeries[dias]);
    if (!chPromesas[dias]) {
        chPromesas[dias] = fetch(`/data/cauciones/${dias}d.json`, { cache: 'no-cache' })
            .then(r => {
                if (!r.ok) throw new Error(`Respuesta no OK (${dias}d): ${r.status}`);
                return r.json();
            })
            .then(json => {
                const serie = (Array.isArray(json.serie) ? json.serie : [])
                    .filter(p => p && /^\d{4}-\d{2}-\d{2}$/.test(p.fecha) && Number.isFinite(p.cierre) && p.cierre > 0)
                    .sort((a, b) => a.fecha.localeCompare(b.fecha));
                if (!serie.length) throw new Error(`Serie vacía (${dias}d)`);
                chSeries[dias] = serie;
                return serie;
            })
            .catch(err => {
                delete chPromesas[dias]; // permite reintentar
                throw err;
            });
    }
    return chPromesas[dias];
}

async function chCargarInflacion() {
    if (chInflacion) return chInflacion;
    let lista = null;
    const local = typeof leerDatosLocales === 'function' ? await leerDatosLocales('/data/inflacion.json') : null;
    if (local) {
        lista = local.serie;
    } else {
        const r = await fetch('https://api.argentinadatos.com/v1/finanzas/indices/inflacion');
        if (!r.ok) throw new Error('Respuesta no OK (inflación): ' + r.status);
        lista = await r.json();
    }
    chInflacion = new Map((Array.isArray(lista) ? lista : [])
        .filter(p => p && p.fecha && Number.isFinite(Number(p.valor)))
        .map(p => [String(p.fecha).slice(0, 7), Number(p.valor)]));
    return chInflacion;
}

// Carga en paralelo los plazos pedidos; devuelve los que fallaron
async function chAsegurar(plazos) {
    const pendientes = plazos.filter(d => !chSeries[d]);
    const res = await Promise.allSettled(pendientes.map(chCargarPlazo));
    return pendientes.filter((d, i) => res[i].status === 'rejected');
}

// ------------------------------------------
// Estado de los controles
// ------------------------------------------

const chEl = id => document.getElementById(id);
const chSeleccionados = () => [...document.querySelectorAll('#chPlazos input[type="checkbox"]:checked')].map(i => Number(i.value));

function chRango() {
    const desde = chEl('chDesde').value, hasta = chEl('chHasta').value;
    return desde && hasta && desde <= hasta ? { desde, hasta } : null;
}

function chFiltrar(dias) {
    const r = chRango();
    const s = chSeries[dias] || [];
    return r ? s.filter(p => p.fecha >= r.desde && p.fecha <= r.hasta) : s;
}

function chLeerPrefs() {
    try {
        const p = JSON.parse(localStorage.getItem(CH_STORAGE_KEY) || '{}');
        return p && typeof p === 'object' ? p : {};
    } catch (e) {
        return {};
    }
}

function chGuardarPrefs() {
    try {
        localStorage.setItem(CH_STORAGE_KEY, JSON.stringify({
            plazos: chSeleccionados(),
            vista: chEl('chVista').value,
            mediaMovil: chEl('chMediaMovil').checked,
            resumen: chEl('chPlazoResumen').value,
            real: chEl('chPlazoReal').value
        }));
    } catch (e) { /* sin storage: no pasa nada */ }
}

// Primero un link compartido, después lo que el usuario dejó la última vez
function chAplicarPreferencias() {
    const link = typeof parametroCompartido === 'function' ? parametroCompartido : () => null;
    const prefs = chLeerPrefs();
    const valido = v => CH_PLAZOS.includes(Number(v));

    let plazos = link('chPlazos') ? link('chPlazos').split(',').map(Number).filter(valido) : prefs.plazos;
    if (!Array.isArray(plazos) || !plazos.length) plazos = CH_DEFECTO;
    document.querySelectorAll('#chPlazos input[type="checkbox"]').forEach(cb => {
        cb.checked = plazos.includes(Number(cb.value));
    });

    const vista = link('chVista') || prefs.vista;
    if (['diaria', 'mensual', 'curva'].includes(vista)) chEl('chVista').value = vista;

    const mm = link('chMediaMovil') ?? (prefs.mediaMovil === undefined ? null : String(prefs.mediaMovil ? 1 : 0));
    if (mm !== null) chEl('chMediaMovil').checked = mm === '1' || mm === 'true';
    if (link('chFranja')) chEl('chFranja').checked = link('chFranja') === '1';

    const resumen = link('chPlazoResumen') || prefs.resumen;
    if (valido(resumen)) chEl('chPlazoResumen').value = String(resumen);
    const real = link('chPlazoReal') || prefs.real;
    if (valido(real)) chEl('chPlazoReal').value = String(real);
}

// Rango por defecto: toda la serie cargada (o el del link compartido)
function chPoblarFechas() {
    const fechas = Object.values(chSeries).flat().map(p => p.fecha).sort();
    if (!fechas.length) return;
    const primera = fechas[0], ultima = fechas[fechas.length - 1];
    const desde = chEl('chDesde'), hasta = chEl('chHasta');
    [desde, hasta].forEach(el => { el.min = primera; el.max = ultima; });
    desde.value = primera;
    hasta.value = ultima;

    const link = typeof parametroCompartido === 'function' ? parametroCompartido : () => null;
    const enRango = f => /^\d{4}-\d{2}-\d{2}$/.test(f || '') && f >= primera && f <= ultima;
    if (enRango(link('chDesde'))) desde.value = link('chDesde');
    if (enRango(link('chHasta'))) hasta.value = link('chHasta');
}

// ------------------------------------------
// Cálculos
// ------------------------------------------

// Media móvil de los últimos n días con dato
function chMediaMovil(serie, n = 5) {
    return serie.map((_, i) => {
        const ventana = serie.slice(Math.max(0, i - n + 1), i + 1);
        return ventana.reduce((s, p) => s + p.cierre, 0) / ventana.length;
    });
}

function chMensual(serie) {
    const meses = new Map();
    serie.forEach(p => {
        const m = p.fecha.slice(0, 7);
        const a = meses.get(m) || { suma: 0, n: 0, min: Infinity, max: -Infinity, primera: p.fecha };
        a.suma += p.cierre;
        a.n += 1;
        a.min = Math.min(a.min, p.cierre);
        a.max = Math.max(a.max, p.cierre);
        meses.set(m, a);
    });
    return new Map([...meses].map(([m, a]) => [m, { prom: a.suma / a.n, min: a.min, max: a.max, n: a.n, primera: a.primera }]));
}

// Promedio de los cierres de los 30 días corridos que terminan en el último dato
function chPromedio30(serie) {
    if (!serie.length) return { prom: null, n: 0 };
    const limite = chRestarDias(serie[serie.length - 1].fecha, 30);
    const ult = serie.filter(p => p.fecha > limite);
    return { prom: ult.reduce((s, p) => s + p.cierre, 0) / ult.length, n: ult.length };
}

// Mes parcial: el mes en curso, o el primer mes de la serie si arranca después del día 7
function chEsParcial(mes, serie) {
    if (mes >= chMesActual()) return true;
    return !!serie.length && serie[0].fecha.slice(0, 7) === mes && Number(serie[0].fecha.slice(8, 10)) > 7;
}

// Tasa del mes: lo que rinde renovar la caución al vencimiento durante todo el mes, a la TNA
// promedio del mes (cada renovación capitaliza el interés de un plazo: TNA x plazo / 365)
function chTasaMes(tnaPromedio, mes, plazo = 1) {
    const [anio, m] = mes.split('-').map(Number);
    const dias = new Date(anio, m, 0).getDate();
    return (Math.pow(1 + (tnaPromedio / 100) * plazo / 365, dias / plazo) - 1) * 100;
}

function chFilasReal(dias) {
    const serie = chSeries[dias] || [];
    const mensual = chMensual(serie);
    return [...mensual.keys()].sort().map(mes => {
        const caucion = chTasaMes(mensual.get(mes).prom, mes, dias);
        const ipc = chInflacion ? chInflacion.get(mes) : undefined;
        const real = Number.isFinite(ipc) ? ((1 + caucion / 100) / (1 + ipc / 100) - 1) * 100 : null;
        return { mes, caucion, ipc: Number.isFinite(ipc) ? ipc : null, real, parcial: chEsParcial(mes, serie), tna: mensual.get(mes).prom };
    });
}

// Acumulado sobre los meses completos que tienen IPC publicado
function chAcumuladoReal(filas) {
    const validas = filas.filter(f => Number.isFinite(f.real) && !f.parcial);
    if (!validas.length) return null;
    const caucion = validas.reduce((a, f) => a * (1 + f.caucion / 100), 1);
    const ipc = validas.reduce((a, f) => a * (1 + f.ipc / 100), 1);
    return {
        desde: validas[0].mes,
        hasta: validas[validas.length - 1].mes,
        meses: validas.length,
        caucion: (caucion - 1) * 100,
        ipc: (ipc - 1) * 100,
        real: (caucion / ipc - 1) * 100
    };
}

// ------------------------------------------
// Render
// ------------------------------------------

function chRenderResumen() {
    const dias = Number(chEl('chPlazoResumen').value);
    const todo = chSeries[dias] || [];
    const set = (id, txt) => { chEl(id).textContent = txt; };
    if (!todo.length) {
        ['chUltimo', 'chVariacion', 'chPromedio30', 'chMinMax'].forEach(id => set(id, '—'));
        set('chMeta', `Sin datos para ${chDias(dias)}.`);
        return;
    }
    const ultimo = todo[todo.length - 1];
    const previo = todo[todo.length - 2];
    const p30 = chPromedio30(todo);
    const periodo = chFiltrar(dias).map(p => p.cierre);

    set('chUltimo', `${chPct(ultimo.cierre)} TNA · ${chFecha(ultimo.fecha)}`);
    if (previo) {
        const dif = ultimo.cierre - previo.cierre;
        set('chVariacion', `${dif > 0 ? '+' : ''}${chNum(dif)} pp (vs. ${chFecha(previo.fecha)})`);
    } else {
        set('chVariacion', '—');
    }
    set('chPromedio30', `${chPct(p30.prom)} (${p30.n} días con dato)`);
    set('chMinMax', periodo.length ? `${chPct(Math.min(...periodo))} / ${chPct(Math.max(...periodo))}` : '—');
    set('chMeta', `${todo.length} días con dato desde el ${chFecha(todo[0].fecha)} · Fuente: Rava Bursátil (cierre diario)`);
}

function chOpciones(tituloY) {
    return {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { display: true } },
        scales: {
            x: { ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 10 } },
            y: { title: { display: true, text: tituloY } }
        }
    };
}

function chRenderGrafico() {
    const canvas = chEl('chartCauciones');
    if (!canvas || typeof Chart === 'undefined') return;
    const vista = chEl('chVista').value;
    const plazos = chSeleccionados().filter(d => chSeries[d]);
    const aviso = chEl('chAviso');

    // Opciones que solo aplican a la vista diaria; la franja, con un solo plazo
    chEl('chOpcionesDiaria').hidden = vista !== 'diaria';
    const franjaPosible = plazos.length === 1;
    chEl('chFranja').disabled = !franjaPosible;
    chEl('chFranjaLabel').title = franjaPosible ? '' : 'Disponible con un solo plazo tildado';

    if (chartCaucionesInstance) chartCaucionesInstance.destroy();
    chartCaucionesInstance = null;
    aviso.textContent = '';
    const ctx = canvas.getContext('2d');

    if (vista === 'curva') {
        const disponibles = CH_PLAZOS.filter(d => chSeries[d]);
        const ultimos = disponibles.map(d => chSeries[d][chSeries[d].length - 1]);
        chartCaucionesInstance = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: disponibles.map(chDias),
                datasets: [
                    {
                        type: 'line',
                        label: 'Promedio últimos 30 días',
                        data: disponibles.map(d => chPromedio30(chSeries[d]).prom),
                        borderColor: '#764ba2',
                        backgroundColor: '#764ba2',
                        borderWidth: 3,
                        pointRadius: 5,
                        tension: 0.25,
                        order: 1
                    },
                    {
                        type: 'bar',
                        label: 'Último cierre',
                        data: ultimos.map(p => p.cierre),
                        backgroundColor: disponibles.map(d => chAlpha(CH_COLORES[d], 0.7)),
                        borderColor: disponibles.map(d => CH_COLORES[d]),
                        borderWidth: 1,
                        borderRadius: 6,
                        order: 2
                    }
                ]
            },
            options: {
                ...chOpciones('TNA (%)'),
                plugins: {
                    legend: { display: true },
                    tooltip: {
                        callbacks: {
                            label: c => `${c.dataset.label}: ${chPct(c.parsed.y)}`,
                            afterLabel: c => (c.dataset.type === 'bar' ? `Cierre del ${chFecha(ultimos[c.dataIndex].fecha)}` : '')
                        }
                    }
                }
            }
        });
        const viejos = ultimos.filter(p => p.fecha < ultimos.map(u => u.fecha).sort().pop());
        if (viejos.length) aviso.textContent = 'Algunos plazos operan poco: su último cierre puede ser de días anteriores (ver la fecha en el tooltip).';
        return;
    }

    if (!plazos.length) {
        aviso.textContent = 'Tildá al menos un plazo para ver el gráfico.';
        return;
    }

    if (vista === 'mensual') {
        const mensual = Object.fromEntries(plazos.map(d => [d, chMensual(chFiltrar(d))]));
        const meses = [...new Set(plazos.flatMap(d => [...mensual[d].keys()]))].sort();
        const etiqueta = m => chMes(m) + (plazos.some(d => chEsParcial(m, chSeries[d])) ? '*' : '');
        chartCaucionesInstance = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: meses.map(etiqueta),
                datasets: plazos.map(d => ({
                    label: chDias(d),
                    data: meses.map(m => (mensual[d].get(m) ? mensual[d].get(m).prom : null)),
                    backgroundColor: chAlpha(CH_COLORES[d], 0.75),
                    borderColor: CH_COLORES[d],
                    borderWidth: 1,
                    borderRadius: 4
                }))
            },
            options: {
                ...chOpciones('TNA promedio (%)'),
                plugins: { legend: { display: true }, tooltip: { callbacks: { label: c => `${c.dataset.label}: ${chPct(c.parsed.y)}` } } }
            }
        });
        if (meses.some(m => etiqueta(m).endsWith('*'))) aviso.textContent = '* Mes parcial (la serie arranca a mitad de mes o el mes sigue en curso).';
        return;
    }

    // Diaria
    const mediaMovil = chEl('chMediaMovil').checked;
    const franja = franjaPosible && chEl('chFranja').checked;
    const fechas = [...new Set(plazos.flatMap(d => chFiltrar(d).map(p => p.fecha)))].sort();
    const datasets = [];
    plazos.forEach(d => {
        const serie = chFiltrar(d);
        const porFecha = new Map(serie.map(p => [p.fecha, p]));
        const mm = new Map(chMediaMovil(serie).map((v, i) => [serie[i].fecha, v]));
        const color = CH_COLORES[d];
        if (franja) {
            datasets.push({
                label: 'Máximo del día', esFranja: true,
                data: fechas.map(f => (porFecha.get(f) ? porFecha.get(f).maximo : null)),
                borderWidth: 0, pointRadius: 0, fill: '+1', backgroundColor: chAlpha(color, 0.14), spanGaps: true
            });
            datasets.push({
                label: 'Mínimo del día', esFranja: true,
                data: fechas.map(f => (porFecha.get(f) ? porFecha.get(f).minimo : null)),
                borderWidth: 0, pointRadius: 0, fill: false, spanGaps: true
            });
        }
        datasets.push({
            label: `${chDias(d)} (cierre)`,
            data: fechas.map(f => (porFecha.get(f) ? porFecha.get(f).cierre : null)),
            borderColor: mediaMovil ? chAlpha(color, 0.35) : color,
            backgroundColor: color,
            borderWidth: mediaMovil ? 1.5 : 2.5,
            pointRadius: fechas.length > 60 ? 0 : 2,
            tension: 0.2,
            spanGaps: false
        });
        if (mediaMovil) {
            datasets.push({
                label: `${chDias(d)} (media 5 días)`,
                data: fechas.map(f => (mm.has(f) ? mm.get(f) : null)),
                borderColor: color,
                backgroundColor: color,
                borderWidth: 3,
                pointRadius: 0,
                tension: 0.3,
                spanGaps: true
            });
        }
    });
    const opciones = chOpciones('TNA (%)');
    opciones.plugins.legend.labels = { filter: item => !datasets[item.datasetIndex].esFranja };
    opciones.plugins.tooltip = {
        filter: item => !item.dataset.esFranja || franja,
        callbacks: { label: c => `${c.dataset.label}: ${chPct(c.parsed.y)}` }
    };
    chartCaucionesInstance = new Chart(ctx, { type: 'line', data: { labels: fechas.map(chFecha), datasets }, options: opciones });
    aviso.textContent = 'Los huecos son días sin operación en ese plazo (fines de semana, feriados y, en 1 día, los viernes).';
}

function chRenderReal() {
    const dias = Number(chEl('chPlazoReal').value);
    const resumen = chEl('chRealResumen');
    const meta = chEl('chRealMeta');
    if (chartCaucionesRealInstance) chartCaucionesRealInstance.destroy();
    chartCaucionesRealInstance = null;

    if (!chSeries[dias] || !chInflacion) {
        resumen.innerHTML = '';
        meta.textContent = chInflacion ? `Sin datos para ${chDias(dias)}.` : '⚠️ No se pudo obtener la inflación mensual.';
        return;
    }

    const filas = chFilasReal(dias);
    const acum = chAcumuladoReal(filas);
    if (acum) {
        const color = acum.real < 0 ? 'var(--accent-danger)' : 'var(--accent-ipc)';
        resumen.innerHTML = `
            <h3>Resultado real · ${chDias(dias)}</h3>
            <div class="cotizacion-item"><span>Caución acumulada (${chMes(acum.desde)} – ${chMes(acum.hasta)}):</span><span class="precio-dolar">${chPctS(acum.caucion)}</span></div>
            <div class="cotizacion-item"><span>Inflación acumulada:</span><span class="precio-dolar">${chPctS(acum.ipc)}</span></div>
            <div class="cotizacion-item"><span>Resultado real:</span><span class="precio-dolar" style="color: ${color}">${chPctS(acum.real)}</span></div>`;
    } else {
        resumen.innerHTML = `<h3>Resultado real · ${chDias(dias)}</h3><div class="cotizacion-meta">Todavía no hay meses completos con IPC publicado para este plazo.</div>`;
    }

    const etiqueta = f => chMes(f.mes) + (f.parcial ? '*' : '');
    const textoTitulo = chColorTexto();
    chartCaucionesRealInstance = new Chart(chEl('chartCaucionesReal').getContext('2d'), {
        type: 'bar',
        data: {
            labels: filas.map(etiqueta),
            datasets: [
                {
                    type: 'line',
                    label: 'Tasa real',
                    data: filas.map(f => f.real),
                    borderColor: textoTitulo,
                    backgroundColor: textoTitulo,
                    borderWidth: 2.5,
                    pointRadius: 4,
                    order: 0
                },
                {
                    label: `Caución ${chDias(dias)} (tasa del mes)`,
                    data: filas.map(f => f.caucion),
                    backgroundColor: chAlpha(CH_COLORES[dias], 0.75),
                    borderColor: CH_COLORES[dias],
                    borderWidth: 1,
                    borderRadius: 4,
                    order: 1
                },
                {
                    label: 'Inflación (IPC)',
                    data: filas.map(f => f.ipc),
                    backgroundColor: 'rgba(22, 160, 133, 0.7)',
                    borderColor: '#16a085',
                    borderWidth: 1,
                    borderRadius: 4,
                    order: 2
                }
            ]
        },
        options: {
            ...chOpciones('% en el mes'),
            plugins: {
                legend: { display: true },
                tooltip: {
                    callbacks: {
                        label: c => `${c.dataset.label}: ${chPctS(c.parsed.y)}`,
                        afterBody: items => {
                            const f = filas[items[0].dataIndex];
                            return f ? `TNA promedio del mes: ${chPct(f.tna)}` : '';
                        }
                    }
                }
            }
        }
    });

    const sinIpc = filas.filter(f => f.ipc === null).map(f => chMes(f.mes));
    meta.textContent = `Tasa del mes = lo que rinde la TNA promedio del mes renovando la caución al vencimiento (cada ${chDias(dias)}). `
        + 'Tasa real = (1 + tasa del mes) ÷ (1 + inflación) − 1. '
        + (sinIpc.length ? `Sin IPC publicado todavía: ${sinIpc.join(', ')}. ` : '')
        + '* Mes parcial: no entra en el acumulado.';
}

function chRenderTabla() {
    const plazos = chSeleccionados().filter(d => chSeries[d]);
    const thead = chEl('chThead'), tbody = chEl('chTbody');
    if (!plazos.length) {
        thead.innerHTML = '';
        tbody.innerHTML = '';
        return;
    }
    const mensual = Object.fromEntries(plazos.map(d => [d, chMensual(chFiltrar(d))]));
    const meses = [...new Set(plazos.flatMap(d => [...mensual[d].keys()]))].sort().reverse();
    thead.innerHTML = `<tr><th>Mes</th>${plazos.map(d => `<th>${chDias(d)}</th>`).join('')}</tr>`;
    tbody.innerHTML = meses.map(m => {
        const parcial = plazos.some(d => chEsParcial(m, chSeries[d]));
        const celdas = plazos.map(d => {
            const x = mensual[d].get(m);
            return x
                ? `<td>${chPct(x.prom)}<span class="dvsi-real">${chPct(x.min, 1)} – ${chPct(x.max, 1)} · ${x.n} d</span></td>`
                : '<td>—</td>';
        }).join('');
        return `<tr><td>${chMes(m)}${parcial ? '*' : ''}</td>${celdas}</tr>`;
    }).join('');
}

// Llamado también desde ux.js al cambiar de tema
function renderGraficoCauciones() {
    chRenderGrafico();
    chRenderReal();
}

function chRenderTodo() {
    chRenderResumen();
    chRenderGrafico();
    chRenderReal();
    chRenderTabla();
}

// ------------------------------------------
// Eventos
// ------------------------------------------

async function chCambioPlazos() {
    chGuardarPrefs();
    const fallidos = await chAsegurar(chSeleccionados());
    fallidos.forEach(d => {
        const cb = document.querySelector(`#chPlazos input[value="${d}"]`);
        if (cb) cb.checked = false;
    });
    chRenderGrafico();
    chRenderTabla();
    chRenderResumen();
    if (fallidos.length) chEl('chAviso').textContent = `⚠️ No se pudo cargar: ${fallidos.map(chDias).join(', ')}.`;
}

async function chCambioVista() {
    chGuardarPrefs();
    if (chEl('chVista').value === 'curva') await chAsegurar(CH_PLAZOS);
    chRenderGrafico();
}

function chCambioOpciones() {
    chGuardarPrefs();
    chRenderGrafico();
}

function chCambioRango() {
    document.querySelectorAll('#chFiltros .btn-quick-filter').forEach(b => b.classList.remove('active'));
    chRenderResumen();
    chRenderGrafico();
    chRenderTabla();
}

async function chCambioPlazoResumen() {
    chGuardarPrefs();
    await chAsegurar([Number(chEl('chPlazoResumen').value)]);
    chRenderResumen();
}

async function chCambioPlazoReal() {
    chGuardarPrefs();
    await chAsegurar([Number(chEl('chPlazoReal').value)]);
    chRenderReal();
}

function chFiltroRapido(tipo, boton) {
    const fechas = Object.values(chSeries).flat().map(p => p.fecha).sort();
    if (!fechas.length) return;
    const primera = fechas[0], ultima = fechas[fechas.length - 1];
    const meses = { '1m': 1, '3m': 3, '6m': 6 }[tipo];
    let desde = primera;
    if (meses) {
        const d = new Date(`${ultima}T00:00:00`);
        d.setMonth(d.getMonth() - meses);
        const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        desde = iso > primera ? iso : primera;
    }
    chEl('chDesde').value = desde;
    chEl('chHasta').value = ultima;
    chRenderResumen();
    chRenderGrafico();
    chRenderTabla();
    document.querySelectorAll('#chFiltros .btn-quick-filter').forEach(b => b.classList.toggle('active', b === boton));
}

function exportarGraficoCauciones() {
    if (!chartCaucionesInstance) return;
    const r = chRango();
    const a = document.createElement('a');
    a.href = chartCaucionesInstance.toBase64Image('image/png', 1);
    a.download = `cauciones-${chEl('chVista').value}${r ? `-${r.desde}_a_${r.hasta}` : ''}.png`;
    a.click();
}

async function initCaucionesHistorico(forzar = false) {
    if (chInicializado && !forzar) return;
    chInicializado = true;
    const box = chEl('chResumenBox');
    const meta = chEl('chMeta');
    if (!box) return;

    if (forzar) {
        CH_PLAZOS.forEach(d => { delete chSeries[d]; delete chPromesas[d]; });
        chInflacion = null;
    } else {
        chAplicarPreferencias();
    }

    box.classList.remove('cotizacion-error');
    meta.textContent = 'Cargando el histórico de cauciones...';
    const necesarios = [...new Set([
        ...chSeleccionados(),
        Number(chEl('chPlazoResumen').value),
        Number(chEl('chPlazoReal').value),
        ...(chEl('chVista').value === 'curva' ? CH_PLAZOS : [])
    ])];

    const [fallidos] = await Promise.all([
        chAsegurar(necesarios),
        chCargarInflacion().catch(e => { console.error('No se pudo cargar la inflación:', e); })
    ]);

    if (fallidos.length === necesarios.length) {
        chInicializado = false; // permite reintentar al volver a la pestaña
        box.classList.add('cotizacion-error');
        meta.textContent = '⚠️ No se pudo cargar el histórico de cauciones. Reintentá con el botón de abajo.';
        return;
    }
    fallidos.forEach(d => {
        const cb = document.querySelector(`#chPlazos input[value="${d}"]`);
        if (cb) cb.checked = false;
    });

    chPoblarFechas();
    chRenderTodo();
}
