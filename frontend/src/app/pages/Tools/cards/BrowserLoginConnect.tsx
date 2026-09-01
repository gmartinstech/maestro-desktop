import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import LinkIcon from '@mui/icons-material/Link';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import RefreshIcon from '@mui/icons-material/Refresh';
import { API_BASE } from '@/shared/config';
import { getBrowserEngineMode } from '@/shared/browserEngineMode';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import { Integration } from '../integrations';

type Status = 'unknown' | 'connected' | 'disconnected';
const POLL_MS = 5000;
const MAX_POLLS = 24;

// Bare allowlist domain from the login URL (x.com, reddit.com, tiktok.com); www. is stripped so it matches the cookie bridge's allowlist.
function sessionDomain(loginUrl: string | undefined): string {
  if (!loginUrl) return '';
  try {
    return new URL(loginUrl).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

interface Props {
  ig: Integration;
  isDisabled: boolean;
}

// BRW-6: under MAESTRO_BROWSER_ENGINE=cdp there is no Electron webview/partition to open a login
// page in, so "Sign in" instead POSTs to the engine's /api/browser-session/login (cookies.ts),
// which launches a REAL VISIBLE external Chromium window (not the screencast-canvas BrowserCard
// uses) and captures cookies once sign-in completes. Read once at module load, same posture as
// BrowserCard.tsx's own useCdpEngine (a mid-session flip needs a rebuild+relaunch either way).
const cdpEngineMode = getBrowserEngineMode() === 'cdp';

// "Sign in" affordance for the session-borrow MCPs (reddit/x/tiktok): shows a live signed-in
// indicator driven by the cookie bridge (electron: Electron's partition via readPartitionCookies;
// cdp: this ticket's engine-native capture). Under electron mode, sign-in is a real <a href> so
// AppShell's document click handler navigates to a dashboard and opens the (embedded-webview)
// browser card, no duplicated open logic here -- unchanged from before this ticket. Under cdp
// mode there is no such card to open into, so the button instead triggers the visible-window
// capture flow directly (see handleCdpSignIn below).
const BrowserLoginConnect: React.FC<Props> = ({ ig, isDisabled }) => {
  const c = useClaudeTokens();
  const { t } = useTranslation();
  const [status, setStatus] = useState<Status>('unknown');
  const [pending, setPending] = useState(false);
  const [starting, setStarting] = useState(false);
  const domain = sessionDomain(ig.loginUrl);
  const alive = useRef(true);
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);

  const check = useCallback(async (): Promise<boolean> => {
    if (!domain) return false;
    try {
      // t= busts the renderer's 1s GET cache so the signed-in state is always live, not a stale hit.
      const res = await fetch(`${API_BASE}/browser-session/status?domain=${encodeURIComponent(domain)}&t=${Date.now()}`);
      const data = await res.json();
      const connected = !!data.connected;
      if (alive.current) {
        setStatus(connected ? 'connected' : 'disconnected');
        // `pending` only ever appears in the cdp-mode engine's response (cookies.ts) -- electron
        // mode's status payload (backend/main.py) has no such field, so this is always false there.
        setPending(!!data.pending);
      }
      return connected;
    } catch {
      if (alive.current) { setStatus('disconnected'); setPending(false); }
      return false;
    }
  }, [domain]);

  const handleCdpSignIn = useCallback(async () => {
    if (!domain || !ig.loginUrl || starting) return;
    setStarting(true);
    try {
      await fetch(`${API_BASE}/browser-session/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain, loginUrl: ig.loginUrl }),
      });
    } catch {
      // Best-effort: a failed start just leaves the button re-clickable; the status poll below
      // never flips to connected/pending, so nothing silently hangs.
    } finally {
      if (alive.current) setStarting(false);
    }
    check();
  }, [domain, ig.loginUrl, starting, check]);

  useEffect(() => {
    alive.current = true;
    let n = 0;
    const stop = () => { if (poll.current) { clearInterval(poll.current); poll.current = null; } };
    check();
    poll.current = setInterval(async () => {
      n += 1;
      const connected = await check();
      if (connected || n >= MAX_POLLS) stop();
    }, POLL_MS);
    return () => { alive.current = false; stop(); };
  }, [check]);

  if (isDisabled || !domain) return null;

  if (status === 'connected') {
    return (
      <Tooltip title={t('tools.browserLogin.recheck')}>
        <Chip
          icon={<CheckCircleIcon sx={{ fontSize: 12 }} />}
          label={t('tools.browserLogin.signedIn')}
          size="small"
          onClick={(e) => { e.stopPropagation(); check(); }}
          sx={{ bgcolor: c.status.successBg, color: c.status.success, fontSize: '0.7rem', height: 22, '& .MuiChip-icon': { color: c.status.success }, flexShrink: 0 }}
        />
      </Tooltip>
    );
  }

  if (cdpEngineMode && (pending || starting)) {
    return (
      <Tooltip title={t('tools.browserLogin.recheck')}>
        <Chip
          icon={<CircularProgress size={12} sx={{ color: ig.color }} />}
          label={t('tools.browserLogin.connecting')}
          size="small"
          onClick={(e) => { e.stopPropagation(); check(); }}
          sx={{ bgcolor: `${ig.color}15`, color: ig.color, fontSize: '0.7rem', height: 22, flexShrink: 0 }}
        />
      </Tooltip>
    );
  }

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0 }}>
      <Tooltip title={ig.connectInstructions || ''}>
        {cdpEngineMode ? (
          // No Electron webview/partition to open a login page in under cdp mode -- a plain
          // button that triggers the visible-external-Chromium capture flow (handleCdpSignIn)
          // instead of a real <a href> AppShell's anchor handler would otherwise route into the
          // (screencast-canvas) browser card, which is exactly the flow BRW-6 says NOT to use here.
          <Button
            component="button"
            onClick={handleCdpSignIn}
            size="small"
            variant="outlined"
            startIcon={<LinkIcon sx={{ fontSize: 14 }} />}
            sx={{ borderColor: `${ig.color}40`, color: ig.color, '&:hover': { borderColor: ig.color, bgcolor: `${ig.color}10` }, textTransform: 'none', fontSize: '0.78rem', borderRadius: 1.5, py: 0.5, flexShrink: 0 }}
          >
            {ig.connectLabel || t('tools.browserLogin.signIn')}
          </Button>
        ) : (
          <Button
            component="a"
            href={ig.loginUrl}
            size="small"
            variant="outlined"
            startIcon={<LinkIcon sx={{ fontSize: 14 }} />}
            sx={{ borderColor: `${ig.color}40`, color: ig.color, '&:hover': { borderColor: ig.color, bgcolor: `${ig.color}10` }, textTransform: 'none', fontSize: '0.78rem', borderRadius: 1.5, py: 0.5, flexShrink: 0 }}
          >
            {ig.connectLabel || t('tools.browserLogin.signIn')}
          </Button>
        )}
      </Tooltip>
      <Tooltip title={t('tools.browserLogin.recheck')}>
        <IconButton size="small" onClick={(e) => { e.stopPropagation(); check(); }} sx={{ color: c.text.ghost }}>
          <RefreshIcon sx={{ fontSize: 14 }} />
        </IconButton>
      </Tooltip>
    </Box>
  );
};

export default BrowserLoginConnect;
