const LANGS = new Set(['de', 'es', 'en', 'fr']);
const TRANSLATION_LANGS = new Set(['es', 'en', 'fr']);

export function directionHint(direction) {
  return direction === 'direct'
    ? 'Nota del sistema: el usuario ha escrito en la caja de aleman (direccion directa).'
    : 'Nota del sistema: el usuario ha escrito en la caja de espanol/ingles/frances (direccion inversa, traducir al aleman).';
}

export function extractJson(text) {
  if (typeof text !== 'string') return null;
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) t = fence[1].trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try { return JSON.parse(t.slice(start, end + 1)); } catch { return null; }
}

export function validateAnalysis(raw) {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, error: 'la respuesta no es un objeto JSON' };
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
    return { ok: false, error: 'falta translation' };
  }
  out.translation = raw.translation;

  out.detectedLang = LANGS.has(raw.detectedLang) ? raw.detectedLang : null;
  if (!out.detectedLang) return { ok: false, error: 'detectedLang invalido' };

  // Correccion ortografica sugerida por el modelo (null si la entrada era valida).
  out.correction = (raw.correction && typeof raw.correction === 'object'
    && typeof raw.correction.corrected === 'string' && raw.correction.corrected.trim())
    ? {
      original: typeof raw.correction.original === 'string' ? raw.correction.original : '',
      corrected: raw.correction.corrected,
      note: typeof raw.correction.note === 'string' ? raw.correction.note : '',
    }
    : null;

  if (typeof raw.pronunciation !== 'string') return { ok: false, error: 'falta pronunciation' };
  out.pronunciation = raw.pronunciation;

  // Traduccion simultanea ES/EN/FR (solo entrada alemana). Tolerante: si el
  // modelo lo omite, se degrada a [] en vez de fallar la validacion.
  out.translations = Array.isArray(raw.translations)
    ? raw.translations
      .filter((t) => t && TRANSLATION_LANGS.has(t.lang) && typeof t.text === 'string' && t.text.trim())
      .map((t) => ({ lang: t.lang, text: t.text, note: typeof t.note === 'string' ? t.note : '' }))
    : [];

  if (!Array.isArray(raw.grammarNotes)) return { ok: false, error: 'falta grammarNotes' };
  out.grammarNotes = raw.grammarNotes.filter((n) => typeof n === 'string');

  if (!Array.isArray(raw.vocabulary)) return { ok: false, error: 'falta vocabulary' };
  out.vocabulary = raw.vocabulary
    .filter((v) => v && typeof v.german === 'string' && typeof v.meaning === 'string')
    .map((v) => ({
      german: v.german,
      meaning: v.meaning,
      category: typeof v.category === 'string' ? v.category : '',
    }));

  // Etimologia: opcional por diseno (palabras sueltas o terminos dificiles).
  out.etymology = Array.isArray(raw.etymology)
    ? raw.etymology
      .filter((e) => e && typeof e.german === 'string' && typeof e.origin === 'string' && e.origin.trim())
      .map((e) => ({ german: e.german, origin: e.origin }))
    : [];

  if (!Array.isArray(raw.alternatives)) return { ok: false, error: 'falta alternatives' };
  out.alternatives = raw.alternatives.filter((a) => typeof a === 'string' && a.trim());

  if (!Array.isArray(raw.examples)) return { ok: false, error: 'falta examples' };
  out.examples = raw.examples
    .filter((e) => e && typeof e.german === 'string' && typeof e.spanish === 'string')
    .map((e) => ({ german: e.german, spanish: e.spanish }));

  return { ok: true, value: out };
}
