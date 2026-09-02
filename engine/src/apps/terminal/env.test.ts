import { describe, expect, test } from 'vitest';
import { buildTerminalEnv } from './env';

describe('buildTerminalEnv', () => {
  test('scrubs every provider-credential key from the inherited env', () => {
    const env = buildTerminalEnv({
      PATH: '/usr/bin',
      ANTHROPIC_API_KEY: 'secret-anthropic',
      ANTHROPIC_AUTH_TOKEN: 'secret-auth',
      OPENAI_API_KEY: 'secret-openai',
      PROVEDOR_IA_TOKEN: 'secret-maestro',
      MAESTRO_AUTH_TOKEN: 'secret-engine-token',
      AWS_SECRET_ACCESS_KEY: 'secret-aws',
      GITHUB_TOKEN: 'secret-gh',
      HOME: '/home/user',
    });
    expect(env.PATH).toBe('/usr/bin');
    expect(env.HOME).toBe('/home/user');
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.PROVEDOR_IA_TOKEN).toBeUndefined();
    expect(env.MAESTRO_AUTH_TOKEN).toBeUndefined();
    expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
    expect(env.GITHUB_TOKEN).toBeUndefined();
  });

  test('sets TERM to xterm-256color so shell programs emit color', () => {
    const env = buildTerminalEnv({ PATH: '/usr/bin' });
    expect(env.TERM).toBe('xterm-256color');
  });

  test('an inherited TERM is overridden, not preserved', () => {
    const env = buildTerminalEnv({ TERM: 'dumb' });
    expect(env.TERM).toBe('xterm-256color');
  });

  test('drops keys whose value is undefined rather than stringifying them', () => {
    const env = buildTerminalEnv({ SOMETHING: undefined, REAL: 'value' });
    expect(env.SOMETHING).toBeUndefined();
    expect(env.REAL).toBe('value');
  });
});
