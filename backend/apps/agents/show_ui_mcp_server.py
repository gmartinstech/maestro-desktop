#!/usr/bin/env python3
"""Stdio MCP server exposing ShowUI: render a rich inline component in the chat transcript.

Display-only. The frontend renders the component straight from the tool_call input it already
has in the transcript, so this server just validates the payload and acknowledges; there is no
backend round-trip and nothing here can mutate state.
"""

import json
import sys

MAX_PROPS_BYTES = 20_000

COMPONENT_SPECS = {
    "weather": "props: {location: str, temp: number, unit?: 'F'|'C', high?: number, low?: number, condition?: str, forecast?: [{day: str, condition?: str, high: number, low?: number}] (max 7)}",
    "plan": "props: {title?: str, steps: [{label: str, status: 'pending'|'in_progress'|'completed'}] (max 20)}",
    "stats": "props: {title?: str, stats: [{label: str, value: str, delta?: str, direction?: 'up'|'down'}] (max 8)}",
    "links": "props: {links: [{title: str, url: str, description?: str}] (max 10)}",
    # tool-ui vendored set: props follow the upstream Serializable contracts (https://tool-ui.com);
    # the client validates strictly and shows a validation note instead of rendering on mismatch.
    "data-table": "tabular results. props: {id: str, columns: [{key: str, label: str}], data: [{<key>: str|number|bool}]}",
    "citation": "sourced claims. props: {id: str, citations: [{id: str, title: str, url?: str, snippet?: str}]}",
    "item-carousel": "browsable items. props: {id: str, items: [{id: str, title: str, description?: str, imageUrl?: str, badge?: str}]}",
    "link-preview": "one rich link card. props: {id: str, url: str, title: str, description?: str, imageUrl?: str, siteName?: str}",
    "progress-tracker": "multi-stage progress. props: {id: str, stages: [{id: str, label: str, status: 'pending'|'active'|'complete'|'error'}]}",
    "order-summary": "purchase/receipt breakdown. props: {id: str, items: [{id: str, label: str, amount: number}], total?: number, currency?: str}",
    "terminal": "command output. props: {id: str, command?: str, output: str}",
    "image": "single image. props: {id: str, src: str, alt?: str, caption?: str}",
    "image-gallery": "several images. props: {id: str, images: [{src: str, alt?: str}]}",
    "video": "video embed. props: {id: str, src: str, poster?: str, title?: str}",
    "message-draft": "email/message draft for review. props: {id: str, to?: [str], subject?: str, body: str}",
    "x-post": "an X/Twitter post preview. props: {id: str, author: {name: str, handle: str}, text: str}",
    "linkedin-post": "a LinkedIn post preview. props: {id: str, author: {name: str, headline?: str}, text: str}",
    "instagram-post": "an Instagram post preview. props: {id: str, username: str, imageUrl: str, caption?: str}",
    "option-list": "choices for the user (display for now). props: {id: str, options: [{id: str, label: str, description?: str}], selectionMode?: 'single'|'multi'}",
    "question-flow": "step-by-step question sequence (display for now). props follow the upstream question-flow contract",
    "parameter-slider": "adjustable parameters (display for now). props: {id: str, parameters: [{id: str, label: str, min: number, max: number, value: number, step?: number}]}",
    "preferences-panel": "grouped preference toggles (display for now). props follow the upstream preferences-panel contract",
    "approval-card": "an approve/reject summary card. props follow the upstream approval-card contract",
    "stats-display": "upstream stats-display contract (prefer 'stats' unless you need its exact shape)",
}

TOOLS = [
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
    if component == "plan" and not (isinstance(props.get("steps"), list) and props["steps"]):
        return f"plan needs a non-empty steps list. {COMPONENT_SPECS['plan']}"
    if component == "stats" and not (isinstance(props.get("stats"), list) and props["stats"]):
        return f"stats needs a non-empty stats list. {COMPONENT_SPECS['stats']}"
    if component == "links" and not (isinstance(props.get("links"), list) and props["links"]):
        return f"links needs a non-empty links list. {COMPONENT_SPECS['links']}"
    # Vendored tool-ui components validate deeply client-side against their zod contracts; here we
    # only shape-check so a wrong payload comes back as a teaching error instead of a dead render.
    return ""


def handle_tool_call(tool_name: str, arguments: dict) -> dict:
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
