import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import InputBase from '@mui/material/InputBase';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import Switch from '@mui/material/Switch';
import Tooltip from '@mui/material/Tooltip';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import { useAppDispatch, useAppSelector } from '@/shared/hooks';
import { fetchCloudSmsStatus, type Workflow, type ScheduleConfig, type PermissionTier } from '@/shared/state/workflowsSlice';
import { WEEKDAY_LABEL, formatTime, fireTimesWithin } from './scheduleUtils';
import { nextTierAfter } from './permissionsUtils';
import { BODY_FS, LABEL_FS, HINT_FS, INPUT_FS } from './workflowEditCommon';

function jsWeekday(d: Date): number { return d.getDay(); }

function lastDayOfMonthFE(year: number, monthZeroBased: number): number {
  return new Date(year, monthZeroBased + 1, 0).getDate();
}

// Compute the next fire time from a ScheduleConfig. Mirrors the backend
// math in scheduler.py:_next_fire_after using browser-local time so the
// preview lines up with what the user will actually see on their system
// clock. Honors ends_at + max_runs so the "Next run" line doesn't lie
// after the schedule has expired.
function previewNextRun(sched: ScheduleConfig): Date | null {
  if (!sched.enabled) return null;
  const now = new Date();
  if (sched.ends_at) {
    const ends = new Date(sched.ends_at);
    if (!Number.isNaN(ends.getTime()) && ends.getTime() <= now.getTime()) return null;
  }
  if (sched.max_runs != null && sched.runs_count >= sched.max_runs) return null;
  let candidate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), sched.hour, sched.minute, 0, 0);
  if (candidate <= now) candidate = new Date(candidate.getTime() + 86400000);
  if (sched.repeat_unit === 'day') {
    const step = Math.max(1, sched.repeat_every);
    while (candidate <= now) candidate = new Date(candidate.getTime() + step * 86400000);
    return candidate;
  }
  if (sched.repeat_unit === 'week') {
    const allowed = sched.on_days.length ? sched.on_days : [jsWeekday(now)];
    for (let i = 0; i < 14; i += 1) {
      if (allowed.includes(jsWeekday(candidate)) && candidate > now) return candidate;
      candidate = new Date(candidate.getTime() + 86400000);
    }
    return candidate;
  }
  if (sched.repeat_unit === 'month') {
    const step = Math.max(1, sched.repeat_every);
    const startDay = now.getDate();
    let year = now.getFullYear();
    let month = now.getMonth();
    let guard = 0;
    while (guard < 60) {
      const day = Math.min(startDay, lastDayOfMonthFE(year, month));
      const c = new Date(year, month, day, sched.hour, sched.minute, 0, 0);
      if (c > now) return c;
      month += step;
      year += Math.floor(month / 12);
      month = ((month % 12) + 12) % 12;
      guard += 1;
    }
    return null;
  }
  return null;
}

function formatNextRun(d: Date): string {
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()];
  const mo = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()];
  return `${wd} ${mo} ${d.getDate()} at ${formatTime(d.getHours(), d.getMinutes())}`;
}

type EndKind = 'forever' | 'on_date' | 'after_n';

function endKindFromSched(s: ScheduleConfig): EndKind {
  if (s.ends_at) return 'on_date';
  if (s.max_runs != null) return 'after_n';
  return 'forever';
}

interface AppOpenInfo {
  alwaysOn: boolean;       // tray + login both configured
  loginAtLaunch: boolean;
  trayEnabled: boolean;
}

function useAppOpenInfo(): { info: AppOpenInfo; fix: () => Promise<void> } {
  const [info, setInfo] = useState<AppOpenInfo>({ alwaysOn: false, loginAtLaunch: false, trayEnabled: false });
  useEffect(() => {
    let alive = true;
    const w: any = (window as any).openswarm;
    if (!w?.getAppOpenInfo) return;
    w.getAppOpenInfo().then((res: AppOpenInfo) => { if (alive) setInfo(res); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  const fix = useCallback(async () => {
    const w: any = (window as any).openswarm;
    if (!w?.setLoginItem || !w?.enableTray) return;
    await w.setLoginItem(true);
    await w.enableTray(true);
    if (w.getAppOpenInfo) {
      const next = await w.getAppOpenInfo();
      setInfo(next);
    }
  }, []);
  return { info, fix };
}

export default function ScheduleFacet({ draft, setDraft }: { draft: Workflow; setDraft: (w: Workflow) => void }) {
  const c = useClaudeTokens();
  const dispatch = useAppDispatch();
  const s = draft.schedule;
  const cloudSms = useAppSelector((st) => (st as any).workflows?.cloudSmsEnabled);

  useEffect(() => { dispatch(fetchCloudSmsStatus()); }, [dispatch]);

  // No silent enable-on-edit. The master Switch is now the single source
  // of truth for whether this schedule is armed.
  const setSched = useCallback((patch: Partial<ScheduleConfig>) => {
    setDraft({ ...draft, schedule: { ...s, ...patch } });
  }, [draft, s, setDraft]);

  const addBackup = useCallback(() => {
    const tiers = [...(draft.permissions || [])];
    const next = nextTierAfter(tiers);
    if (!next) return;
    tiers.push(next);
    setDraft({ ...draft, permissions: tiers });
  }, [draft, setDraft]);

  const removeTier = useCallback((idx: number) => {
    // Drop the removed tier AND all following tiers so the chain stays
    // contiguous (no "call" without "text" before it).
    const tiers = (draft.permissions || []).slice(0, idx);
    setDraft({ ...draft, permissions: tiers });
  }, [draft, setDraft]);

  const setTier = useCallback((idx: number, patch: Partial<PermissionTier>) => {
    const tiers = [...(draft.permissions || [])];
    tiers[idx] = { ...tiers[idx], ...patch };
    setDraft({ ...draft, permissions: tiers });
  }, [draft, setDraft]);

  const canAddBackup = ((draft.permissions || [])[ (draft.permissions || []).length - 1 ]?.kind || 'notify') !== 'call';
  const endKind = endKindFromSched(s);
  const nextPreview = useMemo(() => previewNextRun(s), [s]);
  const { info: appOpen, fix: fixAppOpen } = useAppOpenInfo();

  const setEndKind = (k: EndKind) => {
    if (k === 'forever') setSched({ ends_at: null, max_runs: null });
    else if (k === 'on_date') setSched({ ends_at: new Date(Date.now() + 7 * 86400000).toISOString(), max_runs: null });
    else setSched({ ends_at: null, max_runs: 10 });
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
      {/* Row 1: master On/Off. Explicit so users never wonder if a stray
          click armed a schedule. */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Switch size="small" checked={s.enabled} onChange={(e) => setSched({ enabled: e.target.checked })} />
        <Typography sx={{ fontSize: BODY_FS, fontWeight: 700, color: c.text.primary }}>
          {s.enabled ? 'Schedule is on' : 'Schedule is off'}
        </Typography>
      </Box>

      {/* Row 2: app-open status badge. Only render when the schedule is
          actually on; an "OpenSwarm must be open at 9am" warning is
          meaningless when nothing's scheduled. */}
      {s.enabled && (
        <AppOpenStatusBadge info={appOpen} hour={s.hour} minute={s.minute} onFix={fixAppOpen} />
      )}

      {/* Row 3: repeat + timezone. */}
      <Typography sx={{ fontSize: BODY_FS, fontWeight: 700, color: c.text.primary, mt: 0.5 }}>When should this workflow run?</Typography>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
        <Typography sx={{ fontSize: BODY_FS, color: c.text.secondary }}>Repeat every</Typography>
        <InputBase
          type="number"
          value={s.repeat_every}
          onChange={(e) => setSched({ repeat_every: Math.max(1, Number(e.target.value) || 1) })}
          sx={{ width: 48, fontSize: INPUT_FS, border: `1px solid ${c.border.subtle}`, borderRadius: `${c.radius.md}px`, px: 0.75, py: 0.4 }}
        />
        <Select
          size="small"
          value={s.repeat_unit}
          onChange={(e) => setSched({ repeat_unit: e.target.value as ScheduleConfig['repeat_unit'] })}
          sx={{ fontSize: LABEL_FS, '& .MuiSelect-select': { py: 0.5 } }}>
          <MenuItem value="day">day</MenuItem>
          <MenuItem value="week">week</MenuItem>
          <MenuItem value="month">month</MenuItem>
        </Select>
      </Box>
      {s.repeat_unit === 'week' && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, pl: 2, flexWrap: 'wrap' }}>
          <Typography sx={{ fontSize: HINT_FS, color: c.text.muted }}>↳ on</Typography>
          {WEEKDAY_LABEL.map((label, idx) => {
            const active = s.on_days.includes(idx);
            return (
              <Box
                key={idx}
                onClick={() => setSched({ on_days: active ? s.on_days.filter((d) => d !== idx) : [...s.on_days, idx] })}
                role="button"
                sx={{ width: 26, height: 26, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: LABEL_FS, fontWeight: 700, cursor: 'pointer', color: active ? '#fff' : c.text.muted, bgcolor: active ? c.accent.primary : 'transparent', border: `1px solid ${active ? c.accent.primary : c.border.subtle}` }}>{label}</Box>
            );
          })}
        </Box>
      )}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, pl: 2 }}>
        <Typography sx={{ fontSize: HINT_FS, color: c.text.muted }}>↳ at</Typography>
        {/* 12-hour picker; backend stores 0..23 but the UI uses 1..12+AM/PM
            so users can't accidentally schedule "3" thinking it's 3pm and
            get a 3am run. */}
        <Select
          size="small"
          value={((s.hour + 11) % 12) + 1}
          onChange={(e) => {
            const h12 = Number(e.target.value);
            const isPm = s.hour >= 12;
            const next = (h12 % 12) + (isPm ? 12 : 0);
            setSched({ hour: next });
          }}
          sx={{ fontSize: LABEL_FS, '& .MuiSelect-select': { py: 0.4 } }}>
          {Array.from({ length: 12 }, (_, i) => i + 1).map((h) => (
            <MenuItem key={h} value={h}>{h}</MenuItem>
          ))}
        </Select>
        <Typography sx={{ fontSize: INPUT_FS, color: c.text.muted }}>:</Typography>
        <Select
          size="small"
          value={s.minute}
          onChange={(e) => setSched({ minute: Number(e.target.value) })}
          sx={{ fontSize: LABEL_FS, '& .MuiSelect-select': { py: 0.4 } }}>
          {[0, 15, 30, 45].map((m) => (
            <MenuItem key={m} value={m}>{String(m).padStart(2, '0')}</MenuItem>
          ))}
        </Select>
        <Select
          size="small"
          value={s.hour < 12 ? 'AM' : 'PM'}
          onChange={(e) => {
            const wasPm = s.hour >= 12;
            const willBePm = e.target.value === 'PM';
            if (wasPm === willBePm) return;
            setSched({ hour: willBePm ? s.hour + 12 : s.hour - 12 });
          }}
          sx={{ fontSize: LABEL_FS, '& .MuiSelect-select': { py: 0.4 } }}>
          <MenuItem value="AM">AM</MenuItem>
          <MenuItem value="PM">PM</MenuItem>
        </Select>
        <Typography sx={{ fontSize: HINT_FS, color: c.text.ghost, ml: 1 }}>{s.timezone === 'local' ? 'system tz' : s.timezone}</Typography>
      </Box>

      {nextPreview && s.enabled && (
        <Typography sx={{ fontSize: HINT_FS, color: c.accent.primary, pl: 2, fontWeight: 500 }}>
          Next run: {formatNextRun(nextPreview)}
        </Typography>
      )}

      {/* Row 4: end condition. */}
      <Typography sx={{ fontSize: BODY_FS, fontWeight: 700, color: c.text.primary, mt: 0.5 }}>For how long?</Typography>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, pl: 2, flexWrap: 'wrap' }}>
        <Select
          size="small"
          value={endKind}
          onChange={(e) => setEndKind(e.target.value as EndKind)}
          sx={{ fontSize: LABEL_FS, '& .MuiSelect-select': { py: 0.4 } }}>
          <MenuItem value="forever">Forever</MenuItem>
          <MenuItem value="on_date">Until a date</MenuItem>
          <MenuItem value="after_n">After N runs</MenuItem>
        </Select>
        {endKind === 'on_date' && (
          <InputBase
            type="date"
            value={s.ends_at ? s.ends_at.slice(0, 10) : ''}
            onChange={(e) => {
              const v = e.target.value;
              setSched({ ends_at: v ? new Date(v + 'T23:59:59').toISOString() : null });
            }}
            sx={{ fontSize: INPUT_FS, border: `1px solid ${c.border.subtle}`, borderRadius: `${c.radius.md}px`, px: 0.75, py: 0.4 }}
          />
        )}
        {endKind === 'after_n' && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <InputBase
              type="number"
              value={s.max_runs ?? 10}
              onChange={(e) => setSched({ max_runs: Math.max(1, Number(e.target.value) || 1) })}
              sx={{ width: 56, fontSize: INPUT_FS, border: `1px solid ${c.border.subtle}`, borderRadius: `${c.radius.md}px`, px: 0.75, py: 0.4 }}
            />
            <Typography sx={{ fontSize: HINT_FS, color: c.text.muted }}>runs ({s.runs_count} so far)</Typography>
          </Box>
        )}
      </Box>

      {/* Row 5: cost. Pass the live draft schedule so the row stays in
          sync with the "Next run" preview even before the user saves. */}
      <CostRow workflow={draft} draftSched={s} onCapChange={(v) => setDraft({ ...draft, cost_cap_usd_monthly: v })} />

      {/* Row 6: action surface (freeze). */}
      <Typography sx={{ fontSize: BODY_FS, fontWeight: 700, color: c.text.primary, mt: 0.5 }}>Which actions can the agent use?</Typography>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, pl: 2 }}>
        <Select
          size="small"
          value={draft.actions.freeze ? 'scoped' : 'full'}
          onChange={(e) => {
            const scoped = e.target.value === 'scoped';
            if (!scoped) {
              const ok = window.confirm('"Full agent access" lets this scheduled run execute Bash, edit files, and use any installed action. Are you sure?');
              if (!ok) return;
            }
            setDraft({ ...draft, actions: { ...draft.actions, freeze: scoped } });
          }}
          sx={{ fontSize: LABEL_FS, '& .MuiSelect-select': { py: 0.5 } }}>
          <MenuItem value="scoped">Scoped to actions used in original chat (recommended)</MenuItem>
          <MenuItem value="full">Full agent access (Bash, file write)</MenuItem>
        </Select>
      </Box>

      {/* Row 7: missed-run policy. */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, pl: 2, mt: 0.25 }}>
        <Typography sx={{ fontSize: HINT_FS, color: c.text.muted }}>If a run was missed (computer asleep):</Typography>
        <Select
          size="small"
          value={s.on_missed}
          onChange={(e) => setSched({ on_missed: e.target.value as ScheduleConfig['on_missed'] })}
          sx={{ fontSize: LABEL_FS, '& .MuiSelect-select': { py: 0.4 } }}>
          <MenuItem value="skip">Skip it</MenuItem>
          <MenuItem value="run_once">Run once when app reopens</MenuItem>
          <MenuItem value="run_all">Run every missed slot</MenuItem>
        </Select>
      </Box>

      {/* Row 8: permission tiers. */}
      <Typography sx={{ fontSize: BODY_FS, fontWeight: 700, color: c.text.primary, mt: 0.5 }}>How should the agent ask for your permission?</Typography>
      {(draft.permissions || []).map((tier, idx) => (
        <PermissionRow
          key={idx}
          idx={idx}
          tier={tier}
          cloudSmsEnabled={Boolean(cloudSms)}
          onChange={(patch) => setTier(idx, patch)}
          onRemove={idx === 0 ? undefined : () => removeTier(idx)}
        />
      ))}
      {canAddBackup && (
        <Box onClick={addBackup} role="button" sx={{ fontSize: LABEL_FS, color: c.text.muted, cursor: 'pointer', mt: 0.5, fontWeight: 500, '&:hover': { color: c.accent.primary } }}>+ add a backup</Box>
      )}
    </Box>
  );
}

function AppOpenStatusBadge({ info, hour, minute, onFix }: { info: AppOpenInfo; hour: number; minute: number; onFix: () => void }) {
  const c = useClaudeTokens();
  const good = info.alwaysOn;
  const fmt = formatTime(hour, minute);
  return (
    <Box sx={{
      display: 'flex', alignItems: 'center', gap: 1, pl: 0.25,
      bgcolor: good ? c.status.successBg : (c.status.warningBg || c.bg.elevated),
      border: `1px solid ${good ? c.status.success + '60' : (c.status.warning || c.text.muted) + '60'}`,
      borderRadius: `${c.radius.md}px`, px: 1, py: 0.5,
    }}>
      <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: good ? c.status.success : (c.status.warning || c.text.muted) }} />
      <Typography sx={{ flex: 1, fontSize: HINT_FS, color: c.text.primary }}>
        {good ? 'Will fire even if OpenSwarm is closed.' : `Requires OpenSwarm to be open at ${fmt}.`}
      </Typography>
      {!good && (
        <Tooltip title="Enables launch-at-login and the menubar tray so the scheduler keeps running.">
          <Box onClick={onFix} role="button" sx={{ fontSize: HINT_FS, color: c.accent.primary, cursor: 'pointer', fontWeight: 700 }}>Fix</Box>
        </Tooltip>
      )}
    </Box>
  );
}

function CostRow({ workflow, draftSched, onCapChange }: { workflow: Workflow; draftSched: ScheduleConfig; onCapChange: (v: number | null) => void }) {
  const c = useClaudeTokens();
  const est = workflow.cost_estimate;
  // Compute fires/30-days live from the draft so the row matches the
  // "Next run" preview even before the user saves. Backend's cached
  // estimate is the saved-state value and would lie after a draft edit.
  const liveFires = useMemo(() => {
    if (!draftSched.enabled) return 0;
    const now = new Date();
    const end = new Date(now.getTime() + 30 * 86400000);
    return fireTimesWithin({ schedule: draftSched } as Workflow, now, end, 200).length;
  }, [draftSched]);
  const lastRun = est?.last_run_usd ?? 0;
  const monthly = lastRun * liveFires;
  const cap = workflow.cost_cap_usd_monthly;
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.4, pl: 2 }}>
      <Typography sx={{ fontSize: HINT_FS, color: c.text.muted }}>
        {liveFires > 0 && lastRun > 0
          ? `~$${monthly.toFixed(2)}/mo at last run's cost ($${lastRun.toFixed(4)} × ${liveFires} fires).`
          : liveFires > 0
            ? `Will fire ${liveFires}× in the next 30 days. Run once to project a monthly cost.`
            : 'No upcoming runs.'}
      </Typography>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
        <Typography sx={{ fontSize: HINT_FS, color: c.text.muted }}>Monthly cost cap:</Typography>
        <InputBase
          type="number"
          placeholder="none"
          value={cap == null ? '' : cap}
          onChange={(e) => onCapChange(e.target.value === '' ? null : Math.max(0, Number(e.target.value)))}
          sx={{ width: 72, fontSize: INPUT_FS, border: `1px solid ${c.border.subtle}`, borderRadius: `${c.radius.md}px`, px: 0.75, py: 0.3 }}
        />
        <Typography sx={{ fontSize: HINT_FS, color: c.text.ghost }}>USD. Skips runs once exceeded; visible in History.</Typography>
      </Box>
    </Box>
  );
}

function PermissionRow({ idx, tier, cloudSmsEnabled, onChange, onRemove }: {
  idx: number;
  tier: PermissionTier;
  cloudSmsEnabled: boolean;
  onChange: (p: Partial<PermissionTier>) => void;
  onRemove?: () => void;
}) {
  const c = useClaudeTokens();
  if (idx === 0) {
    return (
      <Select
        size="small"
        value="notify"
        sx={{ alignSelf: 'flex-start', fontSize: LABEL_FS, '& .MuiSelect-select': { py: 0.5 } }}>
        <MenuItem value="notify">Notify me in Open Swarm</MenuItem>
      </Select>
    );
  }
  const unitLabel = tier.kind === 'call' ? 'hour' : 'minutes';
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, pl: 2, position: 'relative' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap' }}>
        <Typography sx={{ fontSize: HINT_FS, color: c.text.muted }}>↳ and if I don&apos;t respond after</Typography>
        <InputBase
          type="number"
          value={tier.after_minutes}
          onChange={(e) => onChange({ after_minutes: Math.max(0, Number(e.target.value) || 0) })}
          sx={{ width: 44, fontSize: INPUT_FS, border: `1px solid ${c.border.subtle}`, borderRadius: `${c.radius.md}px`, px: 0.75, py: 0.4 }}
        />
        <Typography sx={{ fontSize: HINT_FS, color: c.text.muted }}>{unitLabel}</Typography>
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
        <Select
          size="small"
          value={tier.kind}
          onChange={(e) => onChange({ kind: e.target.value as PermissionTier['kind'] })}
          sx={{ fontSize: LABEL_FS, '& .MuiSelect-select': { py: 0.5 } }}>
          {tier.kind !== 'call' && <MenuItem value="text">Text me</MenuItem>}
          {tier.kind === 'call' && <MenuItem value="call">Call me</MenuItem>}
        </Select>
        <Typography sx={{ fontSize: HINT_FS, color: c.text.muted }}>at this number</Typography>
        <InputBase
          value={tier.phone || ''}
          placeholder="+1 (000) 123 4567"
          onChange={(e) => onChange({ phone: e.target.value })}
          sx={{ flex: 1, fontSize: INPUT_FS, border: `1px solid ${c.border.subtle}`, borderRadius: `${c.radius.md}px`, px: 0.75, py: 0.4, color: c.text.primary }}
        />
        {onRemove && (
          <Box onClick={onRemove} role="button" sx={{ fontSize: HINT_FS, color: c.text.ghost, cursor: 'pointer', px: 0.5, '&:hover': { color: c.status.error } }}>×</Box>
        )}
      </Box>
      {!cloudSmsEnabled && (
        <Typography sx={{ fontSize: HINT_FS, color: c.status.warning || c.text.muted, fontStyle: 'italic' }}>
          Coming soon. Until cloud SMS ships, this tier falls back to an in-app notify with a "fallback" badge.
        </Typography>
      )}
    </Box>
  );
}
