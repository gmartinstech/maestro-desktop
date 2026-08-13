import React from 'react';
import { useTranslation } from 'react-i18next';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import type { SubscriptionProvider } from './subscriptionProviders';

const SubscriptionCard: React.FC<{ provider: SubscriptionProvider; connected: boolean; onConnect: () => void; onDisconnect: () => void; connecting: boolean; userCode?: string; disconnecting?: boolean }> = ({ provider, connected, onConnect, onDisconnect, connecting, userCode, disconnecting }) => {
  const c = useClaudeTokens();
  const { t } = useTranslation();
  const isPreview = (provider as any).preview;
  const dotColor = connected ? c.status.success : connecting ? c.accent.primary : c.border.medium;
  const desc = (provider as any).descKey ? t((provider as any).descKey) : provider.desc;

  return (
    <Box sx={{
      p: 1.5, borderRadius: `${c.radius.md}px`,
      border: `1px solid ${connected ? c.status.success + '30' : connecting ? c.accent.primary + '30' : c.border.subtle}`,
      bgcolor: connected ? `${c.status.success}06` : connecting ? `${c.accent.primary}06` : 'transparent',
      opacity: isPreview ? 0.5 : 1,
      transition: c.transition,
      '&:hover': isPreview ? {} : {
        borderColor: connected ? c.status.success + '4d' : c.border.medium,
        boxShadow: c.shadow.sm,
      },
      // affirm "Connected" at rest, reveal "Disconnect" on hover so the undo never shouts
      '&:hover .sub-rest': { opacity: 0 },
      '&:hover .sub-undo': { opacity: 1, pointerEvents: 'auto' },
    }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
          <Box sx={{
            width: 8, height: 8, borderRadius: '50%', flexShrink: 0, bgcolor: dotColor,
            transition: 'background-color 0.3s ease',
            ...(connecting ? {
              animation: 'sub-pulse 1.4s ease-in-out infinite',
              '@keyframes sub-pulse': { '0%, 100%': { opacity: 1 }, '50%': { opacity: 0.35 } },
            } : {}),
          }} />
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ fontSize: '0.78rem', fontWeight: 600, color: c.text.primary }}>{provider.name}</Typography>
            <Typography noWrap sx={{ fontSize: '0.65rem', color: connecting ? c.accent.primary : c.text.muted, transition: 'color 0.2s ease' }}>
              {connecting ? t('settings.models.subscriptionCard.waiting') : desc}
            </Typography>
          </Box>
        </Box>

        {isPreview ? (
          <Typography sx={{ fontSize: '0.65rem', color: c.text.ghost, fontStyle: 'italic', flexShrink: 0 }}>
            {t('settings.models.subscriptionCard.comingSoon')}
          </Typography>
        ) : connected ? (
          disconnecting ? (
            <CircularProgress size={14} sx={{ color: c.text.ghost }} />
          ) : (
            <Box sx={{ position: 'relative', flexShrink: 0, minWidth: 72, height: 16 }}>
              <Typography className="sub-rest" sx={{ position: 'absolute', right: 0, top: 0, fontSize: '0.68rem', fontWeight: 500, color: c.status.success, transition: 'opacity 0.18s ease' }}>
                {t('settings.models.subscriptionCard.connected')}
              </Typography>
              <Typography className="sub-undo" onClick={onDisconnect} sx={{ position: 'absolute', right: 0, top: 0, fontSize: '0.68rem', color: c.text.tertiary, cursor: 'pointer', opacity: 0, pointerEvents: 'none', transition: 'opacity 0.18s ease', '&:hover': { color: c.status.error } }}>
                {t('settings.models.subscriptionCard.disconnect')}
              </Typography>
            </Box>
          )
        ) : connecting && userCode ? (
          <Box sx={{ textAlign: 'right', flexShrink: 0 }}>
            <Typography sx={{ fontSize: '0.68rem', color: c.text.muted }}>{t('settings.models.subscriptionCard.enterCode')}</Typography>
            <Typography sx={{ fontSize: '0.85rem', fontWeight: 700, color: c.accent.primary, fontFamily: c.font.mono, letterSpacing: '0.1em' }}>{userCode}</Typography>
          </Box>
        ) : connecting ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8, flexShrink: 0 }}>
            <CircularProgress size={14} sx={{ color: c.accent.primary }} />
            <Typography sx={{ fontSize: '0.68rem', color: c.accent.primary }}>{t('settings.models.subscriptionCard.connecting')}</Typography>
          </Box>
        ) : (
          <Button onClick={onConnect} variant="outlined" size="small" sx={{ textTransform: 'none', fontSize: '0.7rem', fontWeight: 600, color: c.text.primary, borderColor: c.border.medium, borderRadius: `${c.radius.sm}px`, minWidth: 72, flexShrink: 0, '&:hover': { borderColor: c.accent.primary, bgcolor: `${c.accent.primary}0a` }, transition: 'all 0.2s ease' }}>
            {t('settings.models.subscriptionCard.connect')}
          </Button>
        )}
      </Box>
    </Box>
  );
};

export default SubscriptionCard;
