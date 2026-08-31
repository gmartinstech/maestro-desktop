import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import type { WorkflowRun } from '@/shared/state/workflowsSlice';
import { humanDuration } from '../workflowVisuals';
import { formatRunDate, labelForStatus, statusBg, statusColor } from './WorkflowCardSubviewsShared';

function runDuration(r: WorkflowRun): string | null {
  if (!r.finished_at) return null;
  try {
    const ms = new Date(r.finished_at).getTime() - new Date(r.started_at).getTime();
    if (ms <= 0) return null;
    return humanDuration(ms);
  } catch { return null; }
}

// Groups runs into "This week / Last week / Month YYYY" buckets so a long history list reads as eras rather than 50 same-looking dates.
function groupKey(iso: string, t: TFunction, locale: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    const day = 24 * 3600 * 1000;
    const startOfWeek = (x: Date) => { const y = new Date(x); y.setHours(0, 0, 0, 0); y.setDate(y.getDate() - y.getDay()); return y; };
    const thisWeekStart = startOfWeek(now).getTime();
    const lastWeekStart = thisWeekStart - 7 * day;
    if (d.getTime() >= thisWeekStart) return t('workflows.subviews.history.thisWeek');
    if (d.getTime() >= lastWeekStart) return t('workflows.subviews.history.lastWeek');
    return d.toLocaleString(locale, { month: 'long', year: 'numeric' });
  } catch { return t('workflows.subviews.history.earlier'); }
}

export function HistoryList({ runs, onOpen, showWorkflow = false, workflowTitleFor }: { runs: WorkflowRun[]; onOpen: (r: WorkflowRun) => void; showWorkflow?: boolean; workflowTitleFor?: (workflowId: string) => string }) {
  const c = useClaudeTokens();
  const { t, i18n } = useTranslation();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // Filter chips: all / success / failures / skipped. Power-users debugging a flaky workflow shouldn't have to scroll past the runs they don't care about.
  const [filter, setFilter] = useState<'all' | 'success' | 'failure' | 'skipped'>('all');
  const filtered = useMemo(() => {
    if (filter === 'all') return runs;
    return (runs || []).filter((r) => r.status === filter);
  }, [runs, filter]);
  const groups = useMemo(() => {
    const out: Array<{ key: string; runs: WorkflowRun[] }> = [];
    for (const r of filtered || []) {
      const k = groupKey(r.started_at, t, i18n.language);
      const last = out[out.length - 1];
      if (last && last.key === k) last.runs.push(r);
      else out.push({ key: k, runs: [r] });
    }
    return out;
  }, [filtered, t, i18n.language]);
  if (!runs || runs.length === 0) {
    return <Typography sx={{ fontSize: '0.88rem', color: c.text.muted, py: 1.5, textAlign: 'center' }}>{t('workflows.subviews.history.noRuns')}</Typography>;
  }
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.75 }}>
        {groups.length > 0 && (
          <Typography sx={{ fontSize: '0.7rem', fontWeight: 700, color: c.text.muted, letterSpacing: '0.06em' }}>
            {groups[0].key.toUpperCase()}
          </Typography>
        )}
        <Box sx={{ flex: 1 }} />
        {(['all', 'success', 'failure', 'skipped'] as const).map((k) => (
          <Box key={k} onClick={() => setFilter(k)} role="button" sx={{
            fontSize: '0.72rem', fontWeight: 600,
            color: filter === k ? c.accent.primary : c.text.muted,
            bgcolor: filter === k ? c.accent.primary + '14' : 'transparent',
            border: `1px solid ${filter === k ? c.accent.primary + '40' : c.border.subtle}`,
            px: 0.75, py: 0.3, borderRadius: c.radius.full, cursor: 'pointer',
            '&:hover': { color: c.accent.primary },
          }}>
            {t(`workflows.subviews.history.filter.${k}`)}
          </Box>
        ))}
      </Box>
      {groups.map(({ key, runs: gRuns }, gi) => (
        <Box key={key} sx={{ display: 'flex', flexDirection: 'column' }}>
          {gi > 0 && (
            <Typography sx={{ fontSize: '0.7rem', fontWeight: 700, color: c.text.muted, letterSpacing: '0.06em', mt: 0.5, mb: 0.25 }}>
              {key.toUpperCase()}
            </Typography>
          )}
          {gRuns.map((r) => {
            const expanded = expandedId === r.id;
            const dur = runDuration(r);
            return (
              <Box key={r.id}>
                <Box
                  onClick={() => setExpandedId(expanded ? null : r.id)}
                  sx={{ display: 'flex', alignItems: 'center', gap: 1.25, py: 0.6, px: 0.5, cursor: 'pointer', borderRadius: c.radius.sm, '&:hover': { bgcolor: c.bg.elevated } }}>
                  <Box sx={{ fontSize: '0.72rem', fontWeight: 700, color: statusColor(r.status, c), bgcolor: statusBg(r.status, c), px: 0.8, py: 0.3, borderRadius: c.radius.sm, minWidth: 64, textAlign: 'center' }}>
                    {labelForStatus(r.status, t)}
                  </Box>
                  {showWorkflow && workflowTitleFor ? (
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography sx={{ fontSize: '0.84rem', fontWeight: 600, color: c.text.primary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{workflowTitleFor(r.workflow_id)}</Typography>
                      <Typography sx={{ fontSize: '0.72rem', color: c.text.ghost }}>{formatRunDate(r.started_at, i18n.language)}</Typography>
                    </Box>
                  ) : (
                    <Typography sx={{ fontSize: '0.88rem', color: c.text.primary, flex: 1 }}>{formatRunDate(r.started_at, i18n.language)}</Typography>
                  )}
                  {dur && <Typography sx={{ fontSize: '0.74rem', color: c.text.ghost }}>{dur}</Typography>}
                  {r.cost_usd > 0 && <Typography sx={{ fontSize: '0.74rem', color: c.text.ghost }}>${r.cost_usd.toFixed(4)}</Typography>}
                  {/* Chevron makes the row read as expandable instead of
                      static text. Rotates 180° while open so the affordance
                      stays visible after click. */}
                  <Box sx={{ fontSize: '0.7rem', color: c.text.ghost, transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s ease' }}>▾</Box>
                </Box>
                {expanded && (
                  <Box sx={{ ml: 8, mt: 0.25, mb: 0.75, px: 1, py: 0.75, bgcolor: c.bg.elevated, borderRadius: c.radius.sm, border: `1px solid ${c.border.subtle}`, display: 'flex', alignItems: 'center' }}>

                    {r.error ? (
                      <Typography sx={{ fontSize: '0.78rem', color: c.status.error, lineHeight: 1.4 }}>{r.error}</Typography>
                    ) : r.session_id ? (
                      <Box onClick={(e) => { e.stopPropagation(); onOpen(r); }} role="button" sx={{ fontSize: '0.78rem', fontWeight: 600, color: c.accent.primary, cursor: 'pointer', '&:hover': { textDecoration: 'underline' } }}>
                        {t('workflows.subviews.history.openConversation')}
                      </Box>
                    ) : (
                      <Typography sx={{ fontSize: '0.78rem', color: c.text.muted, lineHeight: 1.4 }}>{t('workflows.subviews.history.noSession')}</Typography>
                    )}
                  </Box>
                )}
              </Box>
            );
          })}
        </Box>
      ))}
    </Box>
  );
}

export function HistoryDetail({ run, onBack }: { run: WorkflowRun | null; onBack: () => void }) {
  const c = useClaudeTokens();
  const { t, i18n } = useTranslation();
  if (!run) return <Typography sx={{ fontSize: '0.88rem', color: c.text.muted }}>{t('workflows.subviews.detail.notFound')}</Typography>;
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Box onClick={onBack} role="button" sx={{ fontSize: '0.82rem', color: c.text.muted, cursor: 'pointer', '&:hover': { color: c.accent.primary } }}>{t('workflows.subviews.detail.back')}</Box>
        <Box sx={{ fontSize: '0.72rem', fontWeight: 700, color: statusColor(run.status, c), bgcolor: statusBg(run.status, c), px: 0.8, py: 0.3, borderRadius: c.radius.sm }}>{labelForStatus(run.status, t)}</Box>
        <Typography sx={{ fontSize: '0.88rem', color: c.text.primary, fontWeight: 600 }}>{formatRunDate(run.started_at, i18n.language)}</Typography>
      </Box>
      {run.error && (
        <Typography sx={{ fontSize: '0.85rem', color: c.status.error, bgcolor: c.status.errorBg, p: 1, borderRadius: c.radius.sm }}>{run.error}</Typography>
      )}
      <Typography sx={{ fontSize: '0.85rem', color: c.text.secondary, lineHeight: 1.5 }}>
        {t('workflows.subviews.detail.startedFinished', {
          started: formatRunDate(run.started_at, i18n.language),
          finished: run.finished_at ? formatRunDate(run.finished_at, i18n.language) : t('workflows.subviews.detail.inProgress'),
        })}
      </Typography>
      {run.session_id && (
        <Box sx={{ fontSize: '0.82rem', color: c.accent.primary, mt: 0.5 }}>{t('workflows.subviews.detail.session', { id: run.session_id.slice(0, 8) })}</Box>
      )}
    </Box>
  );
}
