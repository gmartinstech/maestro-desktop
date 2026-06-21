import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Dialog from '@mui/material/Dialog';
import { useAppDispatch, useAppSelector } from '@/shared/hooks';
import { closeWorkflowsApp, clearWorkflowsAppTarget } from '@/shared/state/dashboardLayoutSlice';
import {
  fetchWorkflows, fetchAllRuns, fetchPausedState, fetchActiveRuns,
} from '@/shared/state/workflowsSlice';
import { fetchMissedRuns } from '@/shared/state/missedRunsSlice';
import { WC, FONT_SANS } from './uiKit';
import type { AppMode, CalView, AppNav } from './types';
import LeftRail from './LeftRail';
import HomeView from './HomeView';
import CalendarView from './CalendarView';
import DetailView from './DetailView';
import ComposeView from './ComposeView';

const FONTS_HREF = 'https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;1,6..72,400&family=Hanken+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap';

// The design leans on three webfonts plus a spinner keyframe. Inject both once,
// lazily, so the rest of the app never pays for them unless the window opens.
function ensureAssets(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById('workflows-app-fonts')) return;
  const link = document.createElement('link');
  link.id = 'workflows-app-fonts';
  link.rel = 'stylesheet';
  link.href = FONTS_HREF;
  document.head.appendChild(link);
  const style = document.createElement('style');
  style.id = 'workflows-app-keyframes';
  style.textContent = '@keyframes os-spin { to { transform: rotate(360deg); } }';
  document.head.appendChild(style);
}

const WorkflowsApp: React.FC = () => {
  const dispatch = useAppDispatch();
  const open = useAppSelector((s) => s.dashboardLayout.workflowsAppOpen);
  const target = useAppSelector((s) => s.dashboardLayout.workflowsAppTarget);
  const dashboardId = useAppSelector((s) => s.tempState.lastDashboardId) || undefined;

  const [mode, setMode] = useState<AppMode>('home');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [calView, setCalView] = useState<CalView>('month');
  const [refDate, setRefDate] = useState<Date>(() => new Date());

  useEffect(() => { if (open) ensureAssets(); }, [open]);

  // Pull every surface's data the moment the window opens; the thunks dedupe.
  useEffect(() => {
    if (!open) return;
    dispatch(fetchWorkflows(dashboardId));
    dispatch(fetchAllRuns(200));
    dispatch(fetchPausedState());
    dispatch(fetchActiveRuns());
    dispatch(fetchMissedRuns());
  }, [open, dashboardId, dispatch]);

  // A deep-link target (from history/notifications/calendar) jumps straight to
  // that workflow's detail, then clears so a manual Home nav isn't overridden.
  useEffect(() => {
    if (open && target) {
      setSelectedId(target);
      setMode('detail');
      dispatch(clearWorkflowsAppTarget());
    }
  }, [open, target, dispatch]);

  const close = useCallback(() => dispatch(closeWorkflowsApp()), [dispatch]);

  const nav: AppNav = useMemo(() => ({
    mode, selectedId, calView, refDate,
    goHome: () => { setMode('home'); },
    goCalendar: () => { setMode('calendar'); },
    goNew: () => { setSelectedId(null); setMode('new'); },
    selectWorkflow: (id: string) => { setSelectedId(id); setMode('detail'); },
    setCalView: (v: CalView) => setCalView(v),
    setRefDate: (d: Date) => setRefDate(d),
  }), [mode, selectedId, calView, refDate]);

  if (!open) return null;

  return (
    <Dialog
      open={open}
      onClose={close}
      maxWidth={false}
      PaperProps={{
        sx: {
          width: 1320, maxWidth: '97vw', height: 854, maxHeight: '94vh',
          m: 0, bgcolor: WC.paper, borderRadius: '15px', overflow: 'hidden',
          border: `1px solid rgba(33,30,27,0.10)`,
          boxShadow: '0 30px 80px -24px rgba(33,30,27,0.34), 0 8px 24px -12px rgba(33,30,27,0.18)',
        },
      }}
      BackdropProps={{ sx: { bgcolor: 'rgba(33,30,27,0.28)' } }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', fontFamily: FONT_SANS, color: WC.ink }}>
        {/* TITLE BAR */}
        <div style={{ height: 42, flex: 'none', display: 'flex', alignItems: 'center', padding: '0 16px', borderBottom: `1px solid ${WC.line}`, background: WC.panel, gap: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={WC.accent} strokeWidth="1.9">
              <circle cx="6" cy="6" r="2.5" /><circle cx="6" cy="18" r="2.5" /><circle cx="18" cy="12" r="2.5" />
              <path d="M8.2 7.1l7.6 3.8M8.2 16.9l7.6-3.8" />
            </svg>
            <span style={{ fontFamily: "'Newsreader',serif", fontSize: 14.5, fontWeight: 500, color: WC.ink, letterSpacing: '-0.01em' }}>Workflows</span>
          </div>
          <div style={{ flex: 1 }} />
          <div
            role="button"
            aria-label="Close"
            onClick={close}
            style={{ width: 24, height: 24, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: WC.muted }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </div>
        </div>

        {/* THREE PANE */}
        <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
          <LeftRail nav={nav} />
          {mode === 'home' && <HomeView nav={nav} />}
          {mode === 'calendar' && <CalendarView nav={nav} />}
          {mode === 'detail' && selectedId && <DetailView workflowId={selectedId} nav={nav} />}
          {mode === 'new' && <ComposeView nav={nav} />}
        </div>
      </div>
    </Dialog>
  );
};

export default WorkflowsApp;
