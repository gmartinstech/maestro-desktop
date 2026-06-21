import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import Checkbox from '@mui/material/Checkbox';
import CloseIcon from '@mui/icons-material/Close';
import HistoryRoundedIcon from '@mui/icons-material/HistoryRounded';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import { useAppDispatch, useAppSelector } from '@/shared/hooks';
import {
  closeMissedRunsCard,
  setMissedRunsCardPosition,
} from '@/shared/state/dashboardLayoutSlice';
import {
  runMissedRuns,
  dismissMissedRuns,
  type MissedRunItem,
} from '@/shared/state/missedRunsSlice';

// Above this many selected, "Run" asks once before firing: each missed run is
// a real agent run, so a fat-fingered Run-all shouldn't quietly spend money.
const CONFIRM_THRESHOLD = 10;

interface Props {
  cardX: number;
  cardY: number;
  cardWidth: number;
  cardHeight: number;
  cardZOrder?: number;
  zoom?: number;
  panX?: number;
  panY?: number;
  isSelected?: boolean;
  isHighlighted?: boolean;
  multiDragDelta?: { dx: number; dy: number } | null;
  onCardSelect?: (id: string, type: 'missed_runs', shiftKey: boolean) => void;
  onDragStart?: (id: string, type: 'missed_runs') => void;
  onDragMove?: (dx: number, dy: number, mouseX?: number, mouseY?: number) => void;
  onDragEnd?: (dx: number, dy: number, didDrag: boolean) => void;
  onBringToFront?: (id: string, type: 'missed_runs') => void;
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

const MissedRunsCard: React.FC<Props> = ({
  cardX, cardY, cardWidth, cardHeight, cardZOrder = 0,
  zoom = 1, panX = 0, panY = 0,
  isSelected = false, isHighlighted = false, multiDragDelta = null,
  onCardSelect, onDragStart, onDragMove, onDragEnd, onBringToFront,
}) => {
  const c = useClaudeTokens();
  const dispatch = useAppDispatch();
  const items = useAppSelector((s) => s.missedRuns.items);

  // Unchecked ids; default is everything checked. Run acts on the checked set.
  const [unchecked, setUnchecked] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);

  const selectedIds = useMemo(
    () => items.filter((m) => !unchecked.has(m.id)).map((m) => m.id),
    [items, unchecked],
  );

  const groups = useMemo(() => {
    const by = new Map<string, { title: string; runs: MissedRunItem[] }>();
    for (const m of items) {
      const g = by.get(m.workflow_id) || { title: m.workflow_title, runs: [] };
      g.runs.push(m);
      by.set(m.workflow_id, g);
    }
    return Array.from(by.values());
  }, [items]);

  // Once everything has been run or dismissed, the card has nothing left to say.
  useEffect(() => {
    if (items.length === 0) dispatch(closeMissedRunsCard());
  }, [items.length, dispatch]);

  const toggle = useCallback((id: string) => {
    setConfirming(false);
    setUnchecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  // A group header's checkbox flips every run under it: if any are checked,
  // clear the lot; otherwise check the lot.
  const toggleGroup = useCallback((runs: MissedRunItem[]) => {
    setConfirming(false);
    setUnchecked((prev) => {
      const anyChecked = runs.some((r) => !prev.has(r.id));
      const next = new Set(prev);
      for (const r of runs) {
        if (anyChecked) next.add(r.id); else next.delete(r.id);
      }
      return next;
    });
  }, []);

  const runSelected = useCallback(() => {
    if (selectedIds.length === 0) return;
    if (selectedIds.length > CONFIRM_THRESHOLD && !confirming) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    dispatch(runMissedRuns(selectedIds));
  }, [dispatch, selectedIds, confirming]);

  // Closing means "I'm done": drop whatever's still listed, logged as skipped.
  const closeAndDismissRest = useCallback(() => {
    const rest = items.map((m) => m.id);
    if (rest.length) dispatch(dismissMissedRuns(rest));
    dispatch(closeMissedRunsCard());
  }, [dispatch, items]);

  // ---- Card drag via header (mirrors WorkflowsHubCard) ----
  const DRAG_THRESHOLD = 3;
  const dragState = useRef<{ startX: number; startY: number; origX: number; origY: number; startPanX: number; startPanY: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [localDragPos, setLocalDragPos] = useState<{ x: number; y: number } | null>(null);
  const didDrag = useRef(false);
  const justDraggedRef = useRef(false);
  const panRef = useRef({ panX, panY });
  panRef.current = { panX, panY };
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  const onHeaderPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest('[data-no-drag], button, [role="button"], input')) return;
    e.preventDefault();
    e.stopPropagation();
    dragState.current = {
      startX: e.clientX, startY: e.clientY,
      origX: cardX, origY: cardY,
      startPanX: panRef.current.panX, startPanY: panRef.current.panY,
    };
    didDrag.current = false;
    setIsDragging(true);
    onDragStart?.('missed-runs', 'missed_runs');
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, [cardX, cardY, onDragStart]);

  const onHeaderPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragState.current) return;
    const rawDx = e.clientX - dragState.current.startX;
    const rawDy = e.clientY - dragState.current.startY;
    if (!didDrag.current && Math.sqrt(rawDx * rawDx + rawDy * rawDy) < DRAG_THRESHOLD) return;
    didDrag.current = true;
    const z = zoomRef.current;
    const panDx = (panRef.current.panX - dragState.current.startPanX) / z;
    const panDy = (panRef.current.panY - dragState.current.startPanY) / z;
    const dx = rawDx / z - panDx;
    const dy = rawDy / z - panDy;
    setLocalDragPos({ x: dragState.current.origX + dx, y: dragState.current.origY + dy });
    onDragMove?.(dx, dy, e.clientX, e.clientY);
  }, [onDragMove]);

  const onHeaderPointerUp = useCallback((e: React.PointerEvent) => {
    if (!dragState.current) return;
    const z = zoomRef.current;
    const panDx = (panRef.current.panX - dragState.current.startPanX) / z;
    const panDy = (panRef.current.panY - dragState.current.startPanY) / z;
    const dx = (e.clientX - dragState.current.startX) / z - panDx;
    const dy = (e.clientY - dragState.current.startY) / z - panDy;
    if (didDrag.current) {
      justDraggedRef.current = true;
      setTimeout(() => { justDraggedRef.current = false; }, 0);
      let finalX = dragState.current.origX + dx;
      let finalY = dragState.current.origY + dy;
      if (!e.shiftKey) {
        finalX = Math.round(finalX / 24) * 24;
        finalY = Math.round(finalY / 24) * 24;
      }
      dispatch(setMissedRunsCardPosition({ x: finalX, y: finalY }));
    }
    onDragEnd?.(dx, dy, didDrag.current);
    dragState.current = null;
    didDrag.current = false;
    setLocalDragPos(null);
    setIsDragging(false);
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
  }, [dispatch, onDragEnd]);

  const mdDx = (!isDragging && isSelected && multiDragDelta) ? multiDragDelta.dx : 0;
  const mdDy = (!isDragging && isSelected && multiDragDelta) ? multiDragDelta.dy : 0;
  const dx = (localDragPos?.x ?? cardX) + mdDx;
  const dy = (localDragPos?.y ?? cardY) + mdDy;
  const border = isHighlighted
    ? `2px solid ${c.accent.primary}`
    : isSelected ? '2px solid #3b82f6' : `1px solid ${c.border.strong}`;
  const shadow = isDragging ? c.shadow.lg : isSelected ? `0 0 0 1px #3b82f6, ${c.shadow.md}` : c.shadow.sm;

  const runLabel = confirming
    ? `Run ${selectedIds.length} now?`
    : selectedIds.length === items.length
      ? `Run all ${items.length}`
      : `Run ${selectedIds.length} selected`;

  return (
    <Box
      data-select-type="missed-runs-card"
      data-select-id="missed-runs"
      onPointerDownCapture={(e: React.PointerEvent) => {
        const target = e.target as HTMLElement;
        if (target.closest('[data-no-drag]')) return;
        onBringToFront?.('missed-runs', 'missed_runs');
      }}
      onClick={(e: React.MouseEvent) => {
        if (justDraggedRef.current) return;
        const target = e.target as HTMLElement;
        if (target.closest('[data-no-drag]')) return;
        onCardSelect?.('missed-runs', 'missed_runs', e.shiftKey);
      }}
      sx={{
        position: 'absolute',
        contain: 'layout style',
        willChange: 'transform',
        left: dx,
        top: dy,
        width: cardWidth,
        height: cardHeight,
        bgcolor: c.bg.surface,
        border,
        borderRadius: 3,
        boxShadow: shadow,
        display: 'flex',
        flexDirection: 'column',
        zIndex: isDragging ? 999999 : cardZOrder,
        transition: isDragging ? 'none' : 'box-shadow 0.3s ease, border-color 0.2s ease',
      }}
    >
      {/* Title strip (drag handle) */}
      <Box
        onPointerDown={onHeaderPointerDown}
        onPointerMove={onHeaderPointerMove}
        onPointerUp={onHeaderPointerUp}
        sx={{
          display: 'flex', alignItems: 'center', gap: 0.6,
          px: 1.5, py: 0.7,
          borderBottom: `1px solid ${c.border.subtle}`,
          cursor: isDragging ? 'grabbing' : 'grab',
          touchAction: 'none', userSelect: 'none', flexShrink: 0,
        }}
      >
        <HistoryRoundedIcon sx={{ fontSize: 17, color: c.accent.primary }} />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontWeight: 600, fontSize: '0.95rem', color: c.text.primary }}>Missed while you were away</Typography>
          <Typography sx={{ fontSize: '0.72rem', color: c.text.muted }}>
            {items.length} run{items.length === 1 ? '' : 's'} didn&apos;t fire. Run the ones you still want.
          </Typography>
        </Box>
        <IconButton
          size="small"
          data-no-drag
          onClick={(e) => { e.stopPropagation(); closeAndDismissRest(); }}
          onPointerDown={(e) => e.stopPropagation()}
          sx={{ p: 0.5, color: c.text.ghost, '&:hover': { color: c.status.error, bgcolor: c.status.errorBg } }}
        >
          <CloseIcon sx={{ fontSize: 16 }} />
        </IconButton>
      </Box>

      {/* Scrollable list grouped by workflow */}
      <Box sx={{ flex: 1, overflowY: 'auto', px: 1, py: 0.5 }}>
        {groups.map((g) => {
          const checkedCount = g.runs.filter((r) => !unchecked.has(r.id)).length;
          const allChecked = checkedCount === g.runs.length;
          return (
          <Box key={g.title + g.runs[0].workflow_id} sx={{ mb: 0.75 }}>
            <Box
              data-no-drag
              onClick={() => toggleGroup(g.runs)}
              sx={{ display: 'flex', alignItems: 'center', gap: 0.4, px: 0.75, py: 0.4, borderRadius: `${c.radius.sm}px`, cursor: 'pointer', '&:hover': { bgcolor: c.bg.elevated } }}
            >
              <Checkbox
                size="small"
                checked={allChecked}
                indeterminate={checkedCount > 0 && !allChecked}
                onChange={() => toggleGroup(g.runs)}
                onClick={(e) => e.stopPropagation()}
                sx={{ p: 0.25, color: c.text.muted, '&.Mui-checked': { color: c.accent.primary }, '&.MuiCheckbox-indeterminate': { color: c.accent.primary } }}
              />
              <Typography sx={{ fontSize: '0.82rem', fontWeight: 700, color: c.accent.primary, flexShrink: 0 }}>{g.runs.length}</Typography>
              <Typography sx={{ fontSize: '0.82rem', fontWeight: 600, color: c.text.secondary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.title}</Typography>
            </Box>
            {g.runs.map((m) => (
              <Box
                key={m.id}
                data-no-drag
                onClick={() => toggle(m.id)}
                sx={{
                  display: 'flex', alignItems: 'center', gap: 0.4,
                  pl: 1, pr: 0.75, py: 0.15, ml: 1.5,
                  borderRadius: `${c.radius.sm}px`, cursor: 'pointer',
                  '&:hover': { bgcolor: c.bg.elevated },
                }}
              >
                <Checkbox
                  size="small"
                  checked={!unchecked.has(m.id)}
                  onChange={() => toggle(m.id)}
                  onClick={(e) => e.stopPropagation()}
                  sx={{ p: 0.25, color: c.text.muted, '&.Mui-checked': { color: c.accent.primary } }}
                />
                <Typography sx={{ fontSize: '0.78rem', color: c.text.primary }}>{formatWhen(m.scheduled_for)}</Typography>
              </Box>
            ))}
          </Box>
          );
        })}
      </Box>

      {/* Footer actions */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, px: 1.25, py: 0.85, borderTop: `1px solid ${c.border.subtle}`, flexShrink: 0 }}>
        {confirming && (
          <Typography sx={{ fontSize: '0.72rem', color: c.text.muted, flex: 1 }}>
            That&apos;s {selectedIds.length} real runs.
          </Typography>
        )}
        {!confirming && <Box sx={{ flex: 1 }} />}
        <Box
          data-no-drag
          role="button"
          onClick={confirming ? () => setConfirming(false) : closeAndDismissRest}
          sx={{ fontSize: '0.78rem', color: c.text.muted, cursor: 'pointer', px: 1, py: 0.5, '&:hover': { color: c.text.primary } }}
        >
          {confirming ? 'Cancel' : 'Skip all'}
        </Box>
        <Box
          data-no-drag
          role="button"
          onClick={runSelected}
          sx={{
            fontSize: '0.78rem', fontWeight: 600,
            color: selectedIds.length === 0 ? c.text.ghost : '#fff',
            bgcolor: selectedIds.length === 0 ? c.bg.secondary : c.accent.primary,
            cursor: selectedIds.length === 0 ? 'default' : 'pointer',
            px: 1.25, py: 0.5, borderRadius: `${c.radius.md}px`,
            '&:hover': { bgcolor: selectedIds.length === 0 ? c.bg.secondary : c.accent.hover },
          }}
        >
          {runLabel}
        </Box>
      </Box>
    </Box>
  );
};

export default MissedRunsCard;
