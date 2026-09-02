// engine/src/agents/pyJson.test.ts -- AGT-3. Confirms pyJsonStringify matches Python's json.dumps
// default (compact, ', '/': ' separators) formatting, including the float-vs-int rendering quirk
// FLOAT_FIELDS exists for.

import { describe, expect, it } from 'vitest';
import { pyJsonStringify } from './pyJson';

describe('pyJsonStringify', () => {
  it('uses compact ", " / ": " separators like json.dumps(obj) with no indent', () => {
    expect(pyJsonStringify({ a: 1, b: 2 })).toBe('{"a": 1, "b": 2}');
  });

  it('renders null, booleans, and empty containers like Python', () => {
    expect(pyJsonStringify({ a: null, b: true, c: false, d: [], e: {} })).toBe('{"a": null, "b": true, "c": false, "d": [], "e": {}}');
  });

  it('preserves key insertion order (mirrors pydantic field-declaration order)', () => {
    expect(pyJsonStringify({ z: 1, a: 2 })).toBe('{"z": 1, "a": 2}');
  });

  it('forces a ".0" suffix on a whole-number FLOAT_FIELDS value, matching json.dumps(0.0) == "0.0"', () => {
    expect(pyJsonStringify({ cost_usd: 0 })).toBe('{"cost_usd": 0.0}');
  });

  it('leaves a non-whole FLOAT_FIELDS value alone (already has a decimal)', () => {
    expect(pyJsonStringify({ compact_threshold_pct: 0.65 })).toBe('{"compact_threshold_pct": 0.65}');
  });

  it('does NOT force a decimal on a plain int-typed field with the same numeric value', () => {
    expect(pyJsonStringify({ context_window: 200000 })).toBe('{"context_window": 200000}');
  });

  it('nests arrays and objects correctly', () => {
    expect(pyJsonStringify({ messages: [{ id: 'x', tokens: null }] })).toBe('{"messages": [{"id": "x", "tokens": null}]}');
  });
});
