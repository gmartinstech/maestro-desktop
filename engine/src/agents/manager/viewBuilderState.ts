// engine/src/agents/manager/viewBuilderState.ts -- AGT-4, a faithful port of
// backend/apps/agents/manager/view_builder_state.py: cross-call view-builder render state, shared
// between the agent loop (which runs the capped render-retry, in stopHook.ts) and the post-tool
// hook (which marks a session dirty after a frontend write/install -- AGT-5's territory, not yet
// ported). Module-level singletons on purpose: the retry counter and dirty set must persist across
// turns and be the SAME objects both readers mutate.

export const VIEW_BUILDER_RENDER_MAX_RETRIES = 2;

// session_id -> consecutive view-builder render attempts (capped, then it gives up).
export const viewBuilderRenderRetryCounts = new Map<string, number>();
// session_ids whose view-builder workspace was written/installed since the last render.
export const viewBuilderDirtySessions = new Set<string>();
