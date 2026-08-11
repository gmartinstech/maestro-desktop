// Runs synchronously before React mounts so state-resets land before the first selector read. Each migration is gated by a localStorage flag so it runs once per install; keep `run` idempotent.

interface Migration {
  key: string;
  description: string;
  run: () => void;
}

const MIGRATIONS: Migration[] = [
  {
    key: 'maestro.migrations.v131_force_relogin_and_reonboard',
    description: '1.0.31: force re-login and re-walk onboarding, regardless of prior state',
    run: () => {
      // The auth-token and onboarding-seen keys only ever existed under the legacy namespace, and
      // legacyStorageKeys purges those; only the still-live onboarding state needs clearing here.
      try {
        window.localStorage.removeItem('maestro.onboarding.v2');
      } catch {
        // localStorage can throw in private mode / quota-exceeded; non-fatal.
      }
    },
  },
];

/** Run migrations that haven't fired on this install yet. Idempotent. */
export function runStartupMigrations(): void {
  if (typeof window === 'undefined') return;
  for (const m of MIGRATIONS) {
    try {
      if (window.localStorage.getItem(m.key) === 'done') continue;
      m.run();
      window.localStorage.setItem(m.key, 'done');
    } catch {
      // Don't block other migrations on one failing.
    }
  }
}
