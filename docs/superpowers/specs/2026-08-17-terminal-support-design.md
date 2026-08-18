# Interactive terminal support — design

## Problem

Maestro Studio has a pane labelled "Terminal"
(`frontend/src/app/pages/Views/TerminalPanel.tsx`) that is not a terminal. It
is a 108-line read-only log viewer: it renders `runtime:log` frames arriving
from `/ws/outputs/runtime/{workspace_id}/logs` as plain text with coloured
`[FRONTEND]` / `[BACKEND]` / `[RUNTIME]` prefixes. There is no input line, no
ANSI parsing, and the socket that feeds it is strictly one-directional — the
server never reads from it.

Nothing in the repository can run an interactive shell. There is no PTY
anywhere: no `node-pty`, no `xterm`, no `pywinpty`, `pexpect`, or `terminado`
in any of the three `package.json` files or the Python requirements. The
agent's `Bash` tool is not a counterexample — `Bash` is a string in an
allow-list (`backend/apps/agents/core/models.py:28`), executed inside the
`claude` CLI subprocess that the Agent SDK spawns. The Python side never
touches a shell, and every such command is one-shot: no persistent session, no
stdin channel, no TTY.

This design adds a real interactive shell: a PTY hosted by the Python backend,
streamed bidirectionally over an authenticated WebSocket into an `xterm.js`
pane in the existing view card.

## Decisions taken before design

Recorded because each closes off a branch that would otherwise reopen during
implementation:

- **Interactive terminal**, not a prettier renderer for agent command output
  and not a `maestro` CLI entry point.
- **PTY lives in the Python backend**, not in the Electron main process.
- **Upgrade the existing view-card tab strip** rather than adding a canvas
  card type or a global drawer.
- **Windows first**, with the platform seam designed for macOS/Linux but not
  validated there.
- **Split the tab in two** — `Logs` keeps today's read-only runtime feed,
  a new `>_ Shell` tab is the interactive terminal.
- **PowerShell, cwd = the card's workspace directory.**

## 1. Why the backend hosts the PTY

Both hosts were considered.

Electron main (`node-pty`) would give the lowest latency and would work with
the backend down. Against it: `node-pty` is a native module that must be
rebuilt against CastLabs Electron 40, ships per-architecture prebuilds into an
installer that was deliberately squeezed from 1.04 GB to 389 MB, and dies with
the renderer process. The preload is sandboxed
(`electron/main.js:1245-1254` sets `contextIsolation: true`,
`nodeIntegration: false`, and does not set `sandbox`, so it defaults on), which
means the native require would have to live in `main.js` and be surfaced across
new `terminal:*` channels on `window.maestro`.

The backend wins on reuse. `backend/apps/outputs/runtime.py` already implements
the exact streaming shape this feature needs — a long-lived child process, a
capped ring buffer, a subscriber set, and replay-on-connect — and
`backend/main.py`'s four WebSocket endpoints already share one auth gate. A
backend-hosted PTY survives renderer reloads, needs no Electron rebuild, and
adds no per-arch binary to the installer.

**The native-code cost does not disappear, it moves.** `pywinpty` is a native
wheel. It publishes prebuilt Windows wheels so `pip install` is uneventful on a
developer machine, but the packaged app vendors its own Python runtime, so the
build pipeline must carry the compiled extension. This is the same *class* of
packaging risk as `node-pty`, merely cheaper to resolve.

**Therefore step one of implementation is a packaging spike**, before any
feature code: add `pywinpty`, build the Windows installer, and confirm the
extension loads from the vendored runtime. If it does not, fall back to driving
ConPTY directly through `ctypes` against `kernel32`
(`CreatePseudoConsole` / `ResizePseudoConsole` / `ClosePseudoConsole` plus
anonymous pipes), which has no dependency at all at the cost of roughly 150
lines. The `PtyBackend` interface in §3 is what makes that substitution a
one-file change.

## 2. Data flow

```
xterm.js  (ShellPanel.tsx)
   │
   │  ws://127.0.0.1:<backend_port>/ws/terminal/{workspace_id}
   │      ?instance=N&token=…
   │
   │   client → server :  term:input {data}   term:resize {cols,rows}
   │   server → client :  term:output {data}  term:status {…}  term:exit {code}
   │
FastAPI  (backend/main.py, gated by p_ws_auth_ok)
   │
PtySessionManager → PtySession → PtyBackend → pwsh.exe -NoLogo   (cwd = workspace)
```

`data` in every frame is **base64**. PTY output is a byte stream, and a UTF-8
sequence can straddle a read boundary; base64 keeps the transport lossless and
lets `xterm.js` do the decoding. This is the one place the design deliberately
diverges from `AppRuntime`, which buffers decoded *lines* — correct for logs,
wrong for a TTY, where line-splitting would corrupt ANSI sequences and cursor
control.

## 3. Backend: `backend/apps/terminal/`

A new package, four modules.

### `pty_backend.py` — the platform seam

One interface, implemented per platform:

```python
class PtyBackend(Protocol):
    def spawn(self, argv: list[str], cwd: str, env: dict[str, str],
              cols: int, rows: int) -> None: ...
    async def read(self) -> bytes: ...      # b"" on EOF
    def write(self, data: bytes) -> None: ...
    def resize(self, cols: int, rows: int) -> None: ...
    def kill(self) -> None: ...
    @property
    def exit_code(self) -> int | None: ...
```

- `ConPtyBackend` — Windows, via `pywinpty` (or the `ctypes` fallback from §1).
  **Implemented and tested in this cut.**
- `UnixPtyBackend` — posix `pty.openpty` + `asyncio` reader.
  **Written, but explicitly untested; macOS/Linux is a follow-up ticket.**

Shell resolution, in order:

| Platform | Shell |
|---|---|
| Windows | `pwsh.exe` if on PATH, else `powershell.exe`, both with `-NoLogo` |
| macOS / Linux | `$SHELL` if set, else `/bin/bash`, with `-l` |

`shutil.which` performs the lookup, mirroring `p_resolve_bash()`
(`backend/apps/outputs/runtime.py:13`). Note this intentionally differs from
the agent's `Bash` tool, which runs Git Bash on Windows — the user asked for a
PowerShell prompt, and the agent has no access to this session anyway (§6).

### `pty_session.py` — one live shell

`PtySession` owns a `PtyBackend` plus:

- **A ring buffer of raw byte chunks**, capped at 256 KB, for replay. Chunks,
  never lines.
- **A subscriber set**, `subscribe()` returning an unsubscribe closure — the
  same contract as `AppRuntime.subscribe()` (`runtime.py:491`), which the
  existing runtime-log endpoint already consumes.
- `write(data: bytes)`, absent from every existing streaming path in the
  codebase and the reason this cannot simply extend `AppRuntime`.
- `resize(cols, rows)`.
- A reader task pumping `backend.read()` into the ring buffer and the
  subscribers until EOF, then broadcasting `term:exit`.

### `manager.py` — lifecycle

`PtySessionManager`, keyed by `(workspace_id, instance)`:

- Lazy spawn on first attach.
- Refcounted `attach()` / `detach()`, following `AppRuntimeManager`
  (`runtime.py:593`).
- **Detach does not kill.** A closed socket leaves the shell running so a
  reconnect resumes the same session with replayed scrollback. This is the
  whole point of hosting the PTY outside the renderer.
- Idle eviction after 30 minutes with no subscriber, and a cap of 8 live
  sessions, evicting least-recently-used — the pattern proven in
  `client_pool.py`.
- `kill_all()` on application shutdown, via `kill_descendant_tree`
  (`backend/apps/outputs/runtime_proc.py`). On Windows a killed parent leaves
  the child process tree running; orphaned `pwsh.exe` processes accumulating
  across restarts is the single most likely way this feature misbehaves in the
  wild, so shutdown must go through the descendant-tree kill and be tested.

### `env.py` — what the shell inherits

The shell inherits the backend's environment minus provider and cloud
credentials, reusing the scrub list already written for sandboxed Python
execution (`backend/apps/outputs/executor.py:91-158`). The user typing in their
own shell is trusted; the concern is narrower — `env` or a screen-share
casually printing the provedor-ia key. `TERM=xterm-256color` is added so
programs emit colour.

## 4. Transport: `/ws/terminal/{workspace_id}`

A fifth WebSocket endpoint in `backend/main.py`, alongside the four that exist.

**It goes through `p_ws_auth_ok` (`backend/main.py:235`) — token and origin
validated, closed with code 4401 before `accept()`.** This is the security
property the whole feature rests on. The backend binds `127.0.0.1`, but
loopback is not an authorisation boundary: any page in any browser on the
machine can open a localhost WebSocket. An unauthenticated endpoint here is a
remote shell for anything that can render HTML. The gate is not a detail to be
added later, and it needs a test that asserts a tokenless connection is refused.

Frames:

| Direction | Event | Payload |
|---|---|---|
| → client | `term:status` | `{ status: "running" \| "exited", shell, cwd }` |
| → client | `term:output` | `{ data: <base64> }` |
| → client | `term:exit` | `{ code: int }` |
| → server | `term:input` | `{ data: <base64> }` |
| → server | `term:resize` | `{ cols: int, rows: int }` |

On connect: attach, emit `term:status`, replay the ring buffer as one
`term:output`, then stream live. There is no separate signal frame — Ctrl-C is
`\x03` arriving as ordinary input, which is exactly what a PTY expects.

Unlike `/ws/agents/{session_id}`, this endpoint needs **no `seq_log` or gap
detection**. That machinery exists because agent events must not be lost or
duplicated across reconnects. A terminal's contract is weaker and simpler: on
reconnect you get the current scrollback buffer, and if output scrolled past
256 KB while you were disconnected it is gone, exactly as in any terminal
emulator. Adopting the seq machinery here would be cost without benefit.

## 5. Frontend

### Dependencies

`@xterm/xterm` and `@xterm/addon-fit` added to `frontend/package.json`.

The CSP (`frontend/public/index.html:17-32`) needs **no change** — verified:
`script-src` already allows `'unsafe-inline'`/`'unsafe-eval'`, `worker-src` is
`'self' blob:`, and `connect-src` already permits `ws://127.0.0.1:*`. The one
CSP constraint to respect is `font-src`, which allows `'self'` and `data:` but
not an arbitrary CDN — irrelevant here, since the terminal uses `font.mono`
(IBM Plex Mono) from the existing token set.

### Components

- **`frontend/src/app/pages/Views/ShellPanel.tsx`** (new) — an `xterm.js`
  instance with `FitAddon`. Colours come from `useTermColors()`
  (`frontend/src/app/pages/AgentChat/parsing/toolColorize.tsx`), which is
  already a theme-aware terminal palette, mapped onto xterm's `ITheme`.
  Container resize → `fit()` → `term:resize`. `onData` → `term:input`.
- **`frontend/src/shared/hooks/useTerminalSocket.ts`** (new) — modelled on
  `useRuntimePreviewUrl.ts`: a raw `WebSocket` with a ref-pinned `onOutput`
  callback and reconnect. Deliberately **not** built on `WebSocketManager`,
  which is session/dashboard-scoped and dispatches straight into Redux slices;
  terminal bytes have no business passing through the store.
- **`DashboardViewCard.tsx`** — `AppCardView` (line 39) becomes
  `'preview' | 'code' | 'logs' | 'shell' | 'history'`. The existing `terminal`
  value renames to `logs` and keeps `TerminalPanel` unchanged; `shell` is new.
  Tab strip gains one entry. The shell pane stays **mounted but hidden** when
  another tab is active — CSS visibility, following `DashboardHost.tsx` —
  because re-initialising xterm and re-fitting on every tab switch is visibly
  jarring even though the PTY itself survives server-side.

### State

**No new Redux slice.** Scrollback is server-side and replays on connect;
everything else is component-local. `TerminalPanel`'s existing buffer already
works this way.

### i18n

New keys in **both** `frontend/src/shared/i18n/en.json` and `pt-BR.json`.
`dashboard.viewCard.terminal` becomes `dashboard.viewCard.logs`, plus
`dashboard.viewCard.shell`, and a `views.shell.*` group for connecting /
disconnected / exited states. There is no parity test between the two bundles,
so both files must be edited in the same commit by hand.

## 6. Security posture

Two distinct trust questions, with different answers.

**Transport** is the real boundary, handled in §4: authenticated, origin-checked,
tested.

**Command content is not gated.** The agent permission stack —
`effective_policy` (`permissions/decision.py`), `path_gate`'s catastrophic-write
and OS-scheduling overrides, the approval-card round trip — does not apply to
this session. That stack exists to put a human in the loop before an LLM runs a
destructive command. Here the human *is* the one typing, at the same trust level
as opening PowerShell from the Start menu; interposing approval cards would be
theatre.

This holds only while the agent has no access to the session, which is why "the
agent shares the user's shell" is out of scope (§8) rather than merely
unimplemented. Should that change, command gating must be revisited as part of
the same change, not bolted on after.

## 7. Testing

Backend, with `MAESTRO_MOCK_AGENT` **unset** per `CLAUDE.md` (baseline: 6
pre-existing failures, 1745 passing — the suite must not regress past that):

- `PtySession` against a fake `PtyBackend`: output reaches subscribers, input
  reaches the backend, ring buffer caps and replays, EOF broadcasts `term:exit`.
- `PtySessionManager`: refcount attach/detach, detach does not kill, idle
  eviction, LRU cap.
- Env scrub: provider keys absent, `TERM` present.
- **Auth**: a connection without a valid token is refused with 4401.
- A Windows-only real-ConPTY smoke test: spawn, `echo maestro`, assert the
  bytes come back, assert the process tree is gone after `kill_all()`.

Frontend (vitest): `useTerminalSocket` frame encode/decode and reconnect;
`ShellPanel` render smoke with a stubbed socket.

`npm run verify` green is the merge gate.

## 8. Out of scope

Deliberately excluded from this cut, each a separate ticket if wanted:

- Agent access to the shell session (see §6 — this one carries a design
  dependency, not just work).
- More than one terminal per card; split panes.
- A settings UI for shell path or default cwd.
- Search, link detection, or other xterm addons.
- Session persistence across application restart.
- macOS and Linux validation.

## 9. Risks

| Risk | Mitigation |
|---|---|
| `pywinpty` does not load from the vendored Python runtime in the packaged build | Packaging spike is step one, before feature code; `ctypes`/ConPTY fallback behind the `PtyBackend` interface |
| Orphaned `pwsh.exe` process trees after shutdown or crash | `kill_descendant_tree` on shutdown, asserted by the Windows smoke test |
| xterm.js bundle size on an installer that was deliberately trimmed | `@xterm/xterm` + fit addon is roughly 250 KB minified, against a 389 MB installer — measured in the packaging spike alongside `pywinpty` |
| Unauthenticated localhost WebSocket exposing a shell | `p_ws_auth_ok` before `accept()`, with an explicit refusal test |
| Renaming `terminal` → `logs` silently breaks a persisted `activeView` | The value is component-local `useState`, not persisted layout — verified; no migration needed |
