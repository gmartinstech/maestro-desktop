import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Slider from '@mui/material/Slider';
import Switch from '@mui/material/Switch';
import LightModeIcon from '@mui/icons-material/LightMode';
import DarkModeIcon from '@mui/icons-material/DarkMode';
import KeyboardIcon from '@mui/icons-material/Keyboard';
import LanguageIcon from '@mui/icons-material/Language';
import { AppSettings } from '@/shared/state/settingsSlice';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import type { SettingsStyles } from '../settingsStyles';
import { settingSelectAttrs } from '../settingSelect';

const GeneralInterface: React.FC<{
  form: AppSettings;
  setForm: React.Dispatch<React.SetStateAction<AppSettings>>;
  styles: SettingsStyles;
}> = ({ form, setForm, styles }) => {
  const c = useClaudeTokens();
  const { t, i18n } = useTranslation();
  const [recordingShortcut, setRecordingShortcut] = useState(false);
  const { fieldSx, sectionSx, rowSx, rowLastSx, inlineRowSx, inlineRowLastSx, labelSx, descSx } = styles;

  return (
    <>
      <Typography sx={{ ...sectionSx, mt: 3 }}>{t('settings.interface.sectionTitle')}</Typography>

      <Box sx={inlineRowSx} {...settingSelectAttrs('language', t('settings.interface.language'), 'Interface', t('settings.interface.languageDesc'))}>
        <Box sx={{ mr: 3 }}>
          <Typography sx={labelSx}>{t('settings.interface.language')}</Typography>
          <Typography sx={descSx}>{t('settings.interface.languageDesc')}</Typography>
        </Box>
        <ToggleButtonGroup
          value={i18n.resolvedLanguage ?? i18n.language}
          exclusive
          onChange={(_, v) => { if (v) i18n.changeLanguage(v); }}
          size="small"
          sx={{
            '& .MuiToggleButton-root': {
              color: c.text.muted,
              borderColor: c.border.medium,
              textTransform: 'none',
              px: 2,
              py: 0.5,
              gap: 0.5,
              fontSize: '0.8rem',
              '&.Mui-selected': {
                bgcolor: `${c.accent.primary}15`,
                color: c.accent.primary,
                borderColor: c.accent.primary,
                '&:hover': { bgcolor: `${c.accent.primary}20` },
              },
            },
          }}
        >
          <ToggleButton value="pt-BR">Português (Brasil)</ToggleButton>
          <ToggleButton value="en">English</ToggleButton>
        </ToggleButtonGroup>
      </Box>

      <Box sx={inlineRowSx} {...settingSelectAttrs('theme', t('settings.interface.theme'), 'Interface', t('settings.interface.themeDesc'))}>
        <Box sx={{ mr: 3 }}>
          <Typography sx={labelSx}>{t('settings.interface.theme')}</Typography>
          <Typography sx={descSx}>{t('settings.interface.themeDesc')}</Typography>
        </Box>
        <ToggleButtonGroup
          value={form.theme}
          exclusive
          onChange={(_, v) => { if (v) setForm({ ...form, theme: v }); }}
          size="small"
          sx={{
            '& .MuiToggleButton-root': {
              color: c.text.muted,
              borderColor: c.border.medium,
              textTransform: 'none',
              px: 2,
              py: 0.5,
              gap: 0.5,
              fontSize: '0.8rem',
              '&.Mui-selected': {
                bgcolor: `${c.accent.primary}15`,
                color: c.accent.primary,
                borderColor: c.accent.primary,
                '&:hover': { bgcolor: `${c.accent.primary}20` },
              },
            },
          }}
        >
          <ToggleButton value="light">
            <LightModeIcon sx={{ fontSize: 16 }} /> {t('settings.interface.light')}
          </ToggleButton>
          <ToggleButton value="dark">
            <DarkModeIcon sx={{ fontSize: 16 }} /> {t('settings.interface.dark')}
          </ToggleButton>
        </ToggleButtonGroup>
      </Box>

      <Box sx={rowSx} {...settingSelectAttrs('zoom_sensitivity', t('settings.interface.zoomSensitivity'), 'Interface', t('settings.interface.zoomSensitivityDesc'))}>
        <Typography sx={labelSx}>{t('settings.interface.zoomSensitivity')}</Typography>
        <Typography sx={{ ...descSx, mb: 1 }}>
          {t('settings.interface.zoomSensitivityDesc')}
        </Typography>
        <Box sx={{ px: 1 }}>
          <Slider
            value={form.zoom_sensitivity}
            onChange={(_, v) => setForm({ ...form, zoom_sensitivity: v as number })}
            min={1}
            max={100}
            step={1}
            valueLabelDisplay="auto"
            marks={[
              { value: 1, label: t('settings.interface.zoomLow') },
              { value: 50, label: t('settings.interface.zoomDefault') },
              { value: 100, label: t('settings.interface.zoomHigh') },
            ]}
            sx={{
              color: c.accent.primary,
              '& .MuiSlider-markLabel': { color: c.text.tertiary, fontSize: '0.7rem' },
              '& .MuiSlider-valueLabel': { bgcolor: c.accent.primary },
            }}
          />
        </Box>
      </Box>

      <Box sx={inlineRowSx} {...settingSelectAttrs('new_agent_shortcut', t('settings.interface.newAgentShortcut'), 'Interface', t('settings.interface.newAgentShortcutDesc'))}>
        <Box sx={{ mr: 3 }}>
          <Typography sx={labelSx}>{t('settings.interface.newAgentShortcut')}</Typography>
          <Typography sx={descSx}>{t('settings.interface.newAgentShortcutDesc')}</Typography>
        </Box>
        <Box
          tabIndex={0}
          onKeyDown={(e) => {
            if (!recordingShortcut) return;
            if (['Meta', 'Control', 'Shift', 'Alt'].includes(e.key)) return;
            e.preventDefault();
            const parts: string[] = [];
            if (e.metaKey) parts.push('Meta');
            if (e.ctrlKey) parts.push('Ctrl');
            if (e.altKey) parts.push('Alt');
            if (e.shiftKey) parts.push('Shift');
            parts.push(e.key.length === 1 ? e.key.toLowerCase() : e.key);
            setForm({ ...form, new_agent_shortcut: parts.join('+') });
            setRecordingShortcut(false);
          }}
          onBlur={() => setRecordingShortcut(false)}
          onClick={() => setRecordingShortcut(true)}
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 0.75,
            px: 1.5,
            py: 0.75,
            borderRadius: `${c.radius.sm}px`,
            border: `1px solid ${recordingShortcut ? c.accent.primary : c.border.medium}`,
            cursor: 'pointer',
            outline: 'none',
            transition: 'border-color 0.15s',
            '&:hover': { borderColor: c.accent.primary },
          }}
        >
          <KeyboardIcon sx={{ fontSize: 16, color: recordingShortcut ? c.accent.primary : c.text.tertiary }} />
          {recordingShortcut ? (
            <Typography sx={{ fontSize: '0.8rem', color: c.accent.primary, fontWeight: 500 }}>
              {t('settings.interface.pressShortcut')}
            </Typography>
          ) : (
            <Typography sx={{ fontSize: '0.8rem', color: c.text.primary, fontFamily: c.font.mono, fontWeight: 500 }}>
              {form.new_agent_shortcut
                .split('+')
                .map((p) => {
                  if (p === 'Meta') return '⌘';
                  if (p === 'Ctrl') return 'Ctrl';
                  if (p === 'Alt') return '⌥';
                  if (p === 'Shift') return '⇧';
                  return p.toUpperCase();
                })
                .join(' + ')}
            </Typography>
          )}
        </Box>
      </Box>

      <Box sx={inlineRowSx} {...settingSelectAttrs('auto_select_mode_on_new_agent', t('settings.interface.autoSelectMode'), 'Interface', t('settings.interface.autoSelectModeDesc'))}>
        <Box sx={{ mr: 3 }}>
          <Typography sx={labelSx}>{t('settings.interface.autoSelectMode')}</Typography>
          <Typography sx={descSx}>{t('settings.interface.autoSelectModeDesc')}</Typography>
        </Box>
        <Switch
          checked={form.auto_select_mode_on_new_agent}
          onChange={(e) => setForm({ ...form, auto_select_mode_on_new_agent: e.target.checked })}
          sx={{
            '& .MuiSwitch-switchBase.Mui-checked': { color: c.accent.primary },
            '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': { bgcolor: c.accent.primary },
          }}
        />
      </Box>

      <Box sx={inlineRowSx} {...settingSelectAttrs('expand_new_chats_in_dashboard', t('settings.interface.expandNewChats'), 'Interface', t('settings.interface.expandNewChatsDesc'))}>
        <Box sx={{ mr: 3 }}>
          <Typography sx={labelSx}>{t('settings.interface.expandNewChats')}</Typography>
          <Typography sx={descSx}>{t('settings.interface.expandNewChatsDesc')}</Typography>
        </Box>
        <Switch
          checked={form.expand_new_chats_in_dashboard}
          onChange={(e) => setForm({ ...form, expand_new_chats_in_dashboard: e.target.checked })}
          sx={{
            '& .MuiSwitch-switchBase.Mui-checked': { color: c.accent.primary },
            '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': { bgcolor: c.accent.primary },
          }}
        />
      </Box>

      <Box sx={inlineRowLastSx} {...settingSelectAttrs('auto_reveal_sub_agents', t('settings.interface.autoRevealSubAgents'), 'Interface', t('settings.interface.autoRevealSubAgentsDesc'))}>
        <Box sx={{ mr: 3 }}>
          <Typography sx={labelSx}>{t('settings.interface.autoRevealSubAgents')}</Typography>
          <Typography sx={descSx}>{t('settings.interface.autoRevealSubAgentsDesc')}</Typography>
        </Box>
        <Switch
          checked={form.auto_reveal_sub_agents}
          onChange={(e) => setForm({ ...form, auto_reveal_sub_agents: e.target.checked })}
          sx={{
            '& .MuiSwitch-switchBase.Mui-checked': { color: c.accent.primary },
            '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': { bgcolor: c.accent.primary },
          }}
        />
      </Box>

      <Typography sx={{ ...sectionSx, mt: 3 }}>{t('settings.interface.browserSectionTitle')}</Typography>

      <Box sx={rowLastSx} {...settingSelectAttrs('browser_homepage', t('settings.interface.defaultHomepage'), 'Browser', t('settings.interface.defaultHomepageDesc'))}>
        <Typography sx={labelSx}>{t('settings.interface.defaultHomepage')}</Typography>
        <Typography sx={{ ...descSx, mb: 1.5 }}>
          {t('settings.interface.defaultHomepageDesc')}
        </Typography>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
          <LanguageIcon sx={{ fontSize: 18, color: c.text.tertiary, flexShrink: 0 }} />
          <TextField
            value={form.browser_homepage}
            onChange={(e) => setForm({ ...form, browser_homepage: e.target.value })}
            size="small"
            fullWidth
            placeholder="https://www.google.com"
            sx={{
              ...fieldSx,
              '& .MuiOutlinedInput-root': {
                ...fieldSx['& .MuiOutlinedInput-root'],
                fontFamily: c.font.mono,
              },
            }}
          />
        </Box>
      </Box>
    </>
  );
};

export default GeneralInterface;
