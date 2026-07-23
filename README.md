# Alemán Simultáneo

Traductor y analizador gramatical de alemán para estudiantes hispanohablantes. Open source y autohosteable. Cada frase se deconstruye en traducción, pronunciación con grafía española, explicación gramatical, vocabulario clasificado, alternativas de expresión y contextos de uso, todo en una sola pantalla.

La especificación completa está en [PRD_aleman_simultaneo_v2.md](PRD_aleman_simultaneo_v2.md).

## Arranque rápido

Requisitos: Node 18+ (sin dependencias npm; no hay `npm install`).

```bash
cp .env.example .env      # opcional: clave de servidor, puerto, modelos
npm run dev               # desarrollo (Modo Dev disponible)
npm start                 # producción (el Modo Dev no existe)
```

Abre `http://localhost:8787`.

## Proveedor LLM

Dos adaptadores integrados, elegibles con `LLM_PROVIDER` en `.env`:

- **openrouter**: por defecto en `.env.example`: `deepseek/deepseek-v4-flash` con razonamiento `high` (`LLM_REASONING_EFFORT`). El enrutado `LLM_PROVIDER_SORT=auto` optimiza la **relación tokens/latencia con mediciones propias**: el proxy cronometra cada consulta real (TTFT y tokens/s, identificando al proveedor que sirvió cada respuesta), mantiene una media móvil por proveedor y enruta con `provider.order` ordenado por tiempo total estimado (`latencia + tokens esperados ÷ throughput`), con fallback automático. Cada 5 consultas explora un proveedor sin medir (o con la medición más antigua) para mantener el ranking al día; en frío arranca con `sort: throughput`. Fuerza el modo JSON del proveedor.
- **anthropic**: Claude vía Messages API.

## Claves API (modo dual)

1. **BYOK**: cualquier usuario pega su clave en **Ajustes** (la del proveedor configurado: `sk-or-...` para OpenRouter, `sk-ant-...` para Anthropic). Queda en el `localStorage` de su navegador y viaja al proxy en la cabecera `x-user-api-key`; el proxy la usa sin persistirla ni registrarla.
2. **Clave de servidor**: `OPENROUTER_API_KEY` (o `ANTHROPIC_API_KEY`) en `.env` para quien autohostea.

Prioridad: clave del usuario → clave de entorno → error 401.

## Estructura

```
server/index.js        Proxy único (Node puro, sin dependencias)
prompts/analyze.v1.md  System prompt versionado
client/                Frontend vanilla (ES modules, sin build)
client-dev/            Modo Dev (telemetría); solo se sirve con npm run dev
```

## Endpoints

| Método | Ruta | Función |
|---|---|---|
| POST | `/api/analyze` | `{text, direction, model?, stream?}` → análisis JSON (o SSE) |
| GET | `/api/models` | Modelos configurados (solo desarrollo) |

El contrato de datos y las reglas de validación están en el §6 del PRD.

## GitHub Pages

El repositorio incluye un workflow en `.github/workflows/pages.yml` que publica
solo `client/` como sitio estatico de GitHub Pages. El archivo `CNAME` se copia
al artefacto para usar `alemaner.juanre.es`, y `.nojekyll` evita procesamiento
extra de Jekyll.

GitHub Pages no ejecuta `server/index.js`, asi que la traduccion necesita un
proxy Node desplegado aparte. Cuando tengas ese proxy en una URL publica,
edita `client/config.js`:

```js
window.ALEMANER_CONFIG = {
  apiBaseUrl: 'https://api.alemaner.juanre.es',
};
```

En el proxy, configura `CORS_ORIGINS` con el dominio de Pages para que el
navegador pueda llamar a `/api/analyze`:

```bash
CORS_ORIGINS=https://alemaner.juanre.es,https://juanre7.github.io
```

## Modo Dev

`npm run dev` habilita el toggle **Modo Dev** en la cabecera: consola de telemetría con métricas reales (latencia total, TTFT, fases del fetch vía Performance API, logs, payloads), toggle de streaming SSE y selector de modelo. En producción ese código ni siquiera se sirve.

## Licencia

MIT
