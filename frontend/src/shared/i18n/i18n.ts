import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import ptBR from './pt-BR.json';
import en from './en.json';
import '../legacyStorageKeys';

// Renamed from the legacy `self-swarm-language`; legacyStorageKeys carries the old value over.
export const LANGUAGE_STORAGE_KEY = 'maestro-language';

function getInitialLanguage(): string {
  try {
    const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (stored === 'pt-BR' || stored === 'en') return stored;
  } catch {}
  // pt-BR is the app's default language regardless of OS locale; en is the fallback.
  return 'pt-BR';
}

i18n.use(initReactI18next).init({
  resources: {
    'pt-BR': { translation: ptBR },
    en: { translation: en },
  },
  lng: getInitialLanguage(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  returnNull: false,
});

i18n.on('languageChanged', (lng) => {
  try { localStorage.setItem(LANGUAGE_STORAGE_KEY, lng); } catch {}
});

export default i18n;
