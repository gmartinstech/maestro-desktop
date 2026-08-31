import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import Box from '@mui/material/Box';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import Popover from '@mui/material/Popover';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import { useAppDispatch } from '@/shared/hooks';
import { updateWorkflow } from '@/shared/state/workflowsSlice';
import NotificationsIcon from '@mui/icons-material/NotificationsRounded';
import SmsIcon from '@mui/icons-material/SmsRounded';
import PhoneInTalkIcon from '@mui/icons-material/PhoneInTalkRounded';
import ScheduleIcon from '@mui/icons-material/ScheduleRounded';
import AttachMoneyIcon from '@mui/icons-material/AttachMoneyRounded';
import AllInclusiveIcon from '@mui/icons-material/AllInclusiveRounded';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import type { Workflow, PermissionTier } from '@/shared/state/workflowsSlice';
import { describeScheduleShort, weekdayNames, isScheduleConfigured } from '@/app/pages/Workflows/schedule/scheduleUtils';

// ---------- Pill chips ----------

// Weekday-dot strip ("S M T W T F S" in en, "D S T Q Q S S" in pt-BR) with active days filled. Rendered inline next to the chip when the schedule is weekly so users can pattern-match days without parsing prose. Active = filled accent dot.
export function WeekdayDots({ on_days }: { on_days: number[] }) {
  const c = useClaudeTokens();
  const { i18n } = useTranslation();
  return (
    <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.35, ml: 0.5 }}>
      {weekdayNames(i18n.language, 'narrow').map((lbl, idx) => {
        const active = on_days.includes(idx);
        return (
          <Box key={`${lbl}-${idx}`} sx={{
            width: 12, height: 12, borderRadius: '50%',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '0.6rem', fontWeight: 700,
            color: active ? '#fff' : c.text.ghost,
            bgcolor: active ? c.accent.primary : 'transparent',
            border: `1px solid ${active ? c.accent.primary : c.border.subtle}`,
            lineHeight: 1,
          }}>
            {lbl}
          </Box>
        );
      })}
    </Box>
  );
}

function permIcon(kind: PermissionTier['kind'], size = 13) {
  if (kind === 'text') return <SmsIcon sx={{ fontSize: size }} />;
  if (kind === 'call') return <PhoneInTalkIcon sx={{ fontSize: size }} />;
  return <NotificationsIcon sx={{ fontSize: size }} />;
}

// Compact "🔔 → 💬 → 📞" representation of the escalation chain. Hover shows the literal prose (notify, text, call, with delays).
export function PermissionChip({ workflow }: { workflow: Workflow }) {
  const c = useClaudeTokens();
  const tiers = workflow.permissions || [];
  if (tiers.length === 0) return null;
  const label = tiers.map((t) => {
    if (t.kind === 'notify') return 'notify in app';
    const unit = t.kind === 'call' ? 'h' : 'm';
    return `${t.kind} after ${t.after_minutes}${unit}`;
  }).join(' → ');
  return (
    <Tooltip title={label}>
      <Box sx={{
        display: 'inline-flex', alignItems: 'center', gap: 0.35,
        fontSize: '0.74rem', fontWeight: 500,
        color: c.text.secondary,
        bgcolor: c.bg.elevated,
        border: `1px solid ${c.border.subtle}`,
        px: 0.75, py: 0.3, borderRadius: c.radius.full,
      }}>
        {tiers.map((t, i) => (
          <React.Fragment key={i}>
            {permIcon(t.kind)}
            {i < tiers.length - 1 && <Box sx={{ fontSize: '0.7rem', color: c.text.ghost, mx: 0.1 }}>→</Box>}
          </React.Fragment>
        ))}
      </Box>
    </Tooltip>
  );
}

export function ScheduleChip({ workflow }: { workflow: Workflow }) {
  const c = useClaudeTokens();
  const { t, i18n } = useTranslation();
  const dispatch = useAppDispatch();
  const enabled = workflow.schedule.enabled && isScheduleConfigured(workflow.schedule);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  // Inline edit: time + AM/PM only. Anything richer should open the full editor. Saves on change with optimistic updated_at If-Match.
  const sched = workflow.schedule;
  const patchSched = (patch: Partial<typeof sched>) => {
    const next = { ...sched, ...patch };
    dispatch(updateWorkflow({
      id: workflow.id,
      patch: { schedule: next as any },
      ifMatch: workflow.updated_at || null,
    }));
  };
  return (
    <>
      <Tooltip title={enabled ? t('workflows.scheduleChip.tweakHint') : t('workflows.schedule.notScheduled')}>
        <Box
          onClick={(e) => enabled && setAnchor(e.currentTarget as HTMLElement)}
          role={enabled ? 'button' : undefined}
          sx={{
            display: 'inline-flex', alignItems: 'center', gap: 0.4,
            fontSize: '0.74rem', fontWeight: 600,
            color: enabled ? c.accent.primary : c.text.muted,
            bgcolor: enabled ? c.accent.primary + '14' : c.bg.elevated,
            border: `1px solid ${enabled ? c.accent.primary + '40' : c.border.subtle}`,
            px: 0.75, py: 0.3, borderRadius: c.radius.full,
            cursor: enabled ? 'pointer' : 'default',
            '&:hover': enabled ? { bgcolor: c.accent.primary + '22' } : undefined,
          }}>
          <ScheduleIcon sx={{ fontSize: 13 }} />
          {describeScheduleShort(workflow.schedule, t, i18n.language)}
          {enabled && workflow.schedule.repeat_unit === 'week' && (
            <WeekdayDots on_days={workflow.schedule.on_days} />
          )}
        </Box>
      </Tooltip>
      <Popover
        open={Boolean(anchor)}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}>
        <Box sx={{ p: 1, display: 'flex', flexDirection: 'column', gap: 0.5, minWidth: 220 }}>
          <Typography sx={{ fontSize: '0.7rem', fontWeight: 700, color: c.text.muted, letterSpacing: '0.06em' }}>
            {t('workflows.scheduleChip.quickTimeEdit')}
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Select
              size="small"
              value={((sched.hour + 11) % 12) + 1}
              onChange={(e) => {
                const h12 = Number(e.target.value);
                const isPm = sched.hour >= 12;
                patchSched({ hour: (h12 % 12) + (isPm ? 12 : 0) });
              }}
              sx={{ fontSize: '0.78rem', '& .MuiSelect-select': { py: 0.4 } }}>
              {Array.from({ length: 12 }, (_, i) => i + 1).map((h) => (
                <MenuItem key={h} value={h}>{h}</MenuItem>
              ))}
            </Select>
            <Typography sx={{ fontSize: '0.85rem' }}>:</Typography>
            <Select
              size="small"
              value={sched.minute}
              onChange={(e) => patchSched({ minute: Number(e.target.value) })}
              sx={{ fontSize: '0.78rem', '& .MuiSelect-select': { py: 0.4 } }}>
              {[0, 15, 30, 45].map((m) => (
                <MenuItem key={m} value={m}>{String(m).padStart(2, '0')}</MenuItem>
              ))}
            </Select>
            <Select
              size="small"
              value={sched.hour < 12 ? 'AM' : 'PM'}
              onChange={(e) => {
                const wasPm = sched.hour >= 12;
                const willBePm = e.target.value === 'PM';
                if (wasPm === willBePm) return;
                patchSched({ hour: willBePm ? sched.hour + 12 : sched.hour - 12 });
              }}
              sx={{ fontSize: '0.78rem', '& .MuiSelect-select': { py: 0.4 } }}>
              <MenuItem value="AM">AM</MenuItem>
              <MenuItem value="PM">PM</MenuItem>
            </Select>
          </Box>
          <Typography sx={{ fontSize: '0.68rem', color: c.text.ghost, mt: 0.25 }}>
            {t('workflows.scheduleChip.savedAsYouChange')}
          </Typography>
        </Box>
      </Popover>
    </>
  );
}

// Classify a workflow's billing route based on its model id + the user's global connection mode. Mirrors the per-session logic in AgentChat so the workflow card tells the same story the chat header does. Returns 'metered' when the user pays per call (Anthropic/OpenAI/Gemini API keys, custom OpenAI-compatible) or 'subscription' when a flat-rate account is doing the work (Claude Pro/Max, ChatGPT Plus/Pro, Gemini Advanced, Maestro Pro proxy). `subLabel` names the plan for tooltips.
export type RoutingKind = 'metered' | 'subscription';
export interface Routing {
  kind: RoutingKind;
  subLabel?: string;
}

export function routingFor(model: string): Routing {
  const m = (model || '').toLowerCase();
  if (m.endsWith('-api')) return { kind: 'metered' };
  if (m.endsWith('-cc')) return { kind: 'subscription', subLabel: 'Claude Pro/Max' };
  if (m === 'sonnet' || m === 'opus' || m === 'haiku') return { kind: 'metered' };
  if (m.startsWith('gpt-5') || m.startsWith('gpt-4') || m.startsWith('o1') || m.startsWith('o3') || m.startsWith('o4')) {
    return { kind: 'subscription', subLabel: 'ChatGPT Plus/Pro' };
  }
  if (m.startsWith('gemini-')) {
    return { kind: 'subscription', subLabel: 'Gemini Advanced' };
  }
  // Unknown model id, default to metered so we don't oversell "free."
  return { kind: 'metered' };
}

export function CostChip({ workflow }: { workflow: Workflow }) {
  const c = useClaudeTokens();
  const est = workflow.cost_estimate;
  const route = routingFor(workflow.model);

  // Subscription-routed workflows have no metered per-call cost. Surface a usage chip instead so the user knows runs are "free" under their existing plan but still sees the projected fire frequency.
  if (route.kind === 'subscription') {
    if (!est || est.fires_per_month === 0) {
      return (
        <Tooltip title={`Runs are covered by your ${route.subLabel} plan. No upcoming runs scheduled.`}>
          <Box sx={chipSx(c)}>
            <AllInclusiveIcon sx={{ fontSize: 12 }} />
            {route.subLabel || 'Subscription'}
          </Box>
        </Tooltip>
      );
    }
    return (
      <Tooltip title={`Routed through your ${route.subLabel} plan; no per-run cost. About ${est.fires_per_month} runs per month at the current schedule.`}>
        <Box sx={chipSx(c)}>
          <AllInclusiveIcon sx={{ fontSize: 12 }} />
          ~{est.fires_per_month} runs/mo
        </Box>
      </Tooltip>
    );
  }

  // Metered route: only render the cost chip once we actually have a last-run figure to project from. Avoids "$0.00/mo" gaslighting.
  if (!est || est.fires_per_month === 0 || est.last_run_usd <= 0) return null;
  const monthly = est.monthly_usd || 0;
  return (
    <Tooltip title={`About $${est.last_run_usd.toFixed(4)} per run, times ${est.fires_per_month} runs per month.`}>
      <Box sx={chipSx(c)}>
        <AttachMoneyIcon sx={{ fontSize: 12, ml: -0.25 }} />
        {monthly < 0.01 ? '<0.01' : monthly.toFixed(2)}/mo
      </Box>
    </Tooltip>
  );
}

function chipSx(c: ReturnType<typeof useClaudeTokens>) {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 0.3,
    fontSize: '0.74rem', fontWeight: 600,
    color: c.text.secondary,
    bgcolor: c.bg.elevated,
    border: `1px solid ${c.border.subtle}`,
    px: 0.75, py: 0.3, borderRadius: c.radius.full,
  } as const;
}

// Compact "last fired" mini-label, used inside the Run-tab summary.
export function LastFiredHint({ workflow }: { workflow: Workflow }) {
  const c = useClaudeTokens();
  if (!workflow.last_run_at) return null;
  const ms = Date.now() - new Date(workflow.last_run_at).getTime();
  const ago = relTime(ms);
  return (
    <Typography sx={{ fontSize: '0.72rem', color: c.text.ghost }}>Last ran {ago}</Typography>
  );
}

function relTime(ms: number): string {
  if (ms < 0) return 'just now';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  return `${mo}mo ago`;
}
