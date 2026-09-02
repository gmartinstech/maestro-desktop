// engine/src/apps/swarm/redact.test.ts -- SUB-3, SECURITY-SENSITIVE. Vitest twin of
// backend/tests/test_swarm_bundle.py's redaction cases (test_redaction_drops_denied_keys,
// test_pack_refuses_denied_key, test_pack_refuses_secret_in_workspace_file,
// test_content_secret_redacted_in_bundle, test_pack_allows_clean_workspace_file), PLUS this
// ticket's own required test: every P_DENY_EXACT/P_DENY_SUBSTRINGS entry enumerated directly from
// backend/apps/swarm/redact.py's own source (not guessed), each fed a realistic-looking secret of
// its shape, asserting none of them survive scrubPayload/pack -- proving `provedor_ia_token` (the
// Maestro credential, deliberately NOT renamed anywhere in this codebase per CLAUDE.md) and every
// other denied pattern stay redacted.

import JSZip from 'jszip';
import { describe, expect, test } from 'vitest';
import { findDeniedKeys, isDeniedKey, P_DENY_EXACT, P_DENY_SUBSTRINGS, scrubPayload } from './redact';
import { findSecretsInFiles, looksSecret } from '../skillRegistry/secretScan';
import { BundleError, pack } from './ziputil';

// ---- exhaustiveness: this list must match backend/apps/swarm/redact.py's source verbatim ----
// P_DENY_SUBSTRINGS = (
//   "api_key", "apikey", "secret", "password", "passwd", "credential", "oauth",
//   "bearer", "subscription_token", "access_token", "refresh_token",
//   "session_token", "auth_token", "private_key",
// )
const EXPECTED_DENY_SUBSTRINGS = [
  'api_key', 'apikey', 'secret', 'password', 'passwd', 'credential', 'oauth',
  'bearer', 'subscription_token', 'access_token', 'refresh_token',
  'session_token', 'auth_token', 'private_key',
];

// P_DENY_EXACT = {
//   "token", "installation_id", "user_id", "maestro_bearer_token",
//   "provedor_ia_token",
//   "connected_account_email", "oauth_tokens",
//   "credentials", "sdk_session_id",
// }
const EXPECTED_DENY_EXACT = [
  'token', 'installation_id', 'user_id', 'maestro_bearer_token',
  'provedor_ia_token',
  'connected_account_email', 'oauth_tokens',
  'credentials', 'sdk_session_id',
];

describe('deny-list is exhaustive against backend/apps/swarm/redact.py', () => {
  test('P_DENY_SUBSTRINGS matches the Python source exactly, in order', () => {
    expect([...P_DENY_SUBSTRINGS]).toEqual(EXPECTED_DENY_SUBSTRINGS);
  });

  test('P_DENY_EXACT matches the Python source exactly (as a set)', () => {
    expect(new Set(P_DENY_EXACT)).toEqual(new Set(EXPECTED_DENY_EXACT));
    expect(P_DENY_EXACT.size).toBe(EXPECTED_DENY_EXACT.length);
  });

  test('provedor_ia_token specifically is denied -- the Maestro credential this repo never renames', () => {
    expect(isDeniedKey('provedor_ia_token')).toBe(true);
    expect(isDeniedKey('Provedor_IA_Token')).toBe(true); // case-insensitive
  });
});

describe('every P_DENY_EXACT key, fed a realistic value, is stripped', () => {
  const realisticValues: Record<string, string> = {
    token: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
    installation_id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
    user_id: 'user_9f8a7b6c5d4e',
    maestro_bearer_token: 'mbt_live_9f8a7b6c5d4e3f2a1b0c',
    // The Maestro credential -- deliberately not renamed anywhere in this codebase (CLAUDE.md).
    provedor_ia_token: 'pia_live_sk_9f8a7b6c5d4e3f2a1b0c',
    connected_account_email: 'realuser@example.com',
    oauth_tokens: 'ya29.a0AfH6SMBxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    credentials: '{"client_secret":"shh"}',
    sdk_session_id: 'sess_9f8a7b6c5d4e3f2a1b0c',
  };

  for (const key of EXPECTED_DENY_EXACT) {
    test(`"${key}" is dropped from scrubPayload output`, () => {
      const payload = { name: 'ok', [key]: realisticValues[key] };
      const cleaned = scrubPayload(payload) as Record<string, unknown>;
      expect(cleaned).not.toHaveProperty(key);
      expect(cleaned.name).toBe('ok');
      // The realistic value itself must not survive anywhere in the serialized output.
      expect(JSON.stringify(cleaned)).not.toContain(realisticValues[key]);
    });
  }
});

describe('every P_DENY_SUBSTRINGS pattern, fed a realistic key containing it, is stripped', () => {
  const shapedKeys: Record<string, string> = {
    api_key: 'anthropic_api_key',
    apikey: 'stripeApikey',
    secret: 'client_secret',
    password: 'db_password',
    passwd: 'root_passwd',
    credential: 'azure_credential',
    oauth: 'oauth_state',
    bearer: 'bearer_header',
    subscription_token: 'billing_subscription_token',
    access_token: 'google_access_token',
    refresh_token: 'google_refresh_token',
    session_token: 'aws_session_token',
    auth_token: 'twilio_auth_token',
    private_key: 'rsa_private_key',
  };

  for (const sub of EXPECTED_DENY_SUBSTRINGS) {
    const key = shapedKeys[sub];
    test(`key "${key}" (contains "${sub}") is dropped from scrubPayload output`, () => {
      const secretValue = `realistic-secret-value-for-${sub}`;
      const payload = { name: 'ok', [key]: secretValue };
      const cleaned = scrubPayload(payload) as Record<string, unknown>;
      expect(cleaned).not.toHaveProperty(key);
      expect(JSON.stringify(cleaned)).not.toContain(secretValue);
    });
  }
});

describe('nested/recursive redaction (test_redaction_drops_denied_keys twin)', () => {
  test('drops denied keys at every depth, keeps everything else', () => {
    const payload = {
      name: 'ok',
      anthropic_api_key: 'sk-ant-secret',
      nested: { maestro_bearer_token: 'abc', keep: 1 },
      list: [{ oauth_tokens: { x: 1 } }, { fine: 2 }],
    };
    const cleaned = scrubPayload(payload) as {
      name: string;
      nested: { keep: number };
      list: [Record<string, unknown>, { fine: number }];
    };
    expect(findDeniedKeys(cleaned)).toEqual([]);
    expect(cleaned.name).toBe('ok');
    expect(cleaned.nested.keep).toBe(1);
    expect(cleaned.list[1].fine).toBe(2);
  });
});

describe('secret-SHAPE redaction inside string values (not just denied key names)', () => {
  // Every shape secretScan.ts's SECRET_SHAPE_PATTERNS catches, fed as a realistic-looking literal
  // sitting inside an innocuously-named field (e.g. a chat transcript) -- proves the shape-based
  // fail-safe catches a misnamed secret that the key-based deny-list alone would miss.
  const shapedSecrets: Record<string, string> = {
    'Anthropic key (sk-ant-...)': 'sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    'generic sk- key': 'sk-1234567890ABCDEFGHIJKLMNOPQRST',
    'Google API key (AIza...)': 'AIzaSyD-9tSrke72PouQMnMX-a7eZSW0jkFMBWQ',
    'GitHub PAT (ghp_...)': 'ghp_1234567890abcdefghijklmnopqrstuvwxyz',
    'GitHub OAuth (gho_...)': 'gho_1234567890abcdefghijklmnopqrstuvwxyz',
    'raw Bearer token': 'Bearer abcdef0123456789.ABCDEF0123456789',
  };

  for (const [label, secret] of Object.entries(shapedSecrets)) {
    test(`${label} embedded in free text is redacted`, () => {
      expect(looksSecret(secret)).toBe(true);
      const payload = { content: `here is my token: ${secret} -- keep it safe` };
      const cleaned = scrubPayload(payload) as { content: string };
      expect(cleaned.content).not.toContain(secret);
      expect(cleaned.content).toContain('[redacted]');
    });
  }
});

describe('pack() is the last line of defense (defense in depth)', () => {
  test('refuses to write a bundle whose payload still has a denied key', async () => {
    await expect(pack({ format_version: 1 }, { bid1: { provedor_ia_token: 'leak' } }, {})).rejects.toBeInstanceOf(BundleError);
  });

  test('refuses to write a bundle whose workspace FILE (not payload) holds a secret-shaped literal', async () => {
    const leak = Buffer.from("const KEY = 'sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAA';\n");
    await expect(pack({ format_version: 1 }, { bid1: { name: 'ok' } }, { 'entities/bid1/files/config.js': leak })).rejects.toBeInstanceOf(BundleError);
  });

  test('allows a clean payload and a clean workspace file through', async () => {
    const raw = await pack({ format_version: 1 }, { bid1: { name: 'ok' } }, { 'entities/bid1/files/app.js': Buffer.from('export default 1') });
    const zip = await JSZip.loadAsync(raw);
    expect(zip.file('manifest.json')).toBeTruthy();
  });

  test('findSecretsInFiles flags a file whose text body holds a secret-shaped literal', () => {
    const hits = findSecretsInFiles({ 'a.txt': Buffer.from('token: AIzaSyD-9tSrke72PouQMnMX-a7eZSW0jkFMBWQ') });
    expect(hits).toEqual(['a.txt']);
  });
});

describe('end-to-end: a realistic multi-shape payload survives scrubbing with nothing left', () => {
  test('every denied-key credential AND every secret-shaped literal is gone from the final JSON', () => {
    const payload = {
      name: 'Shared Session',
      provedor_ia_token: 'pia_live_sk_9f8a7b6c5d4e3f2a1b0c',
      maestro_bearer_token: 'mbt_live_abcdef0123456789',
      settings: {
        anthropic_api_key: 'sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        oauth_tokens: { access_token: 'ya29.a0AfH6SMBxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' },
      },
      messages: [
        { role: 'user', content: 'here is my github token ghp_1234567890abcdefghijklmnopqrstuvwxyz' },
        { role: 'assistant', content: 'got it, and your google key AIzaSyD-9tSrke72PouQMnMX-a7eZSW0jkFMBWQ is noted' },
      ],
    };
    const cleaned = scrubPayload(payload);
    const serialized = JSON.stringify(cleaned);
    expect(findDeniedKeys(cleaned)).toEqual([]);
    for (const secret of [
      'pia_live_sk_9f8a7b6c5d4e3f2a1b0c',
      'mbt_live_abcdef0123456789',
      'sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      'ya29.a0AfH6SMBxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      'ghp_1234567890abcdefghijklmnopqrstuvwxyz',
      'AIzaSyD-9tSrke72PouQMnMX-a7eZSW0jkFMBWQ',
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });
});
