import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import TextField from '@mui/material/TextField';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import { API_BASE } from '@/shared/config';
import type { SettingsStyles } from '../settingsStyles';

const ERASE_WORD = 'ERASE';

// The iOS Reset menu, two actions only: "Reset All Settings" (preferences back to defaults, your stuff + sign-in stay) and "Erase All Content and Settings" (factory wipe + relaunch). Flat rows, not a boxed "danger zone": red lives only on the destructive label, and the real friction is the typed-confirm in the dialog.
const DataPrivacySection: React.FC<{ styles: SettingsStyles }> = ({ styles }) => {
  const c = useClaudeTokens();
  const { t } = useTranslation();
  const { sectionSx, labelSx, descSx } = styles;

  const [resetOpen, setResetOpen] = useState(false);
  const [eraseOpen, setEraseOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [eraseText, setEraseText] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [clearOpen, setClearOpen] = useState(false);
  const [clearedOk, setClearedOk] = useState(false);

  const closeAll = () => {
    if (busy) return;
    setResetOpen(false);
    setEraseOpen(false);
    setClearOpen(false);
    setClearedOk(false);
    setEraseText('');
    setErr(null);
  };

  const doReset = async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`${API_BASE}/settings/reset-to-defaults`, { method: 'POST' });
      if (!res.ok) throw new Error(String(res.status));
      // Reload so every slice + local component state re-syncs from the now-default backend; no stale flag can survive a full renderer reload.
      window.location.reload();
    } catch {
      setBusy(false);
      setErr(t('settings.general.dataPrivacy.resetError'));
    }
  };

  const doErase = async () => {
    const api = window.maestro;
    if (!api?.hardReset) {
      setErr(t('settings.general.dataPrivacy.desktopOnly'));
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await api.hardReset(); // the app exits + relaunches, so this normally never resolves.
    } catch {
      setBusy(false);
      setErr(t('settings.general.dataPrivacy.eraseError'));
    }
  };

  const doClearBrowser = async () => {
    const api = window.maestro;
    if (!api?.clearBrowserData) {
      setErr(t('settings.general.dataPrivacy.desktopOnly'));
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await api.clearBrowserData();
      setBusy(false);
      setClearedOk(true);
    } catch {
      setBusy(false);
      setErr(t('settings.general.dataPrivacy.clearError'));
    }
  };

  const dialogPaperSx = {
    bgcolor: c.bg.surface,
    border: `1px solid ${c.border.subtle}`,
    borderRadius: 2.5,
    maxWidth: 360,
  };
  const titleSx = { color: c.text.primary, fontSize: '0.95rem', fontWeight: 600, mb: 1 };
  const bodySx = { color: c.text.secondary, fontSize: '0.8rem', lineHeight: 1.5, mb: 2 };
  const errSx = { color: c.status.error, fontSize: '0.75rem', mb: 1.5 };
  const cancelSx = { color: c.text.secondary, textTransform: 'none', fontWeight: 500 };
  const actionRowSx = { display: 'flex', justifyContent: 'flex-end', gap: 1 };

  // Match the About-section outlined buttons (Restart tour / Check for Updates).
  const rowBtnSx = {
    color: c.text.secondary,
    borderColor: c.border.medium,
    textTransform: 'none' as const,
    fontSize: '0.8rem',
    whiteSpace: 'nowrap' as const,
    '&:hover': { color: c.accent.primary, borderColor: c.accent.primary },
  };
  const eraseBtnSx = {
    ...rowBtnSx,
    color: c.status.error,
    borderColor: c.status.error,
    '&:hover': { color: c.status.error, borderColor: c.status.error, bgcolor: c.status.errorBg },
  };
  const rowSx = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 3, py: 2 };

  return (
    <Box>
      <Typography sx={{ ...sectionSx, mt: 3 }}>{t('settings.general.dataPrivacy.sectionTitle')}</Typography>

      <Box sx={{ ...rowSx, borderBottom: `1px solid ${c.border.subtle}` }}>
        <Box>
          <Typography sx={labelSx}>{t('settings.general.dataPrivacy.resetAll')}</Typography>
          <Typography sx={descSx}>{t('settings.general.dataPrivacy.resetAllDesc')}</Typography>
        </Box>
        <Button variant="outlined" size="small" onClick={() => { setErr(null); setResetOpen(true); }} sx={rowBtnSx}>{t('settings.general.dataPrivacy.reset')}</Button>
      </Box>

      <Box sx={{ ...rowSx, borderBottom: `1px solid ${c.border.subtle}` }}>
        <Box>
          <Typography sx={labelSx}>{t('settings.general.dataPrivacy.clearBrowsing')}</Typography>
          <Typography sx={descSx}>{t('settings.general.dataPrivacy.clearBrowsingDesc')}</Typography>
        </Box>
        <Button variant="outlined" size="small" onClick={() => { setErr(null); setClearedOk(false); setClearOpen(true); }} sx={rowBtnSx}>{t('settings.general.dataPrivacy.clear')}</Button>
      </Box>

      <Box sx={rowSx}>
        <Box>
          <Typography sx={{ ...labelSx, color: c.status.error }}>{t('settings.general.dataPrivacy.eraseAll')}</Typography>
          <Typography sx={descSx}>{t('settings.general.dataPrivacy.eraseAllDesc')}</Typography>
        </Box>
        <Button variant="outlined" size="small" onClick={() => { setErr(null); setEraseText(''); setEraseOpen(true); }} sx={eraseBtnSx}>{t('settings.general.dataPrivacy.erase')}</Button>
      </Box>

      <Dialog open={resetOpen} onClose={closeAll} PaperProps={{ sx: dialogPaperSx }}>
        <Box sx={{ p: 2.5 }}>
          <Typography sx={titleSx}>{t('settings.general.dataPrivacy.resetDialogTitle')}</Typography>
          <Typography sx={bodySx}>{t('settings.general.dataPrivacy.resetDialogBody')}</Typography>
          {err && <Typography sx={errSx}>{err}</Typography>}
          <Box sx={actionRowSx}>
            <Button onClick={closeAll} disabled={busy} sx={cancelSx}>{t('common.cancel')}</Button>
            <Button onClick={doReset} disabled={busy} sx={{ color: c.accent.primary, textTransform: 'none', fontWeight: 600 }}>{busy ? t('settings.general.dataPrivacy.resetting') : t('settings.general.dataPrivacy.reset')}</Button>
          </Box>
        </Box>
      </Dialog>

      <Dialog open={clearOpen} onClose={closeAll} PaperProps={{ sx: dialogPaperSx }}>
        <Box sx={{ p: 2.5 }}>
          <Typography sx={titleSx}>{clearedOk ? t('settings.general.dataPrivacy.clearedTitle') : t('settings.general.dataPrivacy.clearDialogTitle')}</Typography>
          <Typography sx={bodySx}>{clearedOk ? t('settings.general.dataPrivacy.clearedBody') : t('settings.general.dataPrivacy.clearDialogBody')}</Typography>
          {err && <Typography sx={errSx}>{err}</Typography>}
          <Box sx={actionRowSx}>
            {clearedOk ? (
              <Button onClick={closeAll} sx={{ color: c.accent.primary, textTransform: 'none', fontWeight: 600 }}>{t('settings.general.dataPrivacy.done')}</Button>
            ) : (
              <>
                <Button onClick={closeAll} disabled={busy} sx={cancelSx}>{t('common.cancel')}</Button>
                <Button onClick={doClearBrowser} disabled={busy} sx={{ color: c.accent.primary, textTransform: 'none', fontWeight: 600 }}>{busy ? t('settings.general.dataPrivacy.clearing') : t('settings.general.dataPrivacy.clear')}</Button>
              </>
            )}
          </Box>
        </Box>
      </Dialog>

      <Dialog open={eraseOpen} onClose={closeAll} PaperProps={{ sx: dialogPaperSx }}>
        <Box sx={{ p: 2.5 }}>
          <Typography sx={titleSx}>{t('settings.general.dataPrivacy.eraseDialogTitle')}</Typography>
          <Typography sx={bodySx}>{t('settings.general.dataPrivacy.eraseDialogBody')}</Typography>
          <TextField
            value={eraseText}
            onChange={(e) => setEraseText(e.target.value)}
            placeholder={t('settings.general.dataPrivacy.erasePlaceholder', { word: ERASE_WORD })}
            fullWidth
            size="small"
            autoFocus
            disabled={busy}
            sx={{ mb: 2, '& .MuiOutlinedInput-root': { fontSize: '0.8rem' } }}
          />
          {err && <Typography sx={errSx}>{err}</Typography>}
          <Box sx={actionRowSx}>
            <Button onClick={closeAll} disabled={busy} sx={cancelSx}>{t('common.cancel')}</Button>
            <Button onClick={doErase} disabled={busy || eraseText.trim() !== ERASE_WORD} sx={{ color: c.status.error, textTransform: 'none', fontWeight: 600 }}>{busy ? t('settings.general.dataPrivacy.erasing') : t('settings.general.dataPrivacy.erase')}</Button>
          </Box>
        </Box>
      </Dialog>
    </Box>
  );
};

export default DataPrivacySection;
