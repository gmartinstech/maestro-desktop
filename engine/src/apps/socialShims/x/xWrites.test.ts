import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import * as http from '../../../net/http';
import { bookmark, deleteTweet, follow, like, retweet, sendDm, tweet } from './xWrites';

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env.MAESTRO_PORT = '18324';
  process.env.MAESTRO_AUTH_TOKEN = 'test-token';
});

afterEach(() => {
  vi.restoreAllMocks();
  process.env = { ...ORIGINAL_ENV };
});

function mockBridge(finalResult: unknown): void {
  vi.spyOn(http, 'engineFetch').mockResolvedValue(new Response(JSON.stringify({ results: [{ text: JSON.stringify(finalResult) }] }), { status: 200 }));
}

function lastNavigateUrl(): string | undefined {
  const [, init] = vi.mocked(http.engineFetch).mock.calls[0];
  const body = JSON.parse((init as RequestInit).body as string) as { steps: Array<{ op: string; url?: string }> };
  return body.steps.find((s) => s.op === 'navigate')?.url;
}

describe('tweet', () => {
  test('a plain tweet navigates to the composer', async () => {
    mockBridge({ ok: true, posted: true });
    const result = await tweet('hello world', '', '');
    expect(result.posted).toBe(true);
    expect(result.quote).toBe(false);
    expect(lastNavigateUrl()).toBe('https://x.com/compose/post');
  });

  test('reply_to navigates to the target tweet and opens the reply composer', async () => {
    mockBridge({ ok: true, posted: true });
    const result = await tweet('nice!', 'https://x.com/bob/status/1', '');
    expect(result.replied_to).toBe('https://x.com/bob/status/1');
    expect(lastNavigateUrl()).toBe('https://x.com/bob/status/1');
  });

  test('quote_id appends the quoted tweet URL to the composer text', async () => {
    const spy = vi.spyOn(http, 'engineFetch').mockResolvedValue(new Response(JSON.stringify({ results: [{ text: JSON.stringify({ ok: true }) }] }), { status: 200 }));
    await tweet('check this out', '', 'https://x.com/bob/status/2');
    const evalStep = (JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string) as { steps: Array<{ op: string; expression?: string }> }).steps.find((s) => s.op === 'evaluate');
    expect(evalStep?.expression).toContain('check this out https://x.com/bob/status/2');
  });
});

describe('like / retweet / follow / bookmark', () => {
  test('like(unlike=false) reports liked:true', async () => {
    mockBridge({ ok: true });
    const result = await like('https://x.com/bob/status/1', false);
    expect(result.liked).toBe(true);
  });

  test('like(unlike=true) reports liked:false', async () => {
    mockBridge({ ok: true });
    const result = await like('https://x.com/bob/status/1', true);
    expect(result.liked).toBe(false);
  });

  test('retweet(undo=true) reports retweeted:false', async () => {
    mockBridge({ ok: true });
    const result = await retweet('https://x.com/bob/status/1', true);
    expect(result.retweeted).toBe(false);
  });

  test('follow strips a leading @ and reports following:true', async () => {
    mockBridge({ ok: true });
    const result = await follow('@bob', false);
    expect(result).toMatchObject({ username: 'bob', following: true });
  });

  test('bookmark(remove=true) reports bookmarked:false', async () => {
    mockBridge({ ok: true });
    const result = await bookmark('https://x.com/bob/status/1', true);
    expect(result.bookmarked).toBe(false);
  });
});

describe('deleteTweet / sendDm -- not automatable, point at the card', () => {
  test('deleteTweet always throws with the target URL', () => {
    expect(() => deleteTweet('https://x.com/bob/status/1')).toThrow(/x\.com\/bob\/status\/1/);
  });

  test('sendDm always throws pointing at /messages', () => {
    expect(() => sendDm('bob')).toThrow(/x\.com\/messages/);
  });
});
