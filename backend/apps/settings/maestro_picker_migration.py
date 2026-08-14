"""Rewrite the one persisted string shape that changed under the Maestro slug rename.

`custom_provider_slug_for_lookup` used to slugify "provedor-ia" to "provedor-ia"
(already a valid slug); after the display-identity rename it slugifies "Maestro" to
"maestro". Every picker value ever persisted as `custom/provedor-ia/<model>` (settings'
default_model, a workflow/agent's per-step model override, ...) now points at a
provider the picker no longer serves. This is the one, narrow, string-level fix: it
does not know or care WHERE a picker value is stored, only what one of them looks like.
"""

from __future__ import annotations

from typing import Any

from typeguard import typechecked

P_STALE_PICKER_PREFIX = "custom/provedor-ia/"
P_NEW_PICKER_PREFIX = "custom/maestro/"


@typechecked
def migrate_picker_value(value: str) -> str:
    """`custom/provedor-ia/<model>` -> `custom/maestro/<model>`; anything else unchanged."""
    if value.startswith(P_STALE_PICKER_PREFIX):
        return P_NEW_PICKER_PREFIX + value[len(P_STALE_PICKER_PREFIX):]
    return value


def migrate_picker_values_in_place(obj: Any) -> bool:
    """Walk a JSON-shaped dict/list IN PLACE, rewriting every stale picker-value
    string found at any depth. Returns True when anything changed. Deliberately
    untyped/blunt (not a schema-aware migration): a workflow/agent config's model
    fields are scattered across several optional keys, and matching by VALUE SHAPE
    (the unmistakable `custom/provedor-ia/` prefix) reaches every one of them
    without hand-listing each field name and re-drifting the day a new one is added.
    """
    changed = False
    if isinstance(obj, dict):
        for k, v in list(obj.items()):
            if isinstance(v, str):
                new_v = migrate_picker_value(v)
                if new_v != v:
                    obj[k] = new_v
                    changed = True
            elif isinstance(v, (dict, list)):
                changed = migrate_picker_values_in_place(v) or changed
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            if isinstance(v, str):
                new_v = migrate_picker_value(v)
                if new_v != v:
                    obj[i] = new_v
                    changed = True
            elif isinstance(v, (dict, list)):
                changed = migrate_picker_values_in_place(v) or changed
    return changed
