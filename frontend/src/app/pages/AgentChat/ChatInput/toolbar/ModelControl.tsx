import React from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import { ClaudeTokens } from '@/shared/styles/claudeTokens';

interface Props {
  c: ClaudeTokens;
  setModelAnchor: (el: HTMLElement | null) => void;
  allModelFlat: Array<any>;
  model: string;
}

// The model-name trigger that opens ModelPickerMenu. Lived inside ModeControl until modes were hidden from the UI; the picker needs its button regardless of modes.
export const ModelControl: React.FC<Props> = ({ c, setModelAnchor, allModelFlat, model }) => {
  return (
    <Box
      onClick={(e) => setModelAnchor(e.currentTarget)}
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.25,
        px: 0.75,
        py: 0.25,
        borderRadius: '6px',
        cursor: 'pointer',
        userSelect: 'none',
        color: c.text.muted,
        '&:hover': { bgcolor: 'rgba(0,0,0,0.04)' },
        transition: 'background 0.15s',
      }}
    >
      <Typography sx={{ fontSize: '0.82rem', fontWeight: 500, color: 'inherit', lineHeight: 1 }}>
        {(() => { const m = allModelFlat.find((m) => m.value === model); return m ? m.label : model; })()}
      </Typography>
      <KeyboardArrowDownIcon sx={{ fontSize: 14, color: 'inherit', opacity: 0.7 }} />
    </Box>
  );
};
