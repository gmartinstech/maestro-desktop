import type React from 'react';
import EmailIcon from '@mui/icons-material/MailOutlineRounded';
import EventNoteIcon from '@mui/icons-material/EventNoteRounded';
import ChromeReaderModeIcon from '@mui/icons-material/ChromeReaderModeRounded';
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutlineRounded';
import CalendarTodayIcon from '@mui/icons-material/CalendarTodayRounded';
import ArticleIcon from '@mui/icons-material/ArticleRounded';
import LanguageIcon from '@mui/icons-material/LanguageRounded';
import CodeIcon from '@mui/icons-material/CodeRounded';
import SearchIcon from '@mui/icons-material/SearchRounded';
import SmsIcon from '@mui/icons-material/SmsRounded';
import PhoneInTalkIcon from '@mui/icons-material/PhoneInTalkRounded';
import type { Workflow, WorkflowRun } from '@/shared/state/workflowsSlice';

// ---------- Step icon auto-classifier ----------

// Pick a glyph by keyword scan of the step text. Falls back to the step number when nothing matches. Same Roman-numeral simple heuristic the user sees: "summarize email" -> mail icon, "make notion page" -> article icon, etc.
const ICON_RULES: Array<{ pattern: RegExp; Icon: React.ElementType }> = [
  { pattern: /\b(email|inbox|gmail|outlook|mail)\b/i, Icon: EmailIcon },
  { pattern: /\b(calendar|schedule|event|meeting)\b/i, Icon: CalendarTodayIcon },
  { pattern: /\b(notion|doc|page|page template|document|article)\b/i, Icon: ArticleIcon },
  { pattern: /\b(text|sms|message|whatsapp|imessage)\b/i, Icon: SmsIcon },
  { pattern: /\b(call|phone|dial|ring)\b/i, Icon: PhoneInTalkIcon },
  { pattern: /\b(browser|web|website|url|fetch|visit|navigate)\b/i, Icon: LanguageIcon },
  { pattern: /\b(search|find|look up|google)\b/i, Icon: SearchIcon },
  { pattern: /\b(code|github|repo|script|bash|run)\b/i, Icon: CodeIcon },
  { pattern: /\b(read|review|summarize|summary)\b/i, Icon: ChromeReaderModeIcon },
  { pattern: /\b(chat|reply|respond|dm)\b/i, Icon: ChatBubbleOutlineIcon },
  { pattern: /\b(note|memo|journal|log)\b/i, Icon: EventNoteIcon },
];

export function stepIconFor(text: string): React.ElementType | null {
  for (const rule of ICON_RULES) {
    if (rule.pattern.test(text)) return rule.Icon;
  }
  return null;
}

// ---------- Step duration learner ----------

// Estimates per-step duration by averaging recent runs. Today we only have whole-run duration on each WorkflowRun (started_at -> finished_at), so the heuristic spreads it evenly across the step count. When per-step telemetry lands later, swap this for a per-step lookup.
export function estimateStepDuration(workflow: Workflow, runs: WorkflowRun[] | undefined, stepIdx: number): string | null {
  if (!runs || runs.length === 0) return null;
  const steps = workflow.steps?.length || 1;
  const successful = runs.filter((r) => (r.status === 'success' || r.status === 'ran_late') && r.finished_at);
  if (successful.length === 0) return null;
  const durations = successful.slice(0, 10).map((r) => {
    const start = new Date(r.started_at).getTime();
    const end = new Date(r.finished_at!).getTime();
    return Math.max(0, end - start);
  });
  const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
  const perStepMs = avg / steps;
  void stepIdx;
  return humanDuration(perStepMs);
}

export function humanDuration(ms: number): string {
  if (ms < 1000) return '<1s';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem > 0 && m < 5 ? `${m}m ${rem}s` : `${m}m`;
}

// ---------- Run-button breath logic ----------

// Returns true when the workflow hasn't been run in over 24h. Used by the Run tab to add a subtle CSS breathing animation so the button invites use without yelling.
export function isStaleSinceLastRun(workflow: Workflow): boolean {
  if (!workflow.last_run_at) return false;
  const age = Date.now() - new Date(workflow.last_run_at).getTime();
  return age > 24 * 3600 * 1000;
}
