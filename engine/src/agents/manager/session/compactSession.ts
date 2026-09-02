// engine/src/agents/manager/session/compactSession.ts -- AGT-5, the business logic behind
// backend/apps/agents/agents.py's `POST /sessions/{session_id}/compact` endpoint (the "Compact
// memory" button + the /compact slash command). The HTTP route itself is NOT wired here -- native
// `/api/agents/*` routing is AGT-6's milestone ("flip /api/agents + /ws/agents to native"), not
// this ticket's -- only the pure session mutation the route performs, so whoever wires the route
// has a tested function to call rather than reimplementing this logic inline.
//
// The bug this exists to guard against (backend/tests/test_compact_endpoint.py's own docstring):
// two handlers used to register the same path; the live one only set the compaction MARKER, so
// /compact never dropped the SDK session and the trim (and the distilled summary) was never
// applied -- the button silently did nothing visible. Fixed by also setting needs_fresh_session:
// the user explicitly opted into the prompt-cache loss for a real visible trim, so the next turn
// drops the SDK convo and rebuilds from history with the cutoff (and distilled summary) applied.

import type { AgentSession } from '../../core/models';
import { wsManager } from '../../core/wsManager';
import { maybeCompact } from '../contextBudget';

export interface CompactSessionResult {
  found: boolean;
  compacted: boolean;
}

/** Force a compaction boundary on `sessionId` and, if one fired, opt the session into a rebuild on
 * its next turn. Mirrors `compact_session`'s body minus the FastAPI plumbing (404 handling is the
 * caller's job via the `found` flag, same as the route translating a missing session into a 404). */
export async function compactSession(sessions: Map<string, AgentSession>, sessionId: string): Promise<CompactSessionResult> {
  const session = sessions.get(sessionId);
  if (!session) return { found: false, compacted: false };
  const fired = maybeCompact(session, true);
  if (fired) {
    session.needs_fresh_session = true;
    try {
      await wsManager.sendToSession(sessionId, 'agent:context_status', {
        session_id: sessionId,
        reason: 'compacted',
        compacted_through_msg_id: session.compacted_through_msg_id,
      } as never);
    } catch {
      // Best-effort broadcast, mirrors the route's own try/except around the WS send.
    }
  }
  return { found: true, compacted: fired };
}
