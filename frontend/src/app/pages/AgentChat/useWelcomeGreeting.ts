import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppDispatch } from '@/shared/hooks';
import { streamStart, streamDelta } from '@/shared/state/streamingSlice';
import { addMessage, type AgentSession } from '@/shared/state/agentsSlice';

const GREETING_MSG_ID = 'welcome-greeting';

// Streams the first-run greeting in as a genuine assistant bubble: it rides the same streaming slice + smooth-reveal every real reply uses, then settles into a real message so the chips can follow. Pure UI, no LLM, no run: launchAndSendFirstMessage POSTs only the prompt, so this seeded message is dropped on the server swap and never reaches the backend.
export function useWelcomeGreeting(
  session: AgentSession | undefined,
  isDraft: boolean,
): { greetingDone: boolean } {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const [greetingDone, setGreetingDone] = useState(false);
  const startedRef = useRef(false);

  const eligible = isDraft && !!session?.is_welcome_draft && (session?.messages?.length ?? 0) === 0;
  const sessionId = session?.id;
  const branchId = session?.active_branch_id || 'main';

  useEffect(() => {
    if (!eligible || !sessionId || startedRef.current) return;
    startedRef.current = true;

    const greeting = t('agentChat.welcome.greeting');
    dispatch(streamStart({ sessionId, messageId: GREETING_MSG_ID, role: 'assistant' }));

    // Feed word-by-word at a real-reply cadence; useSmoothText trails it for the typed look.
    const tokens = greeting.split(/(\s+)/);
    let i = 0;
    const timer = window.setInterval(() => {
      const chunk = (tokens[i] ?? '') + (tokens[i + 1] ?? '');
      i += 2;
      if (chunk) dispatch(streamDelta({ sessionId, messageId: GREETING_MSG_ID, delta: chunk }));
      if (i >= tokens.length) {
        window.clearInterval(timer);
        // Settle into a real message; addMessage's listener clears the matching stream entry.
        dispatch(addMessage({
          sessionId,
          message: {
            id: GREETING_MSG_ID,
            role: 'assistant',
            content: greeting,
            timestamp: new Date().toISOString(),
            branch_id: branchId,
            parent_id: null,
          },
        }));
        setGreetingDone(true);
      }
    }, 50);

    return () => window.clearInterval(timer);
  }, [eligible, sessionId, branchId, dispatch, t]);

  return { greetingDone };
}
