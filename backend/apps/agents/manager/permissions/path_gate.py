"""Defense-in-depth permission gate, lifted verbatim out of the agent loop so it's
independently testable. Flips a permissive tool policy to 'ask' when a write would land
on a sensitive path (SSH keys, shell rc files, keychains, system dirs), when a shell
command writes to a catastrophic path, or when a shell command looks like OS-level
scheduling (crontab/launchctl/schtasks). The trusted-paths allowlist is reloaded on every
call so a trust decision taken during one approval applies to any later prompt in the
same turn.

"Shell command" means any tool in SHELL_TOOLS, not just Bash: on Windows the CLI's shell
tool is named `PowerShell`, so testing the name `Bash` alone left every check in here
inert on this product's primary platform."""

import fnmatch
import os
import re
from typing import Dict, FrozenSet, Optional, Tuple

from typeguard import typechecked

from backend.apps.tools_lib.tools_lib import load_trusted_sensitive_paths

# Each entry: pattern -> (short label, plain-English risk). The label/risk is what the approval card shows, so it has to read clearly to a non-developer who has never heard of `~/.ssh/authorized_keys`.
P_SENSITIVE_PATH_INFO: Dict[str, Tuple[str, str]] = {
    "*/.ssh": ("SSH folder (~/.ssh)", "Controls who can log in to your computer remotely."),
    "*/.ssh/*": ("SSH folder (~/.ssh)", "Controls who can log in to your computer remotely."),
    "*/.aws/*": ("AWS credentials (~/.aws)", "Cloud account access keys; can spend money and read your data."),
    "*/.config/gcloud/*": ("Google Cloud credentials", "Cloud account access; can spend money and read your data."),
    "*/.kube/*": ("Kubernetes config (~/.kube)", "Admin access to your Kubernetes clusters."),
    "*/.gnupg/*": ("GPG encryption keys", "Your private encryption keys; lets attackers decrypt your data or sign as you."),
    "*/.docker/config*": ("Docker credentials", "Login tokens for container registries."),
    "*/.zshrc": ("Shell startup file (.zshrc)", "Runs automatically every time you open a terminal."),
    "*/.bashrc": ("Shell startup file (.bashrc)", "Runs automatically every time you open a terminal."),
    "*/.bash_profile": ("Shell startup file (.bash_profile)", "Runs automatically every time you log in."),
    "*/.profile": ("Shell startup file (.profile)", "Runs automatically every time you log in."),
    "*/.zprofile": ("Shell startup file (.zprofile)", "Runs automatically every time you log in."),
    "*/.zshenv": ("Shell environment file (.zshenv)", "Runs automatically for every shell, including non-interactive ones."),
    "*/.gitconfig": ("Global Git config", "Affects every Git command you run; can hijack commits."),
    "*/.npmrc": ("npm auth file (~/.npmrc)", "Lets you publish npm packages; a token here can publish malicious packages as you."),
    "*/.pypirc": ("PyPI auth file (~/.pypirc)", "Lets you publish Python packages; a token here can publish malicious packages as you."),
    "*/.netrc": ("Stored login info (~/.netrc)", "Saved passwords for various services."),
    "*/Library/Keychains/*": ("macOS Keychain", "Where macOS stores all your saved passwords."),
    "/etc/*": ("System config (/etc)", "Affects the whole computer, not just your account."),
    "/private/etc/*": ("System config (/etc)", "Affects the whole computer, not just your account."),
    "/System/*": ("macOS system folder", "Affects the whole computer; should almost never be modified."),
    "/usr/local/etc/*": ("System config (/usr/local/etc)", "Affects the whole computer, not just your account."),
}
P_SENSITIVE_PATH_PATTERNS: Tuple[str, ...] = tuple(P_SENSITIVE_PATH_INFO.keys())

P_PATH_GATED_TOOLS: Tuple[str, ...] = ("Write", "Edit", "NotebookEdit")

# Every tool whose input is an arbitrary shell command under the key `command`, by the exact names the bundled CLI ships: it defines both "Bash" and "PowerShell" and hands Windows the latter, and Monitor runs its `command` through the same shell backend (persistently, which is worse), so all three need the catastrophic-path and scheduling checks below.
SHELL_TOOLS: FrozenSet[str] = frozenset({"Bash", "PowerShell", "Monitor"})
# The bundled-CLI version whose tool-name surface was read out of the binary by hand; test_path_gate's drift test fails when the SDK moves it, so the manifests get re-audited instead of silently going stale.
AUDITED_CLI_VERSION: str = "2.1.122"

# OS-level scheduling across macOS/Linux/Windows. The agent must not install cron entries, launchd plists, Windows scheduled tasks, or PowerShell ScheduledTask cmdlets behind the user's back. Word-bounded so stray strings in echo etc. don't trip it.
P_OS_SCHED_RE = re.compile(
    r"\b("
    r"crontab|launchctl|launchd|schtasks|systemd-run|"
    r"systemctl\s+--user.*timer|at\s+\d|at\s+now|at\s+-f|"
    r"Register-ScheduledTask|New-ScheduledTask|Set-ScheduledTask|"
    r"Register-ScheduledJob|New-ScheduledJob"
    r")\b",
    re.IGNORECASE,
)

# Catastrophic-path shell gate. Shell tools are intentionally NOT in P_PATH_GATED_TOOLS (gating every `echo ... > /tmp/foo` would interrupt routine work), but a single redirected write to one of these can grant persistent attacker access or break the OS unrecoverably. The trust list is shared with Write/Edit so one "Always allow" covers both surfaces.
P_BASH_CATASTROPHIC_INFO: Dict[str, Tuple[str, str]] = {
    "*/.ssh/*": ("SSH folder (~/.ssh)", "Controls who can log in to your computer remotely."),
    "/etc/sudoers": ("Sudo permissions (/etc/sudoers)", "Controls which commands can run with admin privileges."),
    "/etc/sudoers.d/*": ("Sudo permissions (/etc/sudoers.d)", "Controls which commands can run with admin privileges."),
    "/etc/passwd": ("System user list (/etc/passwd)", "Defines every user account on this computer."),
    "/etc/shadow": ("System password file (/etc/shadow)", "Stores password hashes for every user account."),
    "*/Library/Keychains/*": ("macOS Keychain", "Where macOS stores all your saved passwords."),
    "/System/*": ("macOS system folder", "Affects the whole computer; should almost never be modified."),
}
P_BASH_CATASTROPHIC_PATTERNS: Tuple[str, ...] = tuple(P_BASH_CATASTROPHIC_INFO.keys())

# Pulls quoted strings AND bare path-like tokens out of a shell command. Backslash is a leading/continuing token character so Windows-native targets (`$env:USERPROFILE\.ssh\authorized_keys`, `C:\Users\me\.ssh\...`) are captured, not truncated at the first separator. Intentionally loose: a false positive just means an extra approval prompt, never a missed gate.
P_BASH_PATH_TOKEN_RE = re.compile(
    r"""(?P<quoted>"[^"]+"|'[^']+')|(?P<bare>[~/\\.][\w./\\~\-]*)"""
)

# Write operators we care about; presence alone isn't enough, a sensitive target in the same command is also required. Covers shell redirection, Unix tools with a destination flag, and the PowerShell cmdlets that are the only idiomatic way to write a file on Windows (`cp`/`mv`/`rm`/`tee` already cover their PowerShell aliases).
P_BASH_WRITE_OP_RE = re.compile(
    r"(?:>>?|\btee\b|\bsed\s+-i\b|\bcp\b|\bmv\b|\bdd\b[^|]*\bof=|\binstall\b|\bchmod\b|\bchown\b|\brm\b|\btouch\b|\bmkdir\b|\bln\b"
    r"|\bSet-Content\b|\bAdd-Content\b|\bOut-File\b|\bNew-Item(?:Property)?\b|\bCopy-Item\b|\bMove-Item\b|\bRemove-Item\b|\bRename-Item\b|\bSet-ItemProperty\b|\bTee-Object\b|\bSet-Acl\b)",
    re.IGNORECASE,
)


@typechecked
def match_sensitive_pattern(file_path: str) -> Optional[str]:
    """The matched sensitive pattern, or None if the path isn't sensitive OR the user has
    trusted that pattern. The trusted list reloads per call so a same-turn trust decision
    takes effect immediately (no in-process cache to invalidate)."""
    if not file_path or not isinstance(file_path, str):
        return None
    try:
        norm = os.path.normpath(os.path.expanduser(file_path))
    except Exception:
        return None
    # Forward-slash the path so patterns match on Windows too; os.path.normpath emits backslashes there and fnmatch treats '/' as literal. Without this the gate would silently no-op on Windows and a prompt-injected Write to ~/.ssh/... would pass.
    if os.sep != '/':
        norm = norm.replace(os.sep, '/')
    trusted = set(load_trusted_sensitive_paths())
    for pat in P_SENSITIVE_PATH_PATTERNS:
        if pat in trusted:
            continue
        if fnmatch.fnmatch(norm, pat):
            return pat
    return None


@typechecked
def looks_like_os_scheduling(tool_input: object) -> bool:
    if not isinstance(tool_input, dict):
        return False
    cmd = str(tool_input.get("command") or "")
    if not cmd:
        return False
    return bool(P_OS_SCHED_RE.search(cmd))


@typechecked
def match_bash_catastrophic_pattern(command: str) -> Optional[str]:
    """The matched catastrophic-path pattern for a shell command (Bash or PowerShell), or None
    if it isn't writing to one (or the user has trusted it). Same trust-list as
    match_sensitive_pattern."""
    if not command or not isinstance(command, str):
        return None
    if not P_BASH_WRITE_OP_RE.search(command):
        return None
    trusted = set(load_trusted_sensitive_paths())
    for raw_match in P_BASH_PATH_TOKEN_RE.finditer(command):
        tok = (raw_match.group("quoted") or raw_match.group("bare") or "")
        if tok and tok[0] in ("'", '"'):
            tok = tok[1:-1]
        if not tok:
            continue
        try:
            # Backslashes are folded to '/' here rather than via os.sep so a PowerShell command gets the same verdict on a POSIX CI box as on the Windows machine that would actually run it.
            norm = os.path.normpath(os.path.expanduser(tok.replace("\\", "/")))
        except Exception:
            continue
        if os.sep != '/':
            norm = norm.replace(os.sep, '/')
        for pat in P_BASH_CATASTROPHIC_PATTERNS:
            if pat in trusted:
                continue
            if fnmatch.fnmatch(norm, pat):
                return pat
    return None


@typechecked
def extract_target_path(tool_name: str, tool_input: object) -> str:
    if not isinstance(tool_input, dict):
        return ""
    if tool_name == "NotebookEdit":
        return str(tool_input.get("notebook_path") or "")
    return str(tool_input.get("file_path") or "")


# Native-scheduler MCP tools that commit or mutate a recurring schedule. Always-on MCP servers fall through to the always_allow default, so these would otherwise fire silently; force them through ApprovalBar. The Cron* tools are Claude's own internal scheduler, denied outright in favour of the visible/auditable native one.
SCHEDULE_GATED: FrozenSet[str] = frozenset({
    "mcp__maestro-schedule__ScheduleWorkflow",
    "mcp__maestro-schedule__UpdateScheduledWorkflow",
    "mcp__maestro-schedule__DeleteScheduledWorkflow",
    "mcp__maestro-schedule__PauseAllWorkflows",
    # RemoteTrigger is the CLI's own scheduler: it creates, updates and fires cron-scheduled remote agents through the claude.ai routines API, which is the crontab threat with a different transport, and it authenticates in-process so nothing else in this gate would ever see it.
    "RemoteTrigger",
})
CLAUDE_INTERNAL_SCHEDULER_TOOLS = ("CronCreate", "CronList", "CronDelete")


@typechecked
def maybe_override_policy(policy: str, tool_name: str, tool_input: object) -> Tuple[str, Optional[str]]:
    """Returns (effective_policy, matched_sensitive_pattern). Flips a permissive policy to
    'ask' when the target is a sensitive/catastrophic path or the shell command looks like OS
    scheduling, even if the user set the tool to always_allow, so a prompt-injected agent
    writing to ~/.ssh/authorized_keys still gets surfaced. Once the user trusts a pattern,
    future writes to it pass through silently."""
    if tool_name in SHELL_TOOLS and looks_like_os_scheduling(tool_input):
        return "ask", None
    if tool_name in CLAUDE_INTERNAL_SCHEDULER_TOOLS:
        return "deny", None
    # Committing or mutating a native recurring schedule is the in-app twin of the crontab gate above: real, user-visible, hard-to-undo, so it goes through ApprovalBar every time regardless of the always_allow default.
    if tool_name in SCHEDULE_GATED:
        return "ask", None
    if tool_name in SHELL_TOOLS and isinstance(tool_input, dict):
        shell_match = match_bash_catastrophic_pattern(str(tool_input.get("command") or ""))
        if shell_match:
            return "ask", shell_match
    if policy != "always_allow" or tool_name not in P_PATH_GATED_TOOLS:
        return policy, None
    matched = match_sensitive_pattern(extract_target_path(tool_name, tool_input))
    if matched:
        return "ask", matched
    return policy, None


@typechecked
def describe_sensitive_pattern(pattern: str) -> Optional[Tuple[str, str]]:
    """The (short label, plain-English risk) shown on the approval card for a matched
    pattern, from either table; None if the pattern is unknown."""
    if pattern in P_SENSITIVE_PATH_INFO:
        return P_SENSITIVE_PATH_INFO[pattern]
    if pattern in P_BASH_CATASTROPHIC_INFO:
        return P_BASH_CATASTROPHIC_INFO[pattern]
    return None
