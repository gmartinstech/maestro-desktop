import { useEffect, useRef } from 'react';
import { Box, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import { useTermColors } from '@/app/pages/AgentChat/parsing/toolColorize';
import { useTerminalSocket } from '@/shared/hooks/useTerminalSocket';

interface ShellPanelProps {
  workspaceId: string;
  instance: number;
  /** False while another tab is showing; the pane stays mounted but must not fit or steal focus. */
  active: boolean;
}

export function ShellPanel({ workspaceId, instance, active }: ShellPanelProps) {
  const { t } = useTranslation();
  const c = useClaudeTokens();
  const tc = useTermColors();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  // Output can arrive before the terminal is constructed, so writes go through a ref that starts as a no-op rather than dropping the replay burst.
  const writeRef = useRef<(data: string) => void>(() => {});
  const sendInputRef = useRef<(data: string) => void>(() => {});
  const sendResizeRef = useRef<(cols: number, rows: number) => void>(() => {});

  const { status, exitCode, sendInput, sendResize } = useTerminalSocket({
    workspaceId,
    instance,
    enabled: true,
    onOutput: (data) => writeRef.current(data),
  });
  sendInputRef.current = sendInput;
  sendResizeRef.current = sendResize;

  useEffect(() => {
    if (!hostRef.current) return;
    const term = new Terminal({
      fontFamily: c.font.mono,
      fontSize: 12,
      cursorBlink: true,
      convertEol: false,
      theme: {
        background: tc.TERM_BG,
        foreground: tc.OUTPUT_COLOR,
        cursor: tc.CMD_COLOR,
        selectionBackground: `${tc.CMD_COLOR}44`,
        black: tc.DIM_COLOR,
        red: tc.STDERR_COLOR,
        green: tc.ADD_COLOR,
        yellow: tc.WARN_COLOR,
        blue: tc.PATH_COLOR,
        magenta: tc.DIFF_HEADER_COLOR,
        cyan: tc.PROMPT_COLOR,
        white: tc.CMD_COLOR,
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(hostRef.current);
    termRef.current = term;
    fitRef.current = fit;
    writeRef.current = (data: string) => term.write(data);
    // Calling sendInput through a ref keeps this effect off the socket's identity, so a re-render never rebuilds the terminal and loses scrollback.
    const disposable = term.onData((data) => sendInputRef.current(data));
    return () => {
      disposable.dispose();
      writeRef.current = () => {};
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [workspaceId, instance]);

  useEffect(() => {
    const host = hostRef.current;
    if (!active || !host || !fitRef.current) return;
    // Fitting a hidden element measures zero and collapses the viewport to 1x1, so this only runs while visible.
    const doFit = () => {
      try {
        fitRef.current?.fit();
        const term = termRef.current;
        if (term) sendResizeRef.current(term.cols, term.rows);
      } catch {
        // Element is not laid out yet; the ResizeObserver will fire again once it is.
      }
    };
    doFit();
    termRef.current?.focus();
    const observer = new ResizeObserver(doFit);
    observer.observe(host);
    return () => observer.disconnect();
  }, [active, status]);

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', bgcolor: tc.TERM_BG }}>
      <Box ref={hostRef} sx={{ flex: 1, minHeight: 0, p: 0.5, '& .xterm': { height: '100%' } }} />
      {exitCode !== null && (
        <Typography sx={{ px: 1, py: 0.5, fontFamily: c.font.mono, fontSize: '0.7rem', color: c.text.muted }}>
          {t('views.shell.exited', { code: exitCode })}
        </Typography>
      )}
    </Box>
  );
}
