export type SupportedLanguage = 'pt-BR' | 'en';

export interface LanguageSyncResult {
  target: SupportedLanguage;
  shouldPersistToBackend: boolean;
}

// Backend `language` is authoritative once set. A fresh install, or an upgrade whose backend
// predates this field, reports it as null/undefined; the caller's current i18n language (seeded
// from the pre-hydration localStorage hint, which already carries the legacy key forward) becomes
// the value to persist, so an existing localStorage-only choice survives into backend state and a
// truly fresh install persists the pt-BR default rather than staying unset forever.
export function resolveLanguageSync(
  currentLanguage: string,
  backendLanguage: string | null | undefined,
): LanguageSyncResult {
  if (backendLanguage === 'pt-BR' || backendLanguage === 'en') {
    return { target: backendLanguage, shouldPersistToBackend: false };
  }
  const fallback: SupportedLanguage = currentLanguage === 'en' ? 'en' : 'pt-BR';
  return { target: fallback, shouldPersistToBackend: true };
}
