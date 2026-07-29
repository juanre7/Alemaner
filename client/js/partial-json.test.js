import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { tryParsePartial } from './partial-json.js';

describe('tryParsePartial', () => {
  test('returns null if there is no opening brace', () => {
    assert.equal(tryParsePartial('not a json object'), null);
    assert.equal(tryParsePartial(''), null);
    assert.equal(tryParsePartial('   '), null);
  });

  test('parses a complete, valid JSON object', () => {
    const validJson = '{"key": "value", "number": 42, "array": [1, 2, 3], "nested": {"a": true}}';
    assert.deepEqual(tryParsePartial(validJson), {
      key: 'value',
      number: 42,
      array: [1, 2, 3],
      nested: { a: true }
    });
  });

  test('ignores text before the first opening brace', () => {
    assert.deepEqual(tryParsePartial('some prefix text {"a": 1}'), { a: 1 });
  });

  test('closes unclosed objects', () => {
    assert.deepEqual(tryParsePartial('{'), {});
    assert.deepEqual(tryParsePartial('{"a": 1, "b": {"c": 2'), { a: 1, b: { c: 2 } });
  });

  test('closes unclosed string keys and assigns null value', () => {
    assert.deepEqual(tryParsePartial('{"ke'), { ke: null });
    assert.deepEqual(tryParsePartial('{"key"'), { key: null });
  });

  test('assigns null if missing value after colon', () => {
    assert.deepEqual(tryParsePartial('{"key":'), { key: null });
    assert.deepEqual(tryParsePartial('{"key":   '), { key: null });
  });

  test('closes unclosed string values', () => {
    assert.deepEqual(tryParsePartial('{"key": "val'), { key: 'val' });
  });

  test('removes trailing commas', () => {
    assert.deepEqual(tryParsePartial('{"a": 1,'), { a: 1 });
    assert.deepEqual(tryParsePartial('{"a": [1, 2,'), { a: [1, 2] });
    assert.deepEqual(tryParsePartial('{"a": 1,   \n'), { a: 1 });
  });

  test('closes deeply nested structures', () => {
    assert.deepEqual(tryParsePartial('{"a": {"b": [{"c": "d"'), { a: { b: [{ c: 'd' }] } });
  });

  test('handles hanging escape characters inside strings', () => {
    assert.deepEqual(tryParsePartial('{"a": "b\\'), { a: 'b' });
    assert.deepEqual(tryParsePartial('{"a": "b\\"'), { a: 'b"' });
  });

  test('handles escaped quotes inside strings', () => {
    assert.deepEqual(tryParsePartial('{"a": "b\\"c"'), { a: 'b"c' });
  });

  test('returns null for unparseable but brace-containing garbage', () => {
    // tryParsePartial might try to fix and then JSON.parse throws, which is caught and returns null.
    assert.equal(tryParsePartial('{ this is not valid JSON }'), null);
  });
});
