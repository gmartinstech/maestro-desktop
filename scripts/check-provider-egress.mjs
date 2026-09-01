// scripts/check-provider-egress.mjs — ENG-7's second enforcement layer for the provider-egress
// chokepoint (engine/src/net/http.ts). Styled after scripts/check-callhome.mjs (string-scan a
// tree, fail on a hit) and scripts/check-fork-drift.mjs (a guard file that names what it forbids
// and documents its own exemptions), but scoped to engine/src rather than built output.
//
// Belt-and-suspenders, deliberately not "either alone" (see http.ts's own module doc): a lint rule
// that gets quietly misconfigured, disabled, or bypassed (a stray `// eslint-disable` someone
// copy-pastes without reading it) would otherwise silently reopen the hole with nothing else
// noticing. This script re-derives the same policy independently:
//   1. Confirms engine/eslint.config.mjs actually configures the no-restricted-imports /
//      no-restricted-globals ban — not just that the file exists, but that it names the banned
//      identifiers this ticket requires.
//   2. Does its OWN source scan of engine/src for the same banned import/global patterns, outside
//      engine/src/net/ — a plain textual check, independent of whether ESLint itself is even
//      installed or runnable in a given environment.
//
// Exemption carve-outs mirror engine/eslint.config.mjs's own (see that file's comments for the
// full rationale on each): engine/src/net/ itself; *.test.ts / *.integration-check.ts dev-time
// harnesses; a type-only `import type {...} from 'node:http'` (performs no network I/O); and
// router/oauth.ts's + settings/loopback.ts's node:http imports, which are local OAuth-callback
// LISTENERs (inbound), not outbound clients — their own outbound fetch() calls are not exempt and
// are scanned normally.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const REPO_ROOT = join(import.meta.dirname, '..');
const ENGINE_SRC = join(REPO_ROOT, 'engine', 'src');
const ESLINT_CONFIG_PATH = join(REPO_ROOT, 'engine', 'eslint.config.mjs');

const BANNED_IMPORT_MODULES = ['node:http', 'http', 'node:https', 'https', 'undici', 'axios', 'got'];
const NET_DIR_PREFIX = `net${sep}`;
const OAUTH_IMPORT_EXEMPT_FILES = new Set([join('router', 'oauth.ts'), join('settings', 'loopback.ts')]);

let bad = [];

// --- 1. Confirm engine/eslint.config.mjs actually configures the guard -------------------------
let eslintConfigText = '';
try {
  eslintConfigText = readFileSync(ESLINT_CONFIG_PATH, 'utf8');
} catch {
  bad.push(`missing guard: ${relative(REPO_ROOT, ESLINT_CONFIG_PATH)} does not exist`);
}
if (eslintConfigText) {
  if (!/no-restricted-imports/.test(eslintConfigText)) {
    bad.push(`${relative(REPO_ROOT, ESLINT_CONFIG_PATH)} does not configure any no-restricted-imports rule`);
  }
  if (!/no-restricted-globals/.test(eslintConfigText)) {
    bad.push(`${relative(REPO_ROOT, ESLINT_CONFIG_PATH)} does not configure any no-restricted-globals rule`);
  }
  for (const mod of BANNED_IMPORT_MODULES) {
    if (!eslintConfigText.includes(`'${mod}'`) && !eslintConfigText.includes(`"${mod}"`)) {
      bad.push(`${relative(REPO_ROOT, ESLINT_CONFIG_PATH)} does not name "${mod}" among its restricted imports`);
    }
  }
  if (!/\bfetch\b/.test(eslintConfigText)) {
    bad.push(`${relative(REPO_ROOT, ESLINT_CONFIG_PATH)} does not name "fetch" among its restricted globals`);
  }
  if (!eslintConfigText.includes(`src/net/`)) {
    bad.push(`${relative(REPO_ROOT, ESLINT_CONFIG_PATH)} does not appear to exempt engine/src/net/ from the ban`);
  }
}

// --- 2. Independent source scan of engine/src ----------------------------------------------------
function walk(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist') continue;
      walk(full, out);
    } else if (entry.endsWith('.ts')) {
      out.push(full);
    }
  }
}

const files = [];
walk(ENGINE_SRC, files);

// Matches a static import/require of one of the banned modules — captures whether it's type-only
// (`import type { X } from 'node:http'` or `import { type X } from 'node:http'`) so that legitimate
// case can be told apart from a real value import, same distinction eslint.config.mjs's
// allowTypeImports draws.
const IMPORT_LINE_RE = /^\s*import\s+(type\s+)?(?:\{([^}]*)\}|[\w*][\w*\s,{}]*)\s*from\s*['"]([^'"]+)['"]/;
const REQUIRE_RE = /require\(\s*['"]([^'"]+)['"]\s*\)/;
// A bare `fetch(` call, or a bare `fetch` reference not immediately followed by `(` as part of a
// longer identifier (e.g. this deliberately does NOT flag `engineFetch(` or `myFetchWrapper`).
const BARE_FETCH_RE = /(?<![A-Za-z0-9_.])fetch\s*\(/;

for (const file of files) {
  const rel = relative(ENGINE_SRC, file);
  if (rel.startsWith(NET_DIR_PREFIX)) continue; // the one sanctioned directory
  if (rel.endsWith('.test.ts') || rel.endsWith('.integration-check.ts')) continue; // dev-time harnesses, see header
  const isOauthCallbackListener = OAUTH_IMPORT_EXEMPT_FILES.has(rel);

  const text = readFileSync(file, 'utf8');
  const lines = text.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // A full-line `//` comment can legitimately mention "fetch(" or "require(node:http)" in prose
    // (e.g. explaining WHY a nearby real line is exempt, as this repo's own comment style does
    // constantly) without that being a real reference — skip the non-import checks for it. A
    // trailing same-line comment after real code is not stripped: code is still scanned in full.
    const isFullLineComment = line.trim().startsWith('//') || line.trim().startsWith('*') || line.trim().startsWith('/*');
    const importMatch = IMPORT_LINE_RE.exec(line);
    if (importMatch) {
      const [, typeOnlyKeyword, namedBraceBody, moduleName] = importMatch;
      if (BANNED_IMPORT_MODULES.includes(moduleName)) {
        // Type-only if the whole import is `import type {...}` OR the named list is entirely
        // `type X` specifiers (e.g. `import { type IncomingMessage } from 'node:http'`).
        const wholeImportIsTypeOnly = Boolean(typeOnlyKeyword);
        const allNamedSpecifiersAreTypeOnly =
          namedBraceBody !== undefined &&
          namedBraceBody
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
            .every((s) => s.startsWith('type '));
        const isTypeOnly = wholeImportIsTypeOnly || allNamedSpecifiersAreTypeOnly;
        if (!isTypeOnly && !isOauthCallbackListener) {
          bad.push(`${rel}:${i + 1}: restricted import "${moduleName}" outside engine/src/net/ — ${line.trim()}`);
        }
      }
    }
    if (!isFullLineComment) {
      const requireMatch = REQUIRE_RE.exec(line);
      if (requireMatch && BANNED_IMPORT_MODULES.includes(requireMatch[1]) && !isOauthCallbackListener) {
        bad.push(`${rel}:${i + 1}: restricted require("${requireMatch[1]}") outside engine/src/net/ — ${line.trim()}`);
      }
      if (BARE_FETCH_RE.test(line)) {
        bad.push(`${rel}:${i + 1}: bare fetch(...) outside engine/src/net/ — ${line.trim()}`);
      }
    }
  }
}

if (bad.length) {
  console.error(`PROVIDER-EGRESS VIOLATION — ${bad.length} finding(s):\n`);
  for (const b of bad) console.error(`  - ${b}`);
  console.error('\nOutbound HTTP in engine/src must go through engine/src/net/http.ts\'s engineFetch(). See ENG-7.');
  process.exit(1);
}
console.log('provider-egress check: clean');
