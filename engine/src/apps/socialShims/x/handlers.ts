// engine/src/apps/socialShims/x/handlers.ts -- SUB-9, a full port of
// backend/apps/x_mcp_shim/handlers.py.

import { BrowserActionError } from '../common/browserAction';
import { mcpErr, mcpOk, type McpToolResult } from '../common/mcpStdioServer';
import { SessionUnavailable } from '../common/sessionSource';
import * as reads from './xReads';
import * as writes from './xWrites';

function lim(v: unknown, fallback: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(Math.trunc(n), 100));
}

async function dispatch(name: string, a: Record<string, unknown>): Promise<unknown> {
  if (name === 'x_whoami') return reads.whoami();
  if (name === 'x_timeline') return reads.timeline(String(a.kind ?? 'foryou'), lim(a.count, 20));
  if (name === 'x_user_tweets') return reads.userTweets(String(a.username ?? ''), lim(a.count, 20));
  if (name === 'x_get_tweet') return reads.getTweet(String(a.target ?? ''), lim(a.replies_limit, 30));
  if (name === 'x_search') return reads.search(String(a.query ?? ''), String(a.product ?? 'top'), lim(a.count, 20));
  if (name === 'x_get_user') return reads.getUser(String(a.username ?? ''));
  if (name === 'x_bookmarks') return reads.bookmarks(lim(a.count, 20));
  if (name === 'x_notifications') return reads.notifications(lim(a.count, 20));
  if (name === 'x_tweet') return writes.tweet(String(a.text ?? ''), String(a.reply_to ?? ''), String(a.quote_id ?? ''));
  if (name === 'x_delete_tweet') return writes.deleteTweet(String(a.target ?? ''));
  if (name === 'x_like') return writes.like(String(a.target ?? ''), Boolean(a.unlike));
  if (name === 'x_retweet') return writes.retweet(String(a.target ?? ''), Boolean(a.undo));
  if (name === 'x_bookmark') return writes.bookmark(String(a.target ?? ''), Boolean(a.remove));
  if (name === 'x_follow') return writes.follow(String(a.username ?? ''), Boolean(a.unfollow));
  if (name === 'x_send_dm') return writes.sendDm(String(a.recipient ?? ''));
  throw new BrowserActionError(`Unknown tool: ${name}`);
}

export async function handleToolCall(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
  try {
    return mcpOk(await dispatch(name, args));
  } catch (e) {
    if (e instanceof SessionUnavailable || e instanceof BrowserActionError) return mcpErr(e.message);
    return mcpErr(`x shim error: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
  }
}
