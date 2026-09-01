import { defineConfig } from 'vitest/config';

// Node-only unit/integration tests for the engine (split.ts's pure routing-table logic, plus
// server.ts's proxy behavior against a throwaway fake backend -- see src/server.test.ts). Nothing
// here spawns the real Python backend; that path is exercised for real by the ENG-1 gate
// (scripts/run-contract-tests-via-engine.mjs / npm run e2e:golden-turn:engine), not by this suite.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
