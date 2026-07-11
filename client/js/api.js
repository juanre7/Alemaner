// Cliente del proxy /api/analyze. Dos modos de entrega (§5.3):
// buffer (JSON de golpe, por defecto) o streaming SSE (Modo Dev).

import { bus } from './telemetry.js';
import { tryParsePartial } from './partial-json.js';

const ANALYZE_PATH = '/api/analyze';
const API_BASE_URL = normalizeApiBase(window.ALEMANER_CONFIG?.apiBaseUrl);
const ANALYZE_URL = `${API_BASE_URL}${ANALYZE_PATH}`;

export class ApiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

/**
 * Lanza una consulta. Devuelve { analysis, elapsed, ttft }.
 * onPartial(analysisParcial) se invoca durante el streaming.
 */
export async function analyze({ text, direction, model, stream, apiKey, onPartial }) {
  const requestBody = { text, direction };
  if (stream) requestBody.stream = true;
  if (model) requestBody.model = model;

  const headers = { 'content-type': 'application/json' };
  if (apiKey) headers['x-user-api-key'] = apiKey;

  const t0 = performance.now();
  let ttft = null;

  bus.emit('start', { direction, stream: !!stream, model: model || null, requestBody, t0 });
  bus.emit('log', { kind: 'client', msg: `Consulta preparada (${direction === 'direct' ? 'DE→ES' : 'ES→DE'}, ${stream ? 'streaming' : 'buffer'})` });
  bus.emit('phase', { name: 'Petición enviada', t: 0 });
  bus.emit('log', { kind: 'net', msg: `POST ${ANALYZE_URL}` });

  let response;
  try {
    response = await fetch(ANALYZE_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
    });
  } catch {
    throw finishError('No se pudo contactar con el servidor. Comprueba tu conexión.', 0, t0);
  }

  if (!stream) {
    // ---- Modo buffer ----
    if (!response.ok) {
      const message = await errorMessage(response);
      throw finishError(message, response.status, t0);
    }
    let analysis;
    try { analysis = await response.json(); }
    catch { throw finishError('Respuesta ilegible del servidor', 0, t0); }
    const elapsed = performance.now() - t0;
    bus.emit('phase', { name: 'Respuesta completa', t: elapsed });
    bus.emit('phase', { name: 'Validación', t: performance.now() - t0 });
    bus.emit('log', { kind: 'ok', msg: `Respuesta recibida y validada en ${(elapsed / 1000).toFixed(2)}s` });
    bus.emit('response', { json: analysis });
    return { analysis, elapsed, ttft: null };
  }

  // ---- Modo streaming (SSE) ----
  if (!response.ok || !response.body) {
    const message = await errorMessage(response);
    throw finishError(message, response.status, t0);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let accumulated = '';
  let finalAnalysis = null;
  let sseError = null;

  const processEvent = (rawEvent) => {
    let eventName = 'message';
    let data = '';
    for (const line of rawEvent.split('\n')) {
      if (line.startsWith('event:')) eventName = line.slice(6).trim();
      else if (line.startsWith('data:')) data += line.slice(5).trim();
    }
    if (!data) return;
    let payload;
    try { payload = JSON.parse(data); } catch { return; }

    if (eventName === 'chunk') {
      if (ttft === null) {
        ttft = performance.now() - t0;
        bus.emit('phase', { name: 'Primer token', t: ttft });
        bus.emit('ttft', { ttft });
        bus.emit('log', { kind: 'net', msg: `Primer token en ${Math.round(ttft)}ms` });
      }
      accumulated += payload.text || '';
      if (onPartial) {
        const partial = tryParsePartial(accumulated);
        if (partial) onPartial(partial);
      }
    } else if (eventName === 'retry') {
      bus.emit('log', { kind: 'net', msg: 'Validación fallida: reintento del proxy en curso...' });
    } else if (eventName === 'done') {
      finalAnalysis = payload;
    } else if (eventName === 'error') {
      sseError = new ApiError(payload.error || 'Error del servidor', payload.status || 502);
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      processEvent(buffer.slice(0, idx));
      buffer = buffer.slice(idx + 2);
    }
  }

  if (sseError) throw finishError(sseError.message, sseError.status, t0);
  if (!finalAnalysis) throw finishError('El streaming terminó sin una respuesta válida', 0, t0);

  const elapsed = performance.now() - t0;
  bus.emit('phase', { name: 'Respuesta completa', t: elapsed });
  bus.emit('phase', { name: 'Validación', t: performance.now() - t0 });
  bus.emit('log', { kind: 'ok', msg: `Streaming completado y validado en ${(elapsed / 1000).toFixed(2)}s` });
  bus.emit('response', { json: finalAnalysis });
  return { analysis: finalAnalysis, elapsed, ttft };
}

async function errorMessage(response) {
  try {
    const body = await response.json();
    if (body && body.error) return body.error;
  } catch { /* cuerpo no JSON */ }
  return `El servidor respondió con el estado ${response.status}`;
}

function finishError(message, status, t0) {
  const elapsed = performance.now() - t0;
  bus.emit('log', { kind: 'error', msg: `[Error] ${message}` });
  bus.emit('fail', { message, status, elapsed });
  return new ApiError(message, status);
}

/** Entrada de Performance API para la última llamada a /api/analyze (§4.6). */
export function lastResourceTiming() {
  const entries = performance.getEntriesByType('resource')
    .filter((e) => e.name.endsWith(ANALYZE_PATH));
  return entries.length ? entries[entries.length - 1] : null;
}

function normalizeApiBase(value) {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/\/+$/, '');
}
