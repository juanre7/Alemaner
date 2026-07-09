// Síntesis de voz alemana con speechSynthesis nativo (§4.5, §7).
// Cualquier fallo devuelve el botón a su estado pasivo sin romper la interfaz.

let activeStop = null;

export function isSupported() {
  try { return typeof window.speechSynthesis !== 'undefined'; }
  catch { return false; }
}

function pickGermanVoice() {
  try {
    const voices = window.speechSynthesis.getVoices() || [];
    return voices.find((v) => v.lang && v.lang.toLowerCase().startsWith('de')) || null;
  } catch { return null; }
}

/**
 * Lee `text` en voz alemana. onState(true|false) refleja si está hablando.
 * Pulsar de nuevo (o limpiar la caja) llama a stop().
 */
export function speak(text, onState) {
  if (!isSupported() || !text) { onState?.(false); return; }
  stop();
  try {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'de-DE';
    const voice = pickGermanVoice();
    if (voice) utterance.voice = voice;
    utterance.rate = 0.92;

    let finished = false;
    const end = () => {
      if (finished) return;
      finished = true;
      activeStop = null;
      onState?.(false);
    };
    utterance.onend = end;
    utterance.onerror = end;

    activeStop = () => {
      try { window.speechSynthesis.cancel(); } catch { /* seguro */ }
      end();
    };

    onState?.(true);
    window.speechSynthesis.speak(utterance);
  } catch {
    activeStop = null;
    onState?.(false);
  }
}

export function stop() {
  if (activeStop) activeStop();
  else if (isSupported()) {
    try { window.speechSynthesis.cancel(); } catch { /* seguro */ }
  }
}
