"""The one exception that means "this turn cannot start: the provedor-ia session is dead".

Its own leaf module so error_classify (a pure classifier) can recognise it without
importing settings, and so the raise site and the classifier agree by TYPE rather
than by matching each other's prose. Carries the token STATE only ("expired" /
"missing"), never the token, and never any part of it.
"""

from __future__ import annotations


class ProvedorIaSessionExpiredError(Exception):
    """Raised before the CLI spawns when the selected model routes through provedor-ia on a dead token."""

    def __init__(self, state: str) -> None:
        self.state = state
        # Wording matters: the string reaches logs and the classifier's regex, so it must read as auth, never as a bad model.
        super().__init__(
            f"provedor-ia session is not authenticated (token {state}); "
            "unauthorized until the user signs in again"
        )
