import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { CSSProperties } from 'react';
import { useAppSelector } from '@/shared/hooks';
import { startOfMonthGrid, addDays } from '@/app/pages/Workflows/schedule/scheduleUtils';
import { useCalendarOccurrences } from '../hooks/useCalendarOccurrences';
import { colorForWorkflow, useWC, type WCPalette } from '../shared/uiKit';
import type { AppNav } from '../shared/types';
import { miniTime } from './calendarViewHelpers';
import { MonthGrid, WeekGrid } from './CalendarViewGrids';

export interface Occ { wfId: string; title: string; at: Date; color: string; }
interface DayPop { title: string; runs: Occ[]; x: number; y: number; }
export type OpenDayPop = (title: string, runs: Occ[], e: React.MouseEvent) => void;

const POP_W = 240;

const tabBtn = (active: boolean, WC: WCPalette): CSSProperties => ({
  padding: '5px 13px', borderRadius: 7, border: 'none', cursor: 'pointer', fontSize: 12.5, fontWeight: 600,
  background: active ? WC.paper : 'transparent', color: active ? WC.ink : WC.muted,
  boxShadow: active ? WC.shadow.sm : 'none',
});

const CalendarView: React.FC<{ nav: AppNav }> = ({ nav }) => {
  const WC = useWC();
  const { t } = useTranslation();
  const items = useAppSelector((s) => s.workflows.items);
  // Tick the clock so the now-line and "today" highlight stay live instead of freezing at first render.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(id);
  }, []);
  const ref = nav.refDate;
  const refKey = `${ref.getFullYear()}-${ref.getMonth()}-${ref.getDate()}`;

  // Window of occurrences spanning the visible month grid (covers week too). Fired times come from the backend's recurrence engine, not a JS reimpl, so the grid matches what actually runs (timezone + last-day-of-month aware).
  const { fromIso, toIso } = useMemo(() => {
    const from = startOfMonthGrid(ref);
    return { fromIso: from.toISOString(), toIso: addDays(from, 42).toISOString() };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refKey]);
  const { events } = useCalendarOccurrences(fromIso, toIso);
  const occ = useMemo<Occ[]>(() => {
    const out: Occ[] = [];
    for (const e of events) {
      const wf = items[e.workflowId];
      if (!wf || wf.unsaved) continue;
      out.push({ wfId: wf.id, title: wf.title || 'Untitled', at: e.at, color: colorForWorkflow(wf) });
    }
    return out.sort((a, b) => a.at.getTime() - b.at.getTime());
  }, [events, items]);

  const occByDay = useMemo(() => {
    const map = new Map<string, Occ[]>();
    for (const o of occ) {
      const key = `${o.at.getFullYear()}-${o.at.getMonth()}-${o.at.getDate()}`;
      const arr = map.get(key) || [];
      arr.push(o);
      map.set(key, arr);
    }
    return map;
  }, [occ]);
  const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

  const title = ref.toLocaleDateString([], { month: 'long', year: 'numeric' });
  const step = (dir: number) => {
    if (nav.calView === 'week') nav.setRefDate(addDays(ref, dir * 7));
    else nav.setRefDate(new Date(ref.getFullYear(), ref.getMonth() + dir, 1));
  };

  // Click "+N more" to peek a day's/hour's full run list. position:fixed via a body portal so it isn't reparented by the zoomed/panned canvas transform.
  const [dayPop, setDayPop] = useState<DayPop | null>(null);
  const openDayPop: OpenDayPop = (popTitle, runs, e) => {
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    const x = Math.min(r.left, vw - POP_W - 12);
    let y = r.bottom + 6;
    if (y > vh - 220) y = Math.max(12, r.top - 8 - 300);
    setDayPop({ title: popTitle, runs, x, y });
  };
  const selectFromPop = (id: string) => { setDayPop(null); nav.selectWorkflow(id); };

  return (
    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', background: WC.page }}>
      <div style={{ flex: 'none', padding: '14px 26px', borderBottom: `1px solid ${WC.line}`, display: 'flex', alignItems: 'center', gap: 14 }}>
        <button onClick={() => nav.setRefDate(new Date())} style={{ background: WC.paper, border: `1px solid rgba(${WC.inkRGB},0.14)`, borderRadius: 8, padding: '6px 14px', fontSize: 13, fontWeight: 600, color: WC.ink, cursor: 'pointer' }}>{t('workflows.calendar.today')}</button>
        <div style={{ display: 'flex', gap: 4 }}>
          <button onClick={() => step(-1)} style={{ width: 30, height: 30, borderRadius: 8, border: `1px solid rgba(${WC.inkRGB},0.12)`, background: WC.paper, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: WC.ink3 }}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 6l-6 6 6 6" /></svg></button>
          <button onClick={() => step(1)} style={{ width: 30, height: 30, borderRadius: 8, border: `1px solid rgba(${WC.inkRGB},0.12)`, background: WC.paper, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: WC.ink3 }}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 6l6 6-6 6" /></svg></button>
        </div>
        <h1 style={{ margin: 0, fontFamily: "'Newsreader',serif", fontSize: 22, fontWeight: 600, color: WC.ink, letterSpacing: '-0.01em' }}>{title}</h1>
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', background: WC.inset, border: `1px solid ${WC.line}`, borderRadius: 9, padding: 3, gap: 2 }}>
          <button onClick={() => nav.setCalView('week')} style={tabBtn(nav.calView === 'week', WC)}>{t('workflows.calendar.week')}</button>
          <button onClick={() => nav.setCalView('month')} style={tabBtn(nav.calView === 'month', WC)}>{t('workflows.calendar.month')}</button>
        </div>
      </div>

      {nav.calView === 'month'
        ? <MonthGrid ref0={ref} now={now} occByDay={occByDay} dayKey={dayKey} onSelect={nav.selectWorkflow} openDayPop={openDayPop} />
        : <WeekGrid ref0={ref} now={now} occByDay={occByDay} dayKey={dayKey} onSelect={nav.selectWorkflow} openDayPop={openDayPop} />}

      {dayPop && createPortal(
        <div onClick={() => setDayPop(null)} style={{ position: 'fixed', inset: 0, zIndex: 2147483600 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ position: 'fixed', left: dayPop.x, top: dayPop.y, width: POP_W, maxHeight: 320, overflowY: 'auto', background: WC.paper, border: `1px solid ${WC.line2}`, borderRadius: WC.radius.lg, boxShadow: WC.shadow.lg, padding: 12 }}>
            <div style={{ fontFamily: "'Newsreader',serif", fontSize: 15, fontWeight: 500, color: WC.ink, marginBottom: 10, padding: '0 2px' }}>{dayPop.title}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {dayPop.runs.map((r, i) => (
                <div key={i} onClick={() => selectFromPop(r.wfId)} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '8px 7px', borderRadius: 8, cursor: 'pointer' }}>
                  <div style={{ width: 7, height: 7, borderRadius: '50%', background: r.color, flex: 'none' }} />
                  <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: WC.ink4, flex: 'none', minWidth: 52 }}>{miniTime(r.at)}</span>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600, color: WC.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.title}</span>
                </div>
              ))}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
};

export default CalendarView;
