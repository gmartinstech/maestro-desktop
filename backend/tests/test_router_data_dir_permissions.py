"""9Router's state dir holds live provider credentials in db.json, so it must be owner-only: created
that way from the start, tightened when an earlier run left it loose, and hardened via ACLs on
Windows where POSIX mode bits do not apply."""

import os
import stat
import subprocess
from unittest.mock import patch

import pytest

import backend.apps.nine_router.process as proc
from types import SimpleNamespace

p_posix_only = pytest.mark.skipif(os.name == "nt", reason="POSIX mode bits do not apply on Windows")


@p_posix_only
def test_fresh_data_dir_is_created_owner_only(tmp_path):
    target = str(tmp_path / "9router")
    with patch.object(proc, "p_nine_router_data_dir", return_value=target):
        proc.secure_data_dir()
    assert stat.S_IMODE(os.stat(target).st_mode) == 0o700


@p_posix_only
def test_existing_loose_data_dir_is_tightened(tmp_path):
    target = tmp_path / "9router"
    target.mkdir(mode=0o755)
    os.chmod(target, 0o755)
    (target / "db.json").write_text('{"providerConnections": []}', encoding="utf-8")
    os.chmod(target / "db.json", 0o644)
    auth = target / "auth"
    auth.mkdir()
    (auth / "cli-secret").write_text("deadbeef", encoding="utf-8")
    os.chmod(auth / "cli-secret", 0o644)
    with patch.object(proc, "p_nine_router_data_dir", return_value=str(target)):
        proc.secure_data_dir()
    assert stat.S_IMODE(os.stat(target).st_mode) == 0o700
    assert stat.S_IMODE(os.stat(target / "db.json").st_mode) == 0o600
    assert stat.S_IMODE(os.stat(auth / "cli-secret").st_mode) == 0o600


@p_posix_only
def test_credential_file_is_never_world_readable_mid_creation(tmp_path):
    """The dir must be born 0700 via mkdir(2) rather than chmod'ed afterwards: a create-then-tighten
    sequence leaves a window in which another local user can still traverse in and read db.json."""
    target = str(tmp_path / "9router")
    modes: list = []
    real_makedirs = os.makedirs

    def spy(path, mode=0o777, exist_ok=False):
        modes.append(mode)
        return real_makedirs(path, mode=mode, exist_ok=exist_ok)

    with patch.object(proc, "p_nine_router_data_dir", return_value=target), \
         patch.object(proc.os, "makedirs", spy):
        proc.secure_data_dir()
    assert modes == [0o700], f"the dir must be created with mode 0700, got {modes}"


def test_posix_branch_tightens_dir_and_every_credential_file(tmp_path):
    """Runs on any host (the mode-bit assertions above can only run on POSIX): forces the POSIX branch
    and records the requested modes, so a Windows dev still sees the 0700/0600 intent regress."""
    target = tmp_path / "9router"
    target.mkdir()
    (target / "db.json").write_text('{"providerConnections": []}', encoding="utf-8")
    (target / "auth").mkdir()
    (target / "auth" / "cli-secret").write_text("deadbeef", encoding="utf-8")
    chmods: list = []
    with patch.object(proc.os, "name", "posix"), \
         patch.object(proc.os, "chmod", lambda p, m: chmods.append((os.path.basename(p), m))), \
         patch.object(proc, "p_nine_router_data_dir", return_value=str(target)):
        proc.secure_data_dir()
    assert ("9router", 0o700) in chmods
    assert ("db.json", 0o600) in chmods, "db.json holds live provider tokens"
    assert ("cli-secret", 0o600) in chmods


def test_hardening_never_raises_on_a_hostile_path(tmp_path):
    """A file where the dir should be: hardening must degrade to a warning, never block the router."""
    blocker = tmp_path / "9router"
    blocker.write_text("not a dir", encoding="utf-8")
    with patch.object(proc, "p_nine_router_data_dir", return_value=str(blocker)):
        assert proc.secure_data_dir() == str(blocker)


def test_windows_acl_command_drops_inherited_access():
    """On Windows os.chmod cannot restrict access, so the only real mechanism is an ACL edit; assert
    the argv removes inheritance and re-grants only the user plus the SYSTEM/Administrators SIDs."""
    argv = proc.windows_acl_command(r"C:\\Users\\x\\AppData\\Roaming\\9router")
    assert argv[0] == "icacls"
    assert "/inheritance:r" in argv
    assert any(a.startswith("*S-1-5-18:") for a in argv), "SYSTEM must be granted by SID, not name"
    assert any(a.startswith("*S-1-5-32-544:") for a in argv), "Administrators by SID, not name"
    assert "/T" in argv, "existing children (db.json) must be covered too"


def test_windows_path_skips_chmod_and_runs_icacls(tmp_path):
    """os.chmod on Windows only flips the read-only bit, which would break 9Router's own writes, so
    the POSIX branch must not run there; the ACL command must, exactly once per process."""
    target = tmp_path / "9router"
    target.mkdir()
    (target / "db.json").write_text("{}", encoding="utf-8")
    calls: list = []

    def fake_run(argv, **kwargs):
        calls.append(argv)
        return subprocess.CompletedProcess(argv, 0, b"", b"")

    with patch.object(proc.os, "name", "nt"), \
         patch.object(proc, "p_windows_acl_hardened", False), \
         patch.object(proc.os, "chmod", side_effect=AssertionError("chmod must not run on Windows")), \
         patch.object(proc.subprocess, "run", fake_run), \
         patch.object(proc, "p_nine_router_data_dir", return_value=str(target)):
        proc.secure_data_dir()
        proc.secure_data_dir()
    # Count the hardening edit specifically, not raw subprocess calls: the edit is now followed by a
    # verification probe (and a rollback if the DACL came back empty), which are legitimate extras.
    hardens = [c for c in calls if "/inheritance:r" in c]
    assert len(hardens) == 1, f"ACL hardening must run once per process; calls={calls}"
    # whoami is the SID lookup behind the user grant (a bare name does not resolve on a domain host).
    assert all(c[0] in ("icacls", "whoami") for c in calls)


def test_a_partial_icacls_apply_is_rolled_back_not_left_bricked(tmp_path, monkeypatch):
    """icacls can strip inheritance and then fail its grants, leaving a DACL nobody can open — worse
    than the loose permissions we came to fix. The hardening must detect that and restore inheritance."""
    target = str(tmp_path / "9router")
    os.makedirs(target, exist_ok=True)
    calls: list[list[str]] = []

    def p_fake_run(argv, **kwargs):
        calls.append(list(argv))
        # First call is the hardening; the probe then reports an empty DACL (path line only).
        out = "" if "/inheritance:r" in argv else (f"{target} \n" if argv[:1] == ["icacls"] and len(argv) == 2 else "")
        return SimpleNamespace(returncode=0, stdout=out, stderr="")

    monkeypatch.setattr(proc, "p_windows_acl_hardened", False, raising=False)
    monkeypatch.setattr(proc.subprocess, "run", p_fake_run)
    proc.p_harden_windows_acl(target)
    assert any("/inheritance:e" in c for c in calls), f"no rollback attempted; calls={calls}"


def test_the_user_is_granted_by_a_principal_that_resolves(monkeypatch):
    """A bare username does not resolve on a domain-joined host, so icacls skips that grant while
    /inheritance:r has already applied — the empty-DACL path. Prefer the SID, then DOMAIN\\user."""
    monkeypatch.setattr(
        proc.subprocess, "run",
        lambda *a, **k: SimpleNamespace(returncode=0, stdout='"WILEY\\gmartinssi","S-1-5-21-99-1001"\n', stderr=""),
    )
    assert proc.p_current_user_principal() == "*S-1-5-21-99-1001"

    def p_no_whoami(*a, **k):
        raise OSError("whoami missing")

    monkeypatch.setattr(proc.subprocess, "run", p_no_whoami)
    monkeypatch.setenv("USERDOMAIN", "WILEY")
    monkeypatch.setenv("USERNAME", "gmartinssi")
    assert proc.p_current_user_principal() == "WILEY\\gmartinssi", "must qualify with the domain, not pass a bare name"


def test_a_bricked_credential_file_under_a_healthy_dir_is_rolled_back(tmp_path, monkeypatch):
    """The real-world shape: /T applies per entry, so a db.json held open by the router is left with an
    empty DACL while the dir above it hardens fine and icacls still exits 0. Verifying only the dir
    misses it, and the router then fails every provider-node create with a 500."""
    target = str(tmp_path / "9router")
    os.makedirs(target, exist_ok=True)
    p_db = os.path.join(target, "db.json")
    with open(p_db, "w", encoding="utf-8") as fh:
        fh.write("{}")
    calls: list[list[str]] = []

    def p_fake_run(argv, **kwargs):
        calls.append(list(argv))
        if "/inheritance:r" in argv or "/inheritance:e" in argv:
            return SimpleNamespace(returncode=0, stdout="", stderr="")
        # Probe: the dir reports a real ACE, db.json reports the path line only (empty DACL).
        probed = argv[1] if len(argv) > 1 else ""
        out = f"{probed} \n" if probed == p_db else f"{probed} WILEY\\gmartinssi:(OI)(CI)(F)\n"
        return SimpleNamespace(returncode=0, stdout=out, stderr="")

    monkeypatch.setattr(proc, "p_windows_acl_hardened", False, raising=False)
    monkeypatch.setattr(proc.subprocess, "run", p_fake_run)
    proc.p_harden_windows_acl(target)
    assert any(p_db in c for c in calls), f"db.json was never verified; calls={calls}"
    assert any("/inheritance:e" in c for c in calls), f"no rollback for the bricked file; calls={calls}"
