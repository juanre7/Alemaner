# PRD — Alemán Simultáneo

Traductor y analizador gramatical de alemán para estudiantes hispanohablantes. Proyecto open source, autohosteable. Este documento es la especificación completa para reconstruir la plataforma desde cero.

## 1. Visión

No es un traductor de texto plano: cada frase se deconstruye en traducción, pronunciación adaptada al español, explicación gramatical (declinaciones, casos, género, orden sintáctico), vocabulario clasificado, alternativas de expresión y ejemplos de uso, todo en una sola pantalla.

Valor para el usuario:

- **Análisis completo en un clic**: traducción + fonética + gramática + vocabulario + alternativas + contextos, de una vez.
- **Bidireccional sin fricción**: dos cajas de entrada independientes (Alemán → análisis; Español/EN/FR → Alemán). Sin alternar direcciones manualmente.
- **Contextualización multiidioma**: el usuario puede introducir texto en español, inglés o francés (autodetectado) y obtener el equivalente alemán. Las explicaciones se generan siempre en español.

## 2. Usuarios y modos

Acceso universal, sin registro.

**A. Estudiante (modo normal)**

Puede:
- Escribir texto libre (máx. 1000 caracteres) en cualquiera de las dos cajas.
- Limpiar cada caja individualmente (borra texto, resultados y detiene audio).
- Lanzar el análisis con el botón de cada caja.
- Usar frases prediseñadas por categoría (autocompletan y lanzan análisis).
- Escuchar la pronunciación alemana con el sintetizador de voz del navegador.
- Hacer clic en alternativas de expresión para relanzar el análisis con ellas.
- Ver, restaurar y borrar elementos del historial local.
- Introducir su propia clave API (BYOK) en el panel de ajustes.

No puede:
- Editar las frases prediseñadas.
- Guardar notas personales en los resultados.
- Exportar o compartir el historial (vive solo en el navegador).
- Superar los 1000 caracteres (bloqueo físico del input).
- Interactuar con los campos mientras hay una consulta en curso.

**B. Desarrollador (Modo Dev — solo builds de desarrollo)**

El Modo Dev **no existe en producción**: su código se excluye del bundle mediante flag de build (p. ej. `import.meta.env.DEV`). En desarrollo, añade:

- Panel de telemetría con métricas **reales** (ver §4.6).
- Toggle de streaming ON/OFF para comparar percepción de latencia.
- Selector de modelo LLM (lista servida por el proxy desde su configuración).
- Inspección de payloads request/response.
- Limpieza de la consola de telemetría.

## 3. Arquitectura de la información

Vista única (single-page), dos columnas en escritorio, apiladas en móvil.

```
[Estación de Trabajo]
 ├── Cabecera
 │    ├── Logotipo + título "Alemán Simultáneo" + subtítulo
 │    ├── Botón de Ajustes (clave API)
 │    └── Toggle Modo Dev (solo en build de desarrollo)
 │
 ├── Columna izquierda: Entrada
 │    ├── Estación de Traducción Dual (2 textareas independientes)
 │    ├── Frases Prediseñadas (filtros por categoría + rejilla de tarjetas)
 │    └── Historial de Consultas (lista cronológica, borrado individual)
 │
 └── Columna derecha: Resultados
      ├── Estado vacío / Estado de carga / Tarjeta de error
      ├── Ficha de Análisis (traducción, voz, fonética, gramática,
      │    vocabulario, alternativas, contextos)
      └── Consola de Telemetría (solo Modo Dev)
```

## 4. Especificación funcional

### 4.1. Cabecera

- Logotipo, título "Alemán Simultáneo", subtítulo "Traducción y análisis gramatical con IA".
- **Botón Ajustes**: abre un panel para pegar/borrar la clave API propia (ver §5.2).
- **Toggle Modo Dev** (solo dev): al activarlo se tiñe de púrpura con piloto pulsante y muestra/oculta el panel de telemetría, reajustando la altura de los componentes vecinos con transición fluida.

### 4.2. Estación de Traducción Dual

Tarjeta con dos paneles simétricos.

**Panel Alemán (dirección directa):**
- Etiqueta: 🇩🇪 "Alemán".
- Textarea multilínea, placeholder "Escribe palabras, frases o textos en alemán...", límite físico de 1000 caracteres.
- Contador dinámico "X / 1000". Al acercarse al límite pasa a tonos de advertencia.
- Botón flotante de limpieza ("X"), visible solo con texto. Al pulsarlo: vacía la caja, limpia resultados y errores, detiene la síntesis de voz.
- Botón principal "Analizar Alemán". Deshabilitado si la caja está vacía (o solo espacios) o si hay una consulta en curso.

**Panel Español/EN/FR (dirección inversa):**
- Etiqueta: "Español / EN / FR".
- Mismo comportamiento que el panel alemán. Placeholder: "Escribe en español, inglés o francés... para traducirlo al alemán con notas de aprendizaje...".
- Botón principal "Traducir a Alemán".
- El idioma de entrada se autodetecta en el servidor; no hay selector de idioma. Las explicaciones del análisis salen siempre en español.

Al pulsar cualquiera de los dos botones: se deshabilitan ambos, se muestra el estado de carga y se despacha la petición al proxy con `{text, direction}`.

### 4.3. Frases Prediseñadas

- Pestañas de categoría: Todos, Saludos, Viajes, Comida, Compras, Útiles. El filtrado es instantáneo (cliente).
- Rejilla auto-ajustable de tarjetas: frase en alemán en negrita + traducción simplificada en español debajo.
- Clic en tarjeta: copia la frase a la caja de alemán, vacía la caja inversa y lanza el análisis automáticamente. **Cada clic consume una llamada real al LLM.**
- Las tarjetas se deshabilitan mientras hay una consulta en curso.

### 4.4. Historial de Consultas

- Persistencia en `localStorage`, máximo 30 registros, sin duplicados consecutivos.
- Cada registro guarda: texto original, dirección, idioma detectado, fecha/hora **y el análisis completo recibido**.
- Estado vacío: ilustración + "No tienes traducciones previas en este navegador."
- Cada fila: etiqueta de dirección (DE→ES en ámbar, ES→DE en gris), texto truncado, hora corta, papelera visible al hacer hover.
- **Clic en fila: restaura la entrada y el resultado guardado sin llamada al servidor.** Cero coste, respuesta instantánea.
- Clic en papelera: elimina ese registro del almacenamiento sin afectar la consulta activa.

### 4.5. Ficha de Resultados

El panel derecho muta según el estado:

- **Vacío**: tarjeta de bienvenida con icono, "¿Listo para comenzar?" e instrucciones. Insignia "Potenciado con Inteligencia Artificial".
- **Cargando**: spinner suave con texto "Analizando...". Si el streaming está activo (Modo Dev), las secciones se pintan conforme llegan, empezando por la traducción.
- **Error**: ver §7.
- **Resultado** (aparece con fade-up):
  - **Encabezado**: insignia "Análisis completado" + tiempo de respuesta (ej. "1.42s").
  - **Traducción**: texto original en cursiva tenue; traducción en tipografía grande.
  - **Botón de audio**: icono de megáfono circular. Usa `speechSynthesis` del navegador con voz alemana. Mientras habla: color ámbar, ligera ampliación, ondas animadas. Pulsar de nuevo o limpiar la caja lo detiene. Si el navegador no soporta síntesis o falla, el botón vuelve a su estado pasivo sin romper la interfaz.
  - **Pronunciación**: recuadro con icono de oído; transcripción fonética con grafía española (ej. "Wie geht es Ihnen?" → "vi guet es ínen").
  - **Explicación gramatical**: lista con viñetas ámbar. Declinaciones, casos, géneros, conjugaciones, orden sintáctico.
  - **Vocabulario clave**: tabla de tres columnas — Alemán (ámbar, negrita), Significado, Categoría (cursiva: Sustantivo Masculino, Verbo, Preposición de Dativo...).
  - **Alternativas**: chips clicables con expresiones sinónimas en alemán. Clic: inyecta la alternativa en la caja de alemán, vacía la inversa y relanza el análisis (llamada real).
  - **Contextos de uso**: tarjetas de diálogo con frase situacional en alemán (negrita) y traducción en español (cursiva).

Todo el contenido del LLM se renderiza como **texto plano** (nunca `innerHTML`).

### 4.6. Consola de Telemetría (Modo Dev)

Estética de consola retro de alto contraste, en la parte inferior de la columna derecha. **Todas las métricas son reales; nada simulado.**

- **Cabecera**: luz de estado, título "TELEMETRÍA", dirección de la consulta.
- **Métricas de latencia**: tiempo total de la última consulta con color dinámico (verde rápido / ámbar moderado), y **TTFT (tiempo al primer token)** cuando el streaming está activo — la métrica clave para comparar modelos.
- **Fases del fetch**: desglose real vía Performance API cuando esté disponible (DNS, TLS, TTFB, descarga) más eventos de aplicación (petición enviada, primer token, respuesta completa, validación, render). Gráfico lineal SVG de tiempo acumulado por fase, con marcadores por nodo y chips de delta debajo (ej. "TTFB: 850ms · Δ +620ms").
- **Logs de eventos**: lista cronometrada de eventos reales con código de color (cliente gris, red azul, éxito verde, error rojo).
- **Payloads**: dos paneles colapsables con el Request Body y el Response JSON exactos, con resaltado de sintaxis.
- **Toggle Streaming ON/OFF**: alterna entre recibir la respuesta por SSE o de golpe (ver §5.3).
- **Selector de modelo**: dropdown poblado por `GET /api/models`. La elección se envía como campo `model` en la petición; el proxy solo la respeta en modo desarrollo.
- **Botón "Limpiar consola"**: vacía trazas y reinicia medidores.

## 5. Backend

### 5.1. Proxy único

Toda petición al LLM pasa por un proxy propio; el cliente **nunca** llama al proveedor directamente (evita exponer claves y problemas de CORS). Un servidor Node mínimo (Hono o similar).

Endpoints:

| Método | Ruta | Función |
|---|---|---|
| POST | `/api/analyze` | Recibe `{text, direction, model?}`, valida, añade el system prompt y la clave, llama al LLM, valida el schema de salida y responde (SSE o JSON según §5.3). |
| GET | `/api/models` | Lista los modelos configurados (solo se sirve en desarrollo). |

El system prompt vive versionado en el repositorio (`prompts/analyze.v1.md`), nunca en el cliente ni en este documento. Define: entrada en cualquier idioma → traducción/análisis de alemán, explicaciones siempre en español, salida ceñida al schema de §6.

El proveedor y modelo por defecto se definen en la configuración del servidor. El PRD no se casa con ningún proveedor: cualquier LLM con salida JSON estructurada sirve.

### 5.2. Gestión de claves (modo dual)

1. **BYOK**: el usuario pega su clave en el panel de ajustes. Se guarda en `localStorage` con un aviso visible de dónde queda almacenada y se envía en cada petición al proxy en una cabecera dedicada. El proxy la usa y **no la persiste ni la registra en logs**.
2. **Clave de servidor**: variable de entorno para quien autohostea.

Resolución en el proxy: clave del usuario si viene en la petición → si no, clave de entorno → si no hay ninguna, error 401 con mensaje "Configura una clave API en Ajustes".

### 5.3. Streaming con buffer

El proxy siempre pide streaming al proveedor. Un parámetro de la petición decide el modo de entrega:

- **Buffer (por defecto)**: acumula, valida el JSON completo y responde de una vez.
- **Streaming (SSE)**: retransmite los chunks; el cliente pinta secciones conforme se completan campos (el schema ordena los campos por prioridad visual, `translation` primero).

Un solo camino de código; el toggle vive en Modo Dev. La decisión de qué modo va a producción queda pendiente de benchmarks con varios modelos (comparando TTFT vs. tiempo total).

## 6. Contrato de datos

Respuesta de `/api/analyze`. Todos los campos son obligatorios (arrays vacíos si no aplica). Campos ordenados por prioridad de render:

```json
{
  "translation": "string",
  "detectedLang": "de | es | en | fr",
  "pronunciation": "string",
  "grammarNotes": ["string"],
  "vocabulary": [
    { "german": "string", "meaning": "string", "category": "string" }
  ],
  "alternatives": ["string"],
  "examples": [
    { "german": "string", "spanish": "string" }
  ]
}
```

Reglas:
- Forzado con el modo JSON / structured output del proveedor.
- Validación en el proxy antes de responder: campos conocidos obligatorios, campos desconocidos se ignoran (permite evolucionar el schema sin romper clientes viejos). Si la validación falla, un reintento; si vuelve a fallar, error al cliente.
- Añadir una funcionalidad = añadir un campo al schema + su bloque de render.

## 7. Errores y casos límite

**Validación de entrada:**
- Límite de 1000 caracteres: bloqueado físicamente en el textarea **y validado de nuevo en el proxy** (el límite del cliente es cosmético frente a peticiones directas).
- Texto vacío o solo espacios: botones deshabilitados reactivamente; el proxy también lo rechaza.

**Fallo de red, timeout o error del proveedor:**
- Se detiene el estado de carga y se conserva intacto el texto de entrada.
- Tarjeta de error en rojo suave y alto contraste: icono de alerta, título "Error de análisis", detalle del fallo y botón "Reintentar traducción" que reenvía la última petición.
- En Modo Dev: el gráfico corta la curva en el punto de fallo con la latencia acumulada real y se inyecta un log rojo `[Error] ...`.

**Fallo del sintetizador de voz:**
- Si `speechSynthesis` no existe o lanza excepción, el botón de audio vuelve a su estado pasivo de forma segura. Nunca bloquea la interfaz.

**Seguridad frente a prompt injection:**
- El texto del usuario viaja siempre como contenido de usuario, jamás concatenado al system prompt.
- La salida se valida contra el schema; respuestas fuera de formato se descartan.
- Render exclusivamente como texto plano. La app no tiene acciones ni datos sensibles que una inyección pueda explotar.

**Abuso:**
- Rate limit simple por IP en el proxy (librería estándar). Suficiente para la versión open source; cuotas y cuentas pertenecen al servicio de pago futuro.

## 8. Stack

- **Frontend**: HTML + CSS + JavaScript vanilla con ES modules, **sin paso de build** para el cliente. Debe funcionar con fluidez en hardware antiguo o modesto. La exclusión del Modo Dev en producción se resuelve en el empaquetado/despliegue del proyecto.
- **Backend**: Node con Hono (o equivalente minimalista). Un archivo pequeño, sin base de datos.
- **Sin dependencias de frontend**: nada de frameworks, routers ni gestores de estado. El gráfico de telemetría es SVG generado a mano.
- **Persistencia**: `localStorage` (historial y clave BYOK).
- **Audio**: `speechSynthesis` nativo del navegador.
- Repositorio único: `npm run dev` levanta cliente y proxy.

## 9. Diseño visual

- Fondos neutros ultra claros (slate-50), tarjetas blancas con sombras sutiles, bordes finos slate-200/60.
- Acentos interactivos (insignias, viñetas de gramática, iconos clave) en ámbar/dorado (amber-600).
- Tipografía sans-serif para texto general; monoespaciada para contadores, latencias y consola de telemetría.
- Todas las animaciones (fade-up de resultados, pulso del botón de audio, piloto del Modo Dev) en CSS puro.

## 10. Futuro (fuera de alcance)

Servicio hosteado de pago sobre esta misma base: bastaría con añadir autenticación y cuotas delante del proxy. No se especifica aquí.
