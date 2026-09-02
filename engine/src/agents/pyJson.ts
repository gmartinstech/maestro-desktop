// engine/src/agents/pyJson.ts -- AGT-3. A JSON serializer that renders byte-identical to Python's
// `json.dumps(obj)` (no indent, no explicit separators -> defaults to (', ', ': ')) for the plain-
// data shapes this port produces (strings/bools/null/numbers/arrays/ordered objects).
//
// Why this exists instead of plain JSON.stringify: Python's json module renders a `float` field
// that happens to hold a whole number with a forced decimal point ("cost_usd": 0.0), while
// JSON.stringify(0) always prints the bare digit ("cost_usd":0) -- JS has one `number` type, so a
// `0` that started life as a Python float and a `0` that started life as a Python int are
// indistinguishable once they reach a JS value. FLOAT_FIELDS below is the list of AgentSession/
// Message key names that are declared `float` in backend/apps/agents/core/models.py; render()
// forces the ".0" suffix only when the value under one of those keys is a whole number (a
// fractional value like 0.65 already round-trips through String() with its decimal intact).
//
// Verified against the real backend (see docs/plans/txm-status.md's AGT-3 row): the same field
// order and defaults produced `json.dumps(AgentSession(...).model_dump(mode="json"))` output that
// this serializer reproduces exactly, key-for-key, for every field the mock turn touches.

export const FLOAT_FIELDS: ReadonlySet<string> = new Set(['cost_usd', 'compact_threshold_pct', 'context_soft_cap_pct']);

function renderNumber(n: number, keyHint: string | null): string {
  if (keyHint !== null && FLOAT_FIELDS.has(keyHint) && Number.isInteger(n)) {
    return `${n}.0`;
  }
  return String(n);
}

/** Matches Python json.dumps' default ensure_ascii=True escaping closely enough for this port's
 * data (ASCII content plus the occasional real string field) -- ordinary JSON string escaping,
 * which is what JSON.stringify already does for a bare string value. Non-ASCII input would diverge
 * (Python emits \uXXXX, JSON.stringify emits the raw UTF-8 char); nothing this port serializes
 * needs that today, so it is a documented non-goal rather than a silent gap. */
function renderString(s: string): string {
  return JSON.stringify(s);
}

function render(value: unknown, depth: number, keyHint: string | null): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string') return renderString(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return renderNumber(value, keyHint);
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    return `[${value.map((v) => render(v, depth + 1, null)).join(', ')}]`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return '{}';
    return `{${entries.map(([k, v]) => `${renderString(k)}: ${render(v, depth + 1, k)}`).join(', ')}}`;
  }
  throw new Error(`pyJsonStringify: unsupported value of type ${typeof value}`);
}

/** Serializes exactly like Python's `json.dumps(value)` (compact, default (', ', ': ') separators,
 * key order = the object's own insertion order -- callers must build objects with keys already in
 * the pydantic-declared field order, mirroring how model_dump(mode="json") walks a model). */
export function pyJsonStringify(value: unknown): string {
  return render(value, 0, null);
}
