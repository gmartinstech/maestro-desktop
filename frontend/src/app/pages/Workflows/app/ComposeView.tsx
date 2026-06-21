import React, { useEffect, useRef, useState } from 'react';
import { useAppDispatch, useAppSelector } from '@/shared/hooks';
import { createWorkflow, updateWorkflow } from '@/shared/state/workflowsSlice';
import { defaultSchedule, stepsSignature, needsScheduleTestWarning } from '@/app/pages/Workflows/scheduleUtils';
import { runWorkflowTest } from '@/app/pages/Workflows/runWorkflowTest';
import AgentChat from '@/app/pages/AgentChat/AgentChat';
import { WC } from './uiKit';
import { useEditAgentSession } from './useEditAgentSession';
import { useWorkflowPatch } from './useWorkflowPatch';
import ScheduleCard from './ScheduleCard';
import StepsCard from './StepsCard';
import SaveGuard from './SaveGuard';
import type { AppNav } from './types';

const ComposeView: React.FC<{ nav: AppNav }> = ({ nav }) => {
  const dispatch = useAppDispatch();
  const patch = useWorkflowPatch();
  const [draftId, setDraftId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [testing, setTesting] = useState(false);
  const [guardOpen, setGuardOpen] = useState(false);
  const created = useRef(false);

  const workflow = useAppSelector((s) => (draftId ? s.workflows.items[draftId] : undefined));

  // One unsaved draft per visit to "New". The backend hides unsaved drafts from
  // lists, so an abandoned one stays out of the way until GC.
  useEffect(() => {
    if (created.current) return;
    created.current = true;
    (async () => {
      try {
        const wf = await dispatch(createWorkflow({ unsaved: true, title: 'Untitled workflow', steps: [], schedule: defaultSchedule() })).unwrap();
        setDraftId(wf.id);
        setName(wf.title || '');
      } catch { /* surfaced by the empty state */ }
    })();
  }, [dispatch]);

  const sessionId = useEditAgentSession(draftId ?? '', 'build');

  if (!workflow) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: WC.paper }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 14, height: 14, borderRadius: '50%', border: '2px solid rgba(33,30,27,0.15)', borderTopColor: WC.accent, animation: 'os-spin 0.7s linear infinite' }} />
          <span style={{ fontFamily: "'Newsreader',serif", fontStyle: 'italic', fontSize: 14, color: '#6B655C' }}>Setting up your workflow…</span>
        </div>
      </div>
    );
  }

  const tested = workflow.steps.length > 0 && stepsSignature(workflow.steps) === (workflow.tested_signature ?? '');
  const commitName = () => { const t = name.trim(); if (t && t !== workflow.title) patch(workflow, { title: t, auto_named: false }); };

  const doTest = async () => {
    if (testing || workflow.steps.length === 0) return;
    setTesting(true);
    try { await runWorkflowTest(workflow.id, workflow.steps, async () => {}); }
    finally { setTesting(false); }
  };

  const finalizeSave = () => {
    dispatch(updateWorkflow({ id: workflow.id, patch: { unsaved: false }, ifMatch: workflow.updated_at }));
    nav.selectWorkflow(workflow.id);
  };
  const onSave = () => {
    if (needsScheduleTestWarning(workflow)) { setGuardOpen(true); return; }
    finalizeSave();
  };

  return (
    <>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', background: WC.paper, position: 'relative' }}>
        <div style={{ flex: 'none', padding: '15px 28px', borderBottom: '1px solid rgba(33,30,27,0.06)', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 15, height: 15, borderRadius: 4, background: WC.accent, boxShadow: '0 0 0 1px rgba(33,30,27,0.14)', flex: 'none' }} />
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={commitName}
            placeholder="Untitled workflow"
            style={{ flex: 1, minWidth: 0, border: 'none', background: 'transparent', fontFamily: "'Newsreader',serif", fontSize: 21, fontWeight: 500, color: WC.ink, letterSpacing: '-0.01em' }}
          />
          <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', fontWeight: 500, color: WC.muted, background: 'rgba(33,30,27,0.07)', padding: '4px 10px', borderRadius: 999, flex: 'none' }}>Draft</span>
        </div>

        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          {sessionId
            ? <AgentChat sessionId={sessionId} embedded autoFocus workflowEditId={workflow.id} />
            : <div style={{ flex: 1 }} />}
        </div>

        {guardOpen && (
          <SaveGuard
            title={workflow.title || 'this workflow'}
            onClose={() => setGuardOpen(false)}
            onSaveAnyway={() => { setGuardOpen(false); finalizeSave(); }}
            onRunTest={() => { setGuardOpen(false); doTest(); }}
          />
        )}
      </div>

      <div style={{ width: 344, flex: 'none', borderLeft: `1px solid ${WC.line}`, background: WC.rail, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, padding: '18px 18px 22px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <ScheduleCard workflow={workflow} />
          <StepsCard workflow={workflow} />
        </div>
        <div style={{ flex: 'none', borderTop: '1px solid rgba(33,30,27,0.08)', background: WC.rail, padding: '13px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {!tested && (
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 7, fontSize: 11.5, lineHeight: 1.4, color: WC.muted }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={WC.warn} strokeWidth="2" style={{ flex: 'none', marginTop: 1 }}><circle cx="12" cy="12" r="9" /><path d="M12 8v5" /><path d="M12 16h.01" /></svg>
              <span>Not tested yet — a test run grants the tool access this workflow needs.</span>
            </div>
          )}
          <div style={{ display: 'flex', gap: 9 }}>
            <button onClick={doTest} disabled={testing || workflow.steps.length === 0} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, flex: 'none', padding: '10px 15px', borderRadius: 9, border: '1px solid rgba(33,30,27,0.14)', background: WC.paper, color: testing || workflow.steps.length === 0 ? WC.muted2 : WC.ink, fontSize: 13, fontWeight: 600, cursor: testing || workflow.steps.length === 0 ? 'default' : 'pointer' }}>
              {testing
                ? <div style={{ width: 12, height: 12, borderRadius: '50%', border: '2px solid rgba(140,133,122,0.3)', borderTopColor: WC.muted, animation: 'os-spin 0.7s linear infinite', flex: 'none' }} />
                : <div style={{ width: 0, height: 0, borderTop: '5px solid transparent', borderBottom: '5px solid transparent', borderLeft: `8px solid ${WC.accent}`, flex: 'none' }} />}
              <span>{testing ? 'Testing…' : tested ? 'Run again' : 'Test run'}</span>
            </button>
            <button onClick={onSave} style={{ flex: 1, background: WC.accent, color: '#fff', border: 'none', borderRadius: 9, padding: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Save workflow</button>
          </div>
        </div>
      </div>
    </>
  );
};

export default ComposeView;
