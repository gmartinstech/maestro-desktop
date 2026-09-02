// engine/src/apps/skillRegistry/secretScan.ts -- SUB-2, a full TypeScript port of
// backend/common/secret_scan.py: shared secret-shape scanner, spots credential-shaped literals in
// text/files.
//
// Lives under skillRegistry/ for now because skill_registry_sources.ts (this ticket's own scope)
// is its first TypeScript caller -- the Python original lives in backend.common so the .swarm
// importer, the skills registry, and the settings redactor all pull it DOWN from one place
// instead of one feature app reaching sideways into another (its own module doc says so).
// Whichever later ticket ports swarm/redact.py or settings/redaction.py should import THIS file
// rather than re-porting the same regexes a second time; relocate it to a shared `engine/src/
// common/` if/when a second consumer lands, rather than duplicating.
//
// It catches a secret by its SHAPE (sk-ant-..., ghp_..., AIza...), which is the fail-safe behind
// name-based redaction: a key that's misnamed (so a name rule misses it) still gets caught by its
// shape.

export const REDACTED = '[redacted]';

// Literal-secret shapes someone might paste into a file, skill body, or setting.
const SECRET_SHAPE_PATTERNS: readonly RegExp[] = [
  /sk-ant-[A-Za-z0-9_-]{16,}/,
  /sk-[A-Za-z0-9_-]{16,}/,
  /AIza[A-Za-z0-9_-]{20,}/, // Google API key shape
  /gh[pousr]_[A-Za-z0-9]{20,}/, // GitHub tokens
  /Bearer\s+[A-Za-z0-9._-]{16,}/,
];

/** True if `text` contains a credential-shaped literal. */
export function looksSecret(text: string): boolean {
  return SECRET_SHAPE_PATTERNS.some((p) => p.test(text));
}

/** Replace every secret-shaped literal in `text` with the redacted marker. */
export function redactSecretShapes(text: string): string {
  let out = text;
  for (const p of SECRET_SHAPE_PATTERNS) {
    out = out.replace(new RegExp(p.source, 'g'), REDACTED);
  }
  return out;
}

/** Paths of any file whose text body holds a secret-shaped literal. Binary files (a null byte in
 * the first 4KB) are skipped, they aren't pasted text. */
export function findSecretsInFiles(files: Record<string, Buffer | Uint8Array>): string[] {
  const hits: string[] = [];
  for (const [path, data] of Object.entries(files)) {
    const head = data.subarray(0, 4096);
    if (head.includes(0)) continue;
    if (looksSecret(Buffer.from(data).toString('utf8'))) hits.push(path);
  }
  return hits;
}
