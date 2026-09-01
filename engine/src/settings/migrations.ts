// engine/src/settings/migrations.ts -- ENG-3, a TypeScript port of backend/apps/settings/store.py's
// migrate_legacy_fields (+ the field-rename table it drives) and
// backend/apps/settings/maestro_picker_migration.py's migrate_picker_value, so a settings.json
// written by an old openswarm-era or pre-Maestro-rename install still round-trips correctly
// through this engine.
//
// Deliberately NOT ported here: store.py's p_migrate_provedor_ia_identity also clears a
// hand-pasted Maestro token when it looks like a JWT AND the OS credential store holds no
// matching refresh token -- that check depends on the credential store, which is ENG-4's job
// (keyring migration), not yet ported. Skipping it is safe for this ticket's own scope (the
// settings-store round trip): it only ever CLEARS provedor_ia_token, never renames or moves it,
// so the one hard requirement -- the key name itself must never change -- holds regardless. The
// stale "provedor-ia"-named custom_providers entry is still dropped below, since that cleanup is
// pure data shape and has no credential-store dependency.

// Old field name -> new field name, applied oldest-first so a two-generation-old settings.json
// chains all the way through (openswarm_auth_token -> openswarm_bearer_token ->
// maestro_bearer_token), mirroring store.py's P_LEGACY_FIELD_RENAMES exactly.
export const LEGACY_FIELD_RENAMES: readonly [string, string][] = [
  ['openswarm_auth_token', 'openswarm_bearer_token'],
  ['openswarm_bearer_token', 'maestro_bearer_token'],
  ['openswarm_proxy_url', 'maestro_proxy_url'],
];

// Deprecated pre-launch connection_mode values -- the paid tier and the zero-config trial are
// both gone; any record still carrying one of these routes as own_key, per store.py.
const LEGACY_CONNECTION_MODES = new Set(['managed', 'openswarm-pro', 'free-trial']);

// backend/apps/settings/maestro_picker_migration.py: the one persisted string shape that changed
// under the Maestro slug rename ("provedor-ia" -> "maestro").
const P_STALE_PICKER_PREFIX = 'custom/provedor-ia/';
const P_NEW_PICKER_PREFIX = 'custom/maestro/';

export function migratePickerValue(value: string): string {
  if (value.startsWith(P_STALE_PICKER_PREFIX)) {
    return P_NEW_PICKER_PREFIX + value.slice(P_STALE_PICKER_PREFIX.length);
  }
  return value;
}

function dropStaleProvedorIaProvider(raw: Record<string, unknown>): void {
  const providers = raw.custom_providers;
  if (!Array.isArray(providers)) return;
  const kept = providers.filter((cp) => {
    if (typeof cp !== 'object' || cp === null) return true;
    const name = (cp as Record<string, unknown>).name;
    return typeof name !== 'string' || name.trim().toLowerCase() !== 'provedor-ia';
  });
  if (kept.length !== providers.length) raw.custom_providers = kept;
}

// Translates deprecated pre-launch field names and the pre-rebrand openswarm_* keys into the
// production schema, mutating and returning `raw` -- direct port of store.py's
// migrate_legacy_fields (minus the credential-store-dependent JWT clearing, see module doc).
export function migrateLegacyFields(raw: Record<string, unknown>): Record<string, unknown> {
  if (typeof raw.connection_mode === 'string' && LEGACY_CONNECTION_MODES.has(raw.connection_mode)) {
    raw.connection_mode = 'own_key';
  }
  for (const [oldKey, newKey] of LEGACY_FIELD_RENAMES) {
    if (Object.prototype.hasOwnProperty.call(raw, oldKey)) {
      // A value already written under the newer name wins; the stale one is just dropped.
      const value = raw[oldKey];
      delete raw[oldKey];
      if (!Object.prototype.hasOwnProperty.call(raw, newKey)) raw[newKey] = value;
    }
  }
  dropStaleProvedorIaProvider(raw);
  const defaultModel = raw.default_model;
  if (typeof defaultModel === 'string') {
    const migrated = migratePickerValue(defaultModel);
    if (migrated !== defaultModel) raw.default_model = migrated;
  }
  // provedor_ia_token itself is never touched by name here -- it passes through raw untouched,
  // present/absent/whatever value, satisfying the "must not be renamed" constraint (models.ts's
  // PROVEDOR_IA_TOKEN_FIELD documents the same name on the read side).
  return raw;
}
