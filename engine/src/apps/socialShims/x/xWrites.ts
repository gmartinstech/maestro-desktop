// engine/src/apps/socialShims/x/xWrites.ts -- SUB-9, a full port of
// backend/apps/x_mcp_shim/x_writes.py.
//
// Navigate the real card and click/type via the browser-action bridge, so X's own browser
// generates the request signature we can't forge from HTTP. Targets are tweet URLs from the read
// tools. tweet/reply/quote/like/retweet/follow are wired; DM stays a card-only action.

import { BrowserActionError, lastJson, perform, type BrowserActionStep } from '../common/browserAction';
import { clickActionJs, followJs, openReplyJs, postTextJs, retweetJs } from './xDom';
import { tweetIdOf } from './xReads';

const DOMAIN = 'x.com';
type Json = Record<string, unknown>;

function urlFor(target: string): string {
  return String(target).startsWith('http') ? target : `https://x.com/i/status/${tweetIdOf(target)}`;
}

export async function tweet(text: string, replyTo: string, quoteId: string): Promise<Json> {
  if (replyTo) {
    const steps: BrowserActionStep[] = [
      { op: 'navigate', url: urlFor(replyTo) },
      { op: 'wait', ms: 2800 },
      { op: 'evaluate', expression: openReplyJs() },
      { op: 'evaluate', expression: postTextJs(text, 'tweetButton') },
    ];
    return { replied_to: replyTo, result: lastJson(await perform(DOMAIN, steps)) };
  }
  const body = quoteId ? `${text} ${urlFor(quoteId)}`.trim() : text;
  const steps: BrowserActionStep[] = [
    { op: 'navigate', url: 'https://x.com/compose/post' },
    { op: 'wait', ms: 2500 },
    { op: 'evaluate', expression: postTextJs(body, 'tweetButton') },
  ];
  return { posted: true, quote: Boolean(quoteId), result: lastJson(await perform(DOMAIN, steps)) };
}

export async function like(target: string, unlike: boolean): Promise<Json> {
  const js = clickActionJs(unlike ? ['unlike'] : ['like'], unlike ? 'like' : 'unlike', unlike ? 'unlike' : 'like');
  const steps: BrowserActionStep[] = [{ op: 'navigate', url: urlFor(target) }, { op: 'wait', ms: 2600 }, { op: 'evaluate', expression: js }];
  return { target, liked: !unlike, result: lastJson(await perform(DOMAIN, steps)) };
}

export async function retweet(target: string, undo: boolean): Promise<Json> {
  const steps: BrowserActionStep[] = [{ op: 'navigate', url: urlFor(target) }, { op: 'wait', ms: 2600 }, { op: 'evaluate', expression: retweetJs(undo) }];
  return { target, retweeted: !undo, result: lastJson(await perform(DOMAIN, steps)) };
}

export async function follow(username: string, unfollow: boolean): Promise<Json> {
  const h = username.replace(/^@+/, '');
  const steps: BrowserActionStep[] = [{ op: 'navigate', url: `https://x.com/${h}` }, { op: 'wait', ms: 2600 }, { op: 'evaluate', expression: followJs(unfollow) }];
  return { username: h, following: !unfollow, result: lastJson(await perform(DOMAIN, steps)) };
}

export function deleteTweet(target: string): never {
  throw new BrowserActionError(
    `Deleting a tweet needs the caret menu + a confirm dialog that's risky to click blind. Open ${urlFor(target)} in your X card and delete it there.`,
  );
}

export function sendDm(recipient: string): never {
  throw new BrowserActionError(`DMs aren't wired for browser-driving yet. Open https://x.com/messages in your X card to DM ${JSON.stringify(recipient)}.`);
}

export async function bookmark(target: string, remove: boolean): Promise<Json> {
  const js = clickActionJs(remove ? ['removeBookmark'] : ['bookmark'], 'bookmark', 'bookmark');
  const steps: BrowserActionStep[] = [{ op: 'navigate', url: urlFor(target) }, { op: 'wait', ms: 2600 }, { op: 'evaluate', expression: js }];
  return { target, bookmarked: !remove, result: lastJson(await perform(DOMAIN, steps)) };
}
