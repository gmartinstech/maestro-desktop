"""The shell inherits the backend's environment, which holds the provedor-ia token. Without this scrub a user running `env` on a screen-share leaks it. PATH deliberately survives: pywinpty resolves argv[0] through it, so stripping PATH the way executor.py does would make the shell unspawnable."""

from backend.apps.terminal.env import build_terminal_env


def test_provider_credentials_are_scrubbed(monkeypatch):
    monkeypatch.setenv("PROVEDOR_IA_TOKEN", "secret-value")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-should-not-appear")
    env = build_terminal_env()
    assert "PROVEDOR_IA_TOKEN" not in env
    assert "ANTHROPIC_API_KEY" not in env
    assert "secret-value" not in env.values()


def test_ordinary_vars_survive(monkeypatch):
    monkeypatch.setenv("MAESTRO_HARMLESS_VAR", "kept")
    env = build_terminal_env()
    assert env["MAESTRO_HARMLESS_VAR"] == "kept"


def test_path_survives_because_spawn_needs_it(monkeypatch):
    monkeypatch.setenv("PATH", "C:\\somewhere")
    env = build_terminal_env()
    assert env.get("PATH") == "C:\\somewhere"


def test_term_is_set_for_color():
    env = build_terminal_env()
    assert env["TERM"] == "xterm-256color"
