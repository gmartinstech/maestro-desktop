import React from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { ClaudeTokens } from '@/shared/styles/claudeTokens';
import { SendBlock } from '../hooks/useContextFiles';

interface Props {
  sendBlock: NonNullable<SendBlock>;
  c: ClaudeTokens;
}

/** Status indicator, not a prompt. Auto-compact already fired from handleSend; this
 *  just lets the user know we're freeing up space so the send doesn't look frozen. */
export const SendBlockBanner: React.FC<Props> = ({ sendBlock, c }) => {
  return (
    <Box sx={{
      mx: 1.5, mt: 1, mb: 0.5, px: 2, py: 1.25,
      borderRadius: '12px',
      bgcolor: c.bg.surface,
      border: `1px solid ${c.border.medium}`,
      display: 'flex', alignItems: 'center', gap: 1,
    }}>
      <Box component="span" sx={{
        display: 'inline-block', width: 6, height: 6, borderRadius: '50%',
        bgcolor: c.accent.primary,
        animation: 'osw-pulse 1.2s ease-in-out infinite',
        '@keyframes osw-pulse': {
          '0%, 100%': { opacity: 0.4 },
          '50%': { opacity: 1 },
        },
        flexShrink: 0,
      }} />
      <Typography sx={{ fontSize: '0.88rem', color: c.text.primary, lineHeight: 1.45 }}>
        Making room for your message
      </Typography>
    </Box>
  );
};
