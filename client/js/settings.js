// Panel de ajustes: clave API propia (BYOK, §5.2).
// La clave vive en localStorage y se envía al proxy en una cabecera dedicada.

const KEY = 'as_api_key';

export function getApiKey() {
  try { return localStorage.getItem(KEY) || ''; }
  catch { return ''; }
}

export function initSettings() {
  const backdrop = document.getElementById('settings-backdrop');
  const openBtn = document.getElementById('settings-btn');
  const closeBtn = document.getElementById('settings-close');
  const input = document.getElementById('api-key-input');
  const saveBtn = document.getElementById('api-key-save');
  const clearBtn = document.getElementById('api-key-clear');
  const status = document.getElementById('settings-status');

  function open() {
    input.value = getApiKey();
    status.textContent = getApiKey() ? 'Hay una clave guardada en este navegador.' : '';
    backdrop.hidden = false;
    input.focus();
  }
  function close() { backdrop.hidden = true; }

  openBtn.addEventListener('click', open);
  closeBtn.addEventListener('click', close);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !backdrop.hidden) close(); });

  saveBtn.addEventListener('click', () => {
    const value = input.value.trim();
    try {
      if (value) {
        localStorage.setItem(KEY, value);
        status.textContent = 'Clave guardada en el localStorage de este navegador.';
      } else {
        localStorage.removeItem(KEY);
        status.textContent = 'Clave vacía: se usará la clave del servidor si existe.';
      }
    } catch {
      status.textContent = 'No se pudo guardar (almacenamiento no disponible).';
    }
  });

  clearBtn.addEventListener('click', () => {
    try { localStorage.removeItem(KEY); } catch { /* nada */ }
    input.value = '';
    status.textContent = 'Clave borrada de este navegador.';
  });
}
