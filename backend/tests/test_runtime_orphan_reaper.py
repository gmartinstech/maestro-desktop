"""The boot-time orphan reaper: what it kills, and (mostly) what it refuses to kill.

Without runtime_ledger these all fail, because nothing records who spawned an app runtime and
`stop_all` only runs on a clean shutdown, so a crashed session's vite lives forever.
"""

import os
import subprocess
import sys
import time

import pytest

from backend.apps.outputs import runtime_ledger
from backend.apps.outputs.runtime_ledger import (
    RuntimeLedger,
    RuntimeRecord,
    select_orphans,
)


@pytest.fixture(autouse=True)
def p_isolated_ledger(tmp_path, monkeypatch):
    """Point the ledger + owner markers at a throwaway dir so tests never touch a real install."""
    monkeypatch.setattr(runtime_ledger, "LEDGER_PATH", str(tmp_path / "app_runtimes.json"))
    monkeypatch.setattr(runtime_ledger, "OWNERS_DIR", str(tmp_path / "owners"))
    yield


def p_record(**kw) -> RuntimeRecord:
    base = dict(
        pid=424242,
        workspace_id="ws1",
        instance=1,
        image="node.exe" if os.name == "nt" else "bash",
        frontend_port=45001,
        owner_pid=999001,
        owner_boot_id="dead-boot",
    )
    base.update(kw)
    return RuntimeRecord(**base)


def test_dead_owner_live_pid_matching_image_is_an_orphan():
    ledger = RuntimeLedger(records=[p_record()])
    orphans = select_orphans(
        ledger,
        owner_alive=lambda pid, boot: False,
        pid_alive=lambda pid: True,
        image_of=lambda pid: "node.exe" if os.name == "nt" else "bash",
    )
    assert [r.pid for r in orphans] == [424242]


def test_a_second_live_instances_runtime_is_spared():
    """The case that must never regress: two copies of the app running, one boots and reaps."""
    mine = p_record(pid=1, owner_pid=os.getpid(), owner_boot_id=runtime_ledger.BOOT_ID)
    other_live = p_record(pid=2, owner_pid=777001, owner_boot_id="live-boot")
    stale = p_record(pid=3, owner_pid=999001, owner_boot_id="dead-boot")
    ledger = RuntimeLedger(records=[mine, other_live, stale])
    orphans = select_orphans(
        ledger,
        # Only the "dead-boot" owner is gone; ours and the other instance's are alive.
        owner_alive=lambda pid, boot: boot != "dead-boot",
        pid_alive=lambda pid: True,
        image_of=lambda pid: stale.image,
    )
    assert [r.pid for r in orphans] == [3]


def test_pid_reuse_is_not_killed_when_the_image_changed():
    ledger = RuntimeLedger(records=[p_record()])
    orphans = select_orphans(
        ledger,
        owner_alive=lambda pid, boot: False,
        pid_alive=lambda pid: True,
        image_of=lambda pid: "someone-elses-app.exe",
    )
    assert orphans == []


def test_unknown_image_fails_closed():
    """An unreadable image (no tasklist/ps, or a probe timeout) must leave the process alive."""
    ledger = RuntimeLedger(records=[p_record()])
    assert select_orphans(
        ledger,
        owner_alive=lambda pid, boot: False,
        pid_alive=lambda pid: True,
        image_of=lambda pid: "",
    ) == []
    assert select_orphans(
        RuntimeLedger(records=[p_record(image="")]),
        owner_alive=lambda pid, boot: False,
        pid_alive=lambda pid: True,
        image_of=lambda pid: "bash",
    ) == []


def test_dead_pid_is_not_reaped_but_is_dropped_from_the_ledger():
    runtime_ledger.save_ledger(RuntimeLedger(records=[p_record(pid=424243)]))
    killed: list = []
    reaped = runtime_ledger.reap_orphans(kill=killed.append)
    assert killed == [] and reaped == []
    # The record's owner is dead, so it is finished business either way; the ledger must not keep growing.
    assert runtime_ledger.load_ledger().records == []


def test_our_own_records_survive_a_reap():
    mine = p_record(pid=os.getpid() + 100000, owner_pid=os.getpid(), owner_boot_id=runtime_ledger.BOOT_ID)
    runtime_ledger.register_owner()
    runtime_ledger.save_ledger(RuntimeLedger(records=[mine]))
    killed: list = []
    runtime_ledger.reap_orphans(kill=killed.append)
    assert killed == []
    assert [r.pid for r in runtime_ledger.load_ledger().records] == [mine.pid]


def test_owner_alive_needs_both_a_live_pid_and_a_matching_boot_id():
    runtime_ledger.register_owner()
    assert runtime_ledger.is_owner_alive(os.getpid(), runtime_ledger.BOOT_ID) is True
    # Same live pid, different boot: a recycled pid must not vouch for a previous boot's records.
    assert runtime_ledger.is_owner_alive(os.getpid(), "some-other-boot") is False
    # No marker at all.
    assert runtime_ledger.is_owner_alive(999002, "dead-boot") is False


def test_reaper_kills_a_real_orphan_process_end_to_end():
    """A real child, recorded under a dead owner, is actually terminated by the reaper."""
    proc = subprocess.Popen(
        [sys.executable, "-c", "import time\nwhile True: time.sleep(1)"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    try:
        runtime_ledger.save_ledger(RuntimeLedger(records=[p_record(
            pid=proc.pid,
            image=runtime_ledger.process_image(proc.pid),
        )]))
        assert runtime_ledger.load_ledger().records[0].image, "image probe returned nothing on this host"
        reaped = runtime_ledger.reap_orphans()
        assert [r.pid for r in reaped] == [proc.pid]
        deadline = time.time() + 10
        while time.time() < deadline and proc.poll() is None:
            time.sleep(0.1)
        assert proc.poll() is not None, "orphan survived the reap"
        assert runtime_ledger.load_ledger().records == []
    finally:
        if proc.poll() is None:
            proc.kill()
            proc.wait()


def test_reclaim_port_only_fires_for_a_ledger_known_orphan():
    runtime_ledger.save_ledger(RuntimeLedger(records=[p_record(frontend_port=45001)]))
    # Nothing recorded on 45999, so the port-collision path must fall through to reallocation.
    assert runtime_ledger.reclaim_port(45999) is False
