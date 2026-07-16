// The user's provider chat history is read offscreen in the main process (see electron/usageHarvest.js), which owns the injected script + the partition session. This module holds only the shared shape + the pure summarizer that turns the raw read into the compact profile block prep sees. The raw read is dropped after; only this summary travels.

export type UsageProvider = 'codex' | 'claude';

export interface ProviderUsage {
  ok: boolean;
  total: number;
  titles: string[];
  memories: string[];
}

// Turn the raw read into a compact profile block for the prep prompt: the memory facts (strongest), the scale, and the most-recent topics. Capped hard so we never ship a wall of PII even for a heavy user; the aux model turns this into the profile.
export function summarizeUsage(u: ProviderUsage | null): string {
  if (!u || !u.ok) return '';
  const parts: string[] = [];
  if (u.total > 0) parts.push(`They have ${u.total} past AI conversations.`);
  if (u.memories.length > 0) parts.push('Facts their AI remembers about them: ' + u.memories.join('; '));
  if (u.titles.length > 0) parts.push('Topics they keep coming back to (recent first): ' + u.titles.slice(0, 150).join('; '));
  return parts.join('\n').slice(0, 4000);
}
