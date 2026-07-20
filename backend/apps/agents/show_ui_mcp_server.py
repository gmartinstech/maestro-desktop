#!/usr/bin/env python3
"""Stdio MCP server exposing ShowUI: render a rich inline component in the chat transcript.

Display-only. The frontend renders the component straight from the tool_call input it already
has in the transcript, so this server just validates the payload and acknowledges; there is no
backend round-trip and nothing here can mutate state.
"""

import json
import os
import sys
import urllib.error
import urllib.request

BACKEND_PORT = os.environ.get("OPENSWARM_PORT", "8324")
BACKEND_AUTH = os.environ.get("OPENSWARM_AUTH_TOKEN", "")
PARENT_SESSION_ID = os.environ.get("OPENSWARM_PARENT_SESSION_ID", "")
WAIT_URL = f"http://127.0.0.1:{BACKEND_PORT}/api/ui-requests/wait"
ASK_TIMEOUT_S = 600

MAX_PROPS_BYTES = 20_000

COMPONENT_SPECS = {
    "weather": "props: {location: str, temp: number, unit?: 'F'|'C', high?: number, low?: number, condition?: str, forecast?: [{day: str, condition?: str, high: number, low?: number}] (max 7)}",
    "stats": "props: {title?: str, stats: [{label: str, value: str, delta?: str, direction?: 'up'|'down'}] (max 8)}",
    "links": "props: {links: [{title: str, url: str, description?: str}] (max 10)}",
    # Vendored tool-ui set (MIT, https://tool-ui.com); hints are AUTO-GENERATED from the shipped zod
    # contracts by frontend/scripts/gen-toolui-hints.ts. Regenerate after upgrading src/toolui.
    "approval-card": "props: {id: str, role?: 'information'|'decision'|'control'|'state'|'composite', title: str, description?: str, icon?: str, metadata?: [{key: str, value: str}], variant?: 'default'|'destructive', confirmLabel?: str, cancelLabel?: str, choice?: 'approved'|'denied'}",
    "audio": "props: {id: str, role?: 'information'|'decision'|'control'|'state'|'composite', receipt?: {outcome: 'success'|'partial'|'failed'|'cancelled', summary: str, identifiers?: obj, at: str}, assetId: str, src: str, title?: str, description?: str, artwork?: str, durationMs?: num, fileSizeBytes?: num, createdAt?: str, locale?: str, source?: {label: str, iconUrl?: str, u...",
    "chart": "props: {id: str, role?: 'information'|'decision'|'control'|'state'|'composite', receipt?: {outcome: 'success'|'partial'|'failed'|'cancelled', summary: str, identifiers?: obj, at: str}, type: 'bar'|'line', title?: str, description?: str, data: [{}], xKey: str, series: [{key: str, label: str, color?: str}], colors?: [str], showLegend?: bool, showGrid?: bool}",
    "citation": "props: {id: str, role?: 'information'|'decision'|'control'|'state'|'composite', receipt?: {outcome: 'success'|'partial'|'failed'|'cancelled', summary: str, identifiers?: obj, at: str}, href: str, title: str, snippet?: str, domain?: str, favicon?: str, author?: str, publishedAt?: str, type?: 'webpage'|'document'|'article'|'api'|'code'|'other', locale?: str}",
    "code-block": "props: {id: str, role?: 'information'|'decision'|'control'|'state'|'composite', receipt?: {outcome: 'success'|'partial'|'failed'|'cancelled', summary: str, identifiers?: obj, at: str}, code: str, language?: str, lineNumbers?: 'visible'|'hidden', filename?: str, highlightLines?: [num], maxCollapsedLines?: num}",
    "code-diff": "props: {id: str, role?: 'information'|'decision'|'control'|'state'|'composite', receipt?: {outcome: 'success'|'partial'|'failed'|'cancelled', summary: str, identifiers?: obj, at: str}, oldCode?: str, newCode?: str, patch?: str, language?: str, filename?: str, lineNumbers?: 'visible'|'hidden', diffStyle?: 'unified'|'split', maxCollapsedLines?: num}",
    "data-table": "props: {id: str, role?: 'information'|'decision'|'control'|'state'|'composite', receipt?: {outcome: 'success'|'partial'|'failed'|'cancelled', summary: str, identifiers?: obj, at: str}, columns: [{key: str, label: str, abbr?: str, sortable?: bool, align?: 'left'|'right'|'center', width?: str, truncate?: bool, priority?: 'primary'|'secondary'|'tertiary', hideOnMob...",
    "geo-map": "props: {id: str, role?: 'information'|'decision'|'control'|'state'|'composite', receipt?: {outcome: 'success'|'partial'|'failed'|'cancelled', summary: str, identifiers?: obj, at: str}, title?: str, description?: str, markers: [{id?: str, lat: num, lng: num, label?: str, description?: str, tooltip?: 'none'|'hover'|'always', icon?: obj|obj|obj}], routes?: [{id?: s...",
    "image": "props: {id: str, role?: 'information'|'decision'|'control'|'state'|'composite', receipt?: {outcome: 'success'|'partial'|'failed'|'cancelled', summary: str, identifiers?: obj, at: str}, assetId: str, src: str, alt: str, title?: str, description?: str, href?: str, domain?: str, ratio?: 'auto'|'1:1'|'4:3'|'16:9'|'9:16', fit?: 'cover'|'contain', fileSizeBytes?: num,...",
    "image-gallery": "props: {id: str, role?: 'information'|'decision'|'control'|'state'|'composite', receipt?: {outcome: 'success'|'partial'|'failed'|'cancelled', summary: str, identifiers?: obj, at: str}, images: [{id: str, src: str, alt: str, width: num, height: num, title?: str, caption?: str, source?: obj}], title?: str, description?: str}",
    "instagram-post": "props: {id: str, author: {name: str, handle: str, avatarUrl: str, verified?: bool}, text?: str, media?: [{type: 'image'|'video', url: str, alt: str}], stats?: {likes?: num, isLiked?: bool}, createdAt?: str}",
    "item-carousel": "props: {id: str, name: str, subtitle?: str, image?: str, color?: str, actions?: [{id: str, label: str, sentence?: str, confirmLabel?: str, variant?: 'default'|'destructive'|'secondary'|'ghost'|'outline', loading?: bool, disabled?: bool, shortcut?: str}]}",
    "link-preview": "props: {id: str, role?: 'information'|'decision'|'control'|'state'|'composite', receipt?: {outcome: 'success'|'partial'|'failed'|'cancelled', summary: str, identifiers?: obj, at: str}, href: str, title?: str, description?: str, image?: str, domain?: str, favicon?: str, ratio?: 'auto'|'1:1'|'4:3'|'16:9'|'9:16', fit?: 'cover'|'contain', createdAt?: str, locale?: str}",
    "linkedin-post": "props: {id: str, author: {name: str, avatarUrl: str, headline?: str}, text?: str, media?: {type: 'image'|'video', url: str, alt: str}, linkPreview?: {url: str, title?: str, description?: str, imageUrl?: str, domain?: str}, stats?: {likes?: num, isLiked?: bool}, createdAt?: str}",
    "message-draft": "props: {id: str, role?: 'information'|'decision'|'control'|'state'|'composite', body: str, outcome?: 'sent'|'cancelled', channel: str, subject: str, from?: str, to: [str], cc?: [str], bcc?: [str]}",
    "option-list": "props: {id: str, role?: 'information'|'decision'|'control'|'state'|'composite', receipt?: {outcome: 'success'|'partial'|'failed'|'cancelled', summary: str, identifiers?: obj, at: str}, options: [{id: str, label: str, description?: str, disabled?: bool}], selectionMode?: 'multi'|'single', defaultValue?: [str]|str|any, choice?: [str]|str|any, actions?: [{id: str, ...",
    "order-summary": "props: {id: str, role?: 'information'|'decision'|'control'|'state'|'composite', title?: str, variant?: 'summary'|'receipt', items: [{id: str, name: str, description?: str, imageUrl?: str, quantity?: num, unitPrice: num}], pricing: {subtotal: num, tax?: num, taxLabel?: str, shipping?: num, discount?: num, discountLabel?: str, total: num, currency?: str}, choice?:...",
    "parameter-slider": "props: {id: str, role?: 'information'|'decision'|'control'|'state'|'composite', sliders: [{id: str, label: str, min: num, max: num, step?: num, value: num, unit?: str, precision?: num, disabled?: bool, trackClassName?: str, fillClassName?: str, handleClassName?: str}], actions?: [{id: str, label: str, sentence?: str, confirmLabel?: str, variant?: 'default'|'dest...",
    "plan": "props: {id: str, role?: 'information'|'decision'|'control'|'state'|'composite', receipt?: {outcome: 'success'|'partial'|'failed'|'cancelled', summary: str, identifiers?: obj, at: str}, title: str, description?: str, todos: [{id: str, label: str, status: 'pending'|'in_progress'|'completed'|'cancelled', description?: str}], maxVisibleTodos?: num}",
    "preferences-panel": "props: {id: str, role?: 'information'|'decision'|'control'|'state'|'composite', receipt?: {outcome: 'success'|'partial'|'failed'|'cancelled', summary: str, identifiers?: obj, at: str}, title?: str, sections: [{heading?: str, items: [any]}], actions?: [{id: str, label: str, sentence?: str, confirmLabel?: str, variant?: 'default'|'destructive'|'secondary'|'ghost'|...",
    "progress-tracker": "props: {id: str, role?: 'information'|'decision'|'control'|'state'|'composite', steps: [{id: str, label: str, description?: str, status: 'pending'|'in-progress'|'completed'|'failed'}], elapsedTime?: num, choice?: {outcome: 'success'|'partial'|'failed'|'cancelled', summary: str, identifiers?: obj, at: str}}",
    "question-flow": "props: {id: str, role?: 'information'|'decision'|'control'|'state'|'composite', step: num, title: str, description?: str, options: [{id: str, label: str, description?: str, disabled?: bool}], selectionMode?: 'single'|'multi'}",
    "stats-display": "props: {id: str, role?: 'information'|'decision'|'control'|'state'|'composite', title?: str, description?: str, stats: [{key: str, label: str, value: str|num, format?: any, diff?: obj, sparkline?: obj}]}",
    "terminal": "props: {id: str, role?: 'information'|'decision'|'control'|'state'|'composite', receipt?: {outcome: 'success'|'partial'|'failed'|'cancelled', summary: str, identifiers?: obj, at: str}, command: str, stdout?: str, stderr?: str, exitCode: num, durationMs?: num, cwd?: str, truncated?: bool, maxCollapsedLines?: num}",
    "video": "props: {id: str, role?: 'information'|'decision'|'control'|'state'|'composite', receipt?: {outcome: 'success'|'partial'|'failed'|'cancelled', summary: str, identifiers?: obj, at: str}, assetId: str, src: str, poster?: str, title?: str, description?: str, href?: str, domain?: str, durationMs?: num, ratio?: 'auto'|'1:1'|'4:3'|'16:9'|'9:16', fit?: 'cover'|'contain'...",
    "x-post": "props: {id: str, author: {name: str, handle: str, avatarUrl: str, verified?: bool}, text?: str, media?: {type: 'image'|'video', url: str, alt: str, aspectRatio?: '1:1'|'4:3'|'16:9'|'9:16'}, linkPreview?: {url: str, title?: str, description?: str, imageUrl?: str, domain?: str}, quotedPost?: any, stats?: {likes?: num, isLiked?: bool, isReposted?: bool, isBookmarke...",
}

INTERACTIVE_COMPONENTS = (
    "option-list", "question-flow", "parameter-slider", "preferences-panel", "approval-card",
)

TOOLS = [
    {
        "name": "AskUI",
        "description": (
            "Render an INTERACTIVE component in the chat and WAIT for the user's answer (up to 10 "
            "minutes); the tool result is their response. Use this instead of plain-text questions "
            "when the choice fits a component. Components: "
            + ", ".join(f"'{name}'" for name in INTERACTIVE_COMPONENTS)
            + ". Props follow the same shapes as ShowUI (props.id is REQUIRED, it correlates the "
            "answer). The response contains the action taken and the user's selection/values."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "component": {
                    "type": "string",
                    "enum": list(INTERACTIVE_COMPONENTS),
                    "description": "Which interactive component to render.",
                },
                "props": {
                    "type": "object",
                    "description": "Data for the component; must include a stable string id.",
                },
            },
            "required": ["component", "props"],
        },
    },
    {
        "name": "ShowUI",
        "description": (
            "Render a rich inline UI component in the chat instead of describing data as text. "
            "Use it whenever a result fits one of the shapes. Supported components:\n"
            + "\n".join(f"- '{name}': {spec}" for name, spec in COMPONENT_SPECS.items())
            + "\nCall it with the component name and a props object matching that shape. "
            "The component renders in place of raw text; still give a one-line text summary after."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "component": {
                    "type": "string",
                    "enum": list(COMPONENT_SPECS.keys()),
                    "description": "Which component to render.",
                },
                "props": {
                    "type": "object",
                    "description": "Data for the component, matching its documented shape.",
                },
            },
            "required": ["component", "props"],
        },
    },
]


def send_response(id_, result=None, error=None):
    msg = {"jsonrpc": "2.0", "id": id_}
    if error is not None:
        msg["error"] = error
    else:
        msg["result"] = result
    sys.stdout.write(json.dumps(msg) + "\n")
    sys.stdout.flush()


def validate(component: str, props: dict) -> str:
    if component not in COMPONENT_SPECS:
        return f"Unknown component {component!r}. Supported: {', '.join(COMPONENT_SPECS)}."
    try:
        size = len(json.dumps(props))
    except (TypeError, ValueError):
        return "props must be JSON-serializable."
    if size > MAX_PROPS_BYTES:
        return f"props too large ({size} bytes; max {MAX_PROPS_BYTES})."
    if component == "weather" and not (isinstance(props.get("location"), str) and isinstance(props.get("temp"), (int, float))):
        return f"weather needs at least location + temp. {COMPONENT_SPECS['weather']}"
    if component == "stats" and not (isinstance(props.get("stats"), list) and props["stats"]):
        return f"stats needs a non-empty stats list. {COMPONENT_SPECS['stats']}"
    if component == "links" and not (isinstance(props.get("links"), list) and props["links"]):
        return f"links needs a non-empty links list. {COMPONENT_SPECS['links']}"
    # Vendored tool-ui components validate deeply client-side against their zod contracts; here we
    # only shape-check so a wrong payload comes back as a teaching error instead of a dead render.
    return ""


def p_post(url: str, body: dict, timeout: float) -> dict:
    payload = json.dumps(body).encode()
    headers = {"Content-Type": "application/json"}
    if BACKEND_AUTH:
        headers["Authorization"] = f"Bearer {BACKEND_AUTH}"
    req = urllib.request.Request(url, data=payload, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        body_txt = e.read().decode(errors="replace") if e.fp else str(e)
        return {"error": f"HTTP {e.code}: {body_txt[:300]}"}
    except Exception as e:
        return {"error": str(e)}


def handle_ask_ui(arguments: dict) -> dict:
    component = str(arguments.get("component", "")).strip()
    props = arguments.get("props")
    if not isinstance(props, dict):
        return {"content": [{"type": "text", "text": "props must be an object."}], "isError": True}
    if component not in INTERACTIVE_COMPONENTS:
        return {"content": [{"type": "text", "text": f"AskUI only supports: {', '.join(INTERACTIVE_COMPONENTS)}. Use ShowUI for display-only components."}], "isError": True}
    component_id = str(props.get("id", "")).strip()
    if not component_id:
        return {"content": [{"type": "text", "text": "props.id (a stable string) is required so the answer can be correlated."}], "isError": True}
    problem = validate(component, props)
    if problem:
        return {"content": [{"type": "text", "text": f"Not rendered: {problem}"}], "isError": True}
    r = p_post(WAIT_URL, {"session_id": PARENT_SESSION_ID, "component_id": component_id, "timeout_s": ASK_TIMEOUT_S}, timeout=ASK_TIMEOUT_S + 20)
    if "error" in r:
        return {"content": [{"type": "text", "text": f"AskUI failed: {r['error']}"}], "isError": True}
    if not r.get("ok"):
        return {"content": [{"type": "text", "text": "The user didn't respond within 10 minutes. Continue without their input or ask again."}], "isError": True}
    return {"content": [{"type": "text", "text": json.dumps(r.get("response"))}]}


def handle_tool_call(tool_name: str, arguments: dict) -> dict:
    if tool_name == "AskUI":
        return handle_ask_ui(arguments)
    if tool_name != "ShowUI":
        return {"content": [{"type": "text", "text": f"Unknown tool: {tool_name}"}], "isError": True}
    component = str(arguments.get("component", "")).strip()
    props = arguments.get("props")
    if not isinstance(props, dict):
        return {"content": [{"type": "text", "text": "props must be an object."}], "isError": True}
    problem = validate(component, props)
    if problem:
        return {"content": [{"type": "text", "text": f"Not rendered: {problem}"}], "isError": True}
    return {"content": [{"type": "text", "text": f"Rendered a '{component}' component inline."}]}


def main():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            continue

        method = msg.get("method")
        id_ = msg.get("id")
        params = msg.get("params", {}) or {}

        if method == "initialize":
            send_response(id_, {
                "protocolVersion": "2024-11-05",
                "capabilities": {"tools": {}},
                "serverInfo": {
                    "name": "openswarm-ui",
                    "version": "1.0.0",
                },
            })
        elif method == "notifications/initialized":
            pass
        elif method == "tools/list":
            send_response(id_, {"tools": TOOLS})
        elif method == "tools/call":
            tool_name = params.get("name", "")
            arguments = params.get("arguments", {}) or {}
            result = handle_tool_call(tool_name, arguments)
            send_response(id_, result)
        elif method == "ping":
            send_response(id_, {})
        elif id_ is not None:
            send_response(id_, error={"code": -32601, "message": f"Method not found: {method}"})


if __name__ == "__main__":
    main()
