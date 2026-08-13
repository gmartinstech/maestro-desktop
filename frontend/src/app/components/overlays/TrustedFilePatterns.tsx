import React, { useEffect, useState, useCallback } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import { useTranslation } from 'react-i18next';
import { API_BASE } from '@/shared/config';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';

const TRUSTED_API = `${API_BASE}/tools/trusted-sensitive-paths`;

// Mirrors the backend _SENSITIVE_PATH_INFO mapping. Kept here intentionally (rather than fetched) because the user-facing label is the only part the settings page renders, and a static dictionary keeps the page snappy and works offline. If a pattern is unknown (older backend), fall back to the raw pattern string.
const PATTERN_LABEL_KEYS: Record<string, string> = {
  '*/.ssh': 'overlays.trustedPatterns.pattern.sshFolder',
  '*/.ssh/*': 'overlays.trustedPatterns.pattern.sshFolder',
  '*/.aws/*': 'overlays.trustedPatterns.pattern.awsCredentials',
  '*/.config/gcloud/*': 'overlays.trustedPatterns.pattern.gcloudCredentials',
  '*/.kube/*': 'overlays.trustedPatterns.pattern.kubeConfig',
  '*/.gnupg/*': 'overlays.trustedPatterns.pattern.gpgKeys',
  '*/.docker/config*': 'overlays.trustedPatterns.pattern.dockerCredentials',
  '*/.zshrc': 'overlays.trustedPatterns.pattern.zshrc',
  '*/.bashrc': 'overlays.trustedPatterns.pattern.bashrc',
  '*/.bash_profile': 'overlays.trustedPatterns.pattern.bashProfile',
  '*/.profile': 'overlays.trustedPatterns.pattern.profile',
  '*/.zprofile': 'overlays.trustedPatterns.pattern.zprofile',
  '*/.zshenv': 'overlays.trustedPatterns.pattern.zshenv',
  '*/.gitconfig': 'overlays.trustedPatterns.pattern.gitconfig',
  '*/.npmrc': 'overlays.trustedPatterns.pattern.npmrc',
  '*/.pypirc': 'overlays.trustedPatterns.pattern.pypirc',
  '*/.netrc': 'overlays.trustedPatterns.pattern.netrc',
  '*/Library/Keychains/*': 'overlays.trustedPatterns.pattern.macKeychain',
  '/etc/*': 'overlays.trustedPatterns.pattern.etcConfig',
  '/private/etc/*': 'overlays.trustedPatterns.pattern.etcConfig',
  '/System/*': 'overlays.trustedPatterns.pattern.macSystemFolder',
  '/usr/local/etc/*': 'overlays.trustedPatterns.pattern.usrLocalEtcConfig',
  '/etc/sudoers': 'overlays.trustedPatterns.pattern.sudoers',
  '/etc/sudoers.d/*': 'overlays.trustedPatterns.pattern.sudoersD',
  '/etc/passwd': 'overlays.trustedPatterns.pattern.passwd',
  '/etc/shadow': 'overlays.trustedPatterns.pattern.shadow',
};

export const TrustedFilePatterns: React.FC = () => {
  const { t } = useTranslation();
  const c = useClaudeTokens();
  const [patterns, setPatterns] = useState<string[] | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(TRUSTED_API);
      if (!res.ok) return;
      const data = await res.json();
      setPatterns(Array.isArray(data.patterns) ? data.patterns : []);
    } catch {
      setPatterns([]);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const revoke = useCallback(async (pat: string) => {
    if (!patterns) return;
    const next = patterns.filter((p) => p !== pat);
    setPatterns(next);
    try {
      await fetch(TRUSTED_API, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patterns: next }),
      });
    } catch {
      // On failure, reload from server so UI matches truth.
      load();
    }
  }, [patterns, load]);

  // Hide the whole section until the user actually has trusted patterns; an empty "no patterns yet" card was just visual bloat for the 99% case. The approval-time checkbox is what teaches the user this feature exists.
  if (!patterns || patterns.length === 0) return null;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <Typography sx={{ fontSize: '0.7rem', color: c.text.ghost, textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>
        {t('overlays.trustedPatterns.title')}
      </Typography>
      <Typography sx={{ fontSize: '0.8rem', color: c.text.secondary, lineHeight: 1.45 }}>
        {t('overlays.trustedPatterns.description')}
      </Typography>
      <Box sx={{ display: 'flex', flexDirection: 'column', border: `1px solid ${c.border.subtle}`, borderRadius: 1.5, overflow: 'hidden', mt: 0.5 }}>
        {patterns.map((pat, idx) => (
          <Box
            key={pat}
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              px: 1.5,
              py: 1,
              borderTop: idx === 0 ? 'none' : `1px solid ${c.border.subtle}`,
              bgcolor: c.bg.surface,
            }}
          >
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography sx={{ fontSize: '0.82rem', color: c.text.primary, fontWeight: 500 }}>
                {PATTERN_LABEL_KEYS[pat] ? t(PATTERN_LABEL_KEYS[pat]) : pat}
              </Typography>
              <Typography sx={{ fontSize: '0.72rem', color: c.text.tertiary, fontFamily: c.font.mono, mt: 0.15 }}>
                {pat}
              </Typography>
            </Box>
            <IconButton
              size="small"
              onClick={() => revoke(pat)}
              aria-label={t('overlays.trustedPatterns.removePattern', {
                label: PATTERN_LABEL_KEYS[pat] ? t(PATTERN_LABEL_KEYS[pat]) : pat,
              })}
              sx={{ color: c.text.tertiary, '&:hover': { color: c.status.error } }}
            >
              <DeleteOutlineIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </Box>
        ))}
      </Box>
    </Box>
  );
};

export default TrustedFilePatterns;
