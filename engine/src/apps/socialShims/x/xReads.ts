// engine/src/apps/socialShims/x/xReads.ts -- SUB-9, a full port of
// backend/apps/x_mcp_shim/x_reads.py.
//
// X blocks pure-HTTP reads (it signs every request with browser-JS we can't forge), so we navigate
// the real card to the right URL, let it render, and scrape the DOM via the browser-action bridge.
// Free, undetectable, and immune to query-id/signature drift.

import { lastJson, perform, type BrowserActionStep } from '../common/browserAction';
import { profileJs, scrapeTweetsJs, whoamiJs } from './xDom';

export const DOMAIN = 'x.com';
const SEARCH_F: Readonly<Record<string, string>> = { latest: 'live', people: 'user', media: 'media' };

type Json = Record<string, unknown>;
type Tweet = Json;

export function tweetIdOf(target: string): string {
  const m = /(\d{5,})/.exec(target || '');
  return m ? m[1] : target || '';
}

async function tweets(url: string, cap: number, waitMs = 3000): Promise<Tweet[]> {
  const steps: BrowserActionStep[] = [
    { op: 'navigate', url },
    { op: 'wait', ms: waitMs },
    { op: 'evaluate', expression: scrapeTweetsJs(cap) },
  ];
  const out = lastJson(await perform(DOMAIN, steps));
  return Array.isArray(out) ? (out as Tweet[]) : [];
}

export async function whoami(): Promise<Json> {
  const steps: BrowserActionStep[] = [
    { op: 'navigate', url: 'https://x.com/home' },
    { op: 'wait', ms: 2200 },
    { op: 'evaluate', expression: whoamiJs() },
  ];
  return lastJson(await perform(DOMAIN, steps));
}

export async function search(query: string, product: string, count: number): Promise<{ query: string; tweets: Tweet[]; count: number }> {
  const q = encodeURIComponent(query);
  const f = SEARCH_F[(product || 'top').toLowerCase()];
  const url = `https://x.com/search?q=${q}&src=typed_query${f ? `&f=${f}` : ''}`;
  const result = await tweets(url, count);
  return { query, tweets: result, count: result.length };
}

export async function timeline(kind: string, count: number): Promise<{ kind: string; tweets: Tweet[]; count: number }> {
  const result = await tweets('https://x.com/home', count);
  return { kind, tweets: result, count: result.length };
}

export async function userTweets(username: string, count: number): Promise<{ username: string; tweets: Tweet[]; count: number }> {
  const h = username.replace(/^@+/, '');
  const result = await tweets(`https://x.com/${h}`, count);
  return { username: h, tweets: result, count: result.length };
}

export async function getTweet(target: string, repliesLimit: number): Promise<{ tweet: Tweet; replies: Tweet[] }> {
  const url = String(target).startsWith('http') ? target : `https://x.com/i/status/${tweetIdOf(target)}`;
  const result = await tweets(url, repliesLimit + 1);
  return { tweet: result[0] ?? {}, replies: result.slice(1, repliesLimit + 1) };
}

export async function getUser(username: string): Promise<Json> {
  const h = username.replace(/^@+/, '');
  const steps: BrowserActionStep[] = [
    { op: 'navigate', url: `https://x.com/${h}` },
    { op: 'wait', ms: 2800 },
    { op: 'evaluate', expression: profileJs() },
  ];
  return lastJson(await perform(DOMAIN, steps));
}

export async function bookmarks(count: number): Promise<{ tweets: Tweet[]; count: number }> {
  const result = await tweets('https://x.com/i/bookmarks', count);
  return { tweets: result, count: result.length };
}

export async function notifications(count: number): Promise<{ notifications: Tweet[]; count: number }> {
  const result = await tweets('https://x.com/notifications', count);
  return { notifications: result, count: result.length };
}
