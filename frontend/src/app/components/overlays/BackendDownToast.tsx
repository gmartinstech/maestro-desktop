// Shown when Electron's bounded backend restart gave up: without it the window keeps rendering while every request fails, so the app looks alive and answers nothing. Self-contained state (one main-process event, no server round-trip) so a dead backend cannot stop the notice from appearing.

import React from 'react';
import Snackbar from '@mui/material/Snackbar';
import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Button from '@mui/material/Button';
import { useTranslation } from 'react-i18next';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import { shell } from '@/shared/shell';

export default function BackendDownToast() {
  const c = useClaudeTokens();
  const { t } = useTranslation();
  const [attempts, setAttempts] = React.useState<number | null>(null);

  React.useEffect(() => {
    return shell.onBackendUnrecoverable((info: { attempts: number }) => setAttempts(info?.attempts ?? 0));
  }, []);

  return (
    <Snackbar
      open={attempts !== null}
      autoHideDuration={null}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
    >
      <Alert
        severity="error"
        sx={{ bgcolor: c.bg.surface, color: c.text.primary, border: `1px solid ${c.border.medium}`, maxWidth: 520 }}
        action={
          <>
            <Button size="small" onClick={() => shell.openBackendLogs()} sx={{ color: c.text.muted }}>
              {t('overlays.backendDown.viewLogs')}
            </Button>
            <Button size="small" onClick={() => shell.restartApp()} sx={{ color: c.accent.primary, fontWeight: 700 }}>
              {t('overlays.backendDown.restart')}
            </Button>
          </>
        }
      >
        <AlertTitle>{t('overlays.backendDown.title')}</AlertTitle>
        {t('overlays.backendDown.body', { count: attempts ?? 0 })}
      </Alert>
    </Snackbar>
  );
}
