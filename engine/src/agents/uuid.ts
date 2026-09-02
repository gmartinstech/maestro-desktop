// engine/src/agents/uuid.ts -- AGT-3. Matches Python's `uuid4().hex`: a 32-character lowercase hex
// string (no dashes), the id format MockAgent.py generates for every message id.
//
// Exposed as an overridable field on `uuidState` (not a bare exported function) so a test -- or the
// AGT-3 gate's own driver script -- can pin the id sequence deterministically, mirroring the same
// `routerState`-style DI seam engine/src/router/process.ts uses for its own non-deterministic
// dependencies (there: a live subprocess; here: crypto randomness).

import { randomUUID } from 'node:crypto';

export const uuidState = {
  generate: (): string => randomUUID().replace(/-/g, ''),
};

/** Python's `uuid4().hex` -- 32 lowercase hex chars, no dashes. */
export function uuidHex(): string {
  return uuidState.generate();
}
