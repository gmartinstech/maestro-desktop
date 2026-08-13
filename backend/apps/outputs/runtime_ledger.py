"""Cross-boot ownership ledger for app runtimes, plus the boot-time orphan reaper.

`stop_all` only runs on a clean shutdown, so a crash / SIGKILL / force-quit leaves the
per-workspace `bash run.sh` (and its vite/uvicorn descendants) alive forever, holding the
workspace's port. This module records who spawned what, and on the next boot kills the records
whose owning backend is provably gone.

Ownership rule (enforced in p_is_orphan): a recorded runtime is reaped ONLY when three
independent facts agree — the owning backend is dead, the recorded pid is still alive, and that
pid still runs the image name we recorded at spawn time. A second, legitimately running instance
keeps its own owner-liveness file, so its records fail the first test and are spared. Any probe
we cannot answer (no tasklist/ps, unreadable ledger, blank image) resolves to "not an orphan": a
stray process left alive is a bounded annoyance, killing someone else's is not."""

import logging
import os
import subprocess
from datetime import datetime
from typing import Callable, List, Optional
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field
from typeguard import typechecked

from backend.config.json_store import atomic_write_json, read_json_or_none
from backend.config.paths import DATA_ROOT

logger = logging.getLogger(__name__)

LEDGER_PATH = os.path.join(DATA_ROOT, "app_runtimes.json")
OWNERS_DIR = os.path.join(DATA_ROOT, "app_runtime_owners")

# Regenerated per backend process; pairs with our pid in the owner file so a recycled pid can never impersonate a previous boot.
BOOT_ID = uuid4().hex


class RuntimeRecord(BaseModel):
    """One spawned app-runtime process, tagged with the backend that owns it."""
    model_config = ConfigDict(validate_assignment=True)
    pid: int
    workspace_id: str
    instance: int = 1
    image: str = ""
    frontend_port: Optional[int] = None
    owner_pid: int
    owner_boot_id: str
    started_at: str = Field(default_factory=lambda: datetime.now().isoformat())


class RuntimeLedger(BaseModel):
    """The whole on-disk ledger; a list wrapper so the file has room to grow a schema."""
    model_config = ConfigDict(validate_assignment=True)
    records: List[RuntimeRecord] = Field(default_factory=list)


@typechecked
def p_pid_alive(pid: int) -> bool:
    """True when a process with this pid currently exists."""
    if pid <= 0:
        return False
    if os.name == "nt":
        return bool(process_image(pid))  # os.kill has no probe mode there
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        # Exists but belongs to another user; alive for our purposes (and we would fail to kill it anyway).
        return True
    except OSError:
        return False


@typechecked
def p_windows_tool(name: str) -> str:
    """Absolute System32 path for a Windows built-in, falling back to the bare name. Some dev shells
    (Git-for-Windows prepending its own bin) drop System32 from PATH entirely, which would make every
    image probe return "" — leaving the reaper a permanent silent no-op rather than a safe one."""
    root = os.environ.get("SystemRoot") or r"C:\Windows"
    candidate = os.path.join(root, "System32", f"{name}.exe")
    return candidate if os.path.exists(candidate) else name


@typechecked
def process_image(pid: int) -> str:
    """Lowercased executable/comm name for `pid`, or "" when it cannot be determined. The empty
    return is load-bearing: p_is_orphan refuses to kill anything whose image it cannot read, so a
    host without tasklist/ps degrades to "never reap" rather than "reap blind"."""
    if pid <= 0:
        return ""
    try:
        if os.name == "nt":
            out = subprocess.run(
                [p_windows_tool("tasklist"), "/FI", f"PID eq {pid}", "/NH", "/FO", "CSV"],
                capture_output=True, text=True, timeout=5,
            )
            line = (out.stdout or "").strip().splitlines()
            if not line or not line[0].startswith('"'):
                return ""
            # CSV row is "image.exe","pid","session",...; a missing pid prints an INFO line instead, which the quote check above rejects.
            return line[0].split('","')[0].strip('"').strip().lower()
        out = subprocess.run(
            ["ps", "-p", str(pid), "-o", "comm="],
            capture_output=True, text=True, timeout=5,
        )
        return os.path.basename((out.stdout or "").strip()).lower()
    except Exception:
        return ""


@typechecked
def p_owner_file(pid: int) -> str:
    """One marker file per live backend pid; its contents pin the boot that wrote it."""
    return os.path.join(OWNERS_DIR, f"{pid}.json")


@typechecked
def register_owner() -> None:
    """Publish our liveness marker. Called at boot BEFORE the reap, so a concurrently-booting second instance can already see us."""
    try:
        atomic_write_json(p_owner_file(os.getpid()), {
            "boot_id": BOOT_ID,
            "started_at": datetime.now().isoformat(),
        })
    except Exception:
        logger.exception("runtime ledger: could not publish owner marker")


@typechecked
def unregister_owner() -> None:
    """Drop our liveness marker on a clean shutdown; a crash leaves it, which is why the reaper also checks the pid."""
    try:
        os.remove(p_owner_file(os.getpid()))
    except OSError:
        pass


@typechecked
def is_owner_alive(pid: int, boot_id: str) -> bool:
    """True when the backend that spawned a record still looks alive. Both halves must hold: a
    live pid AND an owner marker whose boot_id matches the record. Pid alone is not enough (pids
    get recycled); the marker alone is not enough (a crash never deletes it)."""
    if pid == os.getpid() and boot_id == BOOT_ID:
        return True
    data = read_json_or_none(p_owner_file(pid))
    if data is None or data.get("boot_id") != boot_id:
        return False
    return p_pid_alive(pid)


@typechecked
def load_ledger() -> RuntimeLedger:
    data = read_json_or_none(LEDGER_PATH)
    if data is None:
        return RuntimeLedger()
    try:
        return RuntimeLedger(**data)
    except Exception:
        logger.warning("runtime ledger: unreadable, starting empty")
        return RuntimeLedger()


@typechecked
def save_ledger(ledger: RuntimeLedger) -> None:
    try:
        atomic_write_json(LEDGER_PATH, ledger.model_dump(mode="json"))
    except Exception:
        logger.exception("runtime ledger: write failed")


@typechecked
def record_spawn(pid: int, workspace_id: str, instance: int, frontend_port: Optional[int]) -> None:
    """Claim a spawned runtime under our ownership. Best-effort: failing here only costs us the ability to reap this one process next boot."""
    try:
        ledger = load_ledger()
        ledger.records = [r for r in ledger.records if r.pid != pid]
        ledger.records.append(RuntimeRecord(
            pid=pid,
            workspace_id=workspace_id,
            instance=instance,
            image=process_image(pid),
            frontend_port=frontend_port,
            owner_pid=os.getpid(),
            owner_boot_id=BOOT_ID,
        ))
        save_ledger(ledger)
    except Exception:
        logger.exception("runtime ledger: could not record pid %d", pid)


@typechecked
def forget(pid: int) -> None:
    """Drop a record once we have stopped the process ourselves, so the next boot has nothing to chase."""
    try:
        ledger = load_ledger()
        remaining = [r for r in ledger.records if r.pid != pid]
        if len(remaining) != len(ledger.records):
            ledger.records = remaining
            save_ledger(ledger)
    except Exception:
        logger.exception("runtime ledger: could not forget pid %d", pid)


@typechecked
def p_is_orphan(
    record: RuntimeRecord,
    owner_alive: Callable[[int, str], bool],
    pid_alive: Callable[[int], bool],
    image_of: Callable[[int], str],
) -> bool:
    """The whole ownership decision, probes injected so it is testable without real processes.
    Every unknown resolves to False; a record with no recorded image is never reaped, because
    without it we cannot tell our dead vite from whatever now holds that pid."""
    if record.pid <= 0 or record.pid == os.getpid():
        return False
    if not record.image:
        return False
    if owner_alive(record.owner_pid, record.owner_boot_id):
        return False
    if not pid_alive(record.pid):
        return False
    return image_of(record.pid) == record.image


@typechecked
def select_orphans(
    ledger: RuntimeLedger,
    owner_alive: Optional[Callable[[int, str], bool]] = None,
    pid_alive: Optional[Callable[[int], bool]] = None,
    image_of: Optional[Callable[[int], str]] = None,
) -> List[RuntimeRecord]:
    """Records this boot may kill. Probes default to the real ones; tests inject fakes."""
    owner_probe = owner_alive or is_owner_alive
    alive_probe = pid_alive or p_pid_alive
    image_probe = image_of or process_image
    return [r for r in ledger.records if p_is_orphan(r, owner_probe, alive_probe, image_probe)]


@typechecked
def p_prune_dead_owner_markers() -> None:
    """Delete owner markers whose pid is gone, so the dir does not accumulate one file per crash."""
    try:
        for name in os.listdir(OWNERS_DIR):
            if not name.endswith(".json"):
                continue
            try:
                pid = int(name[: -len(".json")])
            except ValueError:
                continue
            if pid == os.getpid() or p_pid_alive(pid):
                continue
            try:
                os.remove(os.path.join(OWNERS_DIR, name))
            except OSError:
                pass
    except FileNotFoundError:
        pass


@typechecked
def reap_orphans(kill: Optional[Callable[[int], None]] = None) -> List[RuntimeRecord]:
    """Kill every ledger record no live backend owns, and return what was killed. Boot is where
    this runs unconditionally: nothing we spawned is running yet, so "the owner is dead" cannot
    mean us. Reaped and dead-owner records are dropped; records a live owner (another instance,
    or ourselves) is still responsible for are left exactly as they are."""
    from backend.apps.outputs.runtime_proc import kill_descendant_tree

    def p_default_kill(pid: int) -> None:
        kill_descendant_tree(pid, "KILL")
        if os.name != "nt":
            try:
                os.kill(pid, 9)
            except OSError:
                pass

    killer = kill or p_default_kill
    ledger = load_ledger()
    if not ledger.records:
        return []
    orphans = select_orphans(ledger)
    orphan_pids = {r.pid for r in orphans}
    for record in orphans:
        try:
            killer(record.pid)
            logger.info(
                "reaped orphaned app runtime pid=%d workspace=%s port=%s (owner pid %d from a previous boot is gone)",
                record.pid, record.workspace_id, record.frontend_port, record.owner_pid,
            )
        except Exception:
            logger.exception("failed to reap orphaned app runtime pid %d", record.pid)
    # Keep only records a live owner is still responsible for; ours and the dead owners' are both finished business.
    ledger.records = [
        r for r in ledger.records
        if r.pid not in orphan_pids and is_owner_alive(r.owner_pid, r.owner_boot_id)
    ]
    save_ledger(ledger)
    p_prune_dead_owner_markers()
    return orphans


@typechecked
def reclaim_port(port: int) -> bool:
    """Kill the dead session squatting on `port`, if the ledger says one of ours is. True when
    something was killed, so the caller can re-probe instead of routing around the squatter."""
    if not any(r.frontend_port == port for r in select_orphans(load_ledger())):
        return False
    return bool(reap_orphans())
