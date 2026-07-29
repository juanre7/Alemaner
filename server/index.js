// Alemán Simultáneo: proxy único (Node, sin dependencias).
// `npm run dev` sirve cliente + proxy en modo desarrollo; `npm start` en producción.

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, normalize, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractJson } from '../shared/json.js';
import { directionHint, validateAnalysis } from '../shared/analysis.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const CLIENT_DIR = join(ROOT, 'client');
const DEV_DIR = join(ROOT, 'client-dev');
const SHARED_DIR = join(ROOT, 'shared');

const IS_DEV = process.argv.includes('--dev') || process.env.NODE_ENV === 'development';

// ---------------------------------------------------------------------------
// Configuración (.env opcional + variables de entorno)
// ---------------------------------------------------------------------------
loadDotEnv(join(ROOT, '.env'));

// Proveedores soportados. El PRD no se casa con ninguno (§5.1): cualquier LLM
// con salida JSON sirve; aquí hay dos adaptadores: Anthropic y OpenRouter.
const PROVIDER_DEFAULTS = {
  anthropic: {
    apiUrl: 'https://api.anthropic.com/v1/messages',
    model: 'claude-haiku-4-5-20251001',
    models: 'claude-haiku-4-5-20251001,claude-sonnet-5',
  },
  openrouter: {
    apiUrl: 'https://openrouter.ai/api/v1/chat/completions',
    model: 'deepseek/deepseek-v4-flash',
    models: 'deepseek/deepseek-v4-flash,deepseek/deepseek-v4-pro,deepseek/deepseek-v3.2',
  },
};

const PROVIDER = PROVIDER_DEFAULTS[(process.env.LLM_PROVIDER || 'anthropic').toLowerCase()]
  ? (process.env.LLM_PROVIDER || 'anthropic').toLowerCase()
  : 'anthropic';

const REASONING_EFFORT = (process.env.LLM_REASONING_EFFORT || '').toLowerCase(); // '', low, medium, high

const CONFIG = {
  port: Number(process.env.PORT) || 8787,
  provider: PROVIDER,
  apiKey: process.env.OPENROUTER_API_KEY || process.env.ANTHROPIC_API_KEY || process.env.API_KEY || '',
  apiUrl: process.env.LLM_API_URL || PROVIDER_DEFAULTS[PROVIDER].apiUrl,
  defaultModel: process.env.LLM_MODEL || PROVIDER_DEFAULTS[PROVIDER].model,
  // Lista para el selector del Modo Dev (GET /api/models).
  models: (process.env.LLM_MODELS || PROVIDER_DEFAULTS[PROVIDER].models)
    .split(',').map((m) => m.trim()).filter(Boolean),
  reasoningEffort: REASONING_EFFORT,
  // OpenRouter: criterio de enrutado entre proveedores del modelo.
  // "auto" = ranking propio por mejor relación tokens/latencia (tiempo total
  // estimado = latencia + tokens esperados / throughput), con las estadísticas
  // reales de los últimos 30 min de OpenRouter. También: throughput | latency | price.
  providerSort: process.env.LLM_PROVIDER_SORT || 'auto',
  // Tokens de salida esperados por consulta (análisis + razonamiento), para el score.
  expectedTokens: Number(process.env.LLM_EXPECTED_TOKENS) || 2000,
  // Con razonamiento activo hace falta margen: los tokens de "thinking" cuentan.
  maxTokens: Number(process.env.LLM_MAX_TOKENS) || (REASONING_EFFORT ? 12_000 : 4000),
  maxChars: 1000,
  allowedOrigins: new Set((process.env.CORS_ORIGINS
    || 'http://localhost:8787,http://127.0.0.1:8787,https://alemaner.juanre.es,http://alemaner.juanre.es,https://juanre7.github.io')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)),
  // Con razonamiento activo las respuestas son largas (miles de tokens de
  // thinking); hace falta más margen antes de cortar.
  requestTimeoutMs: Number(process.env.LLM_TIMEOUT_MS) || (REASONING_EFFORT ? 150_000 : 90_000),
};

const SYSTEM_PROMPT = readFileSync(join(ROOT, 'prompts', 'analyze.v1.md'), 'utf8');

function loadDotEnv(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || line.trimStart().startsWith('#')) continue;
    const value = match[2].replace(/^["']|["']$/g, '');
    if (!(match[1] in process.env)) process.env[match[1]] = value;
  }
}

// ---------------------------------------------------------------------------
// Rate limit simple por IP (ventana deslizante en memoria)
// ---------------------------------------------------------------------------
const RATE_LIMIT = { windowMs: 60_000, max: 20 };
const rateBuckets = new Map();

function rateLimited(ip) {
  const now = Date.now();
  const hits = (rateBuckets.get(ip) || []).filter((t) => now - t < RATE_LIMIT.windowMs);
  if (hits.length >= RATE_LIMIT.max) { rateBuckets.set(ip, hits); return true; }
  hits.push(now);
  rateBuckets.set(ip, hits);
  return false;
}

// ---------------------------------------------------------------------------
// Llamada al proveedor LLM (siempre en streaming §5.3)
// ---------------------------------------------------------------------------

async function throwProviderError(response) {
  const body = await response.text().catch(() => '');
  let detail = `El proveedor LLM respondió ${response.status}`;
  try {
    const parsed = JSON.parse(body);
    if (parsed?.error?.message) detail = parsed.error.message;
  } catch { /* cuerpo no JSON */ }
  const err = new Error(detail);
  err.status = response.status === 401 || response.status === 403 ? 401 : 502;
  throw err;
}

// Itera los eventos SSE de la respuesta ("data: ..." separados por línea en blanco).
async function* sseDataLines(response) {
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    let idx;
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const rawEvent = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      for (const line of rawEvent.split('\n')) {
        if (!line.startsWith('data:')) continue; // ignora comentarios ": ..." y "event:"
        const payload = line.slice(5).trim();
        if (payload && payload !== '[DONE]') yield payload;
      }
    }
  }
}

function callProvider(opts) {
  return CONFIG.provider === 'openrouter' ? callOpenRouter(opts) : callAnthropic(opts);
}

// ---------------------------------------------------------------------------
// Enrutado adaptativo OpenRouter (LLM_PROVIDER_SORT=auto).
// OpenRouter no publica latencia/throughput por proveedor en su API, así que
// el proxy MIDE cada consulta real: TTFT (latencia) y velocidad de generación
// (tokens/s, contando también el razonamiento). Cada chunk SSE identifica al
// proveedor que sirve. Con ello se mantiene una media móvil por proveedor y
// se enruta con `provider.order` ordenado por tiempo total estimado:
//   score = latencia + tokensEsperados / throughput
// Cada EXPLORE_EVERY consultas se prueba un proveedor sin medir (o con la
// medición más antigua) para no quedarse ciego. Sin mediciones aún →
// sort: throughput como arranque en frío.
// ---------------------------------------------------------------------------
const measuredStats = new Map(); // `${model}|${proveedor}` → { lat, tps, n, at }
const slugCache = new Map();     // modelo → { providers: [{slug, name}], at }
const SLUG_TTL_MS = 60 * 60_000;
const STALE_MS = 30 * 60_000;
const EXPLORE_EVERY = 5;
const EMA_ALPHA = 0.4;
let openRouterCallCount = 0;

function recordMeasurement(model, providerName, latSeconds, tps) {
  const key = `${model}|${providerName.toLowerCase()}`;
  const prev = measuredStats.get(key);
  measuredStats.set(key, prev
    ? {
        lat: prev.lat + EMA_ALPHA * (latSeconds - prev.lat),
        tps: prev.tps + EMA_ALPHA * (tps - prev.tps),
        n: prev.n + 1,
        at: Date.now(),
      }
    : { lat: latSeconds, tps, n: 1, at: Date.now() });
  if (IS_DEV) {
    console.log(`Medición ${providerName}: TTFT ${latSeconds.toFixed(2)}s · ${Math.round(tps)} tok/s`);
  }
}

// Lista de proveedores que sirven el modelo (para mapear nombre → slug de
// enrutado y conocer a los aún no medidos). No requiere clave.
async function modelProviders(model, signal) {
  const cached = slugCache.get(model);
  if (cached && Date.now() - cached.at < SLUG_TTL_MS) return cached.providers;
  let providers = [];
  try {
    const origin = new URL(CONFIG.apiUrl).origin;
    const safeModel = String(model).split('/').map(encodeURIComponent).join('/');
    const url = new URL(`/api/v1/models/${safeModel}/endpoints`, origin);

    // Prevent SSRF via Path Traversal by asserting the resolved path
    if (!url.pathname.startsWith('/api/v1/models/')) {
      throw new Error('Invalid model path');
    }

    const response = await fetch(url, { signal });
    if (response.ok) {
      const json = await response.json();
      const seen = new Set();
      for (const e of (json?.data?.endpoints || [])) {
        if (e.status < 0) continue;
        const slug = String(e.tag || '').split('/')[0].toLowerCase();
        if (!slug || seen.has(slug)) continue;
        seen.add(slug);
        providers.push({ slug, name: String(e.provider_name || slug).toLowerCase() });
      }
    }
  } catch { /* sin catálogo: se enrutará con sort */ }
  if (providers.length) slugCache.set(model, { providers, at: Date.now() });
  return providers;
}

async function openRouterProviderOrder(model, signal) {
  const providers = await modelProviders(model, signal);
  if (!providers.length) return null;

  const scored = [];
  const unmeasured = [];
  for (const p of providers) {
    const m = measuredStats.get(`${model}|${p.name}`) || measuredStats.get(`${model}|${p.slug}`);
    if (m && Date.now() - m.at < STALE_MS) {
      scored.push({ slug: p.slug, score: m.lat + CONFIG.expectedTokens / Math.max(m.tps, 1) });
    } else {
      unmeasured.push({ slug: p.slug, at: m ? m.at : 0 });
    }
  }
  if (!scored.length) return null; // arranque en frío → sort: throughput

  scored.sort((a, b) => a.score - b.score);
  unmeasured.sort((a, b) => a.at - b.at); // primero el nunca medido / más antiguo

  let order = [...scored.map((s) => s.slug), ...unmeasured.map((u) => u.slug)];
  // Con pocos proveedores medidos se explora cada 2 consultas (para no quedar
  // anclado al primero que respondió); con el mapa ya poblado, cada 5.
  const exploreEvery = scored.length < 3 ? 2 : EXPLORE_EVERY;
  const exploring = unmeasured.length > 0 && openRouterCallCount % exploreEvery === 0;
  if (exploring) order = [unmeasured[0].slug, ...order.filter((s) => s !== unmeasured[0].slug)];

  if (IS_DEV) {
    console.log(`Ranking tokens/latencia (${model})${exploring ? ' [explorando]' : ''}: `
      + scored.slice(0, 5).map((s) => `${s.slug}≈${s.score.toFixed(2)}s`).join(' · ')
      + (unmeasured.length ? ` · sin medir: ${unmeasured.length}` : ''));
  }
  return order;
}

// ---------------------------------------------------------------------------
// Enrutador heurístico de razonamiento
// ---------------------------------------------------------------------------
// Una consulta de una sola palabra (sin espacios internos tras recortar) no
// tiene sintaxis que analizar: el razonamiento no aporta y multiplica la
// latencia. Se envía sin modo razonamiento; las frases mantienen el esfuerzo
// configurado en LLM_REASONING_EFFORT.
function reasoningEffortFor(userText) {
  if (!CONFIG.reasoningEffort) return '';
  return /\s/.test(userText.trim()) ? CONFIG.reasoningEffort : '';
}

async function callAnthropic({ apiKey, model, userText, direction, onChunk, signal }) {
  const response = await fetch(CONFIG.apiUrl, {
    method: 'POST',
    signal,
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: CONFIG.maxTokens,
      stream: true,
      system: `${SYSTEM_PROMPT}\n\n${directionHint(direction)}`,
      messages: [{ role: 'user', content: userText }],
    }),
  });
  if (!response.ok) await throwProviderError(response);

  let fullText = '';
  for await (const payload of sseDataLines(response)) {
    let event;
    try { event = JSON.parse(payload); } catch { continue; }
    if (event.type === 'content_block_delta' && event.delta?.text) {
      fullText += event.delta.text;
      onChunk?.(event.delta.text);
    }
    if (event.type === 'error') {
      const err = new Error(event.error?.message || 'Error del proveedor durante el streaming');
      err.status = 502;
      throw err;
    }
  }
  return fullText;
}

async function callOpenRouter({ apiKey, model, userText, direction, onChunk, onThinking, signal }) {
  const body = {
    model,
    stream: true,
    max_tokens: CONFIG.maxTokens,
    messages: [
      { role: 'system', content: `${SYSTEM_PROMPT}\n\n${directionHint(direction)}` },
      { role: 'user', content: userText },
    ],
    // Modo JSON del proveedor (§6): deepseek-v4-flash lo soporta.
    response_format: { type: 'json_object' },
  };
  // Los modelos híbridos (DeepSeek) razonan por defecto: para desactivar el
  // razonamiento no basta con omitir el parámetro, hay que pedirlo explícito.
  const reasoningEffort = reasoningEffortFor(userText);
  body.reasoning = reasoningEffort ? { effort: reasoningEffort } : { enabled: false };

  // Enrutado entre proveedores, siempre con fallback si el elegido falla.
  if (CONFIG.providerSort === 'auto') {
    openRouterCallCount += 1;
    const order = await openRouterProviderOrder(model, signal);
    body.provider = order
      ? { order, allow_fallbacks: true }
      : { sort: 'throughput', allow_fallbacks: true };
  } else {
    body.provider = { sort: CONFIG.providerSort, allow_fallbacks: true };
  }

  // Medición real para el enrutado adaptativo: TTFT y velocidad de generación.
  const t0 = Date.now();
  const response = await fetch(CONFIG.apiUrl, {
    method: 'POST',
    signal,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
      'http-referer': 'https://localhost/aleman-simultaneo',
      'x-title': 'Aleman Simultaneo',
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) await throwProviderError(response);

  let tFirst = null;
  let generatedChars = 0;
  let reasoningChars = 0;
  let upstreamProvider = null;
  let fullText = '';

  const measure = () => {
    if (!upstreamProvider) return;
    // También se mide en caso de timeout/aborto: la velocidad observada hasta
    // el corte penaliza al proveedor lento en el ranking.
    const latSeconds = ((tFirst ?? Date.now()) - t0) / 1000;
    const genSeconds = Math.max((Date.now() - (tFirst ?? Date.now())) / 1000, 0.05);
    // ~4 caracteres por token: suficiente para comparar proveedores entre sí.
    const tps = generatedChars > 0 ? (generatedChars / 4) / genSeconds : 1;
    recordMeasurement(model, upstreamProvider, latSeconds, tps);
  };

  try {
    for await (const payload of sseDataLines(response)) {
      let event;
      try { event = JSON.parse(payload); } catch { continue; }
      if (event.error) {
        const err = new Error(event.error.message || 'Error del proveedor durante el streaming');
        err.status = 502;
        throw err;
      }
      if (!upstreamProvider && typeof event.provider === 'string') upstreamProvider = event.provider;
      const delta = event.choices?.[0]?.delta;
      if (!delta) continue;
      // Los deltas de razonamiento (delta.reasoning) se descartan de la salida,
      // pero cuentan para la medición: son generación real.
      if (typeof delta.reasoning === 'string' && delta.reasoning) {
        if (tFirst === null) tFirst = Date.now();
        generatedChars += delta.reasoning.length;
        reasoningChars += delta.reasoning.length;
        onThinking?.(reasoningChars);
      }
      if (typeof delta.content === 'string' && delta.content) {
        if (tFirst === null) tFirst = Date.now();
        generatedChars += delta.content.length;
        fullText += delta.content;
        onChunk?.(delta.content);
      }
    }
  } finally {
    measure();
  }
  return fullText;
}

// ---------------------------------------------------------------------------
// POST /api/analyze
// ---------------------------------------------------------------------------
async function handleAnalyze(req, res, ip) {
  if (rateLimited(ip)) {
    return sendJson(res, 429, { error: 'Demasiadas peticiones. Espera un minuto e inténtalo de nuevo.' });
  }

  let body;
  try { body = JSON.parse(await readBody(req, 64 * 1024)); }
  catch { return sendJson(res, 400, { error: 'Cuerpo de la petición inválido' }); }

  const text = typeof body.text === 'string' ? body.text : '';
  const direction = body.direction === 'reverse' ? 'reverse' : 'direct';
  const wantStream = body.stream === true;

  // El límite del cliente es cosmético: se revalida aquí (§7).
  if (!text.trim()) return sendJson(res, 400, { error: 'El texto está vacío' });
  if (text.length > CONFIG.maxChars) {
    return sendJson(res, 400, { error: `El texto supera el límite de ${CONFIG.maxChars} caracteres` });
  }

  // Resolución de claves (§5.2): BYOK → clave de servidor → 401.
  // La clave del usuario no se persiste ni se registra en logs.
  const userKey = req.headers['x-user-api-key'];
  const apiKey = (typeof userKey === 'string' && userKey.trim()) ? userKey.trim() : CONFIG.apiKey;
  if (!apiKey) return sendJson(res, 401, { error: 'Configura una clave API en Ajustes' });

  // El selector de modelo se respeta si estamos en desarrollo, si el usuario
  // proporciona su propia clave API (BYOK), o si el modelo está en la lista permitida.
  let model = CONFIG.defaultModel;
  if (typeof body.model === 'string' && body.model.trim()) {
    const requestedModel = body.model.trim();
    if (IS_DEV || userKey || CONFIG.models.includes(requestedModel)) {
      model = requestedModel;
    }
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CONFIG.requestTimeoutMs);
  req.on('close', () => controller.abort());

  const sse = wantStream ? openSse(res) : null;

  try {
    let attempt = 0;
    let analysis = null;
    let lastError = 'Respuesta fuera de formato';
    let lastThinkingPush = 0;
    // Validación con un reintento si el JSON no cumple el schema (§6).
    while (attempt < 2 && !analysis) {
      attempt += 1;
      if (sse && attempt > 1) sse.send('retry', { attempt });
      const fullText = await callProvider({
        apiKey, model, userText: text, direction,
        signal: controller.signal,
        // Solo retransmitimos chunks en el primer intento; el reintento va buffered.
        onChunk: sse && attempt === 1 ? (t) => sse.send('chunk', { text: t }) : null,
        // Progreso del razonamiento: sin esto el cliente no ve nada hasta que
        // el modelo termina de pensar y empieza a emitir el JSON.
        onThinking: sse && attempt === 1 ? (chars) => {
          const now = Date.now();
          if (now - lastThinkingPush < 250) return;
          lastThinkingPush = now;
          sse.send('thinking', { chars });
        } : null,
      });
      const parsed = extractJson(fullText);
      const result = validateAnalysis(parsed);
      if (result.ok) analysis = result.value;
      else lastError = result.error;
    }

    if (!analysis) {
      const err = new Error(`La respuesta del modelo no cumple el formato esperado (${lastError})`);
      err.status = 502;
      throw err;
    }

    if (sse) {
      sse.send('done', analysis);
      sse.close();
    } else {
      sendJson(res, 200, analysis);
    }
  } catch (err) {
    const status = err.name === 'AbortError' ? 504 : (err.status || 502);
    const message = err.name === 'AbortError'
      ? 'La consulta ha superado el tiempo máximo de espera'
      : (err.message || 'Error inesperado del proxy');
    if (sse) {
      sse.send('error', { error: message, status });
      sse.close();
    } else if (!res.headersSent) {
      sendJson(res, status, { error: message });
    }
  } finally {
    clearTimeout(timeout);
  }
}

function openSse(res) {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  return {
    send(event, data) {
      if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    },
    close() { if (!res.writableEnded) res.end(); },
  };
}

// ---------------------------------------------------------------------------
// Utilidades HTTP + estáticos
// ---------------------------------------------------------------------------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function readBody(req, limit) {
  return new Promise((resolvePromise, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('payload too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolvePromise(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(body);
}

function applyCors(req, res) {
  const origin = req.headers.origin;
  if (typeof origin !== 'string') return false;
  if (!CONFIG.allowedOrigins.has(origin) && !CONFIG.allowedOrigins.has('*')) return false;
  res.setHeader('access-control-allow-origin', origin);
  res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
  res.setHeader('access-control-allow-headers', 'content-type,x-user-api-key');
  res.setHeader('vary', 'Origin');
  return true;
}

async function serveStatic(res, baseDir, urlPath) {
  const safePath = normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
  let filePath = join(baseDir, safePath);
  if (!filePath.startsWith(baseDir)) { res.writeHead(403); res.end(); return; }
  try {
    const info = await stat(filePath);
    if (info.isDirectory()) filePath = join(filePath, 'index.html');
    const data = await readFile(filePath);
    res.writeHead(200, {
      'content-type': MIME[extname(filePath).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-cache',
    });
    res.end(data);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
  }
}

// ---------------------------------------------------------------------------
// Servidor
// ---------------------------------------------------------------------------
const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const ip = req.socket.remoteAddress || 'unknown';
  const corsOk = applyCors(req, res);

  try {
    if (req.method === 'OPTIONS') {
      res.writeHead(corsOk ? 204 : 403);
      return res.end();
    }
    if (url.pathname === '/api/analyze' && req.method === 'POST') {
      return await handleAnalyze(req, res, ip);
    }
    if (url.pathname === '/api/models' && req.method === 'GET') {
      // Solo se sirve en desarrollo (§5.1).
      if (!IS_DEV) return sendJson(res, 404, { error: 'Not found' });
      return sendJson(res, 200, { models: CONFIG.models, default: CONFIG.defaultModel });
    }
    // El código del Modo Dev solo se sirve en builds de desarrollo (§2.B).
    if (url.pathname.startsWith('/dev/')) {
      if (!IS_DEV) { res.writeHead(404); return res.end(); }
      return await serveStatic(res, DEV_DIR, url.pathname.slice('/dev/'.length) || 'index.html');
    }
    if (url.pathname.startsWith('/shared/')) {
      return await serveStatic(res, SHARED_DIR, url.pathname.slice('/shared/'.length));
    }
    return await serveStatic(res, CLIENT_DIR, url.pathname === '/' ? 'index.html' : url.pathname);
  } catch (err) {
    if (!res.headersSent) sendJson(res, 500, { error: 'Error interno del proxy' });
  }
});

const isMain = process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1]);
if (isMain) {
  server.listen(CONFIG.port, () => {
    console.log(`Alemán Simultáneo ${IS_DEV ? '[DEV]' : '[PROD]'} → http://localhost:${CONFIG.port}`);
    console.log(`Proveedor: ${CONFIG.provider} · Modelo: ${CONFIG.defaultModel}`
      + (CONFIG.reasoningEffort ? ` · Razonamiento: ${CONFIG.reasoningEffort}` : '')
      + (CONFIG.provider === 'openrouter' ? ` · Enrutado: ${CONFIG.providerSort}` : ''));
    if (!CONFIG.apiKey) console.log('Sin clave de servidor: los usuarios deberán usar BYOK (Ajustes).');
  });
}

