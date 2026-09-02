// engine/src/agents/manager/permissions/pathGate.ts -- AGT-5, a faithful port of
// backend/apps/agents/manager/permissions/path_gate.py: the defense-in-depth permission gate that
// flips a permissive tool policy to 'ask' when a write would land on a sensitive path (SSH keys,
// shell rc files, keychains, system dirs), when a shell command writes to a catastrophic path, or
// when a shell command looks like OS-level scheduling (crontab/launchctl/schtasks). The trusted-
// paths allowlist is injected (`loadTrustedSensitivePaths`) rather than read from a module-level
// singleton the way Python's `tools_lib.load_trusted_sensitive_paths` is -- kept as a seam (rather
// than a bare top-level call) so a test can still simulate the Python suite's `empty_trusted`
// autouse fixture without touching disk. SUB-4 (mcp_registry + tools_lib) is now ported, so the
// DEFAULT here calls the real persisted-file store (apps/toolsLib/store.ts's
// loadTrustedSensitivePaths) instead of the placeholder empty list this file used to fall back on.
//
// "Shell command" means any tool in SHELL_TOOLS, not just Bash: on Windows the CLI's shell tool is
// named `PowerShell`, so testing the name `Bash` alone would leave every check in here inert on
// this product's primary platform -- ported verbatim from the Python file's own header note.

import { loadTrustedSensitivePaths } from '../../../apps/toolsLib/store';

/** Each entry: pattern -> [short label, plain-English risk]. Shown on the approval card. */
export const SENSITIVE_PATH_INFO: ReadonlyMap<string, readonly [string, string]> = new Map([
  ['*/.ssh', ['SSH folder (~/.ssh)', 'Controls who can log in to your computer remotely.']],
  ['*/.ssh/*', ['SSH folder (~/.ssh)', 'Controls who can log in to your computer remotely.']],
  ['*/.aws/*', ['AWS credentials (~/.aws)', 'Cloud account access keys; can spend money and read your data.']],
  ['*/.config/gcloud/*', ['Google Cloud credentials', 'Cloud account access; can spend money and read your data.']],
  ['*/.kube/*', ['Kubernetes config (~/.kube)', 'Admin access to your Kubernetes clusters.']],
  ['*/.gnupg/*', ['GPG encryption keys', 'Your private encryption keys; lets attackers decrypt your data or sign as you.']],
  ['*/.docker/config*', ['Docker credentials', 'Login tokens for container registries.']],
  ['*/.zshrc', ['Shell startup file (.zshrc)', 'Runs automatically every time you open a terminal.']],
  ['*/.bashrc', ['Shell startup file (.bashrc)', 'Runs automatically every time you open a terminal.']],
  ['*/.bash_profile', ['Shell startup file (.bash_profile)', 'Runs automatically every time you log in.']],
  ['*/.profile', ['Shell startup file (.profile)', 'Runs automatically every time you log in.']],
  ['*/.zprofile', ['Shell startup file (.zprofile)', 'Runs automatically every time you log in.']],
  ['*/.zshenv', ['Shell environment file (.zshenv)', 'Runs automatically for every shell, including non-interactive ones.']],
  ['*/.gitconfig', ['Global Git config', 'Affects every Git command you run; can hijack commits.']],
  ['*/.npmrc', ['npm auth file (~/.npmrc)', 'Lets you publish npm packages; a token here can publish malicious packages as you.']],
  ['*/.pypirc', ['PyPI auth file (~/.pypirc)', 'Lets you publish Python packages; a token here can publish malicious packages as you.']],
  ['*/.netrc', ['Stored login info (~/.netrc)', 'Saved passwords for various services.']],
  ['*/Library/Keychains/*', ['macOS Keychain', 'Where macOS stores all your saved passwords.']],
  ['/etc/*', ['System config (/etc)', 'Affects the whole computer, not just your account.']],
  ['/private/etc/*', ['System config (/etc)', 'Affects the whole computer, not just your account.']],
  ['/System/*', ['macOS system folder', 'Affects the whole computer; should almost never be modified.']],
  ['/usr/local/etc/*', ['System config (/usr/local/etc)', 'Affects the whole computer, not just your account.']],
]);
export const SENSITIVE_PATH_PATTERNS: readonly string[] = Array.from(SENSITIVE_PATH_INFO.keys());

export const PATH_GATED_TOOLS: ReadonlySet<string> = new Set(['Write', 'Edit', 'NotebookEdit']);

/** Every tool whose input is an arbitrary shell command under the key `command`, by the exact
 * names the bundled CLI ships: it defines both "Bash" and "PowerShell" and hands Windows the
 * latter, and Monitor runs its `command` through the same shell backend (persistently, which is
 * worse), so all three need the catastrophic-path and scheduling checks below. */
export const SHELL_TOOLS: ReadonlySet<string> = new Set(['Bash', 'PowerShell', 'Monitor']);
/** The bundled-CLI version whose tool-name surface was read out of the binary by hand; a drift
 * test fails when the SDK moves it, so the manifests get re-audited instead of silently going
 * stale. */
export const AUDITED_CLI_VERSION = '2.1.122';

// OS-level scheduling across macOS/Linux/Windows. The agent must not install cron entries, launchd
// plists, Windows scheduled tasks, or PowerShell ScheduledTask cmdlets behind the user's back.
// Word-bounded so stray strings in echo etc. don't trip it.
const OS_SCHED_RE =
  /\b(crontab|launchctl|launchd|schtasks|systemd-run|systemctl\s+--user.*timer|at\s+\d|at\s+now|at\s+-f|Register-ScheduledTask|New-ScheduledTask|Set-ScheduledTask|Register-ScheduledJob|New-ScheduledJob)\b/i;

/** Catastrophic-path shell gate. Shell tools are intentionally NOT in PATH_GATED_TOOLS (gating
 * every `echo ... > /tmp/foo` would interrupt routine work), but a single redirected write to one
 * of these can grant persistent attacker access or break the OS unrecoverably. The trust list is
 * shared with Write/Edit so one "Always allow" covers both surfaces. */
export const BASH_CATASTROPHIC_INFO: ReadonlyMap<string, readonly [string, string]> = new Map([
  ['*/.ssh/*', ['SSH folder (~/.ssh)', 'Controls who can log in to your computer remotely.']],
  ['/etc/sudoers', ['Sudo permissions (/etc/sudoers)', 'Controls which commands can run with admin privileges.']],
  ['/etc/sudoers.d/*', ['Sudo permissions (/etc/sudoers.d)', 'Controls which commands can run with admin privileges.']],
  ['/etc/passwd', ['System user list (/etc/passwd)', 'Defines every user account on this computer.']],
  ['/etc/shadow', ['System password file (/etc/shadow)', 'Stores password hashes for every user account.']],
  ['*/Library/Keychains/*', ['macOS Keychain', 'Where macOS stores all your saved passwords.']],
  ['/System/*', ['macOS system folder', 'Affects the whole computer; should almost never be modified.']],
]);
export const BASH_CATASTROPHIC_PATTERNS: readonly string[] = Array.from(BASH_CATASTROPHIC_INFO.keys());

// Pulls quoted strings AND bare path-like tokens out of a shell command. Backslash is a
// leading/continuing token character so Windows-native targets (`$env:USERPROFILE\.ssh\
// authorized_keys`, `C:\Users\me\.ssh\...`) are captured, not truncated at the first separator.
// Intentionally loose: a false positive just means an extra approval prompt, never a missed gate.
const BASH_PATH_TOKEN_RE = /"[^"]+"|'[^']+'|[~/\\.][\w./\\~-]*/g;

// Write operators we care about; presence alone isn't enough, a sensitive target in the same
// command is also required. Covers shell redirection, Unix tools with a destination flag, and the
// PowerShell cmdlets that are the only idiomatic way to write a file on Windows.
const BASH_WRITE_OP_RE =
  /(?:>>?|\btee\b|\bsed\s+-i\b|\bcp\b|\bmv\b|\bdd\b[^|]*\bof=|\binstall\b|\bchmod\b|\bchown\b|\brm\b|\btouch\b|\bmkdir\b|\bln\b|\bSet-Content\b|\bAdd-Content\b|\bOut-File\b|\bNew-Item(?:Property)?\b|\bCopy-Item\b|\bMove-Item\b|\bRemove-Item\b|\bRename-Item\b|\bSet-ItemProperty\b|\bTee-Object\b|\bSet-Acl\b)/i;

/** Minimal fnmatch-equivalent for the `*`-only glob patterns this file uses (no `?`/`[]`
 * needed -- none of the patterns above use them). Matches Python's `fnmatch.fnmatch` for this
 * pattern subset: `*` matches any run of characters, including none, across `/`. */
function fnmatch(name: string, pattern: string): boolean {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`).test(name);
}

/** Forward-slash a normalized path so patterns match on Windows too (fnmatch treats '/' as
 * literal, and Node's path.sep is '\\' there). Mirrors the Python file's own comment: without
 * this the gate would silently no-op on Windows. */
function toForwardSlash(p: string): string {
  return p.split('\\').join('/');
}

function expandHome(p: string): string {
  if (p === '~' || p.startsWith('~/') || p.startsWith('~\\')) {
    const home = process.env.HOME || process.env.USERPROFILE || '';
    return home + p.slice(1);
  }
  return p;
}

/** Normalizes `.`/`..` segments the way Python's `os.path.normpath` does, without touching drive
 * letters or leading slashes -- good enough for the fnmatch comparisons below (which only ever
 * check suffix/prefix globs), not a full path-resolution utility. */
function normpath(p: string): string {
  const isAbsPosix = p.startsWith('/');
  const driveMatch = /^([a-zA-Z]:)(.*)$/.exec(p);
  const drive = driveMatch ? driveMatch[1] : '';
  const rest = driveMatch ? driveMatch[2] : p;
  const parts = rest.split(/[/\\]/);
  const out: string[] = [];
  for (const part of parts) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (out.length && out[out.length - 1] !== '..') out.pop();
      else if (!isAbsPosix && !drive) out.push('..');
    } else {
      out.push(part);
    }
  }
  const joined = out.join('/');
  if (drive) return `${drive}/${joined}`;
  if (isAbsPosix) return `/${joined}`;
  return joined || '.';
}

export type TrustedPathsLoader = () => readonly string[];
const defaultLoadTrustedSensitivePaths: TrustedPathsLoader = () => loadTrustedSensitivePaths();

/** The matched sensitive pattern, or `undefined` if the path isn't sensitive OR the caller has
 * trusted that pattern. `loadTrustedSensitivePaths` is called fresh on every invocation (mirrors
 * the Python original reloading per call) so a same-turn trust decision takes effect immediately. */
export function matchSensitivePattern(
  filePath: string,
  loadTrustedSensitivePaths: TrustedPathsLoader = defaultLoadTrustedSensitivePaths,
): string | undefined {
  if (!filePath || typeof filePath !== 'string') return undefined;
  let norm: string;
  try {
    norm = toForwardSlash(normpath(expandHome(filePath)));
  } catch {
    return undefined;
  }
  const trusted = new Set(loadTrustedSensitivePaths());
  for (const pat of SENSITIVE_PATH_PATTERNS) {
    if (trusted.has(pat)) continue;
    if (fnmatch(norm, pat)) return pat;
  }
  return undefined;
}

export function looksLikeOsScheduling(toolInput: unknown): boolean {
  if (typeof toolInput !== 'object' || toolInput === null || Array.isArray(toolInput)) return false;
  const cmd = String((toolInput as Record<string, unknown>).command ?? '');
  if (!cmd) return false;
  return OS_SCHED_RE.test(cmd);
}

/** The matched catastrophic-path pattern for a shell command (Bash or PowerShell), or `undefined`
 * if it isn't writing to one (or the caller has trusted it). Same trust-list as
 * matchSensitivePattern. */
export function matchBashCatastrophicPattern(
  command: string,
  loadTrustedSensitivePaths: TrustedPathsLoader = defaultLoadTrustedSensitivePaths,
): string | undefined {
  if (!command || typeof command !== 'string') return undefined;
  if (!BASH_WRITE_OP_RE.test(command)) return undefined;
  const trusted = new Set(loadTrustedSensitivePaths());
  BASH_PATH_TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = BASH_PATH_TOKEN_RE.exec(command)) !== null) {
    let tok = m[0];
    if (tok && (tok[0] === "'" || tok[0] === '"')) tok = tok.slice(1, -1);
    if (!tok) continue;
    let norm: string;
    try {
      // Backslashes are folded to '/' here rather than via path.sep so a PowerShell command gets
      // the same verdict on a POSIX CI box as on the Windows machine that would actually run it.
      norm = toForwardSlash(normpath(expandHome(tok.split('\\').join('/'))));
    } catch {
      continue;
    }
    for (const pat of BASH_CATASTROPHIC_PATTERNS) {
      if (trusted.has(pat)) continue;
      if (fnmatch(norm, pat)) return pat;
    }
  }
  return undefined;
}

export function extractTargetPath(toolName: string, toolInput: unknown): string {
  if (typeof toolInput !== 'object' || toolInput === null || Array.isArray(toolInput)) return '';
  const rec = toolInput as Record<string, unknown>;
  if (toolName === 'NotebookEdit') return String(rec.notebook_path ?? '');
  return String(rec.file_path ?? '');
}

/** Native-scheduler MCP tools that commit or mutate a recurring schedule. Always-on MCP servers
 * fall through to the always_allow default, so these would otherwise fire silently; force them
 * through ApprovalBar. The Cron* tools are Claude's own internal scheduler, denied outright in
 * favour of the visible/auditable native one. */
export const SCHEDULE_GATED: ReadonlySet<string> = new Set([
  'mcp__maestro-schedule__ScheduleWorkflow',
  'mcp__maestro-schedule__UpdateScheduledWorkflow',
  'mcp__maestro-schedule__DeleteScheduledWorkflow',
  'mcp__maestro-schedule__PauseAllWorkflows',
  // RemoteTrigger is the CLI's own scheduler: creates/updates/fires cron-scheduled remote agents
  // through the claude.ai routines API, the crontab threat with a different transport.
  'RemoteTrigger',
]);
export const CLAUDE_INTERNAL_SCHEDULER_TOOLS: readonly string[] = ['CronCreate', 'CronList', 'CronDelete'];

/** Returns [effective_policy, matched_sensitive_pattern]. Flips a permissive policy to 'ask' when
 * the target is a sensitive/catastrophic path or the shell command looks like OS scheduling, even
 * if the caller set the tool to always_allow, so a prompt-injected agent writing to
 * ~/.ssh/authorized_keys still gets surfaced. Once trusted, future writes to that pattern pass
 * through silently. */
export function maybeOverridePolicy(
  policy: string,
  toolName: string,
  toolInput: unknown,
  loadTrustedSensitivePaths: TrustedPathsLoader = defaultLoadTrustedSensitivePaths,
): [string, string | undefined] {
  if (SHELL_TOOLS.has(toolName) && looksLikeOsScheduling(toolInput)) return ['ask', undefined];
  if (CLAUDE_INTERNAL_SCHEDULER_TOOLS.includes(toolName)) return ['deny', undefined];
  // Committing or mutating a native recurring schedule is the in-app twin of the crontab gate
  // above: real, user-visible, hard-to-undo, so it goes through ApprovalBar every time regardless
  // of the always_allow default.
  if (SCHEDULE_GATED.has(toolName)) return ['ask', undefined];
  if (SHELL_TOOLS.has(toolName) && typeof toolInput === 'object' && toolInput !== null && !Array.isArray(toolInput)) {
    const cmd = String((toolInput as Record<string, unknown>).command ?? '');
    const shellMatch = matchBashCatastrophicPattern(cmd, loadTrustedSensitivePaths);
    if (shellMatch) return ['ask', shellMatch];
  }
  if (policy !== 'always_allow' || !PATH_GATED_TOOLS.has(toolName)) return [policy, undefined];
  const matched = matchSensitivePattern(extractTargetPath(toolName, toolInput), loadTrustedSensitivePaths);
  if (matched) return ['ask', matched];
  return [policy, undefined];
}

/** The (short label, plain-English risk) shown on the approval card for a matched pattern, from
 * either table; `undefined` if the pattern is unknown. */
export function describeSensitivePattern(pattern: string): readonly [string, string] | undefined {
  return SENSITIVE_PATH_INFO.get(pattern) ?? BASH_CATASTROPHIC_INFO.get(pattern);
}
