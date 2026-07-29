import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { byteSize } from './history.js';

describe('history module - byteSize', () => {
  let originalBlob;

  beforeEach(() => {
    // Save the original Blob if it exists in the global scope
    originalBlob = globalThis.Blob;
  });

  afterEach(() => {
    // Restore the original Blob
    if (originalBlob !== undefined) {
      globalThis.Blob = originalBlob;
    } else {
      delete globalThis.Blob;
    }
  });

  test('calculates correct size for standard ASCII string', () => {
    const str = 'hello world';
    // 'hello world' is 11 bytes in UTF-8
    assert.strictEqual(byteSize(str), 11);
  });

  test('calculates correct size for multibyte string (accents)', () => {
    const str = 'café';
    // 'café' is 5 bytes in UTF-8 ('é' is 2 bytes)
    assert.strictEqual(byteSize(str), 5);
  });

  test('calculates correct size for multibyte string (emojis)', () => {
    const str = 'hello 🌍';
    // 'hello ' is 6 bytes, '🌍' (earth globe europe-africa) is 4 bytes
    assert.strictEqual(byteSize(str), 10);
  });

  test('falls back to str.length * 2 when Blob throws an error', () => {
    // Force Blob to throw an error by overriding it
    globalThis.Blob = class {
      constructor() {
        throw new Error('Blob not supported');
      }
    };

    const str = 'hello 🌍'; // length is 6 + 2 (surrogate pair for emoji) = 8
    // Fallback logic is `str.length * 2` -> 8 * 2 = 16
    assert.strictEqual(byteSize(str), 16);
  });

  test('falls back to str.length * 2 when Blob is not defined', () => {
    // Remove Blob from global scope
    delete globalThis.Blob;

    const str = 'hello'; // length is 5
    // Fallback logic is `str.length * 2` -> 5 * 2 = 10
    assert.strictEqual(byteSize(str), 10);
  });
});
