import { describe, expect, test } from 'vitest';
import { parseRouteTable, resolveMode, routeNameFromPath } from './split';

describe('parseRouteTable', () => {
  test('unset env var yields an empty table', () => {
    expect(parseRouteTable(undefined).size).toBe(0);
  });

  test('empty string yields an empty table', () => {
    expect(parseRouteTable('').size).toBe(0);
  });

  test('parses comma-separated name:mode pairs', () => {
    const table = parseRouteTable('agents:native,settings:native,terminal:proxy');
    expect(table.get('agents')).toBe('native');
    expect(table.get('settings')).toBe('native');
    expect(table.get('terminal')).toBe('proxy');
    expect(table.size).toBe(3);
  });

  test('tolerates surrounding whitespace and a trailing comma', () => {
    const table = parseRouteTable(' agents : native , settings:native, ');
    expect(table.get('agents')).toBe('native');
    expect(table.get('settings')).toBe('native');
    expect(table.size).toBe(2);
  });

  test('rejects an entry with no colon', () => {
    expect(() => parseRouteTable('agents')).toThrow(/malformed entry/);
  });

  test('rejects an unknown mode', () => {
    expect(() => parseRouteTable('agents:sometimes')).toThrow(/unknown mode/);
  });

  test('rejects an empty name', () => {
    expect(() => parseRouteTable(':native')).toThrow(/empty name/);
  });
});

describe('routeNameFromPath', () => {
  test.each([
    ['/api/agents/launch', 'agents'],
    ['/api/agents', 'agents'],
    ['/ws/agents/abc-123', 'agents'],
    ['/ws/outputs/runtime/abc/logs', 'outputs'],
    ['/ws/dashboard', 'dashboard'],
    ['/ws/terminal/abc-123', 'terminal'],
    ['/api/dev/token', 'dev'],
    ['/api/anthropic-proxy/v1/messages', 'anthropic-proxy'],
  ])('%s -> %s', (path, expected) => {
    expect(routeNameFromPath(path)).toBe(expected);
  });

  test.each(['/docs', '/openapi.json', '/redoc', '/favicon.ico', '/', ''])('%s -> null (no subsystem owner)', (path) => {
    expect(routeNameFromPath(path)).toBeNull();
  });
});

describe('resolveMode', () => {
  test('a name absent from the table defaults to proxy', () => {
    const table = parseRouteTable('agents:native');
    expect(resolveMode(table, 'settings')).toBe('proxy');
  });

  test('a name present in the table returns its configured mode', () => {
    const table = parseRouteTable('agents:native');
    expect(resolveMode(table, 'agents')).toBe('native');
  });

  test('a null name (no subsystem owner) defaults to proxy', () => {
    const table = parseRouteTable('agents:native');
    expect(resolveMode(table, null)).toBe('proxy');
  });

  test('an empty table (MAESTRO_ENGINE_ROUTES unset) proxies everything', () => {
    const table = parseRouteTable(undefined);
    expect(resolveMode(table, 'agents')).toBe('proxy');
    expect(resolveMode(table, 'anything-nobody-has-heard-of-yet')).toBe('proxy');
  });
});
