import React, { useEffect, useState } from 'react';
import { useAppDispatch, useAppSelector } from '@/shared/hooks';
import { runWorkflowNow } from '@/shared/state/workflowsSlice';
import { stepsSignature, isScheduleActive } from '@/app/pages/Workflows/scheduleUtils';
import AgentChat from '@/app/pages/AgentChat/AgentChat';
import { WC, colorForId, statusChip } from './uiKit';
import { isRunning } from './model';
import { useEditAgentSession } from './useEditAgentSession';
import { useWorkflowPatch } from './useWorkflowPatch';
import ScheduleCard from './ScheduleCard';
import StepsCard from './StepsCard';
import HistoryCard from './HistoryCard';
import type { AppNav } from './types';

const DetailView: React.FC<{ workflowId: string; nav: AppNav }> = ({ workflowId }) => {
  const dispatch = useAppDispatch();
  const patch = useWorkflowPatch();
  const workflow = useAppSelector((s) => s.workflows.items[workflowId]);
  const active = useAppSelector((s) => s.workflows.active);
  const sessionId = useEditAgentSession(workflowId, 'modify');
  const [name, setName] = useState(workflow?.title ?? '');

  useEffect(() => { setName(workflow?.title ?? ''); }, [workflow?.title]);

  if (!workflow) return <div style={{ flex: 1, background: WC.paper }} />;

  const running = isRunning(workflow, active);
  const enabled = isScheduleActive(workflow.schedule);
  const status = running ? 'running' : enabled ? 'success' : 'paused';
  const statusText = running ? 'Running' : enabled ? 'Active' : 'Paused';

  const runNow = () => {
    if (running) return;
    dispatch(runWorkflowNow({ id: workflow.id, signature: stepsSignature(workflow.steps) }));
  };
  const commitName = () => {
    const t = name.trim();
    if (t && t !== workflow.title) patch(workflow, { title: t, auto_named: false });
  };

  return (
    <>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', background: WC.paper }}>
        <div style={{ flex: 'none', padding: '20px 28px 16px', borderBottom: '1px solid rgba(33,30,27,0.06)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 13 }}>
            <div style={{ width: 14, height: 14, borderRadius: 4, background: colorForId(workflow.id), boxShadow: '0 0 0 1px rgba(33,30,27,0.14)', flex: 'none' }} />
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={commitName}
              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
              style={{ flex: 1, minWidth: 0, border: 'none', background: 'transparent', fontFamily: "'Newsreader',serif", fontSize: 25, fontWeight: 500, color: WC.ink, letterSpacing: '-0.01em' }}
            />
            <span style={statusChip(status)}>{statusText}</span>
            <button onClick={runNow} disabled={running} style={{ display: 'flex', alignItems: 'center', gap: 8, background: running ? WC.inset : WC.ink, color: running ? WC.muted : WC.paper, border: 'none', borderRadius: 9, padding: '8px 15px', fontSize: 13, fontWeight: 600, cursor: running ? 'default' : 'pointer', flex: 'none' }}>
              {running
                ? <div style={{ width: 12, height: 12, borderRadius: '50%', border: '2px solid rgba(140,133,122,0.3)', borderTopColor: WC.muted, animation: 'os-spin 0.7s linear infinite', flex: 'none' }} />
                : <div style={{ width: 0, height: 0, borderTop: '5px solid transparent', borderBottom: '5px solid transparent', borderLeft: `8px solid ${WC.paper}`, flex: 'none' }} />}
              <span>{running ? 'Running…' : 'Run now'}</span>
            </button>
          </div>
          {workflow.description && <div style={{ fontSize: 13.5, color: WC.muted, marginTop: 7, paddingLeft: 27 }}>{workflow.description}</div>}
        </div>

        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          {sessionId
            ? <AgentChat sessionId={sessionId} embedded workflowEditId={workflow.id} />
            : <div style={{ flex: 1 }} />}
        </div>
      </div>

      <div style={{ width: 344, flex: 'none', borderLeft: `1px solid ${WC.line}`, background: WC.rail, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, padding: '18px 18px 22px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <ScheduleCard workflow={workflow} />
          <StepsCard workflow={workflow} />
          <HistoryCard workflowId={workflow.id} title={workflow.title} />
        </div>
      </div>
    </>
  );
};

export default DetailView;
