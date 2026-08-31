import React, { useState, useRef, useEffect, useCallback } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import InputBase from '@mui/material/InputBase';
import SmartToyOutlinedIcon from '@mui/icons-material/SmartToyOutlined';
import GridViewRoundedIcon from '@mui/icons-material/GridViewRounded';
import LanguageIcon from '@mui/icons-material/Language';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import { Settings as LucideSettings, Plus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import { useAppDispatch, useAppSelector } from '@/shared/hooks';
import { shallowEqual } from 'react-redux';
import DashboardGlyph from './DashboardGlyph';
import ShareButton from '@/app/components/share/ShareButton';
import CanvasControls from '../controls/CanvasControls';
import type { MinimapProps } from '../controls/Minimap';
import type { AgentSession } from '@/shared/state/agentsSlice';
import { saveLayout, viewCardKey } from '@/shared/state/dashboardLayoutSlice';
import type { CardPosition, ViewCardPosition, BrowserCardPosition, NotePosition, WorkflowCardPosition, WorkflowsHubPosition } from '@/shared/state/dashboardLayoutSlice';
import type { Output } from '@/shared/state/outputsSlice';
import type { CanvasActions } from '../hooks/interaction/pointer/useCanvasControls';
import { fetchDashboards, createDashboard, renameDashboard } from '@/shared/state/dashboardsSlice';
import { openSettingsModal } from '@/shared/state/settingsSlice';
import { byPreviewRecency } from '@/shared/previewOrder';
import { useTranslation } from 'react-i18next';
import { friendlyStatusLabel } from '@/shared/statusLabel';

interface DashboardHeaderProps {
  dashboardName: string | undefined;
  sessions: Record<string, AgentSession>;
  cards: Record<string, CardPosition>;
  viewCards: Record<string, ViewCardPosition>;
  browserCards: Record<string, BrowserCardPosition>;
  workflowCards: Record<string, WorkflowCardPosition>;
  workflowsHub: WorkflowsHubPosition | null;
  notes: Record<string, NotePosition>;
  expandedSessionIds: string[];
  outputs: Record<string, Output>;
  dashboardId: string | undefined;
  canvasActions: CanvasActions;
  onHighlightCard?: (cardId: string) => void;
  zoom: number;
  onFitToView: () => void;
  onTidy: () => void;
  minimapProps: Omit<MinimapProps, 'onPan'>;
  onMinimapPan: (panX: number, panY: number) => void;
}

const STATUS_DOT: Record<string, string> = {
  running: '#22c55e',
  waiting_approval: '#f59e0b',
  completed: '#94a3b8',
  error: '#ef4444',
  stopped: '#94a3b8',
  draft: '#6366f1',
};

const DashboardHeader: React.FC<DashboardHeaderProps> = ({
  dashboardName,
  sessions,
  cards,
  viewCards,
  browserCards,
  workflowCards,
  workflowsHub,
  notes,
  expandedSessionIds,
  outputs,
  dashboardId,
  canvasActions,
  onHighlightCard,
  zoom,
  onFitToView,
  onTidy,
  minimapProps,
  onMinimapPan,
}) => {
  const c = useClaudeTokens();
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  // Flushed alongside the other collections on Share export; not threaded as a prop since this is the only place in this component that needs it.
  const elements = useAppSelector((state) => state.dashboardLayout.elements);
  const [expanded, setExpanded] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [renamingDashboardId, setRenamingDashboardId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const updateStatus = useAppSelector((state) => state.update.status);
  const showUpdateDot = updateStatus === 'available' || updateStatus === 'downloaded';

  // shallowEqual on top-level Immer dicts: nested mutations bump the dict reference on every rename/output bump despite identical structure.
  const dashboardItems = useAppSelector((state) => state.dashboards.items, shallowEqual);
  const dashboardList = React.useMemo(
    () => Object.values(dashboardItems).sort(byPreviewRecency),
    [dashboardItems],
  );

  useEffect(() => {
    dispatch(fetchDashboards());
  }, [dispatch]);

  const handleDashboardItemClick = useCallback((id: string) => {
    if (renamingDashboardId === id) return;
    navigate(`/dashboard/${id}`);
    setExpanded(false);
  }, [renamingDashboardId, navigate]);

  const handleStartDashboardRename = useCallback((id: string, currentName: string) => {
    setRenamingDashboardId(id);
    setRenameValue(currentName);
  }, []);

  const handleDashboardRenameSubmit = useCallback((id: string) => {
    const trimmed = renameValue.trim();
    const previousName = dashboardItems[id]?.name;
    if (trimmed && trimmed !== previousName) {
      dispatch(renameDashboard({ id, name: trimmed, previousName }));
    }
    setRenamingDashboardId(null);
  }, [renameValue, dashboardItems, dispatch]);

  const handleCreateDashboard = useCallback(async (e?: React.MouseEvent) => {
    e?.stopPropagation();
    const result = await dispatch(createDashboard('Untitled Dashboard'));
    if (createDashboard.fulfilled.match(result)) {
      navigate(`/dashboard/${result.payload.id}`);
      setExpanded(false);
    }
  }, [dispatch, navigate]);

  const agentItems = Object.values(cards)
    .map((card) => {
      const session = sessions[card.session_id];
      if (!session || session.status === 'draft') return null;
      return { id: card.session_id, name: session.name, status: session.status, model: session.model, card };
    })
    .filter(Boolean) as Array<{ id: string; name: string; status: string; model: string; card: CardPosition }>;

  const viewItems = Object.values(viewCards)
    .map((vc) => {
      const output = outputs[vc.output_id];
      if (!output) return null;
      const label = (vc.instance ?? 1) > 1 ? `${output.name} #${vc.instance}` : output.name;
      return { id: viewCardKey(vc.output_id, vc.instance), name: label, card: vc };
    })
    .filter(Boolean) as Array<{ id: string; name: string; card: ViewCardPosition }>;

  const browserItems = Object.values(browserCards).map((bc) => {
    const activeTab = bc.tabs.find((t) => t.id === bc.activeTabId);
    return {
      id: bc.browser_id,
      title: activeTab?.title || t('dashboard.browserCard.newTab'),
      url: activeTab?.url || bc.url,
      card: bc,
    };
  });

  // The dashboard switcher is always in the dropdown now, so the title stays clickable even on an empty canvas.
  const canOpen = true;

  useEffect(() => {
    if (!expanded) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setExpanded(false);
      }
    };
    const timer = setTimeout(() => document.addEventListener('mousedown', handleClickOutside), 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [expanded]);

  const handleFocus = useCallback(
    (cardId: string, card: { x: number; y: number; width: number; height: number }) => {
      canvasActions.fitToCards([card], 1.15, true);
      onHighlightCard?.(cardId);
      setExpanded(false);
    },
    [canvasActions, onHighlightCard],
  );

  const toggle = useCallback(() => {
    if (canOpen) setExpanded((v) => !v);
  }, [canOpen]);

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, width: '100%' }}>
    <Box ref={containerRef} sx={{ position: 'relative', display: 'inline-flex', flexDirection: 'column' }}>
      <Box
        onClick={toggle}
        data-testid="dashboard-header-toggle"
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.75,
          // macOS-toolbar vibrancy: a faint translucent material + blur so the title stays legible over the dot grid without a hard box.
          bgcolor: expanded ? c.bg.surface : `${c.bg.surface}40`,
          backdropFilter: 'blur(16px) saturate(180%)',
          WebkitBackdropFilter: 'blur(16px) saturate(180%)',
          borderRadius: '6px',
          py: 0.5,
          px: 0.75,
          cursor: canOpen ? 'pointer' : 'default',
          userSelect: 'none',
          transition: 'background-color 0.12s ease',
          '&:hover': canOpen ? { bgcolor: `${c.bg.surface}99` } : {},
        }}
      >
        <Box sx={{ display: 'flex', flexShrink: 0 }}>
          <DashboardGlyph name={dashboardName} size={16} />
        </Box>
        <Typography
          noWrap
          sx={{
            fontSize: '0.9rem',
            fontWeight: 600,
            color: c.text.primary,
            lineHeight: 1,
            maxWidth: 320,
          }}
        >
          {dashboardName || t('dashboard.defaultName')}
        </Typography>
        <KeyboardArrowDownIcon
          sx={{
            fontSize: 18,
            color: c.text.tertiary,
            transition: 'transform 0.28s cubic-bezier(0.34, 1.56, 0.64, 1)',
            transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
            ml: 0.25,
          }}
        />
        {dashboardId && (
          <Box sx={{ ml: 0.25, display: 'flex' }}>
            <ShareButton
              target={{ kind: 'dashboard', id: dashboardId, name: dashboardName || t('dashboard.defaultName') }}
              iconFontSize={15}
              onOpen={() => {
                // Layout saves are debounced, so a just-added app/agent card may not be on disk yet. The export reads disk, flush the live layout now so Share captures the current board, not a stale one.
                if (!dashboardId) return;
                dispatch(saveLayout({ dashboardId, cards, viewCards, browserCards, workflowCards, workflowsHub, notes, elements, expandedSessionIds }));
              }}
            />
          </Box>
        )}
      </Box>

      {/* Dropdown overlay */}
      {canOpen && (
        <Box
          sx={{
            position: 'absolute',
            top: '100%',
            left: 0,
            zIndex: 100,
            minWidth: 280,
            maxWidth: 360,
            maxHeight: expanded ? 460 : 0,
            overflow: 'hidden',
            transition: 'max-height 0.25s ease-in-out',
          }}
        >
          <Box
            sx={{
              mt: 0.5,
              bgcolor: c.bg.surface,
              border: `1px solid ${c.border.medium}`,
              borderRadius: `${c.radius.lg}px`,
              boxShadow: c.shadow.md,
              py: 0.75,
              overflowY: 'auto',
              maxHeight: 440,
            }}
          >
            <CategoryGroup icon={<GridViewRoundedIcon />} label={t('appShell.dashboards')} count={dashboardList.length} c={c}>
              {dashboardList.map((entry) => {
                const isActive = entry.id === dashboardId;
                const isRenaming = renamingDashboardId === entry.id;
                return (
                  <Box
                    key={entry.id}
                    onClick={() => handleDashboardItemClick(entry.id)}
                    data-testid="dashboard-header-item"
                    data-dashboard-id={entry.id}
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 0.75,
                      px: 1.5,
                      pl: 3.25,
                      py: isRenaming ? 0.25 : 0.4,
                      mx: 0.5,
                      cursor: isRenaming ? 'default' : 'pointer',
                      borderRadius: 0.5,
                      bgcolor: isActive ? `${c.accent.primary}18` : 'transparent',
                      '&:hover': { bgcolor: isActive ? `${c.accent.primary}22` : c.bg.secondary },
                      transition: 'background-color 0.1s',
                    }}
                  >
                    {isRenaming ? (
                      <InputBase
                        autoFocus
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onBlur={() => handleDashboardRenameSubmit(entry.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleDashboardRenameSubmit(entry.id);
                          if (e.key === 'Escape') setRenamingDashboardId(null);
                        }}
                        onClick={(e) => e.stopPropagation()}
                        onFocus={(e) => e.target.select()}
                        sx={{
                          flex: 1,
                          minWidth: 0,
                          fontSize: '0.8rem',
                          color: c.text.primary,
                          py: 0,
                          px: 0.5,
                          borderRadius: 0.75,
                          border: `1px solid ${c.accent.primary}80`,
                          bgcolor: c.bg.page,
                          '& input': { padding: '1px 0' },
                        }}
                      />
                    ) : (
                      <Typography
                        noWrap
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          handleStartDashboardRename(entry.id, entry.name);
                        }}
                        sx={{
                          fontSize: '0.8rem',
                          color: isActive ? c.text.primary : c.text.secondary,
                          fontWeight: isActive ? 600 : 400,
                          flex: 1,
                          minWidth: 0,
                        }}
                      >
                        {entry.name}
                      </Typography>
                    )}
                  </Box>
                );
              })}
              <ItemRow onClick={handleCreateDashboard} c={c}>
                <Plus size={14} style={{ flexShrink: 0 }} />
                <Typography data-testid="dashboard-header-new-dashboard" sx={{ fontSize: '0.8rem', color: c.text.secondary }}>
                  {t('appShell.newDashboard')}
                </Typography>
              </ItemRow>
            </CategoryGroup>

            {agentItems.length > 0 && (
              <CategoryGroup icon={<SmartToyOutlinedIcon />} label={t('dashboard.header.agents')} count={agentItems.length} c={c}>
                {agentItems.map((item) => (
                  <ItemRow key={item.id} onClick={() => handleFocus(item.id, item.card)} c={c}>
                    <Box
                      sx={{
                        width: 7,
                        height: 7,
                        borderRadius: '50%',
                        bgcolor: STATUS_DOT[item.status] || c.text.tertiary,
                        flexShrink: 0,
                        mt: '1px',
                      }}
                    />
                    <Typography
                      noWrap
                      sx={{ fontSize: '0.8rem', color: c.text.primary, flex: 1, minWidth: 0 }}
                    >
                      {item.name}
                    </Typography>
                    <Typography
                      sx={{ fontSize: '0.7rem', color: c.text.ghost, flexShrink: 0 }}
                    >
                      {friendlyStatusLabel(item.status, t)}
                    </Typography>
                  </ItemRow>
                ))}
              </CategoryGroup>
            )}

            {viewItems.length > 0 && (
              <CategoryGroup icon={<GridViewRoundedIcon />} label={t('dashboard.header.views')} count={viewItems.length} c={c}>
                {viewItems.map((item) => (
                  <ItemRow key={item.id} onClick={() => handleFocus(item.id, item.card)} c={c}>
                    <Typography
                      noWrap
                      sx={{ fontSize: '0.8rem', color: c.text.primary, flex: 1, minWidth: 0 }}
                    >
                      {item.name}
                    </Typography>
                  </ItemRow>
                ))}
              </CategoryGroup>
            )}

            {browserItems.length > 0 && (
              <CategoryGroup icon={<LanguageIcon />} label={t('dashboard.header.browsers')} count={browserItems.length} c={c}>
                {browserItems.map((item) => (
                  <ItemRow key={item.id} onClick={() => handleFocus(item.id, item.card)} c={c}>
                    <Typography
                      noWrap
                      sx={{ fontSize: '0.8rem', color: c.text.primary, flex: 1, minWidth: 0 }}
                    >
                      {item.title}
                    </Typography>
                    <Typography
                      noWrap
                      sx={{ fontSize: '0.68rem', color: c.text.ghost, maxWidth: 120, flexShrink: 0 }}
                    >
                      {cleanUrl(item.url)}
                    </Typography>
                  </ItemRow>
                ))}
              </CategoryGroup>
            )}
          </Box>
        </Box>
      )}
    </Box>

    <Box sx={{ flex: 1 }} />

    <CanvasControls
      zoom={zoom}
      actions={canvasActions}
      onFitToView={onFitToView}
      onTidy={onTidy}
      minimapProps={minimapProps}
      onMinimapPan={onMinimapPan}
    />

    <Tooltip title={t('common.settings')}>
      <IconButton
        size="small"
        onClick={() => dispatch(openSettingsModal())}
        data-testid="dashboard-header-settings-button"
        sx={{
          color: c.text.tertiary,
          p: 0.5,
          borderRadius: 1,
          position: 'relative',
          '&:hover': { color: c.text.secondary, bgcolor: `${c.text.tertiary}14` },
        }}
      >
        <LucideSettings size={17} />
        {showUpdateDot && (
          <Box
            sx={{
              position: 'absolute',
              top: 2,
              right: 2,
              width: 7,
              height: 7,
              borderRadius: '50%',
              bgcolor: c.accent.primary,
              border: `1.5px solid ${c.bg.surface}`,
            }}
          />
        )}
      </IconButton>
    </Tooltip>
    </Box>
  );
};

function cleanUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname + (u.pathname !== '/' ? u.pathname : '');
  } catch {
    return url;
  }
}

const CategoryGroup: React.FC<{
  icon: React.ReactNode;
  label: string;
  count: number;
  c: ReturnType<typeof useClaudeTokens>;
  children: React.ReactNode;
}> = ({ icon, label, count, c, children }) => (
  <Box sx={{ '&:not(:first-of-type)': { borderTop: `1px solid ${c.border.subtle}`, mt: 0.5, pt: 0.5 } }}>
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 0.75,
        px: 1.5,
        py: 0.5,
      }}
    >
      <Box sx={{ display: 'flex', color: c.text.tertiary, '& > svg': { fontSize: 15 } }}>{icon}</Box>
      <Typography sx={{ fontSize: '0.72rem', fontWeight: 600, color: c.text.tertiary, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {label}
      </Typography>
      <Typography sx={{ fontSize: '0.68rem', color: c.text.ghost }}>
        {count}
      </Typography>
    </Box>
    {children}
  </Box>
);

const ItemRow: React.FC<{
  onClick: () => void;
  c: ReturnType<typeof useClaudeTokens>;
  children: React.ReactNode;
}> = ({ onClick, c, children }) => (
  <Box
    onClick={onClick}
    sx={{
      display: 'flex',
      alignItems: 'center',
      gap: 0.75,
      px: 1.5,
      pl: 3.25,
      py: 0.4,
      cursor: 'pointer',
      borderRadius: 0.5,
      mx: 0.5,
      '&:hover': { bgcolor: c.bg.secondary },
      transition: 'background-color 0.1s',
    }}
  >
    {children}
  </Box>
);

export default React.memo(DashboardHeader);
