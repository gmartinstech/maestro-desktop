import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import * as http from '../../../net/http';
import { fakeInstantRateLimiterDeps } from '../common/testRateLimiterDeps';
import { resetSessionCacheForTest } from '../common/sessionSource';
import { resetRateLimiterForTest } from './rateLimit';
import { comments, feed, getUser, getVideo, search, userVideos } from './tiktokReads';

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env.MAESTRO_PORT = '18324';
  process.env.MAESTRO_AUTH_TOKEN = 'test-token';
  resetSessionCacheForTest();
  resetRateLimiterForTest(fakeInstantRateLimiterDeps());
});

afterEach(() => {
  vi.restoreAllMocks();
  process.env = { ...ORIGINAL_ENV };
});

function mockTiktok(byPath: Record<string, unknown>): void {
  vi.spyOn(http, 'engineFetch').mockImplementation(async (input) => {
    const url = String(input);
    if (url.includes('browser-session')) return new Response(JSON.stringify({ cookies: [{ name: 'sessionid', value: 's1' }] }), { status: 200 });
    for (const [needle, body] of Object.entries(byPath)) {
      if (url.includes(needle)) return new Response(JSON.stringify(body), { status: 200 });
    }
    throw new Error(`unexpected tiktok URL in test: ${url}`);
  });
}

const RAW_VIDEO = {
  id: '123',
  desc: 'a great video',
  author: { uniqueId: 'creator1', nickname: 'Creator One' },
  stats: { diggCount: 10, commentCount: 2, playCount: 1000, shareCount: 1 },
  createTime: 1700000000,
};

describe('feed / search (the defensive item walker)', () => {
  test('finds video items nested anywhere in an itemList envelope', async () => {
    mockTiktok({ 'recommend/item_list': { statusCode: 0, itemList: [RAW_VIDEO] } });
    const result = await feed(20);
    expect(result.videos).toEqual([
      expect.objectContaining({ id: '123', author: 'creator1', likes: 10, url: 'https://www.tiktok.com/@creator1/video/123' }),
    ]);
  });

  test('finds items nested inside a deeper data[].item envelope shape', async () => {
    mockTiktok({ 'search/general/full': { statusCode: 0, data: [{ item: RAW_VIDEO }] } });
    const result = await search('cats', 10);
    expect(result.videos.length).toBe(1);
    expect(result.videos[0].id).toBe('123');
  });

  test('deduplicates by id across nested locations', async () => {
    mockTiktok({ 'recommend/item_list': { statusCode: 0, itemList: [RAW_VIDEO, RAW_VIDEO] } });
    const result = await feed(20);
    expect(result.videos.length).toBe(1);
  });

  test('respects the requested cap even with many candidate items', async () => {
    const many = Array.from({ length: 5 }, (_, i) => ({ ...RAW_VIDEO, id: String(i) }));
    mockTiktok({ 'recommend/item_list': { statusCode: 0, itemList: many } });
    const result = await feed(2);
    expect(result.videos.length).toBe(2);
  });
});

describe('getUser', () => {
  test('shapes userInfo.user/stats down to a compact profile', async () => {
    mockTiktok({
      'user/detail': { statusCode: 0, userInfo: { user: { id: 'u1', secUid: 'sec1', uniqueId: 'bob', nickname: 'Bob', signature: 'hi', verified: true }, stats: { followerCount: 5, followingCount: 2, heartCount: 9, videoCount: 3 } } },
    });
    const result = await getUser('@bob');
    expect(result).toEqual({ id: 'u1', sec_uid: 'sec1', username: 'bob', nickname: 'Bob', bio: 'hi', followers: 5, following: 2, likes: 9, videos: 3, verified: true });
  });
});

describe('userVideos', () => {
  test('resolves the handle to a secUid before listing videos', async () => {
    mockTiktok({
      'user/detail': { statusCode: 0, userInfo: { user: { secUid: 'sec-xyz' }, stats: {} } },
      'post/item_list': { statusCode: 0, itemList: [RAW_VIDEO] },
    });
    const result = await userVideos('bob', 20, '');
    expect(result.videos.length).toBe(1);
    const call = vi.mocked(http.engineFetch).mock.calls.find(([u]) => String(u).includes('post/item_list'))!;
    expect(String(call[0])).toContain('secUid=sec-xyz');
  });

  test('throws an actionable TikTokError when the handle cannot be resolved', async () => {
    mockTiktok({ 'user/detail': { statusCode: 0, userInfo: {} } });
    await expect(userVideos('nobody', 20, '')).rejects.toThrow(/Could not resolve/);
  });
});

describe('getVideo', () => {
  test('returns a not-found placeholder for an empty itemStruct', async () => {
    mockTiktok({ 'item/detail': { statusCode: 0, itemInfo: {} } });
    expect(await getVideo('999')).toEqual({ id: '999', note: 'not found or signature-gated' });
  });
});

describe('comments', () => {
  test('shapes a comment list down to compact records', async () => {
    mockTiktok({ 'comment/list': { statusCode: 0, comments: [{ cid: 'c1', text: 'nice', user: { unique_id: 'x' }, digg_count: 3, create_time: 1 }], cursor: '10' } });
    const result = await comments('123', 20, '');
    expect(result).toEqual({ comments: [{ id: 'c1', text: 'nice', author: 'x', likes: 3, created: 1 }], cursor: '10' });
  });
});
