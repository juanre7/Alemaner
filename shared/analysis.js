// ---------------------------------------------------------------------------
// Contrato de datos: validación del schema (§6). Compartido por el proxy
// (server/index.js) y el modo directo/BYOK del navegador (client/js/api.js).
// ---------------------------------------------------------------------------
const LANGS = new Set(['de', 'es', 'en', 'fr']);
const TRANSLATION_LANGS = new Set(['es', 'en', 'fr']);

export function validateAnalysis(raw) {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, error: 'La respuesta no es un objeto JSON' };
  }
  const out = {};

  // Palabra inexistente: respuesta corta sin análisis (el modelo se rinde con
  // una explicación). Aquí "translation" vacío es válido.
  if (raw.notFound && typeof raw.notFound === 'object'
    && typeof raw.notFound.note === 'string' && raw.notFound.note.trim()) {
    out.notFound = { note: raw.notFound.note };
    out.detectedLang = LANGS.has(raw.detectedLang) ? raw.detectedLang : 'de';
    return { ok: true, value: out };
  }
  out.notFound = null;

  if (typeof raw.translation !== 'string' || !raw.translation.trim()) {
    return { ok: false, error: 'Falta el campo "translation"' };
  }
  out.translation = raw.translation;
  out.detectedLang = LANGS.has(raw.detectedLang) ? raw.detectedLang : null;
  if (!out.detectedLang) return { ok: false, error: 'Campo "detectedLang" inválido' };
  // Corrección ortográfica sugerida por el modelo (null si la entrada era válida).
  out.correction = (raw.correction && typeof raw.correction === 'object'
    && typeof raw.correction.corrected === 'string' && raw.correction.corrected.trim())
    ? {
      original: typeof raw.correction.original === 'string' ? raw.correction.original : '',
      corrected: raw.correction.corrected,
      note: typeof raw.correction.note === 'string' ? raw.correction.note : '',
    }
    : null;

  if (typeof raw.pronunciation !== 'string') return { ok: false, error: 'Falta el campo "pronunciation"' };
  out.pronunciation = raw.pronunciation;

  // Traducción simultánea ES/EN/FR con matices (solo entrada alemana).
  // Tolerante: si el modelo lo omite, se degrada a [] en vez de reintentar.
  out.translations = Array.isArray(raw.translations)
    ? raw.translations
      .filter((t) => t && TRANSLATION_LANGS.has(t.lang) && typeof t.text === 'string' && t.text.trim())
      .map((t) => ({ lang: t.lang, text: t.text, note: typeof t.note === 'string' ? t.note : '' }))
    : [];

  if (!Array.isArray(raw.grammarNotes)) return { ok: false, error: 'Falta el campo "grammarNotes"' };
  out.grammarNotes = raw.grammarNotes.filter((n) => typeof n === 'string');

  if (!Array.isArray(raw.vocabulary)) return { ok: false, error: 'Falta el campo "vocabulary"' };
  out.vocabulary = raw.vocabulary
    .filter((v) => v && typeof v.german === 'string' && typeof v.meaning === 'string')
    .map((v) => ({ german: v.german, meaning: v.meaning, category: typeof v.category === 'string' ? v.category : '' }));

  // Etimología: opcional por diseño (palabras sueltas o términos difíciles).
  out.etymology = Array.isArray(raw.etymology)
    ? raw.etymology
      .filter((e) => e && typeof e.german === 'string' && typeof e.origin === 'string' && e.origin.trim())
      .map((e) => ({ german: e.german, origin: e.origin }))
    : [];

  if (!Array.isArray(raw.alternatives)) return { ok: false, error: 'Falta el campo "alternatives"' };
  out.alternatives = raw.alternatives.filter((a) => typeof a === 'string' && a.trim());

  if (!Array.isArray(raw.examples)) return { ok: false, error: 'Falta el campo "examples"' };
  out.examples = raw.examples
    .filter((e) => e && typeof e.german === 'string' && typeof e.spanish === 'string')
    .map((e) => ({ german: e.german, spanish: e.spanish }));

  return { ok: true, value: out };
}

export function directionHint(direction) {
  return direction === 'direct'
    ? 'Nota del sistema: el usuario ha escrito en la caja de alemán (dirección directa).'
    : 'Nota del sistema: el usuario ha escrito en la caja de español/inglés/francés (dirección inversa, traducir al alemán).';
}
