// Ficha de Resultados (§4.5). Todo el contenido del LLM se renderiza como
// TEXTO PLANO (textContent / createTextNode), nunca innerHTML.

import * as speech from './speech.js';
import { bus } from './telemetry.js';

const container = document.getElementById('results');

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function clear() {
  speech.stop();
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

export function renderLoading() {
  clear();
  const card = el('div', 'card result-loading');
  card.append(el('div', 'spinner'));
  card.append(el('p', null, 'Analizando...'));
  container.append(card);
}

export function renderError(message, onRetry) {
  clear();
  const card = el('div', 'card result-error fade-up');
  const head = el('div', 'error-head');
  head.append(el('span', 'error-icon', '⚠️'));
  head.append(el('h2', null, 'Error de análisis'));
  card.append(head);
  card.append(el('p', null, message));
  const retry = el('button', 'btn-retry', 'Reintentar traducción');
  retry.type = 'button';
  retry.addEventListener('click', onRetry);
  card.append(retry);
  container.append(card);
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
 *  - busy(): la app está en una consulta en curso (deshabilita chips)
 *  - onAlternative(text): clic en un chip de alternativa
 */
export function renderResult({ analysis, originalText, elapsed, partial, busy, onAlternative }) {
  clear();
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

  // Traducción + audio
  if (analysis.translation) {
    if (originalText) card.append(el('p', 'original-text', originalText));
    const row = el('div', 'translation-row');
    row.append(el('p', 'translation-main', analysis.translation));

    // La frase ALEMANA es la entrada (dirección directa) o la traducción (inversa).
    const germanText = analysis.detectedLang === 'de' ? originalText : analysis.translation;
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
    for (const note of notes) list.append(el('li', null, note));
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
    for (const label of ['Alemán', 'Significado', 'Categoría']) headRow.append(el('th', null, label));
    thead.append(headRow);
    table.append(thead);
    const tbody = el('tbody');
    for (const item of vocab) {
      const tr = el('tr');
      tr.append(el('td', 'vocab-de', item.german || ''));
      tr.append(el('td', null, item.meaning || ''));
      tr.append(el('td', 'vocab-cat', item.category || ''));
      tbody.append(tr);
    }
    table.append(tbody);
    wrap.append(table);
    section.append(wrap);
  }

  // Alternativas (chips clicables → relanzan el análisis)
  const alternatives = (analysis.alternatives || []).filter((a) => typeof a === 'string' && a.trim());
  if (alternatives.length) {
    const section = makeSection(card, '🔁', 'Alternativas');
    const chips = el('div', 'alt-chips');
    for (const alt of alternatives) {
      const chip = el('button', 'alt-chip', alt);
      chip.type = 'button';
      chip.addEventListener('click', () => {
        if (busy && busy()) return;
        onAlternative?.(alt);
      });
      chips.append(chip);
    }
    section.append(chips);
  }

  // Contextos de uso
  const examples = (analysis.examples || []).filter((e) => e && e.german);
  if (examples.length) {
    const section = makeSection(card, '💬', 'Contextos de uso');
    const cards = el('div', 'example-cards');
    for (const example of examples) {
      const exampleCard = el('div', 'example-card');
      exampleCard.append(el('p', 'example-de', example.german || ''));
      if (example.spanish) exampleCard.append(el('p', 'example-es', example.spanish));
      cards.append(exampleCard);
    }
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
