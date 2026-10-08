// ==========================================
// CAPA DE UX
// ==========================================
// - Inputs de dinero con formato es-AR mientras se escribe ($ 1.234.567,89)
// - Prefijos / sufijos visuales ($, US$, %, días) y chips de plazos típicos
// - Cálculo en vivo (sin botón "Calcular") y validación inline
// - Resultado al costado del formulario en desktop, con el número principal destacado
// - Valores recordados en localStorage y parámetros compartibles en la URL
//
// Los cálculos siguen viviendo en los handlers "submit" de index.html: esta capa
// solo decide cuándo dispararlos y cómo mostrar el estado.

(function () {
    'use strict';
    /* global agregarFilaComparador, filaComparadorContador */

    const STORAGE_KEY = 'pfcalc:v1';

    // Formulario -> contenedor de resultados
    const FORMULARIOS = {
        calculatorForm: 'results',
        caucionesForm: 'resultsCaucion',
        accionesForm: 'resultsAcciones',
        dolaresForm: 'resultsDolares',
        tnaForm: 'resultsTNA',
        comparadorForm: 'resultsComparador'
    };

    // Formularios que se muestran con el resultado al costado (en pantallas anchas)
    const LADO_A_LADO = ['calculatorForm', 'caucionesForm', 'accionesForm', 'dolaresForm', 'tnaForm'];

    // Campos sueltos (fuera de un <form>) que también se recuerdan
    const CAMPOS_SUELTOS = ['calcInfDesde', 'calcInfHasta', 'calcInfMonto'];

    const texto = id => {
        const el = document.getElementById(id);
        return el ? el.textContent.trim() : '';
    };

    // Número principal de cada calculadora
    const DESTACADOS = {
        calculatorForm: () => ({
            etiqueta: 'Ganás',
            valor: texto('intereses'),
            detalle: `Capital final ${texto('capitalFinal')} · ${texto('rendimientoTotal')} en el período`
        }),
        caucionesForm: () => ({
            etiqueta: 'Interés neto',
            valor: texto('interesesNetos'),
            detalle: `TNA efectiva ${texto('tnaEfectiva')} · Capital final ${texto('capitalFinalCaucion')}`
        }),
        accionesForm: () => ({
            etiqueta: 'Costo total',
            valor: texto('costoTotalOperacion'),
            detalle: `Gastos ${texto('totalCostosAcciones')} (${texto('porcentajeCostos')} sobre el valor)`
        }),
        dolaresForm: () => {
            const op = document.getElementById('operacionTipo').value;
            if (op === 'comprar') {
                return { etiqueta: 'Recibís', valor: texto('dolaresRecibidos'), detalle: `A ${texto('cotizacionAplicada')} por dólar` };
            }
            if (op === 'comprar-objetivo') {
                return { etiqueta: 'Necesitás', valor: texto('pesosNecesarios'), detalle: `A ${texto('cotizacionAplicadaObjetivo')} por dólar` };
            }
            return { etiqueta: 'Recibís', valor: texto('pesosRecibidos'), detalle: `A ${texto('cotizacionAplicadaVenta')} por dólar` };
        },
        tnaForm: () => ({
            etiqueta: 'TNA',
            valor: texto('tnaResult'),
            detalle: `TEA ${texto('teaResult')} · Rendimiento del período ${texto('rendimientoPeriodoTNA')}`
        })
    };

    // ------------------------------------------
    // Números
    // ------------------------------------------

    // Interpreta un texto según el formato del campo.
    // money: es-AR ("1.234.567,89"). Sin coma, "1.500" se toma como mil quinientos
    //        y "12.5" / "12.50" como decimales.
    // pct:   sin separador de miles; "2.705" y "2,705" valen lo mismo.
    function parsearNumero(valor, fmt) {
        if (valor === null || valor === undefined) return NaN;
        let s = String(valor).replace(/US\$|\$|%|\s/g, '');
        if (!s) return NaN;

        if (fmt === 'money') {
            if (s.includes(',')) {
                s = s.replace(/\./g, '').replace(',', '.');
            } else if (!/^-?\d+\.\d{1,2}$/.test(s)) {
                // Sin coma: un único punto con 1 o 2 decimales es decimal ("12.5");
                // cualquier otro punto es separador de miles ("1.500", "1.234.567")
                s = s.replace(/\./g, '');
            }
        } else {
            s = s.replace(',', '.');
        }
        return s === '' || s === '-' ? NaN : Number(s);
    }

    // Lee el valor numérico de un input (por id o elemento). Lo usan los cálculos de index.html.
    function leerNumero(campo) {
        const el = typeof campo === 'string' ? document.getElementById(campo) : campo;
        if (!el) return NaN;
        if (el.dataset && el.dataset.fmt) return parsearNumero(el.value, el.dataset.fmt);
        return parseFloat(el.value);
    }

    function formatearMonto(n) {
        return n.toLocaleString('es-AR', { maximumFractionDigits: 2 });
    }

    function formatearPorcentaje(n) {
        return n.toLocaleString('es-AR', { maximumFractionDigits: 6, useGrouping: false });
    }

    // Reformatea un campo de dinero mientras se escribe, manteniendo el cursor
    // en el mismo dígito.
    function formatearMientrasEscribe(el, evento) {
        let s = el.value;
        let cursor = el.selectionStart ?? s.length;

        // En el teclado numérico el punto es el decimal: lo convertimos en coma
        if (evento && evento.inputType === 'insertText' && evento.data === '.') {
            const antes = s.slice(0, cursor - 1);
            const despues = s.slice(cursor);
            if (s.slice(0, cursor - 1).includes(',') || despues.includes(',')) {
                s = antes + despues;
                cursor -= 1;
            } else {
                s = antes + ',' + despues;
            }
        }

        const esSignificativo = c => /[\d,]/.test(c);
        let significativosAntes = 0;
        for (let i = 0; i < cursor; i++) if (esSignificativo(s[i])) significativosAntes++;

        const limpio = s.replace(/[^\d,]/g, '');
        const coma = limpio.indexOf(',');
        let entero = coma >= 0 ? limpio.slice(0, coma) : limpio;
        const decimales = coma >= 0 ? limpio.slice(coma + 1).replace(/,/g, '').slice(0, 2) : null;

        entero = entero.replace(/^0+(?=\d)/, '');
        if (entero === '' && decimales !== null) {
            entero = '0';
            significativosAntes++;
        }
        const salida = entero.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + (decimales !== null ? ',' + decimales : '');

        if (salida === el.value) return;
        el.value = salida;

        let pos = 0;
        let vistos = 0;
        while (pos < salida.length && vistos < significativosAntes) {
            if (esSignificativo(salida[pos])) vistos++;
            pos++;
        }
        if (document.activeElement === el) el.setSelectionRange(pos, pos);
    }

    function asignarValor(el, valor) {
        if (el.dataset.fmt === 'money') {
            const n = parsearNumero(valor, 'money');
            el.value = Number.isFinite(n) ? formatearMonto(n) : '';
        } else if (el.dataset.fmt === 'pct') {
            const n = parsearNumero(valor, 'pct');
            el.value = Number.isFinite(n) ? formatearPorcentaje(n) : '';
        } else {
            el.value = valor;
        }
    }

    // ------------------------------------------
    // Mejoras de cada input: prefijo/sufijo, chips, formato
    // ------------------------------------------

    function mejorarInput(el) {
        if (el.dataset.uxListo) return;
        el.dataset.uxListo = '1';

        if (el.dataset.prefix || el.dataset.suffix) {
            const envoltorio = document.createElement('div');
            envoltorio.className = 'input-affix';
            el.parentNode.insertBefore(envoltorio, el);
            if (el.dataset.prefix) {
                const pre = document.createElement('span');
                pre.className = 'affix affix-pre';
                pre.textContent = el.dataset.prefix;
                envoltorio.appendChild(pre);
                envoltorio.classList.add('con-prefijo');
                envoltorio.style.setProperty('--affix-pre-ch', String(el.dataset.prefix.length));
            }
            envoltorio.appendChild(el);
            if (el.dataset.suffix) {
                const suf = document.createElement('span');
                suf.className = 'affix affix-suf';
                suf.textContent = el.dataset.suffix;
                envoltorio.appendChild(suf);
                envoltorio.classList.add('con-sufijo');
                envoltorio.style.setProperty('--affix-suf-ch', String(el.dataset.suffix.length));
            }
        }

        if (el.dataset.chips) {
            const fila = document.createElement('div');
            fila.className = 'chips';
            el.dataset.chips.split(',').forEach(v => {
                const chip = document.createElement('button');
                chip.type = 'button';
                chip.className = 'chip';
                chip.textContent = v;
                chip.dataset.valor = v;
                chip.addEventListener('click', () => {
                    el.value = v;
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                });
                fila.appendChild(chip);
            });
            const ancla = el.closest('.input-affix') || el;
            ancla.insertAdjacentElement('afterend', fila);
            el.addEventListener('input', () => marcarChipActivo(el));
        }

        if (el.dataset.fmt === 'money') {
            if (el.value) asignarValor(el, el.value);
            el.addEventListener('input', e => formatearMientrasEscribe(el, e));
            el.addEventListener('paste', e => {
                const pegado = (e.clipboardData || window.clipboardData).getData('text');
                const n = parsearNumero(pegado, 'money');
                if (!Number.isFinite(n)) return;
                e.preventDefault();
                el.value = formatearMonto(n);
                el.dispatchEvent(new Event('input', { bubbles: true }));
            });
        } else if (el.dataset.fmt === 'pct') {
            if (el.value) asignarValor(el, el.value);
            el.addEventListener('blur', () => {
                if (el.value.trim() && Number.isFinite(leerNumero(el))) asignarValor(el, el.value);
            });
        }

        el.addEventListener('blur', () => {
            el.dataset.tocado = '1';
            validarCampo(el);
        });
    }

    function marcarChipActivo(el) {
        const fila = (el.closest('.input-affix') || el).nextElementSibling;
        if (!fila || !fila.classList.contains('chips')) return;
        fila.querySelectorAll('.chip').forEach(c => c.classList.toggle('active', c.dataset.valor === el.value.trim()));
    }

    function mejorarTodo(raiz) {
        raiz.querySelectorAll('input[data-fmt], input[data-prefix], input[data-suffix], input[data-chips]').forEach(mejorarInput);
    }

    // ------------------------------------------
    // Validación inline
    // ------------------------------------------

    // Un campo está "oculto" si alguna sección entre él y su formulario está con display:none
    // (las secciones condicionales se alternan con style.display). La pestaña inactiva no cuenta.
    function estaOculto(el, form) {
        for (let n = el; n && n !== form; n = n.parentElement) {
            if (n.style && n.style.display === 'none') return true;
            if (n.hidden) return true;
        }
        return false;
    }

    function errorDeCampo(el) {
        const v = el.value.trim();
        if (!v) return el.required ? 'vacio' : null;
        if (el.type === 'text' && !el.dataset.fmt) return null;
        if (el.tagName === 'SELECT') return null;

        const n = leerNumero(el);
        if (!Number.isFinite(n)) return 'Ingresá un número válido.';
        const min = el.dataset.min ?? el.getAttribute('min');
        const max = el.dataset.max ?? el.getAttribute('max');
        if (min !== null && min !== undefined && n < Number(min)) {
            return Number(min) > 0 ? 'Tiene que ser mayor a 0.' : 'No puede ser negativo.';
        }
        if (max !== null && max !== undefined && n > Number(max)) {
            return `El máximo es ${formatearPorcentaje(Number(max))}.`;
        }
        return null;
    }

    function validarCampo(el) {
        const form = el.form;
        const error = form && estaOculto(el, form) ? null : errorDeCampo(el);
        const mostrar = error && error !== 'vacio' && el.dataset.tocado ? error : null;

        const grupo = el.closest('.form-group') || el.parentElement;
        let msg = grupo.querySelector(':scope > .field-error');
        if (mostrar) {
            if (!msg) {
                msg = document.createElement('div');
                msg.className = 'field-error';
                msg.id = (el.id || 'campo') + '-error';
                grupo.appendChild(msg);
            }
            msg.textContent = mostrar;
            el.setAttribute('aria-invalid', 'true');
            el.setAttribute('aria-describedby', msg.id);
        } else {
            if (msg) msg.remove();
            el.removeAttribute('aria-invalid');
            el.removeAttribute('aria-describedby');
        }
        return !error;
    }

    function formularioListo(form) {
        let listo = true;
        form.querySelectorAll('input, select').forEach(el => {
            if (el.type === 'button' || el.type === 'submit') return;
            if (!validarCampo(el)) listo = false;
        });
        return listo;
    }

    // ------------------------------------------
    // Cálculo en vivo
    // ------------------------------------------

    const pendientes = {};

    function programarRecalculo(formId, demora) {
        clearTimeout(pendientes[formId]);
        pendientes[formId] = setTimeout(() => recalcular(formId), demora);
    }

    function recalcular(formId) {
        const form = document.getElementById(formId);
        const resultados = document.getElementById(FORMULARIOS[formId]);
        if (!form || !resultados) return;

        form.dataset.mensaje = '';
        resultados.style.display = 'none';

        if (formularioListo(form)) {
            form.dispatchEvent(new Event('submit', { cancelable: true }));
        }

        const hayResultado = resultados.style.display !== 'none';
        if (hayResultado) actualizarDestacado(formId, resultados);

        const columna = resultados.closest('.calc-result-col') || resultados.parentElement;
        const vacio = columna.querySelector('.results-empty');
        if (vacio) {
            vacio.hidden = hayResultado;
            vacio.textContent = form.dataset.mensaje || 'Completá los datos para ver el resultado.';
        }
        const acciones = columna.querySelector('.results-actions');
        if (acciones) acciones.hidden = !hayResultado;
    }

    function actualizarDestacado(formId, resultados) {
        const generador = DESTACADOS[formId];
        if (!generador) return;
        let hero = resultados.querySelector(':scope > .result-hero');
        if (!hero) {
            hero = document.createElement('div');
            hero.className = 'result-hero';
            // Solo el número principal se anuncia en lectores de pantalla (no toda la tabla)
            hero.setAttribute('aria-live', 'polite');
            hero.setAttribute('aria-atomic', 'true');
            hero.innerHTML = '<span class="result-hero-label"></span><span class="result-hero-value"></span><span class="result-hero-detail"></span>';
            resultados.prepend(hero);
        }
        const { etiqueta, valor, detalle } = generador();
        hero.querySelector('.result-hero-label').textContent = etiqueta;
        hero.querySelector('.result-hero-value').textContent = valor;
        hero.querySelector('.result-hero-detail').textContent = detalle;
    }

    // ------------------------------------------
    // Layout: formulario + resultado
    // ------------------------------------------

    function armarLayout(formId) {
        const form = document.getElementById(formId);
        const resultados = document.getElementById(FORMULARIOS[formId]);
        if (!form || !resultados) return;

        const columna = document.createElement('div');
        columna.className = 'calc-result-col';

        const vacio = document.createElement('div');
        vacio.className = 'results-empty';
        vacio.setAttribute('aria-live', 'polite');
        vacio.textContent = 'Completá los datos para ver el resultado.';

        const acciones = document.createElement('div');
        acciones.className = 'results-actions';
        acciones.hidden = true;
        if (formId !== 'comparadorForm') {
            const compartir = document.createElement('button');
            compartir.type = 'button';
            compartir.className = 'btn-refresh';
            compartir.textContent = 'Copiar link a este cálculo';
            compartir.addEventListener('click', () => copiarLink(formId, compartir));
            acciones.appendChild(compartir);
        }

        if (LADO_A_LADO.includes(formId)) {
            const layout = document.createElement('div');
            layout.className = 'calc-layout';
            form.parentNode.insertBefore(layout, form);
            layout.appendChild(form);
            layout.appendChild(columna);
        } else {
            resultados.parentNode.insertBefore(columna, resultados);
        }
        columna.appendChild(vacio);
        columna.appendChild(resultados);
        if (acciones.childElementCount) columna.appendChild(acciones);
        if (!DESTACADOS[formId]) resultados.setAttribute('aria-live', 'polite');
    }

    // ------------------------------------------
    // Persistencia (localStorage) y links compartibles (#tab?campo=valor)
    // ------------------------------------------

    function leerGuardado() {
        try {
            return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
        } catch (e) {
            return {};
        }
    }

    function escribirGuardado(datos) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(datos));
        } catch (e) {
            // Modo privado o almacenamiento bloqueado: se sigue funcionando sin recordar valores
        }
    }

    function camposPersistibles() {
        const campos = [];
        Object.keys(FORMULARIOS).forEach(formId => {
            const form = document.getElementById(formId);
            if (!form) return;
            form.querySelectorAll('input[id], select[id]').forEach(el => {
                if (!el.closest('#filasComparador')) campos.push(el);
            });
        });
        CAMPOS_SUELTOS.forEach(id => {
            const el = document.getElementById(id);
            if (el) campos.push(el);
        });
        return campos;
    }

    function leerFilasComparador() {
        return Array.from(document.querySelectorAll('#filasComparador .fila-opcion')).map(fila => {
            const id = fila.id.replace('filaComparador', '');
            const valores = {};
            fila.querySelectorAll('input[id], select[id]').forEach(el => {
                valores[el.id.slice(0, -id.length)] = el.value;
            });
            return valores;
        });
    }

    let guardadoPendiente = null;
    function programarGuardado() {
        clearTimeout(guardadoPendiente);
        guardadoPendiente = setTimeout(() => {
            const datos = { campos: {} };
            camposPersistibles().forEach(el => {
                if (el.value !== '') datos.campos[el.id] = el.value;
            });
            if (document.querySelector('#filasComparador .fila-opcion')) {
                datos.comparador = leerFilasComparador();
            } else {
                const anterior = leerGuardado();
                if (anterior.comparador) datos.comparador = anterior.comparador;
            }
            escribirGuardado(datos);
        }, 300);
    }

    // Selects que se llenan después (bancos, meses del IPC): el valor guardado
    // se aplica cuando aparecen las opciones.
    const seleccionPendiente = {};

    function aplicarValor(el, valor) {
        if (el.tagName === 'SELECT') {
            const existe = Array.from(el.options).some(o => o.value === valor);
            if (!existe) {
                seleccionPendiente[el.id] = valor;
                return;
            }
            if (el.value === valor) return;
            el.value = valor;
            el.dispatchEvent(new Event('change', { bubbles: true }));
        } else {
            asignarValor(el, valor);
            if (el.id === 'tasaCaucion') el.dataset.manual = '1';
            marcarChipActivo(el);
        }
    }

    // Primero los selects (sus onchange muestran u ocultan secciones y algunos limpian
    // inputs), después los inputs.
    function aplicarValores(valores) {
        const ids = Object.keys(valores);
        const elementos = ids.map(id => document.getElementById(id)).filter(Boolean);
        elementos.filter(el => el.tagName === 'SELECT').forEach(el => aplicarValor(el, valores[el.id]));
        elementos.filter(el => el.tagName !== 'SELECT').forEach(el => aplicarValor(el, valores[el.id]));
    }

    function observarSelectsPendientes() {
        const observador = new MutationObserver(registros => {
            registros.forEach(r => {
                const el = r.target;
                if (el.tagName !== 'SELECT' || !(el.id in seleccionPendiente)) return;
                const valor = seleccionPendiente[el.id];
                if (Array.from(el.options).some(o => o.value === valor)) {
                    delete seleccionPendiente[el.id];
                    // Se aplica después de que el código que llenó el select termine su propio flujo
                    setTimeout(() => {
                        el.value = valor;
                        el.dispatchEvent(new Event('change', { bubbles: true }));
                    }, 0);
                }
            });
        });
        observador.observe(document.body, { childList: true, subtree: true });
    }

    function leerParametrosUrl() {
        const hash = window.location.hash.substring(1);
        const i = hash.indexOf('?');
        if (i < 0) return null;
        return { tab: hash.slice(0, i), params: new URLSearchParams(hash.slice(i + 1)) };
    }

    function copiarLink(formId, boton) {
        const form = document.getElementById(formId);
        const tab = form.closest('.tab-content').id;
        const params = new URLSearchParams();
        form.querySelectorAll('input[id], select[id]').forEach(el => {
            if (estaOculto(el, form) || el.value === '' || el.disabled) return;
            params.set(el.id, el.dataset.fmt ? String(leerNumero(el)) : el.value);
        });
        const url = `${location.origin}${location.pathname}#${tab}?${params.toString()}`;

        const listo = () => {
            const original = boton.textContent;
            boton.textContent = '✓ Link copiado';
            setTimeout(() => { boton.textContent = original; }, 2000);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(url).then(listo, () => window.prompt('Copiá este link:', url));
        } else {
            window.prompt('Copiá este link:', url);
        }
    }

    function restaurarComparador() {
        const guardado = leerGuardado().comparador;
        if (!Array.isArray(guardado) || guardado.length === 0) return false;

        guardado.forEach(fila => {
            agregarFilaComparador(fila.tipoInstrumentoComp || 'caucion');
            // filaComparadorContador es un "let" global de index.html (no cuelga de window)
            const id = filaComparadorContador;
            const sufijo = base => document.getElementById(base + id);
            ['capitalizacionComp', 'tipoComisionComp'].forEach(base => {
                const el = sufijo(base);
                if (el && fila[base] !== undefined && el.value !== fila[base]) {
                    el.value = fila[base];
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                }
            });
            Object.keys(fila).forEach(base => {
                const el = sufijo(base);
                if (el && el.tagName !== 'SELECT') asignarValor(el, fila[base]);
            });
        });
        return true;
    }

    // ------------------------------------------
    // Inicio
    // ------------------------------------------

    function iniciar() {
        mejorarTodo(document);

        // Inputs agregados después (filas del comparador). Cualquier fila que entra o
        // sale (incluida la carga inicial al abrir la pestaña) dispara un recálculo.
        new MutationObserver(registros => {
            registros.forEach(r => r.addedNodes.forEach(n => {
                if (n.nodeType === 1) {
                    mejorarTodo(n);
                    asociarLabels(n);
                }
            }));
            programarRecalculo('comparadorForm', 0);
        }).observe(document.getElementById('filasComparador'), { childList: true, subtree: true });

        Object.keys(FORMULARIOS).forEach(armarLayout);
        observarSelectsPendientes();

        // Valores de la visita anterior, y encima los del link compartido
        const guardado = leerGuardado();
        if (guardado.campos) aplicarValores(guardado.campos);
        const compartido = leerParametrosUrl();
        if (compartido) {
            const valores = {};
            compartido.params.forEach((v, k) => { valores[k] = v; });
            aplicarValores(valores);
        }

        Object.keys(FORMULARIOS).forEach(formId => {
            const form = document.getElementById(formId);
            if (!form) return;
            form.addEventListener('input', () => {
                programarRecalculo(formId, 200);
                programarGuardado();
            });
            form.addEventListener('change', () => {
                programarRecalculo(formId, 0);
                programarGuardado();
            });
            if (formId === 'comparadorForm') {
                form.addEventListener('click', e => {
                    if (e.target.closest('.btn-agregar-fila, .btn-quitar-fila')) {
                        programarRecalculo(formId, 0);
                        programarGuardado();
                    }
                });
            }
        });
        CAMPOS_SUELTOS.forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.addEventListener('input', programarGuardado);
                el.addEventListener('change', programarGuardado);
            }
        });

        // El hash (#plazo-fijo) coincide con el id de la pestaña y el navegador salta
        // hasta ahí al cargar. En mobile eso escondía los indicadores y la navegación:
        // si la persona todavía no tocó nada, volvemos arriba.
        let interactuo = false;
        ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach(tipo =>
            window.addEventListener(tipo, () => { interactuo = true; }, { once: true, passive: true }));
        window.addEventListener('load', () => {
            if (!interactuo && window.scrollY > 0) window.scrollTo(0, 0);
        });

        // Primer cálculo, después de que index.html termine su propio arranque
        document.addEventListener('DOMContentLoaded', () => {
            Object.keys(FORMULARIOS).forEach(formId => recalcular(formId));
        });
    }

    window.leerNumero = leerNumero;
    // ------------------------------------------
    // Tema claro / oscuro
    // ------------------------------------------

    const TEMA_KEY = 'pfcalc:tema';
    const TEMAS = ['auto', 'dark', 'light'];
    const NOMBRE_TEMA = { auto: 'Auto', dark: 'Oscuro', light: 'Claro' };

    function temaGuardado() {
        try {
            const v = localStorage.getItem(TEMA_KEY);
            return TEMAS.includes(v) ? v : 'auto';
        } catch (e) {
            return 'auto';
        }
    }

    // Chart.js no lee CSS: le pasamos los colores del tema y redibujamos los gráficos
    function actualizarColoresGraficos() {
        if (typeof Chart === 'undefined') return;
        const css = getComputedStyle(document.documentElement);
        Chart.defaults.color = css.getPropertyValue('--text-body').trim();
        Chart.defaults.borderColor = css.getPropertyValue('--border-light').trim();
        /* global chartIPCInstance, chartRiesgoPaisInstance, renderGraficoIPC, renderGraficoRiesgoPais */
        if (typeof chartIPCInstance !== 'undefined' && chartIPCInstance) renderGraficoIPC();
        if (typeof chartRiesgoPaisInstance !== 'undefined' && chartRiesgoPaisInstance) renderGraficoRiesgoPais();
    }

    function aplicarTema(tema) {
        const raiz = document.documentElement;
        if (tema === 'auto') delete raiz.dataset.theme;
        else raiz.dataset.theme = tema;

        document.querySelectorAll('[data-theme-toggle]').forEach(boton => {
            boton.textContent = `Tema: ${NOMBRE_TEMA[tema]}`;
            boton.setAttribute('aria-label', `Cambiar tema. Actual: ${NOMBRE_TEMA[tema]}`);
        });
        const oscuro = getComputedStyle(raiz).colorScheme === 'dark';
        const meta = document.querySelector('meta[name="theme-color"]');
        if (meta) meta.content = oscuro ? '#0e1016' : '#667eea';
        actualizarColoresGraficos();
    }

    function iniciarTema() {
        aplicarTema(temaGuardado());
        document.querySelectorAll('[data-theme-toggle]').forEach(boton => {
            boton.addEventListener('click', () => {
                const siguiente = TEMAS[(TEMAS.indexOf(temaGuardado()) + 1) % TEMAS.length];
                try { localStorage.setItem(TEMA_KEY, siguiente); } catch (e) { /* sin persistencia */ }
                aplicarTema(siguiente);
            });
        });
        if (window.matchMedia) {
            window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
                if (temaGuardado() === 'auto') aplicarTema('auto');
            });
        }
    }

    // ------------------------------------------
    // Accesibilidad de la navegación
    // ------------------------------------------

    function sincronizarNavegacion() {
        document.querySelectorAll('.tab-btn').forEach(boton => {
            if (boton.classList.contains('active')) boton.setAttribute('aria-current', 'page');
            else boton.removeAttribute('aria-current');
        });
    }

    function iniciarNavegacion() {
        // switchTab es global en index.html; lo envolvemos para mantener aria-current al día
        /* global switchTab */
        const original = switchTab;
        window.switchTab = function (tabName) {
            original(tabName);
            sincronizarNavegacion();
        };
        sincronizarNavegacion();

        // Flechas, Inicio y Fin para moverse entre las secciones
        const nav = document.querySelector('.tabs');
        nav.addEventListener('keydown', e => {
            const botones = Array.from(nav.querySelectorAll('.tab-btn'));
            const i = botones.indexOf(document.activeElement);
            if (i < 0) return;
            let destino = null;
            if (e.key === 'ArrowDown' || e.key === 'ArrowRight') destino = botones[(i + 1) % botones.length];
            else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') destino = botones[(i - 1 + botones.length) % botones.length];
            else if (e.key === 'Home') destino = botones[0];
            else if (e.key === 'End') destino = botones[botones.length - 1];
            if (!destino) return;
            e.preventDefault();
            destino.focus();
            destino.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        });
    }

    // Labels sin "for" (filas del comparador): se asocian al control de su grupo
    function asociarLabels(raiz) {
        raiz.querySelectorAll('.form-group > label:not([for])').forEach(label => {
            const control = label.parentElement.querySelector('input[id], select[id]');
            if (control) label.htmlFor = control.id;
        });
    }

    window.pfUx = { recalcular, restaurarComparador, parsearNumero };

    iniciar();
    iniciarTema();
    iniciarNavegacion();
    asociarLabels(document);
})();
