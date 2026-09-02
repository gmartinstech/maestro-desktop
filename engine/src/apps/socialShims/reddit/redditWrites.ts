// engine/src/apps/socialShims/reddit/redditWrites.ts -- SUB-9, a full port of
// backend/apps/reddit_mcp_shim/reddit_writes.py: write operations (post/comment/edit/delete/vote/
// save/subscribe/DM), all via the user's own session.

import { api, RedditError } from './redditHttp';

type Json = Record<string, unknown>;

function check(resp: unknown): Json {
  const r = (resp ?? {}) as Json;
  const j = (r.json ?? r) as Json;
  const errors = Array.isArray(j?.errors) ? (j.errors as unknown[][]) : null;
  if (errors && errors.length > 0) {
    throw new RedditError(errors.map((e) => e.map(String).join(' ')).join('; '));
  }
  return (j?.data ?? {}) as Json;
}

function dir(direction: string): number {
  const map: Record<string, number> = { up: 1, upvote: 1, down: -1, downvote: -1, clear: 0, none: 0, unvote: 0 };
  return map[(direction || '').toLowerCase()] ?? 0;
}

export async function submit(
  subreddit: string,
  title: string,
  kind: string,
  text: string,
  url: string,
  nsfw: boolean,
  spoiler: boolean,
  sendReplies: boolean,
): Promise<Json> {
  const form: Record<string, unknown> = {
    sr: subreddit,
    title,
    kind: kind !== 'link' ? 'self' : 'link',
    nsfw: nsfw ? 'true' : 'false',
    spoiler: spoiler ? 'true' : 'false',
    sendreplies: sendReplies ? 'true' : 'false',
    resubmit: 'true',
    api_type: 'json',
  };
  form[kind === 'link' ? 'url' : 'text'] = kind === 'link' ? url : text;
  const data = check(await api('POST', '/api/submit', { form, action: 'submit' }));
  return { id: data.name ?? data.id, url: data.url };
}

export async function comment(parentId: string, text: string): Promise<Json> {
  const data = check(await api('POST', '/api/comment', { form: { thing_id: parentId, text, api_type: 'json' }, action: 'comment' }));
  const things = Array.isArray(data.things) ? (data.things as Json[]) : [];
  const created = (things[0]?.data ?? {}) as Json;
  return { id: created.name, permalink: created.permalink };
}

export async function edit(thingId: string, text: string): Promise<Json> {
  const data = check(await api('POST', '/api/editusertext', { form: { thing_id: thingId, text, api_type: 'json' }, action: 'comment' }));
  const things = Array.isArray(data.things) ? (data.things as Json[]) : [];
  const updated = (things[0]?.data ?? {}) as Json;
  return { id: updated.name ?? thingId, edited: true };
}

export async function del(thingId: string): Promise<Json> {
  await api('POST', '/api/del', { form: { id: thingId }, action: 'save' });
  return { id: thingId, deleted: true };
}

export async function vote(thingId: string, direction: string): Promise<Json> {
  const d = dir(direction);
  await api('POST', '/api/vote', { form: { id: thingId, dir: d }, action: 'vote' });
  return { id: thingId, dir: d };
}

export async function save(thingId: string, unsave: boolean): Promise<Json> {
  await api('POST', unsave ? '/api/unsave' : '/api/save', { form: { id: thingId }, action: 'save' });
  return { id: thingId, saved: !unsave };
}

export async function subscribe(subreddit: string, unsubscribe: boolean): Promise<Json> {
  await api('POST', '/api/subscribe', { form: { sr_name: subreddit, action: unsubscribe ? 'unsub' : 'sub' }, action: 'subscribe' });
  return { subreddit, subscribed: !unsubscribe };
}

export async function compose(to: string, subject: string, text: string): Promise<Json> {
  check(await api('POST', '/api/compose', { form: { to, subject, text, api_type: 'json' }, action: 'compose' }));
  return { to, sent: true };
}
