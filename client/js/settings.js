// Panel de ajustes: clave API propia (BYOK, §5.2).
// La clave se guarda CIFRADA en localStorage (nunca sale del navegador) y se
// mantiene descifrada en memoria para que getApiKey() sea síncrono. Ver
// crypto.js para el alcance real ("ofuscación", no cifrado con contraseña).

import { encryptSecret, decryptSecret, isCryptoAvailable } from './crypto.js';

const ENC_KEY = 'as_api_key_enc';   // sobre cifrado { v, salt, iv, ct }
const LEGACY_KEY = 'as_api_key';     // texto plano de versiones anteriores

// Clave descifrada en memoria durante la sesión. getApiKey() la devuelve.
let cachedKey = '';

export function getApiKey() {
  return cachedKey;
}

function readStored(key) {
  try { return localStorage.getItem(key) || ''; }
  catch { return ''; }
}

/**
 * Carga la clave desde localStorage al arrancar: descifra el sobre y migra
 * cualquier clave antigua en texto plano al formato cifrado. Debe llamarse
 * (y esperarse) antes del primer análisis.
 */
export async function loadApiKey() {
  // 1) Sobre cifrado nuevo.
  const raw = readStored(ENC_KEY);
  if (raw && isCryptoAvailable()) {
    try {
      cachedKey = await decryptSecret(JSON.parse(raw));
    } catch {
      cachedKey = '';                 // sobre corrupto o de otro origen
    }
  }

  // 2) Migración: clave antigua en texto plano → cifrarla y borrar el rastro.
  const legacy = readStored(LEGACY_KEY);
  if (legacy) {
    if (!cachedKey) cachedKey = legacy;
    await persist(cachedKey);         // reescribe cifrado (o plano si no hay crypto)
    try { localStorage.removeItem(LEGACY_KEY); } catch { /* nada */ }
  }

  return cachedKey;
}

/** Cifra y guarda el valor (o lo borra si viene vacío). Actualiza la caché. */
async function persist(value) {
  const trimmed = (value || '').trim();
  cachedKey = trimmed;
  try {
    if (!trimmed) {
      localStorage.removeItem(ENC_KEY);
      localStorage.removeItem(LEGACY_KEY);
      return;
    }
    if (isCryptoAvailable()) {
      const envelope = await encryptSecret(trimmed);
      localStorage.setItem(ENC_KEY, JSON.stringify(envelope));
      localStorage.removeItem(LEGACY_KEY);
    } else {
      // Contexto sin Web Crypto (raro fuera de http:// inseguro): mejor
      // guardar algo a perder la clave; queda en texto plano.
      localStorage.setItem(LEGACY_KEY, trimmed);
    }
  } catch { /* almacenamiento no disponible: la clave vive solo en memoria */ }
}

export async function setApiKey(value) {
  await persist(value);
  return true;
}

export async function initSettings() {
  await loadApiKey();

  const backdrop = document.getElementById('settings-backdrop');
  const openBtn = document.getElementById('settings-btn');
  const closeBtn = document.getElementById('settings-close');
  const input = document.getElementById('api-key-input');
  const saveBtn = document.getElementById('api-key-save');
  const clearBtn = document.getElementById('api-key-clear');
  const status = document.getElementById('settings-status');

  function open() {
    input.value = getApiKey();
    status.textContent = getApiKey() ? 'Hay una clave cifrada guardada en este navegador.' : '';
    backdrop.hidden = false;
    input.focus();
  }
  function close() { backdrop.hidden = true; }

  openBtn.addEventListener('click', open);
  closeBtn.addEventListener('click', close);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !backdrop.hidden) close(); });

  saveBtn.addEventListener('click', async () => {
    const value = input.value.trim();
    saveBtn.disabled = true;
    try {
      await setApiKey(value);
      status.textContent = value
        ? 'Clave cifrada y guardada en este navegador.'
        : 'Clave vacía: se usará la clave del servidor si existe.';
    } catch {
      status.textContent = 'No se pudo guardar (almacenamiento no disponible).';
    } finally {
      saveBtn.disabled = false;
    }
  });

  clearBtn.addEventListener('click', async () => {
    await setApiKey('');
    input.value = '';
    status.textContent = 'Clave borrada de este navegador.';
  });
}
