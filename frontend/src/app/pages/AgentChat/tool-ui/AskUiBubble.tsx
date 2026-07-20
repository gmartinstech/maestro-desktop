import React, { useCallback, useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import ToolCallBubble from '../tool-bubbles/ToolCallBubble';
import type { ToolPair } from '../tool-bubbles/ToolCallBubble';
import { parseShowUiPayload } from './showUiPayload';
import VendoredToolUi from '@toolui/VendoredToolUi';
import { API_BASE, getAuthToken } from '@/shared/config';

interface AskUiBubbleProps {
  pair: ToolPair;
  sessionId: string;
  isPending: boolean;
  suppressReveal: boolean;
}

function parseResultResponse(pair: ToolPair): Record<string, unknown> | null {
  const rc = pair.result?.content;
  const text = typeof rc === 'string' ? rc : typeof rc === 'object' && rc?.text ? String(rc.text) : '';
  if (!text.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/** An AskUI call: the live interactive component while the agent waits; its answered state after. */
function AskUiBubble({ pair, sessionId, isPending, suppressReveal }: AskUiBubbleProps): React.ReactElement {
  const payload = parseShowUiPayload(pair);
  const [submitted, setSubmitted] = useState(false);
  const answered = parseResultResponse(pair);

  const componentId = payload && payload.component === 'vendored' ? String(payload.props.id || '') : '';

  const respond = useCallback(
    (response: Record<string, unknown>) => {
      if (submitted) return;
      setSubmitted(true);
      void fetch(`${API_BASE}/ui-requests/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getAuthToken()}` },
        body: JSON.stringify({ session_id: sessionId, component_id: componentId, response }),
      }).catch(() => setSubmitted(false));
    },
    [submitted, sessionId, componentId],
  );

  // Their embedded-actions contract: onAction(actionId, state) delivers the component's full state;
  // approval-card uses onConfirm/onCancel instead. Inject a default Send action when none given.
  const extraProps = useMemo(() => {
    if (!payload || payload.component !== 'vendored') return {};
    const waiting = pair.result === null && !submitted;
    if (payload.name === 'approval-card') {
      return waiting
        ? {
            onConfirm: () => respond({ action: 'confirm', choice: 'approved' }),
            onCancel: () => respond({ action: 'cancel', choice: 'denied' }),
          }
        : { choice: (answered?.choice as string) || undefined };
    }
    if (waiting) {
      const hasActions = Array.isArray((payload.props as { actions?: unknown[] }).actions) && (payload.props as { actions?: unknown[] }).actions!.length > 0;
      return {
        ...(hasActions ? {} : { actions: [{ id: 'submit', label: 'Send' }] }),
        onAction: (actionId: string, state: unknown) => respond({ action: actionId, value: state ?? null }),
      };
    }
    return answered && 'value' in answered ? { choice: answered.value } : {};
  }, [payload, pair.result, submitted, respond, answered]);

  if (!payload || payload.component !== 'vendored' || !componentId) {
    return (
      <ToolCallBubble call={pair.call} result={pair.result} isPending={isPending} sessionId={sessionId} suppressReveal={suppressReveal} />
    );
  }

  return (
    <Box sx={{ my: 1, contain: 'layout style' }} data-select-type="tool-ui-ask" data-select-id={pair.id} data-select-meta={JSON.stringify({ component: payload.name })}>
      <VendoredToolUi name={payload.name} props={payload.props} extraProps={extraProps} />
      {submitted && pair.result === null && (
        <Box sx={{ fontSize: '0.72rem', opacity: 0.55, pt: 0.5 }}>Sent to the agent...</Box>
      )}
    </Box>
  );
}

export default AskUiBubble;
