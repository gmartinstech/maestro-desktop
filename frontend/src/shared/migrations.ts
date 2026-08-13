// Runs synchronously before React mounts so state-resets land before the first selector read. Each migration is gated by a localStorage flag so it runs once per install; keep `run` idempotent.

interface Migration {
  key: string;
  description: string;
  run: () => void;
}

const MIGRATIONS: Migration[] = [
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
