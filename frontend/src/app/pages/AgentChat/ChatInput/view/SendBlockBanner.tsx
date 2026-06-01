import React from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { ContextPath } from '@/app/components/editor/DirectoryBrowser';
import { API_BASE, getAuthToken } from '@/shared/config';
import { ClaudeTokens } from '@/shared/styles/claudeTokens';
import { SendBlock } from '../hooks/useContextFiles';

interface Props {
  sendBlock: NonNullable<SendBlock>;
  c: ClaudeTokens;
  sessionId?: string;
  setSendBlock: (v: SendBlock) => void;
  setContextPaths: React.Dispatch<React.SetStateAction<ContextPath[]>>;
  setModelAnchor: (el: HTMLElement | null) => void;
}

export const SendBlockBanner: React.FC<Props> = ({ sendBlock, c, sessionId, setSendBlock, setContextPaths, setModelAnchor }) => {
  const fmt = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(0)}K` : String(n);
  return (
    <Box sx={{
      mx: 1.5, mt: 1, mb: 0.5, px: 2, py: 1.5,
      borderRadius: '12px',
      bgcolor: c.bg.surface,
      border: `1px solid ${c.border.medium}`,
    }}>
      <Typography sx={{ fontSize: '0.9rem', color: c.text.primary, lineHeight: 1.5, mb: 1 }}>
        That's a lot to send at once. Pick one:
      </Typography>
      <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
        {sessionId && (
          <Box
            component="button"
            onClick={async () => {
              try {
                const tok = (() => { try { return getAuthToken(); } catch { return ''; } })();
                const headers: Record<string, string> = { 'Content-Type': 'application/json' };
                if (tok) headers['Authorization'] = `Bearer ${tok}`;
                await fetch(`${API_BASE}/agents/sessions/${sessionId}/compact`, { method: 'POST', headers });
                setSendBlock(null);
              } catch (err) { console.error(err); }
            }}
            sx={{
              bgcolor: c.accent.primary, color: '#fff', border: 'none', borderRadius: '6px',
              px: 1.5, py: 0.7, fontSize: '0.82rem', fontWeight: 500, cursor: 'pointer',
              transition: 'background 0.15s ease',
              '&:hover': { bgcolor: c.accent.hover },
            }}
          >
            Shrink history
          </Box>
        )}
        {sendBlock.largestFile && (
          <Box
            component="button"
            onClick={() => {
              const p = sendBlock.largestFile!.path;
              setContextPaths((prev) => prev.filter((cp) => cp.path !== p));
              setSendBlock(null);
            }}
            sx={{
              bgcolor: 'transparent', color: c.text.secondary,
              border: `1px solid ${c.border.medium}`, borderRadius: '6px',
              px: 1.5, py: 0.7, fontSize: '0.82rem', cursor: 'pointer',
              transition: 'background 0.15s ease, color 0.15s ease',
              '&:hover': { bgcolor: c.bg.secondary, color: c.text.primary },
            }}
          >
            Remove biggest file
          </Box>
        )}
        <Box
          component="button"
          onClick={(e) => { setModelAnchor(e.currentTarget as HTMLElement); setSendBlock(null); }}
          sx={{
            bgcolor: 'transparent', color: c.text.secondary,
            border: `1px solid ${c.border.medium}`, borderRadius: '6px',
            px: 1.5, py: 0.7, fontSize: '0.82rem', cursor: 'pointer',
            transition: 'background 0.15s ease, color 0.15s ease',
            '&:hover': { bgcolor: c.bg.secondary, color: c.text.primary },
          }}
        >
          Switch model
        </Box>
        <Box
          component="button"
          onClick={() => setSendBlock(null)}
          sx={{
            bgcolor: 'transparent', color: c.text.muted, border: 'none',
            borderRadius: '6px', px: 1.5, py: 0.7, fontSize: '0.82rem', cursor: 'pointer',
            transition: 'color 0.15s ease',
            '&:hover': { color: c.text.secondary },
          }}
        >
          Dismiss
        </Box>
      </Box>
    </Box>
  );
};
