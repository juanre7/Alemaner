# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

No build step, no dependencies, no `npm install`. Requires Node 18+.

```bash
npm run dev     # node server/index.js --dev  → proxy + client, Modo Dev enabled
npm start       # node server/index.js         → production, Modo Dev absent
```

There is no test suite, linter, or formatter. Config comes from `.env` (copy `.env.example`) or environment variables. The data contract and validation rules live in §6 of `PRD_aleman_simultaneo_v2.md`; the code cross-references PRD sections by number in comments.

## What this is

Alemán Simultáneo: a German translator + grammar analyzer for Spanish speakers. A single query returns a structured JSON analysis (translation, Spanish-grapheme pronunciation, grammar notes, categorized vocabulary, alternatives, usage examples) rendered on one screen. Frontend is vanilla ES modules with no build; backend is a single dependency-free Node proxy.

## Architecture

### Two deployment modes — the central design fact

The same `client/` runs against a backend in one of two ways, decided at runtime in `client/js/api.js`:

- **Proxy mode** (localhost / self-hosted): the browser calls the local Node proxy at `/api/analyze`, which holds the LLM call, provider routing, streaming, validation, and retry logic.
- **Direct/BYOK mode** (GitHub Pages): there is no server. `api.js` calls the LLM provider (OpenRouter or Anthropic) *directly from the browser* using the user's own API key. `shouldUseDirectMode()` picks this when host is `alemaner.juanre.es` or `*.github.io`, or when `window.ALEMANER_CONFIG.apiMode === 'direct'`.

Consequence: the system prompt and the `validateAnalysis`/`extractJson` logic are **duplicated** — once in `server/index.js` (authoritative) and once in `client/js/api.js` (for direct mode). If you change the prompt or the data schema, change it in `prompts/analyze.v1.md` **and** in the inlined copy in `api.js`. GitHub Pages does not run `server/index.js`.

### Server (`server/index.js`)

One file, Node stdlib only. Serves static `client/`, serves `client-dev/` under `/dev/` **only when `IS_DEV`**, and handles `POST /api/analyze` + `GET /api/models` (dev-only). Highlights:

- **Provider adapters**: `callAnthropic` (Messages API) and `callOpenRouter` (chat completions), selected by `LLM_PROVIDER`. Both always stream from the provider via SSE (`sseDataLines`), even when the client wants a buffered response.
- **Key resolution** (§5.2): user BYOK key from `x-user-api-key` header → server env key → 401. The user key is never persisted or logged.
- **Validation + one retry** (§6): `extractJson` → `validateAnalysis`; if the JSON fails the schema, one silent retry (buffered) before a 502.
- **Delivery**: buffered JSON by default; SSE streaming (`event: chunk/retry/done/error`) when the client sends `stream: true` (Modo Dev toggle).
- **OpenRouter adaptive routing** (`LLM_PROVIDER_SORT=auto`): OpenRouter doesn't expose per-provider latency, so the proxy *measures* each real query (TTFT + tokens/s, identifying the upstream provider from SSE chunks), keeps an EMA per `model|provider`, and sends `provider.order` sorted by estimated total time (`latency + expectedTokens/throughput`). Explores an unmeasured provider every few calls; cold-starts with `sort: throughput`. All state is in-memory (`measuredStats`, `slugCache`).
- Also in-memory: a per-IP sliding-window rate limit (20/min).

### Client (`client/js/`)

Vanilla ES modules, no framework, imported from `index.html`. `config.js` is a plain script (not a module) setting `window.ALEMANER_CONFIG` before the module graph loads.

- `app.js` — orchestrator: dual input panels (direct DE→ES / reverse ES→DE), preset phrases, history, wires everything to `runAnalysis`.
- `api.js` — proxy client + direct-mode client (see two-mode note above).
- `render.js` — builds the results DOM; supports progressive/partial rendering during streaming.
- `partial-json.js` — best-effort parse of incomplete JSON so streaming can paint before the object closes.
- `settings.js` + `crypto.js` — BYOK key storage. The key is stored **AES-GCM encrypted at rest** in `localStorage` (`as_api_key_enc` envelope), decrypted into memory so `getApiKey()` is sync; migrates legacy plaintext `as_api_key`. Note `crypto.js`'s honest caveat: the derivation secret ships in the JS, so this is obfuscation, not password-grade encryption — its only job is to avoid a plaintext key in localStorage. The key never leaves the browser except as the `x-user-api-key` header to your own proxy (proxy mode) or straight to the provider (direct mode).
- `history.js` — localStorage query history; clicking an entry restores a saved result with **no server call**.
- `telemetry.js` — a minimal event bus the app *always* emits to; only Modo Dev listens.
- `speech.js` — Web Speech synthesis for German pronunciation.

### Modo Dev (`client-dev/`)

Telemetry console (real latency/TTFT, fetch phases via Performance API, payloads), SSE-streaming toggle, and model selector. Loaded via a dynamic `import('/dev/dev.js')` in `app.js` that **fails silently in production** — the code is only served when `IS_DEV`, so production ships no trace of it. The model selector and `stream` flag are only honored by the proxy when `IS_DEV`.

## Conventions

- Comments and user-facing strings are in Spanish; code identifiers in English.
- No dependencies anywhere — keep it that way (both server and client are stdlib/browser-API only).
- Comments reference PRD sections as `(§N)`; consult `PRD_aleman_simultaneo_v2.md` for the authoritative behavior spec.
- When editing the data schema or system prompt, update all three of: `prompts/analyze.v1.md`, the `SYSTEM_PROMPT`/validation in `server/index.js`, and the duplicated copy in `client/js/api.js`.

## Deployment

`.github/workflows/pages.yml` publishes **only `client/`** to GitHub Pages on push to `main` (copies `CNAME`, adds `.nojekyll`). Pages runs no server, so translation there relies on direct/BYOK mode. To point the static client at a hosted proxy instead, set `apiBaseUrl` in `client/config.js` and add the Pages origin to the proxy's `CORS_ORIGINS`.
