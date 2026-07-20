// Historial de consultas en localStorage (§4.4):
// máximo 30 registros, sin duplicados consecutivos, con el análisis completo.
//
// Cada registro guarda el análisis entero (traducción, notas, vocabulario,
// alternativas, ejemplos), así que puede rondar 2-6 KB. Además del tope de
// registros aplicamos un presupuesto en bytes: localStorage suele ofrecer ~5 MB
// por origen y compartimos ese espacio con la clave BYOK cifrada. Nos quedamos
// muy por debajo para que el navegador no se ralentice ni lance QuotaExceeded.

const KEY = 'as_history_v1';
const MAX = 30;
const MAX_BYTES = 512 * 1024; // presupuesto del historial (~0,5 MB)

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch { return []; }
}

// Tamaño aproximado en bytes del historial serializado (UTF-16 en la práctica,
// pero comparamos contra un presupuesto propio: basta con ser consistentes).
function byteSize(str) {
  try { return new Blob([str]).size; } catch { return str.length * 2; }
}

// Recorta por el final (lo más antiguo) hasta caber en el presupuesto y, si aun
// así el navegador rechaza la escritura, sigue recortando antes de rendirse.
function save(list) {
  const trimmed = list.slice(0, MAX);
  let serialized = JSON.stringify(trimmed);

  while (trimmed.length > 1 && byteSize(serialized) > MAX_BYTES) {
    trimmed.pop();
    serialized = JSON.stringify(trimmed);
  }

  while (trimmed.length > 0) {
    try {
      localStorage.setItem(KEY, serialized);
      return trimmed;
    } catch {
      // Cuota llena (puede deberse a otros datos del origen): suelta el registro
      // más antiguo y reintenta.
      trimmed.pop();
      serialized = JSON.stringify(trimmed);
    }
  }

  try { localStorage.removeItem(KEY); } catch { /* almacenamiento bloqueado */ }
  return trimmed;
}

export function listHistory() {
  return load();
}

// Bytes ocupados ahora mismo por el historial (para diagnóstico / Modo Dev).
export function historySize() {
  const raw = localStorage.getItem(KEY) || '';
  return { bytes: byteSize(raw), budget: MAX_BYTES, max: MAX };
}

export function addToHistory({ text, direction, detectedLang, analysis, elapsed }) {
  const list = load();
  const latest = list[0];
  // Sin duplicados consecutivos.
  if (latest && latest.text === text && latest.direction === direction) {
    latest.analysis = analysis;
    latest.detectedLang = detectedLang;
    latest.elapsed = elapsed;
    latest.ts = Date.now();
    return save(list);
  }
  list.unshift({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    text, direction, detectedLang, analysis, elapsed,
    ts: Date.now(),
  });
  return save(list);
}

export function removeFromHistory(id) {
  return save(load().filter((item) => item.id !== id));
}
