import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAnalysis } from '../shared/analysis.js';

test('validateAnalysis: Invalid Input Types', async (t) => {
  const invalidInputs = [
    undefined,
    null,
    'string',
    123,
    true,
    [],
  ];

  for (const input of invalidInputs) {
    await t.test(`should fail for type ${Object.prototype.toString.call(input)}`, () => {
      const res = validateAnalysis(input);
      assert.deepEqual(res, { ok: false, error: 'La respuesta no es un objeto JSON' });
    });
  }
});

test('validateAnalysis: notFound handling', async (t) => {
  await t.test('should return early with notFound if valid note is provided', () => {
    const raw = {
      notFound: { note: 'Esta palabra no existe.' },
      detectedLang: 'de'
    };
    const res = validateAnalysis(raw);
    assert.deepEqual(res, {
      ok: true,
      value: {
        notFound: { note: 'Esta palabra no existe.' },
        detectedLang: 'de'
      }
    });
  });

  await t.test('should default detectedLang to "de" if not provided or invalid in notFound case', () => {
    const raw = {
      notFound: { note: 'No encontrado' },
      detectedLang: 'invalid_lang'
    };
    const res = validateAnalysis(raw);
    assert.equal(res.value.detectedLang, 'de');
  });

  await t.test('should proceed normally if notFound is malformed (e.g. empty string note)', () => {
    const raw = {
      notFound: { note: '  ' }, // empty/whitespace string
      // missing other fields will trigger an error
    };
    const res = validateAnalysis(raw);
    assert.equal(res.ok, false);
    assert.equal(res.error, 'Falta el campo "translation"');
  });
});

test('validateAnalysis: Missing Required Fields', async (t) => {
  const baseValid = {
    translation: 'Hola',
    detectedLang: 'de',
    pronunciation: 'jo-la',
    grammarNotes: ['nota 1'],
    vocabulary: [{ german: 'Hallo', meaning: 'Hola' }],
    alternatives: ['Guten Tag'],
    examples: [{ german: 'Hallo, wie gehts?', spanish: 'Hola, ¿cómo estás?' }]
  };

  await t.test('should fail if translation is missing or empty', () => {
    const raw = { ...baseValid, translation: '   ' };
    const res = validateAnalysis(raw);
    assert.deepEqual(res, { ok: false, error: 'Falta el campo "translation"' });
  });

  await t.test('should fail if detectedLang is missing or invalid', () => {
    const raw = { ...baseValid, detectedLang: 'it' }; // 'it' is not in LANGS
    const res = validateAnalysis(raw);
    assert.deepEqual(res, { ok: false, error: 'Campo "detectedLang" inválido' });
  });

  await t.test('should fail if pronunciation is missing', () => {
    const raw = { ...baseValid };
    delete raw.pronunciation;
    const res = validateAnalysis(raw);
    assert.deepEqual(res, { ok: false, error: 'Falta el campo "pronunciation"' });
  });

  await t.test('should fail if grammarNotes is missing', () => {
    const raw = { ...baseValid };
    delete raw.grammarNotes;
    const res = validateAnalysis(raw);
    assert.deepEqual(res, { ok: false, error: 'Falta el campo "grammarNotes"' });
  });

  await t.test('should fail if vocabulary is missing', () => {
    const raw = { ...baseValid };
    delete raw.vocabulary;
    const res = validateAnalysis(raw);
    assert.deepEqual(res, { ok: false, error: 'Falta el campo "vocabulary"' });
  });

  await t.test('should fail if alternatives is missing', () => {
    const raw = { ...baseValid };
    delete raw.alternatives;
    const res = validateAnalysis(raw);
    assert.deepEqual(res, { ok: false, error: 'Falta el campo "alternatives"' });
  });

  await t.test('should fail if examples is missing', () => {
    const raw = { ...baseValid };
    delete raw.examples;
    const res = validateAnalysis(raw);
    assert.deepEqual(res, { ok: false, error: 'Falta el campo "examples"' });
  });
});

test('validateAnalysis: Optional Fields Normalization', async (t) => {
  const baseValid = {
    translation: 'Hola',
    detectedLang: 'de',
    pronunciation: 'jo-la',
    grammarNotes: ['nota 1'],
    vocabulary: [{ german: 'Hallo', meaning: 'Hola' }],
    alternatives: ['Guten Tag'],
    examples: [{ german: 'Hallo', spanish: 'Hola' }]
  };

  await t.test('should handle valid correction', () => {
    const raw = {
      ...baseValid,
      correction: { original: 'Holo', corrected: 'Hallo', note: 'Typo' }
    };
    const res = validateAnalysis(raw);
    assert.deepEqual(res.value.correction, {
      original: 'Holo',
      corrected: 'Hallo',
      note: 'Typo'
    });
  });

  await t.test('should normalize invalid correction to null', () => {
    const raw = { ...baseValid, correction: { corrected: '  ' } }; // empty corrected string
    const res = validateAnalysis(raw);
    assert.equal(res.value.correction, null);
  });

  await t.test('should filter translations list correctly', () => {
    const raw = {
      ...baseValid,
      translations: [
        { lang: 'es', text: 'Hola', note: 'común' }, // valid
        { lang: 'de', text: 'Hallo' }, // invalid lang
        { lang: 'en', text: '   ' }, // empty text
        null
      ]
    };
    const res = validateAnalysis(raw);
    assert.deepEqual(res.value.translations, [
      { lang: 'es', text: 'Hola', note: 'común' }
    ]);
  });

  await t.test('should default translations to empty array if omitted or not an array', () => {
    const raw = { ...baseValid, translations: "not an array" };
    const res = validateAnalysis(raw);
    assert.deepEqual(res.value.translations, []);
  });

  await t.test('should filter etymology correctly', () => {
    const raw = {
      ...baseValid,
      etymology: [
        { german: 'Hallo', origin: 'Proto-Germanic' }, // valid
        { german: 'Hallo', origin: '   ' }, // invalid origin
        null
      ]
    };
    const res = validateAnalysis(raw);
    assert.deepEqual(res.value.etymology, [
      { german: 'Hallo', origin: 'Proto-Germanic' }
    ]);
  });
});

test('validateAnalysis: Valid Objects', async (t) => {
  await t.test('should fully parse a valid analysis object', () => {
    const raw = {
      translation: 'El perro',
      detectedLang: 'de',
      correction: null,
      pronunciation: 'dea jund',
      translations: [
        { lang: 'es', text: 'El perro', note: '' },
        { lang: 'en', text: 'The dog', note: '' }
      ],
      grammarNotes: ['Sustantivo masculino', 'Nominativo'],
      vocabulary: [
        { german: 'der', meaning: 'el', category: 'artículo' },
        { german: 'Hund', meaning: 'perro', category: 'sustantivo' },
        { invalid: 'element' } // should be filtered out
      ],
      etymology: [],
      alternatives: ['Das Hündchen'],
      examples: [
        { german: 'Der Hund bellt.', spanish: 'El perro ladra.' }
      ]
    };

    const res = validateAnalysis(raw);
    assert.equal(res.ok, true);
    assert.deepEqual(res.value, {
      notFound: null,
      translation: 'El perro',
      detectedLang: 'de',
      correction: null,
      pronunciation: 'dea jund',
      translations: [
        { lang: 'es', text: 'El perro', note: '' },
        { lang: 'en', text: 'The dog', note: '' }
      ],
      grammarNotes: ['Sustantivo masculino', 'Nominativo'],
      vocabulary: [
        { german: 'der', meaning: 'el', category: 'artículo' },
        { german: 'Hund', meaning: 'perro', category: 'sustantivo' }
      ],
      etymology: [],
      alternatives: ['Das Hündchen'],
      examples: [
        { german: 'Der Hund bellt.', spanish: 'El perro ladra.' }
      ]
    });
  });
});
