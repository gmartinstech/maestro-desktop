import React, { useCallback, useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import { useAppDispatch } from '@/shared/hooks';
import { updateWorkflow, type Workflow } from '@/shared/state/workflowsSlice';
import { validateDraft } from './permissionsUtils';
import { ActionBtn, LABEL_FS, HINT_FS } from './workflowEditCommon';
import GeneralFacet from './GeneralFacet';
import ActionsFacet from './ActionsFacet';
import ScheduleFacet from './ScheduleFacet';

interface Props {
  workflow: Workflow;
  facet: 'General' | 'Actions' | 'Schedule';
  onChangeFacet: (facet: 'General' | 'Actions' | 'Schedule') => void;
}

export default function WorkflowEditViews({ workflow, facet, onChangeFacet }: Props) {
  const c = useClaudeTokens();
  const dispatch = useAppDispatch();
  const [draft, setDraft] = useState<Workflow>(workflow);
  const [busy, setBusy] = useState(false);
  // Save-feedback state. `savedFlash` flashes a checkmark for 1.4s then
  // auto-clears; `saveError` carries a string the user can read.
  const [savedFlash, setSavedFlash] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(workflow), [draft, workflow]);

  const onSave = useCallback(async () => {
    if (busy || !dirty) return;
    const reason = validateDraft(draft);
    if (reason) {
      setSaveError(reason);
      return;
    }
    setSaveError(null);
    setBusy(true);
    try {
      const result = await dispatch(updateWorkflow({ id: workflow.id, patch: draft }));
      if (updateWorkflow.fulfilled.match(result)) {
        setSavedFlash(true);
        setTimeout(() => setSavedFlash(false), 1400);
      } else {
        setSaveError('Save failed. Please try again.');
      }
    } catch (e) {
      setSaveError((e as Error)?.message || 'Save failed.');
    } finally {
      setBusy(false);
    }
  }, [busy, dirty, dispatch, workflow.id, draft]);

  const onDiscard = useCallback(() => {
    setDraft(workflow);
    setSaveError(null);
  }, [workflow]);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Typography sx={{ fontSize: LABEL_FS, color: c.text.secondary, fontWeight: 500 }}>Currently Editing</Typography>
        <Select
          size="small"
          value={facet}
          onChange={(e) => onChangeFacet(e.target.value as Props['facet'])}
          sx={{ fontSize: LABEL_FS, '& .MuiSelect-select': { py: 0.5 } }}>
          <MenuItem value="General">General</MenuItem>
          <MenuItem value="Actions">Actions</MenuItem>
          <MenuItem value="Schedule">Schedule</MenuItem>
        </Select>
        <Box sx={{ flex: 1 }} />
        <ActionBtn label="Discard" tone="muted" disabled={!dirty || busy} onClick={onDiscard} />
        <ActionBtn
          label={savedFlash ? '✓ Saved' : busy ? 'Saving…' : 'Save'}
          tone="success"
          disabled={!dirty || busy || savedFlash}
          onClick={onSave}
        />
      </Box>

      {saveError && (
        <Typography sx={{ fontSize: HINT_FS, color: c.status.error, bgcolor: c.status.errorBg, px: 1, py: 0.5, borderRadius: `${c.radius.md}px` }}>
          {saveError}
        </Typography>
      )}

      {facet === 'General' && <GeneralFacet draft={draft} setDraft={setDraft} />}
      {facet === 'Actions' && <ActionsFacet draft={draft} setDraft={setDraft} />}
      {facet === 'Schedule' && <ScheduleFacet draft={draft} setDraft={setDraft} />}
    </Box>
  );
}
