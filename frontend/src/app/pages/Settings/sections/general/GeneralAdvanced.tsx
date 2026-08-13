import React from 'react';
import { useTranslation } from 'react-i18next';
import { report } from '@/shared/serviceClient';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Switch from '@mui/material/Switch';
import { useAppDispatch, useAppSelector } from '@/shared/hooks';
import { closeSettingsModal, AppSettings } from '@/shared/state/settingsSlice';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import TrustedFilePatterns from '@/app/components/overlays/TrustedFilePatterns';
import SoftwareUpdateRow from './SoftwareUpdateRow';
import type { SettingsStyles } from '../settingsStyles';
import { settingSelectAttrs } from '../settingSelect';

const GeneralAdvanced: React.FC<{
  form: AppSettings;
  setForm: React.Dispatch<React.SetStateAction<AppSettings>>;
  styles: SettingsStyles;
}> = ({ form, setForm, styles }) => {
  const c = useClaudeTokens();
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const appVersion = useAppSelector((s) => s.update.appVersion);
  const { sectionSx, rowSx, inlineRowSx, inlineRowLastSx, labelSx, descSx } = styles;

  // Provenance: the exact commit this build was cut from. Surfaced so a support screenshot of Settings is enough to identify the shipped code. Empty in dev / web (no Electron bridge or unknown sha), in which case we hide the row.
  const [buildLabel, setBuildLabel] = React.useState<string | null>(null);
  React.useEffect(() => {
    const api = (window as { maestro?: { getBuildInfo?: () => Promise<{ shortSha: string; channel: string }> } }).maestro;
    api?.getBuildInfo?.()
      .then((b) => { if (b?.shortSha && b.shortSha !== 'unknown') setBuildLabel(`${b.shortSha} (${b.channel})`); })
      .catch(() => {});
  }, []);

  return (
    <>
      <Typography sx={{ ...sectionSx, mt: 3 }}>{t('settings.general.advanced.sectionTitle')}</Typography>

      <Box sx={inlineRowSx} {...settingSelectAttrs('dev_mode', t('settings.general.advanced.devMode'), 'Advanced', t('settings.general.advanced.devModeDesc'))}>
        <Box sx={{ mr: 3 }}>
          <Typography sx={labelSx}>{t('settings.general.advanced.devMode')}</Typography>
          <Typography sx={descSx}>{t('settings.general.advanced.devModeDesc')}</Typography>
        </Box>
        <Switch
          checked={form.dev_mode}
          onChange={(e) => setForm({ ...form, dev_mode: e.target.checked })}
          sx={{
            '& .MuiSwitch-switchBase.Mui-checked': { color: c.accent.primary },
            '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': { bgcolor: c.accent.primary },
          }}
        />
      </Box>

      <Box sx={inlineRowLastSx} {...settingSelectAttrs('allow_experimental_updates', t('settings.general.advanced.experimentalUpdates'), 'Advanced', t('settings.general.advanced.experimentalUpdatesDesc'))}>
        <Box sx={{ mr: 3 }}>
          <Typography sx={labelSx}>{t('settings.general.advanced.experimentalUpdates')}</Typography>
          <Typography sx={descSx}>{t('settings.general.advanced.experimentalUpdatesDesc')}</Typography>
        </Box>
        <Switch
          checked={form.allow_experimental_updates}
          onChange={(e) => setForm({ ...form, allow_experimental_updates: e.target.checked })}
          sx={{
            '& .MuiSwitch-switchBase.Mui-checked': { color: c.accent.primary },
            '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': { bgcolor: c.accent.primary },
          }}
        />
      </Box>

      <Typography sx={{ ...sectionSx, mt: 3 }}>{t('settings.general.advanced.aboutTitle')}</Typography>

      <Box sx={rowSx}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Box>
            <Typography sx={labelSx}>{t('settings.general.advanced.version')}</Typography>
            <Typography sx={{ ...descSx, fontFamily: c.font.mono }}>
              {appVersion ?? '-'}
            </Typography>
          </Box>
        </Box>
      </Box>

      {buildLabel && (
        <Box sx={rowSx}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Box>
              <Typography sx={labelSx}>{t('settings.general.advanced.build')}</Typography>
              <Typography sx={{ ...descSx, fontFamily: c.font.mono }}>
                {buildLabel}
              </Typography>
            </Box>
          </Box>
        </Box>
      )}

      <SoftwareUpdateRow styles={styles} />

      <TrustedFilePatterns />
    </>
  );
};

export default GeneralAdvanced;
