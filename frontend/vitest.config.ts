import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    // jsdom, not node: dashboardLayoutSlice.ts transitively imports shared/config.ts, which
    // reads `window` at module load time (backend port / hostname lookup). Plain 'node' throws
    // "window is not defined" before the reducer under test ever runs.
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
    // These deliberately use node:test, not Vitest (relative imports, no aliasing needed) —
    // Vitest would collect them and fail with "no test suite found" if not excluded here.
    exclude: [
      'src/shared/i18n/languageSync.test.ts',
      'src/shared/browserSettle.test.ts',
      'src/shared/captureWithTimeout.test.ts',
      'src/shared/interactiveRanking.test.ts',
    ],
  },
});
