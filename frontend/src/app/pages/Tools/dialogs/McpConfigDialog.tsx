import React from 'react';
import { useTranslation } from 'react-i18next';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import Avatar from '@mui/material/Avatar';
import ExtensionIcon from '@mui/icons-material/Extension';
import { McpServer } from '@/shared/state/mcpRegistrySlice';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import { cleanServerName } from '../toolsHelpers';

interface McpConfigDialogProps {
  open: boolean;
  onClose: () => void;
  mcpConfigServer: McpServer | null;
  mcpConfigJson: string;
  setMcpConfigJson: (json: string) => void;
  mcpConfigError: string;
  setMcpConfigError: (err: string) => void;
  mcpAuthType: 'none' | 'env_vars';
  setMcpAuthType: (val: 'none' | 'env_vars') => void;
  mcpCredentials: Record<string, string>;
  setMcpCredentials: (creds: Record<string, string>) => void;
  onSave: () => void;
}

const McpConfigDialog: React.FC<McpConfigDialogProps> = ({
  open, onClose, mcpConfigServer, mcpConfigJson, setMcpConfigJson,
  mcpConfigError, setMcpConfigError, mcpAuthType, setMcpAuthType, mcpCredentials, setMcpCredentials, onSave,
}) => {
  const c = useClaudeTokens();
  const { t } = useTranslation();
  return (
      <Dialog
        open={open}
        onClose={onClose}
        maxWidth="sm"
        fullWidth
        PaperProps={{ sx: { bgcolor: c.bg.surface, backgroundImage: 'none', borderRadius: 4, border: `1px solid ${c.border.subtle}` } }}
      >
        <DialogTitle sx={{ color: c.text.primary, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 1 }}>
          <ExtensionIcon sx={{ color: c.status.warning }} />
          {t('tools.mcpConfig.title')}
        </DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2.5, pt: '8px !important' }}>
          {mcpConfigServer && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, p: 1.5, bgcolor: c.bg.page, borderRadius: 2, border: `1px solid ${c.border.subtle}` }}>
              <Avatar
                src={mcpConfigServer.iconUrl || undefined}
                sx={{ width: 32, height: 32, bgcolor: c.bg.secondary, fontSize: '0.8rem', fontWeight: 700, color: c.text.muted }}
              >
                {mcpConfigServer.iconUrl ? null : (mcpConfigServer.title || cleanServerName(mcpConfigServer.name)).charAt(0).toUpperCase()}
              </Avatar>
              <Box>
                <Typography sx={{ color: c.text.primary, fontWeight: 600, fontSize: '0.9rem' }}>
                  {mcpConfigServer.title || cleanServerName(mcpConfigServer.name)}
                </Typography>
                <Typography sx={{ color: c.text.tertiary, fontSize: '0.78rem' }}>{mcpConfigServer.description}</Typography>
              </Box>
            </Box>
          )}

          <TextField
            label={t('tools.mcpConfig.configLabel')}
            value={mcpConfigJson}
            onChange={(e) => { setMcpConfigJson(e.target.value); try { JSON.parse(e.target.value); setMcpConfigError(''); } catch { setMcpConfigError(t('tools.mcpConfig.invalidJson')); } }}
            fullWidth
            multiline
            minRows={3}
            maxRows={8}
            error={!!mcpConfigError}
            helperText={mcpConfigError || t('tools.mcpConfig.configHelper')}
            sx={{ '& .MuiOutlinedInput-root': { bgcolor: c.bg.page, fontFamily: c.font.mono, fontSize: '0.85rem' } }}
          />

          <FormControl fullWidth size="small">
            <InputLabel sx={{ color: c.text.tertiary }}>{t('tools.mcpConfig.authTypeLabel')}</InputLabel>
            <Select
              value={mcpAuthType}
              label={t('tools.mcpConfig.authTypeLabel')}
              onChange={(e) => {
                const val = e.target.value as 'none' | 'env_vars';
                setMcpAuthType(val);
                if (val === 'env_vars') setMcpCredentials({ API_KEY: '' });
                else setMcpCredentials({});
              }}
              sx={{ bgcolor: c.bg.page }}
            >
              <MenuItem value="none">{t('tools.mcpConfig.authNone')}</MenuItem>
              <MenuItem value="env_vars">{t('tools.mcpConfig.authEnvVars')}</MenuItem>
            </Select>
          </FormControl>

          {mcpAuthType !== 'none' && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, p: 1.5, bgcolor: c.bg.page, borderRadius: 2, border: `1px solid ${c.border.subtle}` }}>
              <Typography sx={{ color: c.text.muted, fontSize: '0.78rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                {t('tools.mcpConfig.envVarsHeading')}
              </Typography>
              {Object.entries(mcpCredentials).map(([key, val]) => (
                <TextField
                  key={key}
                  label={key}
                  value={val}
                  onChange={(e) => setMcpCredentials({ ...mcpCredentials, [key]: e.target.value })}
                  fullWidth
                  size="small"
                  type={key.toLowerCase().includes('secret') ? 'password' : 'text'}
                  sx={{ '& .MuiOutlinedInput-root': { bgcolor: c.bg.elevated, fontFamily: c.font.mono, fontSize: '0.85rem' } }}
                />
              ))}
              {mcpAuthType === 'env_vars' && (
                <Button
                  size="small"
                  onClick={() => setMcpCredentials({ ...mcpCredentials, [`VAR_${Object.keys(mcpCredentials).length + 1}`]: '' })}
                  sx={{ color: c.accent.primary, textTransform: 'none', fontSize: '0.78rem', alignSelf: 'flex-start' }}
                >
                  {t('tools.mcpConfig.addVariable')}
                </Button>
              )}
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={onClose} sx={{ color: c.text.tertiary, textTransform: 'none' }}>{t('common.cancel')}</Button>
          <Button
            variant="contained"
            onClick={onSave}
            disabled={!!mcpConfigError}
            sx={{ bgcolor: c.accent.primary, '&:hover': { bgcolor: c.accent.pressed }, textTransform: 'none', borderRadius: 2 }}
          >
            {t('tools.mcpConfig.installTool')}
          </Button>
        </DialogActions>
      </Dialog>
  );
};

export default McpConfigDialog;
