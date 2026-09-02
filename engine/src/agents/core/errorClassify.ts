// engine/src/agents/core/errorClassify.ts -- AGT-4, a scoped port of backend/apps/agents/core/
// error_classify.py: ONLY the transient-capacity classifier + backoff table TurnRunner.py actually
// imports (`CAPACITY_BACKOFFS`, `capacity_retry_wait`), plus the one classifier that decision
// transitively depends on (`isTransientCapacityError`, and the NON_TRANSIENT/TRANSIENT/translation
// regexes it reads). error_classify.py's full file is NOT ported here -- `is_auth_error`,
// `is_unknown_model_error`, `is_out_of_tokens`, `is_context_pressure_death`, `is_long_context_error`,
// `parse_retry_after`, `extract_reset_hint`, `redact_for_telemetry` back the CATCH-ALL error path in
// agent_manager.py (constructing the "subscription expired" / "out of credits" / etc. system-bubble
// messages), which is a different, not-yet-ported piece of the loop (outside TurnRunner.py's own
// file list for this ticket) -- porting them here without their caller would be untested, unused
// code. Whoever ports that catch-all handler should extend this file rather than duplicate it.
//
// Exceptions are represented as plain `unknown` (JS has no typed-exception hierarchy the way Python's
// `BaseException` does), classified by stringifying via `String(exc)` the same way Python's f"{exc!s}"
// does, and (for the one Python isinstance check this file needs -- MaestroSessionExpiredError) by an
// optional `name`/`constructor.name` probe -- see `isTransientCapacityError`'s doc.

/** Patterns that indicate an upstream transient problem (overload / rate limit / infra blip), safe
 * to silently retry with backoff. Checked against the stringified exception from the SDK / CLI. */
const TRANSIENT_CAPACITY_PATTERNS =
  /(?:\b(?:429|500|502|503|504|529)\b|overloaded|service\s+(?:temporarily\s+)?unavailable|at\s+capacity|try\s+again\s+shortly|internal\s+server\s+error|rate[_\s-]?limit(?:_error)?|ECONNRESET|ETIMEDOUT|ENETUNREACH|fetch\s+failed|resource[_\s-]?exhausted|upstream\s+connect\s+error)/i;

// A first message ships the full tool schema; 9Router rewrites Anthropic tools[].input_schema into
// Gemini function_declarations / OpenAI params, and a construct it can't translate makes the
// provider 400 (INVALID_ARGUMENT) with zero tokens. That is NOT auth, reconnecting won't help, the
// request shape is wrong, so it's classified apart and stops the catch-all from showing a
// "reconnect your subscription" card for a tool-schema 400.
const TRANSLATION_ERROR_PATTERNS =
  /(?:function_declarations|invalid_argument|invalid\s+json\s+payload|unknown\s+name\b|cannot\s+find\s+field|proto\s+field|input_schema|\btools\[\d+\])/i;

// Patterns that look rate-limit-ish but are actually non-transient (user quota, auth, context-window
// tier gate). Must NOT retry -- upgrading, reauthing, or trimming context is required.
const NON_TRANSIENT_PATTERNS =
  /(?:usage\s+cap\s+exceeded|reached\s+your\s+Maestro.*plan\s+limit|no\s+active\s+subscription|subscription\s+(?:canceled|past_due)|invalid.*token|missing\s+bearer\s+token|extra\s+usage\s+is\s+required\s+for\s+long\s+context|long\s+context\s+(?:requests?\s+)?(?:requires?|not\s+(?:available|enabled))|401|403)/i;

function combinedText(exc: unknown, extraText: string): string {
  return `${String(exc)}\n${extraText}`.trim();
}

/** True when the upstream 400 is a tool-schema / protocol translation failure, not auth or
 * capacity -- mirrors `is_translation_error`. */
export function isTranslationError(exc: unknown, extraText = ''): boolean {
  const combined = combinedText(exc, extraText);
  if (!combined) return false;
  return TRANSLATION_ERROR_PATTERNS.test(combined);
}

/** Mirrors `is_transient_capacity_error`: true for a retriable upstream capacity/overload/network
 * blip, false for a non-transient (auth/quota/tier) look-alike or a translation-shaped 400. */
export function isTransientCapacityError(exc: unknown, extraText = ''): boolean {
  const combined = combinedText(exc, extraText);
  if (!combined) return false;
  if (NON_TRANSIENT_PATTERNS.test(combined)) return false;
  if (TRANSIENT_CAPACITY_PATTERNS.test(combined)) return true;
  // Pool-exhaustion copy from the Maestro proxy ("No pool capacity available. Try again shortly."),
  // matches the capacity family too.
  if (/no\s+pool\s+capacity/i.test(combined)) return true;
  return false;
}

/** Exponential-ish backoff schedule (seconds) for silently retrying a transient upstream capacity
 * error before giving up and surfacing the rate-limit pill. Mirrors `CAPACITY_BACKOFFS` exactly. */
export const CAPACITY_BACKOFFS: readonly number[] = [5, 15, 45, 90, 180];

/** Seconds to wait before retrying a transient upstream capacity error (429 / overload / 5xx /
 * network blip), or `null` when the error isn't transient or the backoff budget for this turn is
 * already spent. Keeps the retry DECISION testable; the loop owns the wait. Mirrors
 * `capacity_retry_wait` exactly, including the half-open `0 <= attempt < len(...)` bound. */
export function capacityRetryWait(exc: unknown, attempt: number, extraText = ''): number | null {
  if (isTransientCapacityError(exc, extraText) && attempt >= 0 && attempt < CAPACITY_BACKOFFS.length) {
    return CAPACITY_BACKOFFS[attempt];
  }
  return null;
}

// -- AGT-5 additions below: the four small classifiers `is_context_pressure_death` needs to check
// "no other classifier claims this death" against. Ported alone (not the rest of error_classify.py's
// catch-all-handler surface -- is_unknown_model_error's caller, parse_retry_after, extract_reset_hint,
// redact_for_telemetry stay out of scope per AGT-4's own note above) because the context-pressure
// valve is squarely this ticket's territory (session lifecycle / compaction), not AGT-6+'s.

const OUT_OF_TOKENS_PATTERNS =
  /(?:usage\s+cap\s+exceeded|reached\s+your\s+Maestro.*plan\s+limit|usage\s+limit|insufficient_quota|exceeded\s+your\s+current\s+quota|quota\s+exceeded|credit\s+balance\s+is\s+too\s+low|out\s+of\s+credits)/i;

const LONG_CONTEXT_PATTERNS =
  /(?:extra\s+usage\s+is\s+required\s+for\s+long\s+context|long\s+context\s+(?:requests?\s+)?(?:requires?|not\s+(?:available|enabled)))/i;

const AUTH_ERROR_PATTERNS = /(?:\b(?:401|403)\b|jwt\s+expired)/i;

const UNKNOWN_MODEL_PATTERNS =
  /(?:unknown\s+model|check\s+the\s+model\s+code|\b1211\b|model[_\s-]?not[_\s-]?found|does\s+not\s+exist.*model|model.*does\s+not\s+exist)/i;

/** Mirrors `is_out_of_tokens`: true for a quota/credit-exhaustion message from any provider. */
export function isOutOfTokens(exc: unknown, extraText = ''): boolean {
  const combined = combinedText(exc, extraText);
  if (!combined) return false;
  return OUT_OF_TOKENS_PATTERNS.test(combined);
}

/** Mirrors `is_long_context_error`: true for the "extra usage required for long context" 429. */
export function isLongContextError(exc: unknown, extraText = ''): boolean {
  const combined = combinedText(exc, extraText);
  if (!combined) return false;
  return LONG_CONTEXT_PATTERNS.test(combined);
}

/** Mirrors `is_auth_error`: true for a 401/403, checked by TYPE NAME for our own
 * MaestroSessionExpiredError (mirrors the Python `isinstance` check -- the SDK/CLI exception
 * hierarchy isn't available in JS, so this is the same type-name idiom `isTransientCapacityError`'s
 * doc comment already documents using for ProcessError). A translation-shaped 400 is excluded first,
 * same ordering as the Python original. */
export function isAuthError(exc: unknown, extraText = ''): boolean {
  const ctorName = (exc as { constructor?: { name?: string } } | null)?.constructor?.name;
  const name = (exc as { name?: string } | null)?.name;
  if (ctorName === 'MaestroSessionExpiredError' || name === 'MaestroSessionExpiredError') return true;
  const combined = combinedText(exc, extraText);
  if (!combined) return false;
  if (isTranslationError(exc, extraText)) return false;
  return AUTH_ERROR_PATTERNS.test(combined);
}

/** Mirrors `is_unknown_model_error`: true when the upstream rejects the model code itself. */
export function isUnknownModelError(exc: unknown, extraText = ''): boolean {
  const combined = combinedText(exc, extraText);
  if (!combined) return false;
  return UNKNOWN_MODEL_PATTERNS.test(combined);
}

/** Mirrors `is_context_pressure_death`: the CLI autocompact-thrash class -- the process compacted
 * during this turn (>=1 compact_boundary) and then died with a bare ProcessError no other
 * classifier claims. Checked by TYPE NAME (`ProcessError`), not `instanceof`, for the same reason
 * `isTransientCapacityError` is: the SDK is lazy-imported so mock mode works without it. */
export function isContextPressureDeath(exc: unknown, compactBoundaries: number, extraText = ''): boolean {
  if (compactBoundaries < 1) return false;
  const ctorName = (exc as { constructor?: { name?: string } } | null)?.constructor?.name ?? '';
  const name = (exc as { name?: string } | null)?.name ?? '';
  if (!ctorName.includes('ProcessError') && !name.includes('ProcessError')) return false;
  const claimants = [isLongContextError, isTransientCapacityError, isOutOfTokens, isAuthError, isUnknownModelError];
  for (const claimedBy of claimants) {
    if (claimedBy(exc, extraText)) return false;
  }
  return true;
}
