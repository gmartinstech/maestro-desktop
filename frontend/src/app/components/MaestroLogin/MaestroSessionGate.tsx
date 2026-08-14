import React, { useEffect } from 'react';
import Snackbar from '@mui/material/Snackbar';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import { useTranslation } from 'react-i18next';
import { useAppDispatch, useAppSelector } from '@/shared/hooks';
import {
  dismissMaestroWarning,
  fetchMaestroTokenStatus,
  startMaestroLogin,
} from '@/shared/state/maestroSlice';

/** Re-checks the token roughly every quarter hour, which is fine-grained enough for a 30-minute warning. */
const RECHECK_MS = 15 * 60 * 1000;

/** Gates the first turn on a usable Maestro token, and warns quietly before a live one dies.
 *
 * Mounted beside the routes so it runs before the user can open a chat: on boot the status
 * lands, and a missing/expired token automatically kicks off the Keycloak login in the system
 * browser instead of making the user click through a Settings detour. The status call is
 * local (backend decodes the JWT `exp` offline), so nothing here touches the gateway.
 */
const MaestroSessionGate: React.FC = () => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const status = useAppSelector((s) => s.maestro.status);
  const loaded = useAppSelector((s) => s.maestro.loaded);
  const autoTriggered = useAppSelector((s) => s.maestro.autoTriggered);
  const loginInFlight = useAppSelector((s) => s.maestro.loginInFlight);
  const warningDismissed = useAppSelector((s) => s.maestro.warningDismissed);
  const state = status?.state;

  useEffect(() => {
    dispatch(fetchMaestroTokenStatus());
    const id = window.setInterval(() => dispatch(fetchMaestroTokenStatus()), RECHECK_MS);
    // Returning to the app after a while is exactly when a 10-hour token has died underneath us.
    const onFocus = () => dispatch(fetchMaestroTokenStatus());
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('focus', onFocus);
    };
  }, [dispatch]);

  // Auto-open the system browser for a dead token, once per missing/expired streak; the
  // 15-minute recheck above would otherwise reopen a browser tab on every poll while the
  // user is mid-login. A manual "Sign in again" click always fires regardless of the flag.
  useEffect(() => {
    if (loaded && (state === 'missing' || state === 'expired') && !autoTriggered && !loginInFlight) {
      dispatch(startMaestroLogin());
    }
  }, [loaded, state, autoTriggered, loginInFlight, dispatch]);

  const needsLogin = state === 'missing' || state === 'expired';
  const showWarning = state === 'expiring' && !warningDismissed;

  return (
    <>
      <Snackbar open={needsLogin} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}>
        <Alert
          severity="info"
          variant="outlined"
          action={
            <Button
              size="small"
              onClick={() => dispatch(startMaestroLogin())}
              sx={{ textTransform: 'none' }}
            >
              {t('maestro.signIn.retry')}
            </Button>
          }
          sx={{ bgcolor: 'background.paper' }}
        >
          {state === 'expired' ? t('maestro.signIn.introExpired') : t('maestro.signIn.introMissing')}
        </Alert>
      </Snackbar>
      <Snackbar
        open={showWarning}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        onClose={() => dispatch(dismissMaestroWarning())}
      >
        <Alert
          severity="warning"
          variant="outlined"
          onClose={() => dispatch(dismissMaestroWarning())}
          action={
            <Button
              size="small"
              onClick={() => dispatch(startMaestroLogin())}
              sx={{ textTransform: 'none' }}
            >
              {t('maestro.warning.action')}
            </Button>
          }
          sx={{ bgcolor: 'background.paper' }}
        >
          {t('maestro.warning.message', { minutes: status?.expires_in_minutes ?? 0 })}
        </Alert>
      </Snackbar>
    </>
  );
};

export default MaestroSessionGate;
