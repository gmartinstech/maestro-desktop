"""End-to-end integration test of the real browser agent loop.

Drives run_browser_agent() with only the two external boundaries faked: the LLM
client (scripted tool calls) and the browser executor (scripted results). Proves
the four ported behaviors fire together in the actual loop, not just in isolation:
  - goal threading into BrowserListInteractives,
  - deterministic stagnation nudges,
  - exactly-once aux-LLM adjudication at exhaustion,
  - per-domain hints written, then seeded into the system prompt next run.
"""

import asyncio
import json
import uuid

from backend.apps.agents.browser import browser_agent as BA
from backend.apps.agents.browser import browser_history as BH


# --- fake Anthropic-shaped objects -----------------------------------------
class Blk:
    def __init__(self, type, text=None, id=None, name=None, input=None):
        self.type = type; self.text = text; self.id = id; self.name = name; self.input = input


class Resp:
    def __init__(self, content, stop_reason="tool_use"):
        self.content = content
        self.stop_reason = stop_reason
        self.usage = type("U", (), {"input_tokens": 1, "output_tokens": 1})()


class FakeLLM:
    def __init__(self, scripted):
        self.scripted = scripted; self.turn = 0; self.calls = []
        self.messages = self

    async def create(self, **kw):
        self.calls.append(kw)
        i = min(self.turn, len(self.scripted) - 1)
        self.turn += 1
        return self.scripted[i]


class FakeAux:
    def __init__(self):
        self.calls = []
        self.messages = self

    async def create(self, **kw):
        self.calls.append(kw)
        return Resp([Blk("text", "Try BrowserListInteractives then BrowserClickIndex.")], stop_reason="end_turn")


def _tu(name, **inp):
    return Blk("tool_use", id="t" + uuid.uuid4().hex[:8], name=name, input=inp)


def _rp(goal, mem="Share dialog is a cross-origin iframe; use the index list."):
    return _tu("ReportProgress", evaluation_previous="prev", working_memory=mem, next_goal=goal)


DOC_URL = "https://docs.google.com/document/d/abc/edit"


def _install(monkeypatch, primary, aux):
    # local imports inside run_browser_agent resolve from these source modules
    import backend.apps.settings.settings as settings_mod
    import backend.apps.settings.credentials as cred_mod
    import backend.apps.agents.providers.registry as reg_mod
    import backend.apps.agents.agent_manager as am_mod

    monkeypatch.setattr(settings_mod, "load_settings", lambda: {"fake": True}, raising=True)
    monkeypatch.setattr(reg_mod, "_find_builtin_model", lambda m: object(), raising=True)
    monkeypatch.setattr(reg_mod, "resolve_model_id_for_sdk", lambda m, s: "primary-x", raising=True)

    async def _aux_resolve(s, preferred_tier="haiku"):
        return ("aux-x", None)
    monkeypatch.setattr(reg_mod, "resolve_aux_model", _aux_resolve, raising=True)

    def _client_for(s, model):
        return aux if model == "aux-x" else primary
    monkeypatch.setattr(cred_mod, "get_anthropic_client_for_model", _client_for, raising=True)

    monkeypatch.setattr(BA, "load_builtin_permissions", lambda: {}, raising=True)
    monkeypatch.setattr(am_mod.agent_manager, "_sync_session_close", lambda *a, **k: None, raising=False)

    # fake WS: record browser commands, script results by action
    sent = []

    async def _send_browser_command(request_id, action, browser_id, params, tab_id=""):
        sent.append({"action": action, "params": params})
        if action == "list_interactives":
            return {"text": '1 interactive elements:\n[1]<button "Submit">', "url": DOC_URL}
        if action == "click":
            return {"error": "Element not found: '.submit'"}
        if action == "navigate":
            return {"text": "Navigated", "url": params.get("url", DOC_URL)}
        if action == "screenshot":
            return {"text": "shot"}
        return {"text": "ok", "url": DOC_URL}

    async def _noop(*a, **k):
        return None

    monkeypatch.setattr(BA.ws_manager, "send_browser_command", _send_browser_command, raising=False)
    monkeypatch.setattr(BA.ws_manager, "send_to_session", _noop, raising=False)
    return sent


def test_full_loop_goal_stagnation_adjudication_and_hint_write(monkeypatch):
    BH._browser_history.clear(); BH._domain_notes.clear()
    primary = FakeLLM([
        Resp([_rp("click the Submit button"), _tu("BrowserListInteractives")]),
        Resp([_rp("click submit"), _tu("BrowserClick", selector=".s1")]),
        Resp([_rp("retry"), _tu("BrowserClick", selector=".s2")]),
        Resp([_rp("retry"), _tu("BrowserClick", selector=".s3")]),
        Resp([_rp("retry"), _tu("BrowserClick", selector=".s4")]),
        Resp([_rp("retry"), _tu("BrowserClick", selector=".s5")]),
        Resp([Blk("text", "Giving up cleanly.")], stop_reason="end_turn"),
    ])
    aux = FakeAux()
    sent = _install(monkeypatch, primary, aux)

    result = asyncio.run(BA.run_browser_agent(
        task="Share the doc with someone", browser_id="b1", model="sonnet",
    ))
    assert result["browser_id"] == "b1"

    # 1) goal threaded into the real list_interactives call
    list_calls = [c for c in sent if c["action"] == "list_interactives"]
    assert list_calls and list_calls[0]["params"].get("goal") == "click the Submit button"

    # 2) stagnation nudge injected into a tool_result (seen by a later LLM turn)
    all_msgs = json.dumps([c["messages"] for c in primary.calls])
    assert "NO PROGRESS" in all_msgs

    # 3) aux adjudication fired EXACTLY once, at exhaustion, and was injected
    assert len(aux.calls) == 1
    assert "Suggested next step" in all_msgs

    # 4) per-domain hint written from working_memory
    assert "cross-origin iframe" in BH.get_domain_note("google.com")


def test_aux_adjudication_fires_even_when_loop_detector_trips(monkeypatch):
    # Repeated IDENTICAL failing clicks trip the exact-repeat loop detector AND
    # reach stagnation exhaustion on the same turn. The aux escape hatch must
    # still fire (it was previously suppressed by the `not is_loop` guard).
    BH._browser_history.clear(); BH._domain_notes.clear()
    primary = FakeLLM([
        Resp([_rp("click submit"), _tu("BrowserListInteractives")]),
        *[Resp([_rp("retry same"), _tu("BrowserClick", selector=".same")]) for _ in range(6)],
        Resp([Blk("text", "done")], stop_reason="end_turn"),
    ])
    aux = FakeAux()
    sent = _install(monkeypatch, primary, aux)

    asyncio.run(BA.run_browser_agent(
        task="Share the doc", browser_id="b3", model="sonnet",
    ))
    all_msgs = json.dumps([c["messages"] for c in primary.calls])
    # the loop detector definitely tripped (identical tool+input+result)
    assert "LOOP DETECTED" in all_msgs
    # ...and the aux adjudication STILL fired exactly once despite that
    assert len(aux.calls) == 1
    assert "Suggested next step" in all_msgs


def test_prior_domain_hint_is_seeded_into_system_prompt(monkeypatch):
    BH._browser_history.clear(); BH._domain_notes.clear()
    BH.set_domain_note("google.com", "REMEMBERED: Share button is index 43; Tab into the dialog.")
    primary = FakeLLM([Resp([Blk("text", "done")], stop_reason="end_turn")])
    aux = FakeAux()
    _install(monkeypatch, primary, aux)

    asyncio.run(BA.run_browser_agent(
        task="open the doc", browser_id="b2", model="sonnet", initial_url=DOC_URL,
    ))
    assert primary.calls, "LLM should have been called"
    system = primary.calls[0]["system"]
    assert "Notes from a previous visit" in system
    assert "REMEMBERED: Share button is index 43" in system
    assert len(aux.calls) == 0  # no exhaustion, no adjudication on a clean run
