import React, { useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import InputBase from '@mui/material/InputBase';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import type { Workflow } from '@/shared/state/workflowsSlice';
import { FieldRow, BODY_FS, LABEL_FS, HINT_FS, INPUT_FS } from './workflowEditCommon';

export default function GeneralFacet({ draft, setDraft }: { draft: Workflow; setDraft: (w: Workflow) => void }) {
  const c = useClaudeTokens();
  const [editingPrompt, setEditingPrompt] = useState(false);
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
      <FieldRow label="Title">
        <InputBase
          value={draft.title}
          onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          sx={{ flex: 1, fontSize: INPUT_FS, color: c.text.primary, border: `1px solid ${c.border.subtle}`, borderRadius: `${c.radius.md}px`, px: 1, py: 0.5 }}
        />
      </FieldRow>
      <FieldRow label="Description" align="top">
        <InputBase
          multiline
          minRows={2}
          value={draft.description}
          onChange={(e) => setDraft({ ...draft, description: e.target.value })}
          sx={{ flex: 1, fontSize: INPUT_FS, color: c.text.secondary, lineHeight: 1.5, border: `1px solid ${c.border.subtle}`, borderRadius: `${c.radius.md}px`, px: 1, py: 0.5 }}
        />
      </FieldRow>
      <FieldRow label="System prompt">
        <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', gap: 0.75 }}>
          <Box sx={{ fontSize: LABEL_FS, color: c.accent.primary, cursor: 'pointer', fontWeight: 500 }} onClick={() => setEditingPrompt((v) => !v)}>
            {editingPrompt ? 'Editing…' : 'Edit'}
          </Box>
          <Select
            size="small"
            value={draft.use_synced_prompt ? 'synced' : 'custom'}
            onChange={(e) => setDraft({ ...draft, use_synced_prompt: e.target.value === 'synced' })}
            sx={{ fontSize: LABEL_FS, '& .MuiSelect-select': { py: 0.5 } }}>
            <MenuItem value="synced">Synced to settings</MenuItem>
            <MenuItem value="custom">Custom</MenuItem>
          </Select>
        </Box>
      </FieldRow>
      {editingPrompt && !draft.use_synced_prompt && (
        <InputBase
          multiline
          minRows={4}
          placeholder="Custom system prompt..."
          value={draft.system_prompt || ''}
          onChange={(e) => setDraft({ ...draft, system_prompt: e.target.value })}
          sx={{ fontSize: INPUT_FS, color: c.text.primary, border: `1px solid ${c.border.subtle}`, borderRadius: `${c.radius.md}px`, p: 1, lineHeight: 1.5 }}
        />
      )}
      <Typography sx={{ fontSize: BODY_FS, fontWeight: 700, color: c.text.primary, mt: 0.5 }}>Workflow</Typography>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        {draft.steps.map((s, idx) => (
          <Box key={s.id} sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.25 }}>
            <Box sx={{ width: 24, height: 24, borderRadius: '50%', border: `1px solid ${c.border.medium}`, fontSize: HINT_FS, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', color: c.text.secondary, flexShrink: 0, mt: 0.4 }}>{idx + 1}</Box>
            <InputBase
              multiline
              value={s.text}
              onChange={(e) => {
                const next = [...draft.steps];
                next[idx] = { ...s, text: e.target.value };
                setDraft({ ...draft, steps: next });
              }}
              sx={{ flex: 1, fontSize: INPUT_FS, color: c.text.primary, border: `1px solid ${c.border.subtle}`, borderRadius: `${c.radius.md}px`, px: 1.25, py: 0.6, lineHeight: 1.4 }}
            />
          </Box>
        ))}
      </Box>
    </Box>
  );
}
