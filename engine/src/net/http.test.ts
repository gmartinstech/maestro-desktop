import { describe, expect, test } from 'vitest';
import { EgressBlockedError, engineFetch, isHostAllowed } from './http';

describe('isHostAllowed', () => {
  test.each([
    'llm.martinstech.net',
    'martinstech.net',
    'cdn.martinstech.net',
    'localhost',
    '127.0.0.1',
    '::1',
    // SUB-2's skill registry: api.github.com/raw.githubusercontent.com/skills.sh, added on top of
    // ENG-7's original set -- see http.ts's own module doc for why these are runtime allowances.
    'api.github.com',
    'raw.githubusercontent.com',
    'skills.sh',
    // SUB-8's web sub-app: DDG search hosts, same "our own hardcoded outbound call" posture.
    'html.duckduckgo.com',
    'lite.duckduckgo.com',
    // SUB-9's social MCP shims: reddit/tiktok's own session-cookie-borrowing HTTP transport.
    'www.reddit.com',
    'www.tiktok.com',
  ])('always-allowed host: %s', (host) => {
    expect(isHostAllowed(host)).toBe(true);
  });

  test('is case-insensitive', () => {
    expect(isHostAllowed('LLM.MARTINSTECH.NET')).toBe(true);
  });

  test.each([
    'openswarm.com',
    'api.openswarm.com',
    'analytics.openswarm.com',
    'evil.example.com',
    'martinstech.net.evil.com',
    'notmartinstech.net',
  ])('blocked by default: %s', (host) => {
    expect(isHostAllowed(host)).toBe(false);
  });

  test('api.anthropic.com is blocked with no lane named', () => {
    expect(isHostAllowed('api.anthropic.com')).toBe(false);
  });

  test('api.openai.com is blocked with no lane named', () => {
    expect(isHostAllowed('api.openai.com')).toBe(false);
  });

  test('api.anthropic.com allowed only under the anthropic-passthrough lane', () => {
    expect(isHostAllowed('api.anthropic.com', { passthroughLane: 'anthropic-passthrough' })).toBe(true);
    expect(isHostAllowed('api.anthropic.com', { passthroughLane: 'openai-passthrough' })).toBe(false);
  });

  test('api.openai.com allowed only under the openai-passthrough lane', () => {
    expect(isHostAllowed('api.openai.com', { passthroughLane: 'openai-passthrough' })).toBe(true);
    expect(isHostAllowed('api.openai.com', { passthroughLane: 'anthropic-passthrough' })).toBe(false);
  });

  test('naming a lane does not unlock the other lane host', () => {
    expect(isHostAllowed('api.openai.com', { passthroughLane: 'anthropic-passthrough' })).toBe(false);
  });

  test('generativelanguage.googleapis.com allowed only under the gemini-passthrough lane (SUB-8)', () => {
    expect(isHostAllowed('generativelanguage.googleapis.com')).toBe(false);
    expect(isHostAllowed('generativelanguage.googleapis.com', { passthroughLane: 'gemini-passthrough' })).toBe(true);
    expect(isHostAllowed('generativelanguage.googleapis.com', { passthroughLane: 'openai-passthrough' })).toBe(false);
  });

  test('build-time-only hosts are never allowed through this path', () => {
    expect(isHostAllowed('github.com')).toBe(false);
    expect(isHostAllowed('registry.npmjs.org')).toBe(false);
  });
});

describe('engineFetch', () => {
  test('rejects a blocked host before any network I/O, with EgressBlockedError', async () => {
    await expect(engineFetch('https://evil.example.com/x')).rejects.toBeInstanceOf(EgressBlockedError);
  });

  test('rejects the openswarm call-home host', async () => {
    await expect(engineFetch('https://api.openswarm.com/x')).rejects.toThrow(/blocked an outbound request/);
  });

  test('rejects an un-laned passthrough host', async () => {
    await expect(engineFetch('https://api.anthropic.com/v1/messages')).rejects.toBeInstanceOf(EgressBlockedError);
  });

  test('accepts a URL instance, not just a string', async () => {
    await expect(engineFetch(new URL('https://evil.example.com'))).rejects.toBeInstanceOf(EgressBlockedError);
  });
});
