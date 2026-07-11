// Alemán Simultáneo — orquestador de la Estación de Trabajo.

import { analyze, lastResourceTiming } from './api.js';
import { bus } from './telemetry.js';
import { renderEmpty, renderLoading, renderError, renderResult } from './render.js';
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
  busy: false,
  streamMode: false,   // toggle del Modo Dev (§5.3); buffer por defecto
  model: null,         // selector del Modo Dev; el proxy solo lo respeta en dev
  lastRequest: null,
  activeCategory: 'all',
  phrasesExpanded: false,
};

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
    analyzeBtn.disabled = state.busy || !input.value.trim();
  };

  input.addEventListener('input', refresh);

  clearBtn.addEventListener('click', () => {
    // Vacía la caja, limpia resultados y errores, detiene la voz (§4.2).
    input.value = '';
    refresh();
    speech.stop();
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

function setBusy(busy) {
  state.busy = busy;
  els.inputDe.disabled = busy;
  els.inputRev.disabled = busy;
  refreshDe();
  refreshRev();
  for (const btn of els.phraseGrid.querySelectorAll('button')) btn.disabled = busy;
  for (const btn of els.phraseActions.querySelectorAll('button')) btn.disabled = busy;
  for (const btn of els.historyList.querySelectorAll('button')) btn.disabled = busy;
}

// ---------------------------------------------------------------------------
// Consulta al proxy
// ---------------------------------------------------------------------------

async function runAnalysis(request) {
  const { text, direction } = request;
  if (state.busy || !text.trim() || text.length > MAX_CHARS) return;

  state.lastRequest = request;
  setBusy(true);
  speech.stop();
  renderLoading();

  let lastPaint = 0;
  try {
    const { analysis, elapsed, ttft } = await analyze({
      text,
      direction,
      stream: state.streamMode,
      model: state.model,
      apiKey: getApiKey(),
      onPartial(partial) {
        // Pintado progresivo con un pequeño throttle para hardware modesto.
        const now = performance.now();
        if (now - lastPaint < 150) return;
        lastPaint = now;
        renderResult({
          analysis: partial, originalText: text, partial: true,
          busy: () => state.busy, onAlternative,
        });
      },
    });

    renderResult({
      analysis, originalText: text, elapsed,
      busy: () => state.busy, onAlternative,
    });
    renderHistory(addToHistory({
      text, direction, detectedLang: analysis.detectedLang, analysis, elapsed,
    }));
    bus.emit('complete', { elapsed, ttft, direction, resource: lastResourceTiming() });
  } catch (err) {
    // El texto de entrada se conserva intacto (§7); solo cambia el panel derecho.
    renderError(err.message || 'Error inesperado', () => runAnalysis(state.lastRequest),
      { needsApiKey: err.code === 'NO_API_KEY' });
  } finally {
    setBusy(false);
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
    card.disabled = state.busy;
    const de = document.createElement('span');
    de.className = 'phrase-de';
    de.textContent = phrase.de;
    const es = document.createElement('span');
    es.className = 'phrase-es';
    es.textContent = phrase.es;
    card.append(de, es);
    card.addEventListener('click', () => {
      // Autocompleta la caja alemana, vacía la inversa y lanza el análisis (§4.3).
      if (state.busy) return;
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
    toggle.disabled = state.busy;
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
      if (state.busy) return;
      speech.stop();
      const input = isDirect ? els.inputDe : els.inputRev;
      input.value = item.text.slice(0, MAX_CHARS);
      refreshDe();
      refreshRev();
      if (item.analysis) {
        renderResult({
          analysis: item.analysis, originalText: item.text, elapsed: item.elapsed,
          busy: () => state.busy, onAlternative,
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
