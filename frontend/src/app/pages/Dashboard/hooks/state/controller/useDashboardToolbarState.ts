import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';

interface UseDashboardToolbarStateArgs {
  canvasEmpty: boolean;
  toolbarOpen: boolean;
  setToolbarOpen: Dispatch<SetStateAction<boolean>>;
  setNewAgentBounce: Dispatch<SetStateAction<boolean>>;
}

// Two small, independent bits of toolbar UI state that only feed the final render (bounce nudge dismissal + starter-prompt prefill), kept out of the composition root so it isn't buried among the state that actually threads between hooks.
export function useDashboardToolbarState({
  canvasEmpty,
  toolbarOpen,
  setToolbarOpen,
  setNewAgentBounce,
}: UseDashboardToolbarStateArgs) {
  // Nudge the chat button while the canvas is empty; the first click dismisses it for this visit.
  const bounceDismissedRef = useRef(false);
  useEffect(() => {
    setNewAgentBounce(canvasEmpty && !bounceDismissedRef.current);
  }, [canvasEmpty, setNewAgentBounce]);
  const handleNewAgentBounceEnd = () => {
    bounceDismissedRef.current = true;
    setNewAgentBounce(false);
  };

  // Starter-prompt click: opens the composer with the prompt typed in (translucent, unsent), so the user reviews and hits send. A Build starter also passes the App Builder mode ('view-builder') so it builds in-place on the dashboard, no context switch to the Apps page. Both cleared when the composer closes.
  const [toolbarPrefill, setToolbarPrefill] = useState<string | undefined>(undefined);
  const [toolbarPrefillMode, setToolbarPrefillMode] = useState<string | undefined>(undefined);
  const handleStarter = useCallback((prompt: string, mode?: string) => {
    setToolbarPrefill(prompt);
    setToolbarPrefillMode(mode);
    setToolbarOpen(true);
  }, [setToolbarOpen]);
  useEffect(() => {
    if (!toolbarOpen) {
      if (toolbarPrefill) setToolbarPrefill(undefined);
      if (toolbarPrefillMode) setToolbarPrefillMode(undefined);
    }
  }, [toolbarOpen, toolbarPrefill, toolbarPrefillMode]);

  return { toolbarPrefill, toolbarPrefillMode, handleStarter, handleNewAgentBounceEnd };
}
