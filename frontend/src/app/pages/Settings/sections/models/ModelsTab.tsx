import React from 'react';
import { useTranslation } from 'react-i18next';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import { AppSettings } from '@/shared/state/settingsSlice';
import SubscriptionCards from '../subscription/SubscriptionCards';
import ApiKeyCard, { API_KEY_CARDS } from './ApiKeyCard';
import CustomProvidersEditor from './CustomProvidersEditor';
import type { SettingsStyles } from '../settingsStyles';

const ModelsTab: React.FC<{
  form: AppSettings;
  setForm: React.Dispatch<React.SetStateAction<AppSettings>>;
  showApiKey: boolean;
  setShowApiKey: (v: boolean) => void;
  styles: SettingsStyles;
}> = ({ form, setForm, showApiKey, setShowApiKey, styles }) => {
  const c = useClaudeTokens();
  const { t } = useTranslation();
  const { descSx } = styles;
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', pt: 2.5, pb: 1, gap: 2.5, animation: 'fadeIn 0.2s ease', '@keyframes fadeIn': { from: { opacity: 0 }, to: { opacity: 1 } } }}>

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
        <Typography sx={{ fontSize: '0.7rem', color: c.text.ghost, textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>
          {t('settings.models.connectSubscription')}
        </Typography>

        <Typography sx={{ ...descSx, mb: 0 }}>
          {t('settings.models.subscriptionDesc')}
        </Typography>

        <Box data-onboarding="settings-external-subs">
          <SubscriptionCards />
        </Box>
      </Box>

      <Box data-onboarding="settings-api-keys" sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
        <Typography sx={{ fontSize: '0.7rem', color: c.text.ghost, textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600, mt: 1 }}>
          {t('settings.models.connectWithApiKeys')}
        </Typography>

        <Typography sx={{ ...descSx, mb: -1 }}>
          {t('settings.models.apiKeysDesc')}
        </Typography>

        {API_KEY_CARDS.map((config) => (
          <ApiKeyCard
            key={config.field}
            config={config}
            form={form}
            setForm={setForm}
            showApiKey={showApiKey}
            setShowApiKey={setShowApiKey}
            styles={styles}
          />
        ))}

        <CustomProvidersEditor
          form={form}
          setForm={setForm}
          showApiKey={showApiKey}
          setShowApiKey={setShowApiKey}
          styles={styles}
        />
      </Box>

    </Box>
  );
};

export default ModelsTab;
