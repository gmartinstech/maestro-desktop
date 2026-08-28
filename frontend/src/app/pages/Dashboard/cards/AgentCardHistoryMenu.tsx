import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import ListItemText from '@mui/material/ListItemText';
import InputBase from '@mui/material/InputBase';
import HistoryRoundedIcon from '@mui/icons-material/HistoryRounded';
import SearchIcon from '@mui/icons-material/Search';
import { useAppSelector } from '@/shared/hooks';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import { displaySessionName } from '@/shared/state/sessionDisplay';
import type { AgentSession, HistorySession } from '@/shared/state/agentsSlice';

interface Props {
  dashboardId: string;
  currentSessionId: string;
  onSelect: (sessionId: string) => void;
}

interface Entry {
  id: string;
  name: string;
  // Recency key for sorting: closed_at (most recently finished) falling back to created_at. HistorySession has no updated_at field.
  recencyKey: string;
}

const MAX_ENTRIES = 30;
// Stable empty fallbacks so a closed menu's selectors return the same reference every render, instead of resubscribing this card to every session/history mutation on the dashboard while its own menu is shut.
const EMPTY_HISTORY: Record<string, HistorySession> = {};
const EMPTY_SESSIONS: Record<string, AgentSession> = {};

const AgentCardHistoryMenu: React.FC<Props> = ({ dashboardId, currentSessionId, onSelect }) => {
  const { t } = useTranslation();
  const c = useClaudeTokens();
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [query, setQuery] = useState('');
  const isOpen = Boolean(anchorEl);
  const history = useAppSelector((s) => (isOpen ? s.agents.history : EMPTY_HISTORY));
  const sessions = useAppSelector((s) => (isOpen ? s.agents.sessions : EMPTY_SESSIONS));

  // closed_at alone is an unreliable liveness signal (a resumed session's history entry can go stale until the next fetchHistory refetch), so anything present in sessions - the actual live set - is excluded outright, regardless of what its history snapshot's closed_at says. mode exclusion mirrors reconcileSessions' admission rule for browser-agent/sub-agent/invoked-agent runs (see useDashboardLifecycle.ts); workflow-linked sessions can't be filtered here since HistorySession carries no workflow_run_id/workflow_edit_id - handleSwitchSession checks those against the real resumed session data instead.
  const entries = useMemo<Entry[]>(() => {
    if (!isOpen) return [];
    const q = query.trim().toLowerCase();
    return Object.values(history)
      .filter((h) => h.id !== currentSessionId && h.dashboard_id === dashboardId && !sessions[h.id])
      .filter((h) => h.mode !== 'browser-agent' && h.mode !== 'sub-agent' && h.mode !== 'invoked-agent')
      .map((h): Entry => ({ id: h.id, name: displaySessionName(h.name), recencyKey: h.closed_at || h.created_at }))
      .filter((e) => !q || e.name.toLowerCase().includes(q))
      .sort((a, b) => b.recencyKey.localeCompare(a.recencyKey))
      .slice(0, MAX_ENTRIES);
  }, [history, sessions, dashboardId, currentSessionId, query, isOpen]);

  return (
    <>
      <Tooltip title={t('dashboard.agentCard.switchChat')}>
        <IconButton
          size="small"
          onClick={(e) => { e.stopPropagation(); setAnchorEl(e.currentTarget); }}
          onMouseDown={(e) => e.stopPropagation()}
          sx={{ color: c.text.ghost, p: 0.5, '&:hover': { color: c.text.primary } }}
        >
          <HistoryRoundedIcon sx={{ fontSize: 16 }} />
        </IconButton>
      </Tooltip>
      <Menu
        anchorEl={anchorEl}
        open={isOpen}
        onClose={() => { setAnchorEl(null); setQuery(''); }}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: { width: 320, maxHeight: 400 } } }}
        autoFocus={false}
        MenuListProps={{ autoFocusItem: false }}
      >
        <Box
          onKeyDown={(e) => { if (e.key !== 'Escape') e.stopPropagation(); }}
          sx={{ px: 1.5, py: 1, display: 'flex', alignItems: 'center', gap: 0.75, borderBottom: `1px solid ${c.border.subtle}` }}
        >
          <SearchIcon sx={{ fontSize: 15, color: c.text.ghost }} />
          <InputBase
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            placeholder={t('dashboard.agentCard.searchChats')}
            sx={{ fontSize: '0.8rem', flex: 1 }}
          />
        </Box>
        {entries.length === 0 ? (
          <MenuItem disabled>
            <ListItemText primary={t('dashboard.agentCard.noOtherChats')} />
          </MenuItem>
        ) : (
          entries.map((entry) => (
            <MenuItem
              key={entry.id}
              onClick={() => {
                onSelect(entry.id);
                setAnchorEl(null);
                setQuery('');
              }}
            >
              <ListItemText
                primary={entry.name}
                slotProps={{ primary: { sx: { fontSize: '0.82rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } } }}
              />
            </MenuItem>
          ))
        )}
      </Menu>
    </>
  );
};

export default React.memo(AgentCardHistoryMenu);
