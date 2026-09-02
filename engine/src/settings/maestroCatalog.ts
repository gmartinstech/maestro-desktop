// engine/src/settings/maestroCatalog.ts -- SUB-10, a TypeScript port of
// backend/apps/settings/maestro_catalog.py: what Maestro actually serves, asked of the gateway
// instead of assumed.
//
// MAESTRO_MODELS below is a hand-kept list, and a hand-kept list drifts: the vendor installer
// still offers a fixed set while GET /v1/models can return more. So the catalog is fetched here
// and the constant demotes to the offline fallback, which means a model added server-side reaches
// the picker with no app release.
//
// The gateway answers with ids and nothing else -- no label, no context window -- so labels come
// from KNOWN_LABELS (else the id, prettified) and the window keeps the vendor's 128k/4096.
//
// Split in two on purpose, mirroring the Python original: parseCatalog is pure, and the cache is
// read through a *sync* accessor (catalogModels), because applyMaestroDefaults.ts's
// applyMaestroDefaults runs on every settings load and every settings write -- a network call on
// that path would block every request. Only refreshCatalog touches the network, from engine boot
// and after a token is stored/rotated.

import { engineFetch } from '../net/http';

export interface MaestroModel {
  value: string;
  label: string;
  context_window: number;
  max_completion_tokens: number;
  reasoning: boolean;
}

// backend/apps/settings/maestro.py's MAESTRO_MODELS, redeclared locally per this codebase's
// existing convention (see settings/models.ts's own header, configureProviderEnv.ts,
// streaming/handleAssistantMessage.ts, router/sync.ts) -- a leaf module never imports the
// constant from another leaf module, each just repeats it byte-for-byte.
export const MAESTRO_MODELS: readonly MaestroModel[] = [
  { value: 'maestro-fast', label: 'Maestro Fast', context_window: 128_000, max_completion_tokens: 4_096, reasoning: true },
  { value: 'maestro', label: 'Maestro', context_window: 128_000, max_completion_tokens: 4_096, reasoning: true },
  { value: 'maestro-ultra', label: 'Maestro Ultra', context_window: 128_000, max_completion_tokens: 4_096, reasoning: true },
  { value: 'maestro-code', label: 'Maestro Code', context_window: 128_000, max_completion_tokens: 4_096, reasoning: true },
];

// Long enough that startup plus a token rotation covers a working day, short enough that a model
// withdrawn server-side stops being offered the same session.
export const CATALOG_TTL_SECONDS = 900;
const P_DEFAULT_CONTEXT_WINDOW = 128_000;
const P_DEFAULT_MAX_COMPLETION_TOKENS = 4_096;
// Labels we already ship, kept verbatim so a fetched catalog is byte-identical to the constant.
const P_KNOWN_LABELS: Readonly<Record<string, string>> = {
  maestro: 'Maestro',
  'maestro-fast': 'Maestro Fast',
  'maestro-ultra': 'Maestro Ultra',
  'maestro-code': 'Maestro Code',
};
// maestro-fast is the default model, so it heads the picker whatever order the gateway serves.
const P_PREFERRED_ORDER: readonly string[] = ['maestro-fast', 'maestro', 'maestro-ultra', 'maestro-code'];

function pLabelFor(modelId: string): string {
  const known = P_KNOWN_LABELS[modelId];
  if (known) return known;
  return modelId.split('-').filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}

function pSortKey(modelId: string): [number, number, string] {
  const idx = P_PREFERRED_ORDER.indexOf(modelId);
  if (idx !== -1) return [0, idx, ''];
  return [1, 0, modelId];
}

/** Rows from an OpenAI `/v1/models` body, or null when it taught us nothing. null and empty are
 * deliberately different: null keeps the caller on its fallback, whereas an empty list would leave
 * the user a picker with no models. */
export function parseCatalog(payload: unknown): MaestroModel[] | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const data = (payload as Record<string, unknown>).data;
  if (!Array.isArray(data)) return null;
  const ids: string[] = [];
  for (const row of data) {
    if (typeof row !== 'object' || row === null) continue;
    const modelId = (row as Record<string, unknown>).id;
    if (typeof modelId !== 'string' || !modelId.trim()) continue;
    const cleaned = modelId.trim();
    if (!ids.includes(cleaned)) ids.push(cleaned);
  }
  if (ids.length === 0) return null;
  const sorted = [...ids].sort((a, b) => {
    const ka = pSortKey(a);
    const kb = pSortKey(b);
    if (ka[0] !== kb[0]) return ka[0] - kb[0];
    if (ka[1] !== kb[1]) return ka[1] - kb[1];
    return ka[2].localeCompare(kb[2]);
  });
  return sorted.map((modelId) => ({
    value: modelId,
    label: pLabelFor(modelId),
    context_window: P_DEFAULT_CONTEXT_WINDOW,
    max_completion_tokens: P_DEFAULT_MAX_COMPLETION_TOKENS,
    reasoning: true,
  }));
}

interface CachedCatalog {
  models: MaestroModel[];
  fetchedAt: number;
}

let pCachedCatalog: CachedCatalog | null = null;

/** Publish a fetched catalog to the sync readers. */
export function rememberCatalog(models: MaestroModel[], now: number = Date.now()): void {
  pCachedCatalog = { models: [...models], fetchedAt: now };
}

/** Drop the cache; the next read falls back to the shipped constant. Test-only escape hatch --
 * no runtime caller needs to un-remember a catalog once fetched. */
export function forgetCatalog(): void {
  pCachedCatalog = null;
}

/** The cached catalog while it is fresh, else null. Safe on any hot path -- no I/O, no await. */
export function catalogModels(now: number = Date.now()): MaestroModel[] | null {
  const cached = pCachedCatalog;
  if (cached === null) return null;
  const ageSeconds = (now - cached.fetchedAt) / 1000;
  if (ageSeconds > CATALOG_TTL_SECONDS) return null;
  return [...cached.models];
}

/** Fetch and cache the catalog. Never throws, never logs the token. Returns null on every miss --
 * no token, a rejection, a malformed body, a dead network -- and leaves any previously cached
 * catalog in place, because none of those is evidence the model list changed. */
export async function refreshCatalog(token: string | null | undefined, baseUrl: string, now: number = Date.now()): Promise<MaestroModel[] | null> {
  const bearer = (token ?? '').trim();
  // The gateway throttles at 10 failed auths a minute, so a tokenless probe costs more than it can return.
  if (!bearer) return null;
  const url = `${baseUrl.replace(/\/+$/, '')}/models`;
  let response: Response;
  try {
    response = await engineFetch(url, { method: 'GET', headers: { Authorization: `Bearer ${bearer}` } });
  } catch {
    return null;
  }
  if (!response.ok) return null;
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return null;
  }
  const models = parseCatalog(payload);
  if (models === null) return null;
  rememberCatalog(models, now);
  return models;
}
