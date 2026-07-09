// Parser tolerante de JSON parcial para el modo streaming: repara el texto
// acumulado (cierra strings y brackets abiertos) para poder pintar secciones
// conforme se completan campos (§5.3). Devuelve null si aún no hay nada usable.

export function tryParsePartial(text) {
  const start = text.indexOf('{');
  if (start === -1) return null;
  const src = text.slice(start);

  let inString = false;
  let escaped = false;
  const stack = [];          // '{' o '['
  const expectKey = [];      // por cada objeto abierto: ¿estamos en posición de clave?
  let lastSig = '';          // último carácter significativo (fuera de strings)
  let lastSigIndex = -1;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') { inString = false; lastSig = '"'; lastSigIndex = i; }
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t') continue;
    lastSig = ch; lastSigIndex = i;
    if (ch === '{') { stack.push('{'); expectKey.push(true); }
    else if (ch === '[') { stack.push('['); }
    else if (ch === '}') { if (stack.pop() === '{') expectKey.pop(); }
    else if (ch === ']') { stack.pop(); }
    else if (ch === ':') { if (expectKey.length) expectKey[expectKey.length - 1] = false; }
    else if (ch === ',') {
      if (stack[stack.length - 1] === '{' && expectKey.length) expectKey[expectKey.length - 1] = true;
    }
  }

  let repaired = src;

  if (inString) {
    // String truncado: lo cerramos (quitando un escape colgante si lo hay).
    if (escaped) repaired = repaired.slice(0, -1);
    repaired += '"';
    // Si el string era una CLAVE de objeto, necesita un valor.
    if (stack[stack.length - 1] === '{' && expectKey[expectKey.length - 1]) repaired += ':null';
  } else if (lastSig === ':' ) {
    repaired += 'null';
  } else if (lastSig === ',') {
    // Coma colgante: se elimina.
    repaired = repaired.slice(0, lastSigIndex) + repaired.slice(lastSigIndex + 1);
  } else if (lastSig === '"' && stack[stack.length - 1] === '{' && expectKey[expectKey.length - 1]) {
    // Clave completa pero sin ':' todavía.
    repaired += ':null';
  }

  for (let i = stack.length - 1; i >= 0; i--) {
    repaired += stack[i] === '{' ? '}' : ']';
  }

  try { return JSON.parse(repaired); } catch { return null; }
}
