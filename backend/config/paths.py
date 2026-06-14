"""Path definitions: dev under backend/data/, packaged under platform app-support."""

import os
import sys

P_BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

P_IS_PACKAGED = os.environ.get("OPENSWARM_PACKAGED") == "1"

if P_IS_PACKAGED:
    if sys.platform == "darwin":
        app_support = os.path.join(os.path.expanduser("~"), "Library", "Application Support", "OpenSwarm")
    elif sys.platform == "win32":
        app_support = os.path.join(os.environ.get("APPDATA", os.path.expanduser("~")), "OpenSwarm")
    else:
        app_support = os.path.join(os.environ.get("XDG_DATA_HOME", os.path.join(os.path.expanduser("~"), ".local", "share")), "OpenSwarm")
    DATA_ROOT = os.path.join(app_support, "data")
else:
    DATA_ROOT = os.path.join(P_BACKEND_DIR, "data")

SESSIONS_DIR = os.path.join(DATA_ROOT, "sessions")
TOOLS_DIR = os.path.join(DATA_ROOT, "tools")
SETTINGS_DIR = os.path.join(DATA_ROOT, "settings")
MODES_DIR = os.path.join(DATA_ROOT, "modes")
DASHBOARDS_DIR = os.path.join(DATA_ROOT, "dashboards")
OUTPUTS_DIR = os.path.join(DATA_ROOT, "outputs")
OUTPUTS_WORKSPACE_DIR = os.path.join(DATA_ROOT, "outputs_workspace")
SKILLS_WORKSPACE_DIR = os.path.join(DATA_ROOT, "skills_workspace")
DASHBOARD_LAYOUT_DIR = os.path.join(DATA_ROOT, "dashboard_layout")
BUILTIN_PERMISSIONS_PATH = os.path.join(DATA_ROOT, "builtin_permissions.json")
TRUSTED_SENSITIVE_PATHS_PATH = os.path.join(DATA_ROOT, "trusted_sensitive_paths.json")

# Per-install auth token for the localhost API; see auth.py.
AUTH_TOKEN_FILE = os.path.join(DATA_ROOT, "auth.token")

BACKEND_DIR = P_BACKEND_DIR
