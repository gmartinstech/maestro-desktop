import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppSelector } from '@/shared/hooks';
import type { Workflow } from '@/shared/state/workflowsSlice';

// Run Monitor card geometry + its tether label ("Watching" live, "Viewing" done). Only "active" while its workflow still exists; otherwise the card is gone and the tether must not dangle (e.g. the workflow was trashed while watching).
export function useWorkflowsMonitorState(workflowItems: Record<string, Workflow>) {
  const { t } = useTranslation();
  const workflowsMonitorIdRaw = useAppSelector((s) => s.dashboardLayout.workflowsMonitorId);
  const monitorActive = !!workflowsMonitorIdRaw && !!workflowItems[workflowsMonitorIdRaw];
  const workflowsMonitorId = monitorActive ? workflowsMonitorIdRaw : null;
  const fullscreenCardId = useAppSelector((s) => s.tempState.fullscreenCardId);
  const workflowsMonitorCard = useAppSelector((s) =>
    (monitorActive ? s.dashboardLayout.workflowsMonitorCard : null));
  const monitorIsLive = useAppSelector((s) =>
    !!workflowsMonitorId && s.workflows.active.some((a) => a.workflow_id === workflowsMonitorId));
  const workflowsMonitorLabel = monitorIsLive ? t('dashboard.tether.watching') : t('dashboard.tether.viewing');

  // The session id of the run the monitor is showing, mirroring RunMonitor's pinned-or-latest pick, so its browser tether can anchor to the monitor card.
  const workflowsMonitorRunId = useAppSelector((s) => s.dashboardLayout.workflowsMonitorRunId);
  const monitorRuns = useAppSelector((s) => (workflowsMonitorId ? s.workflows.runs[workflowsMonitorId] : undefined));
  const allRuns = useAppSelector((s) => s.workflows.allRuns);
  const monitorRunSessionId = useMemo(() => {
    if (!workflowsMonitorId) return null;
    const run = workflowsMonitorRunId
      ? (monitorRuns || []).find((r) => r.id === workflowsMonitorRunId) || allRuns.find((r) => r.id === workflowsMonitorRunId)
      : (monitorRuns && monitorRuns[0]) || allRuns.find((r) => r.workflow_id === workflowsMonitorId);
    return run?.session_id || null;
  }, [workflowsMonitorId, workflowsMonitorRunId, monitorRuns, allRuns]);

  return {
    fullscreenCardId,
    workflowsMonitorCard,
    workflowsMonitorLabel,
    monitorRunSessionId,
  };
}
