import React from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { useTranslation } from 'react-i18next';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import { AppSettings } from '@/shared/state/settingsSlice';
import { PROVEDOR_IA_LOGIN_URL } from '@/shared/config';
import type { SettingsStyles } from '../settingsStyles';

type ApiKeyField =
  | 'provedor_ia_token'
  | 'anthropic_api_key'
  | 'openai_api_key'
  | 'google_api_key'
  | 'openrouter_api_key';

export interface ApiKeyConfig {
  field: ApiKeyField;
  label: string;
  desc: string;
  placeholder: string;
  href: string;
  /** i18n key overriding `desc`; set on cards whose copy has been extracted. */
  descKey?: string;
  linkKey?: string;
}

export const API_KEY_CARDS: ApiKeyConfig[] = [
  { field: 'provedor_ia_token', label: 'provedor-ia', desc: 'The Maestro models, through MartinsTech.', descKey: 'settings.models.provedorIaDesc', placeholder: 'PROVEDOR_IA_TOKEN', href: PROVEDOR_IA_LOGIN_URL, linkKey: 'settings.models.provedorIaGetToken' },
  { field: 'anthropic_api_key', label: 'Anthropic', desc: 'The latest Claude models.', placeholder: 'sk-ant-...', href: 'https://console.anthropic.com/settings/keys' },
  { field: 'openai_api_key', label: 'OpenAI', desc: 'The latest OpenAI models.', placeholder: 'sk-...', href: 'https://platform.openai.com/api-keys' },
  { field: 'google_api_key', label: 'Google', desc: 'The latest Gemini models.', placeholder: 'AIza...', href: 'https://aistudio.google.com/apikey' },
  { field: 'openrouter_api_key', label: 'OpenRouter', desc: 'Hundreds of models from every major provider.', placeholder: 'sk-or-...', href: 'https://openrouter.ai/keys' },
];

const ApiKeyCard: React.FC<{
  config: ApiKeyConfig;
  form: AppSettings;
  setForm: React.Dispatch<React.SetStateAction<AppSettings>>;
  showApiKey: boolean;
  setShowApiKey: (v: boolean) => void;
  styles: SettingsStyles;
}> = ({ config, form, setForm, showApiKey, setShowApiKey, styles }) => {
  const c = useClaudeTokens();
  const { t } = useTranslation();
  const { fieldSx, descSx, labelSx } = styles;
  const value = form[config.field] as string | null | undefined;
  const desc = config.descKey ? t(config.descKey) : config.desc;
  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Typography sx={labelSx}>{config.label}</Typography>
        {value ? (
          <Typography sx={{ fontSize: '0.6rem', fontWeight: 600, color: c.status.success, bgcolor: `${c.status.success}15`, px: 0.75, py: 0.15, borderRadius: '3px' }}>CONNECTED</Typography>
        ) : null}
      </Box>
      <Typography sx={{ ...descSx, mb: 1 }}>{desc}</Typography>
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
        <TextField
          type={showApiKey ? 'text' : 'password'}
          value={value ?? ''}
          onChange={(e) => setForm({ ...form, [config.field]: e.target.value || null })}
          size="small"
          fullWidth
          placeholder={config.placeholder}
          sx={{ ...fieldSx, '& .MuiOutlinedInput-root': { ...fieldSx['& .MuiOutlinedInput-root'], fontFamily: c.font.mono } }}
          InputProps={{
            endAdornment: (
              <InputAdornment position="end">
                <IconButton onClick={() => setShowApiKey(!showApiKey)} edge="end" size="small" sx={{ color: c.text.tertiary }}>
                  {showApiKey ? <VisibilityOffIcon sx={{ fontSize: 16 }} /> : <VisibilityIcon sx={{ fontSize: 16 }} />}
                </IconButton>
              </InputAdornment>
            ),
          }}
        />
        <Typography
          component="a"
          href={config.href}
          target="_blank"
          rel="noopener"
          sx={{ color: c.accent.primary, fontSize: '0.72rem', whiteSpace: 'nowrap', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 0.3, '&:hover': { textDecoration: 'underline' } }}
        >
          {config.linkKey ? t(config.linkKey) : 'Get key'} <OpenInNewIcon sx={{ fontSize: 11 }} />
        </Typography>
      </Box>
    </Box>
  );
};

export default ApiKeyCard;
