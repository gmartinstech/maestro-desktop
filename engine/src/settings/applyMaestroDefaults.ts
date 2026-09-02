// engine/src/settings/applyMaestroDefaults.ts -- SUB-10, a TypeScript port of
// backend/apps/settings/apply_maestro_defaults.py: seed Maestro into settings so it is the app's
// provider with zero configuration.
//
// Derived, never migrated: this runs on every settings load and every settings write (handler.ts's
// GET/PUT/PATCH on /api/settings, and every /api/settings/* subpath that persists a change), so a
// token arriving through PROVEDOR_IA_TOKEN is picked up without the user touching Settings, and a
// token rotated in Settings re-derives the provider entry -- which is what makes a settings write's
// custom_providers diff re-sync the 9Router node (see router/sync.ts's syncCustomProviders, called
// from the same place Python's apply_settings_update calls sync_custom_providers).
//
// Integration path is a seeded custom provider rather than a builtin-models lane: the gateway
// speaks OpenAI, the agent loop speaks Anthropic, so the wire has to cross 9Router's translator
// either way, and custom_providers already does exactly that end to end.

import { engineFetch } from '../net/http';
import type { AppSettings, CustomProvider } from './models';
import { catalogModels, MAESTRO_MODELS, refreshCatalog } from './maestroCatalog';

// backend/apps/settings/maestro.py's constants, redeclared locally per this codebase's existing
// convention (see models.ts's own header, configureProviderEnv.ts, router/sync.ts,
// streaming/handleAssistantMessage.ts -- none of these import from one shared module either).
const MAESTRO_NAME = 'Maestro';
// backend/apps/settings/credentials.py's MAESTRO_DEFAULT_PROXY_URL -- the Maestro gateway itself,
// already on net/http.ts's ALWAYS_ALLOWED_HOSTS allowlist (llm.martinstech.net).
export const MAESTRO_DEFAULT_PROXY_URL = 'https://llm.martinstech.net/v1';
const PROVEDOR_IA_TOKEN_FIELD: keyof AppSettings = 'provedor_ia_token';
const PROVEDOR_IA_TOKEN_ENV = 'PROVEDOR_IA_TOKEN';
// models.ts already exports these two under the same names -- imported (not redeclared) here
// since they're this module's own return targets, not independent leaf constants.
import { MAESTRO_DEFAULT_MODEL, FALLBACK_DEFAULT_MODEL } from './models';

/** True when `value` decodes as a 3-segment JWT (header.payload.signature), matching
 * maestro_token_status.py's token_looks_like_jwt -- redeclared locally (that module's own export
 * is deliberately not imported here to avoid a leaf-module cross-dependency, same posture as the
 * constants above). */
function tokenLooksLikeJwt(value: string): boolean {
  return value.split('.').length === 3;
}

/** The Maestro bearer: the settings field first, then PROVEDOR_IA_TOKEN. A JWT arriving via the
 * settings field is handled by the one-time upgrade migration (migrations.ts); the env var can't
 * be migrated the same way (it isn't ours to edit), so a JWT read from it here is refused on every
 * call -- it is the old vendor-installer contract, a hand-minted, non-refreshable Keycloak access
 * token, and honoring it would silently resurrect the exact broken session this flow replaced. A
 * static opaque key (`mtok_...`) from either source is a distinct credential and passes through
 * unchanged. */
export function provedorIaToken(settings: AppSettings): string | null {
  const stored = (settings[PROVEDOR_IA_TOKEN_FIELD] ?? '').toString().trim();
  if (stored) return stored;
  const envValue = (process.env[PROVEDOR_IA_TOKEN_ENV] ?? '').trim();
  if (!envValue) return null;
  if (tokenLooksLikeJwt(envValue)) return null;
  return envValue;
}

/** The managed Maestro entry; base_url reuses the one gateway constant. Models come from the
 * gateway when it has answered this session (maestroCatalog.ts), so a model added server-side
 * needs no app release; the shipped constant is the offline fallback for a cold start. */
export function maestroProvider(token: string): CustomProvider {
  const models = catalogModels() ?? MAESTRO_MODELS;
  return {
    name: MAESTRO_NAME,
    base_url: MAESTRO_DEFAULT_PROXY_URL,
    api_key: token,
    models: models.map((m) => ({ ...m })),
  };
}

function pManagedIndex(providers: readonly CustomProvider[]): number | null {
  for (let i = 0; i < providers.length; i++) {
    if ((providers[i].name ?? '').trim().toLowerCase() === MAESTRO_NAME.toLowerCase()) return i;
  }
  return null;
}

/** Upsert the Maestro provider when a token exists and keep default_model honest. Mutates and
 * returns `settings`. Idempotent, so running it on every load and every write can never accumulate
 * duplicate entries. Never deletes: a token that goes away leaves the user's existing entry alone
 * rather than silently disconnecting them. */
export function applyMaestroDefaults(settings: AppSettings): AppSettings {
  const token = provedorIaToken(settings);
  const providers = [...(settings.custom_providers ?? [])];
  const at = pManagedIndex(providers);
  if (token) {
    const managed = maestroProvider(token);
    if (at === null) {
      // First in the list so it heads the model picker: Maestro is the app's own provider, not an add-on.
      providers.unshift(managed);
    } else {
      providers[at] = managed;
    }
    settings.custom_providers = providers;
  } else if (at === null && settings.default_model === MAESTRO_DEFAULT_MODEL) {
    // No token means no Maestro entry, so the shipped default would name a model the picker cannot offer.
    settings.default_model = FALLBACK_DEFAULT_MODEL;
  }
  return settings;
}

/** backend/apps/settings/refresh_maestro_catalog.py: true when the gateway answered and `settings`
 * now carries its catalog. False on every miss (no token, rejection, dead network) with `settings`
 * untouched, so the caller keeps whatever seeding already gave it. Never throws: both callers
 * (engine boot, and a fresh Maestro sign-in) are best-effort. */
export async function refreshMaestroCatalog(settings: AppSettings): Promise<boolean> {
  const models = await refreshCatalog(provedorIaToken(settings), MAESTRO_DEFAULT_PROXY_URL);
  if (models === null) return false;
  applyMaestroDefaults(settings);
  return true;
}

// Re-exported so a caller that only wants the network probe doesn't need a second import path --
// mirrors backend/apps/settings/credentials.py's p_check_9router, used the same way (best-effort,
// short timeout) by settings_lifespan's boot decision. Kept here rather than router/process.ts:
// this is a settings-lifespan-shaped probe (a bare GET with no session state), not a supervision
// concern.
export async function checkNineRouterReachable(): Promise<boolean> {
  try {
    const response = await engineFetch('http://localhost:20128/v1/models', { method: 'GET' });
    return response.status === 200;
  } catch {
    return false;
  }
}
