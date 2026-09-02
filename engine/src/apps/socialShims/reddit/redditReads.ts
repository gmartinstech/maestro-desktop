// engine/src/apps/socialShims/reddit/redditReads.ts -- SUB-9, a full port of
// backend/apps/reddit_mcp_shim/reddit_reads.py: read operations over the authed www.reddit.com
// surface. Returns compact, token-frugal records (truncated bodies) rather than Reddit's raw
// firehose, so the agent sees what a human skims, not megabytes of JSON.

import { api } from './redditHttp';

const BODY_CAP = 2000;

function trunc(s: string | null | undefined): string {
  const v = s ?? '';
  return v.length <= BODY_CAP ? v : `${v.slice(0, BODY_CAP)}... [+${v.length - BODY_CAP} chars]`;
}

type Json = Record<string, unknown>;

function post(d: Json): Json {
  return {
    id: d.name,
    subreddit: d.subreddit,
    author: d.author,
    title: d.title,
    score: d.score,
    upvote_ratio: d.upvote_ratio,
    num_comments: d.num_comments,
    permalink: d.permalink,
    url: d.url,
    is_self: d.is_self,
    selftext: trunc(d.selftext as string | undefined),
    over_18: d.over_18,
    flair: d.link_flair_text,
    created_utc: d.created_utc,
  };
}

function comment(d: Json): Json {
  return {
    id: d.name,
    author: d.author,
    body: trunc(d.body as string | undefined),
    score: d.score,
    permalink: d.permalink,
    created_utc: d.created_utc,
  };
}

function listing(resp: unknown): { items: Json[]; after: unknown } {
  const data = ((resp as Json)?.data ?? {}) as Json;
  const children = Array.isArray(data.children) ? (data.children as Json[]) : [];
  const items = children.map((ch) => {
    const kind = ch.kind;
    const cd = (ch.data ?? {}) as Json;
    return kind === 't1' ? comment(cd) : post(cd);
  });
  return { items, after: data.after };
}

export async function whoami(): Promise<Json> {
  const resp = (await api('GET', '/api/me.json')) as Json;
  const me = (resp.data ?? {}) as Json;
  return {
    name: me.name,
    id: me.id,
    total_karma: me.total_karma,
    link_karma: me.link_karma,
    comment_karma: me.comment_karma,
    has_mail: me.has_mail,
    created_utc: me.created_utc,
  };
}

const SORTS = new Set(['hot', 'new', 'top', 'rising', 'best', 'controversial']);

export async function browse(subreddit: string, sortIn: string, t: string, limit: number, after: string): Promise<{ items: Json[]; after: unknown }> {
  const sort = SORTS.has(sortIn) ? sortIn : 'hot';
  const path = subreddit ? `/r/${subreddit}/${sort}` : `/${sort}`;
  const resp = await api('GET', path, { params: { limit, t: t || undefined, after: after || undefined } });
  return listing(resp);
}

export async function search(query: string, subreddit: string, sort: string, t: string, limit: number): Promise<{ items: Json[]; after: unknown }> {
  const params: Record<string, unknown> = { q: query, limit, sort: sort || 'relevance', t: t || 'all' };
  let path: string;
  if (subreddit) {
    params.restrict_sr = 1;
    path = `/r/${subreddit}/search`;
  } else {
    path = '/search';
  }
  return listing(await api('GET', path, { params }));
}

export async function getPost(target: string, commentLimit: number): Promise<{ post: Json; comments: Json[] }> {
  let article = target.split('t3_').pop() ?? target;
  const m = /comments\/([a-z0-9]+)/.exec(target);
  if (m) article = m[1];
  const resp = await api('GET', `/comments/${article}`, { params: { limit: commentLimit, depth: 6 } });
  let postOut: Json = {};
  let commentsOut: Json[] = [];
  if (Array.isArray(resp) && resp.length === 2) {
    const firstData = ((resp[0] as Json)?.data ?? {}) as Json;
    const kids = Array.isArray(firstData.children) ? (firstData.children as Json[]) : [];
    if (kids.length > 0) postOut = post((kids[0].data ?? {}) as Json);
    commentsOut = listing(resp[1]).items;
  }
  return { post: postOut, comments: commentsOut };
}

export async function getUser(username: string, kind: string, limit: number): Promise<Json> {
  const aboutResp = (await api('GET', `/user/${username}/about`)) as Json;
  const about = (aboutResp.data ?? {}) as Json;
  const where = ['submitted', 'comments', 'overview'].includes(kind) ? kind : 'overview';
  const feed = listing(await api('GET', `/user/${username}/${where}`, { params: { limit } }));
  return {
    name: about.name,
    link_karma: about.link_karma,
    comment_karma: about.comment_karma,
    created_utc: about.created_utc,
    is_mod: about.is_mod,
    items: feed.items,
  };
}

const INBOX_WHERE = new Set(['inbox', 'unread', 'sent', 'messages', 'mentions']);

export async function inbox(whereIn: string, limit: number): Promise<{ messages: Json[]; after: unknown }> {
  const where = INBOX_WHERE.has(whereIn) ? whereIn : 'inbox';
  const resp = (await api('GET', `/message/${where}`, { params: { limit } })) as Json;
  const data = (resp?.data ?? {}) as Json;
  const children = Array.isArray(data.children) ? (data.children as Json[]) : [];
  const messages = children.map((ch) => {
    const cd = (ch.data ?? {}) as Json;
    return {
      id: cd.name,
      author: cd.author,
      subject: cd.subject,
      body: trunc(cd.body as string | undefined),
      new: cd.new,
      context: cd.context,
      created_utc: cd.created_utc,
    };
  });
  return { messages, after: data.after };
}

export async function mySubreddits(limit: number): Promise<{ subreddits: Json[] }> {
  const resp = (await api('GET', '/subreddits/mine/subscriber', { params: { limit } })) as Json;
  const children = Array.isArray((resp?.data as Json)?.children) ? (((resp.data as Json).children) as Json[]) : [];
  const subs = children.map((ch) => {
    const d = (ch.data ?? {}) as Json;
    return { name: d.display_name, subscribers: d.subscribers };
  });
  return { subreddits: subs };
}

export async function saved(username: string, limit: number): Promise<{ items: Json[]; after: unknown }> {
  const user = username || ((await whoami()).name as string | undefined) || '';
  return listing(await api('GET', `/user/${user}/saved`, { params: { limit } }));
}
