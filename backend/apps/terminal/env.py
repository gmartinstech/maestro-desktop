"""What the user's shell inherits. The user typing here is trusted, so this is not a sandbox; the narrow goal is that `env` or a screen-share does not casually print the provedor-ia key."""

import os
from typing import Dict
from typeguard import typechecked

# Mirrors executor.py's credential list by intent, not by import: that one also strips PATH, which pywinpty needs to resolve argv[0] and which a usable shell cannot do without.
P_SCRUBBED_ENV_KEYS = frozenset({
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_BASE_URL",
    "OPENAI_API_KEY",
    "PROVEDOR_IA_TOKEN",
    "PROVEDOR_IA_BASE_URL",
    "MAESTRO_AUTH_TOKEN",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "AWS_SESSION_TOKEN",
    "GOOGLE_API_KEY",
    "GEMINI_API_KEY",
    "GITHUB_TOKEN",
})


@typechecked
def build_terminal_env() -> Dict[str, str]:
    """Inherit the backend environment minus provider credentials, plus a TERM that makes programs emit color."""
    env = {k: v for k, v in os.environ.items() if k not in P_SCRUBBED_ENV_KEYS}
    env["TERM"] = "xterm-256color"
    return env
