import React, { useMemo, useRef, useEffect } from 'react';
import type { CSSProperties } from 'react';
import { useAppSelector } from '@/shared/hooks';
import { fireTimesWithin, startOfWeek, startOfMonthGrid, addDays, sameDay } from '@/app/pages/Workflows/scheduleUtils';
import { colorForId, WC } from './uiKit';
import type { AppNav } from './types';

interface Occ { wfId: string; title: string; at: Date; }

const DOW = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

function miniTime(d: Date): string {
  let h = d.getHours();
  const m = d.getMinutes();
  const ap = h < 12 ? 'am' : 'pm';
  h = h % 12 === 0 ? 12 : h % 12;
  return `${h}:${String(m).padStart(2, '0')}${ap}`;
}
function hourLabel(h: number): string {
  if (h === 0) return '12 AM';
  if (h < 12) return `${h} AM`;
  if (h === 12) return '12 PM';
  return `${h - 12} PM`;
}

const tabBtn = (active: boolean): CSSProperties => ({
  padding: '5px 13px', borderRadius: 7, border: 'none', cursor: 'pointer', fontSize: 12.5, fontWeight: 600,
  background: active ? WC.paper : 'transparent', color: active ? WC.ink : WC.muted,
  boxShadow: active ? '0 1px 3px rgba(33,30,27,0.10)' : 'none',
});

const CalendarView: React.FC<{ nav: AppNav }> = ({ nav }) => {
  const items = useAppSelector((s) => s.workflows.items);
  const now = new Date();
  const ref = nav.refDate;

  // Window of occurrences spanning the visible month grid (covers week too).
  const occ = useMemo<Occ[]>(() => {
    const from = startOfMonthGrid(ref);
    const to = addDays(from, 42);
    const out: Occ[] = [];
    for (const wf of Object.values(items)) {
      if (wf.unsaved) continue;
      for (const at of fireTimesWithin(wf, from, to, 200)) {
        out.push({ wfId: wf.id, title: wf.title || 'Untitled', at });
      }
    }
    return out.sort((a, b) => a.at.getTime() - b.at.getTime());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, ref]);

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

  return (
    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', background: WC.paper }}>
      <div style={{ flex: 'none', padding: '14px 26px', borderBottom: `1px solid ${WC.line}`, display: 'flex', alignItems: 'center', gap: 14 }}>
        <button onClick={() => nav.setRefDate(new Date())} style={{ background: WC.paper, border: '1px solid rgba(33,30,27,0.14)', borderRadius: 8, padding: '6px 14px', fontSize: 13, fontWeight: 600, color: WC.ink, cursor: 'pointer' }}>Today</button>
        <div style={{ display: 'flex', gap: 4 }}>
          <button onClick={() => step(-1)} style={{ width: 30, height: 30, borderRadius: 8, border: '1px solid rgba(33,30,27,0.12)', background: WC.paper, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: WC.ink3 }}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 6l-6 6 6 6" /></svg></button>
          <button onClick={() => step(1)} style={{ width: 30, height: 30, borderRadius: 8, border: '1px solid rgba(33,30,27,0.12)', background: WC.paper, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: WC.ink3 }}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 6l6 6-6 6" /></svg></button>
        </div>
        <h1 style={{ margin: 0, fontFamily: "'Newsreader',serif", fontSize: 22, fontWeight: 600, color: WC.ink, letterSpacing: '-0.01em' }}>{title}</h1>
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', background: WC.inset, border: `1px solid ${WC.line}`, borderRadius: 9, padding: 3, gap: 2 }}>
          <button onClick={() => nav.setCalView('week')} style={tabBtn(nav.calView === 'week')}>Week</button>
          <button onClick={() => nav.setCalView('month')} style={tabBtn(nav.calView === 'month')}>Month</button>
        </div>
      </div>

      {nav.calView === 'month'
        ? <MonthGrid ref0={ref} now={now} occByDay={occByDay} dayKey={dayKey} onSelect={nav.selectWorkflow} />
        : <WeekGrid ref0={ref} now={now} occByDay={occByDay} dayKey={dayKey} onSelect={nav.selectWorkflow} />}
    </div>
  );
};

interface GridProps {
  ref0: Date; now: Date;
  occByDay: Map<string, Occ[]>;
  dayKey: (d: Date) => string;
  onSelect: (id: string) => void;
}

const MonthGrid: React.FC<GridProps> = ({ ref0, now, occByDay, dayKey, onSelect }) => {
  const start = startOfMonthGrid(ref0);
  const cells = Array.from({ length: 42 }, (_, i) => addDays(start, i));
  const month = ref0.getMonth();
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', flex: 'none', borderBottom: `1px solid ${WC.line}` }}>
        {DOW.map((d) => <div key={d} style={{ textAlign: 'center', padding: '9px 0', fontFamily: "'JetBrains Mono',monospace", fontSize: 10.5, letterSpacing: '0.06em', color: WC.muted2 }}>{d}</div>)}
      </div>
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gridAutoRows: '1fr', minHeight: 0 }}>
        {cells.map((d, i) => {
          const inMonth = d.getMonth() === month;
          const isToday = sameDay(d, now);
          const runs = occByDay.get(dayKey(d)) || [];
          const shown = runs.slice(0, 4);
          return (
            <div key={i} style={{ borderRight: '1px solid rgba(33,30,27,0.06)', borderBottom: '1px solid rgba(33,30,27,0.06)', padding: '6px 8px', background: isToday ? 'rgba(194,90,54,0.05)' : (inMonth ? WC.paper : '#F1EFE9'), display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
              <div style={{ display: 'flex', marginBottom: 3 }}>
                <div style={{ width: 24, height: 24, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none', background: isToday ? WC.accent : 'transparent' }}>
                  <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 12, fontWeight: isToday ? 700 : 500, lineHeight: 1, color: isToday ? '#fff' : (inMonth ? WC.ink3 : WC.faint) }}>{d.getDate()}</span>
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, overflow: 'hidden' }}>
                {shown.map((r, ri) => (
                  <div key={ri} onClick={() => onSelect(r.wfId)} style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', borderRadius: 4, padding: '1px 3px' }}>
                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: colorForId(r.wfId), flex: 'none' }} />
                    <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10, color: '#6B655C', flex: 'none' }}>{miniTime(r.at)}</span>
                    <span style={{ fontSize: 11, color: WC.ink2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.title}</span>
                  </div>
                ))}
                {runs.length > 4 && <span style={{ fontSize: 10.5, color: WC.muted2, paddingLeft: 3 }}>+{runs.length - 4} more</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const WeekGrid: React.FC<GridProps> = ({ ref0, now, occByDay, dayKey, onSelect }) => {
  const start = startOfWeek(ref0);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const ROW_H = 54;

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = Math.max(0, (now.getHours() - 2) * ROW_H);
  }, [now, start]);

  const nowFrac = (now.getHours() * 60 + now.getMinutes()) / 60 % 1;
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '56px repeat(7,1fr)', flex: 'none', borderBottom: `1px solid ${WC.line}`, paddingRight: 9 }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'center', paddingBottom: 7, fontFamily: "'JetBrains Mono',monospace", fontSize: 9.5, color: WC.muted2 }} />
        {days.map((d, i) => {
          const isToday = sameDay(d, now);
          return (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '8px 0 7px', borderLeft: '1px solid rgba(33,30,27,0.06)' }}>
              <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10, letterSpacing: '0.04em', color: WC.muted2 }}>{DOW[d.getDay()]}</span>
              <div style={{ width: 30, height: 30, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 3, flex: 'none', background: isToday ? WC.accent : 'transparent' }}>
                <span style={{ fontFamily: "'Newsreader',serif", fontSize: 18, fontWeight: 500, lineHeight: 1, color: isToday ? '#fff' : WC.ink }}>{d.getDate()}</span>
              </div>
            </div>
          );
        })}
      </div>
      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {Array.from({ length: 24 }, (_, h) => (
          <div key={h} style={{ display: 'grid', gridTemplateColumns: '56px repeat(7,1fr)', borderBottom: '1px solid rgba(33,30,27,0.05)', minHeight: ROW_H }}>
            <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '5px 8px 0 0', fontFamily: "'JetBrains Mono',monospace", fontSize: 10, color: WC.muted2 }}>{hourLabel(h)}</div>
            {days.map((d, di) => {
              const runs = (occByDay.get(dayKey(d)) || []).filter((r) => r.at.getHours() === h);
              const isNow = sameDay(d, now) && now.getHours() === h;
              return (
                <div key={di} style={{ position: 'relative', borderLeft: '1px solid rgba(33,30,27,0.06)', padding: '3px 4px', display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {isNow && <>
                    <div style={{ position: 'absolute', left: -4, top: nowFrac * ROW_H - 4, width: 8, height: 8, borderRadius: '50%', background: WC.accent, zIndex: 4 }} />
                    <div style={{ position: 'absolute', left: 0, right: 0, top: nowFrac * ROW_H, height: 2, background: WC.accent, zIndex: 3 }} />
                  </>}
                  {runs.slice(0, 3).map((r, ri) => (
                    <div key={ri} onClick={() => onSelect(r.wfId)} style={{ display: 'flex', alignItems: 'center', background: colorForId(r.wfId), color: '#fff', borderRadius: 999, padding: '2px 9px', fontSize: 10.5, fontWeight: 600, cursor: 'pointer', lineHeight: 1.35, overflow: 'hidden' }}>
                      <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.title}</span>
                      <span style={{ marginLeft: 'auto', paddingLeft: 6, opacity: 0.85, flex: 'none' }}>{miniTime(r.at)}</span>
                    </div>
                  ))}
                  {runs.length > 3 && <span style={{ fontSize: 10, color: WC.muted2, paddingLeft: 2 }}>{runs.length - 3} more</span>}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
};

export default CalendarView;
