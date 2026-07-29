import { test } from 'node:test';
import assert from 'node:assert';
import { extractJson } from './json.js';

test('extractJson - pure JSON', () => {
  const input = '{"key": "value"}';
  const expected = { key: 'value' };
  assert.deepStrictEqual(extractJson(input), expected);
});

test('extractJson - markdown fences', () => {
  const input = '```json\n{"key": "value"}\n```';
  const expected = { key: 'value' };
  assert.deepStrictEqual(extractJson(input), expected);
});

test('extractJson - markdown fences without json specifier', () => {
  const input = '```\n{"key": "value"}\n```';
  const expected = { key: 'value' };
  assert.deepStrictEqual(extractJson(input), expected);
});

test('extractJson - extra text before and after', () => {
  const input = 'Here is the JSON you requested:\n```json\n{"key": "value"}\n```\nHope it helps!';
  const expected = { key: 'value' };
  assert.deepStrictEqual(extractJson(input), expected);
});

test('extractJson - extra text before and after without fences', () => {
  const input = 'Here is the JSON you requested:\n{"key": "value"}\nHope it helps!';
  const expected = { key: 'value' };
  assert.deepStrictEqual(extractJson(input), expected);
});

test('extractJson - edge case: not a string', () => {
  assert.strictEqual(extractJson(null), null);
  assert.strictEqual(extractJson(undefined), null);
  assert.strictEqual(extractJson(123), null);
  assert.strictEqual(extractJson({}), null);
});

test('extractJson - edge case: missing braces', () => {
  const input = 'just some text without braces';
  assert.strictEqual(extractJson(input), null);
});

test('extractJson - edge case: closing brace before opening brace', () => {
  const input = '} {"key": "value"}'; // indexOf('{') = 2, lastIndexOf('}') = 0 => 17
  // actually in this case start=2, end=17, slice="{"key": "value"}" which parses. Let's make one that legitimately fails
  const input2 = '} {';
  assert.strictEqual(extractJson(input2), null);
});

test('extractJson - error condition: invalid JSON', () => {
  const input = '{"key": "value"'; // missing closing brace
  assert.strictEqual(extractJson(input), null);

  const input2 = '{"key": value}'; // invalid value format
  assert.strictEqual(extractJson(input2), null);
});

test('extractJson - empty json object', () => {
    const input = '{}';
    const expected = {};
    assert.deepStrictEqual(extractJson(input), expected);
});
