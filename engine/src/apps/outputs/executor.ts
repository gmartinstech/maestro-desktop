// engine/src/apps/outputs/executor.ts -- SUB-5, a port of backend/apps/outputs/executor.py:
// sandboxed execution of an Output's user-supplied `backend.py`-style Python snippet.
//
// The code under execution is Python (input_data/result globals, `/api/outputs/execute`'s HITL
// contract) -- porting this to the engine does not mean reimplementing it in JS. The AST-allowlist
// validation (get_code_warnings) genuinely needs Python's own `ast` module to inspect Python
// syntax; rather than approximate that with a regex/hand-rolled parser (a real correctness risk
// for a SECURITY-relevant gate), this spawns Python to run the EXACT SAME ast.parse/ast.walk logic
// the original function used in-process -- a real, faithful port of the algorithm, just invoked as
// a subprocess instead of a library call. Execution itself already spawns Python in the original
// (`execute_backend_code`'s whole design is "run this in a Python subprocess"), so this adds no new
// dependency the feature didn't already have.

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { resolveBackendPythonPath } from '../../pythonBackend';

const TIMEOUT_MS = 30_000;

// Modules backend code is allowed to import -- data-shaping only, no I/O, no networking, no subprocess.
const P_ALLOWED_MODULES = [
  'json', 'math', 're', 'datetime', 'collections', 'itertools',
  'functools', 'statistics', 'decimal', 'fractions', 'random',
  'string', 'textwrap', 'unicodedata', 'csv', 'copy', 'enum',
  'dataclasses', 'typing', 'abc', 'numbers', 'uuid', 'hashlib',
  'base64', 'binascii', 'operator', 'heapq', 'bisect', 'array',
];

const P_BLOCKED_BUILTINS = ['exec', 'eval', 'compile', '__import__', 'open', 'input', 'breakpoint', 'exit', 'quit'];

function pPythonExecutable(): string {
  const resolved = resolveBackendPythonPath();
  return existsSync(resolved) ? resolved : (process.env.MAESTRO_PYTHON || 'python');
}

// Runs the EXACT AST walk get_code_warnings performs, over a subprocess boundary -- reads the
// candidate code from stdin (so no shell-escaping of arbitrary user code is ever needed) and
// prints a JSON array of warning strings to stdout.
const P_VALIDATOR_SCRIPT = `
import ast, json, sys

P_ALLOWED_MODULES = ${JSON.stringify(P_ALLOWED_MODULES)}
P_BLOCKED_BUILTINS = ${JSON.stringify(P_BLOCKED_BUILTINS)}

code = sys.stdin.read()
try:
    tree = ast.parse(code)
except SyntaxError as e:
    print(json.dumps([f"Syntax error: {e}"]))
    sys.exit(0)

warnings = []
seen = set()
allowed = set(P_ALLOWED_MODULES)
blocked = set(P_BLOCKED_BUILTINS)
for node in ast.walk(tree):
    if isinstance(node, ast.Import):
        for alias in node.names:
            root = alias.name.split(".")[0]
            if root not in allowed:
                msg = f"Imports '{alias.name}' (outside the safe-data-shaping allowlist)"
                if msg not in seen:
                    seen.add(msg)
                    warnings.append(msg)
    elif isinstance(node, ast.ImportFrom):
        if node.module:
            root = node.module.split(".")[0]
            if root not in allowed:
                msg = f"Imports from '{node.module}' (outside the safe-data-shaping allowlist)"
                if msg not in seen:
                    seen.add(msg)
                    warnings.append(msg)
    elif isinstance(node, ast.Call):
        if isinstance(node.func, ast.Name) and node.func.id in blocked:
            msg = f"Calls builtin '{node.func.id}()' which can escape the sandbox"
            if msg not in seen:
                seen.add(msg)
                warnings.append(msg)
print(json.dumps(warnings))
`;

function runPython(args: string[], stdin: string, envOverride: NodeJS.ProcessEnv, cwd?: string, timeoutMs = TIMEOUT_MS): Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolvePromise) => {
    const child = spawn(pPythonExecutable(), args, { cwd, env: envOverride, windowsHide: true });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.stdout.on('data', (d: Buffer) => { stdout += d.toString('utf8'); });
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString('utf8'); });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolvePromise({ code, stdout, stderr, timedOut });
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolvePromise({ code: null, stdout, stderr: stderr || String(err), timedOut });
    });
    child.stdin.write(stdin, 'utf8');
    child.stdin.end();
  });
}

/** Return human-readable warnings for AST-visible risks, without raising. [] for code that's fully
 * inside the allowlist. A syntax error is reported as a single warning. */
export async function getCodeWarnings(code: string): Promise<string[]> {
  const { code: exitCode, stdout, stderr } = await runPython(['-c', P_VALIDATOR_SCRIPT], code, minimalEnv(false));
  if (exitCode !== 0) {
    // The validator subprocess itself failed to run (no python found, etc) -- surface as a single
    // warning rather than silently reporting "no risk", which would defeat the HITL gate's purpose.
    return [`Could not validate code safety: ${stderr.trim() || 'python interpreter unavailable'}`];
  }
  try {
    const parsed: unknown = JSON.parse(stdout);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export class UnsafeCodeError extends Error {}

async function pValidateCodeSafety(code: string): Promise<void> {
  const warnings = await getCodeWarnings(code);
  if (warnings.length > 0) throw new UnsafeCodeError(warnings[0]);
}

// Env vars always scrubbed from the subprocess, regardless of strict-vs-force.
const P_SCRUBBED_ENV_KEYS = new Set([
  'MAESTRO_AUTH_TOKEN', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GOOGLE_API_KEY', 'GEMINI_API_KEY',
  'OPENROUTER_API_KEY', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN',
  'GOOGLE_APPLICATION_CREDENTIALS', 'STRIPE_API_KEY', 'STRIPE_SECRET_KEY', 'GITHUB_TOKEN',
]);

/** Build the env for the executor subprocess. Strict mode: language essentials only. Force mode
 * (user explicitly approved unsafe imports via the HITL preview): inherit the real env minus
 * credentials. Both modes scrub P_SCRUBBED_ENV_KEYS. */
function minimalEnv(force: boolean): NodeJS.ProcessEnv {
  if (force) {
    const env: NodeJS.ProcessEnv = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (!P_SCRUBBED_ENV_KEYS.has(k)) env[k] = v;
    }
    env.PYTHONDONTWRITEBYTECODE = '1';
    env.PYTHONUTF8 = '1';
    env.PYTHONIOENCODING = 'utf-8';
    return env;
  }
  const env: NodeJS.ProcessEnv = {
    PYTHONDONTWRITEBYTECODE: '1',
    LANG: process.env.LANG || 'C.UTF-8',
    LC_ALL: process.env.LC_ALL || 'C.UTF-8',
    PYTHONUTF8: '1',
    PYTHONIOENCODING: 'utf-8',
  };
  if (process.platform === 'win32') {
    for (const k of ['SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE']) {
      if (process.env[k]) env[k] = process.env[k];
    }
  }
  return env;
}

export interface BackendExecResult {
  result: Record<string, unknown>;
  stdout: string;
  stderr: string;
}

/** Execute user-provided Python code in a subprocess. See executor.py's own doc for the full
 * defense-in-depth list (AST allowlist, temp-dir cwd, scrubbed env, builtins preamble scrub, 30s
 * timeout). `skipValidation=true` bypasses #1 only; intended for callers that already surfaced
 * warnings to a user and got explicit consent. */
export async function executeBackendCode(code: string, inputData: Record<string, unknown>, opts: { skipValidation?: boolean } = {}): Promise<BackendExecResult> {
  if (!opts.skipValidation) await pValidateCodeSafety(code);

  const preamble =
    'import json, sys, io, builtins\n' +
    "for _b in ('exec','eval','compile','open','input',\n" +
    "           'breakpoint','exit','quit'):\n" +
    '    try: delattr(builtins, _b)\n' +
    '    except AttributeError: pass\n' +
    '_orig_stdout = sys.stdout\n' +
    '_capture = io.StringIO()\n' +
    'sys.stdout = _capture\n' +
    'input_data = json.loads(sys.stdin.read())\n' +
    'result = {}\n';
  const postamble =
    '\nsys.stdout = _orig_stdout\n' +
    'json.dump({"__stdout__": _capture.getvalue(), "__result__": result}, sys.stdout)\n';
  const wrapper = preamble + code + postamble;

  const workdir = mkdtempSync(join(tmpdir(), 'maestro-exec-'));
  try {
    const { code: exitCode, stdout, stderr, timedOut } = await runPython(
      ['-c', wrapper],
      JSON.stringify(inputData),
      minimalEnv(opts.skipValidation === true),
      workdir,
    );
    if (timedOut) throw new Error(`Backend code execution timed out after ${TIMEOUT_MS / 1000}s`);
    const stderrText = stderr.trim();
    if (exitCode !== 0) throw new Error(`Backend code error (exit ${exitCode}): ${stderrText}`);
    try {
      const parsed = JSON.parse(stdout) as { __result__?: Record<string, unknown>; __stdout__?: string };
      return { result: parsed.__result__ ?? {}, stdout: parsed.__stdout__ ?? '', stderr: stderrText };
    } catch {
      throw new Error(`Backend code did not produce valid JSON. Raw output: ${stdout.trim().slice(0, 500)}`);
    }
  } finally {
    rmSync(workdir, { recursive: true, force: true });
  }
}
