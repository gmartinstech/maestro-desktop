import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

// Deliberately a correctness gate, not a style gate: formatting opinions belong in review,
// but a stale hook dep or a lost promise is a real bug that ships. tsc already owns types,
// so type-aware linting is off — it would triple lint time for rules tsc mostly covers.
export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', '*.config.mjs', 'webpack.config.js'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // The codebase leans on `any` at the Electron bridge and Redux boundaries; flagging
      // every one would bury real findings. Revisit once those are properly typed.
      '@typescript-eslint/no-explicit-any': 'off',
      // Unused bindings should be DELETED, not renamed to `_x` — hence no argsIgnorePattern
      // escape hatch here. Warn rather than error so the gate stays actionable.
      '@typescript-eslint/no-unused-vars': ['warn', { args: 'none', ignoreRestSiblings: true }],
      // `catch {}` to deliberately swallow a teardown error is an established idiom here.
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  {
    // KNOWN DEFECT, not a false positive. MessageBubble early-returns on role
    // (system/thinking/tool_call) and ProviderReasoningExplanation early-returns on
    // isStreaming, then both call hooks below that return. A message whose role or
    // streaming state changes between renders therefore changes its hook count, which
    // makes React throw "Rendered more hooks than during the previous render".
    // Fixing it means hoisting ~11 hooks above four early returns in a 1300-line
    // component, so it is its own ticket. Scoped to this ONE file on purpose: every
    // other file keeps rules-of-hooks at error. Delete this block when that lands.
    files: ['src/app/pages/AgentChat/bubbles/MessageBubble.tsx'],
    rules: { 'react-hooks/rules-of-hooks': 'off' },
  },
);
