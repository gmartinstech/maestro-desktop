// Placeholder shown when a session has no real title yet (draft state, or the
// ~500ms-2s window between launch and the aux-LLM title landing).
export const SESSION_NAME_PLACEHOLDER = 'New chat';

// Old backend default was `Agent-<6-hex>`. Catch any session loaded from a
// pre-fix on-disk record so the hex id never reaches the UI.
const LEGACY_AUTO_NAME = /^Agent-[a-f0-9]{4,8}$/i;

export function isLegacyAutoName(name: string | null | undefined): boolean {
  return !!name && LEGACY_AUTO_NAME.test(name);
}

export function displaySessionName(name: string | null | undefined): string {
  if (!name || isLegacyAutoName(name)) return SESSION_NAME_PLACEHOLDER;
  return name;
}

// Used by reducers to normalize the legacy auto-name out at intake.
export function normalizeSessionName(name: string | null | undefined): string {
  if (!name || isLegacyAutoName(name)) return '';
  return name;
}
