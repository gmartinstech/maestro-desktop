import React from 'react';
import { useTranslation } from 'react-i18next';
import Box from '@mui/material/Box';
import Snackbar from '@mui/material/Snackbar';
import Alert from '@mui/material/Alert';
import Dialog from '@mui/material/Dialog';
import DialogContent from '@mui/material/DialogContent';
import CircularProgress from '@mui/material/CircularProgress';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import DirectoryBrowser from '@/app/components/editor/DirectoryBrowser';
import { CommandsContent } from '@/app/pages/Commands/Commands';
import GeneralTab from './sections/general/GeneralTab';
import ModelsTab from './sections/models/ModelsTab';
import UsageStats from './sections/usage/UsageStats';
import SettingsHeader from './sections/SettingsHeader';
import { useSettingsController } from './sections/useSettingsController';
import { PROVIDER_COLORS } from './sections/settingsConstants';

// Skills/Tools moved here from the old sidebar Customization section; lazy since both pull heavy deps and Settings opens nearly every session.
const SkillsTab = React.lazy(() => import('@/app/pages/Skills/Skills'));
const ToolsTab = React.lazy(() => import('@/app/pages/Tools/Tools'));

const Settings: React.FC = () => {
  const c = useClaudeTokens();
  const { t } = useTranslation();
  const {
    open,
    modesList,
    modelOptions,
    activeTab,
    setActiveTab,
    form,
    setForm,
    showApiKey,
    setShowApiKey,
    browseOpen,
    setBrowseOpen,
    saveError,
    setSaveError,
    handleRequestClose,
    styles,
  } = useSettingsController(c);

  return (
    <>
    <Dialog
      open={open}
      onClose={handleRequestClose}
      maxWidth={false}
      PaperProps={{
        sx: {
          width: 780,
          height: '85vh',
          display: 'flex',
          flexDirection: 'column',
          bgcolor: c.bg.page,
          borderRadius: 2,
          border: `1px solid ${c.border.subtle}`,
          boxShadow: c.shadow.md,
          transition: 'none',
        },
      }}
    >
      <SettingsHeader
        activeTab={activeTab}
        onTabChange={(v) => setActiveTab(v)}
        onClose={handleRequestClose}
      />

      <DialogContent sx={{
        px: 3,
        py: 0,
        flex: 1,
        minHeight: 0,
        '&::-webkit-scrollbar': { width: 6 },
        '&::-webkit-scrollbar-track': { background: 'transparent' },
        '&::-webkit-scrollbar-thumb': { background: c.border.medium, borderRadius: 3, '&:hover': { background: c.border.strong } },
        scrollbarWidth: 'thin',
        scrollbarColor: `${c.border.medium} transparent`,
      }}>
      {activeTab === 'general' ? (
        <GeneralTab
          form={form}
          setForm={setForm}
          styles={styles}
          setBrowseOpen={setBrowseOpen}
          modelOptions={modelOptions}
          modesList={modesList}
          providerColors={PROVIDER_COLORS}
        />
      ) : activeTab === 'models' ? (
        <ModelsTab
          form={form}
          setForm={setForm}
          showApiKey={showApiKey}
          setShowApiKey={setShowApiKey}
          styles={styles}
        />
      ) : activeTab === 'usage' ? (
      <Box sx={{ display: 'flex', flexDirection: 'column', pt: 2.5, pb: 1, animation: 'fadeIn 0.2s ease', '@keyframes fadeIn': { from: { opacity: 0 }, to: { opacity: 1 } } }}>
        <UsageStats />
      </Box>
      ) : activeTab === 'skills' ? (
      <Box sx={{ height: '100%', mx: -3, animation: 'fadeIn 0.2s ease', '@keyframes fadeIn': { from: { opacity: 0 }, to: { opacity: 1 } } }}>
        <React.Suspense fallback={<Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}><CircularProgress size={24} /></Box>}>
          <SkillsTab />
        </React.Suspense>
      </Box>
      ) : activeTab === 'tools' ? (
      <Box sx={{ height: '100%', mx: -3, animation: 'fadeIn 0.2s ease', '@keyframes fadeIn': { from: { opacity: 0 }, to: { opacity: 1 } } }}>
        <React.Suspense fallback={<Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}><CircularProgress size={24} /></Box>}>
          <ToolsTab />
        </React.Suspense>
      </Box>
      ) : (
      <Box sx={{ pt: 2.5, pb: 1, animation: 'fadeIn 0.2s ease', '@keyframes fadeIn': { from: { opacity: 0 }, to: { opacity: 1 } } }}>
        <CommandsContent />
      </Box>
      )}
      </DialogContent>

      <DirectoryBrowser
        open={browseOpen}
        onClose={() => setBrowseOpen(false)}
        onSelect={(item) => setForm({ ...form, default_folder: item.path })}
        initialPath={form.default_folder ?? ''}
      />

      <Snackbar
        open={saveError}
        autoHideDuration={4000}
        onClose={() => setSaveError(false)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert onClose={() => setSaveError(false)} severity="error" sx={{ bgcolor: c.bg.surface, color: c.text.primary, border: `1px solid ${c.status.error}` }}>
          {t('settings.saveError')}
        </Alert>
      </Snackbar>
    </Dialog>
    </>
  );
};

export default Settings;
