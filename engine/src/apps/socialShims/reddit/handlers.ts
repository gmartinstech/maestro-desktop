// engine/src/apps/socialShims/reddit/handlers.ts -- SUB-9, a full port of
// backend/apps/reddit_mcp_shim/handlers.py: dispatch each MCP tool call to the Reddit client and
// format MCP content.

import { mcpErr, mcpOk, type McpToolResult } from '../common/mcpStdioServer';
import { SessionUnavailable } from '../common/sessionSource';
import { RedditError } from './redditHttp';
import * as reads from './redditReads';
import * as writes from './redditWrites';

function lim(v: unknown, fallback: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(Math.trunc(n), 100));
}

async function dispatch(name: string, a: Record<string, unknown>): Promise<unknown> {
  if (name === 'reddit_whoami') return reads.whoami();
  if (name === 'reddit_browse') {
    return reads.browse(String(a.subreddit ?? ''), String(a.sort ?? 'hot'), String(a.time ?? ''), lim(a.limit, 25), String(a.after ?? ''));
  }
  if (name === 'reddit_search') {
    return reads.search(String(a.query ?? ''), String(a.subreddit ?? ''), String(a.sort ?? 'relevance'), String(a.time ?? 'all'), lim(a.limit, 25));
  }
  if (name === 'reddit_get_post') return reads.getPost(String(a.target ?? ''), lim(a.comment_limit, 50));
  if (name === 'reddit_get_user') return reads.getUser(String(a.username ?? ''), String(a.kind ?? 'overview'), lim(a.limit, 25));
  if (name === 'reddit_inbox') return reads.inbox(String(a.where ?? 'inbox'), lim(a.limit, 25));
  if (name === 'reddit_my_subreddits') return reads.mySubreddits(lim(a.limit, 100));
  if (name === 'reddit_saved') return reads.saved(String(a.username ?? ''), lim(a.limit, 25));
  if (name === 'reddit_submit') {
    return writes.submit(
      String(a.subreddit ?? ''),
      String(a.title ?? ''),
      String(a.kind ?? 'self'),
      String(a.text ?? ''),
      String(a.url ?? ''),
      Boolean(a.nsfw),
      Boolean(a.spoiler),
      a.send_replies === undefined ? true : Boolean(a.send_replies),
    );
  }
  if (name === 'reddit_comment') return writes.comment(String(a.parent_id ?? ''), String(a.text ?? ''));
  if (name === 'reddit_edit') return writes.edit(String(a.thing_id ?? ''), String(a.text ?? ''));
  if (name === 'reddit_delete') return writes.del(String(a.thing_id ?? ''));
  if (name === 'reddit_vote') return writes.vote(String(a.thing_id ?? ''), String(a.direction ?? ''));
  if (name === 'reddit_save') return writes.save(String(a.thing_id ?? ''), Boolean(a.unsave));
  if (name === 'reddit_subscribe') return writes.subscribe(String(a.subreddit ?? ''), Boolean(a.unsubscribe));
  if (name === 'reddit_send_message') return writes.compose(String(a.to ?? ''), String(a.subject ?? ''), String(a.text ?? ''));
  throw new RedditError(`Unknown tool: ${name}`);
}

export async function handleToolCall(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
  try {
    return mcpOk(await dispatch(name, args));
  } catch (e) {
    if (e instanceof SessionUnavailable || e instanceof RedditError) return mcpErr(e.message);
    return mcpErr(`reddit shim error: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
  }
}
