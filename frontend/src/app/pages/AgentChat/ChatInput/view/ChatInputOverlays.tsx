import React from 'react';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Modal from '@mui/material/Modal';
import CloseIcon from '@mui/icons-material/Close';
import { ClaudeTokens } from '@/shared/styles/claudeTokens';

function ShrinkingLabel() {
  return (
    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.6 }}>
      <Box component="span" sx={{
        display: 'inline-block', width: 6, height: 6, borderRadius: '50%',
        bgcolor: 'currentColor',
        animation: 'osw-pulse 1.2s ease-in-out infinite',
        '@keyframes osw-pulse': {
          '0%, 100%': { opacity: 0.4 },
          '50%': { opacity: 1 },
        },
      }} />
      Shrinking
    </Box>
  );
}

interface Props {
  c: ClaudeTokens;
  lightboxSrc: string | null;
  setLightboxSrc: (src: string | null) => void;
  oversizeQueue: Array<{ path: string; name: string; tokens: number }>;
  summarizingPath: string | null;
  summarizingAll: boolean;
  summarizeOversize: (path: string) => void;
  summarizeAllOversize: () => void;
  detachOversize: (path: string) => void;
  detachAllOversize: () => void;
  currentModelCtx: number;
  summarizeError: string | null;
  setSummarizeError: (v: string | null) => void;
}

export const ChatInputOverlays: React.FC<Props> = ({
  c, lightboxSrc, setLightboxSrc, oversizeQueue, summarizingPath, summarizingAll,
  summarizeOversize, summarizeAllOversize, detachOversize, detachAllOversize,
  currentModelCtx, summarizeError, setSummarizeError,
}) => {
  // Auto-dismiss the error after 6s, matching the Snackbar behavior we replaced.
  React.useEffect(() => {
    if (!summarizeError) return;
    const t = setTimeout(() => setSummarizeError(null), 6000);
    return () => clearTimeout(t);
  }, [summarizeError, setSummarizeError]);
  return (
    <>
      <Modal
        open={!!lightboxSrc}
        onClose={() => setLightboxSrc(null)}
        sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      >
        <Box
          onClick={() => setLightboxSrc(null)}
          sx={{ position: 'relative', outline: 'none', maxWidth: '90vw', maxHeight: '90vh' }}
        >
          <IconButton
            onClick={() => setLightboxSrc(null)}
            sx={{
              position: 'absolute',
              top: -16,
              right: -16,
              bgcolor: c.bg.surface,
              border: `1px solid ${c.border.medium}`,
              color: c.text.secondary,
              width: 32,
              height: 32,
              zIndex: 1,
              '&:hover': { bgcolor: c.bg.secondary },
              boxShadow: c.shadow.md,
            }}
          >
            <CloseIcon sx={{ fontSize: 16 }} />
          </IconButton>
          <img
            src={lightboxSrc || ''}
            alt=""
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: '90vw',
              maxHeight: '90vh',
              borderRadius: 8,
              boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
              display: 'block',
            }}
          />
        </Box>
      </Modal>

      {/* Single popup handles ALL over-size files. One click → all shrunk in parallel or all removed.
          Auto-retry in useContextFiles fires the user's pending send after the queue drains, so going
          from 5 too-big files to a sent message is 1 click instead of 6 (Shrink+Remove pairs * 5 + Send). */}
      {oversizeQueue.length > 0 && (() => {
        const n = oversizeQueue.length;
        const firstName = oversizeQueue[0].name;
        const headline = n === 1
          ? <><strong>{firstName}</strong> is too big to send.</>
          : <>{n} files are too big to send: <strong>{firstName}</strong>{n > 1 ? <> and {n - 1} other{n > 2 ? 's' : ''}</> : null}.</>;
        const shrinkLabel = n === 1 ? 'Shrink it' : `Shrink all ${n}`;
        const removeLabel = n === 1 ? 'Remove' : `Remove all ${n}`;
        const shrinking = summarizingAll || !!summarizingPath;
        const onShrink = () => (n === 1 ? summarizeOversize(oversizeQueue[0].path) : summarizeAllOversize());
        const onRemove = () => (n === 1 ? detachOversize(oversizeQueue[0].path) : detachAllOversize());
        return (
          <Box
            sx={{
              position: 'absolute', left: 8, right: 8, bottom: 'calc(100% + 8px)',
              display: 'flex', alignItems: 'center', gap: 1.5,
              bgcolor: c.bg.surface, border: `1px solid ${c.border.medium}`,
              boxShadow: c.shadow.md, borderRadius: '12px',
              px: 2, py: 1.25,
              whiteSpace: 'normal',
              zIndex: 5,
            }}
          >
            <Box sx={{
              color: c.text.primary, fontSize: '0.88rem', lineHeight: 1.45,
              flex: '1 1 auto', minWidth: 0,
            }}>
              {headline}
            </Box>
            <Box sx={{ display: 'flex', gap: 0.75, flexShrink: 0 }}>
              <Box
                component="button"
                disabled={shrinking}
                onClick={onShrink}
                sx={{
                  bgcolor: c.accent.primary, color: '#fff',
                  border: 'none', borderRadius: '6px',
                  px: 1.5, py: 0.7, fontSize: '0.82rem', fontWeight: 500, cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  transition: 'background 0.15s ease, opacity 0.15s ease',
                  '&:hover': { bgcolor: c.accent.hover },
                  '&:disabled': { opacity: 0.85, cursor: 'wait', bgcolor: c.accent.primary },
                }}
              >
                {shrinking ? <ShrinkingLabel /> : shrinkLabel}
              </Box>
              <Box
                component="button"
                disabled={shrinking}
                onClick={onRemove}
                sx={{
                  bgcolor: 'transparent', color: c.text.secondary,
                  border: `1px solid ${c.border.medium}`, borderRadius: '6px',
                  px: 1.5, py: 0.7, fontSize: '0.82rem', cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  transition: 'background 0.15s ease, color 0.15s ease',
                  '&:hover': { bgcolor: c.bg.secondary, color: c.text.primary },
                  '&:disabled': { opacity: 0.5, cursor: 'not-allowed' },
                }}
              >
                {removeLabel}
              </Box>
            </Box>
          </Box>
        );
      })()}

      {/* Same panel-scoped approach for the error toast. Auto-dismiss kept via useEffect timer below. */}
      {summarizeError && (
      <Box
        sx={{
          position: 'absolute', left: 8, right: 8, bottom: 'calc(100% + 8px)',
          display: 'flex', alignItems: 'center', gap: 1.5,
          bgcolor: c.bg.surface, border: `1px solid ${c.border.medium}`,
          boxShadow: c.shadow.md, borderRadius: '12px',
          px: 2, py: 1.25,
          whiteSpace: 'normal',
          zIndex: 6,
        }}
      >
          <Box sx={{
            color: c.text.primary, fontSize: '0.88rem', lineHeight: 1.45,
            flex: '1 1 auto', minWidth: 0,
          }}>
            {summarizeError}
          </Box>
          <IconButton
            onClick={() => setSummarizeError(null)}
            size="small"
            sx={{ color: c.text.secondary, flexShrink: 0, '&:hover': { color: c.text.primary } }}
          >
            <CloseIcon sx={{ fontSize: 18 }} />
          </IconButton>
      </Box>
      )}
    </>
  );
};
