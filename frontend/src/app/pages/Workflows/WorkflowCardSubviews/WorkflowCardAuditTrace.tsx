import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Popover from '@mui/material/Popover';
import Tooltip from '@mui/material/Tooltip';
import HistoryIcon from '@mui/icons-material/HistoryToggleOffRounded';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';

// Audit-trace popover. Lazy-fetches the last N edits from /workflows/{id}/audit on open, renders a compact list. The trigger sits inline with the chip row so power users can spot it without cluttering the title.
function AuditTraceLink({ workflowId }: { workflowId: string }) {
  const c = useClaudeTokens();
  const { t } = useTranslation();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [entries, setEntries] = useState<Array<{ ts: string; who: string; diff: Record<string, { before: unknown; after: unknown }> }> | null>(null);
  const [loading, setLoading] = useState(false);
  // Probe the audit log once on mount so we can hide the trigger entirely when there are no edits (item #21 in target #54 diff). Fire-and-forget; a failure leaves entries=null which renders nothing.
  React.useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { API_BASE, getAuthToken } = await import('@/shared/config');
        const tok = (() => { try { return getAuthToken(); } catch { return ''; } })();
        const res = await fetch(`${API_BASE}/workflows/${encodeURIComponent(workflowId)}/audit?limit=5`, {
          headers: tok ? { Authorization: `Bearer ${tok}` } : {},
        });
        const data = await res.json();
        if (alive) setEntries(Array.isArray(data?.entries) ? data.entries : []);
      } catch {
        if (alive) setEntries([]);
      }
    })();
    return () => { alive = false; };
  }, [workflowId]);
  // The popover open handler must be declared BEFORE the conditional return below; otherwise React sees a different hook-count between the "loading" render (returns early) and the "loaded with entries" render (calls useCallback), which triggers the "Rendered more hooks than during the previous render" crash.
  const open = useCallback(async (e: React.MouseEvent<HTMLDivElement>) => {
    setAnchor(e.currentTarget);
    if (entries !== null) return;
    setLoading(true);
    try {
      const { API_BASE, getAuthToken } = await import('@/shared/config');
      const tok = (() => { try { return getAuthToken(); } catch { return ''; } })();
      const res = await fetch(`${API_BASE}/workflows/${encodeURIComponent(workflowId)}/audit?limit=5`, {
        headers: tok ? { Authorization: `Bearer ${tok}` } : {},
      });
      const data = await res.json();
      setEntries(Array.isArray(data?.entries) ? data.entries : []);
    } catch {
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [entries, workflowId]);
  // Hide entirely until we know whether there are edits to surface.
  if (entries === null || entries.length === 0) return null;
  const close = () => setAnchor(null);
  const count = entries?.length ?? 0;
  return (
    <>
      <Tooltip title={t('workflows.subviews.audit.tooltip')}>
        <Box onClick={open} role="button" sx={{
          display: 'inline-flex', alignItems: 'center', gap: 0.3,
          fontSize: '0.7rem', color: c.text.muted, cursor: 'pointer',
          px: 0.5, py: 0.25, borderRadius: c.radius.sm,
          '&:hover': { color: c.accent.primary, bgcolor: c.bg.elevated },
        }}>
          <HistoryIcon sx={{ fontSize: 12 }} />
          {t('workflows.subviews.audit.editCount', { count })}
        </Box>
      </Tooltip>
      <Popover
        open={Boolean(anchor)}
        anchorEl={anchor}
        onClose={close}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}>
        <Box sx={{ minWidth: 280, maxWidth: 360, p: 1 }}>
          <Typography sx={{ fontSize: '0.7rem', fontWeight: 700, color: c.text.muted, letterSpacing: '0.06em', mb: 0.5 }}>
            {t('workflows.subviews.audit.heading')}
          </Typography>
          {loading && <Typography sx={{ fontSize: '0.78rem', color: c.text.muted }}>{t('workflows.subviews.loading')}</Typography>}
          {!loading && (entries === null || entries.length === 0) && (
            <Typography sx={{ fontSize: '0.78rem', color: c.text.muted }}>{t('workflows.subviews.audit.empty')}</Typography>
          )}
          {!loading && entries && entries.map((e, idx) => {
            const fields = Object.keys(e.diff || {}).filter((k) => k !== 'updated_at');
            const summary = fields.length === 0
              ? t('workflows.subviews.audit.noFieldChanges')
              : fields.length > 3
                ? t('workflows.subviews.audit.fieldsMore', { fields: fields.slice(0, 3).join(', '), count: fields.length - 3 })
                : fields.slice(0, 3).join(', ');
            return (
              <Box key={idx} sx={{ display: 'flex', flexDirection: 'column', py: 0.5, borderTop: idx === 0 ? 'none' : `1px solid ${c.border.subtle}` }}>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Typography sx={{ fontSize: '0.78rem', color: c.text.primary, fontWeight: 600 }}>{e.who || t('workflows.subviews.audit.userFallback')}</Typography>
                  <Typography sx={{ fontSize: '0.7rem', color: c.text.ghost }}>{relTimeShort(e.ts, t)}</Typography>
                </Box>
                <Typography sx={{ fontSize: '0.74rem', color: c.text.secondary }}>{summary}</Typography>
              </Box>
            );
          })}
        </Box>
      </Popover>
    </>
  );
}

function relTimeShort(iso: string, t: TFunction): string {
  try {
    const ms = Date.now() - new Date(iso).getTime();
    if (ms < 60000) return t('workflows.relTime.justNow');
    const m = Math.floor(ms / 60000);
    if (m < 60) return t('workflows.relTime.minutes', { count: m });
    const h = Math.floor(m / 60);
    if (h < 24) return t('workflows.relTime.hours', { count: h });
    const d = Math.floor(h / 24);
    return t('workflows.relTime.days', { count: d });
  } catch { return ''; }
}
