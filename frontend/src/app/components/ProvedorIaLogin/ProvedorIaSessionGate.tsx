import React, { useEffect } from 'react';
import Snackbar from '@mui/material/Snackbar';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import { useTranslation } from 'react-i18next';
import { useAppDispatch, useAppSelector } from '@/shared/hooks';
import {
  dismissProvedorIaWarning,
  fetchProvedorIaTokenStatus,
  openProvedorIaPrompt,
} from '@/shared/state/provedorIaSlice';
import ProvedorIaLoginDialog from './ProvedorIaLoginDialog';

/** Re-checks the token roughly every quarter hour, which is fine-grained enough for a 30-minute warning. */
const RECHECK_MS = 15 * 60 * 1000;

/** Gates the first turn on a usable provedor-ia token, and warns quietly before a live one dies.
 *
 * Mounted beside the routes so it runs before the user can open a chat: on boot the status
 * lands, and a missing/expired token opens the sign-in prompt straight away instead of letting
 * them discover it by burning a turn. The status call is local (backend decodes the JWT `exp`
 * offline), so nothing here touches the gateway.
 */
const ProvedorIaSessionGate: React.FC = () => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const status = useAppSelector((s) => s.provedorIa.status);
  const loaded = useAppSelector((s) => s.provedorIa.loaded);
  const promptOpen = useAppSelector((s) => s.provedorIa.promptOpen);
  const warningDismissed = useAppSelector((s) => s.provedorIa.warningDismissed);
  const state = status?.state;

  useEffect(() => {
    dispatch(fetchProvedorIaTokenStatus());
    const id = window.setInterval(() => dispatch(fetchProvedorIaTokenStatus()), RECHECK_MS);
    // Returning to the app after a while is exactly when a 10-hour token has died underneath us.
    const onFocus = () => dispatch(fetchProvedorIaTokenStatus());
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('focus', onFocus);
    };
  }, [dispatch]);

  useEffect(() => {
    if (loaded && (state === 'missing' || state === 'expired')) dispatch(openProvedorIaPrompt());
  }, [loaded, state, dispatch]);

  const showWarning = state === 'expiring' && !warningDismissed && !promptOpen;
  return (
    <>
      <ProvedorIaLoginDialog />
      <Snackbar
        open={showWarning}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        onClose={() => dispatch(dismissProvedorIaWarning())}
      >
        <Alert
          severity="warning"
          variant="outlined"
          onClose={() => dispatch(dismissProvedorIaWarning())}
          action={
            <Button
              size="small"
              onClick={() => dispatch(openProvedorIaPrompt())}
              sx={{ textTransform: 'none' }}
            >
              {t('provedorIa.warning.action')}
            </Button>
          }
          sx={{ bgcolor: 'background.paper' }}
        >
          {t('provedorIa.warning.message', { minutes: status?.expires_in_minutes ?? 0 })}
        </Alert>
      </Snackbar>
    </>
  );
};

export default ProvedorIaSessionGate;
