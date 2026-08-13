import React from 'react';
import { useTranslation } from 'react-i18next';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Paper from '@mui/material/Paper';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';

const Analytics: React.FC = () => {
  const c = useClaudeTokens();
  const { t } = useTranslation();

  return (
    <Box sx={{ height: '100%', overflow: 'auto', p: 3 }}>
      <Box sx={{ maxWidth: 800, mx: 'auto' }}>
        <Typography variant="h5" sx={{ color: c.text.primary, fontWeight: 600, mb: 3 }}>
          {t('analytics.pageTitle')}
        </Typography>

        <Paper sx={{
          p: 4,
          bgcolor: c.bg.surface,
          border: `1px solid ${c.border.subtle}`,
          textAlign: 'center',
        }}>
          <Box sx={{ mb: 2 }}>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke={c.accent.primary} strokeWidth="1.5">
              <path d="M3 3v18h18" />
              <path d="M7 16l4-4 4 4 5-5" />
              <circle cx="20" cy="7" r="1.5" fill={c.accent.primary} />
            </svg>
          </Box>
          <Typography sx={{ color: c.text.primary, fontSize: '1.1rem', fontWeight: 600, mb: 1 }}>
            {t('analytics.yourUsage')}
          </Typography>
          <Typography sx={{ color: c.text.muted, fontSize: '0.85rem', lineHeight: 1.6, mb: 3, maxWidth: 500, mx: 'auto' }}>
            {t('analytics.usageDescription')}
          </Typography>

          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 2, mt: 3, textAlign: 'left' }}>
            {[
              { key: 'sessionsUsage', label: 'analytics.sessionsUsage', desc: 'analytics.sessionsUsageDesc' },
              { key: 'costTracking', label: 'analytics.costTracking', desc: 'analytics.costTrackingDesc' },
              { key: 'taskCategories', label: 'analytics.taskCategories', desc: 'analytics.taskCategoriesDesc' },
              { key: 'modelDistribution', label: 'analytics.modelDistribution', desc: 'analytics.modelDistributionDesc' },
              { key: 'toolUsage', label: 'analytics.toolUsage', desc: 'analytics.toolUsageDesc' },
              { key: 'retentionFunnels', label: 'analytics.retentionFunnels', desc: 'analytics.retentionFunnelsDesc' },
            ].map((item) => (
              <Box key={item.key} sx={{ p: 2, borderRadius: `${c.radius.md}px`, bgcolor: c.bg.elevated }}>
                <Typography sx={{ color: c.text.primary, fontSize: '0.82rem', fontWeight: 600, mb: 0.5 }}>
                  {t(item.label)}
                </Typography>
                <Typography sx={{ color: c.text.muted, fontSize: '0.72rem', lineHeight: 1.4 }}>
                  {t(item.desc)}
                </Typography>
              </Box>
            ))}
          </Box>
        </Paper>
      </Box>
    </Box>
  );
};

export default Analytics;
