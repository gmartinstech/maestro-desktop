// engine/src/apps/socialShims/tiktok/tiktokReads.ts -- SUB-9, a full port of
// backend/apps/tiktok_mcp_shim/tiktok_reads.py.
//
// Returns compact video/user/comment records (truncated captions). A defensive walker pulls video
// items out of whatever envelope the endpoint uses (itemList, data[].item), which survives
// TikTok's frequent response reshuffles. Reads are best-effort: TikTok's signature gate may still
// reject them, in which case tiktokHttp raises an actionable hint.

import { get, TikTokError } from './tiktokHttp';

const CAP = 800;
type Json = Record<string, unknown>;

function trunc(s: string | null | undefined): string {
  const v = s ?? '';
  return v.length <= CAP ? v : `${v.slice(0, CAP)}... [+${v.length - CAP} chars]`;
}

function item(d: Json): Json {
  let author = (d.author ?? {}) as Json | string;
  if (typeof author !== 'object' || author === null) author = { uniqueId: author };
  const stats = (d.stats ?? d.statsV2 ?? {}) as Json;
  const vid = d.id ?? d.aweme_id;
  const handle = (author as Json).uniqueId;
  return {
    id: vid,
    desc: trunc(d.desc as string | undefined),
    author: handle,
    author_name: (author as Json).nickname,
    likes: stats.diggCount,
    comments: stats.commentCount,
    plays: stats.playCount,
    shares: stats.shareCount,
    created: d.createTime,
    url: handle && vid ? `https://www.tiktok.com/@${String(handle)}/video/${String(vid)}` : null,
  };
}

function isItem(d: unknown): d is Json {
  return typeof d === 'object' && d !== null && 'desc' in d && 'author' in d && ('id' in d || 'aweme_id' in d);
}

function collectItems(node: unknown, out: Json[], cap: number): void {
  if (out.length >= cap) return;
  if (isItem(node)) {
    const t = item(node);
    if (t.id && !out.some((x) => x.id === t.id)) out.push(t);
    return;
  }
  if (Array.isArray(node)) {
    for (const v of node) collectItems(v, out, cap);
  } else if (node && typeof node === 'object') {
    for (const v of Object.values(node as Json)) collectItems(v, out, cap);
  }
}

function itemsOut(resp: unknown, cap: number): { videos: Json[]; cursor: unknown; has_more: boolean | null } {
  const out: Json[] = [];
  collectItems(resp, out, cap);
  const r = resp && typeof resp === 'object' ? (resp as Json) : null;
  return { videos: out, cursor: r?.cursor, has_more: r ? Boolean(r.hasMore) : null };
}

export async function getUser(username: string): Promise<Json> {
  const resp = (await get('user/detail/', { uniqueId: username.replace(/^@+/, '') })) as Json;
  const info = (resp?.userInfo ?? {}) as Json;
  const user = (info.user ?? {}) as Json;
  const stats = (info.stats ?? {}) as Json;
  return {
    id: user.id,
    sec_uid: user.secUid,
    username: user.uniqueId,
    nickname: user.nickname,
    bio: trunc(user.signature as string | undefined),
    followers: stats.followerCount,
    following: stats.followingCount,
    likes: stats.heartCount,
    videos: stats.videoCount,
    verified: user.verified,
  };
}

export async function feed(count: number): Promise<{ videos: Json[]; cursor: unknown; has_more: boolean | null }> {
  return itemsOut(await get('recommend/item_list/', { count, from_page: 'fyp' }), count);
}

export async function userVideos(username: string, count: number, cursor: string): Promise<{ videos: Json[]; cursor: unknown; has_more: boolean | null }> {
  const secUid = (await getUser(username)).sec_uid;
  if (!secUid) throw new TikTokError(`Could not resolve @${username.replace(/^@+/, '')} to a secUid.`);
  return itemsOut(await get('post/item_list/', { secUid, count, cursor: cursor || '0' }), count);
}

export async function getVideo(videoId: string): Promise<Json> {
  const resp = (await get('item/detail/', { itemId: videoId })) as Json;
  const it = ((resp?.itemInfo as Json)?.itemStruct ?? {}) as Json;
  return Object.keys(it).length > 0 ? item(it) : { id: videoId, note: 'not found or signature-gated' };
}

export async function comments(videoId: string, count: number, cursor: string): Promise<{ comments: Json[]; cursor: unknown }> {
  const resp = (await get('comment/list/', { aweme_id: videoId, count, cursor: cursor || '0' })) as Json;
  const list = Array.isArray(resp?.comments) ? (resp.comments as Json[]) : [];
  const out = list.map((c) => {
    const u = (c.user ?? {}) as Json;
    return {
      id: c.cid,
      text: trunc(c.text as string | undefined),
      author: u.unique_id ?? u.uniqueId,
      likes: c.digg_count,
      created: c.create_time,
    };
  });
  return { comments: out, cursor: resp && typeof resp === 'object' ? resp.cursor : undefined };
}

export async function search(keyword: string, count: number): Promise<{ videos: Json[]; cursor: unknown; has_more: boolean | null }> {
  const resp = await get('search/general/full/', { keyword, offset: 0, count, from_page: 'search' });
  return itemsOut(resp, count);
}
