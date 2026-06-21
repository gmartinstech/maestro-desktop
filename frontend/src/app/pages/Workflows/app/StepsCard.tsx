import React, { useEffect, useState } from 'react';
import { useAppDispatch } from '@/shared/hooks';
import { commitDraft, discardDraft } from '@/shared/state/workflowsSlice';
import type { Workflow, WorkflowStep } from '@/shared/state/workflowsSlice';
import { stepsSignature } from '@/app/pages/Workflows/scheduleUtils';
import { WC, FONT_SERIF, FONT_SANS } from './uiKit';
import { useWorkflowPatch } from './useWorkflowPatch';

interface LocalStep { id: string; label: string; text: string; open: boolean; }

function toLocal(steps: WorkflowStep[]): LocalStep[] {
  return steps.map((s) => ({ id: s.id, label: s.label || s.text.slice(0, 48), text: s.text, open: false }));
}
function newStepId(): string {
  return `step-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

const StepsCard: React.FC<{ workflow: Workflow }> = ({ workflow }) => {
  const dispatch = useAppDispatch();
  const patch = useWorkflowPatch();
  const [local, setLocal] = useState<LocalStep[]>(() => toLocal(workflow.steps));
  const [draft, setDraft] = useState('');

  const sig = stepsSignature(workflow.steps);
  // Reseed when the server steps change underneath us (commit, agent edit,
  // another surface) but not on our own in-progress keystrokes.
  useEffect(() => {
    setLocal((prev) => {
      const openIds = new Set(prev.filter((s) => s.open).map((s) => s.id));
      return toLocal(workflow.steps).map((s) => ({ ...s, open: openIds.has(s.id) }));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  const commit = (next: LocalStep[]) => {
    patch(workflow, { steps: next.map((s) => ({ id: s.id, text: s.text, label: s.label })) });
  };

  const update = (id: string, p: Partial<LocalStep>) => setLocal((prev) => prev.map((s) => (s.id === id ? { ...s, ...p } : s)));
  const onAdd = () => {
    const t = draft.trim();
    if (!t) return;
    const next = [...local, { id: newStepId(), label: t, text: t, open: false }];
    setLocal(next);
    setDraft('');
    commit(next);
  };
  const onDelete = (id: string) => {
    const next = local.filter((s) => s.id !== id);
    setLocal(next);
    commit(next);
  };

  return (
    <div style={{ background: WC.paper, border: '1px solid rgba(33,30,27,0.08)', borderRadius: 13, padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 13 }}>
        <span style={{ fontFamily: FONT_SERIF, fontSize: 16, fontWeight: 500, color: WC.ink }}>Steps</span>
        <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: WC.muted2 }}>{local.length} step{local.length === 1 ? '' : 's'}</span>
      </div>

      {workflow.has_draft && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 11, padding: '9px 11px', background: 'rgba(185,138,46,0.10)', border: '1px solid rgba(185,138,46,0.30)', borderRadius: 9 }}>
          <span style={{ flex: 1, fontSize: 12, color: '#8A6418', fontWeight: 600 }}>The build agent proposed step changes.</span>
          <button onClick={() => dispatch(commitDraft(workflow.id))} style={{ background: WC.ink, color: WC.paper, border: 'none', borderRadius: 7, padding: '5px 10px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Apply</button>
          <button onClick={() => dispatch(discardDraft(workflow.id))} style={{ background: 'transparent', border: '1px solid rgba(33,30,27,0.16)', borderRadius: 7, padding: '5px 10px', fontSize: 12, fontWeight: 600, color: WC.ink3, cursor: 'pointer' }}>Discard</button>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        {local.map((s, i) => (
          <div key={s.id} style={{ border: `1px solid ${s.open ? 'rgba(33,30,27,0.16)' : 'rgba(33,30,27,0.10)'}`, borderRadius: 10, background: s.open ? '#FFFFFF' : WC.paper, overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 9px 9px 11px' }}>
              <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: WC.faint, width: 13, flex: 'none' }}>{i + 1}</span>
              <input
                value={s.label}
                onChange={(e) => update(s.id, { label: e.target.value })}
                onBlur={() => commit(local)}
                placeholder="Step title"
                style={{ flex: 1, minWidth: 0, border: 'none', background: 'transparent', padding: 0, fontSize: 13, fontWeight: 600, color: WC.ink }}
              />
              <div onClick={() => update(s.id, { open: !s.open })} style={{ width: 22, height: 22, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: WC.muted, flex: 'none' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" style={{ transform: s.open ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}><path d="M6 9l6 6 6-6" /></svg>
              </div>
              <div onClick={() => onDelete(s.id)} style={{ width: 22, height: 22, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: WC.faint, flex: 'none' }} aria-label="Delete step">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14" /></svg>
              </div>
            </div>
            {s.open && (
              <div style={{ padding: '0 11px 12px 34px' }}>
                <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 9.5, letterSpacing: '0.05em', textTransform: 'uppercase', color: WC.muted2, marginBottom: 6 }}>Prompt</div>
                <textarea
                  value={s.text}
                  onChange={(e) => update(s.id, { text: e.target.value })}
                  onBlur={() => commit(local)}
                  placeholder="What should this step do?"
                  style={{ width: '100%', boxSizing: 'border-box', border: '1px solid rgba(33,30,27,0.12)', borderRadius: 8, background: WC.paper, padding: '9px 11px', fontSize: 12.5, lineHeight: 1.5, color: WC.ink2, resize: 'vertical', minHeight: 76, fontFamily: FONT_SANS }}
                />
              </div>
            )}
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 7, marginTop: 11 }}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onAdd(); } }}
          placeholder="Add a step…"
          style={{ flex: 1, background: '#FFFFFF', border: '1px solid rgba(33,30,27,0.12)', borderRadius: 8, padding: '8px 11px', fontSize: 13, color: WC.ink }}
        />
        <button onClick={onAdd} style={{ background: WC.ink, color: WC.paper, border: 'none', borderRadius: 8, width: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flex: 'none' }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M12 5v14M5 12h14" /></svg>
        </button>
      </div>
    </div>
  );
};

export default StepsCard;
