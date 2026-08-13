import React, { useState } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { useTranslation } from 'react-i18next';
import { useAppDispatch, useAppSelector } from '@/shared/hooks';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import { PROVEDOR_IA_LOGIN_URL } from '@/shared/config';
import {
  closeProvedorIaPrompt,
  setProvedorIaSubmitError,
  submitProvedorIaToken,
} from '@/shared/state/provedorIaSlice';

/** The sign-in prompt for provedor-ia: open the login page in the system browser, paste the code back.
 *
 * Deliberately NOT an OAuth flow. `provedor-ia-web` has PKCE mandatory, device code
 * disabled, and no loopback redirect URI registered, so a real in-app authorization-code
 * flow is rejected by Keycloak today (docs/PROVEDOR_IA.md). This is the flow that works,
 * shaped so the OAuth upgrade replaces the browser+paste half and nothing else.
 */
const ProvedorIaLoginDialog: React.FC = () => {
  const c = useClaudeTokens();
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const open = useAppSelector((s) => s.provedorIa.promptOpen);
  const state = useAppSelector((s) => s.provedorIa.status?.state);
  const submitting = useAppSelector((s) => s.provedorIa.submitting);
  const submitError = useAppSelector((s) => s.provedorIa.submitError);
  const [pasted, setPasted] = useState('');

  const openLoginPage = () => {
    const api = (window as any).maestro;
    if (api?.openExternal) api.openExternal(PROVEDOR_IA_LOGIN_URL);
    else window.open(PROVEDOR_IA_LOGIN_URL, '_blank');
  };

  const submit = () => {
    const token = pasted.trim();
    if (!token) {
      dispatch(setProvedorIaSubmitError('missing'));
      return;
    }
    // The backend is the only judge of whether the paste is usable, and the only place it is stored.
    dispatch(submitProvedorIaToken(token)).then((action) => {
      if (submitProvedorIaToken.fulfilled.match(action)) setPasted('');
    });
  };

  const errorText = submitError
    ? t(`provedorIa.signIn.error${submitError.charAt(0).toUpperCase()}${submitError.slice(1)}`)
    : '';

  return (
    <Dialog
      open={open}
      onClose={() => dispatch(closeProvedorIaPrompt())}
      maxWidth="sm"
      fullWidth
    >
      <DialogTitle sx={{ fontSize: '1.05rem', fontWeight: 600 }}>
        {t('provedorIa.signIn.title')}
      </DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        <Typography sx={{ fontSize: '0.88rem', color: c.text.secondary, lineHeight: 1.55 }}>
          {state === 'expired' ? t('provedorIa.signIn.introExpired') : t('provedorIa.signIn.introMissing')}
        </Typography>
        <Box component="ol" sx={{ m: 0, pl: 2.5, display: 'flex', flexDirection: 'column', gap: 0.6 }}>
          {['step1', 'step2', 'step3'].map((step) => (
            <Typography
              key={step}
              component="li"
              sx={{ fontSize: '0.85rem', color: c.text.secondary, lineHeight: 1.5 }}
            >
              {t(`provedorIa.signIn.${step}`)}
            </Typography>
          ))}
        </Box>
        <Button
          variant="contained"
          startIcon={<OpenInNewIcon />}
          onClick={openLoginPage}
          sx={{ alignSelf: 'flex-start', textTransform: 'none', borderRadius: `${c.radius.md}px` }}
        >
          {t('provedorIa.signIn.openBrowser')}
        </Button>
        <TextField
          label={t('provedorIa.signIn.pasteLabel')}
          placeholder={t('provedorIa.signIn.pastePlaceholder')}
          value={pasted}
          onChange={(e) => setPasted(e.target.value)}
          multiline
          minRows={3}
          maxRows={6}
          error={Boolean(submitError)}
          helperText={errorText}
          fullWidth
          // A credential in a plain field: never autofilled, never spellchecked, never carried to another install.
          autoComplete="off"
          spellCheck={false}
          inputProps={{ 'data-testid': 'provedor-ia-token-input' }}
        />
        <Typography sx={{ fontSize: '0.78rem', color: c.text.tertiary, lineHeight: 1.5 }}>
          {t('provedorIa.signIn.privacy')}
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button
          data-testid="provedor-ia-later"
          onClick={() => dispatch(closeProvedorIaPrompt())}
          sx={{ textTransform: 'none', color: c.text.secondary }}
        >
          {t('provedorIa.signIn.later')}
        </Button>
        <Button
          variant="contained"
          onClick={submit}
          disabled={submitting}
          sx={{ textTransform: 'none', borderRadius: `${c.radius.md}px` }}
        >
          {t('provedorIa.signIn.submit')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default ProvedorIaLoginDialog;
