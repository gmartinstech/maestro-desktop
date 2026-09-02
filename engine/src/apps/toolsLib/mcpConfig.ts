// engine/src/apps/toolsLib/mcpConfig.ts -- SUB-4, a full port of backend/apps/tools_lib/mcp_config.py:
// command-on-PATH resolution (with the same extra-bin-dir fallbacks packaged apps need), and
// derive_mcp_config's per-tool claude_agent_sdk mcp_servers config assembly (credential/OAuth env
// injection, the bundled-MCP-server command rewrite, per-provider shims).
//
// This is the PATH/config-resolution half of the process-spawning story; mcpDiscovery.ts is the
// half that actually spawns and talks to the resolved command -- see that file's header for why
// spawn/lifecycle is split out separately.

import { accessSync, constants as fsConstants, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, delimiter as pathDelimiter, resolve } from 'node:path';
import type { ToolDefinition } from './models';
import { MAESTRO_OAUTH_BASE_URL } from './oauthConfig';

// engine/src/apps/toolsLib -> apps -> src -> engine -> repo root, same depth/pattern as
// apps/skills/skills.ts's own P_REPO_ROOT.
const P_REPO_ROOT = resolve(__dirname, '..', '..', '..', '..');
export const P_BACKEND_DIR = join(P_REPO_ROOT, 'backend');

// SUB-9: engine/dist/apps/toolsLib/mcpConfig.js -> dirname -> engine/dist/apps -> socialShims/<name>/main.js.
// One level up from P_REPO_ROOT's own __dirname-relative math above, since this points INSIDE
// engine/dist rather than out to the repo root.
function socialShimEntryPath(name: string): string {
  return join(dirname(__dirname), 'socialShims', name, 'main.js');
}

/** Resolve a real `node` executable to spawn one of SUB-9's compiled TS social-shim entry points
 * with -- same bundled-node > system-node > Electron-as-Node priority the npx/bunx bundle rewrite
 * below already uses for MCP-bundle servers (see that block's own comment), just without a
 * `pkgName` to look up: these shims are OUR OWN compiled files, not an npm package. Returns null
 * (leaving the stdio config untouched, i.e. still whatever tool.mcp_config originally held) only
 * if literally no Node can be found -- shouldn't happen in a real engine process, which is itself
 * running under Node, but resolveCommand's own PATH-search fallback below still gets a chance if
 * this returns null and the original config.command was left as-is. */
function resolveNodeForSocialShim(): string | null {
  const bundledNode = process.env.MAESTRO_NODE_PATH;
  if (bundledNode && existsSync(bundledNode)) return bundledNode;
  const systemNode = whichOnPath('node');
  if (systemNode) return systemNode;
  return process.env.MAESTRO_ELECTRON_PATH || null;
}

/** Convert a tool name into a valid MCP server identifier (alphanumeric + hyphens). Idempotent:
 * sanitizing an already-sanitized slug returns it unchanged. */
export function sanitizeServerName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function isExecutableFile(path: string): boolean {
  try {
    if (!statSync(path).isFile()) return false;
    if (process.platform === 'win32') return true; // no X_OK concept on Windows
    accessSync(path, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Well-known user-local bin directories that may not be on PATH in packaged apps. */
export function extraBinDirs(): string[] {
  const home = homedir();
  const dirs = [
    join(P_BACKEND_DIR, 'uv-bin'), // bundled uv-bin (ships uvx for non-dev users)
    join(home, '.bun', 'bin'),
    join(home, '.cargo', 'bin'),
    join(home, '.local', 'bin'),
    join(home, '.volta', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
  ];
  // nvm: pick the newest installed node version
  const nvmNode = join(home, '.nvm', 'versions', 'node');
  try {
    if (statSync(nvmNode).isDirectory()) {
      const versions = readdirSync(nvmNode).sort().reverse();
      if (versions.length > 0) dirs.unshift(join(nvmNode, versions[0], 'bin'));
    }
  } catch {
    // best-effort, mirrors the Python original's except OSError: pass.
  }
  // fnm
  const fnmBin = join(home, 'Library', 'Application Support', 'fnm', 'aliases', 'default', 'bin');
  try {
    if (statSync(fnmBin).isDirectory()) dirs.unshift(fnmBin);
  } catch {
    // not present, same as Python's os.path.isdir guard
  }
  return dirs;
}

function platformSuffixes(): string[] {
  return process.platform === 'win32' ? ['', ...(process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').toLowerCase().split(pathDelimiter)] : [''];
}

function probeDir(directory: string, command: string): string | null {
  for (const suffix of platformSuffixes()) {
    const candidate = join(directory, command + suffix);
    if (isExecutableFile(candidate)) return candidate;
  }
  return null;
}

/** True when `command` contains a path separator (forward or back slash) -- Python's
 * `shutil.which()` special-cases exactly this: given a path rather than a bare name, it validates
 * that FILE directly instead of searching PATH. `derive_mcp_config`'s bundled-node/bundled-Python
 * resolution can hand `discover_mcp_tools_stdio` an already-ABSOLUTE command (e.g. `MAESTRO_NODE_
 * PATH`'s resolved binary), so without this check every such call would incorrectly 400 with
 * "command not found" -- found via mcpDiscovery.test.ts's own real-spawn test failing against
 * `process.execPath` (an absolute path) before this fix existed. */
function looksLikePath(command: string): boolean {
  return command.includes('/') || command.includes('\\');
}

function whichOnPath(command: string): string | null {
  if (looksLikePath(command)) {
    for (const suffix of platformSuffixes()) {
      const candidate = command + suffix;
      if (isExecutableFile(candidate)) return candidate;
    }
    return null;
  }
  const pathEnv = process.env.PATH || process.env.Path || '';
  const dirs = pathEnv.split(pathDelimiter).filter(Boolean);
  for (const dir of dirs) {
    const hit = probeDir(dir, command);
    if (hit) return hit;
  }
  return null;
}

/** Find a command on PATH, falling back to common user-local bin directories and bundled binaries
 * (uv-bin for uvx/uv). Windows binaries need an extension; whichOnPath handles PATHEXT for PATH
 * lookups the same way extraBinDirs' probeDir does for the manually-scanned directories. */
export function resolveCommand(command: string): string | null {
  const onPath = whichOnPath(command);
  if (onPath) return onPath;
  if (looksLikePath(command)) return null; // already checked directly above; don't PATH-search a path
  for (const dir of extraBinDirs()) {
    const hit = probeDir(dir, command);
    if (hit) return hit;
  }
  // Check bundled uv-bin directory (ships uv/uvx for non-dev users)
  return probeDir(join(P_BACKEND_DIR, 'uv-bin'), command);
}

/** Return PATH with extra bin dirs prepended (for child process environments). */
export function augmentedPath(): string {
  const extra = extraBinDirs().filter((d) => {
    try {
      return statSync(d).isDirectory();
    } catch {
      return false;
    }
  });
  const current = process.env.PATH || process.env.Path || '';
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const p of [...extra, ...current.split(pathDelimiter)]) {
    if (p && !seen.has(p)) {
      seen.add(p);
      parts.push(p);
    }
  }
  return parts.join(pathDelimiter);
}

/** Build the claude_agent_sdk mcp_servers config entry for a tool. Returns null if the tool cannot
 * be configured (e.g. missing data). `homeStateDirFn`/`getInstallId`/`getAuthToken` are injected
 * (rather than imported directly) so this module doesn't reach into agents/settings-store
 * internals -- same DI-seam convention promptContext.ts/composeTurnSystemPrompt.ts already use for
 * their own not-yet-ported dependencies. */
export interface DeriveMcpConfigDeps {
  homeStateDir: (...parts: string[]) => string;
  getInstallId: () => string;
  getAuthToken: () => string;
  maestroPort: () => string;
}

export function deriveMcpConfig(tool: ToolDefinition, deps: DeriveMcpConfigDeps): Record<string, unknown> | null {
  if (!tool.mcp_config || Object.keys(tool.mcp_config).length === 0) return null;

  const config: Record<string, unknown> = { ...tool.mcp_config };
  const configType = config.type as string | undefined;

  if (tool.credentials && Object.keys(tool.credentials).length > 0) {
    if (configType === 'http' || configType === 'sse') {
      const headers = (config.headers as Record<string, string> | undefined) ?? {};
      config.headers = headers;
      for (const [key, val] of Object.entries(tool.credentials)) {
        const lk = key.toLowerCase();
        if ((lk === 'authorization' || lk === 'api_key' || lk === 'api-key') && headers.Authorization === undefined) {
          headers.Authorization = `Bearer ${val}`;
        }
      }
    } else {
      const env = (config.env as Record<string, string> | undefined) ?? {};
      config.env = env;
      Object.assign(env, tool.credentials);
    }
  }

  const oauthAccessToken = (tool.oauth_tokens as Record<string, unknown>)?.access_token as string | undefined;
  if (oauthAccessToken) {
    if (configType === 'http' || configType === 'sse') {
      const headers = (config.headers as Record<string, string> | undefined) ?? {};
      config.headers = headers;
      headers.Authorization = `Bearer ${oauthAccessToken}`;
    } else {
      const env = (config.env as Record<string, string> | undefined) ?? {};
      config.env = env;
      env.OAUTH_ACCESS_TOKEN = oauthAccessToken;
      if (tool.name.toLowerCase() === 'notion') env.NOTION_TOKEN = oauthAccessToken;
      if (tool.name.toLowerCase() === 'hubspot') env.PRIVATE_APP_ACCESS_TOKEN = oauthAccessToken;
      const refreshToken = (tool.oauth_tokens as Record<string, unknown>)?.refresh_token as string | undefined;
      if (refreshToken) env.GOOGLE_WORKSPACE_REFRESH_TOKEN = refreshToken;
      // google_workspace_mcp's gauth.py hardcodes token_uri to Google's real endpoint and refreshes
      // using the local CLIENT_ID/SECRET on every API call. OAuth runs through the cloud's rotation
      // pool, so the refresh_token is bound to whichever pool slot minted it, not the single client
      // baked into this build -- point token_uri at our local proxy instead (see toolsLib http.ts's
      // /google-oauth-token handler).
      const port = deps.maestroPort();
      env.GOOGLE_WORKSPACE_TOKEN_URI = `http://127.0.0.1:${port}/api/tools/google-oauth-token`;
      if (env.GOOGLE_WORKSPACE_CLIENT_ID === undefined) env.GOOGLE_WORKSPACE_CLIENT_ID = 'maestro-proxy';
      if (env.GOOGLE_WORKSPACE_CLIENT_SECRET === undefined) env.GOOGLE_WORKSPACE_CLIENT_SECRET = 'maestro-proxy';
    }
  }

  // Google Workspace MCP: redirect spawn through our shim (backend/apps/google_workspace_mcp_shim,
  // Python-only -- there is no TS twin to invoke here, so this stays a Python subprocess exactly
  // like the original, resolved by absolute path against the (read-only) backend/ tree).
  if (tool.name.toLowerCase() === 'google workspace' && configType === 'stdio') {
    const shimPath = join(P_BACKEND_DIR, 'apps', 'google_workspace_mcp_shim', 'run.py');
    config.command = 'uv';
    config.args = ['run', '--with', 'google-workspace-mcp', 'python', shimPath];
  }

  // Discord MCP -- SUB-9 full TS port (apps/socialShims/discord), spawned as a compiled Node
  // subprocess in place of the Python original (`python -m backend.apps.discord_mcp_shim`), same
  // rewrite-command-unconditionally posture the Google Workspace branch above already established.
  // No PYTHONPATH needed any more (nothing here imports backend.*); MAESTRO_OAUTH_BASE_URL +
  // MAESTRO_INSTALL_ID + (optionally) MAESTRO_DISCORD_GUILD_IDS are exactly what
  // apps/socialShims/discord/discordApi.ts reads at call time.
  if (tool.name.toLowerCase() === 'discord' && configType === 'stdio') {
    const env = (config.env as Record<string, string> | undefined) ?? {};
    config.env = env;
    env.MAESTRO_OAUTH_BASE_URL = MAESTRO_OAUTH_BASE_URL;
    env.MAESTRO_INSTALL_ID = deps.getInstallId();
    const guilds = ((tool.oauth_tokens as Record<string, unknown>)?.guilds as Array<Record<string, unknown>> | undefined) ?? [];
    const guildIds = guilds.map((g) => (g?.id as string | undefined) ?? '').filter(Boolean);
    if (guildIds.length > 0) env.MAESTRO_DISCORD_GUILD_IDS = guildIds.join(',');
    const nodeCmd = resolveNodeForSocialShim();
    if (nodeCmd) {
      config.command = nodeCmd;
      config.args = [socialShimEntryPath('discord')];
      if (nodeCmd === process.env.MAESTRO_ELECTRON_PATH) env.ELECTRON_RUN_AS_NODE = '1';
    }
  }

  // The session-borrow social shims (reddit/x/tiktok) -- SUB-9 full TS ports (apps/socialShims/
  // {reddit,tiktok,x}), each spawned as a compiled Node subprocess in place of the Python original
  // (`python -m backend.apps.<name>_mcp_shim`). They borrow the user's live browser session via
  // the engine's cookie bridge (BRW-6's /api/browser-session/cookies, native under
  // MAESTRO_BROWSER_ENGINE=cdp, proxied to Python's Electron-backed implementation otherwise --
  // apps/socialShims/common/sessionSource.ts is engine-aware by construction, see that file's own
  // header), so they need the localhost port + auth token. No PYTHONPATH any more (nothing here
  // imports backend.*).
  if (['reddit', 'x', 'tiktok'].includes(tool.name.toLowerCase()) && configType === 'stdio') {
    const env = (config.env as Record<string, string> | undefined) ?? {};
    config.env = env;
    env.MAESTRO_PORT = deps.maestroPort();
    env.MAESTRO_AUTH_TOKEN = deps.getAuthToken();
    const nodeCmd = resolveNodeForSocialShim();
    if (nodeCmd) {
      config.command = nodeCmd;
      config.args = [socialShimEntryPath(tool.name.toLowerCase())];
      if (nodeCmd === process.env.MAESTRO_ELECTRON_PATH) env.ELECTRON_RUN_AS_NODE = '1';
    }
  }

  // Microsoft 365 MCP: use a stable token cache path shared across process spawns.
  if (tool.name.toLowerCase() === 'microsoft 365' && configType === 'stdio') {
    const env = (config.env as Record<string, string> | undefined) ?? {};
    config.env = env;
    const cacheDir = deps.homeStateDir();
    mkdirSync(cacheDir, { recursive: true });
    env.MS365_MCP_TOKEN_CACHE_PATH = join(cacheDir, 'ms365-token-cache.json');
    env.MS365_MCP_SELECTED_ACCOUNT_PATH = join(cacheDir, 'ms365-selected-account.json');
  }

  if (configType === 'stdio') {
    let command = config.command as string | undefined;
    if (command) {
      // `python` (no version suffix) doesn't exist on a stock macOS; resolve to the actual
      // interpreter running the backend when we can determine it, else leave as-is (the engine has
      // no direct analogue of Python's sys.executable -- resolveCommand below still finds a
      // `python`/`python3` on PATH the same way the Python original's shutil.which fallback would).
      if (command === 'python') {
        const resolvedPython = whichOnPath('python3') || whichOnPath('python');
        if (resolvedPython) command = resolvedPython;
      }
      // Check for bundled npm MCP servers; use the bundled/system Node instead of npx/bunx cold-installing.
      if (command === 'npx' || command === 'bunx') {
        const args = (config.args as string[] | undefined) ?? [];
        const pkgName = args.find((a) => !a.startsWith('-'));
        if (pkgName) {
          const bundledNode = process.env.MAESTRO_NODE_PATH;
          const electronPath = process.env.MAESTRO_ELECTRON_PATH;
          // Two bundle layouts in mcp-bundles/, checked in priority order -- see
          // scripts/build-app-win.ps1's Build-McpBundleDir/Build-McpBundleSingle for how each gets
          // produced. Scoped names get flattened ("@foo/bar" -> "foo-bar") for filesystem safety.
          const safeBundle = pkgName.replace(/\//g, '-').replace(/@/g, '');
          const bundleDirPath = join(P_BACKEND_DIR, 'mcp-bundles', safeBundle, 'dist', 'index.js');
          const bundleFilePath = join(P_BACKEND_DIR, 'mcp-bundles', `${safeBundle}.js`);
          let bundlePath: string | null = null;
          if (existsSync(bundleDirPath)) bundlePath = bundleDirPath;
          else if (existsSync(bundleFilePath)) bundlePath = bundleFilePath;

          if (bundlePath && bundledNode && existsSync(bundledNode)) {
            config.command = bundledNode;
            config.args = [bundlePath];
          } else if (bundlePath && electronPath) {
            config.command = electronPath;
            config.args = [bundlePath];
            const env = (config.env as Record<string, string> | undefined) ?? {};
            config.env = env;
            env.ELECTRON_RUN_AS_NODE = '1';
          } else {
            // Check for pre-installed npm package (works in both dev and packaged modes)
            const safeDir = pkgName.replace(/\//g, '-').replace(/@/g, '');
            const npmDir = join(P_BACKEND_DIR, 'npm-servers', safeDir);
            const pkgJsonPath = join(npmDir, 'node_modules', pkgName, 'package.json');
            if (existsSync(pkgJsonPath)) {
              try {
                const pkgMeta = JSON.parse(readFileSync(pkgJsonPath, 'utf8')) as { bin?: Record<string, string> | string };
                const binField = pkgMeta.bin;
                const entry = typeof binField === 'object' && binField !== null ? Object.values(binField)[0] : binField;
                // Same priority as 9Router / MCP-bundle paths: bundled node > system node > Electron-as-Node.
                const nodeCmd = (bundledNode && existsSync(bundledNode) ? bundledNode : null) || whichOnPath('node') || electronPath;
                if (nodeCmd && entry) {
                  config.command = nodeCmd;
                  config.args = [join(npmDir, 'node_modules', pkgName, entry)];
                  if (nodeCmd === electronPath) {
                    const env = (config.env as Record<string, string> | undefined) ?? {};
                    config.env = env;
                    env.ELECTRON_RUN_AS_NODE = '1';
                  }
                }
              } catch {
                // Malformed package.json -- leave command as npx/bunx, same as the Python original
                // taking no explicit action when the pre-installed-package branch can't resolve.
              }
            }
          }
        }
      }

      const finalCommand = config.command as string;
      if (finalCommand && !isAbsolutePath(finalCommand)) {
        const resolved = resolveCommand(finalCommand);
        if (resolved) config.command = resolved;
      }
    }
    const env = (config.env as Record<string, string> | undefined) ?? {};
    config.env = env;
    if (env.PATH === undefined) env.PATH = augmentedPath();
    if (env.PYTHONPATH === undefined) env.PYTHONPATH = '';
    // Point uv/uvx at our bundled Python; avoids downloading Python at runtime.
    const isPackaged = process.env.MAESTRO_PACKAGED === '1';
    const isWindows = process.platform === 'win32';
    if (isPackaged) {
      const resources = dirname(P_BACKEND_DIR);
      const bundledPython = isWindows ? join(resources, 'python-env', 'python.exe') : join(resources, 'python-env', 'bin', 'python3');
      if (existsSync(bundledPython) && env.UV_PYTHON === undefined) env.UV_PYTHON = bundledPython;
    } else {
      const venvPython = isWindows ? join(P_BACKEND_DIR, '.venv', 'Scripts', 'python.exe') : join(P_BACKEND_DIR, '.venv', 'bin', 'python3');
      if (existsSync(venvPython) && env.UV_PYTHON === undefined) env.UV_PYTHON = venvPython;
    }
  }

  return config;
}

function isAbsolutePath(p: string): boolean {
  return /^([a-zA-Z]:[\\/]|\/)/.test(p);
}
