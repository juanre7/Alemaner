// Bus de eventos mínimo. La app emite siempre (coste despreciable);
// solo el Modo Dev (si está cargado) escucha y pinta la telemetría.

const listeners = new Set();

export const bus = {
  emit(type, data) {
    for (const fn of listeners) {
      try { fn(type, data); } catch { /* un listener roto no afecta a la app */ }
    }
  },
  on(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};
