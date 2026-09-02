// engine/src/agents/proxy/geminiSchema.ts -- AGT-7, ports backend/apps/agents/proxy/
// anthropic_proxy.py's normalize_schema_for_gemini (+ its P_GEMINI_* constants) byte-for-byte.
//
// Gemini's function_declarations validator accepts only a small OpenAPI subset. A denylist was
// whack-a-mole: every new JSON Schema construct that slipped through (union `type`, anyOf,
// $comment, format, ...) was a fresh prod 400 with zero tokens in. We invert it: keep ONLY the
// keys Gemini is known to accept, and fold the two "optional" encodings Anthropic emits (a union
// `type` list, and an anyOf whose other branch is `{"type":"null"}`) into the `nullable` flag
// Gemini actually understands. Everything dropped is advisory; the model still reads it from
// `description`. The win is structural: an unknown future key can't 400 us.

export const GEMINI_ALLOWED_SCHEMA_KEYS: ReadonlySet<string> = new Set([
  'type', 'description', 'nullable', 'enum', 'items', 'properties',
  'required', 'minimum', 'maximum', 'minItems', 'maxItems',
]);

const GEMINI_NULL_TYPES: ReadonlySet<unknown> = new Set(['null', null]);

/** Allowlist-rewrite a JSON Schema node into the subset Gemini accepts. Returns a NEW node
 * (callers must assign the result); folds union/anyOf nullability into `nullable`. Never throws
 * on odd input. */
export function normalizeSchemaForGemini(node: unknown): unknown {
  if (Array.isArray(node)) {
    return node.map((v) => normalizeSchemaForGemini(v));
  }
  if (typeof node !== 'object' || node === null) {
    return node;
  }
  const obj = node as Record<string, unknown>;

  let nullable = Boolean(obj.nullable);

  // Gemini can't represent unions; collapse anyOf/oneOf/allOf to one branch. A bare
  // {"type": "null"} member just means the field is nullable.
  for (const combiner of ['anyOf', 'oneOf', 'allOf']) {
    const branches = obj[combiner];
    if (Array.isArray(branches) && branches.length > 0) {
      let picked: unknown = undefined;
      let pickedSet = false;
      for (const b of branches) {
        if (typeof b === 'object' && b !== null && !Array.isArray(b)) {
          const bo = b as Record<string, unknown>;
          const keys = Object.keys(bo);
          if (GEMINI_NULL_TYPES.has(bo.type) && keys.length === 1) {
            nullable = true;
            continue;
          }
        }
        if (!pickedSet) {
          picked = b;
          pickedSet = true;
        }
      }
      const base = typeof picked === 'object' && picked !== null && !Array.isArray(picked)
        ? normalizeSchemaForGemini(picked)
        : {};
      if (nullable && typeof base === 'object' && base !== null && !Array.isArray(base)) {
        (base as Record<string, unknown>).nullable = true;
      }
      return base;
    }
  }

  const out: Record<string, unknown> = {};
  let t = obj.type;
  if (Array.isArray(t)) { // ["string", "null"] -> "string" + nullable
    const nonNull = t.filter((x) => !GEMINI_NULL_TYPES.has(x));
    if (nonNull.length !== t.length) nullable = true;
    t = nonNull.length > 0 ? nonNull[0] : undefined;
  }
  if (t !== undefined && t !== null) out.type = t;

  for (const [k, v] of Object.entries(obj)) {
    if (k === 'type' || k === 'nullable' || !GEMINI_ALLOWED_SCHEMA_KEYS.has(k)) continue;
    if (k === 'properties' && typeof v === 'object' && v !== null && !Array.isArray(v)) {
      const props: Record<string, unknown> = {};
      for (const [pk, pv] of Object.entries(v as Record<string, unknown>)) {
        props[pk] = normalizeSchemaForGemini(pv);
      }
      out[k] = props;
    } else if (k === 'items') {
      out[k] = normalizeSchemaForGemini(v);
    } else {
      out[k] = v;
    }
  }

  if (nullable) out.nullable = true;
  return out;
}
