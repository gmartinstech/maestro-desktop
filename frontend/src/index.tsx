// MUST stay the first import: it carries the pre-rebrand localStorage keys over on import, and
// modules further down the graph (store slices, i18n, ThemeContext) read those keys at init.
import './shared/legacyStorageKeys';
import React from 'react';
import { createRoot } from 'react-dom/client';
import Main from './app/Main';
import ErrorBoundary from './app/components/feedback/ErrorBoundary';
import { ensureAuthToken } from './shared/config';
import { runStartupMigrations } from './shared/migrations';
import { shouldMountAfterAuth } from './shared/bootstrapAuth';
import { hasNativeShell } from './shared/shell';
import './shared/i18n/i18n';

// Must run before ensureAuthToken reads localStorage; v1.0.31 migration force-clears auth+onboarding so the stale token doesn't survive.
runStartupMigrations();

// 3s timeout so a missing Electron bridge (plain-browser dev) doesn't hang; 401 in that case is intentional.
async function bootstrap() {
  try {
    const token = await Promise.race([
      ensureAuthToken(),
      new Promise<string>((resolve) => setTimeout(() => resolve(''), 3000)),
    ]);
    const packaged = hasNativeShell;
    if (!shouldMountAfterAuth({ packaged, token })) {
      throw new Error('Electron backend authorization token was not ready before React bootstrap');
    }
  } catch {}
  const root = document.getElementById('root')!;
  createRoot(root).render(
    <ErrorBoundary scope="root">
      <Main />
    </ErrorBoundary>
  );
}
bootstrap();
