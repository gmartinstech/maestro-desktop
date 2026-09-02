// engine/src/apps/toolsLib/toolTaxonomy.ts -- SUB-4, a full port of
// backend/apps/tools_lib/tool_taxonomy.py: buckets a discovered MCP server's tool names into
// services/service-groups and read/write categories for the discover_tools route + the
// forced-tools/mcp-registry prompt blocks.

const READ_PREFIXES = ['get', 'list', 'read', 'search', 'fetch', 'find', 'query', 'count', 'check', 'describe', 'show', 'download', 'browse', 'analy', 'explain'] as const;
const WRITE_PREFIXES = ['create', 'write', 'delete', 'update', 'send', 'remove', 'modify', 'add', 'set', 'put', 'post', 'patch', 'insert', 'move', 'copy', 'rename', 'archive', 'trash', 'publish', 'approve', 'reject'] as const;

type ServiceRule = readonly [keywords: readonly string[], serviceName: string, group: string];

// (keywords, service_name, group)
const SERVICE_RULES: readonly ServiceRule[] = [
  // Google Workspace
  [['gmail'], 'Gmail', 'Google'],
  [['drive'], 'Drive', 'Google'],
  [['calendar', 'event', 'freebusy'], 'Calendar', 'Google'],
  [['spreadsheet', 'sheet'], 'Sheets', 'Google'],
  [['doc', 'paragraph', 'table'], 'Docs', 'Google'],
  [['chat', 'space', 'reaction', 'message'], 'Chat', 'Google'],
  [['form', 'publish_settings'], 'Forms', 'Google'],
  [['presentation', 'slide', 'page'], 'Slides', 'Google'],
  [['task_list', 'task'], 'Tasks', 'Google'],
  [['contact'], 'Contacts', 'Google'],
  [['script', 'deployment', 'version', 'trigger'], 'Apps Script', 'Google'],
  [['search_custom', 'search_engine'], 'Search', 'Google'],
  // YouTube
  [['transcript', 'caption'], 'Transcripts', 'YouTube'],
  [['video_detail', 'video_comment', 'video_categor', 'video_engagement'], 'Videos', 'YouTube'],
  [['search_video', 'trending_video'], 'Search', 'YouTube'],
  [['channel_stat', 'channel_top'], 'Channels', 'YouTube'],
  // Reddit (before Twitter so "search_reddit" etc. don't mis-match)
  [['subreddit'], 'Subreddits', 'Reddit'],
  [['search_reddit'], 'Search', 'Reddit'],
  [['post_detail'], 'Posts', 'Reddit'],
  [['user_analysis'], 'Users', 'Reddit'],
  [['reddit_explain'], 'Reference', 'Reddit'],
];

function categorizeTool(name: string): 'read' | 'write' {
  const lower = name.toLowerCase().replace(/_/g, ' ').replace(/-/g, ' ').trim();
  for (const word of lower.split(/\s+/).filter(Boolean)) {
    for (const prefix of READ_PREFIXES) {
      if (word.startsWith(prefix)) return 'read';
    }
    for (const prefix of WRITE_PREFIXES) {
      if (word.startsWith(prefix)) return 'write';
    }
  }
  return 'write';
}

/** Which curated SERVICE_RULES set applies to this integration, if any. The Google rules use
 * generic words (message/table/page/doc/script) that otherwise mis-tag Slack/Notion/Airtable/M365. */
function integrationDomain(integration: string): string {
  const n = (integration || '').toLowerCase();
  if (n.includes('google')) return 'Google';
  if (n.includes('youtube')) return 'YouTube';
  if (n.includes('reddit')) return 'Reddit';
  return '';
}

/** Map a tool name to [service, group]. Curated rulesets apply only to the integration they were
 * written for; every other integration groups under its own name so it isn't mislabeled as Google. */
function extractService(name: string, integration: string): readonly [string, string] {
  const domain = integrationDomain(integration);
  if (domain) {
    const lower = name.toLowerCase();
    for (const [keywords, display, group] of SERVICE_RULES) {
      if (group !== domain) continue;
      for (const kw of keywords) {
        if (lower.includes(kw)) return [display, group];
      }
    }
    return ['Other', ''];
  }
  // No curated rules: one service per integration, grouped under itself.
  return [integration || 'Other', ''];
}

export interface ClassifyServicesResult {
  services: Record<string, { read: string[]; write: string[] }>;
  serviceGroups: Record<string, string[]>;
  allRead: string[];
  allWrite: string[];
}

/** Bucket tool names into services + service groups + read/write categories for one integration. */
export function classifyServices(toolNames: readonly string[], integration: string): ClassifyServicesResult {
  const services: Record<string, { read: string[]; write: string[] }> = {};
  const serviceGroups: Record<string, string[]> = {};
  for (const name of toolNames) {
    const cat = categorizeTool(name);
    const [svc, group] = extractService(name, integration);
    if (!services[svc]) services[svc] = { read: [], write: [] };
    services[svc][cat].push(name);
    if (group) {
      if (!serviceGroups[group]) serviceGroups[group] = [];
      if (!serviceGroups[group].includes(svc)) serviceGroups[group].push(svc);
    }
  }
  const allRead = Object.values(services).flatMap((s) => s.read);
  const allWrite = Object.values(services).flatMap((s) => s.write);
  return { services, serviceGroups, allRead, allWrite };
}
