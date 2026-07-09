// Historial de consultas en localStorage (§4.4):
// máximo 30 registros, sin duplicados consecutivos, con el análisis completo.

const KEY = 'as_history_v1';
const MAX = 30;

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch { return []; }
}

function save(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); }
  catch { /* almacenamiento lleno o bloqueado: el historial deja de persistir */ }
}

export function listHistory() {
  return load();
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
    save(list);
    return list;
  }
  list.unshift({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    text, direction, detectedLang, analysis, elapsed,
    ts: Date.now(),
  });
  if (list.length > MAX) list.length = MAX;
  save(list);
  return list;
}

export function removeFromHistory(id) {
  const list = load().filter((item) => item.id !== id);
  save(list);
  return list;
}
