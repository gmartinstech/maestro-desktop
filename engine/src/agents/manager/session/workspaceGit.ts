// engine/src/agents/manager/session/workspaceGit.ts -- AGT-5, a full port of
// backend/apps/agents/manager/session/workspace_git.py. Self-contained (child_process + fs only).

import { existsSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

function git(args: string[], cwd: string, timeoutMs: number) {
  return spawnSync('git', args, { cwd, timeout: timeoutMs, encoding: 'buffer' });
}

/** Idempotently make `cwd` into a git repo with a valid HEAD.
 *
 * The CLI's built-in Agent tool uses `isolation: "worktree"` to spawn subagents, which runs `git
 * rev-parse HEAD` + `git worktree add`. If cwd isn't a git repo, or is a repo with no commits yet,
 * that fails with "worktree/base-branch metadata is broken for isolation" or "repo doesn't have a
 * valid HEAD yet". We silently init a minimal repo with one empty commit so worktree add always
 * has something to anchor on.
 *
 * Safe to call on every request, does nothing if cwd is already a valid repo (real project,
 * previous init, or inside a parent repo). `home` is the REAL home directory (never the
 * override-aware state home -- see this file's own callers' comments for why that distinction
 * matters), used ONLY to build the never-git-init-here guard. */
export function ensureCwdGitRepo(cwd: string, home?: string): void {
  try {
    const realHome = home || process.env.USERPROFILE || process.env.HOME || '';
    const cwdAbs = resolve(cwd);
    const riskyRoots = new Set([resolve(realHome), resolve('/'), resolve(dirname(realHome))]);
    if (riskyRoots.has(cwdAbs)) return;
    if (!existsSync(cwd) || !statSync(cwd).isDirectory()) return;

    // Case A: cwd is inside some git repo (possibly parent). Verify HEAD resolves. If the
    // enclosing repo is broken (e.g. a stray `.git` in $HOME with no commits), we need to init a
    // fresh repo AT cwd so it shadows the parent.
    const inside = git(['rev-parse', '--is-inside-work-tree'], cwd, 5000);
    if (inside.status === 0 && inside.stdout?.toString().includes('true')) {
      const head = git(['rev-parse', '--verify', 'HEAD'], cwd, 5000);
      if (head.status === 0) return; // parent repo is healthy, leave it alone
      if (existsSync(resolve(cwd, '.git'))) {
        git(['-c', 'user.email=maestro@local', '-c', 'user.name=Maestro', 'commit', '--allow-empty', '-q', '-m', 'maestro init'], cwd, 10000);
        return;
      }
      // .git is in a parent dir (broken home-dir repo, etc.). Fall through to Case B.
    }

    // Case B: cwd is not a git repo at all (or parent is broken): init + empty commit here.
    git(['init', '-q', '-b', 'main'], cwd, 10000);
    git(['-c', 'user.email=maestro@local', '-c', 'user.name=Maestro', 'commit', '--allow-empty', '-q', '-m', 'maestro init'], cwd, 10000);
  } catch {
    // Best-effort, mirrors the Python original's try/except-log-and-continue.
  }
}

/** Resolve the origin remote and current branch for `cwd`. Used to label sessions in the session
 * list and to keep a resumed session pinned to the same project even after the user `cd`'s
 * elsewhere. Returns [undefined, undefined] for non-git cwds, detached HEADs, repos without an
 * origin, or any subprocess failure. Credentials in the URL are stripped. */
export function detectGitIdentity(cwd: string): [string | undefined, string | undefined] {
  if (!cwd || !existsSync(cwd) || !statSync(cwd).isDirectory()) return [undefined, undefined];
  try {
    const urlProc = git(['remote', 'get-url', 'origin'], cwd, 3000);
    let repoUrl: string | undefined;
    if (urlProc.status === 0) {
      const raw = urlProc.stdout?.toString('utf-8').trim();
      if (raw) {
        if (raw.includes('://')) {
          const schemeSep = raw.indexOf('://');
          const scheme = raw.slice(0, schemeSep);
          let rest = raw.slice(schemeSep + 3);
          const atIdx = rest.indexOf('@');
          if (atIdx >= 0) rest = rest.slice(atIdx + 1);
          repoUrl = `${scheme}://${rest}`;
        } else {
          repoUrl = raw;
        }
      }
    }
    const branchProc = git(['branch', '--show-current'], cwd, 3000);
    let branchName: string | undefined;
    if (branchProc.status === 0) {
      const rawB = branchProc.stdout?.toString('utf-8').trim();
      if (rawB) branchName = rawB;
    }
    return [repoUrl, branchName];
  } catch {
    return [undefined, undefined];
  }
}
