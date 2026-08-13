import React from 'react';
import { Trans, useTranslation } from 'react-i18next';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

interface Props {
  kind?: 'browser' | 'app';
}

// Shown when a browser/app card is rendered OUTSIDE Electron (the dev URL opened directly in a web browser). The real <webview> only exists in the desktop app; rather than a crippled <iframe> the agent can't drive, tell the user to launch correctly.
const RunInDesktopMessage: React.FC<Props> = ({ kind = 'browser' }) => {
  const { t } = useTranslation();
  // Interpolated into the body sentence, so it has to be declined per language rather than concatenated.
  const noun = t(kind === 'app' ? 'common.runInDesktop.nounApps' : 'common.runInDesktop.nounBrowsers');
  return (
    <Box
      sx={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 1,
        px: 3,
        textAlign: 'center',
        color: '#888',
        userSelect: 'none',
      }}
    >
      <Typography sx={{ fontSize: '0.95rem', fontWeight: 600, color: '#bbb' }}>
        {t('common.runInDesktop.title')}
      </Typography>
      <Typography sx={{ fontSize: '0.82rem', lineHeight: 1.5, maxWidth: 360 }}>
        {/* Trans, not t(): the body wraps the shell command in <code>, which a plain string cannot carry. */}
        <Trans i18nKey="common.runInDesktop.body" values={{ noun }} components={{ cmd: <code /> }} />
      </Typography>
    </Box>
  );
};

export default RunInDesktopMessage;
