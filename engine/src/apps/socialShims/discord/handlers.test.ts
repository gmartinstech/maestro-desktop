import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import * as http from '../../../net/http';
import { handleToolCall } from './handlers';

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env.MAESTRO_INSTALL_ID = 'inst-123';
  delete process.env.MAESTRO_DISCORD_GUILD_IDS;
});

afterEach(() => {
  vi.restoreAllMocks();
  process.env = { ...ORIGINAL_ENV };
});

describe('handleToolCall (discord)', () => {
  test('discord_login returns connected:true + guilds on success', async () => {
    vi.spyOn(http, 'engineFetch').mockResolvedValue(new Response(JSON.stringify([{ id: 'g1' }]), { status: 200 }));
    const result = await handleToolCall('discord_login', {});
    expect(JSON.parse(result.content[0].text)).toEqual({ connected: true, guilds: [{ id: 'g1' }] });
    expect(result.isError).toBeUndefined();
  });

  test('discord_login surfaces a proxy error', async () => {
    vi.spyOn(http, 'engineFetch').mockResolvedValue(new Response('nope', { status: 500 }));
    const result = await handleToolCall('discord_login', {});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Discord proxy unreachable');
  });

  test('discord_get_server_info enforces the guild allowlist before calling out', async () => {
    process.env.MAESTRO_DISCORD_GUILD_IDS = 'allowed-guild';
    const spy = vi.spyOn(http, 'engineFetch');
    const result = await handleToolCall('discord_get_server_info', { guild_id: 'other-guild' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('not authorized');
    expect(spy).not.toHaveBeenCalled();
  });

  test('discord_send posts content to the channel messages endpoint', async () => {
    const spy = vi.spyOn(http, 'engineFetch').mockResolvedValue(new Response(JSON.stringify({ id: 'm1' }), { status: 201 }));
    const result = await handleToolCall('discord_send', { channel_id: 'c1', content: 'hi' });
    expect(result.isError).toBeUndefined();
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/channels/c1/messages');
    expect(JSON.parse(init.body as string)).toEqual({ content: 'hi' });
  });

  test('discord_read_messages clamps limit to [1,100]', async () => {
    const spy = vi.spyOn(http, 'engineFetch').mockResolvedValue(new Response('[]', { status: 200 }));
    await handleToolCall('discord_read_messages', { channel_id: 'c1', limit: 500 });
    const [url] = spy.mock.calls[0] as [string];
    expect(url).toContain('limit=100');
  });

  test('discord_add_multiple_reactions reports per-emoji outcomes', async () => {
    vi.spyOn(http, 'engineFetch')
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response('nope', { status: 400 }));
    const result = await handleToolCall('discord_add_multiple_reactions', { channel_id: 'c1', message_id: 'm1', emojis: ['👍', '👎'] });
    const parsed = JSON.parse(result.content[0].text) as { reactions: Array<{ emoji: string; ok: boolean; status: number }> };
    expect(parsed.reactions).toEqual([
      { emoji: '👍', ok: true, status: 204 },
      { emoji: '👎', ok: false, status: 400 },
    ]);
  });

  test('discord_get_forum_channels filters to type 15', async () => {
    vi.spyOn(http, 'engineFetch').mockResolvedValue(
      new Response(JSON.stringify([{ id: 'c1', type: 0 }, { id: 'c2', type: 15 }]), { status: 200 }),
    );
    const result = await handleToolCall('discord_get_forum_channels', { guild_id: 'g1' });
    expect(JSON.parse(result.content[0].text)).toEqual([{ id: 'c2', type: 15 }]);
  });

  test('discord_delete_channel treats 200 and 204 as success', async () => {
    vi.spyOn(http, 'engineFetch').mockResolvedValue(new Response(null, { status: 204 }));
    const result = await handleToolCall('discord_delete_channel', { channel_id: 'c1' });
    expect(JSON.parse(result.content[0].text)).toEqual({ deleted: true });
  });

  test('an unknown tool name returns an MCP error', async () => {
    const result = await handleToolCall('discord_nonsense', {});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Unknown tool');
  });
});
