// harness/review.mjs — cross-vendor code review via a non-Claude cloud model (ollama).
//
// Why: the Maestro harness pairs a Claude/local implementer with a DIFFERENT-vendor
// reviewer so single-model blind spots cancel. `pi -p` hangs headless in some shells
// (needs a TTY), so we shell out to `ollama run <model>` which works non-interactively.
//
// Usage:
//   node harness/review.mjs                         # review `git diff main...HEAD`
//   node harness/review.mjs --base main --head HEAD
//   node harness/review.mjs --diff path/to.patch
//   node harness/review.mjs --model qwen3-coder-next:cloud
//
// Exit codes: 0 = APPROVE, 1 = REQUEST-CHANGES, 2 = empty diff, 3 = ollama failed, 4 = no verdict.

import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const opt = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : def;
};

const model = opt('model', 'deepseek-v4-flash:cloud'); // configured cloud Ollama model, non-Claude
const base = opt('base', 'main');
const head = opt('head', 'HEAD');
const diffFile = opt('diff', null);

let diff;
try {
  diff = diffFile
    ? readFileSync(diffFile, 'utf8')
    : execFileSync('git', ['diff', `${base}...${head}`], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
} catch (e) {
  console.error(`review: could not obtain diff (${e.message})`);
  process.exit(3);
}

if (!diff.trim()) {
  console.error('review: empty diff — nothing to review');
  process.exit(2);
}

const prompt = [
  'You are a strict code reviewer from a DIFFERENT model vendor than the change author (cross-vendor review).',
  'Review the git diff below for: correctness bugs, scope creep (changes beyond the stated task),',
  'secrets/API keys/tokens committed, and any call to a *.openswarm.com host (forbidden in this project).',
  'Be concise: up to 6 bullet findings, then a FINAL line that is EXACTLY one of:',
  'VERDICT: APPROVE',
  'VERDICT: REQUEST-CHANGES',
  '',
  'DIFF:',
  '',
  diff,
].join('\n');

const res = spawnSync('ollama', ['run', model], {
  input: prompt,
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
});

if ((res.status !== 0 && !res.stdout) || res.error) {
  console.error(`review: ollama run ${model} failed\n${res.stderr || res.error?.message || ''}`);
  process.exit(3);
}

// ollama emits ANSI + spinner escape sequences even when stdout is piped; strip them.
const clean = (res.stdout || '')
  .replace(/\x1B\[[0-9;?]*[A-Za-z]/g, '')
  .replace(/\x1B[=>]/g, '')
  .replace(/\r/g, '')
  .trim();

process.stdout.write(clean + '\n');

const m = clean.match(/VERDICT:\s*(APPROVE|REQUEST-CHANGES)/i);
if (!m) {
  console.error('\nreview: no VERDICT line found in model output');
  process.exit(4);
}

const verdict = m[1].toUpperCase();
console.log(`\n[review] model=${model} range=${diffFile ? diffFile : `${base}...${head}`} verdict=${verdict}`);
process.exit(verdict === 'APPROVE' ? 0 : 1);
