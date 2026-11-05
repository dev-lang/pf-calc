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
// { archivo, tarjeta: {...}, texto } a partir de lo que hay en pantalla.

(function () {
    'use strict';
    /* global getDiasCaucion */

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

    function armar(formId, sinMontos) {
        const datos = COMPARTIBLES[formId](sinMontos);
        datos.tarjeta.tema = temaActual();
        datos.tarjeta.fecha = hoy();
        datos.link = window.pfUx ? window.pfUx.construirLink(formId, { sinMontos }) : location.href;
        return datos;
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
            if (item.dataset.accion === 'imagen') compartirImagen(formId, sinMontos);
            else if (item.dataset.accion === 'link') compartirLink(formId, sinMontos);
            else compartirTexto(formId, sinMontos);
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

    window.pfCompartir = {
        soporta: formId => Object.prototype.hasOwnProperty.call(COMPARTIBLES, formId),
        abrir,
        dibujarTarjeta // expuesto para pruebas y para las próximas pestañas
    };
})();
