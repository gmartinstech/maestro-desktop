import React from 'react';
import { useTranslation } from 'react-i18next';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';

interface Props {
  open: boolean;
  onClose: () => void;
  onTestFirst: () => void;
  onScheduleAnyway: () => void;
}

// Shown before scheduling a workflow whose current steps haven't been validated by a test run. Scheduled fires can't pause to ask for tool permission, so an untested workflow that needs approval would silently fail on its first run.
export default function ScheduleTestWarningDialog({ open, onClose, onTestFirst, onScheduleAnyway }: Props) {
  const c = useClaudeTokens();
  const { t } = useTranslation();
  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontSize: '1rem', fontWeight: 700 }}>{t('workflows.scheduleTestWarningDialog.title')}</DialogTitle>
      <DialogContent>
        <Typography sx={{ fontSize: '0.86rem', color: c.text.secondary, lineHeight: 1.5 }}>
          {t('workflows.scheduleTestWarningDialog.description')}
        </Typography>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2, gap: 1 }}>
        <Box
          role="button"
          onClick={onScheduleAnyway}
          sx={{ fontSize: '0.84rem', fontWeight: 600, color: c.text.secondary, cursor: 'pointer', px: 1, py: 0.5, '&:hover': { color: c.text.primary } }}>
          {t('workflows.scheduleTestWarningDialog.scheduleAnyway')}
        </Box>
        <Box
          role="button"
          onClick={onTestFirst}
          sx={{ fontSize: '0.84rem', fontWeight: 700, color: '#fff', bgcolor: c.accent.primary, borderRadius: 999, cursor: 'pointer', px: 1.5, py: 0.6, '&:hover': { filter: 'brightness(1.06)' } }}>
          {t('workflows.scheduleTestWarningDialog.testFirst')}
        </Box>
      </DialogActions>
    </Dialog>
  );
}
