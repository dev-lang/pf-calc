// ==========================================
// COMPARTIR CÁLCULOS (imagen, link y texto)
// ==========================================
// Cada calculadora compatible muestra un botón "Compartir" (lo crea ux.js) que abre un menú con:
//   - Imagen: tarjeta PNG 1080x1080 dibujada con Canvas (sin dependencias). En el celular abre el
//     menú nativo de compartir; en la PC se puede descargar o copiar.
//   - Link: URL que reproduce el cálculo (la arma ux.js con los campos del formulario).
//   - Texto: resumen corto + link, para pegar en un chat.
// La opción "Ocultar montos" saca los pesos de la tarjeta, el texto y el link (quedan % y plazos).
//
// Para sumar una calculadora: agregar su entrada en COMPARTIBLES con una función que devuelva
// { archivo, tarjeta: {...}, texto, link? } a partir de lo que hay en pantalla.
// - Formularios (calculatorForm, caucionesForm, dolaresForm): ux.js crea el botón y arma el link.
// - Pestañas sin formulario (riesgopais, ipc, dolar-vs-ipc, calc-inflacion): este archivo crea el
//   botón (ver BOTONES_PESTANAS) y el link sale de los campos que liste cada una.
// - tarjeta.grafico puede ser una función async que devuelve la imagen del gráfico en pantalla,
//   redibujado con el tamaño y los colores de la tarjeta (ver graficoParaTarjeta).

(function () {
    'use strict';
    /* global getDiasCaucion, Chart, serieIPC, serieRiesgoPais, obtenerFilasFiltradasRiesgoPais, obtenerFilasFiltradasIPC,
       chartRiesgoPaisInstance, chartIPCInstance, chartDolarIPCInstance, formatearMesIPC, DVSI_CASAS,
       dvsiRango, dvsiCasasSeleccionadas, dvsiAcumulados, dvsiIPC */

    // ------------------------------------------
    // Utilidades
    // ------------------------------------------

    const $ = id => document.getElementById(id);
    const texto = id => ($(id) ? $(id).textContent.trim() : '');
    const valorCampo = id => ($(id) ? $(id).value : '');
    const numero = (v, fmt) => (window.pfUx ? window.pfUx.parsearNumero(v, fmt) : NaN);
    const leer = (id, fmt) => numero(valorCampo(id), fmt);

    const fmtNum = (v, dec = 2) => v.toLocaleString('es-AR', { minimumFractionDigits: dec, maximumFractionDigits: dec });
    const fmtPct = (v, dec = 2) => `${fmtNum(v, dec)}%`;
    const fmtPctSigno = (v, dec = 2) => `${v > 0 ? '+' : ''}${fmtPct(v, dec)}`;
    const fmtPesos = (v, dec = 2) => `$ ${fmtNum(v, dec)}`;
    const fmtDias = d => `${d} día${d === 1 ? '' : 's'}`;

    function hoy() {
        const d = new Date();
        return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
    }

    function temaActual() {
        return getComputedStyle(document.documentElement).colorScheme === 'dark' ? 'oscuro' : 'claro';
    }

    const tactil = () => window.matchMedia && window.matchMedia('(pointer: coarse)').matches;

    // "2026-11-04" -> "04/11/2026"
    const fechaLarga = iso => String(iso || '').slice(0, 10).split('-').reverse().join('/');
    const mesTexto = mes => (typeof formatearMesIPC === 'function' ? formatearMesIPC(mes) : mes);
    const mesCorto = mes => mesTexto(mes).replace(/ 20(\d\d)$/, ' $1'); // "Ago 2026" -> "Ago 26"
    const global = nombre => {
        // Variables "let" de otros <script> clásicos: se leen por nombre, sin window
        try { return Function(`return typeof ${nombre} !== 'undefined' ? ${nombre} : undefined`)(); } catch (e) { return undefined; }
    };

    // Link para pestañas sin formulario: #pestaña?campo=valor...
    function linkDeCampos(tab, campos, extra = {}) {
        const params = new URLSearchParams();
        campos.forEach(({ id, dinero }) => {
            const el = $(id);
            if (!el || el.value === '') return;
            params.set(id, el.dataset && el.dataset.fmt ? String(leer(id, el.dataset.fmt)) : el.value);
            if (dinero && !Number.isFinite(leer(id, 'money'))) params.delete(id);
        });
        Object.entries(extra).forEach(([k, v]) => { if (v !== undefined && v !== '') params.set(k, v); });
        const q = params.toString();
        return `${location.origin}${location.pathname}#${tab}${q ? `?${q}` : ''}`;
    }

    class SinDatos extends Error {}

    // ------------------------------------------
    // Tarjeta (Canvas 1080x1080)
    // ------------------------------------------

    const TEMAS = {
        claro: { fondo: '#f5f6fb', panel: '#ffffff', titulo: '#33404d', cuerpo: '#5a6270', tenue: '#8a90a2', chip: '#f0f2fa' },
        oscuro: { fondo: '#14161f', panel: '#1d202c', titulo: '#eef0f7', cuerpo: '#c3c8d6', tenue: '#8b91a5', chip: '#262a39' }
    };
    const FUENTE = "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

    function redondeado(ctx, x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r);
        ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r);
        ctx.arcTo(x, y, x + w, y, r);
        ctx.closePath();
    }

    // Achica la letra hasta que el texto entre en el ancho disponible; devuelve el tamaño usado
    function ajustarTexto(ctx, txt, peso, tamMax, anchoMax) {
        let tam = tamMax;
        do {
            ctx.font = `${peso} ${tam}px ${FUENTE}`;
            if (ctx.measureText(txt).width <= anchoMax) break;
            tam -= 2;
        } while (tam > 18);
        return tam;
    }

    // Mismo logo que el de la barra lateral (index.html), en un cuadrado de s px
    function dibujarLogo(ctx, x, y, s) {
        ctx.save();
        ctx.translate(x, y);
        ctx.scale(s / 32, s / 32);
        ctx.fillStyle = 'rgba(255,255,255,.18)';
        redondeado(ctx, 0, 0, 32, 32, 8);
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2.2;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath(); ctx.moveTo(8, 22.5); ctx.lineTo(24, 22.5); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(9.5, 18.5); ctx.lineTo(14, 14); ctx.lineTo(17.5, 17); ctx.lineTo(23, 10.5); ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(23, 10.5, 1.8, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
    }

    // spec = { seccion, tema, acento: {claro, oscuro}, principal: {etiqueta, valor, sub},
    //          datos: [{etiqueta, valor}], destacado?: {etiqueta, valor}, grafico?: Image, fuente, fecha }
    function dibujarTarjeta(spec) {
        const W = 1080, H = 1080, M = 64;
        const canvas = document.createElement('canvas');
        canvas.width = W;
        canvas.height = H;
        const ctx = canvas.getContext('2d');
        const t = TEMAS[spec.tema] || TEMAS.claro;
        const acento = (spec.acento && spec.acento[spec.tema]) || '#667eea';
        const conGrafico = !!spec.grafico;

        ctx.fillStyle = t.fondo;
        ctx.fillRect(0, 0, W, H);

        // Banda superior con el degradé de la marca
        const degrade = ctx.createLinearGradient(0, 0, W, 180);
        degrade.addColorStop(0, '#667eea');
        degrade.addColorStop(1, '#764ba2');
        ctx.fillStyle = degrade;
        ctx.fillRect(0, 0, W, 180);
        dibujarLogo(ctx, M, 58, 64);
        ctx.fillStyle = '#fff';
        ctx.textBaseline = 'middle';
        ctx.font = `700 40px ${FUENTE}`;
        ctx.fillText('FinanceAR', M + 84, 92);

        ctx.font = `600 28px ${FUENTE}`;
        const anchoChip = ctx.measureText(spec.seccion).width + 48;
        ctx.fillStyle = 'rgba(255,255,255,.2)';
        redondeado(ctx, W - M - anchoChip, 66, anchoChip, 52, 26);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center';
        ctx.fillText(spec.seccion, W - M - anchoChip / 2, 93);
        ctx.textAlign = 'left';

        // Panel
        const py = 150, ph = H - py - 120;
        ctx.save();
        ctx.shadowColor = 'rgba(20,24,60,.12)';
        ctx.shadowBlur = 40;
        ctx.shadowOffsetY = 12;
        ctx.fillStyle = t.panel;
        redondeado(ctx, 40, py, W - 80, ph, 36);
        ctx.fill();
        ctx.restore();

        const x0 = 96, ancho = W - 80 - 112;
        let y = py + 70;

        // Dato principal
        ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = t.cuerpo;
        ctx.font = `600 32px ${FUENTE}`;
        ctx.fillText(spec.principal.etiqueta, x0, y);
        y += conGrafico ? 108 : 150;
        const tamValor = ajustarTexto(ctx, spec.principal.valor, 800, conGrafico ? 104 : 148, ancho);
        ctx.fillStyle = t.titulo;
        ctx.font = `800 ${tamValor}px ${FUENTE}`;
        ctx.fillText(spec.principal.valor, x0 - 4, y);
        if (spec.principal.sub) {
            y += conGrafico ? 54 : 66;
            ctx.fillStyle = acento;
            ajustarTexto(ctx, spec.principal.sub, 700, conGrafico ? 32 : 38, ancho);
            ctx.fillText(spec.principal.sub, x0, y);
        }

        const datos = spec.datos || [];
        if (conGrafico) {
            // Fila de chips + gráfico
            y += 44;
            let x = x0;
            datos.slice(0, 3).forEach(d => {
                ctx.font = `600 24px ${FUENTE}`;
                const etiqueta = `${d.etiqueta}: `;
                const w1 = ctx.measureText(etiqueta).width;
                ctx.font = `700 24px ${FUENTE}`;
                const w = w1 + ctx.measureText(d.valor).width + 36;
                if (x + w > x0 + ancho) return; // no entra: se omite
                ctx.fillStyle = t.chip;
                redondeado(ctx, x, y, w, 50, 25);
                ctx.fill();
                ctx.textBaseline = 'middle';
                ctx.fillStyle = t.tenue;
                ctx.font = `600 24px ${FUENTE}`;
                ctx.fillText(etiqueta, x + 18, y + 26);
                ctx.fillStyle = t.titulo;
                ctx.font = `700 24px ${FUENTE}`;
                ctx.fillText(d.valor, x + 18 + w1, y + 26);
                ctx.textBaseline = 'alphabetic';
                x += w + 14;
            });
            y += 78;
            ctx.drawImage(spec.grafico, x0 - 8, y, ancho + 16, py + ph - 40 - y);
        } else {
            // Grilla 2x2
            y += 64;
            const col = (ancho - 24) / 2, fila = 132;
            datos.slice(0, 4).forEach((d, i) => {
                const cx = x0 + (i % 2) * (col + 24);
                const cy = y + Math.floor(i / 2) * (fila + 24);
                ctx.fillStyle = t.chip;
                redondeado(ctx, cx, cy, col, fila, 24);
                ctx.fill();
                ctx.fillStyle = t.tenue;
                ctx.font = `600 26px ${FUENTE}`;
                ctx.fillText(d.etiqueta, cx + 28, cy + 48);
                const tam = ajustarTexto(ctx, d.valor, 750, 44, col - 56);
                ctx.fillStyle = t.titulo;
                ctx.font = `750 ${tam}px ${FUENTE}`;
                ctx.fillText(d.valor, cx + 28, cy + 104);
            });

            if (spec.destacado) {
                const bh = 112, by = py + ph - 36 - bh;
                ctx.save();
                ctx.globalAlpha = spec.tema === 'oscuro' ? 0.18 : 0.1;
                ctx.fillStyle = acento;
                redondeado(ctx, x0, by, ancho, bh, 24);
                ctx.fill();
                ctx.restore();
                ctx.textBaseline = 'middle';
                ctx.fillStyle = t.cuerpo;
                ctx.font = `600 30px ${FUENTE}`;
                ctx.fillText(spec.destacado.etiqueta, x0 + 32, by + bh / 2);
                ctx.textAlign = 'right';
                ctx.fillStyle = acento;
                const tam = ajustarTexto(ctx, spec.destacado.valor, 800, 48, ancho * 0.6);
                ctx.font = `800 ${tam}px ${FUENTE}`;
                ctx.fillText(spec.destacado.valor, x0 + ancho - 32, by + bh / 2);
                ctx.textAlign = 'left';
                ctx.textBaseline = 'alphabetic';
            }
        }

        // Pie
        ctx.textBaseline = 'middle';
        ctx.fillStyle = t.tenue;
        const pie = `${spec.fuente} · ${spec.fecha}`;
        ajustarTexto(ctx, pie, 500, 24, W - 2 * M - 300);
        ctx.fillText(pie, M, H - 58);
        ctx.textAlign = 'right';
        ctx.fillStyle = acento;
        ctx.font = `700 26px ${FUENTE}`;
        ctx.fillText('financear.netlify.app', W - M, H - 58);
        ctx.textAlign = 'left';

        return canvas;
    }

    // ------------------------------------------
    // Qué comparte cada calculadora
    // ------------------------------------------

    const CAPITALIZACION = { simple: 'Interés simple', compuesta: 'Compuesto diario', mensual: 'Compuesto mensual' };

    const COMPARTIBLES = {
        calculatorForm(sinMontos) {
            const capital = leer('capital', 'money');
            const tna = leer('tasa', 'pct');
            const dias = parseInt(valorCampo('plazo'), 10);
            const rend = numero(texto('rendimientoTotal'), 'pct');
            const rendMensual = numero(texto('rendimientoMensual'), 'pct');
            const capitalizacion = CAPITALIZACION[valorCampo('capitalizacion')] || '';
            const banco = valorCampo('fuenteTasa') === 'banco' && $('bancoTasaPlazoFijo')
                ? $('bancoTasaPlazoFijo').selectedOptions[0]?.textContent.trim()
                : '';
            const fuente = banco ? `TNA de ${banco.replace(/\s*[-–(].*$/, '')}` : 'TNA cargada por el usuario';

            const tarjeta = sinMontos
                ? {
                    principal: { etiqueta: `Rendimiento en ${fmtDias(dias)}`, valor: fmtPctSigno(rend), sub: 'Sobre el capital invertido' },
                    datos: [
                        { etiqueta: 'TNA', valor: fmtPct(tna) },
                        { etiqueta: 'Plazo', valor: fmtDias(dias) },
                        { etiqueta: 'Capitalización', valor: capitalizacion },
                        { etiqueta: 'Rend. mensual', valor: fmtPct(rendMensual) }
                    ],
                    destacado: { etiqueta: 'Cada $100 invertidos', valor: fmtPesos(100 + rend) }
                }
                : {
                    principal: { etiqueta: `Ganancia en ${fmtDias(dias)}`, valor: texto('intereses'), sub: `${fmtPctSigno(rend)} sobre el capital` },
                    datos: [
                        { etiqueta: 'Capital', valor: fmtPesos(capital, 0) },
                        { etiqueta: 'TNA', valor: fmtPct(tna) },
                        { etiqueta: 'Plazo', valor: fmtDias(dias) },
                        { etiqueta: 'Capitalización', valor: capitalizacion }
                    ],
                    destacado: { etiqueta: 'Monto al vencimiento', valor: texto('capitalFinal') }
                };

            return {
                archivo: 'plazo-fijo',
                tarjeta: { ...tarjeta, seccion: 'Plazo Fijo', acento: { claro: '#5a67d8', oscuro: '#8c9cf5' }, fuente },
                texto: sinMontos
                    ? `Plazo fijo a ${fmtDias(dias)} con TNA ${fmtPct(tna)} (${capitalizacion.toLowerCase()}): rinde ${fmtPctSigno(rend)}.`
                    : `Plazo fijo de ${fmtPesos(capital, 0)} a ${fmtDias(dias)} con TNA ${fmtPct(tna)}: ganás ${texto('intereses')} (${fmtPctSigno(rend)}). Monto final: ${texto('capitalFinal')}.`
            };
        },

        caucionesForm(sinMontos) {
            const capital = leer('capitalCaucion', 'money');
            const tna = leer('tasaCaucion', 'pct');
            const dias = typeof getDiasCaucion === 'function' ? getDiasCaucion() : parseInt(valorCampo('plazoCaucion'), 10);
            const rend = numero(texto('rendimientoNetoCaucion'), 'pct');
            const tnaEfectiva = numero(texto('tnaEfectiva'), 'pct');
            const costos = numero(texto('totalCostos'), 'money');

            // Si la TNA vino del cierre de Rava (no la escribió el usuario), se cita con su fecha
            let fuente = 'TNA cargada por el usuario';
            if ($('tasaCaucion') && !$('tasaCaucion').dataset.manual) {
                const fecha = (texto('tasaCaucionMeta').match(/(\d{2}\/\d{2})\/\d{4}/) || [])[1];
                fuente = fecha ? `TNA: cierre de Rava del ${fecha}` : 'TNA: último cierre de Rava';
            }

            const tarjeta = sinMontos
                ? {
                    principal: { etiqueta: `Rendimiento neto en ${fmtDias(dias)}`, valor: fmtPctSigno(rend, 3), sub: `TNA efectiva ${fmtPct(tnaEfectiva)} (después de costos)` },
                    datos: [
                        { etiqueta: 'TNA', valor: fmtPct(tna) },
                        { etiqueta: 'Plazo', valor: fmtDias(dias) },
                        { etiqueta: 'TNA efectiva', valor: fmtPct(tnaEfectiva) },
                        { etiqueta: 'Costos', valor: Number.isFinite(costos) && capital > 0 ? `${fmtPct((costos / capital) * 100, 3)} del capital` : '—' }
                    ],
                    destacado: { etiqueta: 'Cada $100 invertidos', valor: fmtPesos(100 + rend) }
                }
                : {
                    principal: { etiqueta: `Interés neto en ${fmtDias(dias)}`, valor: texto('interesesNetos'), sub: `${fmtPctSigno(rend, 3)} neto · TNA efectiva ${fmtPct(tnaEfectiva)}` },
                    datos: [
                        { etiqueta: 'Capital', valor: fmtPesos(capital, 0) },
                        { etiqueta: 'TNA', valor: fmtPct(tna) },
                        { etiqueta: 'Plazo', valor: fmtDias(dias) },
                        { etiqueta: 'Costos', valor: texto('totalCostos') }
                    ],
                    destacado: { etiqueta: 'Capital final', valor: texto('capitalFinalCaucion') }
                };

            return {
                archivo: 'caucion',
                tarjeta: { ...tarjeta, seccion: 'Caución', acento: { claro: '#2b7fd4', oscuro: '#6cb8ff' }, fuente },
                texto: sinMontos
                    ? `Caución a ${fmtDias(dias)} con TNA ${fmtPct(tna)}: rinde ${fmtPctSigno(rend, 3)} neto de costos (TNA efectiva ${fmtPct(tnaEfectiva)}).`
                    : `Caución de ${fmtPesos(capital, 0)} a ${fmtDias(dias)} con TNA ${fmtPct(tna)}: ganás ${texto('interesesNetos')} neto de costos (${fmtPctSigno(rend, 3)}). Capital final: ${texto('capitalFinalCaucion')}.`
            };
        }
    };

    // ------------------------------------------
    // Gráficos: se redibuja el Chart.js de la pestaña con el tamaño y colores de la tarjeta
    // ------------------------------------------

    const ANCHO_GRAFICO = 920, ALTO_GRAFICO = 416; // área que deja dibujarTarjeta para el gráfico

    function graficoParaTarjeta(nombreInstancia, tema) {
        return () => new Promise((resolve, reject) => {
            const original = global(nombreInstancia);
            if (!original || typeof Chart === 'undefined') return reject(new SinDatos());
            const oscuro = tema === 'oscuro';
            const texto = oscuro ? '#8b91a5' : '#8a90a2';
            const grilla = oscuro ? '#2c3040' : '#eceef5';
            const cfg = original.config;
            const puntos = (cfg.data.labels || []).length;

            const datasets = cfg.data.datasets.map(d => {
                const copia = { ...d, data: [...d.data], datalabels: { display: false } };
                const tipo = d.type || cfg.type;
                if (tipo === 'line') {
                    copia.borderWidth = (d.borderWidth || 2) * 2;
                    copia.pointRadius = puntos > 40 ? 0 : 4;
                    copia.pointHoverRadius = 0;
                }
                if (tipo === 'bar') copia.borderRadius = 6;
                return copia;
            });

            const escalas = {};
            Object.entries(cfg.options.scales || {}).forEach(([id, e]) => {
                escalas[id] = {
                    ...e,
                    title: e.title && e.title.display ? { ...e.title, color: texto, font: { size: 18, weight: '600' } } : { display: false },
                    ticks: { ...(e.ticks || {}), color: texto, font: { size: 20 }, maxRotation: 0, autoSkip: true, maxTicksLimit: id === 'x' ? 7 : 6 },
                    grid: { ...(e.grid || {}), color: grilla, display: id !== 'x' && !(e.grid && e.grid.drawOnChartArea === false) },
                    border: { display: false }
                };
            });

            const lienzo = document.createElement('canvas');
            lienzo.width = ANCHO_GRAFICO;
            lienzo.height = ALTO_GRAFICO;
            const chart = new Chart(lienzo, {
                type: cfg.type,
                data: { labels: [...cfg.data.labels], datasets },
                options: {
                    responsive: false,
                    animation: false,
                    devicePixelRatio: 1,
                    events: [],
                    plugins: {
                        legend: {
                            display: datasets.length > 1,
                            labels: { color: texto, font: { size: 20 }, boxWidth: 22, padding: 18 }
                        },
                        tooltip: { enabled: false },
                        datalabels: false
                    },
                    scales: escalas
                }
            });
            const img = new Image();
            img.onload = () => { chart.destroy(); resolve(img); };
            img.onerror = reject;
            img.src = lienzo.toDataURL('image/png');
        });
    }

    // ------------------------------------------
    // Pestañas sin formulario + Compra/Venta USD
    // ------------------------------------------

    const NOMBRE_DOLAR = {
        oficial: 'oficial', blue: 'blue', bolsa: 'MEP', contadoconliqui: 'CCL',
        mayorista: 'mayorista', tarjeta: 'tarjeta', cripto: 'cripto'
    };

    Object.assign(COMPARTIBLES, {
        dolaresForm(sinMontos) {
            const op = valorCampo('operacionTipo');
            const tipo = valorCampo('tipoDolar');
            const nombre = `Dólar ${NOMBRE_DOLAR[tipo] || tipo}`;
            const config = {
                comprar: { cotizacion: 'cotizacionAplicada', entrega: ['Entregás', 'pesosEntregados'], recibe: ['Recibís', 'dolaresRecibidos'], verbo: 'Comprar' },
                'comprar-objetivo': { cotizacion: 'cotizacionAplicadaObjetivo', entrega: ['Querés', 'dolaresObjetivoResult'], recibe: ['Necesitás', 'pesosNecesarios'], verbo: 'Comprar' },
                vender: { cotizacion: 'cotizacionAplicadaVenta', entrega: ['Entregás', 'dolaresEntregados'], recibe: ['Recibís', 'pesosRecibidos'], verbo: 'Vender' }
            }[op] || null;
            if (!config) throw new SinDatos();
            const cotizacion = texto(config.cotizacion);
            // "$ 1.390,00 (54%, dentro de la banda)" -> "Dentro (54%)"
            const bandaTxt = texto('bandaPosicionDisplay');
            const m = bandaTxt.match(/\(([\d.,]+%),\s*([^)]+)\)/);
            const banda = m ? `${m[2].replace(/ de la banda$/i, '').replace(/^./, c => c.toUpperCase())} (${m[1]})` : '';
            const bandaOk = !!banda;
            const spread = texto('spreadBancario');

            const tarjeta = sinMontos
                ? {
                    principal: { etiqueta: `${config.verbo} · ${nombre}`, valor: cotizacion, sub: 'Cotización aplicada por dólar' },
                    datos: [
                        { etiqueta: 'Tipo de dólar', valor: nombre.replace('Dólar ', '').replace(/^./, c => c.toUpperCase()) },
                        { etiqueta: 'Operación', valor: config.verbo },
                        { etiqueta: 'Spread', valor: spread.replace(/^.*\((.*)\).*$/, '$1') || '—' },
                        { etiqueta: 'Mayorista vs. banda', valor: bandaOk ? banda : '—' }
                    ]
                }
                : {
                    principal: { etiqueta: `${config.recibe[0]} · ${nombre}`, valor: texto(config.recibe[1]), sub: `A ${cotizacion} por dólar` },
                    datos: [
                        { etiqueta: 'Tipo de dólar', valor: nombre.replace('Dólar ', '').replace(/^./, c => c.toUpperCase()) },
                        { etiqueta: 'Cotización', valor: cotizacion },
                        { etiqueta: 'Spread', valor: spread || '—' },
                        { etiqueta: 'Mayorista vs. banda', valor: bandaOk ? banda : '—' }
                    ],
                    destacado: { etiqueta: config.entrega[0], valor: texto(config.entrega[1]) }
                };

            const textos = {
                comprar: `Con ${texto('pesosEntregados')} comprás ${texto('dolaresRecibidos')} al ${nombre.toLowerCase()} (${cotizacion} por dólar).`,
                'comprar-objetivo': `Para comprar ${texto('dolaresObjetivoResult')} al ${nombre.toLowerCase()} necesitás ${texto('pesosNecesarios')} (${cotizacion} por dólar).`,
                vender: `Vendiendo ${texto('dolaresEntregados')} al ${nombre.toLowerCase()} recibís ${texto('pesosRecibidos')} (${cotizacion} por dólar).`
            };
            return {
                archivo: `dolar-${tipo}`,
                tarjeta: { ...tarjeta, seccion: 'Compra/Venta USD', acento: { claro: '#1e9e6a', oscuro: '#3fd19a' }, fuente: 'Cotización: DolarApi' },
                texto: sinMontos ? `${nombre}: ${cotizacion} por dólar para ${config.verbo.toLowerCase()}.` : textos[op]
            };
        },

        riesgopais() {
            const filas = typeof obtenerFilasFiltradasRiesgoPais === 'function' ? obtenerFilasFiltradasRiesgoPais() : [];
            if (filas.length < 1) throw new SinDatos();
            const ini = filas[0], fin = filas[filas.length - 1];
            const valores = filas.map(p => p.valor);
            const delta = fin.valor - ini.valor;
            const deltaPct = ini.valor ? (fin.valor / ini.valor - 1) * 100 : 0;
            const dias = Math.round((new Date(fin.fecha) - new Date(ini.fecha)) / 86400000);
            const pb = v => `${Math.round(v).toLocaleString('es-AR')} pb`;
            const tema = temaActual();
            return {
                archivo: 'riesgo-pais',
                tarjeta: {
                    seccion: 'Riesgo País',
                    acento: { claro: '#e74c3c', oscuro: '#ff6b5e' },
                    fuente: 'Fuente: Ámbito vía ArgentinaDatos',
                    principal: { etiqueta: `Riesgo país al ${fechaLarga(fin.fecha)}`, valor: pb(fin.valor), sub: `${delta > 0 ? '+' : ''}${pb(delta)} (${fmtPctSigno(deltaPct, 1)}) desde el ${fechaLarga(ini.fecha)}` },
                    datos: [
                        { etiqueta: 'Mín.', valor: pb(Math.min(...valores)) },
                        { etiqueta: 'Máx.', valor: pb(Math.max(...valores)) },
                        { etiqueta: 'Período', valor: `${dias} días` }
                    ],
                    grafico: graficoParaTarjeta('chartRiesgoPaisInstance', tema)
                },
                texto: `Riesgo país: ${pb(fin.valor)} al ${fechaLarga(fin.fecha)} (${delta > 0 ? '+' : ''}${pb(delta)} desde el ${fechaLarga(ini.fecha)}). Mín. ${pb(Math.min(...valores))} · Máx. ${pb(Math.max(...valores))}.`,
                link: linkDeCampos('riesgopais', [{ id: 'riesgoPaisDesde' }, { id: 'riesgoPaisHasta' }])
            };
        },

        ipc() {
            const filas = typeof obtenerFilasFiltradasIPC === 'function' ? obtenerFilasFiltradasIPC() : [];
            if (filas.length < 1) throw new SinDatos();
            const ini = filas[0], fin = filas[filas.length - 1];
            const serie = global('serieIPC') || [];
            const iBase = serie.findIndex(p => p.mes === ini.mes) - 1;
            const acumulada = iBase >= 0 ? (fin.indice / serie[iBase].indice - 1) * 100 : null;
            const tema = temaActual();
            const datos = [
                { etiqueta: 'Interanual', valor: Number.isFinite(fin.variacionInteranual) ? fmtPctSigno(fin.variacionInteranual, 1) : '—' },
                { etiqueta: `Acum. ${mesCorto(ini.mes)}–${mesCorto(fin.mes)}`, valor: Number.isFinite(acumulada) ? fmtPctSigno(acumulada, 1) : '—' },
                { etiqueta: 'Meses', valor: String(filas.length) }
            ];
            return {
                archivo: 'inflacion',
                tarjeta: {
                    seccion: 'Inflación (IPC)',
                    acento: { claro: '#16a085', oscuro: '#2ecc9a' },
                    fuente: 'Fuente: INDEC',
                    principal: { etiqueta: `Inflación de ${mesTexto(fin.mes)}`, valor: fmtPctSigno(fin.variacionMensual, 1), sub: 'Mensual · IPC Nivel General Nacional' },
                    datos,
                    grafico: graficoParaTarjeta('chartIPCInstance', tema)
                },
                texto: `Inflación de ${mesTexto(fin.mes)}: ${fmtPctSigno(fin.variacionMensual, 1)} mensual${Number.isFinite(fin.variacionInteranual) ? `, ${fmtPctSigno(fin.variacionInteranual, 1)} interanual` : ''}.`
                    + (Number.isFinite(acumulada) ? ` Acumulada ${mesTexto(ini.mes)}–${mesTexto(fin.mes)}: ${fmtPctSigno(acumulada, 1)}.` : ''),
                link: linkDeCampos('ipc', [{ id: 'ipcDesde' }, { id: 'ipcHasta' }, { id: 'seriesIPC' }])
            };
        },

        'dolar-vs-ipc'() {
            const rango = typeof dvsiRango === 'function' ? dvsiRango() : null;
            const ipcCargado = (global('dvsiIPC') || []).length > 0;
            if (!rango || !ipcCargado || !global('chartDolarIPCInstance')) throw new SinDatos();
            const casas = dvsiCasasSeleccionadas().filter(c => DVSI_CASAS[c]);
            if (!casas.length) throw new SinDatos();
            const acum = dvsiAcumulados(rango, casas);
            const principal = casas[0];
            const dP = acum.dolares[principal];
            const nombreCasa = c => `Dólar ${DVSI_CASAS[c].nombre}`;
            const periodo = `${mesCorto(rango.desde)} – ${mesCorto(rango.hasta)}`;
            const tema = temaActual();
            const conReal = Number.isFinite(dP.real);
            const casasTexto = casas.map(c => {
                const d = acum.dolares[c];
                if (!Number.isFinite(d.variacion)) return null;
                return `${nombreCasa(c).toLowerCase()} ${fmtPctSigno(d.variacion, 1)}${Number.isFinite(d.real) ? ` (real ${fmtPctSigno(d.real, 1)})` : ''}`;
            }).filter(Boolean).join('; ');
            return {
                archivo: 'dolar-vs-inflacion',
                tarjeta: {
                    seccion: 'Dólar vs Inflación',
                    acento: { claro: '#5a67d8', oscuro: '#8c9cf5' },
                    fuente: 'Fuentes: ArgentinaDatos e INDEC',
                    principal: conReal
                        ? { etiqueta: `${nombreCasa(principal)} vs inflación · ${periodo}`, valor: `${fmtPctSigno(dP.real, 1)} real`, sub: `Dólar ${fmtPctSigno(dP.variacion, 1)} vs IPC ${fmtPctSigno(acum.ipc, 1)}${acum.ipcCompleto ? '' : ` (IPC hasta ${mesCorto(acum.hastaIPC)})`}` }
                        : { etiqueta: `${nombreCasa(principal)} · ${periodo}`, valor: Number.isFinite(dP.variacion) ? fmtPctSigno(dP.variacion, 1) : '—', sub: 'Variación acumulada del dólar' },
                    datos: [
                        { etiqueta: 'IPC', valor: Number.isFinite(acum.ipc) ? fmtPctSigno(acum.ipc, 1) : '—' },
                        ...casas.slice(0, 2).map(c => ({ etiqueta: DVSI_CASAS[c].nombre, valor: Number.isFinite(acum.dolares[c].variacion) ? fmtPctSigno(acum.dolares[c].variacion, 1) : '—' }))
                    ],
                    grafico: graficoParaTarjeta('chartDolarIPCInstance', tema)
                },
                texto: `${mesTexto(rango.desde)} – ${mesTexto(rango.hasta)}: inflación ${Number.isFinite(acum.ipc) ? fmtPctSigno(acum.ipc, 1) : '—'}${acum.ipcCompleto ? '' : ` (hasta ${mesTexto(acum.hastaIPC)})`}; ${casasTexto}.`,
                link: linkDeCampos('dolar-vs-ipc', [{ id: 'dvsiDesde' }, { id: 'dvsiHasta' }, { id: 'dvsiVista' }, { id: 'dvsiPrecio' }], { dvsiCasas: casas.join(',') })
            };
        },

        'calc-inflacion'(sinMontos) {
            const desde = valorCampo('calcInfDesde'), hasta = valorCampo('calcInfHasta');
            const acumulada = numero(texto('calcInfAcumulada'), 'pct');
            if (!desde || !hasta || !Number.isFinite(acumulada)) throw new SinDatos();
            const [a1, m1] = desde.split('-').map(Number), [a2, m2] = hasta.split('-').map(Number);
            const meses = (a2 - a1) * 12 + (m2 - m1);
            const promedio = meses > 0 ? (Math.pow(1 + acumulada / 100, 1 / meses) - 1) * 100 : null;
            const monto = leer('calcInfMonto', 'money');
            const conMonto = !sinMontos && Number.isFinite(monto) && monto > 0;
            return {
                archivo: 'inflacion-entre-fechas',
                tarjeta: {
                    seccion: 'Inflación entre fechas',
                    acento: { claro: '#16a085', oscuro: '#2ecc9a' },
                    fuente: 'Fuente: INDEC (IPC Nivel General)',
                    principal: { etiqueta: `Inflación entre ${mesTexto(desde)} y ${mesTexto(hasta)}`, valor: fmtPctSigno(acumulada, 1), sub: `Acumulada en ${meses} ${meses === 1 ? 'mes' : 'meses'}` },
                    datos: [
                        { etiqueta: 'Desde', valor: mesTexto(desde) },
                        { etiqueta: 'Hasta', valor: mesTexto(hasta) },
                        { etiqueta: 'Promedio mensual', valor: Number.isFinite(promedio) ? fmtPct(promedio) : '—' },
                        conMonto ? { etiqueta: 'Monto inicial', valor: fmtPesos(monto) } : { etiqueta: 'Meses', valor: String(meses) }
                    ],
                    destacado: conMonto
                        ? { etiqueta: `Equivale en ${mesTexto(hasta)} a`, valor: texto('calcInfMontoResult') }
                        : { etiqueta: `$100 de ${mesTexto(desde)} equivalen a`, valor: fmtPesos(100 + acumulada) }
                },
                texto: `Inflación entre ${mesTexto(desde)} y ${mesTexto(hasta)}: ${fmtPctSigno(acumulada, 1)} (${meses} meses).`
                    + (conMonto ? ` ${fmtPesos(monto)} de ${mesTexto(desde)} equivalen a ${texto('calcInfMontoResult')} en ${mesTexto(hasta)}.` : ''),
                link: linkDeCampos('calc-inflacion', [{ id: 'calcInfDesde' }, { id: 'calcInfHasta' }, ...(sinMontos ? [] : [{ id: 'calcInfMonto', dinero: true }])])
            };
        }
    });

    // Sin pesos que ocultar: el menú no muestra "Ocultar montos"
    const TIENE_MONTOS = {
        riesgopais: () => false,
        ipc: () => false,
        'dolar-vs-ipc': () => false,
        'calc-inflacion': () => Number.isFinite(leer('calcInfMonto', 'money')) && leer('calcInfMonto', 'money') > 0
    };
    const tieneMontos = id => (TIENE_MONTOS[id] ? TIENE_MONTOS[id]() : true);

    function armar(formId, sinMontos) {
        const datos = COMPARTIBLES[formId](sinMontos && tieneMontos(formId));
        datos.tarjeta.tema = temaActual();
        datos.tarjeta.fecha = hoy();
        if (!datos.link) datos.link = window.pfUx ? window.pfUx.construirLink(formId, { sinMontos }) : location.href;
        return datos;
    }

    // Si todavía no cargaron los datos de la pestaña, se avisa en vez de fallar
    function conDatos(accion) {
        return async (formId, sinMontos) => {
            try {
                await accion(formId, sinMontos);
            } catch (e) {
                if (e instanceof SinDatos) avisar('Todavía no hay datos para compartir');
                else {
                    console.error('Error al compartir:', e);
                    avisar('No se pudo generar lo que querés compartir');
                }
            }
        };
    }

    // ------------------------------------------
    // Acciones
    // ------------------------------------------

    let toastTimer = null;
    function avisar(mensaje) {
        let toast = $('compartirToast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'compartirToast';
            toast.className = 'compartir-toast';
            toast.setAttribute('role', 'status');
            document.body.appendChild(toast);
        }
        toast.textContent = mensaje;
        toast.classList.add('visible');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => toast.classList.remove('visible'), 2400);
    }

    async function copiarTexto(txt, mensaje) {
        try {
            await navigator.clipboard.writeText(txt);
            avisar(mensaje);
        } catch (e) {
            window.prompt('Copiá este texto:', txt);
        }
    }

    // En el celular, el menú nativo; en la PC, al portapapeles
    async function compartirOCopiar(payload, txtCopia, mensaje) {
        if (tactil() && navigator.share) {
            try {
                await navigator.share(payload);
                return;
            } catch (e) {
                if (e && e.name === 'AbortError') return; // el usuario cerró el menú
            }
        }
        copiarTexto(txtCopia, mensaje);
    }

    function compartirLink(formId, sinMontos) {
        const d = armar(formId, sinMontos);
        compartirOCopiar({ title: `FinanceAR · ${d.tarjeta.seccion}`, url: d.link }, d.link, '✓ Link copiado');
    }

    function compartirTexto(formId, sinMontos) {
        const d = armar(formId, sinMontos);
        const txt = `${d.texto}\nCalculado en FinanceAR: ${d.link}`;
        compartirOCopiar({ text: txt }, txt, '✓ Texto copiado');
    }

    function aBlob(canvas) {
        return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    }

    async function compartirImagen(formId, sinMontos) {
        const d = armar(formId, sinMontos);
        if (typeof d.tarjeta.grafico === 'function') d.tarjeta.grafico = await d.tarjeta.grafico();
        const canvas = dibujarTarjeta(d.tarjeta);
        const blob = await aBlob(canvas);
        const nombre = `financear-${d.archivo}-${new Date().toISOString().slice(0, 10)}.png`;
        const archivo = new File([blob], nombre, { type: 'image/png' });
        abrirVistaPrevia(canvas, blob, archivo, d);
    }

    // ------------------------------------------
    // Vista previa de la imagen
    // ------------------------------------------

    let urlPrevia = null;

    function abrirVistaPrevia(canvas, blob, archivo, d) {
        let dialogo = $('compartirDialogo');
        if (!dialogo) {
            dialogo = document.createElement('dialog');
            dialogo.id = 'compartirDialogo';
            dialogo.className = 'compartir-dialogo';
            dialogo.setAttribute('aria-labelledby', 'compartirDialogoTitulo');
            dialogo.innerHTML = `
                <div class="compartir-dialogo-cabecera">
                    <h3 id="compartirDialogoTitulo">Imagen para compartir</h3>
                    <button type="button" class="compartir-cerrar" aria-label="Cerrar">✕</button>
                </div>
                <img class="compartir-previa" alt="Vista previa de la tarjeta">
                <div class="compartir-dialogo-acciones"></div>`;
            dialogo.querySelector('.compartir-cerrar').addEventListener('click', () => dialogo.close());
            // Click en el fondo cierra
            dialogo.addEventListener('click', e => { if (e.target === dialogo) dialogo.close(); });
            dialogo.addEventListener('close', () => {
                if (urlPrevia) URL.revokeObjectURL(urlPrevia);
                urlPrevia = null;
            });
            document.body.appendChild(dialogo);
        }

        if (urlPrevia) URL.revokeObjectURL(urlPrevia);
        urlPrevia = URL.createObjectURL(blob);
        dialogo.querySelector('.compartir-previa').src = urlPrevia;

        const acciones = dialogo.querySelector('.compartir-dialogo-acciones');
        acciones.innerHTML = '';
        const boton = (etiqueta, principal, accion) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = principal ? 'compartir-btn compartir-btn-principal' : 'compartir-btn';
            b.textContent = etiqueta;
            b.addEventListener('click', accion);
            acciones.appendChild(b);
        };

        const puedeCompartir = navigator.canShare && navigator.canShare({ files: [archivo] });
        if (puedeCompartir) {
            boton('Compartir', true, async () => {
                try {
                    await navigator.share({ files: [archivo], title: `FinanceAR · ${d.tarjeta.seccion}`, text: d.link });
                } catch (e) { /* cancelado */ }
            });
        }
        boton('Descargar', !puedeCompartir, () => {
            const a = document.createElement('a');
            a.href = urlPrevia;
            a.download = archivo.name;
            a.click();
        });
        if (navigator.clipboard && window.ClipboardItem) {
            boton('Copiar imagen', false, async () => {
                try {
                    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
                    avisar('✓ Imagen copiada');
                } catch (e) {
                    avisar('No se pudo copiar la imagen; usá Descargar');
                }
            });
        }

        if (!dialogo.open) dialogo.showModal();
    }

    // ------------------------------------------
    // Menú
    // ------------------------------------------

    let menu = null;
    let botonActivo = null;
    let sinMontos = false;

    function cerrarMenu() {
        if (!menu || menu.hidden) return;
        menu.hidden = true;
        if (botonActivo) botonActivo.setAttribute('aria-expanded', 'false');
        document.removeEventListener('click', clickAfuera, true);
        document.removeEventListener('keydown', teclaMenu, true);
    }

    function clickAfuera(e) {
        if (menu.contains(e.target) || e.target === botonActivo) return;
        cerrarMenu();
    }

    function teclaMenu(e) {
        if (e.key === 'Escape') {
            cerrarMenu();
            if (botonActivo) botonActivo.focus();
            return;
        }
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
        const items = Array.from(menu.querySelectorAll('[role^="menuitem"]'));
        const i = items.indexOf(document.activeElement);
        e.preventDefault();
        const siguiente = e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
        items[siguiente].focus();
    }

    function crearMenu() {
        menu = document.createElement('div');
        menu.className = 'compartir-menu';
        menu.setAttribute('role', 'menu');
        menu.hidden = true;
        menu.innerHTML = `
            <button type="button" role="menuitem" data-accion="imagen"><span aria-hidden="true">🖼️</span> Imagen<small>Tarjeta para redes y chats</small></button>
            <button type="button" role="menuitem" data-accion="link"><span aria-hidden="true">🔗</span> Link<small>Abre este mismo cálculo</small></button>
            <button type="button" role="menuitem" data-accion="texto"><span aria-hidden="true">📝</span> Texto<small>Resumen corto con el link</small></button>
            <label class="compartir-ocultar" role="menuitemcheckbox" aria-checked="false" tabindex="-1">
                <input type="checkbox" tabindex="-1"> Ocultar montos
            </label>`;
        const check = menu.querySelector('.compartir-ocultar input');
        const etiquetaCheck = menu.querySelector('.compartir-ocultar');
        check.addEventListener('change', () => {
            sinMontos = check.checked;
            etiquetaCheck.setAttribute('aria-checked', String(sinMontos));
        });
        etiquetaCheck.addEventListener('keydown', e => {
            if (e.key === ' ' || e.key === 'Enter') {
                e.preventDefault();
                check.click();
            }
        });
        menu.addEventListener('click', e => {
            const item = e.target.closest('button[data-accion]');
            if (!item) return;
            const formId = menu.dataset.form;
            cerrarMenu();
            const accion = { imagen: compartirImagen, link: compartirLink, texto: compartirTexto }[item.dataset.accion];
            conDatos(accion)(formId, sinMontos);
        });
        document.body.appendChild(menu);
    }

    function abrir(formId, boton) {
        if (!menu) crearMenu();
        if (!menu.hidden && botonActivo === boton) {
            cerrarMenu();
            return;
        }
        cerrarMenu();
        botonActivo = boton;
        menu.dataset.form = formId;
        menu.querySelector('.compartir-ocultar').hidden = !tieneMontos(formId);
        menu.hidden = false;
        boton.setAttribute('aria-expanded', 'true');

        // Debajo del botón; si no entra, arriba
        const r = boton.getBoundingClientRect();
        const ancho = menu.offsetWidth, alto = menu.offsetHeight;
        let left = Math.min(r.left, window.innerWidth - ancho - 12);
        let top = r.bottom + 6;
        if (top + alto > window.innerHeight - 12) top = r.top - alto - 6;
        menu.style.left = `${Math.max(12, left) + window.scrollX}px`;
        menu.style.top = `${Math.max(12, top) + window.scrollY}px`;

        document.addEventListener('click', clickAfuera, true);
        document.addEventListener('keydown', teclaMenu, true);
        const primero = menu.querySelector('[role="menuitem"]');
        if (primero) primero.focus();
    }

    // ------------------------------------------
    // Botones en las pestañas sin formulario
    // ------------------------------------------

    // Pestaña -> dónde va el botón (junto a "Exportar gráfico" o al pie del resultado)
    const BOTONES_PESTANAS = {
        riesgopais: '#riesgopais .chart-toolbar',
        ipc: '#ipc .chart-toolbar',
        'dolar-vs-ipc': '#dolar-vs-ipc .chart-toolbar',
        'calc-inflacion': '#calcInfResumenBox'
    };

    function crearBotonesPestanas() {
        Object.entries(BOTONES_PESTANAS).forEach(([id, selector]) => {
            const destino = document.querySelector(selector);
            if (!destino || destino.querySelector('.btn-compartir')) return;
            const boton = document.createElement('button');
            boton.type = 'button';
            boton.className = 'btn-refresh btn-compartir';
            boton.setAttribute('aria-haspopup', 'menu');
            boton.setAttribute('aria-expanded', 'false');
            boton.textContent = 'Compartir';
            boton.addEventListener('click', () => abrir(id, boton));
            destino.appendChild(boton);
        });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', crearBotonesPestanas);
    else crearBotonesPestanas();

    window.pfCompartir = {
        soporta: formId => Object.prototype.hasOwnProperty.call(COMPARTIBLES, formId),
        abrir,
        dibujarTarjeta // expuesto para pruebas y para las próximas pestañas
    };
})();
