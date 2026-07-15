// Reads what the user actually uses their AI for, from a logged-in provider website inside a browser-card webview: ChatGPT Memory + recent titles, or Claude conversation titles. Same-origin fetch using the site's own session (the proven extension technique). The RAW result never leaves the renderer; only the derived summary goes to prep, and even that is dropped after.

export type UsageProvider = 'codex' | 'claude';

export interface ProviderUsage {
  ok: boolean;
  titles: string[];
  memories: string[];
}

// Runs in the WEBVIEW page context (chatgpt.com / claude.ai), so it inherits the live session. Kept as a string because it is injected via webview.executeJavaScript.
export const USAGE_READ_JS: Record<UsageProvider, string> = {
  codex: `(async () => {
    try {
      const sess = await fetch('/api/auth/session', {credentials:'include'}).then(r=>r.json());
      if (!sess || !sess.accessToken) return {ok:false, titles:[], memories:[]};
      const H = {headers:{Authorization:'Bearer '+sess.accessToken, accept:'application/json'}, credentials:'include'};
      const conv = await fetch('/backend-api/conversations?offset=0&limit=25&order=updated', H).then(r=>r.ok?r.json():null).catch(()=>null);
      const mem = await fetch('/backend-api/memories?include_memory_entries=true', H).then(r=>r.ok?r.json():null).catch(()=>null);
      return {
        ok: true,
        titles: ((conv && conv.items) || []).map(c=>c.title).filter(Boolean).slice(0,25),
        memories: ((mem && mem.memories) || []).map(m=>m.content).filter(Boolean).slice(0,25),
      };
    } catch (e) { return {ok:false, titles:[], memories:[]}; }
  })()`,
  claude: `(async () => {
    try {
      const orgs = await fetch('/api/organizations', {credentials:'include', headers:{accept:'application/json'}}).then(r=>r.ok?r.json():null).catch(()=>null);
      if (!Array.isArray(orgs) || !orgs.length) return {ok:false, titles:[], memories:[]};
      const org = orgs[0].uuid;
      const convs = await fetch('/api/organizations/'+org+'/chat_conversations?limit=30', {credentials:'include', headers:{accept:'application/json'}}).then(r=>r.ok?r.json():null).catch(()=>null);
      return {ok:true, titles:(Array.isArray(convs)?convs:[]).map(c=>c.name).filter(Boolean).slice(0,30), memories:[]};
    } catch (e) { return {ok:false, titles:[], memories:[]}; }
  })()`,
};

export const USAGE_ORIGIN: Record<UsageProvider, string> = {
  codex: 'https://chatgpt.com/',
  claude: 'https://claude.ai/',
};

// Turn the raw read into a compact block for the prep prompt. Cap hard so we never ship a wall of PII; titles + memory facts are the whole signal.
export function summarizeUsage(u: ProviderUsage | null): string {
  if (!u || !u.ok) return '';
  const parts: string[] = [];
  if (u.memories.length > 0) parts.push('Facts their AI remembers about them: ' + u.memories.join('; '));
  if (u.titles.length > 0) parts.push('Recent things they asked their AI: ' + u.titles.join('; '));
  return parts.join('\n').slice(0, 1500);
}
