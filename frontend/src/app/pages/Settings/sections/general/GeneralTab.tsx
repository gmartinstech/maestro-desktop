import React from 'react';
import Box from '@mui/material/Box';
import { AppSettings } from '@/shared/state/settingsSlice';
import GeneralAgentDefaults from './GeneralAgentDefaults';
import GeneralInterface from './GeneralInterface';
import GeneralAdvanced from './GeneralAdvanced';
import DataPrivacySection from './DataPrivacySection';
import type { SettingsStyles } from '../settingsStyles';

type ModelOption = { value: string; label: string };

const GeneralTab: React.FC<{
  form: AppSettings;
  setForm: React.Dispatch<React.SetStateAction<AppSettings>>;
  styles: SettingsStyles;
  setBrowseOpen: (v: boolean) => void;
  modelOptions: { grouped: Record<string, ModelOption[]>; flat: Array<ModelOption & { provider: string }> };
  modesList: Array<{ id: string; name: string }>;
  providerColors: Record<string, string>;
}> = ({ form, setForm, styles, setBrowseOpen, modelOptions, modesList, providerColors }) => {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', pt: 2.5, pb: 1, animation: 'fadeIn 0.2s ease', '@keyframes fadeIn': { from: { opacity: 0 }, to: { opacity: 1 } } }}>

      <GeneralAgentDefaults
        form={form}
        setForm={setForm}
        styles={styles}
        setBrowseOpen={setBrowseOpen}
        modelOptions={modelOptions}
        modesList={modesList}
        providerColors={providerColors}
      />

      <GeneralInterface form={form} setForm={setForm} styles={styles} />

      <GeneralAdvanced form={form} setForm={setForm} styles={styles} />

      <DataPrivacySection styles={styles} />

    </Box>
  );
};

export default GeneralTab;
