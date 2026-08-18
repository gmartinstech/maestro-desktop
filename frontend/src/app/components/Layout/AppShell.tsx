import React, { useState, useEffect, useRef, useCallback, startTransition, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { openSettingsModal } from '@/shared/state/settingsSlice';
import { getLastInteractedBrowser, getKeepAliveBrowserIds, setLastInteractedBrowser, clearLastInteractedBrowser } from '@/shared/browserFocus';
import { getWebview } from '@/shared/browserRegistry';
import { applyBrowserZoom } from '@/shared/browserZoom';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Collapse from '@mui/material/Collapse';
import Button from '@mui/material/Button';
import Snackbar from '@mui/material/Snackbar';
import Alert from '@mui/material/Alert';
import { ArrowLeft, ArrowRight, Menu as MenuIcon } from 'lucide-react';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import SystemUpdateAltIcon from '@mui/icons-material/SystemUpdateAlt';
import CloseIcon from '@mui/icons-material/Close';
import LinearProgress from '@mui/material/LinearProgress';
import CircularProgress from '@mui/material/CircularProgress';
// Settings modal lazy-loaded so its 2.3K LOC + Stripe/OAuth helpers don't ship on first paint.
const Settings = React.lazy(() => import('@/app/pages/Settings/Settings'));
import DynamicIsland from '@/app/components/overlays/DynamicIsland';
import BackendDownToast from '@/app/components/overlays/BackendDownToast';
import Dashboard from '@/app/pages/Dashboard/Dashboard';
import DashboardHost from '@/app/components/Layout/DashboardHost';
import { useLastDashboardId } from '@/shared/hooks/useLastDashboardId';
import { useAppDispatch, useAppSelector } from '@/shared/hooks';
import { shallowEqual } from 'react-redux';
import { fetchDashboards, createDashboard } from '@/shared/state/dashboardsSlice';
import { setPendingFocusAgentId } from '@/shared/state/tempStateSlice';
import { addBrowserCard, addBrowserTab, cycleBrowserTab, reopenLastClosed } from '@/shared/state/dashboardLayoutSlice';
import { setPendingBrowserUrl } from '@/shared/state/tempStateSlice';
import { setInstalling } from '@/shared/state/updateSlice';
import { findBrowserByWebContentsId } from '@/shared/browserRegistry';
import { byPreviewRecency } from '@/shared/previewOrder';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import { AlertGlyph } from '@/app/components/feedback/AlertGlyph';

// macOS insets its traffic lights into our bar, so the left gutter is reserved there and
// nowhere else; Windows/Linux instead reserve a right gutter for the native button overlay.
const IS_MAC = ((window as any).maestro?.platform ?? 'darwin') === 'darwin';
const TITLEBAR_HEIGHT = 38;
const TRAFFIC_LIGHT_GUTTER = 78;
// Win11's minimise/maximise/close overlay is ~138px; the trailing cluster must clear it.
const WINDOW_CONTROLS_GUTTER = 138;

const UPDATE_DISMISS_KEY = 'maestro-update-dismissed';

const AppShell: React.FC = () => {
  const { t } = useTranslation();
  const c = useClaudeTokens();
  const dispatch = useAppDispatch();
  const navigateRaw = useNavigate();
  // startTransition wrapper: route swap becomes non-urgent so click handler returns immediately; eliminates the "click, wait, page appears" gap on slow routes.
  const navigate = useMemo(() => {
    const fn = (...args: Parameters<typeof navigateRaw>) => {
      startTransition(() => {
        (navigateRaw as any)(...args);
      });
    };
    return fn as typeof navigateRaw;
  }, [navigateRaw]);
  const location = useLocation();
  // React Router (HashRouter) stores a monotonic index in history state. location re-renders on every nav, by which point window.history.state.idx is updated.
  const historyIdx = (window.history.state?.idx as number | undefined) ?? 0;
  const maxHistoryIdx = useRef(0);
  maxHistoryIdx.current = Math.max(maxHistoryIdx.current, historyIdx);
  const canGoBack = historyIdx > 0;
  const canGoForward = historyIdx < maxHistoryIdx.current;
  const updateStatus = useAppSelector((state) => state.update.status);
  const availableVersion = useAppSelector((state) => state.update.availableVersion);
  const downloadPercent = useAppSelector((state) => state.update.downloadPercent);
  const installing = useAppSelector((state) => state.update.installing);
  // Windows' Squirrel never reports a version, and a mid-download cache-clear reload wipes it, so render the name version-less instead of "Maestro Studio null".
  const verSuffix = availableVersion ? ` ${availableVersion}` : '';

  const [dismissedVersion, setDismissedVersion] = useState<string | null>(() => {
    try { return localStorage.getItem(UPDATE_DISMISS_KEY); } catch { return null; }
  });
  const [snackbarDismissed, setSnackbarDismissed] = useState(false);

  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  const fullscreenCardId = useAppSelector((s) => s.tempState.fullscreenCardId);
  const modelsLoaded = useAppSelector((s) => s.models.loaded);
  // "Connected" = the user's OWN model (key/sub/custom), NOT a non-empty /models list.
  // Subscriptions alone was a false negative for anyone whose only provider is a custom one: Maestro
  // is reached as custom/maestro/<model>, so a signed-in user with a working model was still told
  // "no AI model connected" forever, with the banner's own link sending them to a Settings tab that
  // already showed the provider present.
  const hasModelConnected = useAppSelector((s) => {
    const subs = s.subscriptions.status;
    if (subs?.subscriptions && Object.keys(subs.subscriptions).length > 0) return true;
    const cfg = s.settings.data;
    if ((cfg.custom_providers || []).some((cp) => (cp?.name || '').trim())) return true;
    return Boolean(cfg.anthropic_api_key || cfg.openai_api_key || cfg.google_api_key || cfg.openrouter_api_key);
  });
  const showWarningBanner = !isOnline || (modelsLoaded && !hasModelConnected);

  const bannerDismissedForVersion = availableVersion != null && dismissedVersion === availableVersion;
  const isUpdateActionable = updateStatus === 'available' || updateStatus === 'downloaded' || updateStatus === 'downloading';

  const showUpdateBanner = isUpdateActionable && !bannerDismissedForVersion;
  const showUpdateSnackbar = (updateStatus === 'available' || updateStatus === 'downloaded') && !bannerDismissedForVersion && !snackbarDismissed;

  const handleDismissBanner = useCallback(() => {
    if (availableVersion) {
      try { localStorage.setItem(UPDATE_DISMISS_KEY, availableVersion); } catch {}
      setDismissedVersion(availableVersion);
    }
  }, [availableVersion]);

  const handleDownloadUpdate = useCallback(async () => {
    try { await (window as any).maestro?.downloadUpdate(); } catch {}
  }, []);

  const handleInstallUpdate = useCallback(() => {
    if (installing) return;
    dispatch(setInstalling());
    (window as any).maestro?.installUpdate();
  }, [installing, dispatch]);

  // shallowEqual on top-level Immer dicts: nested mutations bump the dict reference, causing AppShell to re-render on every rename/output bump despite identical structure.
  const dashboardItems = useAppSelector(
    (state) => state.dashboards.items,
    shallowEqual,
  );
  const dashboardList = React.useMemo(
    () => Object.values(dashboardItems).sort(byPreviewRecency),
    [dashboardItems],
  );

  useEffect(() => {
    dispatch(fetchDashboards());
  }, [dispatch]);

  // Idle-prefetch the lazy Settings chunk so click-to-open is instant; requestIdleCallback avoids fighting first-paint.
  useEffect(() => {
    const ric = (window as any).requestIdleCallback || ((cb: () => void) => setTimeout(cb, 1500));
    const handle = ric(() => {
      import('@/app/pages/Settings/Settings').catch(() => {});
    }, { timeout: 3000 });
    return () => {
      const cic = (window as any).cancelIdleCallback || clearTimeout;
      try { cic(handle); } catch {}
    };
  }, []);

  const openUrlInBrowser = useCallback((url: string, webContentsId?: number, background?: boolean) => {
    const dashMatch = location.pathname.match(/^\/dashboard\/(.+)/);
    if (dashMatch) {
      if (webContentsId != null) {
        const browserId = findBrowserByWebContentsId(webContentsId);
        if (browserId) {
          // Middle-click / background-tab disposition: add the tab but don't steal focus from the current one, like a real browser.
          dispatch(addBrowserTab({ browserId, url, makeActive: !background }));
          return;
        }
      }
      dispatch(addBrowserCard({ url }));
    } else {
      dispatch(setPendingBrowserUrl(url));
      const lastId = (window as any).__maestro_last_dashboard_id as string | undefined;
      const firstDashboard = dashboardList[0];
      const targetId = lastId || firstDashboard?.id;
      if (targetId) {
        navigate(`/dashboard/${targetId}`);
      } else {
        dispatch(createDashboard('Untitled Dashboard')).then((result: any) => {
          if (createDashboard.fulfilled.match(result)) {
            navigate(`/dashboard/${result.payload.id}`);
          }
        });
      }
    }
  }, [location.pathname, dashboardList, dispatch, navigate]);

  useEffect(() => {
    let lastUrl = '';
    let lastTime = 0;

    const handleClick = (e: MouseEvent) => {
      const anchor = (e.target as HTMLElement)?.closest?.('a');
      if (!anchor) return;
      const href = anchor.getAttribute('href');
      if (!href) return;
      if (!/^https?:\/\//i.test(href)) return;
      if (href.startsWith('http://localhost:')) return;

      e.preventDefault();
      e.stopPropagation();

      const now = Date.now();
      if (href === lastUrl && now - lastTime < 1000) return;
      lastUrl = href;
      lastTime = now;

      openUrlInBrowser(href);
    };

    document.addEventListener('click', handleClick, true);
    return () => document.removeEventListener('click', handleClick, true);
  }, [openUrlInBrowser]);

  useEffect(() => {
    const w = window as any;
    if (!w.maestro?.onWebviewNewWindow) return;
    let lastUrl = '';
    let lastTime = 0;
    return w.maestro.onWebviewNewWindow((url: string, webContentsId: number, disposition?: string) => {
      const now = Date.now();
      if (url === lastUrl && now - lastTime < 1000) return;
      lastUrl = url;
      lastTime = now;
      openUrlInBrowser(url, webContentsId, disposition === 'background-tab');
    });
  }, [openUrlInBrowser]);

  // Track the browser card the user last touched. Chrome clicks land on this document; a webview PAGE click can't reach it, so BrowserCard reports those via the app-clicked IPC. Clearing on any non-browser-card click is what makes Ctrl+R fall back to reloading the app.
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const card = (e.target as HTMLElement | null)?.closest?.('[data-select-type="browser-card"]') as HTMLElement | null;
      if (card) setLastInteractedBrowser(card.getAttribute('data-select-id') || '');
      else clearLastInteractedBrowser();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, []);

  // Cmd/Ctrl+R: main neutralizes the default-menu reload and hands us the decision. Reload the browser you're in or last used IN PLACE (keeps its login); only when no browser is open at all fall back to a full app reload, since reloading the renderer destroys every webview and wipes its session. To deliberately reload Maestro itself, use View > Reload.
  useEffect(() => {
    const w = window as any;
    if (!w.maestro?.onReloadShortcut) return;
    return w.maestro.onReloadShortcut(() => {
      for (const id of [getLastInteractedBrowser(), ...getKeepAliveBrowserIds()]) {
        const wv = id ? getWebview(id) : undefined;
        if (wv) { try { wv.reload(); return; } catch (_e) { /* torn-down webview; try the next */ } }
      }
      window.location.reload();
    });
  }, []);

  // Zoom / find / tab-cycle from a focused browser GUEST (keydowns inside a webview can't reach this document, so main forwards them with the guest's id). Targets that exact browser; the host-focused counterparts live in the keydown below + useCanvasControls (zoom).
  useEffect(() => {
    const w = window as any;
    if (!w.maestro?.onBrowserShortcut) return;
    return w.maestro.onBrowserShortcut((payload: { action: string; webContentsId: number }) => {
      // Reopen-last-closed is global (no target browser), so handle it before the per-browser id guard.
      if (payload.action === 'reopen-closed') { dispatch(reopenLastClosed()); return; }
      const id = findBrowserByWebContentsId(payload.webContentsId) ?? getLastInteractedBrowser();
      if (!id) return;
      switch (payload.action) {
        case 'zoom-in': applyBrowserZoom(id, 1); break;
        case 'zoom-out': applyBrowserZoom(id, -1); break;
        case 'zoom-reset': applyBrowserZoom(id, 0); break;
        case 'find': window.dispatchEvent(new CustomEvent('maestro:browser-find', { detail: { browserId: id } })); break;
        case 'tab-next': dispatch(cycleBrowserTab({ browserId: id, dir: 1 })); break;
        case 'tab-prev': dispatch(cycleBrowserTab({ browserId: id, dir: -1 })); break;
      }
    });
  }, [dispatch]);

  // Host-focused Ctrl/Cmd+F (find) and Ctrl+Tab (cycle) when a browser is the last thing you touched. Zoom keys aren't here: they share the +/-/0 keys with canvas zoom, so useCanvasControls owns that branch.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const id = getLastInteractedBrowser();
      // Require a LIVE webview: a stale id (its card was closed) means no browser is focused, so let the canvas shortcuts (e.g. card-search Cmd+F) handle the key instead.
      if (!id || !getWebview(id)) return;
      const t = e.target as HTMLElement | null;
      const typing = t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || !!t?.isContentEditable;
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && (e.key || '').toLowerCase() === 'f' && !typing) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('maestro:browser-find', { detail: { browserId: id } }));
      } else if (e.ctrlKey && !e.metaKey && !e.altKey && e.key === 'Tab') {
        e.preventDefault();
        dispatch(cycleBrowserTab({ browserId: id, dir: e.shiftKey ? -1 : 1 }));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [dispatch]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail || {};
      const { sessionId, dashboardId } = detail as { sessionId?: string; dashboardId?: string };
      if (!sessionId) return;
      if (dashboardId) {
        navigate(`/dashboard/${dashboardId}`);
      }
      dispatch(setPendingFocusAgentId(sessionId));
    };
    window.addEventListener('maestro:notification-click', handler as EventListener);
    return () => window.removeEventListener('maestro:notification-click', handler as EventListener);
  }, [navigate, dispatch]);

  // Anchor the native menu to the button's bottom-left so it drops like a normal menu.
  const handleOpenAppMenu = useCallback((e: React.MouseEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    try { (window as any).maestro?.popupAppMenu(r.left, r.bottom); } catch {}
  }, []);

  // The OS paints the window-button strip, so it can't inherit our CSS; push the
  // resolved chrome tokens whenever the theme flips or it strands on stale colors.
  useEffect(() => {
    try { (window as any).maestro?.setTitleBarOverlay(c.bg.secondary, c.text.secondary); } catch {}
  }, [c.bg.secondary, c.text.secondary]);

  const isDashboardViewActive = location.pathname.startsWith('/dashboard/');

  const [lastDashboardId, setLastDashboardId] = useLastDashboardId();

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh', bgcolor: c.bg.secondary }}>
      <Box
        sx={{
          height: TITLEBAR_HEIGHT,
          flexShrink: 0,
          bgcolor: 'transparent',
          display: 'flex',
          alignItems: 'center',
          position: 'relative',
          overflow: 'visible',
          WebkitAppRegion: 'drag',
          userSelect: 'none',
          pl: IS_MAC ? `${TRAFFIC_LIGHT_GUTTER}px` : '8px',
          // Nothing renders in the trailing region any more, but the inset stays so the native button overlay keeps its reserved strip.
          pr: IS_MAC ? 1.5 : `${WINDOW_CONTROLS_GUTTER}px`,
          gap: 0.25,
        }}
      >
        {/* Brand leads the bar; it holds no controls, so it stays inside the drag region rather than punching a no-drag hole. */}
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 0.75,
            flexShrink: 0,
            mr: 1.25,
          }}
        >
          <Box
            component="img"
            src="./maestro-mark.png"
            alt=""
            sx={{ width: 20, height: 20, flexShrink: 0, display: 'block' }}
          />
          <Typography
            sx={{
              color: c.text.secondary,
              fontSize: '0.9rem',
              fontWeight: 600,
              letterSpacing: 0.2,
              lineHeight: 1,
              whiteSpace: 'nowrap',
            }}
          >
            {t('appShell.appTitle')}
          </Typography>
        </Box>
        {!IS_MAC && (
          <Tooltip title={t('appShell.menuTooltip')}>
            <IconButton
              size="small"
              onClick={handleOpenAppMenu}
              aria-label={t('appShell.applicationMenuAriaLabel')}
              sx={{
                WebkitAppRegion: 'no-drag',
                color: c.text.tertiary,
                p: 0.5,
                borderRadius: 1,
                '&:hover': { color: c.text.secondary, bgcolor: `${c.text.tertiary}14` },
              }}
            >
              <MenuIcon size={18} />
            </IconButton>
          </Tooltip>
        )}
        <Tooltip title={t('appShell.back')}>
          {/* span wrapper so a disabled button still shows its Tooltip; lucide
              glyph + hover-slide kept from the redesign, disabled-state from #68. */}
          <span>
            <IconButton
              size="small"
              onClick={() => navigate(-1)}
              disabled={!canGoBack}
              sx={{
                WebkitAppRegion: 'no-drag',
                color: c.text.tertiary,
                p: 0.5,
                borderRadius: 1,
                '& svg': { transition: 'transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)' },
                '&:hover': { color: c.text.secondary, bgcolor: `${c.text.tertiary}14` },
                '&:hover svg': { transform: 'translateX(-2px)' },
              }}
            >
              <ArrowLeft size={18} />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title={t('appShell.forward')}>
          <span>
            <IconButton
              size="small"
              onClick={() => navigate(1)}
              disabled={!canGoForward}
              sx={{
                WebkitAppRegion: 'no-drag',
                color: c.text.tertiary,
                p: 0.5,
                borderRadius: 1,
                '& svg': { transition: 'transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)' },
                '&:hover': { color: c.text.secondary, bgcolor: `${c.text.tertiary}14` },
                '&:hover svg': { transform: 'translateX(2px)' },
              }}
            >
              <ArrowRight size={18} />
            </IconButton>
          </span>
        </Tooltip>

        {!fullscreenCardId && <DynamicIsland />}

        <Box sx={{ flex: 1 }} />
      </Box>

      <Collapse in={showWarningBanner} timeout={350} unmountOnExit>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1.5,
            px: 2,
            py: 0.6,
            bgcolor: 'rgba(239, 68, 68, 0.08)',
            borderBottom: '1px solid rgba(239, 68, 68, 0.18)',
            flexShrink: 0,
            animation: showWarningBanner ? 'warning-fade-in 0.4s ease-out' : undefined,
            '@keyframes warning-fade-in': {
              from: { opacity: 0 },
              to: { opacity: 1 },
            },
          }}
        >
          <AlertGlyph size={22} tone="error" />
          <Typography sx={{ fontSize: '0.86rem', color: c.status.error, flex: 1, fontWeight: 500, letterSpacing: '0.01em' }}>
            {!isOnline
              ? t('appShell.offlineWarning')
              : (
                <>
                  {t('appShell.noModelConnected')}{' '}
                  <Box
                    component="span"
                    onClick={() => dispatch(openSettingsModal('models'))}
                    sx={{
                      textDecoration: 'underline',
                      cursor: 'pointer',
                      fontWeight: 600,
                      '&:hover': { opacity: 0.8 },
                      transition: 'opacity 0.15s',
                    }}
                  >
                    {t('appShell.configureModels')}
                  </Box>
                  {' '}{t('appShell.toGetStarted')}
                </>
              )}
          </Typography>
        </Box>
      </Collapse>

      {showUpdateBanner && (
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1.5,
            px: 2,
            py: 0.5,
            bgcolor: `${c.accent.primary}14`,
            borderBottom: `1px solid ${c.accent.primary}30`,
            flexShrink: 0,
          }}
        >
          <SystemUpdateAltIcon sx={{ fontSize: 16, color: c.accent.primary, flexShrink: 0 }} />
          <Typography sx={{ fontSize: '0.8rem', color: c.text.secondary, flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {updateStatus === 'available' && t('appShell.updateAvailable', { verSuffix })}
            {updateStatus === 'downloading' && t('appShell.updateDownloading', { verSuffix })}
            {updateStatus === 'downloaded' && t('appShell.updateDownloaded', { verSuffix })}
          </Typography>
          {updateStatus === 'downloading' && (
            <LinearProgress
              variant="determinate"
              value={downloadPercent}
              sx={{
                width: 120,
                height: 3,
                flexShrink: 0,
                borderRadius: 2,
                bgcolor: `${c.accent.primary}20`,
                '& .MuiLinearProgress-bar': { bgcolor: c.accent.primary, borderRadius: 2 },
              }}
            />
          )}
          {updateStatus === 'downloading' && (
            <Typography sx={{ fontSize: '0.72rem', color: c.text.tertiary, flexShrink: 0 }}>
              {Math.round(downloadPercent)}%
            </Typography>
          )}
          {updateStatus === 'available' && (
            <Button
              size="small"
              variant="contained"
              onClick={handleDownloadUpdate}
              sx={{
                bgcolor: c.accent.primary,
                '&:hover': { bgcolor: c.accent.pressed },
                textTransform: 'none',
                fontSize: '0.75rem',
                fontWeight: 600,
                borderRadius: 1.5,
                minWidth: 'auto',
                py: 0.25,
                px: 1.5,
                lineHeight: 1.5,
                flexShrink: 0,
              }}
            >
              {t('common.download')}
            </Button>
          )}
          {updateStatus === 'downloaded' && (
            <Button
              size="small"
              variant="contained"
              onClick={handleInstallUpdate}
              disabled={installing}
              startIcon={installing ? <CircularProgress size={12} sx={{ color: '#fff' }} /> : undefined}
              sx={{
                bgcolor: c.accent.primary,
                '&:hover': { bgcolor: c.accent.pressed },
                '&.Mui-disabled': { bgcolor: c.accent.primary, color: '#fff', opacity: 0.7 },
                textTransform: 'none',
                fontSize: '0.75rem',
                fontWeight: 600,
                borderRadius: 1.5,
                minWidth: 'auto',
                py: 0.25,
                px: 1.5,
                lineHeight: 1.5,
                flexShrink: 0,
              }}
            >
              {installing ? t('common.restarting') : t('common.restartAndUpdate')}
            </Button>
          )}
          <IconButton
            size="small"
            onClick={handleDismissBanner}
            sx={{ color: c.text.tertiary, p: 0.25, flexShrink: 0, '&:hover': { color: c.text.secondary } }}
          >
            <CloseIcon sx={{ fontSize: 14 }} />
          </IconButton>
        </Box>
      )}

      <Box sx={{ display: 'flex', flex: 1, minHeight: 0 }}>

      <Box sx={{
        flex: 1,
        overflow: 'hidden',
        bgcolor: c.bg.page,
        position: 'relative',
        // Float the content as a rounded inset panel ("column pill"): the chrome (bg.secondary) frames it, so there are no divider lines, just air + radius.
        mt: '6px',
        mr: '6px',
        mb: '6px',
        ml: '6px',
        borderRadius: '14px',
      }}>
        {/* Hidden (not unmounted) when the dashboard view is active so the persistent Dashboard layered above can take over. */}
        <Box
          sx={{
            position: 'absolute',
            inset: 0,
            visibility: isDashboardViewActive ? 'hidden' : 'visible',
            pointerEvents: isDashboardViewActive ? 'none' : 'auto',
          }}
        >
          <Outlet />
        </Box>

        {/* CSS-hidden on other routes so webviews + state survive nav. */}
        {lastDashboardId && (
          <DashboardHost visible={isDashboardViewActive}>
            <Dashboard dashboardId={lastDashboardId} isActive={isDashboardViewActive} />
          </DashboardHost>
        )}
      </Box>
      </Box>

      <React.Suspense fallback={null}>
        <Settings />
      </React.Suspense>

      <Snackbar
        open={showUpdateSnackbar}
        autoHideDuration={10000}
        onClose={() => setSnackbarDismissed(true)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          severity="info"
          icon={updateStatus === 'downloaded'
            ? <RestartAltIcon sx={{ fontSize: 18 }} />
            : <SystemUpdateAltIcon sx={{ fontSize: 18 }} />
          }
          action={
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
              <Button
                size="small"
                onClick={() => setSnackbarDismissed(true)}
                sx={{ color: c.text.muted, textTransform: 'none', fontSize: '0.8rem', minWidth: 'auto' }}
              >
                {t('common.dismiss')}
              </Button>
              {updateStatus === 'available' && (
                <Button
                  size="small"
                  variant="contained"
                  onClick={handleDownloadUpdate}
                  sx={{
                    bgcolor: c.accent.primary,
                    '&:hover': { bgcolor: c.accent.pressed },
                    textTransform: 'none',
                    fontSize: '0.8rem',
                    borderRadius: 1.5,
                    minWidth: 'auto',
                  }}
                >
                  {t('common.download')}
                </Button>
              )}
              {updateStatus === 'downloaded' && (
                <Button
                  size="small"
                  variant="contained"
                  onClick={handleInstallUpdate}
                  disabled={installing}
                  startIcon={installing ? <CircularProgress size={12} sx={{ color: '#fff' }} /> : undefined}
                  sx={{
                    bgcolor: c.accent.primary,
                    '&:hover': { bgcolor: c.accent.pressed },
                    '&.Mui-disabled': { bgcolor: c.accent.primary, color: '#fff', opacity: 0.7 },
                    textTransform: 'none',
                    fontSize: '0.8rem',
                    borderRadius: 1.5,
                    minWidth: 'auto',
                  }}
                >
                  {installing ? t('common.restarting') : t('common.restartAndUpdate')}
                </Button>
              )}
            </Box>
          }
          sx={{
            bgcolor: c.bg.surface,
            color: c.text.primary,
            border: `1px solid ${c.border.medium}`,
            boxShadow: c.shadow.md,
            '& .MuiAlert-icon': { color: c.accent.primary },
          }}
        >
          {updateStatus === 'available' && t('appShell.updateAvailable', { verSuffix })}
          {updateStatus === 'downloaded' && t('appShell.updateDownloadedSnackbar', { verSuffix })}
        </Alert>
      </Snackbar>
      {/* App-wide, not dashboard-scoped: a dead backend can strand the user on any page */}
      <BackendDownToast />
    </Box>
  );
};

export default AppShell;
