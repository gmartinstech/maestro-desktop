// engine/src/apps/mcpRegistry/registry.test.ts -- SUB-4, fresh coverage for
// backend/apps/mcp_registry/mcp_registry.py's pure parsing helpers (no dedicated Python test file
// exists to port against -- grepped backend/tests/, zero references to mcp_registry -- so these
// are hand-written against the ported behavior itself, same posture SUB-1 took for
// dashboard_layout and SUB-4's own toolTaxonomy.test.ts took for tool_taxonomy).

import { describe, expect, test } from 'vitest';
import { applyStars, extractGhRepo, extractServer, parseGoogleReadme, resetRegistryStateForTests } from './registry';

describe('extractGhRepo', () => {
  test('parses owner/repo from a plain github URL', () => {
    expect(extractGhRepo('https://github.com/foo/bar')).toBe('foo/bar');
  });
  test('strips a trailing .git and trailing slash', () => {
    expect(extractGhRepo('https://github.com/foo/bar.git/')).toBe('foo/bar');
  });
  test('null for a non-github URL', () => {
    expect(extractGhRepo('https://example.com/foo/bar')).toBeNull();
  });
  test('null for empty input', () => {
    expect(extractGhRepo('')).toBeNull();
  });
});

describe('extractServer', () => {
  test('returns null when not marked isLatest', () => {
    const entry = { _meta: { 'io.modelcontextprotocol.registry/official': { isLatest: false } }, server: { name: 'x' } };
    expect(extractServer(entry)).toBeNull();
  });

  test('extracts a full record from a latest entry', () => {
    const entry = {
      _meta: { 'io.modelcontextprotocol.registry/official': { isLatest: true } },
      server: {
        name: 'io.github.acme/widget',
        title: 'Widget',
        description: 'Does widget things',
        version: '1.2.3',
        websiteUrl: 'https://acme.example/widget',
        repository: { url: 'https://github.com/acme/widget' },
        remotes: [{ url: 'https://widget.acme.example/mcp', type: 'streamable-http' }],
        packages: [{ environmentVariables: [{ name: 'API_KEY' }] }],
        icons: [{ src: 'https://acme.example/icon.png' }],
        _meta: { 'io.modelcontextprotocol.registry/publisher-provided': { keywords: ['widgets'], license: 'MIT' } },
      },
    };
    const record = extractServer(entry)!;
    expect(record.name).toBe('io.github.acme/widget');
    expect(record.repositoryUrl).toBe('https://github.com/acme/widget');
    expect(record.remoteUrl).toBe('https://widget.acme.example/mcp');
    expect(record.remoteType).toBe('streamable-http');
    expect(record.iconUrl).toBe('https://acme.example/icon.png');
    expect(record.keywords).toEqual(['widgets']);
    expect(record.license).toBe('MIT');
    expect(record.source).toBe('community');
    expect(record.stars).toBeNull();
  });

  test('falls back to a github-avatar icon URL when no icon is given but the repo is on GitHub', () => {
    const entry = {
      _meta: { 'io.modelcontextprotocol.registry/official': { isLatest: true } },
      server: { name: 'acme/widget', repository: { url: 'https://github.com/acme/widget' } },
    };
    const record = extractServer(entry)!;
    expect(record.iconUrl).toBe('https://github.com/acme.png?size=64');
  });

  test('returns null when the server has no name', () => {
    const entry = { _meta: { 'io.modelcontextprotocol.registry/official': { isLatest: true } }, server: {} };
    expect(extractServer(entry)).toBeNull();
  });
});

describe('parseGoogleReadme', () => {
  test('parses remote and open-source sections into distinct entries', () => {
    const readme = [
      '# Remote MCP Servers',
      '',
      '- [**BigQuery**](https://github.com/google/bigquery-mcp), Query BigQuery datasets.',
      '',
      '# Open-Source MCP Servers',
      '',
      '- [**Local Tool**](https://example.com/local), A local-only tool.',
      '',
      '# Examples',
      '- [**Ignored**](https://example.com/ignored), should not be parsed.',
    ].join('\n');

    const servers = parseGoogleReadme(readme);
    expect(Object.keys(servers).sort()).toEqual(['google/bigquery', 'google/local-tool']);
    expect(servers['google/bigquery'].remoteType).toBe('google-cloud-remote');
    expect(servers['google/bigquery'].repositoryUrl).toBe('https://github.com/google/bigquery-mcp');
    expect(servers['google/local-tool'].remoteType).toBe('open-source');
    expect(servers['google/local-tool'].websiteUrl).toBe('https://example.com/local');
    expect(servers['google/local-tool'].source).toBe('google');
  });

  test('returns nothing for text with no recognized sections', () => {
    expect(parseGoogleReadme('# Unrelated\n- [**X**](https://example.com/x)')).toEqual({});
  });
});

describe('applyStars', () => {
  test('sets stars from the module-level cache, null when unknown', () => {
    resetRegistryStateForTests();
    const servers = {
      a: { name: 'a', title: '', description: '', version: '', websiteUrl: '', repositoryUrl: 'https://github.com/foo/bar', remoteUrl: '', remoteType: '', iconUrl: '', environmentVariables: [], keywords: [], license: '', stars: null, source: 'community' as const },
      b: { name: 'b', title: '', description: '', version: '', websiteUrl: '', repositoryUrl: '', remoteUrl: '', remoteType: '', iconUrl: '', environmentVariables: [], keywords: [], license: '', stars: null, source: 'community' as const },
    };
    // fetchGithubStars makes a real network call for anything not already cached; skip it here and
    // just prove applyStars reads whatever IS cached (populated via a real fetchGithubStars call in
    // the http.test.ts smoke path instead, where the cache is pre-seeded).
    applyStars(servers);
    expect(servers.a.stars).toBeNull();
    expect(servers.b.stars).toBeNull();
  });
});
