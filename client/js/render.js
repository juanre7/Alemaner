// Ficha de Resultados (§4.5). Todo el contenido del LLM se renderiza como
// TEXTO PLANO (textContent / createTextNode), nunca innerHTML.

import * as speech from './speech.js';
import { bus } from './telemetry.js';
import { getApiKey, setApiKey } from './settings.js';

const container = document.getElementById('results');

const LANG_LABELS = { es: '🇪🇸 Español', en: '🇬🇧 Inglés', fr: '🇫🇷 Francés' };

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function clear() {
  speech.stop();
  clearLoadingTimers();
  container.textContent = '';
}

// ---------------------------------------------------------------------------
// Estados
// ---------------------------------------------------------------------------

export function renderEmpty() {
  clear();
  const card = el('div', 'card result-empty fade-up');
  card.append(el('span', 'empty-icon', '🎓'));
  card.append(el('h2', null, '¿Listo para comenzar?'));
  card.append(el('p', null,
    'Escribe una frase en alemán para analizarla, o en español, inglés o francés ' +
    'para traducirla al alemán. También puedes usar las frases prediseñadas.'));
  card.append(el('span', 'ai-badge', '✦ Potenciado con Inteligencia Artificial'));
  container.append(card);
}

// Mensajes de fase durante la carga: primero el recorrido "normal" del análisis
// y, si la espera se alarga, mensajes honestos para que no parezca colgado.
const LOADING_PHASES = {
  direct: [
    'Leyendo el alemán...',
    'Desglosando cada palabra...',
    'Consultando la gramática...',
    'Anotando la pronunciación...',
    'Buscando ejemplos reales...',
    'Ordenando el vocabulario...',
    'Puliendo los últimos detalles...',
  ],
  reverse: [
    'Leyendo tu frase...',
    'Pensando la mejor forma alemana...',
    'Consultando la gramática...',
    'Anotando la pronunciación...',
    'Buscando ejemplos reales...',
    'Ordenando el vocabulario...',
    'Puliendo los últimos detalles...',
  ],
};
const LOADING_PATIENT = [
  'Esto está tardando un poco más de lo normal...',
  'El modelo sigue trabajando, no lo hemos perdido...',
  'Las frases con miga llevan su tiempo...',
];
const PATIENT_AFTER_MS = 14000; // a partir de aquí se rota el repertorio paciente
const ROTATE_EVERY_MS = 2600;

let loadingTimers = [];
function clearLoadingTimers() {
  for (const t of loadingTimers) clearInterval(t);
  loadingTimers = [];
}

export function renderLoading(opts = {}) {
  clear();
  const card = el('div', 'card result-loading fade-up');

  // Cabecera: punto latiendo + rótulo + cronómetro en vivo.
  const head = el('div', 'loading-head');
  const label = el('span', 'loading-label');
  label.append(el('span', 'loading-dot'));
  label.append(document.createTextNode('Analizando'));
  const timer = el('span', 'loading-timer', '0,0 s');
  head.append(label, timer);
  card.append(head);

  // La frase que se está analizando, para que la espera tenga contexto.
  if (opts.originalText) {
    const quoted = opts.originalText.length > 120
      ? `${opts.originalText.slice(0, 120)}…`
      : opts.originalText;
    card.append(el('p', 'loading-query', `«${quoted}»`));
  }

  // Barra de progreso asintótica: arranca rápida y se frena sin llegar al
  // final (solo el resultado real la completa; no prometemos lo que no sabemos).
  const bar = el('div', 'loading-bar');
  bar.append(el('div', 'loading-bar-fill'));
  card.append(bar);

  // Mensaje de fase rotatorio.
  const phases = LOADING_PHASES[opts.direction] || LOADING_PHASES.direct;
  const msg = el('p', 'loading-msg', phases[0]);
  msg.setAttribute('role', 'status');
  card.append(msg);

  // Esqueleto del resultado que viene: traducción grande + dos secciones.
  const skeleton = el('div', 'skeleton');
  skeleton.setAttribute('aria-hidden', 'true');
  skeleton.append(el('div', 'skel-line skel-title'));
  skeleton.append(el('div', 'skel-line skel-w60'));
  const section1 = el('div', 'skel-section');
  section1.append(el('div', 'skel-line skel-head'));
  section1.append(el('div', 'skel-line'));
  section1.append(el('div', 'skel-line skel-w80'));
  const section2 = el('div', 'skel-section');
  section2.append(el('div', 'skel-line skel-head'));
  const chips = el('div', 'skel-chips');
  for (let i = 0; i < 3; i++) chips.append(el('div', 'skel-chip'));
  section2.append(chips);
  skeleton.append(section1, section2);
  card.append(skeleton);

  container.append(card);

  const t0 = performance.now();
  loadingTimers.push(setInterval(() => {
    const s = (performance.now() - t0) / 1000;
    timer.textContent = `${s.toFixed(1).replace('.', ',')} s`;
  }, 100));

  let step = 0;
  loadingTimers.push(setInterval(() => {
    if (msg.dataset.pinned) return; // el progreso real (razonamiento) manda
    step += 1;
    const pool = performance.now() - t0 > PATIENT_AFTER_MS ? LOADING_PATIENT : phases;
    msg.classList.add('msg-swap');
    setTimeout(() => {
      if (!msg.isConnected || msg.dataset.pinned) return;
      msg.textContent = pool[step % pool.length];
      msg.classList.remove('msg-swap');
    }, 180);
  }, ROTATE_EVERY_MS));
}

/** Actualiza el mensaje de la tarjeta de carga sin recrearla. El texto queda
 *  fijado: el progreso real (p. ej. tokens de razonamiento) sustituye a la
 *  rotación de mensajes decorativos. */
export function setLoadingNote(text) {
  const msg = container.querySelector('.result-loading .loading-msg');
  if (msg) {
    msg.dataset.pinned = '1';
    msg.classList.remove('msg-swap');
    msg.textContent = text;
  }
}

export function renderError(message, onRetry, opts = {}) {
  clear();
  const card = el('div', 'card result-error fade-up');
  const head = el('div', 'error-head');
  head.append(el('span', 'error-icon', '⚠️'));
  head.append(el('h2', null, 'Error de análisis'));
  card.append(head);
  card.append(el('p', null, message));

  // Cuando falta la clave API, ofrece meterla aquí mismo (§5.2, modo sin servidor).
  if (opts.needsApiKey) card.append(buildInlineKey(onRetry));

  const retry = el('button', 'btn-retry', 'Reintentar traducción');
  retry.type = 'button';
  retry.addEventListener('click', onRetry);
  card.append(retry);
  container.append(card);
}

// Reinicia la animación de "inflado/desinflado" forzando un reflow entre quitar
// y volver a poner la clase, de modo que se repita en cada intento fallido.
function pulse(node) {
  node.classList.remove('key-pulse');
  void node.offsetWidth;
  node.classList.add('key-pulse');
}

function buildInlineKey(onRetry) {
  const box = el('div', 'inline-key');
  box.append(el('p', 'inline-key-note',
    'Esta versión funciona sin servidor, así que necesita tu propia clave API para ' +
    'contactar con el modelo. Pégala aquí abajo: se guarda solo en este navegador ' +
    '(localStorage) y nunca se comparte.'));

  const row = el('div', 'inline-key-row');
  const input = el('input', 'inline-key-input');
  input.type = 'password';
  input.setAttribute('aria-label', 'Tu clave API de OpenRouter o Anthropic');
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.placeholder = 'sk-or-... / sk-ant-...';
  input.value = getApiKey();

  const save = el('button', 'btn-primary inline-key-save', 'Guardar y reintentar');
  save.type = 'button';

  const status = el('p', 'inline-key-status');
  status.setAttribute('role', 'status');

  const submit = () => {
    const value = input.value.trim();
    if (!value) {
      status.textContent = 'Escribe tu clave para continuar.';
      pulse(box);
      input.focus();
      return;
    }
    setApiKey(value);
    onRetry?.();
  };

  save.addEventListener('click', submit);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });

  row.append(input, save);
  box.append(row, status);

  // Cada vez que se renderiza el error (p. ej. al reintentar sin clave) el
  // apartado se infla y desinfla rápido para llamar la atención.
  requestAnimationFrame(() => pulse(box));
  return box;
}

// ---------------------------------------------------------------------------
// Resultado (completo o parcial durante streaming)
// ---------------------------------------------------------------------------

/**
 * @param {object} opts
 *  - analysis: objeto del contrato §6 (posiblemente parcial en streaming)
 *  - originalText: texto de entrada del usuario
 *  - elapsed: ms de la consulta (solo en resultado final)
 *  - partial: true durante el streaming
 *  - onAlternative(text): clic en un chip de alternativa
 */
export function renderResult({ analysis, originalText, elapsed, partial, onAlternative }) {
  clear();

  // Palabra inexistente: ficha corta con la explicación, sin análisis.
  if (analysis.notFound?.note) {
    const card = el('div', `card result-notfound ${partial ? '' : 'fade-up'}`);
    card.append(el('span', 'notfound-icon', '❓'));
    card.append(el('h2', null, 'Palabra no reconocida'));
    if (originalText) card.append(el('p', 'original-text', originalText));
    card.append(el('p', 'notfound-note', analysis.notFound.note));
    container.append(card);
    if (!partial) bus.emit('phase', { name: 'Render', t: null });
    return;
  }

  const card = el('div', `card result ${partial ? '' : 'fade-up'}`);

  // Encabezado
  const head = el('div', 'result-head');
  if (partial) {
    head.append(el('span', 'elapsed', 'Recibiendo análisis...'));
  } else {
    head.append(el('span', 'done-badge', '✓ Análisis completado'));
    if (typeof elapsed === 'number') {
      head.append(el('span', 'elapsed', `${(elapsed / 1000).toFixed(2)}s`));
    }
  }
  card.append(head);

  // Aviso de corrección ortográfica: el análisis se refiere a la palabra corregida.
  const fix = analysis.correction;
  if (fix && fix.corrected) {
    const box = el('div', 'correction-box');
    box.append(el('span', 'correction-icon', '✏️'));
    const body = el('div');
    const title = el('p', 'correction-title');
    title.append(document.createTextNode(`«${fix.original || originalText}» no parece existir. Analizando `));
    title.append(el('strong', null, fix.corrected));
    title.append(document.createTextNode(':'));
    body.append(title);
    if (fix.note) body.append(el('p', 'correction-note', fix.note));
    box.append(body);
    card.append(box);
  }

  // Traducción + audio
  if (analysis.translation) {
    if (originalText) card.append(el('p', 'original-text', originalText));
    const row = el('div', 'translation-row');
    row.append(el('p', 'translation-main', analysis.translation));

    // La frase ALEMANA es la entrada (dirección directa) o la traducción (inversa).
    // Si hubo corrección ortográfica, se pronuncia la forma corregida.
    const germanText = analysis.detectedLang === 'de'
      ? (analysis.correction?.corrected || originalText)
      : analysis.translation;
    if (speech.isSupported() && germanText) {
      const audioBtn = el('button', 'btn-audio', '📢');
      audioBtn.type = 'button';
      audioBtn.setAttribute('aria-label', 'Escuchar pronunciación alemana');
      audioBtn.addEventListener('click', () => {
        if (audioBtn.classList.contains('speaking')) {
          speech.stop();
        } else {
          speech.speak(germanText, (speaking) => {
            audioBtn.classList.toggle('speaking', speaking);
          });
        }
      });
      row.append(audioBtn);
    }
    card.append(row);
  }

  // Traducción simultánea ES/EN/FR con matices (solo entrada alemana)
  const translations = (analysis.translations || []).filter((t) => t && t.text && LANG_LABELS[t.lang]);
  if (translations.length) {
    const section = makeSection(card, '🌍', 'Traducción simultánea');
    const list = el('div', 'multi-trans');
    list.append(...translations.map((t) => {
      const item = el('div', 'mt-item');
      const head = el('div', 'mt-head');
      head.append(el('span', 'mt-lang', LANG_LABELS[t.lang]));
      head.append(el('span', 'mt-text', t.text));
      item.append(head);
      if (t.note) item.append(el('p', 'mt-note', t.note));
      return item;
    }));
    section.append(list);
  }

  // Pronunciación
  if (analysis.pronunciation) {
    const section = makeSection(card, '👂', 'Pronunciación');
    const box = el('div', 'pron-box');
    box.append(el('span', 'pron-icon', '👂'));
    box.append(el('span', null, analysis.pronunciation));
    section.append(box);
  }

  // Explicación gramatical
  const notes = (analysis.grammarNotes || []).filter((n) => typeof n === 'string' && n.trim());
  if (notes.length) {
    const section = makeSection(card, '📖', 'Explicación gramatical');
    const list = el('ul', 'grammar-list');
    list.append(...notes.map((note) => el('li', null, note)));
    section.append(list);
  }

  // Vocabulario clave
  const vocab = (analysis.vocabulary || []).filter((v) => v && v.german);
  if (vocab.length) {
    const section = makeSection(card, '🗂️', 'Vocabulario clave');
    const wrap = el('div', 'vocab-table-wrap');
    const table = el('table', 'vocab-table');
    const thead = el('thead');
    const headRow = el('tr');
    headRow.append(...['Alemán', 'Significado', 'Categoría'].map(label => el('th', null, label)));
    thead.append(headRow);
    table.append(thead);
    const tbody = el('tbody');
    tbody.append(...vocab.map((item) => {
      const tr = el('tr');
      tr.append(el('td', 'vocab-de', item.german || ''));
      tr.append(el('td', null, item.meaning || ''));
      tr.append(el('td', 'vocab-cat', item.category || ''));
      return tr;
    }));
    table.append(tbody);
    wrap.append(table);
    section.append(wrap);
  }

  // Etimología (siempre en palabras sueltas; opcional en frases)
  const etymology = (analysis.etymology || []).filter((e) => e && e.german && e.origin);
  if (etymology.length) {
    const section = makeSection(card, '🌱', 'Etimología');
    const list = el('div', 'etym-list');
    list.append(...etymology.map((entry) => {
      const item = el('div', 'etym-item');
      item.append(el('span', 'etym-word', entry.german));
      item.append(el('p', 'etym-origin', entry.origin));
      return item;
    }));
    section.append(list);
  }

  // Alternativas (chips clicables → relanzan el análisis)
  const alternatives = (analysis.alternatives || []).filter((a) => typeof a === 'string' && a.trim());
  if (alternatives.length) {
    const section = makeSection(card, '🔁', 'Alternativas');
    const chips = el('div', 'alt-chips');
    chips.append(...alternatives.map((alt) => {
      const chip = el('button', 'alt-chip', alt);
      chip.type = 'button';
      chip.addEventListener('click', () => onAlternative?.(alt));
      return chip;
    }));
    section.append(chips);
  }

  // Contextos de uso
  const examples = (analysis.examples || []).filter((e) => e && e.german);
  if (examples.length) {
    const section = makeSection(card, '💬', 'Contextos de uso');
    const cards = el('div', 'example-cards');
    cards.append(...examples.map((example) => {
      const exampleCard = el('div', 'example-card');
      exampleCard.append(el('p', 'example-de', example.german || ''));
      if (example.spanish) exampleCard.append(el('p', 'example-es', example.spanish));
      return exampleCard;
    }));
    section.append(cards);
  }

  container.append(card);
  if (!partial) bus.emit('phase', { name: 'Render', t: null });
}

function makeSection(card, icon, title) {
  const section = el('div', 'result-section');
  const heading = el('h3', 'section-title');
  heading.append(el('span', 's-icon', icon));
  heading.append(document.createTextNode(title));
  section.append(heading);
  card.append(section);
  return section;
}
