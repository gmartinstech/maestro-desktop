import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import Dialog from '@mui/material/Dialog';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import { report } from '@/shared/serviceClient';

export type Sentiment = 'up' | 'down';

interface Props {
  open: boolean;
  sentiment: Sentiment;
  sessionId: string;
  messageId: string;
  onClose: () => void;
  onSubmitted: () => void;
}

const FeedbackDialog: React.FC<Props> = ({ open, sentiment, sessionId, messageId, onClose, onSubmitted }) => {
  const { t } = useTranslation();
  const c = useClaudeTokens();
  const [comment, setComment] = useState('');

  const isUp = sentiment === 'up';

  const handleSubmit = () => {
    // Rides the same analytics channel as everything else (batches + offline spools to the cloud). Fire-and-forget, so the dialog closes instantly.
    report('feedback', sentiment, { message_id: messageId, session_id: sessionId, comment: comment.trim() }, { immediate: true });
    setComment('');
    onSubmitted();
  };

  const handleClose = () => {
    setComment('');
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      PaperProps={{ sx: { bgcolor: c.bg.elevated, borderRadius: 3, p: 1, minWidth: 420, maxWidth: 480 } }}
    >
      <Box sx={{ p: 2 }}>
        <Typography sx={{ color: c.text.primary, fontSize: '1.15rem', fontWeight: 600, mb: 2 }}>
          {isUp ? t('agentChat.feedbackDialog.positiveTitle') : t('agentChat.feedbackDialog.negativeTitle')}
        </Typography>

        <Typography sx={{ color: c.text.secondary, fontSize: '0.85rem', mb: 1 }}>
          {t('agentChat.feedbackDialog.promptLabel')}
        </Typography>
        <TextField
          autoFocus
          fullWidth
          multiline
          minRows={3}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder={isUp ? t('agentChat.feedbackDialog.positivePlaceholder') : t('agentChat.feedbackDialog.negativePlaceholder')}
          sx={{
            '& .MuiOutlinedInput-root': {
              bgcolor: c.bg.page,
              color: c.text.primary,
              fontSize: '0.9rem',
              '& fieldset': { borderColor: c.border.medium },
              '&:hover fieldset': { borderColor: c.border.strong },
              '&.Mui-focused fieldset': { borderColor: c.accent.primary },
            },
            '& textarea::placeholder': { color: c.text.tertiary, opacity: 1 },
          }}
        />

        <Typography sx={{ color: c.text.tertiary, fontSize: '0.75rem', fontStyle: 'italic', mt: 1.5 }}>
          {t('agentChat.feedbackDialog.privacyNote')}
        </Typography>

        <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, mt: 2 }}>
          <Button onClick={handleClose} sx={{ color: c.text.secondary, textTransform: 'none' }}>
            {t('common.cancel')}
          </Button>
          <Button
            onClick={handleSubmit}
            variant="contained"
            sx={{
              bgcolor: c.text.primary,
              color: c.bg.page,
              textTransform: 'none',
              fontWeight: 600,
              '&:hover': { bgcolor: c.text.secondary },
            }}
          >
            {t('common.submit')}
          </Button>
        </Box>
      </Box>
    </Dialog>
  );
};

export default FeedbackDialog;
