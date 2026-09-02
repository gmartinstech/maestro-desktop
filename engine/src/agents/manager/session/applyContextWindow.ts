// engine/src/agents/manager/session/applyContextWindow.ts -- AGT-5, a full port of
// backend/apps/agents/manager/session/apply_context_window.py. registry.ts's `getContextWindow`
// (AGT-1) is called directly (no DI seam needed -- it's already a pure, synchronous, ported
// function, unlike the settings/credentials pieces other AGT-5 files have to stand in for).

import type { AgentSession } from '../../core/models';
import { getContextWindow } from '../../providers/registry';
import type { SettingsWithCustomProviders } from '../../providers/registry';

/** Set a session's context_window from the provider registry for its (provider, model), so the
 * soft-cap trim, auto-compaction, and the UI percent meter line up with the model's real cap.
 * Silent fallback to the existing value keeps a bad lookup from ever breaking a session. Called at
 * every AgentSession creation, restore, and model-switch site. */
export function applyContextWindow(session: Pick<AgentSession, 'provider' | 'model' | 'context_window'>, settings?: SettingsWithCustomProviders): void {
  try {
    const cw = getContextWindow(session.provider || '', session.model || '', settings);
    if (Number.isInteger(cw) && cw > 0) {
      (session as { context_window: number }).context_window = cw;
    }
  } catch {
    // Best-effort, mirrors the Python original's logged-and-swallowed exception.
  }
}
