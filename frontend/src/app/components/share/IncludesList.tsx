// The "what's inside this bundle" panel, shared by the Share and Import modals:
// the root entity, the dependencies pulled in with it, and any environment
// requirements (an Action the importer must enable themselves).
import React from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

import { useClaudeTokens } from '@/shared/styles/ThemeContext';

import { BundleSummary } from './shareTypes';

const KIND_LABEL: Record<string, string> = {
  skill: 'Skill',
  app: 'App',
  dashboard: 'Dashboard',
  mode: 'Mode',
  workflow: 'Workflow',
  session: 'Agent',
};

const IncludesList: React.FC<{ summary: BundleSummary }> = ({ summary }) => {
  const c = useClaudeTokens();

  const Row: React.FC<{ tag: string; name: string; detail?: string; faded?: boolean }> = ({
    tag,
    name,
    detail,
    faded,
  }) => (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.5 }}>
      <Typography
        sx={{
          fontSize: '0.6rem',
          fontWeight: 700,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          color: c.text.tertiary,
          minWidth: 60,
          flexShrink: 0,
        }}
      >
        {tag}
      </Typography>
      <Typography
        sx={{
          fontSize: '0.85rem',
          color: faded ? c.text.muted : c.text.primary,
          flex: 1,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {name}
      </Typography>
      {detail && (
        <Typography sx={{ fontSize: '0.72rem', color: c.text.muted, flexShrink: 0 }}>{detail}</Typography>
      )}
    </Box>
  );

  return (
    <Box
      sx={{
        border: `1px solid ${c.border.subtle}`,
        borderRadius: `${c.radius.md}px`,
        bgcolor: c.bg.surface,
        px: 1.5,
        py: 0.5,
      }}
    >
      <Row tag={KIND_LABEL[summary.root.type] || summary.root.type} name={summary.root.name} />
      {summary.includes.map((it, i) => (
        <Row key={`inc-${i}`} tag={KIND_LABEL[it.type] || it.type} name={it.name} detail={it.detail} />
      ))}
      {summary.requirements.length > 0 && (
        <Box sx={{ mt: 0.5, pt: 0.5, borderTop: `1px solid ${c.border.subtle}` }}>
          {summary.requirements.map((r, i) => (
            <Row key={`req-${i}`} tag="Needs" name={r.label} detail={r.detail} faded />
          ))}
        </Box>
      )}
    </Box>
  );
};

export default IncludesList;
