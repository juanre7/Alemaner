import test from 'node:test';
import assert from 'node:assert';
import { bufToB64, b64ToBuf } from './crypto.js';

test('bufToB64 and b64ToBuf utilities', async (t) => {
  await t.test('bufToB64 converts empty buffer to empty base64', () => {
    const buf = new Uint8Array(0).buffer;
    const b64 = bufToB64(buf);
    assert.strictEqual(b64, '');
  });

  await t.test('b64ToBuf converts empty base64 to empty buffer', () => {
    const buf = b64ToBuf('');
    assert.strictEqual(buf.length, 0);
  });

  await t.test('bufToB64 converts simple string', () => {
    const text = 'hello';
    const buf = new Uint8Array(text.split('').map(c => c.charCodeAt(0))).buffer;
    const b64 = bufToB64(buf);
    assert.strictEqual(b64, btoa('hello')); // aGVsbG8=
  });

  await t.test('b64ToBuf converts to simple string buffer', () => {
    const b64 = btoa('hello');
    const buf = b64ToBuf(b64);
    assert.strictEqual(buf.length, 5);
    const text = Array.from(buf).map(b => String.fromCharCode(b)).join('');
    assert.strictEqual(text, 'hello');
  });

  await t.test('handles high byte values correctly', () => {
    // ArrayBuffer with bytes 0-255
    const bytes = new Uint8Array(256);
    for (let i = 0; i < 256; i++) {
      bytes[i] = i;
    }
    const buf = bytes.buffer;

    // Convert to b64
    const b64 = bufToB64(buf);

    // Convert back to buf
    const newBuf = b64ToBuf(b64);

    // Assert length
    assert.strictEqual(newBuf.length, 256);

    // Assert all values match
    for (let i = 0; i < 256; i++) {
      assert.strictEqual(newBuf[i], i);
    }
  });
});
