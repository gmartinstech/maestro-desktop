# TLM — Maestro Studio's own first-party telemetry

**Name: `maestro-telemetry`.** Hyphenated in prose, docs, the endpoint and any service
identity; the Python package is `backend/apps/maestro_telemetry/` because a module name cannot
contain a hyphen. Do not introduce a third spelling.

**Goal:** an **anonymous SRE** signal — service reliability, not product analytics. A small stream that tells us when the app crashes,
wedges, or fails an agent turn — and nothing else. Not product analytics.

**Status:** queued. **Runs AFTER `osr/remove-openswarm-refs` merges.** See "Ordering" below for
the collision with `docs/plans/2026-08-11-i18n-extraction.md`.

---

## Baseline the implementer must reproduce before touching anything

Record these in the branch's first commit message. If your numbers differ, stop and reconcile —
you are on a different tree than this plan was written against.

```bash
# Backend suite, MAESTRO_MOCK_AGENT UNSET (see root CLAUDE.md — the mock starves WS assertions)
cd backend && .venv/Scripts/python.exe -m pytest -q -p no:randomly
# expect: 6 failed, 1726 passed, 5 skipped
```

The 6 failures are pre-existing and unrelated to telemetry. Do not try to fix them:
`test_app_export_no_stale_files`, `test_browser_metrics`, `test_bundled_extracted_modules`,
`test_disk_resilience`, `test_skills_folders`, `test_system_prompt`.

```bash
cd frontend && npx tsc --noEmit     # clean
cd frontend && npm run lint         # 0 errors, 123 warnings
node scripts/check-callhome.mjs     # "call-home check: clean"
node scripts/check-fork-drift.mjs   # "fork drift: clean"
```

> **Known doc drift:** root `CLAUDE.md:17` still says "1703 passing". The measured baseline is
> 1726. Fix that line as part of Phase 0 rather than leaving two numbers in the tree.

**This plan deletes tests.** Phase 5 removes `backend/tests/test_service.py` (~30 cases) and
`backend/tests/test_service_legacy.py`, and adds ~8 new test files. The pass count *will* move.
Every phase below states the expected direction, and Phase 6 pins the final number. Record the
delta explicitly at each phase boundary:

```bash
cd backend && .venv/Scripts/python.exe -m pytest -q -p no:randomly 2>&1 | tail -3
```

---

## Decision 1 — reuse the transport, rebuild the surface, delete the analytics orientation

This is the decision the plan exists to resolve, and it is not a compromise for its own sake: the
two halves of `backend/apps/service/` have opposite quality. The plumbing is good. The contract on
top of it is actively dangerous.

### Reuse, unchanged or nearly so

| File | Why it survives |
|---|---|
| `backend/apps/service/buffer.py` | 139 lines, bounded SQLite spool, drops-oldest on cap, discards corrupt rows so they can't block the queue, endpoint-agnostic, no `openswarm` coupling, already tested. Rewriting this would be pure ego. Phase 2 changes two constants and adds one column. |
| `backend/apps/service/version.py` | `APP_VERSION` resolution with the packaged-build gotcha already solved (`MAESTRO_APP_VERSION` env first, because the `electron/package.json` path fallback fails in packaged dmg/exe and made every shipped install report `app_version="unknown"`). Do not re-derive this. |
| `backend/apps/service/ring_buffer.py` | 33-line fixed-size rolling label log. Becomes the crumb trail for the wedge sensor. Note it currently stores only a label + timestamp, which is exactly the privacy posture we want — keep it that way. |
| `client.py::resolve_timezone` / `resolve_locale` | Settings-first → OS → default, with the reasons documented (Python's `locale.getlocale()` is deprecated and inconsistent across platforms; `tzlocal` sometimes returns `PDT` or `Romance (zomertijd)` which don't round-trip through tzdata). Move verbatim into `telemetry/envelope.py`. |
| ~~`client.py::p_get_install_id`~~ | **Do NOT salvage.** It mints and persists a stable UUID — the exact thing Decision 0 forbids. `envelope.py` mints an in-memory `run_id` instead. |
| `client.py::p_delivered` / `p_retryable` | Correct retry classification: `None`/5xx/408/429 retryable, other 4xx means the payload itself is rejected and retrying forever poisons the spool. Keep the logic and the comment. |
| `service.py` `/usage-summary` + `/cost-breakdown` | **Not telemetry.** These are local reads that power the Settings → Usage page. They never leave the machine. Leave them exactly where they are; do not drag them into `apps/maestro_telemetry/`. |

### Rebuild — the `submit()` surface must not survive

The existing surface is built on an explicit inversion of a privacy contract. From
`client.py`'s own module docstring:

> "The desktop hands off opaque payload dicts; the configured service endpoint is responsible for
> parsing and routing them. **The desktop has no schema knowledge.**"

You cannot enumerate what you collect when the payload is opaque *by design*. Requirement 1 of
this plan is unsatisfiable on top of that sentence. But the argument does not rest on the docstring
— here is what the opaque contract already does:

1. **`backend/apps/settings/settings.py:196-200` ships the entire settings object on every save,
   filtered by a hand-maintained denylist:**
   ```python
   secret_keys = {"anthropic_api_key", "openai_api_key", ..., "analytics_token"}
   safe = {k: v for k, v in body.model_dump().items() if k not in secret_keys}
   p_sync(safe)
   ```
   `custom_providers` is **not** in that set, and `CustomProvider.api_key` is a plain field
   (`backend/apps/settings/models.py:89`). So the moment `MAESTRO_TELEMETRY_URL` is set, every
   custom provider's API key is POSTed off the machine. `default_system_prompt` — user free text —
   goes with it. A denylist over a growing settings model is a leak with a fuse in it, and the fuse
   is already lit; only my gating of `p_base_url()` earlier today is holding it.

2. **`backend/apps/service/service.py:165-181` ships `user_email`, `user_name`, `user_use_case`,
   `user_referral_source` as an `identity` blob at every boot.** That is directly-identifying
   personal data with no lawful basis and no opt-in gate.

3. **The opt-out gate's semantics are unknowable.** `client.py:151-166` reads
   `if kind == "diagnostic": return True` — diagnostics bypass the toggle. But `submit()`
   (line 349) is `sync(payload)`, discarding `kind` entirely, and `sync()` asks
   `p_is_enabled("state")`. So `submit_diagnostic` *is* gated, by accident, contradicting the
   function that was written to exempt it. Code that disagrees with itself about consent cannot be
   the basis of a stated contract.

4. **Dead machinery that lies about what it does.** `P_PATH_BY_KIND` (lines 37-42) is read by
   nothing. `p_log(kind, payload)` (line 298) takes a payload and ignores it. `submit()`'s
   docstring describes server-side demuxing that does not exist on our side of the wire.

5. **`service.py::post_submit` accepts three body shapes plus a batched array** on an
   unauthenticated localhost endpoint, and forwards whatever it gets. Any local process can inject
   into our telemetry stream.

6. **`backend/apps/service/analytics/` is a dead vendor dependency on upstream's ingest.**
   `analytics/client.py:18` does `from swarm_analytics import AnalyticsClient` at module scope
   (pinned in `backend/requirements.txt:20` as `swarm-analytics==0.1.1`) while
   `get_analytics_client()` hardcodes `return None`. We ship and install an upstream
   product-analytics SDK to call it zero times.

### The "~50 call sites" cost is mostly a cost we want to pay

The brief flags ~50 `submit()` call sites as the reuse argument. Measured, that number does not
describe backend telemetry:

```bash
git grep -nE "(submit_event|submit_state|submit_session_close|submit_diagnostic|update_identity|identify|sync)\s*\(" -- backend ':!backend/tests' ':!backend/apps/service'
# 9 production files
git grep -n "report(" -- frontend/src | wc -l
# 55 hits across 22 files
```

Backend production sites are **9 files**. The bulk of the 50 is `frontend/src/shared/serviceClient.ts`
`report()` — and of those 55, 26 are in `Onboarding/` and `Dashboard/hooks/interaction/`:
`tour_restarted`, `useArrowNav`, `useCardDrag`, `useDashboardShortcuts`, onboarding step
completions. That is a product-analytics funnel. Requirement 4 says explicitly we are not building
one. **Deleting those call sites is the goal, not the migration cost.** The genuinely valuable
sites are few and enumerated in Phase 3: `handle_run_error.py` (4), `agent_manager.py` (1),
`nine_router/process.py` (1), `ErrorBoundary.tsx` (1).

### Verdict

Move `buffer.py`, `version.py`, `ring_buffer.py` and the four salvaged helpers into a new
`backend/apps/maestro_telemetry/` package behind a **closed, typed, allowlist-only** event model. Delete
`backend/apps/service/client.py`, `backend/apps/service/analytics/`, `backend/apps/service/models.py`,
the pulse loop, and the `/service/submit` + `/service/event` endpoints. `backend/apps/service/service.py`
survives as the Usage endpoints only.

**Why a new package rather than editing `client.py` in place:** the file's public names
(`submit`, `record`, `identify`, `sync`) are the exact API we are repudiating. Leaving them
importable means the next agent adds a call site and the whole enumeration collapses silently.
A rename forces every site through review, and `check-fork-drift.mjs` can then hard-fail on the
old paths coming back (Phase 5).

## Decision 2 — do not reuse `analytics_opt_in` as the consent flag

`backend/apps/settings/models.py:66` is `analytics_opt_in: bool = True`. It is **opt-out**, and it
is already `True` on every existing install's `settings.json` on disk.

Reusing it would mean shipping a build that treats a flag the user never saw, defaulted to on by
upstream, as informed consent under LGPD art. 8º. That is not a technicality; it is the single
worst thing this plan could do.

Add a new tri-state field instead, so "never asked" is distinguishable from "said no":

```python
telemetry_consent: Optional[Literal["granted", "denied"]] = None   # None = never asked = OFF
```

`analytics_opt_in` and `service_diagnostics_mode` are **never read** by the new code. Phase 5
deletes `analytics_opt_in`, `analytics_token`, and the `service_diagnostics_mode` reads outright.

---

## Privacy contract — the enumeration, stated as a contract

This list is normative. `backend/apps/maestro_telemetry/event.py` is its executable form, and
`backend/tests/test_telemetry_allowlist.py` fails if the two diverge. If you need a field that is
not here, the field does not go in until this document is amended.

### Collected

**Envelope, on every event:**

| Field | Value | Note |
|---|---|---|
| `run_id` | UUIDv4 minted **in memory at process start**, never persisted | anonymous: correlates events inside ONE launch, cannot link two launches |
| `app_version` | e.g. `1.0.31` | |
| `os` / `os_version` | `Windows` / `10.0.26200` | `platform.system()` / `platform.release()` — never `platform.platform()`, which on some Linux builds embeds the kernel build host |
| `install_method` | `dev` \| `dmg` \| `exe` \| `appimage` \| `deb` \| `rpm` | |
| `locale` | BCP-47, e.g. `pt-BR` | kept: number/date formatting causes real crashes |
| `event_name` | one of the closed `Literal` set in Phase 3 | |
| `t` | client unix seconds | |
| `event_id` | UUIDv4 per event, idempotency key | |

**Per-event payloads:** only the fields listed per event in Phase 3. All are enums, booleans,
integers, or durations in ms. Exactly one field family is free text (`error_preview`,
`stderr_tail`) and it is typed `ScrubbedText`, which cannot be constructed without scrubbing.

### Not collected — and structurally cannot be

- **Prompts and agent output.** No `Message`, no `session.messages`, no `content`. The event model
  is `extra="forbid"`, so a caller cannot smuggle one in.
- **File contents and file paths.** Including paths inside scrubbed error text — the scrubber
  collapses path segments (see below). A Windows stderr tail routinely contains
  `C:\Users\<account>\...`; the OS account name is personal data.
- **URLs the user visited.** Browser cards, the default homepage setting, deep links — none of it.
  Scrubbed text keeps `scheme://host` at most and drops path and query.
- **API keys, tokens, bearer credentials.** Two independent walls: nothing in the allowlist is
  key-shaped, and every free-text field runs the secret scrub anyway.
- **`user_email`, `user_name`, `user_use_case`, `user_referral_source`.** Never in an envelope,
  never joined to anything. This is a deliberate reversal of `service.py:165-181`.
- **Skill, workflow, app, dashboard, or session names.** User-authored strings.
- **Cost, token counts, billing.** The pulse loop existed to reconcile a Pro tier we deleted.
- **The whole settings object.** `settings.py`'s `p_sync(safe)` call is deleted, not filtered
  harder. If a settings-derived signal is ever wanted, it is an allowlisted boolean
  (`has_custom_provider: bool`), never a dict.

### Free-text scrubbing

New module `backend/apps/maestro_telemetry/scrub.py`, exporting `scrub_free_text(text, *, limit) -> str`.
It layers on top of the existing `redact_for_telemetry`
(`backend/apps/agents/core/error_classify.py:17`), which already handles secret shapes —
`sk-ant-*`, `sk-*`, `AIza*`, `gh[pousr]_*`, `Bearer <tok>`, `key=value` — and keeps the tail,
because the real error lands at the end of a stderr stream. Keep that behaviour; its four tests in
`backend/tests/test_error_classify.py` must stay green.

The gaps `scrub_free_text` closes, in order:

1. **Home-directory paths.** `C:\Users\<x>\`, `/Users/<x>/`, `/home/<x>/` → `<home>\` / `<home>/`.
2. **Remaining path segments.** Any run of 2+ `/`- or `\`-separated segments → keep the final
   basename's extension only: `.../report.xlsx` → `<path>.xlsx`. Extensions are diagnostic;
   filenames are not.
3. **URLs.** `scheme://host/path?query` → `scheme://host/<path>`.
4. **Emails.** → `<email>`.
5. **CPF / CNPJ.** `999.999.999-99`, `99.999.999/9999-99` and their bare-digit forms → `<doc>`.
   The user base is Brazilian SMEs; these appear in agent errors about spreadsheets, and they are
   the most sensitive identifiers LGPD contemplates.
6. **BR phone numbers.** `(11) 99999-9999` and `+5511999999999` → `<phone>`.
7. **Long opaque blobs.** Base64/hex runs > 40 chars → `<blob>`.

Over-redacting is acceptable; leaking is not. Tested in
**`backend/tests/test_telemetry_scrub.py`**, one case per rule plus a composite. Build
secret-shaped inputs by concatenation, the way `test_error_classify.py` already does, so no
contiguous key-shaped literal lands in the source file.

**The enforcement, not just the function:** `scrub.py` also exports

```python
class ScrubbedText(BaseModel):
    model_config = ConfigDict(validate_assignment=True, frozen=True)
    value: str
    @classmethod
    def of(cls, raw: str, *, limit: int = 400) -> "ScrubbedText": ...   # the only constructor
```

`TelemetryEvent`'s free-text fields are typed `Optional[ScrubbedText]`. A caller passing a bare
`str` fails pydantic validation at the emit boundary. `test_telemetry_scrub.py` pins that
`ScrubbedText(value="raw")` is refused and `ScrubbedText.of("raw")` is the only way through.

### Decision 0 — anonymous, and what that costs

This is an **SRE** stream: it exists to find crashes, wedges and regressions, not to describe users.
So no stable identifier ships. `run_id` is minted in memory per launch and dies with the process.
`settings.installation_id` stays local and is never sent, never joined.

**Be honest about what that forfeits**, because it is not free:

| Lost | Consequence | Mitigation |
|---|---|---|
| Distinguishing 1 install crashing 500× from 500 installs crashing once | The single most common SRE follow-up question | Rate per **run**, not per install: `app.boot` is the denominator, so crashes-per-run is exact even without identity. A pathological single install shows up as a high `relaunch_count_1h` on one `run_id`. |
| Cross-run crash de-duplication | The same recurring crash counts repeatedly | Group by `(app_version, os, event_name, error_preview)`. Coarser, sufficient for triage. |
| "Did our fix work for the user who reported it?" | Cannot follow one install across a version bump | Compare aggregate rates between versions. For a specific user, ask them for a bug bundle — an explicit, consented, one-off share. |
| Retention/funnel analysis | Impossible by construction | Intended. Not our purpose. |

If cross-run correlation later proves necessary, the honest upgrade is a **rotating** id with a
published lifetime (e.g. re-minted per app version, or daily), documented as pseudonymous — not a
quiet reintroduction of a permanent one. Do not add it in v1.

### Decision — opt-in, default OFF (settled)

The purpose is **bug and error reporting**, not usage measurement, so opt-in is the right posture and
the coverage objection does not really apply: what we need is a good report of *what broke*, and an
install that never errors has nothing to contribute anyway. `telemetry_consent = None` on a fresh
install and after `reset-to-defaults`; the toggle renders off; silence is not consent.

**The one consequence to accept knowingly:** rates are unreliable. Consenting installs are a
self-selected population, so `failures / boots` describes *them*, not the user base. Read the
numbers as "these are the failure modes that exist and roughly their relative weight", never as
"X% of our installs are affected". `agent.turn_ok` stays as a within-population denominator —
useful for ranking failure modes against each other, not for absolute incidence.

This also means a **quality-over-quantity** bias in the design: prefer a richer, well-scrubbed
error payload over more event types. The classic follow-up, once this lands, is an explicit
"send this report?" prompt attached to a crash or a failed turn — high-signal, individually
consented, and a natural fit for opt-in. Out of scope for v1; do not build it speculatively.

### LGPD, concretely

| Requirement | What we do |
|---|---|
| **Lawful basis** | Consent, art. 7º, I. Not legitimate interest (art. 7º, IX) — that needs a documented balancing test and this data is not necessary to deliver the product. |
| **Consent quality** (art. 8º) | Free, informed, specific, unambiguous. One purpose only: "diagnóstico técnico". Not bundled with anything else. |
| **Opt-in, no pre-tick** (art. 8º §4º) | `telemetry_consent = None` on a fresh install and after `reset-to-defaults`. The toggle renders off. Silence is not consent. |
| **Revocable at any time** (art. 8º §5º) | The same toggle, one click, effective immediately and without restarting: `emit()` re-reads consent on every call, it is not cached. |
| **Right to deletion** (art. 18, VI) | Anonymous data has no data subject to delete for, so there is nothing server-side to erase — and no id to erase it by. The Settings action is therefore local and honest: flip consent to `denied`, clear the spool, clear the journal. Do NOT ship a `DELETE /v1/install/{id}` endpoint; it would require the very identifier we refuse to send. The copy must not promise server-side deletion we cannot perform. |
| **Retention** | 90 days raw, then aggregate-only. Desktop-side it is stated in the UI copy; enforcement is server-side and is a contract item (Phase 6). We cannot verify it from the client — see Open Question 4. |
| **Transparency** (art. 9º) | The journal (below). The user can read every event we sent, locally, without asking us. |
| **Anonymized** (art. 12) | No stable identifier leaves the machine. `run_id` dies with the process; `installation_id` is never sent and never joined. The remaining envelope — app_version, OS, os_version, install_method, locale — is a low-entropy bucket shared by thousands of installs, not a fingerprint. Timezone is dropped precisely because it raises entropy for no SRE value. |
| **Controller + contact** | MartinsTech. `privacidade@martinstech.net` named in the UI copy. |

---

## Endpoint

**`https://telemetry.martinstech.net/v1/events`** — a different host from provedor-ia. Not a path
under `llm.martinstech.net`, not a port on it, not a subdomain of it.

The reason is a trust boundary, not tidiness. `llm.martinstech.net/v1` carries prompts and model
output under one set of guarantees; telemetry carries diagnostics under another. Sharing the host
means one misrouted request, one over-broad proxy rule, or one credential mixup puts product
payloads on the model path — which is precisely the bug I fixed this morning, when `p_base_url()`
fell back to the model proxy URL and POSTed product payloads at the LLM gateway. Separate origin
makes that class of mistake a connection error instead of a silent success.

**Server is out of scope for this plan.** Define the contract; build it separately.

### Contract the desktop expects

```
POST /v1/events
  Content-Type: application/json
  Authorization: Bearer <MAESTRO_TELEMETRY_TOKEN>   # build-time, per-channel; see OQ 2
  Body: {"events": [ <TelemetryEvent>, ... ]}       # 1..50, always an array
  200/202 → accepted, drop from spool
  400/401/403/413/422 → payload rejected, DROP, do not retry (p_retryable already encodes this)
  408/429/5xx/network → retryable, spool
  Responses are ignored beyond the status code. No server-driven config, no remote
  kill switch, no cohort gating. The server cannot turn telemetry ON.

  200/202/404 → treat as done
  anything else → local deletion still completed; UI says the server request will retry
```

Config: `MAESTRO_TELEMETRY_URL` (base, e.g. `https://telemetry.martinstech.net`) —
already the gate in `client.py:214`, keep the name. Unset ⇒ nothing is sent and nothing is
spooled. Set it in `scripts/build-app.sh` and `scripts/build-app-win.ps1` alongside the existing
ship-time defaults.

**Guard compliance:** the host contains no `openswarm` token and does not match
`*.openswarm.{com,ai,io,net}`, so `check-callhome.mjs` and `check-fork-drift.mjs` pass unchanged.
Phase 5 *tightens* both guards; it never edits their forbidden literals.

---

## What is worth measuring

Eight events. Nothing else ships in v1. Each answers a question we currently cannot answer at all.

| Event | Fields beyond envelope | Question it answers |
|---|---|---|
| `app.crash_recovered` | `uptime_ms`, `relaunch_count_1h` | How often does the app die? `electron/crash-watchdog.js:100` already writes `crash-recovery.json` and `main.js` already reads it to show a chip — **nobody counts it.** Free signal, zero new sensing. |
| `app.backend_respawn` | `exit_code`, `uptime_ms`, `respawn_count` | Upstream `ec994182` (taken) respawns the backend on unexpected exit. We have no idea how often that fires. |
| `app.boot` | `cold_ms`, `bind_ms`, `router_started: bool`, `first_run: bool` | Once per launch. A wedge at boot is the worst failure mode and it is invisible today. |
| `agent.turn_failed` | `kind`, `subkind`, `provider`, `model`, `duration_ms`, `error_preview: ScrubbedText` | The classification is **already computed** in `handle_run_error.py` — `context_overflow`, `auth_error`, `out_of_credits`, `unknown_model`, `unclassified`, `transient_capacity`. `unclassified` volume is the wedge-finder. |
| `agent.turn_ok` | `provider`, `model`, `duration_ms`, `tool_call_count` | The denominator. A failure rate without one is noise. No content, no token counts. |
| `ui.wedge` | `witness: "long_task" \| "unresponsive"`, `blocked_ms`, `route`, `crumbs: List[str]` | Upstream's dual-witness design (`c3635062`): the long-task observer is primary, Chromium's `unresponsive` is the second witness. `route` is our own hash-route vocabulary. `crumbs` are `ring_buffer` labels — our own surface/action strings, never element text. |
| `ui.rage_click` | `route`, `click_count`, `window_ms` | Wedge witness only (3+ clicks on one target inside 1s). Never the element's text, never coordinates. Follows `751747b2`, minus its analytics-upload framing. |
| `sys.memory_pressure` | `rss_mb`, `cap_mb`, `shape: "cap_crossed" \| "leak_growth"`, `session_min` | Port `electron/memorySensor.js` from `7a1518df` + `d59b61e8` (env-overridable thresholds so support and tests can prove the wire). The one upstream sensor that is unambiguously good: silent on healthy sessions, speaks only on a real crossing. |

**Explicitly not shipping:** onboarding funnel steps, dashboard open/close/create/delete, per-message
events, agent titles, session dumps on close, route-change tracking, `app_lifecycle.opened/closed`,
cost reconciliation, `identify()`. Every one of these exists in the tree today and Phase 5 deletes it.

Sampling: none. At 8 event types and this trigger set, a healthy install emits single digits per
hour. If volume ever justifies sampling, sample server-side — client-side sampling makes crash
counts unreconstructable.

---

## Offline and failure behaviour

- **Bounded spool.** Reuse `buffer.py`. Change `P_MAX_BYTES` from `50 * 1024 * 1024` to
  `2 * 1024 * 1024`. 50 MB of a user's disk for a diagnostic stream is indefensible, and this
  stream will never approach it.
- **No unbounded retry.** Add an `attempts INTEGER NOT NULL DEFAULT 0` column (guarded
  `ALTER TABLE`, ignore "duplicate column"). Drop a row at `attempts >= 3`. Drop rows older than
  7 days at drain time without attempting them.
- **Never blocks boot.** `emit()` is synchronous, does no I/O beyond the journal append, and
  schedules the POST via the existing `p_schedule` pattern (running loop → `create_task`, else a
  daemon thread). `app.boot` fires on a 5s delay so it never contends with startup. The drain loop
  keeps its 60s period and first tick at +60s.
- **Never blocks an agent turn.** No `await` on telemetry anywhere in `TurnRunner.py` or
  `handle_run_error.py`. Every call site stays inside `try/except Exception: pass`, which is the
  existing convention at those sites — keep it.
- **Never logs a payload.** `transport.py` may log a status code, a path, and an exception type.
  It must never pass `body` or any event to a logger. Pinned by
  `backend/tests/test_telemetry_no_payload_logging.py`: plant a canary string in a `ScrubbedText`
  field, force a transport failure, assert the canary appears in no captured log record.
- **Consent is re-read per call, never cached.** Revoking must take effect on the next event, not
  the next launch.
- **A telemetry failure is never surfaced to the user.** No toast, no error card.

---

## Kill switch

**`MAESTRO_TELEMETRY_DISABLED`** — any non-empty value other than `0`/`false` hard-disables
everything: no consent read, no envelope build, no journal write, no spool write, no drain, no POST.

It is the **first branch** of `backend/apps/maestro_telemetry/consent.py::telemetry_enabled()`, checked
before settings load, before the URL check, before anything can touch disk. Ordering matters: it
must work on an install whose `settings.json` is corrupt.

```python
@typechecked
def telemetry_enabled() -> bool:
    # Kill switch first: must hold even when settings.json is unreadable.
    if p_env_truthy(os.environ.get("MAESTRO_TELEMETRY_DISABLED")):
        return False
    if p_base_url() is None:
        return False
    try:
        return load_settings().telemetry_consent == "granted"
    except Exception:
        return False   # Unreadable settings means no consent on record.
```

Note the `except` returns **False**, inverting `client.py:166`'s `return True`. An unreadable
settings file is not consent.

Verified by **`backend/tests/test_telemetry_killswitch.py`**: with consent granted, a URL
configured, and a stub transport installed, set the env var, emit one of each of the 8 events, then
assert the transport was never called, `buffer.count()` is 0, and the journal file does not exist.
A second case asserts the switch wins over `telemetry_consent == "granted"` written directly to
disk. A third asserts truthiness parsing: `1`/`true`/`yes` disable, `0`/`false`/empty/unset do not.

The frontend mirror is `window.maestro.telemetryDisabled` from `electron/preload.js`, so the
renderer's sensors never even install their listeners.

---

## Ordering

This plan lands **after OSR**, like everything else queued. Its collision is with
`docs/plans/2026-08-11-i18n-extraction.md`:

- I18N touches ~76 `.tsx` files and both locale JSONs. TLM touches **1** new `.tsx` file, 1 new
  dialog, and adds a new top-level namespace to both locale JSONs.
- The only overlap is `frontend/src/shared/i18n/{en,pt-BR}.json`.
- **Recommendation: land I18N first, then TLM.** TLM's JSON change is purely additive (a new
  `telemetry` namespace, no edits to existing keys), so rebasing TLM onto a finished I18N is a
  clean append. The reverse — rebasing I18N's ~300-key rewrite onto TLM — is not.
- If they must run in parallel: TLM adds its namespace and does not touch `settings.*`. Its section
  component is new, so it is not in any I18N slice.

TLM uses `useTranslation` from birth. That is a deliberate exception to "only 6 of 183 files use
it": consent copy is legally operative text, and shipping it English-only to a Brazilian SME user
base would mean consent that is not *informed* under art. 8º. This is the one place where the
i18n backlog is not an acceptable excuse.

---

## Phase 0 — pin the current inertness, before changing anything

Locks in the gating I did this morning so a later phase cannot silently un-gate it. This phase adds
tests and touches no production behaviour.

**Create** `backend/tests/test_telemetry_inert_by_default.py`:
- `MAESTRO_TELEMETRY_URL` unset ⇒ `p_base_url()` is `None` and `p_telemetry_configured()` is `False`.
- With the URL unset and `test_sink` unset, `p_post_or_spool` returns without spooling:
  `buffer.count(spool)` stays 0. (This is the drop-rather-than-spool behaviour at `client.py:247-249`.)
- A grep-style assertion that no module under `backend/apps/` hardcodes an `http` telemetry base URL.

**Modify** root `CLAUDE.md:17` — `1703 passing` → `1726 passing`.

**DoD**
```bash
cd backend && .venv/Scripts/python.exe -m pytest -q -p no:randomly tests/test_telemetry_inert_by_default.py
# 3 passed
cd backend && .venv/Scripts/python.exe -m pytest -q -p no:randomly 2>&1 | tail -3
# 6 failed, 1729 passed, 5 skipped   (+3)
node scripts/check-fork-drift.mjs   # clean
```

---

## Phase 1 — privacy primitives

No wire, no consent, no UI. Just the two things everything else depends on, so they are reviewable
in isolation.

**Create**
- `backend/apps/maestro_telemetry/__init__.py` — empty. Not a barrel; it exists only to make the package.
- `backend/apps/maestro_telemetry/scrub.py` — `scrub_free_text()` and `ScrubbedText` exactly as specified
  in the Privacy Contract. `scrub_free_text` calls
  `backend.apps.agents.core.error_classify.redact_for_telemetry` first (secret shapes), then applies
  rules 1-7. Order matters: secrets before path collapsing, or a key embedded in a URL query
  survives as `<path>`.
- `backend/tests/test_telemetry_scrub.py` — one case per rule 1-7, plus:
  - a composite Windows stderr tail containing a home path, a `sk-ant-` key, an email and a CPF,
    asserting none of the four survive and the diagnostic signal (`ENOENT spawn 9router`) does;
  - `ScrubbedText(value="raw")` raises;
  - `ScrubbedText.of(...)` scrubs and truncates to `limit`;
  - `ScrubbedText` is frozen (assignment raises).

**Do not modify** `error_classify.py`. Its four existing tests must stay green untouched — that is
the signal that you layered rather than rewrote.

**DoD**
```bash
cd backend && .venv/Scripts/python.exe -m pytest -q -p no:randomly tests/test_telemetry_scrub.py tests/test_error_classify.py
# all pass; the 4 error_classify tests unmodified
cd backend && .venv/Scripts/python.exe -m pytest -q -p no:randomly 2>&1 | tail -3
# 6 failed, 1729+N passed
```
Plus, by inspection: `git diff` shows zero lines changed in `backend/apps/agents/core/error_classify.py`.

---

## Phase 2 — the client: consent, envelope, event model, transport, journal

Still no call sites and no UI. Everything here is exercised only by tests.

**Create**
- `backend/apps/maestro_telemetry/consent.py` — `telemetry_enabled()`, `p_base_url()`, `p_env_truthy()`.
  `p_base_url()` reads `MAESTRO_TELEMETRY_URL` (moved from `client.py:213`, same semantics).
- `backend/apps/maestro_telemetry/envelope.py` — `build_envelope() -> Envelope` (pydantic). Salvage
  `resolve_locale` from `client.py` (NOT `resolve_timezone` — timezone is dropped, and NOT
  `p_get_install_id` — see Decision 0). **Ship none of**
  `user_id`, `user_email`, `device_type`, or `platform.platform()`.
- `backend/apps/maestro_telemetry/event.py` — the closed model:
  ```python
  EventName = Literal["app.crash_recovered", "app.backend_respawn", "app.boot",
                      "agent.turn_failed", "agent.turn_ok",
                      "ui.wedge", "ui.rage_click", "sys.memory_pressure"]

  class TelemetryEvent(BaseModel):
      model_config = ConfigDict(extra="forbid", validate_assignment=True)
      # ... envelope fields + the per-event fields from the table, all Optional
  ```
  One flat model with `extra="forbid"` and every payload field optional beats eight subclasses
  here: the allowlist test can then enumerate `model_fields` as *the* list of things that can
  ever leave the machine, which is exactly the artifact the privacy contract needs.
- `backend/apps/maestro_telemetry/journal.py` — append-only JSONL at
  `<SETTINGS_DIR>/telemetry_journal.jsonl`, capped at 500 lines / 2 MB (drop oldest),
  `read(limit)` and `clear()`. Written **after** the event validates, so the journal shows exactly
  what went on the wire.
- `backend/apps/maestro_telemetry/transport.py` — `post(events) -> Optional[int]`, `post_or_spool`,
  `drain_spool`. Salvage `p_delivered` / `p_retryable` verbatim including their comment. Batch
  1..50. httpx, 5s timeout, `P_MAX_INFLIGHT = 8`.
- `backend/apps/maestro_telemetry/emit.py` — `emit(name, **fields) -> None`. The single public surface.
  Order: kill-switch/consent → build event → validate → journal → schedule POST. Wrapped so it
  cannot raise. `set_test_sink()` seam, same idea as `client.py:105`.

**Modify**
- `backend/apps/service/buffer.py` — `P_MAX_BYTES` → `2 * 1024 * 1024`; add the guarded
  `attempts` column; `drain()` skips and deletes rows older than 7 days; new
  `bump_attempts(ids)` and drop-at-3 in `drain()`.
  *(Leaving `buffer.py` where it is, rather than moving it: the move would be a rename-only diff
  across a file with live tests. Phase 5 revisits if `apps/service` shrinks enough to warrant it.)*

**Create tests**
- `test_telemetry_consent.py` — the tri-state; `None` is off; unreadable settings is off;
  URL-unset is off; consent read fresh on every call (flip the file mid-test, no restart).
- `test_telemetry_killswitch.py` — the three cases in the Kill Switch section.
- `test_telemetry_envelope.py` — the 8 envelope fields present; `user_id`/`user_email`/`platform`
  absent even when set in settings; `run_id` stable within a process and **different in a fresh
  process** (assert two separately-spawned envelopes disagree — that is the anonymity property).
- `test_telemetry_allowlist.py` — **the load-bearing test.** Assert
  `set(TelemetryEvent.model_fields)` equals a hardcoded literal set copied from the Privacy
  Contract table. A new field fails this test until someone edits both the model and the set,
  which forces the doc amendment. Second case: `TelemetryEvent(**{"prompt": "hi"})` raises on
  `extra="forbid"`.
- `test_telemetry_no_user_text.py` — plant canaries (`CANARY-PROMPT`, `C:\Users\CANARY\x.txt`,
  `sk-ant-` + `A`*28, `canary@example.com`) into settings, a session object, and an exception
  message; emit all 8 events through a capturing sink; assert no canary substring appears in any
  serialized event.
- `test_telemetry_no_payload_logging.py` — as specified in Offline/Failure.
- `test_telemetry_spool.py` — 2 MB cap trims oldest; a row at 3 attempts is dropped not retried;
  an 8-day-old row is dropped without a POST; corrupt row does not block the queue (existing
  `buffer.py` behaviour, re-pinned).

**DoD**
```bash
cd backend && .venv/Scripts/python.exe -m pytest -q -p no:randomly tests/test_telemetry_*.py
# all pass
cd backend && .venv/Scripts/python.exe -m pytest -q -p no:randomly tests/test_service.py
# still green — Phase 2 changed buffer.py, which test_service.py exercises
cd backend && .venv/Scripts/python.exe -m pytest -q -p no:randomly 2>&1 | tail -3
```
Plus by inspection: `git grep -n "logger\." backend/apps/maestro_telemetry/` shows no format arg that could
be an event or a body.

---

## Phase 3 — sensors and call sites

Now wire it. Every site is fire-and-forget inside `try/except Exception: pass`.

**Backend — modify**
- `backend/apps/agents/manager/run/handle_run_error.py` — replace the 4 `submit_diagnostic` blocks
  (lines ~80, ~180, ~201, and the `context_overflow` block) with
  `emit("agent.turn_failed", kind=..., subkind=..., provider=..., model=..., duration_ms=...,
  error_preview=ScrubbedText.of(str(e), limit=400))`. The `kind`/`subkind` values already computed
  there become the event's enums — **do not invent new taxonomy.** Drop `connection_mode`
  (settings-derived, not needed) and `active_mcps` / `messages_count`.
- `backend/apps/agents/manager/run/TurnRunner.py` — `emit("agent.turn_ok", ...)` on the success
  path. `tool_call_count` from the existing per-turn counter; no names.
- `backend/apps/agents/agent_manager.py:215-222` — the one `submit_diagnostic` → `agent.turn_failed`
  with `kind="manager"`.
- `backend/apps/nine_router/process.py:353-362` → `emit("app.backend_respawn", ...)`. It already
  runs `redact_for_telemetry` on its `stderr_tail`; route through `ScrubbedText.of` instead.
- `backend/apps/service/service.py` — in `service_lifespan`, delete the `svc.sync(...)` boot blob,
  the `identity` blob, the `analytics_client.logs.write` call, and `track_link_email`. Replace with
  a 5s-delayed `emit("app.boot", ...)`. Delete `p_pulse_loop` and `p_pulse_task` entirely. Keep
  `p_drain_task`, repointed at `telemetry.transport.drain_spool`. Keep the 9Router background-start
  block and its comment verbatim — that is the biggest warm-startup win in the file and has nothing
  to do with telemetry.
- `backend/apps/settings/settings.py:184-217` — delete the `p_sync(safe)` call, the `p_identify`
  block, and the `track_link_email` call. **This is the settings-object leak; it goes, it is not
  filtered harder.**

**Electron — create**
- `electron/memorySensor.js` + `electron/memorySensor.test.js` — port from upstream `7a1518df` and
  `d59b61e8`. Debrand identifiers per the OSR naming contract; thresholds env-overridable
  (`MAESTRO_MEM_CAP_MB`, `MAESTRO_MEM_LEAK_MB`) so the wire is provable.

**Electron — modify**
- `electron/main.js` — start the memory sensor; forward the existing `crash-recovery.json` marker
  (already read there for the recovery chip) to `app.crash_recovered`; forward the
  `unresponsive` window event as a wedge witness. All three go through IPC to the renderer, which
  owns the telemetry POST — do not add an HTTP client to the main process.
- `electron/preload.js` — expose `telemetryDisabled: boolean` (from
  `MAESTRO_TELEMETRY_DISABLED`) plus the three event channels.
- `frontend/src/types/electron.d.ts` — the matching types. The three-way contract
  (preload ↔ `electron.d.ts` ↔ consumers) must stay consistent; see OSR Phase 1B.

**Frontend — create**
- `frontend/src/shared/telemetryClient.ts` — `emit(name, fields)`, POSTs to
  `${API_BASE}/telemetry/emit` (the backend owns consent, envelope and transport; the renderer
  never talks to `telemetry.martinstech.net` directly — one consent gate, not two). 1s batch
  window and `keepalive` on `pagehide`, both salvaged from `serviceClient.ts:39-55`.
  **No leading underscores** — `serviceClient.ts` is full of them and violates
  `frontend/CLAUDE.md`; do not carry that over.
- `frontend/src/shared/uxSignals.ts` — long-task observer (primary wedge witness), the
  `unresponsive` witness, and rage-click detection (3+ clicks, one target, 1s). Route name from
  `window.location.hash` only. **Never** read `event.target.textContent` or coordinates.

**Frontend — modify**
- `frontend/src/app/Main.tsx` — install `uxSignals`; delete the two `report()` calls.
- `frontend/src/app/components/feedback/ErrorBoundary.tsx` — its `report()` becomes
  `emit("ui.wedge", witness: "long_task", crumbs: getRecentActions())`. Keep the
  `getRecentActions` breadcrumb ring from `serviceClient.ts:21-37` — surface/action labels from our
  own vocabulary, which is the good part of that file.

**Backend router — create**
- `backend/apps/maestro_telemetry/router.py` — `POST /api/telemetry/emit` (validates into
  `TelemetryEvent`, then `emit()`; **rejects unknown event names and extra fields** rather than
  forwarding, which is the fix for `post_submit`'s three-shapes-and-an-array grab bag),
  `GET /api/telemetry/journal`, `GET /api/telemetry/status`, `POST /api/telemetry/forget`.
  Register in `backend/main.py` next to the `service` SubApp.

**DoD**
```bash
cd backend && .venv/Scripts/python.exe -m pytest -q -p no:randomly
# the 6 known failures only; test_service.py may now fail on deleted sync() sites — that is
# expected and Phase 5 removes it. Note the count; do not "fix" test_service.py here.
cd frontend && npx tsc --noEmit    # clean
cd frontend && npm run lint        # 0 errors, warnings <= 123
node --test electron/memorySensor.test.js
```
Manual, with `MAESTRO_TELEMETRY_URL` pointed at a local `nc -l`-style sink and consent granted:
run an agent turn that fails (bad API key) and confirm exactly one `agent.turn_failed` arrives
with a scrubbed preview and no key. Then unset consent and confirm nothing arrives.

---

## Phase 4 — consent UI, journal viewer, deletion (pt-BR)

**Create**
- `frontend/src/app/pages/Settings/sections/general/TelemetrySection.tsx` — three rows in the flat
  style `DataPrivacySection.tsx` already establishes (`rowSx`, `rowBtnSx`, `labelSx`, `descSx` from
  `SettingsStyles`; no boxed "danger zone"). Placed **directly above** `DataPrivacySection` in
  `GeneralTab.tsx`, so consent and erasure read as one story.
  1. A `Switch` — off when `telemetry_consent !== "granted"`.
  2. "Ver o que foi enviado" → the journal dialog.
  3. "Excluir meus diagnósticos" → confirm dialog → `POST /api/telemetry/forget`.
  Plus a footer line with the lawful basis, the 90-day retention, and the contact address.
- `frontend/src/app/pages/Settings/sections/general/TelemetryJournalDialog.tsx` — reverse-chronological
  list of journal entries (event name, timestamp, fields as key/value), a "Copiar" button, and an
  honest empty state. Reuses `dialogPaperSx`/`titleSx`/`bodySx` conventions from
  `DataPrivacySection.tsx`.
- `frontend/src/shared/i18n/en.json` + `pt-BR.json` — a new top-level `telemetry` namespace.
  Both in the same commit; never leave a key English-only in pt-BR, because `fallbackLng` hides the
  omission (see the I18N plan's rules, which apply here in full).

pt-BR copy — this is the normative wording, not a suggestion. It must not promise anonymity, and it
must name the exclusions the privacy contract makes:

```
telemetry.sectionTitle      "Diagnóstico"
telemetry.toggleLabel       "Enviar diagnósticos à MartinsTech"
telemetry.toggleDesc        "Desligado. Se você ligar, o Maestro Studio envia relatórios técnicos
                             quando o app trava, fecha sozinho ou uma tarefa do agente falha:
                             versão do app, sistema operacional e o que quebrou. Nunca envia seus
                             prompts, as respostas do agente, o conteúdo ou o nome dos seus
                             arquivos, os sites que você abriu, nem suas chaves de API."
telemetry.viewLabel         "Ver o que foi enviado"
telemetry.viewDesc          "Lista, neste computador, cada relatório enviado."
telemetry.viewButton        "Ver"
telemetry.forgetLabel       "Excluir meus diagnósticos"
telemetry.forgetDesc        "Desliga o envio, apaga o que está na fila neste computador e pede a
                             exclusão do que já enviamos."
telemetry.forgetButton      "Excluir"
telemetry.forgetConfirm     "Excluir seus diagnósticos?"
telemetry.forgetConfirmBody "Isso desliga o envio e apaga a fila local agora. O pedido de exclusão
                             no servidor é enviado em seguida; se você estiver sem internet, ele
                             vai na próxima vez que o app abrir."
telemetry.forgetDone        "Pronto. Envio desligado e fila local apagada."
telemetry.legalNote         "Base legal: seu consentimento (LGPD, art. 7º, I). Você pode retirá-lo
                             a qualquer momento neste mesmo botão. Guardamos os relatórios por
                             90 dias. Os relatórios não são anônimos: eles carregam um
                             identificador da instalação, que trocamos quando você exclui seus
                             dados. Dúvidas: privacidade@martinstech.net."
telemetry.journalTitle      "O que foi enviado"
telemetry.journalEmpty      "Nada foi enviado."
telemetry.journalCopy       "Copiar"
telemetry.journalCopied     "Copiado"
```

**Modify**
- `backend/apps/settings/models.py` — add
  `telemetry_consent: Optional[Literal["granted", "denied"]] = None`.
- `backend/apps/settings/settings.py` — add `telemetry_consent` to `SERVER_OWNED_FIELDS`? **No** —
  the user sets it, so it must be writable by the renderer. Instead **remove** `analytics_opt_in`
  from `P_RESET_PRESERVE_FIELDS` (line ~356) and do **not** add `telemetry_consent` there:
  `reset-to-defaults` must reset consent to `None`. A preferences reset that silently preserves a
  consent grant is not a reset.
- `frontend/src/shared/state/settingsSlice.ts` — the field on `AppSettings`.
- `frontend/src/app/pages/Settings/sections/general/GeneralTab.tsx` — mount `TelemetrySection`.

**Create test**
- `backend/tests/test_telemetry_forget.py` — `POST /api/telemetry/forget` sets consent to
  `denied`, empties the spool, and deletes the journal; and it does all three
  **even when the server DELETE fails** (stub the transport to raise).

**DoD**
```bash
cd frontend && npx tsc --noEmit && npm run lint
# key parity both ways (the I18N plan's check, verbatim):
cd frontend && node -e "const e=require('./src/shared/i18n/en.json'),p=require('./src/shared/i18n/pt-BR.json');const f=(o,pre='')=>Object.entries(o).flatMap(([k,v])=>v&&typeof v==='object'?f(v,pre+k+'.'):[pre+k]);const ek=f(e),pk=f(p);console.log('missing',ek.filter(k=>!pk.includes(k)),'extra',pk.filter(k=>!ek.includes(k)))"
# both arrays empty
cd backend && .venv/Scripts/python.exe -m pytest -q -p no:randomly tests/test_telemetry_forget.py
```
Manual: launch the app. Toggle renders **off** on a fresh profile. Turn it on, run a failing agent
turn, open "Ver o que foi enviado" and confirm the event is listed with no prompt text and no file
path. Click "Excluir": toggle goes off, journal empties. Run `reset-to-defaults` from
`DataPrivacySection` and confirm the toggle is off afterwards.

---

## Phase 5 — demolition, and tighten the guards so it cannot come back

Only now, with the replacement proven. Deleting earlier means Phase 3 has no reference to diff against.

**Delete**
- `backend/apps/service/client.py`
- `backend/apps/service/analytics/` — all of `__init__.py`, `client.py`, `agent_bridge.py`,
  `frontend_bridge.py`, `ANALYTICS_OVERVIEW.md`
- `backend/apps/service/models.py` (a one-line "Reserved" stub)
- `backend/tests/test_service.py`, `backend/tests/test_service_legacy.py`
- `frontend/src/shared/serviceClient.ts`
- `swarm-analytics==0.1.1` + its comment from `backend/requirements.txt` (lines 19-20)

**Modify — remove the remaining call sites**
- `backend/apps/agents/core/ws_manager.py:115` — the `bridge_agent_message` import and call. This
  one bridged **every agent message** into analytics; it is the single most important deletion in
  this phase.
- `backend/apps/agents/manager/AgentLaunch.py:134` — `track_agent_created`
- `backend/apps/agents/manager/metadata.py:96` — `track_agent_title` (ships user-authored titles)
- `backend/apps/dashboards/dashboards.py:138,458,565` — `track_dashboard_event`
- `backend/apps/service/service.py` — delete `post_submit`, `post_event`, `p_bridge_to_analytics`,
  `spool_count` (superseded by `/api/telemetry/status`), and the shutdown `track_app_closed` /
  `shutdown_analytics` block. What remains is `/usage-summary`, `/cost-breakdown`, `/status`, and a
  lifespan that starts 9Router + the drain loop.
- `backend/apps/settings/models.py` — delete `analytics_opt_in` and `analytics_token`.
  `installation_id`, `timezone`, `locale`, `first_opened_at` stay (still used).
- `backend/apps/settings/settings.py` — drop `analytics_token` from `SERVER_OWNED_FIELDS` and from
  the `secret_keys` set; drop `analytics_opt_in` from `P_RESET_PRESERVE_FIELDS`.
- `backend/apps/settings/store.py` — `migrate_legacy_fields`: drop `analytics_opt_in` /
  `analytics_token` from a loaded `settings.json` rather than erroring on an unknown key. Two-generation
  upgrades must not break; this file is already the ALLOW-listed migration table.
- Every remaining frontend `report()` call site — the 22 files from the grep. Delete outright unless
  it is `ErrorBoundary.tsx` (Phase 3 keeps it) or `Main.tsx` (Phase 3 rewires it). The onboarding
  and `Dashboard/hooks/interaction/**` calls are the funnel we are explicitly not building.
- `frontend/src/app/components/Onboarding/telemetry.ts` — delete the file; nothing replaces it.

**Modify — the guards**

`scripts/check-fork-drift.mjs`, `FORBIDDEN_PATHS`, add with the deleted-subsystem comment:
```js
'backend/apps/service/analytics/', 'backend/apps/service/client.py',
'frontend/src/shared/serviceClient.ts',
```
And a fourth drift class — the upstream analytics SDK. `swarm_analytics` does **not** match the
existing `(open|self)[-_ ]?swarm` pattern, so a cherry-pick reintroducing it passes today:
```js
// 4. the upstream product-analytics SDK. Deleted in TLM; a cherry-pick must not reinstate the dep.
const sdkHits = sh(`git grep -inIE "swarm[-_]analytics" -- . ":!node_modules"`)...
```
Do **not** grep bare `swarm` — `backend/apps/swarm/` is ours and legitimate. Add
`docs/plans/` is already in `ALLOW_PREFIX`, so this plan file is exempt.

`scripts/check-callhome.mjs`: leave the `openswarm` literals **exactly** as they are — they are the
regression detector and renaming them disarms the check (the file says so, twice). Add one entry so
telemetry cannot regress onto the model host:
```js
/llm\.martinstech\.net\/v1\/(events|install)/i,   // telemetry must never share the model host
```

**DoD**
```bash
cd backend && .venv/Scripts/python.exe -m pytest -q -p no:randomly 2>&1 | tail -3
# the 6 known failures only. Count = 1726 - (test_service.py + test_service_legacy.py cases)
#   + (the ~10 new test files' cases). Record the exact number in the commit message.
git grep -n "apps.service.client\|apps.service.analytics\|serviceClient\|swarm_analytics" -- . ':!node_modules' ':!docs/plans'
# no hits
cd backend && .venv/Scripts/python.exe -c "import backend.main"   # imports clean without swarm-analytics
node scripts/check-fork-drift.mjs   # clean, with the new rules active
node scripts/check-callhome.mjs     # clean
cd frontend && npx tsc --noEmit && npm run lint
```
Prove the new guard rules actually fire: temporarily add `import swarm_analytics` to a scratch file
and confirm `check-fork-drift.mjs` exits 1, then revert. A guard nobody has seen fail is a guard
nobody knows works.

---

## Phase 6 — contract, docs, full verify

**Create**
- `docs/TELEMETRY.md` — the privacy contract from this plan as living documentation: the collected
  table, the not-collected list, the 8 events, the kill switch, the LGPD table, and the endpoint
  contract. This is what a customer asking "what do you collect" gets shown, so write it for them,
  not for us. It supersedes the deleted `ANALYTICS_OVERVIEW.md`.

**Modify**
- `docs/UPSTREAM.md` — under "What must never come back", add `backend/apps/service/analytics/`
  and the `swarm-analytics` dep, and amend the "all `telemetry:` commits" line: `7a1518df`,
  `d59b61e8`, `751747b2`, `c3635062` and `792605e5` are now **taken** (as sensors, ported), while
  the analytics-upload commits (`a41e9699`, `86e323cb`, `565009f0`, `5be3bb84`, …) remain refused.
  Add them to the "Taken so far" / "Evaluated and deliberately skipped" tables so the next agent
  does not re-litigate.
- root `CLAUDE.md` — under Rules, one line: telemetry is opt-in, goes to
  `telemetry.martinstech.net`, never the model host, and `MAESTRO_TELEMETRY_DISABLED=1` kills it.
  Under "Where things live": `backend/apps/maestro_telemetry/`.
- `scripts/build-app.sh` + `scripts/build-app-win.ps1` — set `MAESTRO_TELEMETRY_URL` (and
  `MAESTRO_TELEMETRY_TOKEN`, pending OQ 2) alongside the existing ship-time proxy defaults.

**DoD**
```bash
npm run verify        # green: lint, typecheck, build, golden, call-home, fork-drift
cd backend && .venv/Scripts/python.exe -m pytest -q -p no:randomly 2>&1 | tail -3
# 6 failed (the known set), pass count matching Phase 5's recorded number
```
And a different-vendor model review before merge, per root `CLAUDE.md`:
```bash
node harness/review.mjs --base main --head HEAD
```
Final manual pass, packaged build, `MAESTRO_TELEMETRY_URL` set to a real sink:
1. Fresh profile → toggle off, nothing on the wire. **The most important check in this plan.**
2. Consent on → `app.boot` arrives; envelope has no email and no `user_id`.
3. Kill an agent turn → `agent.turn_failed` with a scrubbed preview.
4. Pull the network → events spool; restore it → they drain; spool never exceeds 2 MB.
5. `MAESTRO_TELEMETRY_DISABLED=1` with consent granted → nothing on the wire, journal untouched.
6. "Excluir meus diagnósticos" → toggle off, spool empty, journal empty. No server call: there is
   no identifier to delete by, and the copy must not imply otherwise.

---

## DO NOT

- **Do not send telemetry to `llm.martinstech.net`**, on any path or port. Different concern,
  different trust boundary. This is the bug that already happened.
- **Do not rename or "clean up" the `openswarm` literals in `scripts/check-callhome.mjs` or
  `scripts/check-fork-drift.mjs`.** They are the regression detectors. Both files say so.
- **Do not reuse `analytics_opt_in` as the consent flag.** It defaults `True` and is already `True`
  on disk everywhere. See Decision 2.
- **Do not default the new toggle on**, and do not pre-tick it in any dialog. LGPD art. 8º §4º.
- **Do not add a first-run consent modal.** Opt-in default means silence is off, which is already
  correct; a modal about telemetry as the first thing a user sees is a worse product and buys no
  legal ground. (See OQ 3 if you disagree — it is an open question, not a free choice.)
- **Do not add a field to `TelemetryEvent` without amending `docs/TELEMETRY.md` and the literal set
  in `test_telemetry_allowlist.py`.** The test exists to make that impossible to forget.
- **Do not pass a bare `str` into a free-text event field.** `ScrubbedText.of()` or nothing.
- **Do not `await` telemetry** anywhere in `TurnRunner.py`, `handle_run_error.py`, or a lifespan
  before the HTTP bind.
- **Do not log an event, a body, or any `ScrubbedText` value.** Status codes and exception types only.
- **Do not let the server turn telemetry on**, gate a cohort, or push config. The response body is
  ignored beyond its status code. `preflight_rollout_pct` (`models.py:83`) is the pattern to avoid
  here — a server-side dial over client behaviour.
- **Do not restore `p_sync(safe)` in `backend/apps/settings/settings.py`.** A denylist over a
  growing settings model is a leak with a fuse.
- **Do not re-add `swarm-analytics`** to `backend/requirements.txt`.
- **Do not move `/usage-summary` or `/cost-breakdown`.** They are local reads, not telemetry.
- **Do not touch `LICENSE`, or the MIT attribution in `NOTICE` / `README.md`.**
- **Do not "fix" the 6 pre-existing test failures** in this branch. One ticket per branch.
- **Do not add a second consent gate in the renderer.** The renderer POSTs to the local backend;
  the backend is the only place consent is evaluated. Two gates means one of them is wrong.

---

## Open questions — with recommendations. Do not guess; if you disagree, escalate before building.

1. **Where does the ingest run?** *Recommendation:* a separate small FastAPI app on Fly.io
   `gru` (São Paulo), behind `telemetry.martinstech.net`, distinct from the provedor-ia app. In-region
   avoids LGPD art. 33 international-transfer obligations entirely, which is worth more than the
   latency. **Server build is out of scope for this plan** — Phase 6 ships the contract; the desktop
   is complete and inert without it (`MAESTRO_TELEMETRY_URL` unset ⇒ nothing sent, nothing spooled).

2. **Ingest authentication.** *Recommendation:* a per-channel `MAESTRO_TELEMETRY_TOKEN` baked at
   build time, with the honest acknowledgement that anyone can extract it from the bundle, so the
   server must rate-limit per source IP (there is no `install_id` to key on) and treat all input as
   hostile. The alternative — no auth
   at all — is defensible for a write-only diagnostic sink and is less misleading. Decide before
   Phase 6 writes the build scripts; Phases 1-5 are unaffected either way.

3. **Consent prompt placement: Settings-only, or a first-run ask?** *Recommendation:* Settings-only
   for v1, per the DO NOT above. Revisit only if the event volume from voluntary opt-in turns out
   too low to be useful — and measure that before adding the modal, because a modal is a permanent
   cost against a temporary problem.

4. **Retention enforcement is unverifiable from the desktop.** The UI copy promises 90 days; only
   the server can honour it. *Recommendation:* make it a hard requirement of the ingest spec, and do
   not weaken the copy to hedge — a promise we intend to keep and enforce elsewhere is better than
   a vague one. Flag it to whoever builds the server.

5. **Ordering against the I18N plan.** *Recommendation:* land I18N first (see Ordering). If product
   pressure inverts that, TLM's JSON change is additive and rebasable, but say so out loud rather
   than discovering it in a conflict.

6. **~~`install_id` rotation vs crash de-dup~~ — moot under Decision 0.** No stable id ships at
   all, so there is no rotation boundary. The de-dup strategy is the `(app_version, os, event_name,
   error_preview)` grouping described there.

7. **`electron/crash-watchdog.js` is mac-only** (`process.platform !== 'darwin'` ⇒ exit), so
   `app.crash_recovered` will only ever fire on macOS while our primary target is Windows.
   *Recommendation:* ship the event as-is in this plan (it is free on macOS and correct), and file a
   separate ticket for a Windows watchdog. Do **not** expand the watchdog's platform support inside
   this branch — that is a stability change wearing a telemetry hat, and it deserves its own review.
