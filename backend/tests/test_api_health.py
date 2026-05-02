"""Health endpoint contract.

The Electron main process polls /api/health/check before it has the
auth token (the HTTP port is up before main.js calls loadAuthToken()).
Two invariants this test pins down:

  1. The path is auth-exempt — Electron's pre-token poll succeeds.
  2. The response is plain-text "OK" — required by AWS ALB health
     checks and (more practically) Electron's boot handshake which
     reads the body literally instead of parsing JSON.
"""

from __future__ import annotations


def test_health_check_returns_plain_ok(client):
    resp = client.get("/api/health/check")
    assert resp.status_code == 200
    assert resp.text == "OK"
    assert resp.headers["content-type"].startswith("text/plain")


def test_health_check_does_not_require_auth(app, tmp_data_dirs):
    """Hit /api/health/check WITHOUT the bearer header.

    Uses a fresh TestClient (the shared `client` fixture pre-injects
    auth headers, which would mask a regression in the exempt-list).
    """
    from fastapi.testclient import TestClient

    with TestClient(app) as tc:
        resp = tc.get("/api/health/check")

    assert resp.status_code == 200
    assert resp.text == "OK"
