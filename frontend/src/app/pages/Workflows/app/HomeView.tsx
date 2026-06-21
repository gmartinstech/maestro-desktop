import React, { useMemo, useState } from 'react';
import { useAppDispatch, useAppSelector } from '@/shared/hooks';
import { runMissedRuns } from '@/shared/state/missedRunsSlice';
import { fireTimesWithin } from '@/app/pages/Workflows/scheduleUtils';
import { colorForId, WC, statusChip, statusDot } from './uiKit';
import { clockOf, whenText } from './model';
import type { AppNav } from './types';

interface ComingRun { wfId: string; title: string; time: string; sortKey: number; steps: number; }
interface ComingGroup { key: string; dayNum: number; dow: string; runs: ComingRun[]; }

const HomeView: React.FC<{ nav: AppNav }> = ({ nav }) => {
  const dispatch = useAppDispatch();
  const items = useAppSelector((s) => s.workflows.items);
  const allRuns = useAppSelector((s) => s.workflows.allRuns);
  const missed = useAppSelector((s) => s.missedRuns.items);
  const [missedExpanded, setMissedExpanded] = useState(false);

  const now = new Date();
  const todayLabel = now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });

  const comingGroups = useMemo<ComingGroup[]>(() => {
    const from = new Date(now); from.setHours(0, 0, 0, 0);
    const to = new Date(from.getTime() + 7 * 86400000);
    const byDay = new Map<string, ComingRun[]>();
    for (const wf of Object.values(items)) {
      if (wf.unsaved) continue;
      const fires = fireTimesWithin(wf, now, to, 20);
      for (const f of fires) {
        const key = `${f.getFullYear()}-${f.getMonth()}-${f.getDate()}`;
        const arr = byDay.get(key) || [];
        arr.push({ wfId: wf.id, title: wf.title || 'Untitled', time: clockOf(f), sortKey: f.getTime(), steps: wf.steps.length });
        byDay.set(key, arr);
      }
    }
    const groups: ComingGroup[] = [];
    for (let i = 0; i < 7; i += 1) {
      const d = new Date(from.getTime() + i * 86400000);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      const runs = (byDay.get(key) || []).sort((a, b) => a.sortKey - b.sortKey);
      if (runs.length) groups.push({ key, dayNum: d.getDate(), dow: d.toLocaleDateString([], { weekday: 'short' }), runs });
    }
    return groups;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  const recents = useMemo(() => allRuns.slice(0, 8).map((r) => ({
    id: r.id,
    title: items[r.workflow_id]?.title || 'Workflow',
    status: r.status,
    summary: r.error || r.last_tool_label || (r.status === 'success' ? 'Completed' : r.status),
    when: r.started_at ? new Date(r.started_at) : null,
  })), [allRuns, items]);

  const missedVisible = missedExpanded ? missed : missed.slice(0, 3);
  const reRunAll = () => { if (missed.length) dispatch(runMissedRuns(missed.map((m) => m.id))); };

  return (
    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', background: WC.paper }}>
      <div style={{ flex: 'none', padding: '22px 30px 14px', borderBottom: '1px solid rgba(33,30,27,0.06)' }}>
        <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', color: WC.muted2 }}>{todayLabel}</div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, padding: '0 30px 32px' }}>
        {missed.length > 0 && (
          <div style={{ marginTop: 22 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 11 }}>
              <span style={{ fontFamily: "'Newsreader',serif", fontSize: 18, fontWeight: 500, color: WC.ink }}>Missed</span>
              <span style={{ fontSize: 11, fontWeight: 600, color: WC.danger, background: WC.dangerBg, padding: '2px 8px', borderRadius: 999 }}>{missed.length}</span>
              <div style={{ flex: 1 }} />
              <button onClick={reRunAll} style={{ background: 'transparent', border: '1px solid rgba(33,30,27,0.14)', borderRadius: 8, padding: '6px 12px', fontSize: 12, fontWeight: 600, color: WC.ink3, cursor: 'pointer' }}>Re-run all</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, ...(missedExpanded ? { maxHeight: 306, overflowY: 'auto', paddingRight: 4 } : {}) }}>
              {missedVisible.map((m) => (
                <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 12, background: '#FFFFFF', border: '1px solid rgba(194,72,58,0.20)', borderRadius: 11, padding: '10px 14px' }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: WC.danger, flex: 'none' }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600, color: WC.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.workflow_title}</div>
                    <div style={{ fontSize: 11.5, color: WC.muted, marginTop: 1 }}>Missed while the app was closed</div>
                  </div>
                  <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: WC.muted2, flex: 'none' }}>{whenText(new Date(m.scheduled_for), now)}</span>
                  <button onClick={() => dispatch(runMissedRuns([m.id]))} style={{ background: WC.ink, color: WC.paper, border: 'none', borderRadius: 8, padding: '6px 13px', fontSize: 12, fontWeight: 600, cursor: 'pointer', flex: 'none' }}>Re-run</button>
                </div>
              ))}
            </div>
            {missed.length > 3 && (
              <button onClick={() => setMissedExpanded((v) => !v)} style={{ marginTop: 10, background: 'transparent', border: 'none', color: WC.danger, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', padding: '4px 2px' }}>
                {missedExpanded ? 'Show less' : `Show all ${missed.length} missed`}
              </button>
            )}
          </div>
        )}

        <div style={{ marginTop: 26 }}>
          <div style={{ fontFamily: "'Newsreader',serif", fontSize: 18, fontWeight: 500, color: WC.ink, marginBottom: 12 }}>Coming up</div>
          {comingGroups.length === 0 && (
            <div style={{ fontSize: 13, color: WC.muted }}>Nothing scheduled in the next 7 days.</div>
          )}
          {comingGroups.map((g) => (
            <div key={g.key} style={{ display: 'flex', gap: 18, padding: '4px 0 16px' }}>
              <div style={{ width: 62, flex: 'none', textAlign: 'right', paddingTop: 2 }}>
                <div style={{ fontFamily: "'Newsreader',serif", fontSize: 26, fontWeight: 500, color: WC.ink, lineHeight: 1 }}>{g.dayNum}</div>
                <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10.5, letterSpacing: '0.04em', textTransform: 'uppercase', color: WC.muted2, marginTop: 4 }}>{g.dow}</div>
              </div>
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {g.runs.map((r, i) => (
                  <div key={`${r.wfId}-${i}`} onClick={() => nav.selectWorkflow(r.wfId)} style={{ display: 'flex', alignItems: 'center', gap: 13, background: '#FFFFFF', border: '1px solid rgba(33,30,27,0.08)', borderRadius: 11, padding: '12px 15px', cursor: 'pointer' }}>
                    <div style={{ width: 3, height: 30, borderRadius: 3, background: colorForId(r.wfId), flex: 'none' }} />
                    <span style={{ fontSize: 14, fontWeight: 600, color: WC.ink, flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.title}</span>
                    <span style={{ fontSize: 12, color: WC.muted }}>{r.steps} steps</span>
                    <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 12, color: WC.ink3, minWidth: 74, textAlign: 'right' }}>{r.time}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div style={{ marginTop: 18 }}>
          <div style={{ fontFamily: "'Newsreader',serif", fontSize: 18, fontWeight: 500, color: WC.ink, marginBottom: 12 }}>Recents</div>
          {recents.length === 0 && <div style={{ fontSize: 13, color: WC.muted }}>No runs yet.</div>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {recents.map((r) => (
              <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 13, padding: '11px 4px', borderBottom: '1px solid rgba(33,30,27,0.05)' }}>
                <div style={statusDot(r.status)} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: WC.ink }}>{r.title}</div>
                  <div style={{ fontSize: 12, color: WC.muted, marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.summary}</div>
                </div>
                <span style={statusChip(r.status)}>{r.status === 'failure' ? 'Failed' : r.status === 'success' ? 'Success' : r.status}</span>
                <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: WC.muted2, minWidth: 96, textAlign: 'right' }}>{whenText(r.when, now)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default HomeView;
