# WS contract (hand-frozen)

OpenAPI (`contract/openapi.json`) only covers HTTP. These five files are the WebSocket
equivalent: hand-written TypeScript discriminated unions for every distinct message shape
the backend can send over each of the five real WS endpoints (`backend/main.py`):

- `agents.ts` — `/ws/agents/{session_id}`
- `runtime-logs.ts` — `/ws/outputs/runtime/{workspace_id}/logs`
- `electron-main.ts` — `/ws/electron-main`
- `dashboard.ts` — `/ws/dashboard`
- `terminal.ts` — `/ws/terminal/{workspace_id}`

Source of truth for what the backend **emits**: `backend/apps/agents/core/ws_manager.py`
(`send_to_session`, `broadcast_global`, `send_approval_request`, `send_browser_command`,
`send_main_command`) plus the five `@app.websocket(...)` handlers in `backend/main.py`
that write frames directly (`server:hello`, `server:pong`, `agent:gap_detected`,
`runtime:status`, `runtime:log`, `runtime:not_attached`, `term:status`, `term:output`,
`term:exit`).

Source of truth for what the frontend **consumes**: `frontend/src/shared/ws/WebSocketManager.ts`
(`handleMessage`'s `switch (event)`, shared by `/ws/agents/{session_id}` and `/ws/dashboard`);
for `/ws/terminal/{workspace_id}`, `frontend/src/shared/terminalFrames.ts`'s
`decodeTerminalFrame()` (a separate raw-WebSocket codec, not routed through
`WebSocketManager.ts`); and, for the Electron-main bridge, `electron/main.js`'s
`connectMainBridge()` (read-only reference, not modified by this contract or by CTR-2).

**If a WS event changes shape or a new one is added, update these types FIRST**, then bring
the emitting and consuming code into line with the new type. That order is the point of
freezing the contract by hand: a shape drift shows up as a TypeScript error in
`WebSocketManager.ts` (or `terminalFrames.ts`, for the terminal socket) instead of silently
dropping a frame in production.

## What's deliberately out of scope here

- Client→server frames (`client:hello`, `client:ping`, `agent:send_message`,
  `agent:approval_response`, `agent:stop`, `browser:result`, `dashboard:active`, `term:input`,
  `term:resize`) are documented as a side export in each file for completeness, but the gate is
  about the backend-emitted (server→client) side only.
