import React, { RefObject } from 'react';
import Box from '@mui/material/Box';
import { useTranslation } from 'react-i18next';
import { ClaudeTokens } from '@/shared/styles/claudeTokens';

interface Props {
  c: ClaudeTokens;
  editorRef: RefObject<HTMLDivElement>;
  disabled?: boolean;
  hasContent: boolean;
  hasAttachments: boolean;
  autoRunMode?: boolean;
  isRunning?: boolean;
  queueLength: number;
  placeholderLabel: string;
  onInput: () => void;
  onClick: () => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  onPaste: (e: React.ClipboardEvent) => void;
}

export const EditorSurface: React.FC<Props> = ({
  c, editorRef, disabled, hasContent, hasAttachments, autoRunMode, isRunning, queueLength,
  placeholderLabel, onInput, onClick, onKeyDown, onPaste,
}) => {
  const { t } = useTranslation();
  const placeholderText = disabled
    ? t('agentChat.chatInput.placeholder.agentWorkingDisabled')
    : autoRunMode
      ? t('agentChat.chatInput.placeholder.autoRun')
      : isRunning
        ? (queueLength > 0 ? t('agentChat.chatInput.placeholder.queued', { count: queueLength }) : t('agentChat.chatInput.placeholder.runningWillQueue'))
        : placeholderLabel;

  return (
    <Box sx={{ px: 1.5, pt: hasAttachments ? 0.5 : 1.25, pb: 0.25, position: 'relative' }}>
      <div
        ref={editorRef}
        data-onboarding="chat-input"
        data-testid="chat-input"
        // A contenteditable div has no implicit textbox role, so assistive tech and
        // getByRole('textbox') both missed the composer entirely until this was explicit.
        role="textbox"
        aria-multiline="true"
        aria-label={placeholderText}
        contentEditable={!disabled}
        suppressContentEditableWarning
        spellCheck={false}
        onInput={onInput}
        onClick={onClick}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        style={{
          width: '100%',
          minHeight: '1.5em',
          maxHeight: 220,
          overflowY: 'auto',
          background: 'transparent',
          border: 'none',
          outline: 'none',
          color: c.text.primary,
          fontSize: '0.95rem',
          lineHeight: '1.55',
          fontFamily: 'inherit',
          wordBreak: 'break-word',
          whiteSpace: 'pre-wrap',
        }}
      />
      {!hasContent && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            padding: `${hasAttachments ? 4 : 10}px 12px`,
            color: c.text.tertiary,
            fontSize: '0.95rem',
            lineHeight: '1.5',
            fontFamily: 'inherit',
            pointerEvents: 'none',
            userSelect: 'none',
          }}
        >
          {placeholderText}
        </div>
      )}
    </Box>
  );
};
