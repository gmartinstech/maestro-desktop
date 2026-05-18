import React, { useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import Switch from '@mui/material/Switch';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import type { Workflow } from '@/shared/state/workflowsSlice';
import { BODY_FS, LABEL_FS, HINT_FS } from './workflowEditCommon';

const BUILT_IN_SETS = ['Core Actions', 'Extended Actions', 'Apps', 'Browser'] as const;
const CUSTOM_SETS = ['Notion', 'Google Workspace', 'YouTube', 'Reddit'] as const;

export default function ActionsFacet({ draft, setDraft }: { draft: Workflow; setDraft: (w: Workflow) => void }) {
  const c = useClaudeTokens();
  // Configure only appears when freeze is on; "Don't freeze" hides it
  // entirely so the surface doesn't lie about what's enabled.
  const [configuring, setConfiguring] = useState(false);
  const toggleSet = (set: string, on: boolean) => {
    const next = on
      ? Array.from(new Set([...draft.actions.configured_sets, set]))
      : draft.actions.configured_sets.filter((s) => s !== set);
    setDraft({ ...draft, actions: { ...draft.actions, configured_sets: next } });
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25, color: c.text.secondary }}>
      <Typography sx={{ fontSize: BODY_FS, color: c.text.secondary, lineHeight: 1.5 }}>
        Do you want to prevent the agent from taking actions that weren&apos;t used in the original workflow?
      </Typography>
      <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Select
          size="small"
          value={draft.actions.prevent_unused ? 'prevent' : 'allow'}
          onChange={(e) => setDraft({ ...draft, actions: { ...draft.actions, prevent_unused: e.target.value === 'prevent' } })}
          sx={{ fontSize: LABEL_FS, '& .MuiSelect-select': { py: 0.5 } }}>
          <MenuItem value="prevent">Prevent all unwanted actions</MenuItem>
          <MenuItem value="allow">Allow all actions</MenuItem>
        </Select>
      </Box>

      <Typography sx={{ fontSize: BODY_FS, color: c.text.secondary, lineHeight: 1.5, mt: 0.5 }}>
        Do you want to freeze the actions available to the Agent so this flow always works even if you change your settings?
      </Typography>
      <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Select
          size="small"
          value={draft.actions.freeze ? 'freeze' : 'dont'}
          onChange={(e) => setDraft({ ...draft, actions: { ...draft.actions, freeze: e.target.value === 'freeze' } })}
          sx={{ fontSize: LABEL_FS, '& .MuiSelect-select': { py: 0.5 } }}>
          <MenuItem value="freeze">Freeze actions</MenuItem>
          <MenuItem value="dont">Don&apos;t freeze</MenuItem>
        </Select>
      </Box>

      {draft.actions.freeze && (
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 0.5 }}>
          <Box
            onClick={() => setConfiguring((v) => !v)}
            role="button"
            sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.4, fontSize: LABEL_FS, color: configuring ? c.accent.primary : c.text.secondary, cursor: 'pointer', fontWeight: 500, '&:hover': { color: c.accent.primary } }}>
            {configuring ? '⚙ Configuring…' : '⚙ Configure'}
          </Box>
        </Box>
      )}

      {draft.actions.freeze && configuring && (
        <Box sx={{ mt: 0.5, display: 'flex', flexDirection: 'column', gap: 0.6, border: `1px solid ${c.accent.primary}40`, borderRadius: `${c.radius.lg}px`, p: 1.25 }}>
          <Typography sx={{ fontSize: HINT_FS, fontWeight: 700, color: c.text.secondary, letterSpacing: '0.05em', mb: 0.25 }}>BUILT-IN ACTION SETS</Typography>
          {BUILT_IN_SETS.map((set) => (
            <ActionSetRow key={set} set={set} enabled={draft.actions.configured_sets.includes(set)} onChange={(on) => toggleSet(set, on)} />
          ))}
          <Typography sx={{ fontSize: HINT_FS, fontWeight: 700, color: c.text.secondary, letterSpacing: '0.05em', mt: 0.75, mb: 0.25 }}>CUSTOM ACTION SETS</Typography>
          {CUSTOM_SETS.map((set) => (
            <ActionSetRow key={set} set={set} enabled={draft.actions.configured_sets.includes(set)} onChange={(on) => toggleSet(set, on)} />
          ))}
        </Box>
      )}
    </Box>
  );
}

function ActionSetRow({ set, enabled, onChange }: { set: string; enabled: boolean; onChange: (v: boolean) => void }) {
  const c = useClaudeTokens();
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, border: `1px solid ${c.border.subtle}`, borderRadius: `${c.radius.md}px`, px: 1, py: 0.6 }}>
      <Typography sx={{ flex: 1, fontSize: BODY_FS, color: c.text.primary, fontWeight: 600 }}>{set}</Typography>
      <Switch size="small" checked={enabled} onChange={(e) => onChange(e.target.checked)} />
    </Box>
  );
}
