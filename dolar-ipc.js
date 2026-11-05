// ==========================================
// DÓLAR VS INFLACIÓN (mes a mes)
// ==========================================
// Dólares: histórico diario de ArgentinaDatos (https://api.argentinadatos.com/v1/cotizaciones/dolares/{casa}),
// misma API que ya usa el sitio para riesgo país / plazo fijo (sin key, CORS habilitado).
// IPC: reusa la serie oficial del INDEC (serieIPC / obtenerIPCNivelGeneral, definidos en index.html).
//
// Variación "real" = (1 + var. dólar) / (1 + inflación) − 1
//   > 0  → el dólar subió más que los precios (el peso se depreció en términos reales)
//   < 0  → el dólar subió menos que los precios (atraso / apreciación real del peso)

/* global serieIPC, obtenerIPCNivelGeneral, calcularVariacionesIPC, formatearMesIPC, formatearPorcentajeIPC, Chart, parametroCompartido */

const DVSI_CASAS = {
    mayorista:       { nombre: 'Mayorista',  color: '#667eea' },
    oficial:         { nombre: 'Oficial',    color: '#4facfe' },
    bolsa:           { nombre: 'MEP',        color: '#f7931e' },
    contadoconliqui: { nombre: 'CCL',        color: '#a35bff' },
    blue:            { nombre: 'Blue',       color: '#e74c3c' },
    cripto:          { nombre: 'Cripto',     color: '#c9a227' }
};
const DVSI_STORAGE_KEY = 'pfcalc.dolarVsIpc';

const dvsiMensualPorCasa = {};   // casa -> Map(mes -> { cierre, promedio, ultimaFecha })
const dvsiPromesasCasa = {};     // casa -> Promise (evita pedir dos veces la misma serie)
let dvsiIPC = [];                // [{ mes, indice, variacionMensual }]
let dvsiInicializado = false;
let chartDolarIPCInstance = null;

function dvsiLeerPrefs() {
    try {
        const p = JSON.parse(localStorage.getItem(DVSI_STORAGE_KEY) || '{}');
        return p && typeof p === 'object' ? p : {};
    } catch (e) {
        return {};
    }
}

function dvsiGuardarPrefs() {
    try {
        localStorage.setItem(DVSI_STORAGE_KEY, JSON.stringify({
            casas: dvsiCasasSeleccionadas(),
            precio: document.getElementById('dvsiPrecio').value,
            vista: document.getElementById('dvsiVista').value
        }));
    } catch (e) { /* sin storage: no pasa nada */ }
}

function dvsiMesActual() {
    const hoy = new Date();
    return `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`;
}

function dvsiSumarMeses(mesStr, delta) {
    const [anio, mes] = mesStr.split('-').map(Number);
    const f = new Date(anio, mes - 1 + delta, 1);
    return `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, '0')}`;
}

// Agrupa la serie diaria en meses completos (descarta el mes en curso, que todavía no cerró)
function dvsiAgruparMensual(serieDiaria) {
    const mesActual = dvsiMesActual();
    const porMes = new Map();
    serieDiaria.forEach(p => {
        const fecha = String(p.fecha || '').slice(0, 10);
        const valor = Number(p.venta ?? p.compra);
        if (fecha.length < 7 || !Number.isFinite(valor) || valor <= 0) return;
        const mes = fecha.slice(0, 7);
        if (mes >= mesActual) return;
        const acc = porMes.get(mes) || { suma: 0, n: 0, ultimaFecha: '', cierre: null };
        acc.suma += valor;
        acc.n += 1;
        if (fecha >= acc.ultimaFecha) {
            acc.ultimaFecha = fecha;
            acc.cierre = valor;
        }
        porMes.set(mes, acc);
    });
    const resultado = new Map();
    [...porMes.keys()].sort().forEach(mes => {
        const a = porMes.get(mes);
        resultado.set(mes, { cierre: a.cierre, promedio: a.suma / a.n, ultimaFecha: a.ultimaFecha });
    });
    return resultado;
}

function dvsiCargarCasa(casa) {
    if (dvsiMensualPorCasa[casa]) return Promise.resolve(dvsiMensualPorCasa[casa]);
    if (!dvsiPromesasCasa[casa]) {
        dvsiPromesasCasa[casa] = fetch(`https://api.argentinadatos.com/v1/cotizaciones/dolares/${casa}`)
            .then(r => {
                if (!r.ok) throw new Error(`Respuesta no OK (${casa}): ${r.status}`);
                return r.json();
            })
            .then(json => {
                if (!Array.isArray(json)) throw new Error(`Formato inesperado (${casa})`);
                const mensual = dvsiAgruparMensual(json);
                if (mensual.size === 0) throw new Error(`Serie vacía (${casa})`);
                dvsiMensualPorCasa[casa] = mensual;
                return mensual;
            })
            .catch(err => {
                delete dvsiPromesasCasa[casa]; // permite reintentar
                throw err;
            });
    }
    return dvsiPromesasCasa[casa];
}

async function dvsiObtenerIPC() {
    if (Array.isArray(serieIPC) && serieIPC.length > 0) return serieIPC;
    // La pestaña IPC todavía no terminó de cargar: pedimos la serie por nuestra cuenta
    return calcularVariacionesIPC(await obtenerIPCNivelGeneral());
}

function dvsiCasasSeleccionadas() {
    return [...document.querySelectorAll('#dvsiCasas input[type="checkbox"]:checked')].map(i => i.value);
}

function dvsiValorDolar(casa, mes) {
    const mensual = dvsiMensualPorCasa[casa];
    const punto = mensual && mensual.get(mes);
    if (!punto) return null;
    const modo = document.getElementById('dvsiPrecio').value;
    return modo === 'promedio' ? punto.promedio : punto.cierre;
}

function dvsiIndiceIPC(mes) {
    const p = dvsiIPC.find(x => x.mes === mes);
    return p ? p.indice : null;
}

function dvsiVariacion(valor, base) {
    return Number.isFinite(valor) && Number.isFinite(base) && base > 0 ? (valor / base - 1) * 100 : null;
}

function dvsiReal(varDolar, varIPC) {
    if (!Number.isFinite(varDolar) || !Number.isFinite(varIPC)) return null;
    return ((1 + varDolar / 100) / (1 + varIPC / 100) - 1) * 100;
}

function dvsiColorIPC() {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--accent-ipc').trim();
    return v || '#16a085';
}

function dvsiAlpha(hex, a) {
    const h = hex.replace('#', '');
    const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

function dvsiPoblarMeses() {
    const desdeSel = document.getElementById('dvsiDesde');
    const hastaSel = document.getElementById('dvsiHasta');
    const ultimoIPC = dvsiIPC[dvsiIPC.length - 1].mes;
    const ultimoCompleto = dvsiSumarMeses(dvsiMesActual(), -1);
    const fin = ultimoCompleto > ultimoIPC ? ultimoCompleto : ultimoIPC;

    const meses = [];
    // dic-2016 es la base del IPC: la primera variación mensual es ene-2017
    for (let m = '2017-01'; m <= fin; m = dvsiSumarMeses(m, 1)) meses.push(m);

    const opciones = meses.map(m => {
        const sinIPC = m > ultimoIPC ? ' (sin IPC aún)' : '';
        return `<option value="${m}">${formatearMesIPC(m)}${sinIPC}</option>`;
    }).join('');
    const desdePrevio = desdeSel.value;
    const hastaPrevio = hastaSel.value;
    desdeSel.innerHTML = opciones;
    hastaSel.innerHTML = opciones;

    // Por defecto: últimos 12 meses con IPC publicado
    desdeSel.value = meses.includes(desdePrevio) ? desdePrevio : dvsiSumarMeses(ultimoIPC, -11);
    hastaSel.value = meses.includes(hastaPrevio) ? hastaPrevio : ultimoIPC;

    // Rango de un link compartido
    const link = typeof parametroCompartido === 'function' ? parametroCompartido : () => null;
    if (meses.includes(link('dvsiDesde'))) desdeSel.value = link('dvsiDesde');
    if (meses.includes(link('dvsiHasta'))) hastaSel.value = link('dvsiHasta');
}

function dvsiAplicarFiltroRapido(tipo, boton) {
    if (dvsiIPC.length === 0) return;
    const ultimoIPC = dvsiIPC[dvsiIPC.length - 1].mes;
    const desdeSel = document.getElementById('dvsiDesde');
    const hastaSel = document.getElementById('dvsiHasta');
    let desde;
    if (tipo === 'anio') desde = `${ultimoIPC.slice(0, 4)}-01`;
    else if (tipo === '12m') desde = dvsiSumarMeses(ultimoIPC, -11);
    else if (tipo === '24m') desde = dvsiSumarMeses(ultimoIPC, -23);
    else if (tipo === '6m') desde = dvsiSumarMeses(ultimoIPC, -5);
    else return;
    desdeSel.value = desde < '2017-01' ? '2017-01' : desde;
    hastaSel.value = ultimoIPC;

    document.querySelectorAll('#dvsiFiltros .btn-quick-filter').forEach(b => b.classList.remove('active'));
    if (boton) boton.classList.add('active');
    dvsiActualizar();
}

function dvsiRango() {
    const desde = document.getElementById('dvsiDesde').value;
    const hasta = document.getElementById('dvsiHasta').value;
    if (!desde || !hasta || desde > hasta) return null;
    const meses = [];
    for (let m = desde; m <= hasta; m = dvsiSumarMeses(m, 1)) meses.push(m);
    return { desde, hasta, base: dvsiSumarMeses(desde, -1), meses };
}

function dvsiCalcularFilas(rango, casas) {
    return rango.meses.map(mes => {
        const previo = dvsiSumarMeses(mes, -1);
        const ipc = dvsiVariacion(dvsiIndiceIPC(mes), dvsiIndiceIPC(previo));
        const dolares = {};
        casas.forEach(casa => {
            const v = dvsiVariacion(dvsiValorDolar(casa, mes), dvsiValorDolar(casa, previo));
            dolares[casa] = { variacion: v, real: dvsiReal(v, ipc) };
        });
        return { mes, ipc, dolares };
    });
}

function dvsiAcumulados(rango, casas) {
    // Último mes del rango que tiene IPC publicado (para no comparar contra un dato inexistente)
    const ultimoIPC = dvsiIPC[dvsiIPC.length - 1].mes;
    const hastaIPC = rango.hasta <= ultimoIPC ? rango.hasta : ultimoIPC;
    const ipc = hastaIPC >= rango.desde ? dvsiVariacion(dvsiIndiceIPC(hastaIPC), dvsiIndiceIPC(rango.base)) : null;
    const ipcCompleto = hastaIPC === rango.hasta;

    const dolares = {};
    casas.forEach(casa => {
        const v = dvsiVariacion(dvsiValorDolar(casa, rango.hasta), dvsiValorDolar(casa, rango.base));
        // Real: se calcula sobre el mismo período que el IPC disponible
        const vMismoPeriodo = dvsiVariacion(dvsiValorDolar(casa, hastaIPC), dvsiValorDolar(casa, rango.base));
        dolares[casa] = { variacion: v, real: dvsiReal(vMismoPeriodo, ipc) };
    });
    return { ipc, ipcCompleto, hastaIPC, dolares };
}

function dvsiClaseSigno(valor) {
    if (!Number.isFinite(valor) || Math.abs(valor) < 0.05) return '';
    return valor > 0 ? 'dvsi-pos' : 'dvsi-neg';
}

function dvsiCelda(dato) {
    if (!dato || !Number.isFinite(dato.variacion)) return '<td>—</td>';
    const real = Number.isFinite(dato.real)
        ? `<span class="dvsi-real ${dvsiClaseSigno(dato.real)}">real ${formatearPorcentajeIPC(dato.real)}</span>`
        : '';
    return `<td>${formatearPorcentajeIPC(dato.variacion)}${real}</td>`;
}

function dvsiRenderResumen(rango, casas, acum) {
    const cont = document.getElementById('dvsiResumenItems');
    const meta = document.getElementById('dvsiMeta');
    const periodo = `${formatearMesIPC(rango.desde)} – ${formatearMesIPC(rango.hasta)}`;

    let html = `
        <div class="cotizacion-item">
            <span>Inflación (IPC)${acum.ipcCompleto ? '' : ` <small>hasta ${formatearMesIPC(acum.hastaIPC)}</small>`}:</span>
            <span class="precio-dolar">${formatearPorcentajeIPC(acum.ipc)}</span>
        </div>`;
    casas.forEach(casa => {
        const d = acum.dolares[casa];
        const real = Number.isFinite(d.real)
            ? ` <span class="dvsi-real-inline ${dvsiClaseSigno(d.real)}">(real ${formatearPorcentajeIPC(d.real)})</span>`
            : '';
        html += `
        <div class="cotizacion-item">
            <span>Dólar ${DVSI_CASAS[casa].nombre}:</span>
            <span class="precio-dolar">${formatearPorcentajeIPC(d.variacion)}${real}</span>
        </div>`;
    });
    cont.innerHTML = html;

    const precio = document.getElementById('dvsiPrecio').value === 'promedio' ? 'promedio mensual' : 'cierre de mes';
    let texto = `${periodo} (incluye la variación de ${formatearMesIPC(rango.desde)}) · Dólar: ${precio}, cotización de venta`;
    if (!acum.ipcCompleto) texto += ` · ⚠️ El IPC de ${formatearMesIPC(dvsiSumarMeses(acum.hastaIPC, 1))} en adelante todavía no fue publicado; la variación real se calcula hasta ${formatearMesIPC(acum.hastaIPC)}`;
    texto += ' · Fuentes: ArgentinaDatos (dólares), INDEC (IPC)';
    meta.textContent = texto;
}

function dvsiRenderTabla(rango, casas, filas, acum) {
    const thead = document.getElementById('dvsiThead');
    const tbody = document.getElementById('dvsiTbody');
    thead.innerHTML = `<tr><th>Mes</th><th>IPC</th>${casas.map(c => `<th>${DVSI_CASAS[c].nombre}</th>`).join('')}</tr>`;

    const filaAcum = `
        <tr class="dvsi-fila-acum">
            <td>Acumulado</td>
            <td>${formatearPorcentajeIPC(acum.ipc)}</td>
            ${casas.map(c => dvsiCelda(acum.dolares[c])).join('')}
        </tr>`;
    const filasHtml = filas.slice().reverse().map(f => `
        <tr>
            <td>${formatearMesIPC(f.mes)}</td>
            <td>${formatearPorcentajeIPC(f.ipc)}</td>
            ${casas.map(c => dvsiCelda(f.dolares[c])).join('')}
        </tr>`).join('');
    tbody.innerHTML = filaAcum + filasHtml;
}

function dvsiRenderGrafico(rango, casas, filas) {
    const canvas = document.getElementById('chartDolarIPC');
    if (!canvas || typeof Chart === 'undefined') return;
    const vista = document.getElementById('dvsiVista').value;
    const colorIPC = dvsiColorIPC();
    let labels;
    const datasets = [];
    let tituloY;

    if (vista === 'acumulado') {
        // Base 100 en el mes previo al inicio del rango
        const mesesConBase = [rango.base, ...rango.meses];
        labels = mesesConBase.map(formatearMesIPC);
        const baseIPC = dvsiIndiceIPC(rango.base);
        datasets.push({
            label: 'IPC',
            data: mesesConBase.map(m => {
                const idx = dvsiIndiceIPC(m);
                return Number.isFinite(idx) && Number.isFinite(baseIPC) ? (idx / baseIPC) * 100 : null;
            }),
            borderColor: colorIPC,
            backgroundColor: dvsiAlpha(colorIPC, 0.12),
            borderWidth: 3,
            borderDash: [6, 4],
            tension: 0.2,
            pointRadius: 2
        });
        casas.forEach(casa => {
            const base = dvsiValorDolar(casa, rango.base);
            datasets.push({
                label: `Dólar ${DVSI_CASAS[casa].nombre}`,
                data: mesesConBase.map(m => {
                    const v = dvsiValorDolar(casa, m);
                    return Number.isFinite(v) && Number.isFinite(base) ? (v / base) * 100 : null;
                }),
                borderColor: DVSI_CASAS[casa].color,
                backgroundColor: dvsiAlpha(DVSI_CASAS[casa].color, 0.12),
                borderWidth: 2,
                tension: 0.2,
                pointRadius: 2
            });
        });
        tituloY = `Índice (${formatearMesIPC(rango.base)} = 100)`;
    } else if (vista === 'real') {
        labels = filas.map(f => formatearMesIPC(f.mes));
        casas.forEach(casa => {
            datasets.push({
                type: 'bar',
                label: `Dólar ${DVSI_CASAS[casa].nombre} (real)`,
                data: filas.map(f => f.dolares[casa].real),
                backgroundColor: dvsiAlpha(DVSI_CASAS[casa].color, 0.65),
                borderColor: DVSI_CASAS[casa].color,
                borderWidth: 1
            });
        });
        tituloY = 'Variación real vs IPC (%)';
    } else {
        labels = filas.map(f => formatearMesIPC(f.mes));
        datasets.push({
            type: 'bar',
            label: 'IPC',
            data: filas.map(f => f.ipc),
            backgroundColor: dvsiAlpha(colorIPC, 0.7),
            borderColor: colorIPC,
            borderWidth: 1
        });
        casas.forEach(casa => {
            datasets.push({
                type: 'bar',
                label: `Dólar ${DVSI_CASAS[casa].nombre}`,
                data: filas.map(f => f.dolares[casa].variacion),
                backgroundColor: dvsiAlpha(DVSI_CASAS[casa].color, 0.65),
                borderColor: DVSI_CASAS[casa].color,
                borderWidth: 1
            });
        });
        tituloY = 'Variación mensual (%)';
    }

    if (chartDolarIPCInstance) chartDolarIPCInstance.destroy();
    chartDolarIPCInstance = new Chart(canvas.getContext('2d'), {
        type: vista === 'acumulado' ? 'line' : 'bar',
        data: { labels, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            spanGaps: false,
            plugins: {
                legend: { display: true },
                tooltip: {
                    callbacks: {
                        label: ctx => {
                            const v = ctx.parsed.y;
                            if (!Number.isFinite(v)) return `${ctx.dataset.label}: —`;
                            return vista === 'acumulado'
                                ? `${ctx.dataset.label}: ${v.toLocaleString('es-AR', { maximumFractionDigits: 1 })} (${formatearPorcentajeIPC(v - 100)})`
                                : `${ctx.dataset.label}: ${formatearPorcentajeIPC(v)}`;
                        }
                    }
                }
            },
            scales: {
                x: { ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 12 } },
                y: { title: { display: true, text: tituloY } }
            }
        }
    });
}

// Llamado también desde ux.js al cambiar de tema
function renderGraficoDolarIPC() {
    dvsiActualizar();
}

function dvsiActualizar() {
    if (dvsiIPC.length === 0) return;
    const aviso = document.getElementById('dvsiAviso');
    const rango = dvsiRango();
    if (!rango) {
        aviso.textContent = '⚠️ El mes "Desde" tiene que ser anterior o igual al mes "Hasta".';
        return;
    }
    const casas = dvsiCasasSeleccionadas().filter(c => dvsiMensualPorCasa[c]);

    // Avisar si alguna casa no tiene datos al inicio del rango (p. ej. cripto o CCL antes de que existieran en la fuente)
    const sinHistoria = casas.filter(c => !Number.isFinite(dvsiValorDolar(c, rango.base)));
    aviso.textContent = sinHistoria.length
        ? `ℹ️ Sin cotización de ${sinHistoria.map(c => DVSI_CASAS[c].nombre).join(', ')} para ${formatearMesIPC(rango.base)}: el acumulado de esa serie no se puede calcular desde ese mes. Probá un rango más reciente.`
        : '';

    const filas = dvsiCalcularFilas(rango, casas);
    const acum = dvsiAcumulados(rango, casas);
    dvsiRenderResumen(rango, casas, acum);
    dvsiRenderTabla(rango, casas, filas, acum);
    dvsiRenderGrafico(rango, casas, filas);
}

async function dvsiCambioCasas() {
    dvsiGuardarPrefs();
    const meta = document.getElementById('dvsiMeta');
    const pendientes = dvsiCasasSeleccionadas().filter(c => !dvsiMensualPorCasa[c]);
    let avisoFallo = '';
    if (pendientes.length) {
        meta.textContent = `Cargando histórico de ${pendientes.map(c => DVSI_CASAS[c].nombre).join(', ')}...`;
        const resultados = await Promise.allSettled(pendientes.map(dvsiCargarCasa));
        const fallidas = pendientes.filter((c, i) => resultados[i].status === 'rejected');
        if (fallidas.length) {
            fallidas.forEach(c => {
                console.error('No se pudo cargar el histórico del dólar', c, resultados[pendientes.indexOf(c)].reason);
                const cb = document.querySelector(`#dvsiCasas input[value="${c}"]`);
                if (cb) cb.checked = false;
            });
            avisoFallo = `⚠️ No se pudo obtener el histórico de ${fallidas.map(c => DVSI_CASAS[c].nombre).join(', ')}. Reintentá más tarde.`;
            dvsiGuardarPrefs();
        }
    }
    dvsiActualizar();
    if (avisoFallo) {
        const aviso = document.getElementById('dvsiAviso');
        aviso.textContent = [avisoFallo, aviso.textContent].filter(Boolean).join(' ');
    }
}

function dvsiCambioOpciones() {
    dvsiGuardarPrefs();
    dvsiActualizar();
}

function exportarGraficoDolarIPC() {
    if (!chartDolarIPCInstance) return;
    const rango = dvsiRango();
    const link = document.createElement('a');
    link.href = chartDolarIPCInstance.toBase64Image('image/png', 1);
    link.download = `dolar-vs-ipc-${rango ? `${rango.desde}_a_${rango.hasta}` : 'grafico'}.png`;
    link.click();
}

async function initDolarVsIPC(forzar = false) {
    if (dvsiInicializado && !forzar) return;
    dvsiInicializado = true;

    const box = document.getElementById('dvsiResumenBox');
    const meta = document.getElementById('dvsiMeta');
    const btn = document.getElementById('btnRefreshDvsi');
    if (!box) return;

    if (forzar) {
        Object.keys(dvsiMensualPorCasa).forEach(k => delete dvsiMensualPorCasa[k]);
        Object.keys(dvsiPromesasCasa).forEach(k => delete dvsiPromesasCasa[k]);
    } else {
        // Restaurar preferencias guardadas; un link compartido tiene prioridad
        const prefs = dvsiLeerPrefs();
        const link = typeof parametroCompartido === 'function' ? parametroCompartido : () => null;
        if (link('dvsiCasas')) prefs.casas = link('dvsiCasas').split(',').filter(c => DVSI_CASAS[c]);
        if (link('dvsiPrecio')) prefs.precio = link('dvsiPrecio');
        if (link('dvsiVista')) prefs.vista = link('dvsiVista');
        if (Array.isArray(prefs.casas) && prefs.casas.length) {
            document.querySelectorAll('#dvsiCasas input[type="checkbox"]').forEach(cb => {
                cb.checked = prefs.casas.includes(cb.value);
            });
        }
        if (prefs.precio) document.getElementById('dvsiPrecio').value = prefs.precio;
        if (prefs.vista) document.getElementById('dvsiVista').value = prefs.vista;
    }

    if (btn) btn.disabled = true;
    box.classList.remove('cotizacion-error');
    meta.textContent = 'Consultando IPC (INDEC) e históricos del dólar (ArgentinaDatos)...';

    try {
        const casas = dvsiCasasSeleccionadas();
        const [ipc, ...resultados] = await Promise.allSettled([dvsiObtenerIPC(), ...casas.map(dvsiCargarCasa)]);
        if (ipc.status === 'rejected') throw ipc.reason;
        dvsiIPC = ipc.value;
        if (!dvsiIPC.length) throw new Error('Serie IPC vacía');

        const fallidas = casas.filter((c, i) => resultados[i].status === 'rejected');
        fallidas.forEach(c => {
            const cb = document.querySelector(`#dvsiCasas input[value="${c}"]`);
            if (cb) cb.checked = false;
        });
        if (fallidas.length === casas.length && casas.length > 0) throw new Error('No se pudo cargar ningún dólar');

        dvsiPoblarMeses();
        dvsiActualizar();
        if (fallidas.length) {
            document.getElementById('dvsiAviso').textContent =
                `⚠️ No se pudo obtener el histórico de ${fallidas.map(c => DVSI_CASAS[c].nombre).join(', ')}.`;
        }
    } catch (error) {
        console.error('Error al cargar Dólar vs Inflación:', error);
        dvsiInicializado = false; // permite reintentar al volver a la pestaña
        box.classList.add('cotizacion-error');
        document.getElementById('dvsiResumenItems').innerHTML = '';
        meta.textContent = '⚠️ No se pudieron obtener los datos. Reintentá con el botón de abajo.';
    } finally {
        if (btn) btn.disabled = false;
    }
}
