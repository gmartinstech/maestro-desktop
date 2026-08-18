"""The backend binds 127.0.0.1, but loopback is not an authorization boundary: any page in any browser on this machine can open a localhost WebSocket. An ungated route here is a remote shell for anything that can render HTML, so the refusal test is the most important one in this file."""

import base64
import json
import time
import pytest
from fastapi.testclient import TestClient
from fastapi import WebSocketDisconnect
import backend.main as main_mod


class p_StubSession:
    """Stands in for a real PTY so the route can be tested without spawning a shell."""

    def __init__(self):
        self.written = []
        self.sizes = []
        self.running = True
        self.shell = "pwsh.exe"
        self.cwd = "C:\\ws"
        self.p_callback = None

    def subscribe(self, callback):
        self.p_callback = callback
        callback(b"replayed")
        return lambda: None

    def write(self, data):
        self.written.append(data)

    def resize(self, cols, rows):
        self.sizes.append((cols, rows))

    @property
    def exit_code(self):
        return 0


@pytest.fixture
def p_stub(monkeypatch, tmp_path):
    session = p_StubSession()
    detached = {"count": 0}

    async def p_attach(workspace_id, instance, cwd):
        return session

    async def p_detach(workspace_id, instance):
        detached["count"] += 1

    from backend.apps.terminal import manager as manager_mod
    monkeypatch.setattr(manager_mod.manager, "attach", p_attach, raising=True)
    monkeypatch.setattr(manager_mod.manager, "detach", p_detach, raising=True)
    monkeypatch.setattr(main_mod, "p_terminal_cwd", lambda ws: str(tmp_path), raising=True)
    session.p_detached = detached
    return session


def test_connection_without_token_is_refused():
    """Deliberately does NOT stub the gate: this asserts the real token check runs before accept(), which is the property that keeps the route from being a remote shell."""
    client = TestClient(main_mod.app)
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/ws/terminal/ws1") as ws:
            ws.receive_text()


def test_status_then_replay_on_connect(monkeypatch, p_stub):
    monkeypatch.setattr(main_mod, "p_ws_auth_ok", lambda ws: True, raising=True)
    client = TestClient(main_mod.app)
    with client.websocket_connect("/ws/terminal/ws1") as ws:
        status = json.loads(ws.receive_text())
        assert status["event"] == "term:status"
        assert status["data"]["shell"] == "pwsh.exe"
        out = json.loads(ws.receive_text())
        assert out["event"] == "term:output"
        assert base64.b64decode(out["data"]["data"]) == b"replayed"


def test_input_and_resize_frames_reach_the_session(monkeypatch, p_stub):
    monkeypatch.setattr(main_mod, "p_ws_auth_ok", lambda ws: True, raising=True)
    client = TestClient(main_mod.app)
    with client.websocket_connect("/ws/terminal/ws1") as ws:
        json.loads(ws.receive_text())
        json.loads(ws.receive_text())
        payload = base64.b64encode(b"echo hi\r").decode("ascii")
        ws.send_text(json.dumps({"event": "term:input", "data": {"data": payload}}))
        ws.send_text(json.dumps({"event": "term:resize", "data": {"cols": 120, "rows": 40}}))
        time.sleep(0.3)
    assert b"echo hi\r" in p_stub.written
    assert (120, 40) in p_stub.sizes


def test_malformed_frame_does_not_kill_the_socket(monkeypatch, p_stub):
    monkeypatch.setattr(main_mod, "p_ws_auth_ok", lambda ws: True, raising=True)
    client = TestClient(main_mod.app)
    with client.websocket_connect("/ws/terminal/ws1") as ws:
        json.loads(ws.receive_text())
        json.loads(ws.receive_text())
        ws.send_text("not json at all")
        ws.send_text(json.dumps({"event": "term:input", "data": {"data": base64.b64encode(b"survived").decode("ascii")}}))
        time.sleep(0.3)
    assert b"survived" in p_stub.written


def test_disconnect_detaches_but_does_not_stop(monkeypatch, p_stub):
    """Detach-not-kill is the whole reason the PTY lives in the backend; a route that stops the session on close silently breaks tab switching."""
    monkeypatch.setattr(main_mod, "p_ws_auth_ok", lambda ws: True, raising=True)
    client = TestClient(main_mod.app)
    with client.websocket_connect("/ws/terminal/ws1") as ws:
        json.loads(ws.receive_text())
    time.sleep(0.3)
    assert p_stub.p_detached["count"] == 1
    assert p_stub.running is True


def test_live_output_streams_after_connect(monkeypatch, p_stub):
    monkeypatch.setattr(main_mod, "p_ws_auth_ok", lambda ws: True, raising=True)
    client = TestClient(main_mod.app)
    with client.websocket_connect("/ws/terminal/ws1") as ws:
        json.loads(ws.receive_text())
        json.loads(ws.receive_text())
        p_stub.p_callback(b"\x1b[31mred\x1b[0m")
        out = json.loads(ws.receive_text())
        assert out["event"] == "term:output"
        assert base64.b64decode(out["data"]["data"]) == b"\x1b[31mred\x1b[0m"
