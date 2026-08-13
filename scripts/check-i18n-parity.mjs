// Locale guard: en.json and pt-BR.json must stay in lockstep, and a pt-BR value must actually be
// translated. Runs in the verify gate because the frontend has no unit-test runner wired there —
// a plain *.test.ts parity assertion would never execute. See docs/HANDOFF.md.
import { readFileSync } from 'node:fs';
import path from 'node:path';

const dir = path.join(process.cwd(), 'frontend', 'src', 'shared', 'i18n');
const read = (f) => JSON.parse(readFileSync(path.join(dir, f), 'utf8'));

function flatten(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out);
    else out[key] = v;
  }
  return out;
}

// Values that are identical in both locales BY DESIGN: the product name, and loanwords Brazilian
// devs keep in English. Translating these would read as worse Portuguese, not better. Adding to this
// list is a deliberate call — an untranslated string must be justified here or it fails the gate.
const IDENTICAL_BY_DESIGN = new Set([
  'appShell.appTitle',
  'settings.interface.sectionTitle',
  'settings.header.tabs.skills',
  'settings.general.advanced.build',
  'settings.usage.viaApi',
  'agentChat.errors.tooManyAppsHaiku.windowClause',
  'agentChat.contextDrawer.tokensUsage',
  'dashboard.toolbar.workflows',
  'dashboard.viewCard.terminal',
  'tools.customToolDevInfo.status',
  'tools.section.categories.skills',
  'tools.registryServer.endpoint',
  'commands.page.typeSkill',
  'workflows.steps.prompt',
  'workflows.leftRail.sectionWorkflows',
  'appShell.menuTooltip',
  'appShell.apps',
  'tools.customTool.docs',
  'common.runInDesktop.nounApps',
  // Each shows its OWN language's endonym regardless of the active UI language, by design.
  'settings.interface.languageEn',
  'settings.interface.languagePtBr',
  'agentChat.approvalBar.workflowsServerLabel',
  // Tool identifiers, not display copy — the agent's tool-call name, shown verbatim.
  'agentChat.createAgent.title',
  'agentChat.invokeAgent.title',
  // Unit abbreviations ("ms", "s") carry over unchanged in pt-BR product copy.
  'agentChat.elapsed.milliseconds',
  'agentChat.elapsed.minutesSeconds',
  'agentChat.elapsed.seconds',
  'agentChat.messageBubble.thinking.liveWithTokens',
  'agentChat.messageBubble.tokens.countLabel',
  // "Total" is spelled identically in Portuguese.
  'agentChat.messageBubble.tokens.total',
  'agentChat.tokenBreakdown.total',
  'agentChat.toolSummary.emails_one',
  'agentChat.toolSummary.emails_other',
  // A Unix stream name, not a word.
  'agentChat.toolSummary.stderr',
  // "Dashboard" is the product's own established loanword throughout this namespace.
  'dashboard.defaultName',
  'dashboardSelection.title',
  // Google is a proper noun.
  'tools.registryBrowser.googleFilter',
  'workflows.homeView.workflowDefaultTitle',
]);

const en = flatten(read('en.json'));
const pt = flatten(read('pt-BR.json'));
const errors = [];

for (const k of Object.keys(en)) if (!(k in pt)) errors.push(`missing in pt-BR.json: ${k}`);
for (const k of Object.keys(pt)) if (!(k in en)) errors.push(`missing in en.json: ${k}`);

// An {{interpolation}} present in one locale and absent in the other renders a literal "{{name}}"
// to the user, so mismatched placeholder sets are a hard failure rather than a style nit.
const placeholders = (s) => new Set(String(s).match(/{{\s*[\w.]+\s*}}/g)?.map((m) => m.replace(/\s/g, '')) ?? []);
for (const k of Object.keys(en)) {
  if (!(k in pt)) continue;
  if (typeof en[k] !== 'string' || typeof pt[k] !== 'string') { errors.push(`not a string: ${k}`); continue; }
  // Blank in BOTH is a deliberate "no body" slot (e.g. a tour step that is title-only). Blank in one
  // locale only means a translator dropped copy that the other locale still shows.
  if (!pt[k].trim() && en[k].trim()) errors.push(`empty pt-BR value: ${k}`);
  if (!en[k].trim() && pt[k].trim()) errors.push(`empty en value: ${k}`);
  const a = placeholders(en[k]);
  const b = placeholders(pt[k]);
  const diff = [...a].filter((x) => !b.has(x)).concat([...b].filter((x) => !a.has(x)));
  if (diff.length) errors.push(`placeholder mismatch on ${k}: ${diff.join(', ')}`);
  if (en[k] === pt[k] && en[k].trim().length > 3 && !IDENTICAL_BY_DESIGN.has(k)) {
    errors.push(`untranslated pt-BR value on ${k}: ${JSON.stringify(en[k])} — translate it, or add the key to IDENTICAL_BY_DESIGN with a reason`);
  }
}

// A stale allowlist entry hides a real regression: if the value stops being identical, the exemption
// no longer describes reality and must go.
for (const k of IDENTICAL_BY_DESIGN) {
  if (!(k in en)) errors.push(`stale IDENTICAL_BY_DESIGN entry (key gone): ${k}`);
  else if (en[k] !== pt[k]) errors.push(`stale IDENTICAL_BY_DESIGN entry (now translated): ${k}`);
}

if (errors.length) {
  console.error(`i18n parity FAILED (${errors.length}):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(`i18n parity OK — ${Object.keys(en).length} keys in both locales`);
