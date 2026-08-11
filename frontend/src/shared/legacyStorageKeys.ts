// One-time carry-over of the pre-rebrand localStorage namespaces (`openswarm-*`/`openswarm.*` and
// the parallel `self-swarm-*`) onto `maestro*`. Without this, the rename silently resets each
// user's language, theme, sidebar width and onboarding progress on first launch after upgrade.
// Runs as an import side effect so any module that reads a migrated key gets the value already
// carried over: importing this module guarantees it executed before that module's body.

// Old key -> new key. Values are copied only when the new key is still absent, so a newer write
// always wins and a second run is a no-op.
const LEGACY_KEY_RENAMES: ReadonlyArray<readonly [string, string]> = [
  ['self-swarm-language', 'maestro-language'],
  ['self-swarm-theme-mode', 'maestro-theme-mode'],
  ['openswarm-sidebar-width', 'maestro-sidebar-width'],
  ['openswarm-update-dismissed', 'maestro-update-dismissed'],
  ['openswarm.onboarding.v2', 'maestro.onboarding.v2'],
  ['openswarm.picker.recentModels', 'maestro.picker.recentModels'],
  ['openswarm.picker.recentSearches', 'maestro.picker.recentSearches'],
  ['openswarm.picker.filtersExpanded', 'maestro.picker.filtersExpanded'],
  ['openswarm.picker.collapsedGroups', 'maestro.picker.collapsedGroups'],
  ['openswarm.canvas.minimap_open', 'maestro.canvas.minimap_open'],
  ['openswarm_last_dashboard_id', 'maestro_last_dashboard_id'],
  ['openswarm_win_webview_off', 'maestro_win_webview_off'],
  ['openswarm_win_webview_pending', 'maestro_win_webview_pending'],
  ['openswarm_win_webview_crashes', 'maestro_win_webview_crashes'],
  // Carry the run-once migration flags too, or every startup migration re-fires on upgrade.
  ['openswarm.migrations.v131_force_relogin_and_reonboard', 'maestro.migrations.v131_force_relogin_and_reonboard'],
];

// Legacy keys with no successor: written by versions whose feature is gone, so just drop them.
const DEAD_LEGACY_KEYS: readonly string[] = [
  'openswarm.auth.token',
  'openswarm_onboarding_seen',
  'openswarm_walkthrough_pending',
];

let migrated = false;

/** Carry legacy-namespace localStorage onto the `maestro*` keys. Idempotent; safe to call anywhere. */
export function migrateLegacyStorageKeys(): void {
  if (migrated || typeof window === 'undefined') return;
  migrated = true;
  let store: Storage;
  try {
    store = window.localStorage;
  } catch {
    return; // localStorage throws outright in some hardened/private contexts.
  }
  for (const [oldKey, newKey] of LEGACY_KEY_RENAMES) {
    try {
      const legacy = store.getItem(oldKey);
      if (legacy === null) continue;
      if (store.getItem(newKey) === null) store.setItem(newKey, legacy);
      store.removeItem(oldKey);
    } catch {
      // Quota-exceeded / private mode: skip this key, never block the rest.
    }
  }
  for (const dead of DEAD_LEGACY_KEYS) {
    try { store.removeItem(dead); } catch { /* ignore */ }
  }
}

migrateLegacyStorageKeys();
