// Cifrado en reposo de la clave BYOK (§5.2).
//
// AVISO HONESTO: en una app 100% cliente sin contraseña esto es OFUSCACIÓN,
// no cifrado frente a un atacante con tu dispositivo. La clave de derivación
// vive en este mismo JS, así que quien tenga acceso al navegador puede
// descifrar. Su único objetivo es evitar guardar la API key en texto plano
// visible en el localStorage. La clave NUNCA sale del navegador.

const APP_SECRET = 'aleman-simultaneo::byok::v1';
const PBKDF2_ITERATIONS = 100_000;

const subtle = globalThis.crypto?.subtle;

export function isCryptoAvailable() {
  return !!subtle;
}

export function bufToB64(buf) {
  const bytes = new Uint8Array(buf);
  if (bytes.length < 65535) {
    return btoa(String.fromCharCode.apply(null, bytes));
  }
  let bin = '';
  for (let i = 0; i < bytes.length; i += 65535) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 65535));
  }
  return btoa(bin);
}

export function b64ToBuf(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function deriveKey(salt) {
  const material = await subtle.importKey(
    'raw',
    new TextEncoder().encode(APP_SECRET),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** Devuelve un sobre { v, salt, iv, ct } con la clave cifrada. */
export async function encryptSecret(plaintext) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(salt);
  const ct = await subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  return {
    v: 1,
    salt: bufToB64(salt),
    iv: bufToB64(iv),
    ct: bufToB64(ct),
  };
}

/** Descifra un sobre generado por encryptSecret. Lanza si está corrupto. */
export async function decryptSecret(envelope) {
  if (!envelope || envelope.v !== 1) throw new Error('formato desconocido');
  const salt = b64ToBuf(envelope.salt);
  const iv = b64ToBuf(envelope.iv);
  const key = await deriveKey(salt);
  const plain = await subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    b64ToBuf(envelope.ct),
  );
  return new TextDecoder().decode(plain);
}
