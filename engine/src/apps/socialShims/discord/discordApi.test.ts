import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import * as http from '../../../net/http';
import { checkGuild, discordCall } from './discordApi';

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env.MAESTRO_INSTALL_ID = 'inst-123';
  delete process.env.MAESTRO_OAUTH_BASE_URL;
  delete process.env.MAESTRO_DISCORD_GUILD_IDS;
});

afterEach(() => {
  vi.restoreAllMocks();
  process.env = { ...ORIGINAL_ENV };
});

describe('discordCall', () => {
  test('fails locally without calling the network when MAESTRO_INSTALL_ID is unset', async () => {
    delete process.env.MAESTRO_INSTALL_ID;
    const spy = vi.spyOn(http, 'engineFetch');
    const result = await discordCall('GET', '/users/@me/guilds');
    expect(result.status).toBe(0);
    expect(result.body).toContain('MAESTRO_INSTALL_ID');
    expect(spy).not.toHaveBeenCalled();
  });

  test('sends X-Maestro-Install-Id + Accept, hits the proxy base + /api/discord prefix', async () => {
    const spy = vi.spyOn(http, 'engineFetch').mockResolvedValue(new Response(JSON.stringify({ id: 'g1' }), { status: 200 }));
    const result = await discordCall('GET', '/guilds/g1');
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ id: 'g1' });
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://llm.martinstech.net/v1/api/discord/guilds/g1');
    expect((init.headers as Record<string, string>)['X-Maestro-Install-Id']).toBe('inst-123');
  });

  test('respects MAESTRO_OAUTH_BASE_URL override, still the existing (non-openswarm) mechanism', async () => {
    process.env.MAESTRO_OAUTH_BASE_URL = 'https://custom.example.com/v1/';
    const spy = vi.spyOn(http, 'engineFetch').mockResolvedValue(new Response('{}', { status: 200 }));
    await discordCall('GET', '/x');
    expect((spy.mock.calls[0] as [string])[0]).toBe('https://custom.example.com/v1/api/discord/x');
  });

  test('a JSON body sets Content-Type and is serialized', async () => {
    const spy = vi.spyOn(http, 'engineFetch').mockResolvedValue(new Response('{}', { status: 201 }));
    await discordCall('POST', '/channels/c1/messages', { body: { content: 'hi' } });
    const [, init] = spy.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(init.body).toBe(JSON.stringify({ content: 'hi' }));
  });

  test('a query object is urlencoded and appended', async () => {
    const spy = vi.spyOn(http, 'engineFetch').mockResolvedValue(new Response('{}', { status: 200 }));
    await discordCall('GET', '/channels/c1/messages', { query: { limit: 50 } });
    const [url] = spy.mock.calls[0] as [string];
    expect(url).toBe('https://llm.martinstech.net/v1/api/discord/channels/c1/messages?limit=50');
  });

  test('an unreachable helper service reports status 0 with an actionable message', async () => {
    vi.spyOn(http, 'engineFetch').mockRejectedValue(new Error('ECONNREFUSED'));
    const result = await discordCall('GET', '/x');
    expect(result.status).toBe(0);
    expect(result.body).toContain('Helper service unreachable');
  });
});

describe('checkGuild', () => {
  test('allows everything when MAESTRO_DISCORD_GUILD_IDS is unset (no authorization yet)', () => {
    expect(checkGuild('anything')).toBeNull();
  });

  test('allows a guild id present in the CSV allowlist', () => {
    process.env.MAESTRO_DISCORD_GUILD_IDS = 'g1,g2';
    expect(checkGuild('g2')).toBeNull();
  });

  test('rejects a guild id not in the CSV allowlist, naming the authorized set', () => {
    process.env.MAESTRO_DISCORD_GUILD_IDS = 'g1,g2';
    const err = checkGuild('g3');
    expect(err).toContain('Guild g3 is not authorized');
    expect(err).toContain('g1');
    expect(err).toContain('g2');
  });
});
