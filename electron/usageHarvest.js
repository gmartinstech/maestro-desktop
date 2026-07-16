// Silently read the user's OWN provider chat history (chatgpt.com / claude.ai) from
// the browser partition's logged-in session, with no visible card. Onboarding prep
// uses the result to profile what the user actually cares about. The injected script
// is defined HERE (main-owned), so the offscreen exec can never be pointed at a script
// the renderer or a remote page chose. Only reachable when a session already exists in
// the partition; otherwise it fails open to {ok:false} and prep falls back to the scan.
//
// The RAW read never touches disk or redux: it is returned once to the renderer, which
// derives a capped summary for prep and drops the rest. See summarizeUsage (frontend).

const hiddenBrowser = require('./hiddenBrowser');

const ORIGIN = {
  codex: 'https://chatgpt.com/',
  claude: 'https://claude.ai/',
};

// Runs in the page context. Sweeps the full conversation history (all titles,
// paginated + deduped) plus ChatGPT Memory. Hard caps bound the work + PII footprint
// even for a user with thousands of chats; every fetch fails open to empty.
const SCRIPT = {
  codex: `(async () => {
    const PAGE=100, CAP_PAGES=60, CAP_TITLES=1000, GAP_MS=90;
    try {
      const sess = await fetch('/api/auth/session', {credentials:'include'}).then(r=>r.json());
      if (!sess || !sess.accessToken) return {ok:false, total:0, titles:[], memories:[]};
      const H = {headers:{Authorization:'Bearer '+sess.accessToken, accept:'application/json'}, credentials:'include'};
      const seen = new Set(); const titles = [];
      let offset = 0, page = 0;
      while (page < CAP_PAGES && titles.length < CAP_TITLES) {
        const j = await fetch('/backend-api/conversations?offset='+offset+'&limit='+PAGE+'&order=updated', H).then(r=>r.ok?r.json():null).catch(()=>null);
        const items = (j && j.items) || [];
        if (!items.length) break;
        let fresh = 0;
        for (const c of items) { if (c && c.id && !seen.has(c.id)) { seen.add(c.id); if (c.title) titles.push(c.title); fresh++; } }
        if (fresh === 0) break;
        if (items.length < PAGE) break;
        offset += PAGE; page++;
        await new Promise(r=>setTimeout(r, GAP_MS));
      }
      const mem = await fetch('/backend-api/memories?include_memory_entries=true', H).then(r=>r.ok?r.json():null).catch(()=>null);
      return {
        ok: true,
        total: seen.size,
        titles: titles.slice(0, CAP_TITLES),
        memories: ((mem && mem.memories) || []).map(m=>m.content).filter(Boolean).slice(0, 40),
      };
    } catch (e) { return {ok:false, total:0, titles:[], memories:[]}; }
  })()`,
  claude: `(async () => {
    const PAGE=100, CAP_PAGES=60, CAP_TITLES=1000, GAP_MS=90;
    try {
      const orgs = await fetch('/api/organizations', {credentials:'include', headers:{accept:'application/json'}}).then(r=>r.ok?r.json():null).catch(()=>null);
      if (!Array.isArray(orgs) || !orgs.length) return {ok:false, total:0, titles:[], memories:[]};
      const org = orgs[0].uuid;
      const seen = new Set(); const titles = [];
      let offset = 0, page = 0;
      while (page < CAP_PAGES && titles.length < CAP_TITLES) {
        const convs = await fetch('/api/organizations/'+org+'/chat_conversations?limit='+PAGE+'&offset='+offset, {credentials:'include', headers:{accept:'application/json'}}).then(r=>r.ok?r.json():null).catch(()=>null);
        const items = Array.isArray(convs) ? convs : [];
        if (!items.length) break;
        let fresh = 0;
        for (const c of items) { const id = c && c.uuid; if (id && !seen.has(id)) { seen.add(id); if (c.name) titles.push(c.name); fresh++; } }
        if (fresh === 0) break;
        if (items.length < PAGE) break;
        offset += PAGE; page++;
        await new Promise(r=>setTimeout(r, GAP_MS));
      }
      return {ok:true, total:seen.size, titles:titles.slice(0, CAP_TITLES), memories:[]};
    } catch (e) { return {ok:false, total:0, titles:[], memories:[]}; }
  })()`,
};

const EMPTY = { ok: false, total: 0, titles: [], memories: [] };

async function harvest(partition, provider) {
  if (provider !== 'codex' && provider !== 'claude') return EMPTY;
  const res = await hiddenBrowser.hiddenEval(partition, ORIGIN[provider], SCRIPT[provider]).catch(() => null);
  return res && typeof res === 'object' && res.ok ? res : EMPTY;
}

module.exports = { harvest };
