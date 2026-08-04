# Estudio: subtítulos en vivo (speech-to-text en tiempo real)

Estado: **estudio de viabilidad**, no hay código implementado. Documenta cómo
encajaría un modo "subtítulos live" —transcribir en tiempo real lo que dice el
profesor en clase— dentro de la arquitectura actual de Alemán Simultáneo.

---

## 1. El caso de uso

Estás en una clase de alemán. El profesor habla en alemán y quieres:

1. **Ver** lo que dice, transcrito en pantalla con muy poco retardo (leer alemán
   es mucho más fácil que entenderlo de oído).
2. Que las frases se vayan **acumulando** en un rollo, para releer lo que se
   perdió hace treinta segundos.
3. Poder **tocar una frase** y que caiga en la Estación de Trabajo actual: el
   análisis completo (traducción, pronunciación, gramática, vocabulario) que ya
   sabe hacer la app.
4. Opcionalmente, una **traducción corrida** al español debajo del alemán.

Los puntos 1–3 son el producto. El 4 es caro y opcional (§6).

Esto no es una función más dentro de la pantalla actual: es un **modo de uso
distinto** (pasivo, continuo, de larga duración, con el móvil en la mesa) frente
al actual (activo, una consulta cada vez). Merece su propia vista.

---

## 2. Restricciones que impone este proyecto

Cualquier diseño tiene que respetar lo que ya está decidido (ver `CLAUDE.md`):

| Restricción | Consecuencia para STT |
|---|---|
| **Cero dependencias** (servidor y cliente) | Nada de SDKs de proveedor ni de `ws`. Todo con `WebSocket`/`AudioWorklet` del navegador y stdlib de Node. |
| **Doble modo de despliegue** (proxy vs. directo/BYOK) | En GitHub Pages no hay servidor: el navegador tendría que hablar con el proveedor de STT directamente, con la clave del usuario. |
| **Sin build step** | Módulos ES planos; el `AudioWorklet` es un fichero suelto servido tal cual. |
| **Rate limit 20/min por IP** en el proxy | Analizar automáticamente cada frase final saturaría el límite en dos minutos de clase. El análisis tiene que ser bajo demanda. |
| **`MAX_CHARS = 1000`** | Los segmentos que se manden a analizar deben trocearse por frase, no mandar el rollo entero. |

---

## 3. Opciones de proveedor

### 3.1 Web Speech API del navegador (coste cero)

`webkitSpeechRecognition` con `lang = 'de-DE'`, `continuous = true`,
`interimResults = true`. Ya usamos la mitad hermana de esta API en
`client/js/speech.js` (síntesis), así que el patrón encaja: *feature detection*,
degradar en silencio si no existe.

- **A favor**: cero coste, cero claves, cero dependencias, funciona hoy mismo en
  GitHub Pages, ~80 líneas de código.
- **En contra**:
  - Firefox no la implementa. Chrome/Edge sí; Safari parcialmente y con más
    cortes.
  - En Chrome el audio se envía a servidores de Google (no es local), y no hay
    contrato ni SLA: es una API "de cortesía" que puede cambiar.
  - Se **corta sola** tras unos segundos de silencio → hay que reengancharla en
    `onend`, y en cada reenganche se pierde una fracción de segundo de audio.
  - Precisión mediocre con audio *far-field* (profesor a cuatro metros, aula con
    reverberación) y sin vocabulario personalizado.
  - Sin marcas de tiempo por palabra ni diarización.

### 3.2 Inworld Speech-to-Text (la referencia del enunciado)

API de streaming bidireccional sobre WebSocket. Datos relevantes:

- **Endpoint**: `wss://api.inworld.ai/stt/v1/transcribe:streamBidirectional`
- **Autenticación**: `?authorization=Basic%20<clave>` **en la query string**.
- **Protocolo**: primero un mensaje `transcribeConfig`, luego `audioChunk`
  repetidos, y `closeStream` al terminar. El servidor devuelve `transcription`
  (con `isFinal` true/false), eventos `speechStarted`/`speechStopped` y `usage`.
- **Audio**: `LINEAR16`, 16 kHz, mono por defecto.
- **Opciones útiles aquí**: `language` (ISO 639), `prompts` (vocabulario
  personalizado — se le pueden pasar los términos del tema de la clase),
  `includeWordTimestamps`, `enableSpeakerDiarization` (separar profesor de
  alumnos).
- **Latencia anunciada**: ~100 ms. **Precio**: $0.10/h a volumen, $0.35/h en la
  banda de entrada. Alemán está entre los idiomas con streaming en tiempo real.
- Es en realidad un **router unificado** sobre varios motores (Groq, AssemblyAI,
  Soniox, Deepgram) seleccionables con `modelId` (`inworld/inworld-stt-1`,
  `assemblyai/universal-streaming-multilingual`, …). Eso es lo más valioso para
  nosotros: una sola integración, varios motores que probar sin tocar el código.

Ejemplo de configuración para nuestro caso:

```json
{
  "transcribeConfig": {
    "modelId": "inworld/inworld-stt-1",
    "audioEncoding": "LINEAR16",
    "sampleRateHertz": 16000,
    "language": "de",
    "prompts": ["Konjunktiv", "Dativ", "Nebensatz"]
  }
}
```

**Problema serio de seguridad**: la clave viaja en la *query string* de la URL
del WebSocket. Las query strings acaban en logs de proxies e historiales. En
modo directo/BYOK es la clave del propio usuario (asumible, es su decisión), pero
**no** se puede usar una clave de servidor así desde el navegador.

### 3.3 Alternativas equivalentes

Deepgram (`wss://api.deepgram.com/v1/listen`, auth por subprotocolo o header),
AssemblyAI universal-streaming, Soniox, o el `realtime` de OpenAI. Todas tienen
el mismo perfil: WebSocket + PCM16 + resultados parciales/finales, precio del
mismo orden. Ninguna tiene una ventaja decisiva sobre Inworld para esto, y como
Inworld encapsula a varias de ellas, integrar Inworld deja la puerta abierta.

### 3.4 Comparativa

| | Web Speech | Inworld / Deepgram / … |
|---|---|---|
| Coste | 0 | ~$0.15–0.53 por clase de 90 min |
| Clave API | no | sí (BYOK) |
| Navegadores | Chrome/Edge, Safari a medias | todos (es solo un WebSocket) |
| Calidad *far-field* | regular | buena |
| Vocabulario del tema | no | sí (`prompts`) |
| Diarización / timestamps | no | sí |
| Continuidad | se corta, hay que reenganchar | sesión larga estable |
| Trabajo de integración | ~80 líneas | ~350 líneas (captura + worklet + adaptador) |

---

## 4. Arquitectura propuesta

La clave del diseño es que **el proveedor de STT no debe filtrarse a la interfaz**.
Un solo contrato, dos (o más) implementaciones detrás — exactamente el mismo
patrón que ya usa `api.js` con proxy/directo.

### 4.1 Contrato del transcriptor

```js
// client/js/stt/index.js
// Devuelve una sesión de transcripción. Todo proveedor cumple este contrato.
export function createTranscriber({ lang = 'de-DE', onPartial, onFinal, onState, onError });
// → { start(), stop() }
```

- `onPartial(text)`: hipótesis en curso, se repinta en gris y se reemplaza entera.
- `onFinal({ text, ts })`: segmento cerrado, se añade al rollo y ya no cambia.
- `onState('idle' | 'listening' | 'reconnecting')`: para el indicador de la UI.

`render.js` y la vista de subtítulos solo conocen esto. Cambiar de Web Speech a
Inworld es cambiar qué fábrica se importa.

### 4.2 Ficheros nuevos

```
client/js/stt/index.js          selector de proveedor (feature detection + config)
client/js/stt/webspeech.js      adaptador Web Speech API (fase 0)
client/js/stt/inworld.js        adaptador WebSocket Inworld (fase 1)
client/js/stt/capture.js        getUserMedia → AudioContext → PCM16 16 kHz
client/js/stt/pcm-worklet.js    AudioWorkletProcessor (fichero suelto, sin build)
client/js/live.js               vista "Modo Clase": rollo, autoscroll, clic→analizar
```

Y toques en existentes: `index.html` (contenedor + botón de modo), `styles.css`,
`app.js` (montar la vista, reutilizar `runAnalysis`), `settings.js` (clave de STT
y selección de proveedor), `config.js` (`sttProvider`, `sttModel`).

### 4.3 La captura de audio

Es la parte con más trampas y la única que no es negociable si vamos a un
proveedor externo (Web Speech captura por su cuenta):

```js
const ctx = new AudioContext({ sampleRate: 16000 });   // Chrome/Firefox lo respetan
const src = ctx.createMediaStreamSource(await navigator.mediaDevices.getUserMedia({
  audio: { channelCount: 1, echoCancellation: false, noiseSuppression: true },
}));
await ctx.audioWorklet.addModule('/js/stt/pcm-worklet.js');
const node = new AudioWorkletNode(ctx, 'pcm16');
node.port.onmessage = (e) => send(e.data);   // ArrayBuffer de Int16
src.connect(node);
```

Detalles que hay que resolver:

- **`AudioWorklet`, no `ScriptProcessor`** (obsoleto y con *jank* en el hilo
  principal). Sin build step es trivial: es un `.js` servido tal cual.
- **Remuestreo**: si el navegador ignora `sampleRate: 16000` (Safari lo ha hecho
  históricamente, fija 44.1/48 kHz), hay que remuestrear en el worklet. Un
  decimado lineal es suficiente para voz.
- **Float32 → Int16**: `Math.max(-1, Math.min(1, s)) * 0x7FFF`, little-endian.
- **Base64**: Inworld pide el chunk en base64 dentro de un JSON. Reutilizar la
  técnica por bloques que ya existe en `crypto.js` (`bufToB64`) para no reventar
  la pila con `String.fromCharCode(...)`.
- **Tamaño de chunk**: 100–200 ms (1600–3200 muestras). Menos, y el coste por
  mensaje domina; más, y se nota el retardo.
- **HTTPS obligatorio** para `getUserMedia`. GitHub Pages y el dominio propio ya
  lo son; en local, `localhost` cuenta como seguro.
- **Móvil**: pantalla apagada o pestaña en segundo plano suspende el
  `AudioContext`. Hay que avisar al usuario y/o usar un `wakeLock` (API
  `navigator.wakeLock`, degradable en silencio).

### 4.4 ¿Directo o por el proxy?

Como con el LLM, hay dos caminos y la app ya sabe elegir entre ellos:

**Modo directo (GitHub Pages)** — el navegador abre el WebSocket contra Inworld
con la clave BYOK del usuario. Es lo único posible sin servidor y es coherente
con lo que ya hacemos en `api.js`. La clave va en la query string: hay que
decirlo explícitamente en Ajustes.

**Modo proxy (self-hosted)** — lo deseable sería que el navegador hablara con
nuestro proxy y este relevara hacia Inworld, para que la clave de servidor nunca
salga. Coste real de eso:

- Node 22 trae `WebSocket` **cliente** global (sirve para la pata proxy→Inworld).
- No trae **servidor** WebSocket. Habría que implementar el handshake RFC 6455 y
  el *framing* a mano sobre `server.on('upgrade')`: ~150 líneas de stdlib
  (Sec-WebSocket-Accept con SHA-1, máscaras, fragmentación, ping/pong, cierre).
  Es código conocido y aburrido, pero es código que hay que mantener.
- Alternativa más barata: aceptar el audio por `POST` en trozos de ~1 s y
  responder por SSE, reutilizando `openSse()` que ya existe. Añade ~1 s de
  latencia y pierde los parciales, pero es **cero** código de protocolo.

Recomendación: **empezar solo con modo directo/BYOK**. El relevo por WebSocket en
el proxy es la pieza más cara del proyecto y solo aporta ocultar una clave de
servidor que hoy no existe para STT.

### 4.5 Flujo completo

```
micrófono → getUserMedia → AudioWorklet(PCM16 16 kHz) → chunks de 100 ms
    → WebSocket a Inworld ──► parciales  → línea gris al final del rollo
                          └─► finales    → línea fija, con hora
                                            └─ clic → runAnalysis({text, direction:'direct'})
                                                        → panel de resultados de siempre
```

El punto 3 del caso de uso sale casi gratis: `runAnalysis` en `app.js` ya hace
todo (deduplica en vuelo, guarda en historial, pinta), solo hay que llamarla con
el texto del segmento.

---

## 5. La interfaz

Un botón nuevo junto a los paneles de entrada: **"Modo Clase"**. Al activarlo:

- Pide permiso de micrófono (una vez) y muestra un indicador de estado con nivel
  de audio, para saber si te está oyendo.
- El rollo ocupa la columna de entrada: líneas finales en blanco, hipótesis en
  curso en gris más tenue al final, autoscroll con "pausar autoscroll" al hacer
  scroll hacia arriba.
- Cada línea final es clicable → análisis completo en el panel derecho, que sigue
  funcionando exactamente igual (incluido el historial).
- Botón "Copiar transcripción" y "Descargar .txt" al terminar la clase.
- Contador de minutos transcritos (para BYOK, el usuario paga y debe verlo).

Reutiliza `telemetry.js`: emitir `stt-start`, `stt-final`, `stt-error` para que el
Modo Dev muestre latencia real de la transcripción sin tocar producción.

---

## 6. Traducción corrida (el punto 4)

Traducir *todo* con el análisis completo actual es inviable: cada llamada tarda
segundos, devuelve un JSON grande y hay una frase final cada 3–5 segundos. Una
clase de 90 minutos serían ~1200 llamadas.

Opciones, de menos a más ambiciosa:

1. **No hacerlo.** Clic → análisis bajo demanda. Es el 90 % del valor por el 5 %
   del coste. **Recomendada para la primera versión.**
2. **Modo "solo traducción"**: un segundo prompt, minúsculo, que recibe N frases
   finales agrupadas (~10 s de audio) y devuelve solo la traducción en texto
   plano. Con un modelo *flash* son décimas de segundo y céntimos por clase.
   Requiere un `prompts/translate.v1.md` y una ruta o un flag nuevo, y —por la
   duplicación conocida del proyecto— la copia correspondiente en `api.js`.
3. Traducción en el propio proveedor de STT (varios ofrecen *speech translation*).
   Menos control sobre la calidad y nos ata al proveedor.

Ojo con el rate limit del proxy (20/min): la opción 2 agrupando cada ~10 s da 6
llamadas/min, cabe. Traducir frase a frase, no.

---

## 7. Costes

Clase de 90 minutos, transcripción continua:

| Concepto | Coste |
|---|---|
| Web Speech API | $0 |
| Inworld a $0.35/h | ~$0.53 |
| Inworld a $0.10/h (volumen) | ~$0.15 |
| + traducción corrida (opción 6.2, modelo flash) | céntimos |
| + análisis bajo demanda (~20 clics por clase) | igual que hoy |

Es decir: entre gratis y medio dólar por clase. No es el factor decisivo; el
factor decisivo es la **calidad con audio de aula** y la fricción de pedirle una
segunda clave al usuario.

---

## 8. Riesgos y cuestiones abiertas

- **Legal / consentimiento.** Transcribir a una persona identificable en clase.
  Mitigación: no persistir audio en ningún momento (solo texto, y solo en el
  navegador), avisarlo en la propia interfaz, y dejar claro que la transcripción
  no se guarda en ningún servidor nuestro. En modo directo/BYOK el audio va al
  proveedor del usuario; hay que decirlo.
- **Calidad real en aula.** Es la incógnita que decide si esto sirve. Un móvil a
  cuatro metros, con eco y ruido de sillas, no es el escenario de las demos.
  **Hay que medirlo con una grabación real antes de invertir en la integración
  completa.**
- **Clave en query string** (§3.2). Documentarlo en Ajustes.
- **Batería y suspensión** en móvil durante 90 minutos.
- **Segunda clave que pedir al usuario.** Fricción notable; refuerza empezar por
  Web Speech, que no pide nada.
- **Duplicación del código.** El proyecto ya arrastra la duplicación
  prompt/validación entre servidor y cliente. El diseño de §4 evita añadir una
  segunda: todo el STT vive solo en el cliente.

---

## 9. Plan por fases

**Fase 0 — Prototipo Web Speech (~1 día).** `stt/index.js` + `stt/webspeech.js`
+ `live.js` con el rollo y el clic→analizar. Sin claves, sin coste, desplegable
en Pages el mismo día. Sirve para validar lo único que importa de verdad: si la
vista de subtítulos + análisis bajo demanda es útil en una clase real.

**Fase 1 — Medición.** Grabar 10 minutos de clase real y pasarlos por Web Speech
y por dos o tres `modelId` de Inworld. Comparar tasa de error de palabra. Decide
si la fase 2 vale su coste.

**Fase 2 — Adaptador Inworld.** `capture.js` + `pcm-worklet.js` + `stt/inworld.js`,
en modo directo/BYOK, con la clave en Ajustes y el contador de minutos. El
contrato de §4.1 hace que `live.js` no cambie ni una línea.

**Fase 3 (opcional) — Traducción corrida** (§6.2) y relevo WebSocket en el proxy
(§4.4) si aparece la necesidad de una clave de servidor.

---

## Fuentes

- [Inworld — Speech-to-Text: Realtime Streaming STT API](https://inworld.ai/speech-to-text)
- [Inworld — Transcribe audio (WebSocket), referencia de API](https://docs.inworld.ai/api-reference/sttAPI/speechtotext/transcribe-stream-websocket)
