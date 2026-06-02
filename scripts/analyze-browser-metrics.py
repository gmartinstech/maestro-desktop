#!/usr/bin/env python3
"""
Analyze recorded browser-agent metrics and flag GHOST SUCCESS: tasks that
report "completed" but show no evidence of real work (errors-only, looped, or
zero productive mutation). A task ending without an exception is NOT proof the
goal was achieved, this is the independent reality check.

Usage:
  python3 scripts/analyze-browser-metrics.py [metrics_dir]
Defaults to $OPENSWARM_BROWSER_METRICS_DIR, else
~/Library/Application Support/OpenSwarm/data/browser_metrics (mac) or backend/data/.
"""

import json
import os
import sys
from collections import Counter, defaultdict

# Tools that actually change page state (vs. read/meta). A "completed" task that
# never ran one of these did nothing but look around, suspicious.
_PRODUCTIVE = {
    "BrowserClick", "BrowserClickIndex", "BrowserType", "BrowserNavigate",
    "BrowserPressKey", "BrowserBatch", "BrowserReplayRoute",
}


def _default_dir():
    env = os.environ.get("OPENSWARM_BROWSER_METRICS_DIR")
    if env:
        return env
    mac = os.path.expanduser("~/Library/Application Support/OpenSwarm/data/browser_metrics")
    if os.path.isdir(mac):
        return mac
    return os.path.join(os.path.dirname(__file__), "..", "backend", "data", "browser_metrics")


def _load(path):
    if not os.path.exists(path):
        return []
    out = []
    with open(path) as f:
        for line in f:
            line = line.strip()
            if line:
                try:
                    out.append(json.loads(line))
                except Exception:
                    pass
    return out


def ghost_verdict(task, events_for_task):
    """Return (is_ghost, [reasons]). Conservative: only flags 'completed' tasks
    that show no evidence the work happened."""
    if task.get("status") != "completed":
        return False, []
    reasons = []
    tools = [e["tool"] for e in events_for_task]
    productive = [t for t in tools if t in _PRODUCTIVE]
    errs = sum(1 for e in events_for_task if not e.get("ok"))
    total = len(events_for_task)
    # A read/extract task legitimately has no state-changing action; its evidence
    # is that a READ tool actually returned content. So "no productive action" is
    # only a ghost when NO read returned data either (i.e. nothing real happened).
    _READ = {"BrowserGetText", "BrowserGetElements", "BrowserListInteractives",
             "BrowserListRoutes", "BrowserReplayRoute", "BrowserScreenshot", "BrowserEvaluate"}
    read_with_content = any(
        e["tool"] in _READ and e.get("ok") and (e.get("result_len", 0) or 0) > 0
        for e in events_for_task
    )
    if total == 0:
        reasons.append("completed with ZERO tool calls (model declared done without acting)")
    if total and not productive and not read_with_content:
        reasons.append("no state-changing action AND no read returned content, yet marked completed")
    if total and errs / total >= 0.5:
        reasons.append(f"{errs}/{total} tool calls errored but still marked completed")
    if any(e.get("is_loop") for e in events_for_task):
        reasons.append("loop detector fired during a 'completed' task")
    prod_ok = [e for e in events_for_task if e["tool"] in _PRODUCTIVE and e.get("ok")]
    if productive and not prod_ok:
        reasons.append("every state-changing action errored, yet marked completed")
    return (len(reasons) > 0), reasons


def main():
    d = sys.argv[1] if len(sys.argv) > 1 else _default_dir()
    events = _load(os.path.join(d, "events.jsonl"))
    tasks = _load(os.path.join(d, "tasks.jsonl"))
    print(f"metrics dir: {d}")
    print(f"events: {len(events)}  tasks: {len(tasks)}\n")
    if not tasks and not events:
        print("No metrics recorded yet. Run some browser-agent tasks first.")
        return

    ev_by_session = defaultdict(list)
    for e in events:
        ev_by_session[e.get("session_id")].append(e)

    # Per-tier rollup across all events
    tier_calls, tier_ms, tier_err = Counter(), Counter(), Counter()
    for e in events:
        t = e.get("tier", "other")
        tier_calls[t] += 1
        tier_ms[t] += int(e.get("elapsed_ms", 0) or 0)
        if not e.get("ok"):
            tier_err[t] += 1

    print("=== PER-TIER (across all tool calls) ===")
    print(f"{'tier':<20}{'calls':>6}{'avg_ms':>9}{'err%':>7}")
    for t in sorted(tier_calls, key=lambda x: -tier_calls[x]):
        c = tier_calls[t]
        avg = round(tier_ms[t] / c, 1) if c else 0
        errp = round(100 * tier_err[t] / c, 1) if c else 0
        print(f"{t:<20}{c:>6}{avg:>9}{errp:>6}%")

    print("\n=== PER-TASK (completion, time, cost, ghost check) ===")
    completed = ghosts = 0
    all_errs = Counter()
    for tk in tasks:
        evs = ev_by_session.get(tk.get("session_id"), [])
        is_ghost, reasons = ghost_verdict(tk, evs)
        if tk.get("status") == "completed":
            completed += 1
        if is_ghost:
            ghosts += 1
        for err, n in tk.get("recurring_errors", []):
            all_errs[err] += n
        flag = "  ⚠️ GHOST" if is_ghost else ""
        print(f"- [{tk.get('status')}] {tk.get('total_ms')}ms turns={tk.get('turns')} "
              f"tools={tk.get('tool_calls')} tok_in={tk.get('tokens_in')} "
              f"tok_out={tk.get('tokens_out')} :: {str(tk.get('task'))[:60]}{flag}")
        for r in reasons:
            print(f"      ghost-reason: {r}")

    print("\n=== RECURRING ERRORS (top 10 across tasks) ===")
    for err, n in all_errs.most_common(10):
        print(f"  x{n}  {err}")

    print("\n=== SUMMARY ===")
    n = len(tasks)
    print(f"tasks: {n}  completed: {completed}  ghost-completed: {ghosts}")
    if n:
        avg_ms = round(sum(t.get("total_ms", 0) for t in tasks) / n)
        avg_tok = round(sum(t.get("tokens_in", 0) + t.get("tokens_out", 0) for t in tasks) / n)
        print(f"avg task time: {avg_ms}ms   avg tokens/task: {avg_tok}")
        print(f"honest completion rate: {round(100*(completed-ghosts)/n,1)}% "
              f"(completed minus ghosts)")


if __name__ == "__main__":
    main()
