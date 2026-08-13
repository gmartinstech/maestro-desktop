"""Path definitions: dev under backend/data/, packaged under platform app-support.

The app-support folder name MUST match electron-builder's productName: main.js reads
this same settings.json through app.getPath('userData'), which derives from it.
"""

import os
import sys

P_BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

p_is_packaged = os.environ.get("MAESTRO_PACKAGED") == "1"

# An explicit override wins over BOTH branches below. Without it a packaged build always resolved to
# the real app-support dir, so an e2e run against the packaged binary read and wrote the developer's
# own sessions, dashboards and settings — the golden smoke was mutating live user data.
p_data_root_override = (os.environ.get("MAESTRO_DATA_ROOT") or "").strip()

if p_data_root_override:
    DATA_ROOT = os.path.abspath(os.path.expanduser(p_data_root_override))
elif p_is_packaged:
    if sys.platform == "darwin":
        p_app_support = os.path.join(os.path.expanduser("~"), "Library", "Application Support", "Maestro Studio")
    elif sys.platform == "win32":
        p_app_support = os.path.join(os.environ.get("APPDATA", os.path.expanduser("~")), "Maestro Studio")
    else:
        p_app_support = os.path.join(os.environ.get("XDG_DATA_HOME", os.path.join(os.path.expanduser("~"), ".local", "share")), "Maestro Studio")
    DATA_ROOT = os.path.join(p_app_support, "data")
else:
    DATA_ROOT = os.path.join(P_BACKEND_DIR, "data")

SESSIONS_DIR = os.path.join(DATA_ROOT, "sessions")
TOOLS_DIR = os.path.join(DATA_ROOT, "tools")
SETTINGS_DIR = os.path.join(DATA_ROOT, "settings")
MODES_DIR = os.path.join(DATA_ROOT, "modes")
DASHBOARDS_DIR = os.path.join(DATA_ROOT, "dashboards")
OUTPUTS_DIR = os.path.join(DATA_ROOT, "outputs")
OUTPUTS_WORKSPACE_DIR = os.path.join(DATA_ROOT, "outputs_workspace")
OUTPUTS_VERSIONS_DIR = os.path.join(DATA_ROOT, "outputs_versions")
SKILLS_WORKSPACE_DIR = os.path.join(DATA_ROOT, "skills_workspace")
DASHBOARD_LAYOUT_DIR = os.path.join(DATA_ROOT, "dashboard_layout")
BUILTIN_PERMISSIONS_PATH = os.path.join(DATA_ROOT, "builtin_permissions.json")
TRUSTED_SENSITIVE_PATHS_PATH = os.path.join(DATA_ROOT, "trusted_sensitive_paths.json")

# Per-install auth token for the localhost API; see auth.py.
AUTH_TOKEN_FILE = os.path.join(DATA_ROOT, "auth.token")

BACKEND_DIR = P_BACKEND_DIR
