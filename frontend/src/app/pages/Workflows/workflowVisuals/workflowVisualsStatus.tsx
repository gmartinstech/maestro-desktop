import React from 'react';
import i18n from '@/shared/i18n/i18n';
import Box from '@mui/material/Box';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import type { Workflow, WorkflowRun } from '@/shared/state/workflowsSlice';

// ---------- Title placeholders ----------

// Placeholder titles the backend uses before auto-naming kicks in. The title Typewriter only animates once the title is a real (generated/user) name, so the UI doesn't animate on mount or while still showing a placeholder.
const PLACEHOLDER_TITLES = new Set(['', 'New workflow', 'Untitled workflow', 'Scheduled workflow']);
export function isRealTitle(title?: string | null): boolean {
  return !!title && !PLACEHOLDER_TITLES.has(title.trim());
}

// ---------- Status colors ----------

export type LastRunStatus = NonNullable<Workflow['last_run_status']>;

export function statusDotColor(status: LastRunStatus | null | undefined, c: ReturnType<typeof useClaudeTokens>) {
  switch (status) {
    case 'success': return c.status.success;
    case 'ran_late': return c.status.warning;
    case 'failure': return c.status.error;
    case 'running': return c.accent.primary;
    case 'skipped': return c.text.muted;
    default: return c.text.ghost;
  }
}

// Human-readable status word. We surface "ran late" instead of the underscore-y "ran_late" everywhere it'd be visible to a user.
const STATUS_WORD_KEYS: Record<LastRunStatus, string> = {
  success: 'workflows.status.success',
  failure: 'workflows.status.failure',
  ran_late: 'workflows.status.ranLate',
  running: 'workflows.status.running',
  skipped: 'workflows.status.skipped',
};

export function statusWord(status: LastRunStatus | null | undefined): string {
  if (!status) return i18n.t('workflows.status.neverRun');
  return i18n.t(STATUS_WORD_KEYS[status]);
}

// Status pill rendered next to the title. Bigger than the previous 9px dot and pairs the color with a short word so a non-dev knows what they're looking at instead of squinting at a single grey pixel.
export function StatusDot({ status }: { status: LastRunStatus | null | undefined }) {
  const c = useClaudeTokens();
  const word = statusWord(status);
  const dotColor = statusDotColor(status, c);
  return (
    <Tooltip title={status ? `Last run: ${word.toLowerCase()}` : 'This workflow has never run.'}>
      <Box sx={{
        display: 'inline-flex', alignItems: 'center', gap: 0.4,
        height: 18, px: 0.75, borderRadius: c.radius.full,
        bgcolor: status === 'failure' ? c.status.errorBg : status === 'ran_late' ? c.status.warningBg : status === 'success' ? c.status.successBg : c.bg.elevated,
        border: `1px solid ${dotColor}55`,
        flexShrink: 0,
      }}>
        <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: dotColor, boxShadow: status === 'failure' ? `0 0 4px ${c.status.error}` : 'none' }} />
        <Typography sx={{ fontSize: '0.66rem', fontWeight: 700, color: dotColor, letterSpacing: '0.02em' }}>
          {word}
        </Typography>
      </Box>
    </Tooltip>
  );
}

// ---------- Run history sparkline ----------

// 10-dot horizontal strip of last N runs colored by status. Easy "lately healthy?" check without opening the History tab.
export function RunSparkline({ runs, max = 10 }: { runs: WorkflowRun[]; max?: number }) {
  const c = useClaudeTokens();
  if (!runs || runs.length === 0) return null;
  const slice = runs.slice(0, max).reverse();
  const successes = slice.filter((r) => r.status === 'success').length;
  const failures = slice.filter((r) => r.status === 'failure').length;
  const tooltip = `Last ${slice.length} run${slice.length === 1 ? '' : 's'}: ${successes} successful, ${failures} failed`;
  return (
    <Tooltip title={tooltip}>
      <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.3, ml: 0.5 }}>
        {slice.map((r) => (
          <Box key={r.id} sx={{
            width: 6, height: 6, borderRadius: '50%',
            bgcolor: statusDotColor(r.status as LastRunStatus, c),
          }} />
        ))}
      </Box>
    </Tooltip>
  );
}

// ---------- Streak badge ----------

// Count consecutive successful runs at the head of the runs list. `runs[0]` is the most recent run, so we walk forward until we hit a non-success. Returns 0 when no streak is active.
export function successStreak(runs: WorkflowRun[] | undefined): number {
  if (!runs || runs.length === 0) return 0;
  let n = 0;
  for (const r of runs) {
    if (r.status === 'success' || r.status === 'ran_late') n += 1;
    else break;
  }
  return n;
}

export function StreakBadge({ runs }: { runs: WorkflowRun[] | undefined }) {
  const c = useClaudeTokens();
  const n = successStreak(runs);
  if (n < 3) return null;
  return (
    <Tooltip title={`${n} successful runs in a row.`}>
      <Box sx={{
        display: 'inline-flex', alignItems: 'center', gap: 0.3,
        fontSize: '0.72rem', fontWeight: 700,
        color: c.status.success,
        bgcolor: c.status.successBg,
        border: `1px solid ${c.status.success + '60'}`,
        px: 0.75, py: 0.3, borderRadius: c.radius.full,
      }}>
        🔥 {n}
      </Box>
    </Tooltip>
  );
}
