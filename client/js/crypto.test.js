import test from 'node:test';
import assert from 'node:assert/strict';
import { b64ToBuf, bufToB64 } from './crypto.js';

test('bufToB64 and b64ToBuf symmetry', async (t) => {
  await t.test('converts basic string correctly', () => {
    const text = 'Hello, World!';
    const buf = new TextEncoder().encode(text);
    const b64 = bufToB64(buf);

    assert.equal(typeof b64, 'string');

    const decodedBuf = b64ToBuf(b64);
    assert.deepEqual(decodedBuf, buf);

    const decodedText = new TextDecoder().decode(decodedBuf);
    assert.equal(decodedText, text);
  });

  await t.test('handles empty buffer/string', () => {
    const buf = new Uint8Array(0);
    const b64 = bufToB64(buf);

    assert.equal(b64, '');

    const decodedBuf = b64ToBuf(b64);
    assert.deepEqual(decodedBuf, buf);
  });

  await t.test('handles all byte values (0-255)', () => {
    const bytes = new Uint8Array(256);
    for (let i = 0; i < 256; i++) {
      bytes[i] = i;
    }

    const b64 = bufToB64(bytes);
    const decodedBuf = b64ToBuf(b64);

    assert.deepEqual(decodedBuf, bytes);
  });
});

test('b64ToBuf error handling', async (t) => {
  await t.test('throws on invalid characters', () => {
    assert.throws(
      () => b64ToBuf('!@#$'),
      (err) => err.name === 'InvalidCharacterError' || err.message.includes('Invalid character')
    );
  });

  await t.test('throws on invalid base64 length', () => {
    // Length % 4 == 1 is invalid base64
    assert.throws(
      () => b64ToBuf('A'),
      (err) => err.name === 'InvalidCharacterError' || err.message.includes('Invalid character')
    );
  });
});
