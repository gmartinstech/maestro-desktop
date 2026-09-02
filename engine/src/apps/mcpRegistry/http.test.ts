// engine/src/apps/mcpRegistry/http.test.ts -- SUB-4's vitest twin of the /api/mcp-registry HTTP
// surface, same real-Fastify-server pattern apps/skills/http.test.ts already established.

import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { handleMcpRegistryHttpRequest } from './http';
import { resetRegistryStateForTests, setRegistryCacheForTests, type RegistryServer } from './registry';

let fastify: FastifyInstance;
let baseUrl: string;

function server(overrides: Partial<RegistryServer> = {}): RegistryServer {
  return {
    name: 'acme/widget',
    title: 'Widget',
    description: 'Does widget things',
    version: '1.0.0',
    websiteUrl: '',
    repositoryUrl: '',
    remoteUrl: '',
    remoteType: '',
    iconUrl: '',
    environmentVariables: [],
    keywords: [],
    license: '',
    stars: null,
    source: 'community',
    ...overrides,
  };
}

beforeAll(async () => {
  fastify = Fastify({ logger: false });
  fastify.all('*', async (request, reply) => {
    const pathname = (request.raw.url ?? '/').split('?')[0];
    const handled = await handleMcpRegistryHttpRequest(pathname, request, reply);
    if (!handled) reply.code(404).send({ error: 'unhandled_by_this_test_server' });
  });
  baseUrl = await fastify.listen({ port: 0, host: '127.0.0.1' });
});

afterAll(async () => {
  await fastify.close();
});

beforeEach(() => {
  resetRegistryStateForTests();
});

afterEach(() => {
  resetRegistryStateForTests();
});

test('GET /api/mcp-registry/stats reports totals by source', async () => {
  setRegistryCacheForTests({
    a: server({ name: 'a', source: 'community' }),
    b: server({ name: 'b', source: 'google' }),
    c: server({ name: 'c', source: 'google' }),
  });
  const res = await fetch(`${baseUrl}/api/mcp-registry/stats`);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { total: number; google: number; community: number };
  expect(body).toMatchObject({ total: 3, google: 2, community: 1 });
});

describe('GET /api/mcp-registry/search', () => {
  test('filters by query text and source, sorts by name by default', async () => {
    setRegistryCacheForTests({
      zeta: server({ name: 'zeta', title: 'Zeta Tool', description: 'unrelated', source: 'community' }),
      alpha: server({ name: 'alpha', title: 'Alpha Tool', description: 'widget stuff', source: 'community' }),
      beta: server({ name: 'beta', title: 'Beta', description: 'widget stuff', source: 'google' }),
    });
    const res = await fetch(`${baseUrl}/api/mcp-registry/search?q=widget&source=community`);
    const body = (await res.json()) as { servers: Array<{ name: string }>; total: number };
    expect(body.total).toBe(1);
    expect(body.servers.map((s) => s.name)).toEqual(['alpha']);
  });

  test('sorts by stars descending, nulls last', async () => {
    setRegistryCacheForTests({
      a: server({ name: 'a', stars: 5 }),
      b: server({ name: 'b', stars: null }),
      c: server({ name: 'c', stars: 50 }),
    });
    const res = await fetch(`${baseUrl}/api/mcp-registry/search?sort=stars`);
    const body = (await res.json()) as { servers: Array<{ name: string }> };
    expect(body.servers.map((s) => s.name)).toEqual(['c', 'a', 'b']);
  });

  test('paginates via limit/offset', async () => {
    setRegistryCacheForTests({ a: server({ name: 'a' }), b: server({ name: 'b' }), c: server({ name: 'c' }) });
    const res = await fetch(`${baseUrl}/api/mcp-registry/search?limit=1&offset=1`);
    const body = (await res.json()) as { servers: Array<{ name: string }>; total: number; offset: number; limit: number };
    expect(body.total).toBe(3);
    expect(body.servers.map((s) => s.name)).toEqual(['b']);
    expect(body.offset).toBe(1);
    expect(body.limit).toBe(1);
  });
});

describe('GET /api/mcp-registry/detail/:name', () => {
  test('200 with the full server record for a known name', async () => {
    setRegistryCacheForTests({ 'acme/widget': server({ name: 'acme/widget' }) });
    const res = await fetch(`${baseUrl}/api/mcp-registry/detail/acme/widget`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { server: { name: string } };
    expect(body.server.name).toBe('acme/widget');
  });

  test('404 for an unknown name', async () => {
    setRegistryCacheForTests({});
    const res = await fetch(`${baseUrl}/api/mcp-registry/detail/nope`);
    expect(res.status).toBe(404);
  });
});
