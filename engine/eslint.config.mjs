// engine/eslint.config.mjs -- ENG-7.
//
// Two jobs. First, ordinary correctness linting (mirrors frontend/eslint.config.mjs's own
// rationale: a type-aware config would triple lint time for what tsc already covers, so this
// stays non-type-aware). Second, and the reason this file exists at all: the provider-egress
// no-restricted-imports rule below, which is HALF of ENG-7's compliance guard (the other half is
// scripts/check-provider-egress.mjs's independent source scan -- see engine/src/net/http.ts's
// module doc for why it's belt-and-suspenders, not either alone).
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

// Every one of these is a way to reach the network that bypasses engine/src/net/http.ts's host
// allowlist. Banned everywhere in engine/src EXCEPT engine/src/net/ itself, which is the one place
// permitted to import/use them (http.ts's own `fetch` call is the sanctioned call site).
//
// `allowTypeImports: true` on every entry (via @typescript-eslint/no-restricted-imports, not the
// weaker core rule) lets `import type { IncomingMessage } from 'node:http'` through -- a
// type-only import performs no network I/O, and screencastServer.ts has a real, legitimate one
// (typing a raw upgrade handler's request parameter) that a blanket ban would otherwise break.
const PROVIDER_EGRESS_RESTRICTED_IMPORTS = {
  paths: [
    { name: 'node:http', allowTypeImports: true, message: 'Outbound HTTP must go through engine/src/net/http.ts (the provider-egress allowlist). See ENG-7.' },
    { name: 'http', allowTypeImports: true, message: 'Outbound HTTP must go through engine/src/net/http.ts (the provider-egress allowlist). See ENG-7.' },
    { name: 'node:https', allowTypeImports: true, message: 'Outbound HTTP must go through engine/src/net/http.ts (the provider-egress allowlist). See ENG-7.' },
    { name: 'https', allowTypeImports: true, message: 'Outbound HTTP must go through engine/src/net/http.ts (the provider-egress allowlist). See ENG-7.' },
    { name: 'undici', allowTypeImports: true, message: 'Outbound HTTP must go through engine/src/net/http.ts (the provider-egress allowlist). See ENG-7.' },
    { name: 'axios', allowTypeImports: true, message: 'Outbound HTTP must go through engine/src/net/http.ts (the provider-egress allowlist). See ENG-7.' },
    { name: 'got', allowTypeImports: true, message: 'Outbound HTTP must go through engine/src/net/http.ts (the provider-egress allowlist). See ENG-7.' },
  ],
};

// `fetch` is a bare global in Node 22+, not an import -- no-restricted-imports can't see it, hence
// the separate no-restricted-globals rule below covering the same "everywhere except net/" split.
const PROVIDER_EGRESS_RESTRICTED_GLOBALS = [
  { name: 'fetch', message: 'Outbound HTTP must go through engine/src/net/http.ts (the provider-egress allowlist). See ENG-7.' },
];

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', '*.config.mjs'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      // server.ts's proxy plumbing and the browser/CDP client both lean on precise-but-verbose
      // Node/Fastify/CDP wire types where `any` is the honest escape hatch; matches frontend's own
      // call on this same rule.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { args: 'none', ignoreRestSiblings: true }],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  {
    // The egress ban applies to every .ts file in engine/src EXCEPT engine/src/net/ itself --
    // that directory is excluded via a later, more-specific config object (flat config's
    // last-matching-object-wins semantics), not by trying to express a negative glob here.
    // Uses the typescript-eslint variant of no-restricted-imports (not the core rule) so
    // allowTypeImports above actually takes effect; the core rule is turned off to avoid a
    // duplicate report on every hit.
    files: ['src/**/*.ts'],
    rules: {
      'no-restricted-imports': 'off',
      '@typescript-eslint/no-restricted-imports': ['error', PROVIDER_EGRESS_RESTRICTED_IMPORTS],
      'no-restricted-globals': ['error', ...PROVIDER_EGRESS_RESTRICTED_GLOBALS],
    },
  },
  {
    // engine/src/net/ is the one exemption -- http.ts's own sanctioned `fetch` call site.
    files: ['src/net/**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': 'off',
      'no-restricted-globals': 'off',
    },
  },
  {
    // Test and manual-integration-check files are dev-time verification harnesses, not
    // production request-serving code -- BRW-1/BRW-3/BRW-5 already established the convention
    // of a *.integration-check.ts per module that deliberately makes a REAL loopback network call
    // to prove the module works end to end (see e.g. browser/launcher.integration-check.ts's own
    // gate), and server.test.ts spins up a throwaway node:http server + fetches its own Fastify
    // instance under test. None of this ships in the packaged app or runs on a real request path,
    // so it's exempted here rather than forcing test harnesses through the runtime allowlist.
    // scripts/check-provider-egress.mjs's independent source scan carries the identical carve-out
    // (see its own comment) so the two enforcement layers agree on what's in scope.
    files: ['src/**/*.test.ts', 'src/**/*.integration-check.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': 'off',
      'no-restricted-globals': 'off',
    },
  },
  {
    // router/oauth.ts's node:http import is a narrower case than the net/ exemption above: it's a
    // LISTENING server (createServer, for the local OAuth-callback redirect) rather than an
    // outbound HTTP client -- the provider-egress policy governs outbound calls, and this file's
    // own fetch() calls are already routed through engineFetch (see its own header comment). Only
    // the import restriction is lifted here; no-restricted-globals (bare `fetch`) stays on, so a
    // future bare fetch() added to this file still gets caught.
    files: ['src/router/oauth.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': 'off',
    },
  },
  {
    // ENG-5: settings/loopback.ts's node:http import is the exact same narrower case as
    // router/oauth.ts's above -- a LISTENING server for the local Maestro OAuth-callback redirect
    // (port 20128), not an outbound HTTP client. Its own network calls (via keycloakAuth.ts's
    // exchangeCodeForTokens) are already routed through engineFetch. Only the import restriction
    // is lifted here; no-restricted-globals (bare `fetch`) stays on.
    files: ['src/settings/loopback.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': 'off',
    },
  },
);
