// Alemán Simultáneo — orquestador de la Estación de Trabajo.

import { analyze, lastResourceTiming, isDirectMode } from './api.js';
import { bus } from './telemetry.js';
import { renderEmpty, renderLoading, renderError, renderResult, setLoadingNote } from './render.js';
import { listHistory, addToHistory, removeFromHistory } from './history.js';
import { CATEGORIES, PHRASES } from './phrases.js';
import { initSettings, getApiKey } from './settings.js';
import * as speech from './speech.js';

const MAX_CHARS = 1000;
const PHRASE_PREVIEW_LIMIT = 3;

const els = {
  inputDe: document.getElementById('input-de'),
  inputRev: document.getElementById('input-rev'),
  counterDe: document.getElementById('counter-de'),
  counterRev: document.getElementById('counter-rev'),
  clearDe: document.getElementById('clear-de'),
  clearRev: document.getElementById('clear-rev'),
  analyzeDe: document.getElementById('analyze-de'),
  analyzeRev: document.getElementById('analyze-rev'),
  phraseTabs: document.getElementById('phrase-tabs'),
  phraseGrid: document.getElementById('phrase-grid'),
  phraseActions: document.getElementById('phrase-actions'),
  historyList: document.getElementById('history-list'),
};

const state = {
  displayOwner: 0,     // id de la consulta que posee el panel de resultados
  streamMode: false,   // toggle del Modo Dev (§5.3); buffer por defecto
  model: null,         // selector del Modo Dev; el proxy solo lo respeta en dev
  lastRequest: null,
  activeCategory: 'all',
  phrasesExpanded: false,
};

// Las consultas NO bloquean la interfaz: cada una recibe un id creciente y
// solo la más reciente (la "dueña" del panel) pinta resultados. Las anteriores
// siguen en segundo plano hasta terminar y guardarse en el historial (§4.4).
let querySeq = 0;
const inflight = new Map(); // "direction|text" → id, para re-adoptar duplicados

function claimDisplay() {
  state.displayOwner = ++querySeq;
  return state.displayOwner;
}

// ---------------------------------------------------------------------------
// Estación de Traducción Dual
// ---------------------------------------------------------------------------

function setupPanel(input, counter, clearBtn, analyzeBtn, direction) {
  const refresh = () => {
    const len = input.value.length;
    counter.textContent = `${len} / ${MAX_CHARS}`;
    counter.classList.toggle('warn', len >= MAX_CHARS * 0.9 && len < MAX_CHARS);
    counter.classList.toggle('limit', len >= MAX_CHARS);
    clearBtn.hidden = len === 0;
    analyzeBtn.disabled = !input.value.trim();
  };

  input.addEventListener('input', refresh);

  clearBtn.addEventListener('click', () => {
    // Vacía la caja, limpia resultados y errores, detiene la voz (§4.2).
    // Toma el panel: una consulta pendiente ya no lo pisará (solo irá al historial).
    input.value = '';
    refresh();
    speech.stop();
    claimDisplay();
    renderEmpty();
    input.focus();
  });

  analyzeBtn.addEventListener('click', () => {
    runAnalysis({ text: input.value, direction });
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !analyzeBtn.disabled) {
      runAnalysis({ text: input.value, direction });
    }
  });

  refresh();
  return refresh;
}

const refreshDe = setupPanel(els.inputDe, els.counterDe, els.clearDe, els.analyzeDe, 'direct');
const refreshRev = setupPanel(els.inputRev, els.counterRev, els.clearRev, els.analyzeRev, 'reverse');

// ---------------------------------------------------------------------------
// Consulta al proxy
// ---------------------------------------------------------------------------

async function runAnalysis(request) {
  const { text, direction } = request;
  if (!text.trim() || text.length > MAX_CHARS) return;

  // Doble clic o consulta idéntica aún en curso: se re-adopta en pantalla en
  // vez de lanzar una petición duplicada al proveedor.
  const key = `${direction}|${text}`;
  const existing = inflight.get(key);
  if (existing) {
    state.displayOwner = existing;
    renderLoading({ originalText: text, direction });
    return;
  }

  const id = claimDisplay();
  inflight.set(key, id);
  state.lastRequest = request;
  speech.stop();
  renderLoading({ originalText: text, direction });

  let lastPaint = 0;
  try {
    const { analysis, elapsed, ttft } = await analyze({
      text,
      direction,
      stream: state.streamMode,
      model: state.model,
      apiKey: getApiKey(),
      onThinking(chars) {
        // Fase de razonamiento: aún no hay JSON que pintar, pero sí progreso.
        if (state.displayOwner !== id) return;
        setLoadingNote(`Razonando... (~${Math.round(chars / 4)} tokens)`);
      },
      onPartial(partial) {
        // Pintado progresivo con un pequeño throttle para hardware modesto.
        if (state.displayOwner !== id) return;
        const now = performance.now();
        if (now - lastPaint < 150) return;
        lastPaint = now;
        renderResult({ analysis: partial, originalText: text, partial: true, onAlternative });
      },
    });

    // Al historial SIEMPRE, aunque otra consulta haya tomado el panel (§4.4).
    renderHistory(addToHistory({
      text, direction, detectedLang: analysis.detectedLang, analysis, elapsed,
    }));

    if (state.displayOwner === id) {
      renderResult({ analysis, originalText: text, elapsed, onAlternative });
      bus.emit('complete', { elapsed, ttft, direction, resource: lastResourceTiming() });
    } else {
      bus.emit('log', { kind: 'client', msg: `Consulta en segundo plano guardada en el historial: "${text.slice(0, 40)}"` });
    }
  } catch (err) {
    // El texto de entrada se conserva intacto (§7); solo cambia el panel
    // derecho, y solo si esta consulta sigue siendo la activa.
    if (state.displayOwner === id) {
      renderError(err.message || 'Error inesperado', () => runAnalysis(state.lastRequest),
        { needsApiKey: err.code === 'NO_API_KEY' });
    }
  } finally {
    inflight.delete(key);
  }
}

function onAlternative(altText) {
  // Clic en alternativa: inyecta en la caja alemana, vacía la inversa y relanza (§4.5).
  els.inputDe.value = altText.slice(0, MAX_CHARS);
  els.inputRev.value = '';
  refreshDe();
  refreshRev();
  runAnalysis({ text: els.inputDe.value, direction: 'direct' });
}

// ---------------------------------------------------------------------------
// Frases Prediseñadas
// ---------------------------------------------------------------------------

function renderPhraseTabs() {
  els.phraseTabs.textContent = '';
  for (const category of CATEGORIES) {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = `phrase-tab${state.activeCategory === category.id ? ' active' : ''}`;
    tab.textContent = category.label;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', String(state.activeCategory === category.id));
    tab.addEventListener('click', () => {
      state.activeCategory = category.id;
      state.phrasesExpanded = false;
      renderPhraseTabs();
      renderPhraseGrid();
    });
    els.phraseTabs.append(tab);
  }
}

function renderPhraseGrid() {
  els.phraseGrid.textContent = '';
  els.phraseActions.textContent = '';

  const phrases = state.activeCategory === 'all'
    ? PHRASES
    : PHRASES.filter((p) => p.cat === state.activeCategory);
  const visible = state.phrasesExpanded
    ? phrases
    : phrases.slice(0, PHRASE_PREVIEW_LIMIT);

  for (const phrase of visible) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'phrase-card';
    const de = document.createElement('span');
    de.className = 'phrase-de';
    de.textContent = phrase.de;
    const es = document.createElement('span');
    es.className = 'phrase-es';
    es.textContent = phrase.es;
    card.append(de, es);
    card.addEventListener('click', () => {
      // Autocompleta la caja alemana, vacía la inversa y lanza el análisis (§4.3).
      els.inputDe.value = phrase.de;
      els.inputRev.value = '';
      refreshDe();
      refreshRev();
      runAnalysis({ text: phrase.de, direction: 'direct' });
    });
    els.phraseGrid.append(card);
  }

  if (phrases.length > PHRASE_PREVIEW_LIMIT) {
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'phrase-toggle';
    toggle.textContent = state.phrasesExpanded
      ? 'Mostrar menos'
      : `Ver ${phrases.length - PHRASE_PREVIEW_LIMIT} más`;
    toggle.addEventListener('click', () => {
      state.phrasesExpanded = !state.phrasesExpanded;
      renderPhraseGrid();
    });
    els.phraseActions.append(toggle);
  }
}

// ---------------------------------------------------------------------------
// Historial de Consultas
// ---------------------------------------------------------------------------

function renderHistory(items) {
  els.historyList.textContent = '';

  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'history-empty';
    const art = document.createElement('span');
    art.className = 'empty-art';
    art.textContent = '🗒️';
    const msg = document.createElement('p');
    msg.textContent = 'No tienes traducciones previas en este navegador.';
    msg.style.margin = '0';
    empty.append(art, msg);
    els.historyList.append(empty);
    return;
  }

  for (const item of items) {
    // Div con semántica de botón: un <button> no puede contener la papelera.
    const row = document.createElement('div');
    row.className = 'history-row';
    row.setAttribute('role', 'button');
    row.tabIndex = 0;

    const badge = document.createElement('span');
    const isDirect = item.direction === 'direct';
    badge.className = `dir-badge ${isDirect ? 'de' : 'rev'}`;
    badge.textContent = isDirect ? 'DE→ES' : 'ES→DE';

    const textSpan = document.createElement('span');
    textSpan.className = 'history-text';
    textSpan.textContent = item.text;

    const time = document.createElement('span');
    time.className = 'history-time';
    time.textContent = new Date(item.ts).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'history-del';
    del.textContent = '🗑';
    del.setAttribute('aria-label', 'Eliminar del historial');
    del.addEventListener('click', (e) => {
      // Elimina el registro sin afectar la consulta activa (§4.4).
      e.stopPropagation();
      renderHistory(removeFromHistory(item.id));
    });

    row.append(badge, textSpan, time, del);
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); row.click(); }
    });
    row.addEventListener('click', () => {
      // Restaura entrada y resultado guardado SIN llamada al servidor (§4.4).
      // Toma el panel: una consulta pendiente ya no lo pisará al terminar.
      speech.stop();
      claimDisplay();
      const input = isDirect ? els.inputDe : els.inputRev;
      input.value = item.text.slice(0, MAX_CHARS);
      refreshDe();
      refreshRev();
      if (item.analysis) {
        renderResult({
          analysis: item.analysis, originalText: item.text, elapsed: item.elapsed,
          onAlternative,
        });
      } else {
        renderEmpty();
      }
      bus.emit('log', { kind: 'client', msg: 'Resultado restaurado desde el historial (sin coste)' });
    });
    els.historyList.append(row);
  }
}

// ---------------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------------

await initSettings();

// Aviso de modo demo: en modo directo sin clave propia se usa Pollinations.ai.
const demoNote = document.getElementById('demo-note');
const refreshDemoNote = () => { demoNote.hidden = !(isDirectMode() && !getApiKey()); };
document.addEventListener('apikeychange', refreshDemoNote);
refreshDemoNote();

renderPhraseTabs();
renderPhraseGrid();
renderHistory(listHistory());
renderEmpty();

// Precalienta la lista de voces (algunos navegadores la cargan en diferido).
if (speech.isSupported()) {
  try { window.speechSynthesis.getVoices(); } catch { /* seguro */ }
}

// Modo Dev: el módulo /dev/dev.js SOLO existe en builds de desarrollo (§2.B).
// En producción el import falla y la app sigue sin rastro del Modo Dev.
const devApi = {
  bus,
  getStreaming: () => state.streamMode,
  setStreaming: (v) => { state.streamMode = !!v; },
  getModel: () => state.model,
  setModel: (v) => { state.model = v || null; },
};

import('/dev/dev.js')
  .then((mod) => mod.initDevMode(devApi))
  .catch(() => { /* build de producción: sin Modo Dev */ });
