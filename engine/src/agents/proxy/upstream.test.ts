// engine/src/agents/proxy/upstream.test.ts -- ports the routing behavior of
// backend/apps/agents/proxy/anthropic_proxy.py's p_pick_upstream.

import { describe, expect, test } from 'vitest';
import { NINE_ROUTER_URL } from '../../router/process';
import { buildForwardHeaders, HOP_HEADERS, pickUpstream } from './upstream';

describe('pickUpstream', () => {
  test('a Claude model with an own Anthropic key routes direct to api.anthropic.com', () => {
    const target = pickUpstream('claude-3-5-sonnet', { anthropic_api_key: 'sk-ant-test' });
    expect(target.baseUrl).toBe('https://api.anthropic.com');
    expect(target.authHeaders['x-api-key']).toBe('sk-ant-test');
    expect(target.authHeaders['anthropic-version']).toBe('2023-06-01');
  });

  test('a Claude model with no key falls back to the loopback 9Router', () => {
    const target = pickUpstream('claude-3-5-sonnet', { anthropic_api_key: null });
    expect(target.baseUrl).toBe(NINE_ROUTER_URL);
    expect(target.authHeaders['x-api-key']).toBe('9router');
  });

  test('the cc/ 9Router lane prefix is also recognized as Claude-family', () => {
    const target = pickUpstream('cc/claude-3-5-sonnet', { anthropic_api_key: 'sk-ant-test' });
    expect(target.baseUrl).toBe('https://api.anthropic.com');
  });

  test('a non-Claude model always goes to 9Router regardless of an Anthropic key being set', () => {
    const target = pickUpstream('gemini-3.1-pro-preview', { anthropic_api_key: 'sk-ant-test' });
    expect(target.baseUrl).toBe(NINE_ROUTER_URL);
    expect(target.authHeaders['x-api-key']).toBe('9router');
  });

  test('an override base URL is honored -- the one seam this ticket adds for safe live-gate testing', () => {
    const target = pickUpstream('gpt-5', { anthropic_api_key: null }, 'http://127.0.0.1:59999');
    expect(target.baseUrl).toBe('http://127.0.0.1:59999');
  });

  test('a blank/whitespace-only key is treated as absent', () => {
    const target = pickUpstream('claude-3-5-sonnet', { anthropic_api_key: '   ' });
    expect(target.baseUrl).toBe(NINE_ROUTER_URL);
  });
});

describe('buildForwardHeaders', () => {
  test('drops hop-by-hop headers and the CLI\'s own x-api-key, then layers upstream auth on top', () => {
    const headers = buildForwardHeaders(
      Object.entries({
        host: 'engine.local',
        'content-length': '123',
        authorization: 'Bearer engine-token',
        'x-api-key': 'our-install-token',
        connection: 'keep-alive',
        'content-type': 'application/json',
        'x-custom-header': 'keep-me',
      }),
      { 'x-api-key': 'sk-ant-real', 'anthropic-version': '2023-06-01' },
    );
    expect(headers).toEqual({
      'content-type': 'application/json',
      'x-custom-header': 'keep-me',
      'x-api-key': 'sk-ant-real',
      'anthropic-version': '2023-06-01',
    });
  });

  test('every documented hop header name is actually in the set', () => {
    for (const h of ['host', 'content-length', 'authorization', 'x-api-key', 'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailers', 'transfer-encoding', 'upgrade']) {
      expect(HOP_HEADERS.has(h)).toBe(true);
    }
  });
});
