// engine/src/apps/socialShims/tiktok/handlers.ts -- SUB-9, a full port of
// backend/apps/tiktok_mcp_shim/handlers.py.

import { BrowserActionError } from '../common/browserAction';
import { mcpErr, mcpOk, type McpToolResult } from '../common/mcpStdioServer';
import { SessionUnavailable } from '../common/sessionSource';
import * as reads from './tiktokReads';
import { TikTokError } from './tiktokHttp';
import * as writes from './tiktokWrites';

function lim(v: unknown, fallback: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(Math.trunc(n), 50));
}

async function dispatch(name: string, a: Record<string, unknown>): Promise<unknown> {
  if (name === 'tiktok_feed') return reads.feed(lim(a.count, 20));
  if (name === 'tiktok_search') return reads.search(String(a.keyword ?? ''), lim(a.count, 20));
  if (name === 'tiktok_get_user') return reads.getUser(String(a.username ?? ''));
  if (name === 'tiktok_user_videos') return reads.userVideos(String(a.username ?? ''), lim(a.count, 20), String(a.cursor ?? ''));
  if (name === 'tiktok_get_video') return reads.getVideo(String(a.video_id ?? ''));
  if (name === 'tiktok_comments') return reads.comments(String(a.video_id ?? ''), lim(a.count, 20), String(a.cursor ?? ''));
  if (name === 'tiktok_like') return writes.like(String(a.video_url ?? ''), Boolean(a.unlike));
  if (name === 'tiktok_favorite') return writes.favorite(String(a.video_url ?? ''), Boolean(a.remove));
  if (name === 'tiktok_comment') return writes.comment(String(a.video_url ?? ''), String(a.text ?? ''));
  if (name === 'tiktok_follow') return writes.follow(String(a.username ?? ''), Boolean(a.unfollow));
  if (name === 'tiktok_upload') return writes.upload(String(a.caption ?? ''), String(a.video_path ?? ''));
  throw new TikTokError(`Unknown tool: ${name}`);
}

export async function handleToolCall(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
  try {
    return mcpOk(await dispatch(name, args));
  } catch (e) {
    if (e instanceof SessionUnavailable || e instanceof TikTokError || e instanceof BrowserActionError) return mcpErr(e.message);
    return mcpErr(`tiktok shim error: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
  }
}
