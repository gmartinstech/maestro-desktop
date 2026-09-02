// engine/src/agents/proxy/geminiSchema.test.ts -- ports backend/tests/test_v2_invariants.py's
// test_gemini_schema_normalizer_allowlists_and_folds_nullable case-for-case.

import { describe, expect, test } from 'vitest';
import { normalizeSchemaForGemini } from './geminiSchema';

describe('normalizeSchemaForGemini', () => {
  test('union type -> single type + nullable', () => {
    expect(normalizeSchemaForGemini({ type: ['string', 'null'], description: 'd' })).toEqual({
      type: 'string',
      description: 'd',
      nullable: true,
    });
  });

  test('anyOf-with-null -> chosen branch + nullable, allowed constraint preserved', () => {
    expect(
      normalizeSchemaForGemini({ anyOf: [{ type: 'integer', minimum: 0 }, { type: 'null' }] }),
    ).toEqual({ type: 'integer', minimum: 0, nullable: true });
  });

  test('forbidden keys dropped, enum kept', () => {
    expect(
      normalizeSchemaForGemini({
        type: 'object',
        additionalProperties: false,
        title: 'T',
        properties: {
          u: { type: 'string', format: 'uri', $comment: 'x', minLength: 2 },
          d: { type: 'string', enum: ['a', 'b'] },
        },
        required: ['u'],
      }),
    ).toEqual({
      type: 'object',
      properties: { u: { type: 'string' }, d: { type: 'string', enum: ['a', 'b'] } },
      required: ['u'],
    });
  });

  test('no Gemini-rejected key survives a realistic nested schema', () => {
    const FORBIDDEN = new Set([
      '$schema', '$ref', 'additionalProperties', 'title', 'default', '$comment',
      'format', 'pattern', 'minLength', 'maxLength', 'anyOf', 'oneOf', 'allOf', 'const',
    ]);
    const schema = normalizeSchemaForGemini({
      type: 'object',
      additionalProperties: false,
      $schema: 'x',
      properties: {
        filter: { anyOf: [{ type: 'object', properties: { q: { type: 'string' } } }, { type: 'null' }] },
        size: { type: ['integer', 'null'], minimum: 1, default: 10 },
        url: { type: 'string', format: 'uri', $comment: 'c' },
      },
      required: ['filter'],
    });
    const seen = new Set<string>();
    const stack: unknown[] = [schema];
    while (stack.length) {
      const n = stack.pop();
      if (Array.isArray(n)) {
        stack.push(...n);
      } else if (typeof n === 'object' && n !== null) {
        for (const k of Object.keys(n as Record<string, unknown>)) seen.add(k);
        stack.push(...Object.values(n as Record<string, unknown>));
      }
    }
    for (const k of FORBIDDEN) expect(seen.has(k)).toBe(false);
  });

  test('non-object/array input passes through untouched', () => {
    expect(normalizeSchemaForGemini('x')).toBe('x');
    expect(normalizeSchemaForGemini(null)).toBe(null);
    expect(normalizeSchemaForGemini(5)).toBe(5);
  });
});
