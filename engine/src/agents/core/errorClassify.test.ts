// engine/src/agents/core/errorClassify.test.ts -- AGT-4. Ports backend/tests/test_capacity_retry.py
// case-for-case (same TRANSIENT proxy copy, same assertions) as the required "unit coverage against
// recorded fixtures for the backoff table" -- plus direct coverage of isTransientCapacityError's
// non-transient/translation carve-outs, which the Python suite exercises indirectly through
// capacity_retry_wait but this file names explicitly since they're the one branch a byte-for-byte
// port could silently get backwards (NON_TRANSIENT_PATTERNS checked BEFORE TRANSIENT_CAPACITY_PATTERNS).

import { describe, expect, it } from 'vitest';
import {
  CAPACITY_BACKOFFS,
  capacityRetryWait,
  isAuthError,
  isContextPressureDeath,
  isOutOfTokens,
  isTransientCapacityError,
  isTranslationError,
} from './errorClassify';

// The classifier matches this proxy copy verbatim (a guaranteed-transient signal) -- same string
// backend/tests/test_capacity_retry.py uses.
const TRANSIENT = 'No pool capacity available. Try again shortly.';

describe('capacityRetryWait (ports backend/tests/test_capacity_retry.py)', () => {
  it('returns the scheduled backoff for each attempt, escalating 5 -> 15 -> 45 -> 90 -> 180', () => {
    const waits = CAPACITY_BACKOFFS.map((_, i) => capacityRetryWait(new Error(TRANSIENT), i));
    expect(waits).toEqual(CAPACITY_BACKOFFS);
  });

  it('returns null once the backoff budget is exhausted', () => {
    expect(capacityRetryWait(new Error(TRANSIENT), CAPACITY_BACKOFFS.length)).toBeNull();
    expect(capacityRetryWait(new Error(TRANSIENT), CAPACITY_BACKOFFS.length + 3)).toBeNull();
  });

  it('returns null for a negative attempt', () => {
    expect(capacityRetryWait(new Error(TRANSIENT), -1)).toBeNull();
  });

  it('never retries a non-transient error', () => {
    expect(capacityRetryWait(new Error('invalid_request_error: bad params'), 0)).toBeNull();
    expect(capacityRetryWait(new Error('a totally unrelated bug'), 0)).toBeNull();
  });

  it('picks up a transient signal that arrives only via the stderr tail (extraText)', () => {
    // The CLI's ProcessError stringifies to something generic; the real cause is in stderr.
    const generic = new Error('upstream hiccup');
    expect(capacityRetryWait(generic, 0)).toBeNull(); // nothing transient yet
    expect(capacityRetryWait(generic, 0, TRANSIENT)).toBe(5); // stderr reveals it
  });

  it.each([429, 500, 502, 503, 504, 529])('classifies a bare %i as transient', (code) => {
    expect(isTransientCapacityError(new Error(`upstream responded ${code}`))).toBe(true);
  });

  it('a non-transient look-alike (401/403/quota/tier-gate) is never classified transient, even if it also matches a transient word', () => {
    // "rate limit" language, but paired with a non-transient auth/quota tell -- NON_TRANSIENT must win.
    expect(isTransientCapacityError(new Error('rate_limit_error: invalid api key, 401 unauthorized'))).toBe(false);
    expect(isTransientCapacityError(new Error('usage cap exceeded, try again shortly'))).toBe(false);
  });

  it('a tool-schema translation 400 is not transient capacity', () => {
    expect(isTransientCapacityError(new Error('INVALID_ARGUMENT: cannot find field function_declarations[0]'))).toBe(false);
    expect(isTranslationError(new Error('INVALID_ARGUMENT: cannot find field function_declarations[0]'))).toBe(true);
  });

  it('an empty combined message classifies as non-transient/non-translation', () => {
    expect(isTransientCapacityError(new Error(''))).toBe(false);
    expect(isTranslationError(new Error(''))).toBe(false);
  });
});

// AGT-5: ports backend/tests/test_context_pressure_valve.py's four pure `is_context_pressure_death`
// predicate tests (test_predicate_*). The remaining tests in that file (test_valve_*) exercise
// agent_manager.run_agent_loop's retry wiring around this predicate -- that integration is NOT ported
// here (AgentManager.ts's real, non-mock turn loop is still AGT-6+ territory per AgentManager.ts's
// own header), only the predicate itself, which is squarely session-lifecycle/compaction territory.
class ProcessError extends Error {}

describe('isContextPressureDeath (ports backend/tests/test_context_pressure_valve.py predicates)', () => {
  it('claims a thrash death: >=1 compact boundary + an unclaimed ProcessError', () => {
    const e = new ProcessError('Command failed with exit code 1 (exit code: 1)\nError output: Check stderr output for details');
    expect(isContextPressureDeath(e, 1)).toBe(true);
    expect(isContextPressureDeath(e, 3)).toBe(true);
  });

  it('needs compaction to have happened this turn', () => {
    const e = new ProcessError('Command failed with exit code 1');
    expect(isContextPressureDeath(e, 0)).toBe(false);
  });

  it('needs an actual process death, not any exception type', () => {
    expect(isContextPressureDeath(new Error('Command failed with exit code 1'), 3)).toBe(false);
  });

  it('defers to a more specific classifier when one claims the death', () => {
    expect(isContextPressureDeath(new ProcessError('529 overloaded, try again shortly'), 3)).toBe(false);
    expect(isContextPressureDeath(new ProcessError('credit balance is too low'), 3)).toBe(false);
    expect(
      isContextPressureDeath(new ProcessError('Command failed with exit code 1'), 3, '401 authentication_error: invalid x-api-key'),
    ).toBe(false);
  });
});

describe('isOutOfTokens / isAuthError (small classifiers is_context_pressure_death depends on)', () => {
  it('isOutOfTokens matches quota/credit exhaustion copy', () => {
    expect(isOutOfTokens(new Error('credit balance is too low'))).toBe(true);
    expect(isOutOfTokens(new Error('usage cap exceeded'))).toBe(true);
    expect(isOutOfTokens(new Error('an unrelated bug'))).toBe(false);
  });

  it('isAuthError matches 401/403 and defers to translation errors', () => {
    expect(isAuthError(new Error('401 unauthorized'))).toBe(true);
    expect(isAuthError(new Error('INVALID_ARGUMENT: cannot find field function_declarations[0], 401'))).toBe(false);
  });

  it('isAuthError recognizes MaestroSessionExpiredError by type name, not string content', () => {
    class MaestroSessionExpiredError extends Error {}
    expect(isAuthError(new MaestroSessionExpiredError('anything, even no auth wording at all'))).toBe(true);
  });
});
