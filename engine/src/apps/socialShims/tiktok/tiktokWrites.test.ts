import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import * as http from '../../../net/http';
import { comment, favorite, follow, like, upload } from './tiktokWrites';

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env.MAESTRO_PORT = '18324';
  process.env.MAESTRO_AUTH_TOKEN = 'test-token';
});

afterEach(() => {
  vi.restoreAllMocks();
  process.env = { ...ORIGINAL_ENV };
});

function mockBridgeResult(text: string): void {
  vi.spyOn(http, 'engineFetch').mockResolvedValue(new Response(JSON.stringify({ results: [{ text }] }), { status: 200 }));
}

describe('like / favorite / follow / comment', () => {
  test('like navigates to the video and clicks the like control', async () => {
    mockBridgeResult(JSON.stringify({ ok: true, clicked: 'like' }));
    const result = await like('https://www.tiktok.com/@x/video/1', false);
    expect(result).toMatchObject({ video: 'https://www.tiktok.com/@x/video/1', liked: true });
    const call = vi.mocked(http.engineFetch).mock.calls[0];
    const body = JSON.parse((call[1] as RequestInit).body as string) as { domain: string; steps: Array<{ op: string; url?: string }> };
    expect(body.domain).toBe('tiktok.com');
    expect(body.steps[0]).toEqual({ op: 'navigate', url: 'https://www.tiktok.com/@x/video/1' });
  });

  test('unlike=true reports liked:false even on a successful click', async () => {
    mockBridgeResult(JSON.stringify({ ok: true }));
    const result = await like('https://www.tiktok.com/@x/video/1', true);
    expect(result.liked).toBe(false);
  });

  test('a failed click reports liked:false with detail carrying the error', async () => {
    mockBridgeResult(JSON.stringify({ ok: false, error: 'control not found: like' }));
    const result = await like('https://www.tiktok.com/@x/video/1', false);
    expect(result.liked).toBe(false);
    expect((result.detail as { error: string }).error).toContain('control not found');
  });

  test('favorite reports favorited:true on success', async () => {
    mockBridgeResult(JSON.stringify({ ok: true }));
    const result = await favorite('https://www.tiktok.com/@x/video/1', false);
    expect(result.favorited).toBe(true);
  });

  test('follow strips a leading @ from the handle', async () => {
    mockBridgeResult(JSON.stringify({ ok: true }));
    const result = await follow('@bob', false);
    expect(result).toMatchObject({ username: 'bob', following: true });
    const call = vi.mocked(http.engineFetch).mock.calls[0];
    const body = JSON.parse((call[1] as RequestInit).body as string) as { steps: Array<{ url?: string }> };
    expect(body.steps[0].url).toBe('https://www.tiktok.com/@bob');
  });

  test('comment reports posted:true on success', async () => {
    mockBridgeResult(JSON.stringify({ ok: true, posted: true }));
    const result = await comment('https://www.tiktok.com/@x/video/1', 'nice!');
    expect(result.posted).toBe(true);
  });
});

describe('upload', () => {
  test('opens the upload page and returns an actionable note (no file-picker automation)', async () => {
    const spy = vi.spyOn(http, 'engineFetch').mockResolvedValue(new Response(JSON.stringify({ results: [] }), { status: 200 }));
    const result = await upload('my caption', '/tmp/video.mp4');
    expect(result.opened).toBe('https://www.tiktok.com/upload');
    expect(String(result.note)).toContain('video.mp4');
    expect(String(result.note)).toContain('my caption');
    const body = JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string) as { steps: Array<{ url?: string }> };
    expect(body.steps[0].url).toBe('https://www.tiktok.com/upload');
  });
});
