// engine/src/router/sync.test.ts -- ENG-6 gate: TS vitest port of
// backend/tests/test_router_sync_guards.py's assertions against the ported syncCustomProviders().
// Guards against the accidental-disconnect class in the 9Router mirror sync: the orphan sweep
// must never mass-reap managed nodes off an EMPTY provider list (a corrupt/defaulted settings
// load at boot hands it []), while a NON-empty list still reaps exactly the removed provider and
// never touches cp-openai (the Jul-3 "No credentials" regression).

import { describe, expect, it } from 'vitest';
import { NINE_ROUTER_CUSTOM_NAME_SUFFIX, NINE_ROUTER_OPENAI_KEYED_PREFIX, syncCustomProviders, type RouterHttpDeps } from './sync';

interface Node {
  id: string;
  prefix: string;
  name: string;
}

function managed(prefix: string): Node {
  return { id: `id-${prefix}`, prefix, name: `${prefix}${NINE_ROUTER_CUSTOM_NAME_SUFFIX}` };
}

class FakeResponse {
  constructor(
    public status: number,
    private payload: Record<string, unknown> = {},
  ) {}
  get ok(): boolean {
    return this.status < 300;
  }
  async json(): Promise<unknown> {
    return this.payload;
  }
  async text(): Promise<string> {
    return JSON.stringify(this.payload);
  }
}

interface Harness {
  nodes: Node[];
  calls: [string, string][];
}

function makeHarness(nodes: Node[]): Harness {
  return { nodes, calls: [] };
}

function deletes(h: Harness): string[] {
  return h.calls.filter(([m]) => m === 'DELETE').map(([, u]) => u);
}

function fakeFetch(h: Harness): RouterHttpDeps['fetch'] {
  return (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    h.calls.push([method, url]);
    if (method === 'GET' && url.endsWith('/provider-nodes')) return new FakeResponse(200, { nodes: h.nodes }) as unknown as Response;
    if (method === 'GET' && url.endsWith('/providers')) return new FakeResponse(200, { connections: [] }) as unknown as Response;
    if (method === 'POST' && url.endsWith('/provider-nodes')) return new FakeResponse(200, { node: { id: 'new-node-id' } }) as unknown as Response;
    return new FakeResponse(200, {}) as unknown as Response;
  }) as RouterHttpDeps['fetch'];
}

function makeDeps(nodes: Node[], overrides: Partial<RouterHttpDeps> = {}): { deps: RouterHttpDeps; harness: Harness } {
  const harness = makeHarness(nodes);
  const deps: RouterHttpDeps = {
    isRunning: async () => true,
    cliAuthHeaders: async () => ({}),
    fetch: fakeFetch(harness),
    ...overrides,
  };
  return { deps, harness };
}

describe('syncCustomProviders orphan-sweep guard', () => {
  it('never sweeps on an empty provider list -- every managed node must survive', async () => {
    const { deps, harness } = makeDeps([managed('cp-ollama'), managed('cp-together'), managed(NINE_ROUTER_OPENAI_KEYED_PREFIX)]);
    await syncCustomProviders([], deps);
    expect(deletes(harness)).toEqual([]);
  });

  it('a real one-provider list reaps only the genuinely removed node, keeps the kept one, and never touches cp-openai', async () => {
    const { deps, harness } = makeDeps([managed('cp-ollama'), managed('cp-together'), managed(NINE_ROUTER_OPENAI_KEYED_PREFIX)]);
    await syncCustomProviders([{ name: 'ollama', base_url: 'http://localhost:11434/v1', api_key: 'k' }], deps);
    const deletedIds = deletes(harness).map((u) => u.split('/').pop());
    expect(deletedIds).toEqual(['id-cp-together']);
    expect(deletedIds).not.toContain(`id-${NINE_ROUTER_OPENAI_KEYED_PREFIX}`);
  });

  it('a rotated key is PUT (not PATCH, which 9Router answers with 405) to the existing connection', async () => {
    const { deps, harness } = makeDeps([managed('cp-maestro')], {
      // find_keyed_connection short-circuits to an existing connection, same as the Python
      // harness's monkeypatch of sc.find_keyed_connection.
    });
    // Stub the connection-lookup path by pre-seeding the fake providers GET response instead of
    // monkeypatching a module function (TS's syncCustomProviders calls findKeyedConnection
    // internally, which itself calls deps.fetch -- point that at a connection record).
    const harnessWithConn = harness;
    const fetchWithConn: RouterHttpDeps['fetch'] = (async (input, init) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      harnessWithConn.calls.push([method, url]);
      if (method === 'GET' && url.endsWith('/provider-nodes')) return new FakeResponse(200, { nodes: harnessWithConn.nodes }) as unknown as Response;
      if (method === 'GET' && url.endsWith('/providers')) return new FakeResponse(200, { connections: [{ id: 'conn-1', provider: 'id-cp-maestro', authType: 'apikey', name: `Maestro${NINE_ROUTER_CUSTOM_NAME_SUFFIX}` }] }) as unknown as Response;
      return new FakeResponse(200, {}) as unknown as Response;
    }) as RouterHttpDeps['fetch'];
    deps.fetch = fetchWithConn;
    await syncCustomProviders([{ name: 'Maestro', base_url: 'https://llm.martinstech.net/v1', api_key: 'rotated-key' }], deps);
    expect(harness.calls.some(([m]) => m === 'PATCH')).toBe(false); // PATCH is 405 on this endpoint
    expect(harness.calls.some(([m, u]) => m === 'PUT' && u.endsWith('/providers/conn-1'))).toBe(true);
  });

  it('adopts a prefix already held by an older build instead of creating a rival node', async () => {
    const stale: Node = { id: 'id-stale', prefix: 'cp-maestro', name: 'maestro (OpenSwarm-managed)' };
    const { deps, harness } = makeDeps([stale]);
    await syncCustomProviders([{ name: 'Maestro', base_url: 'https://llm.martinstech.net/v1', api_key: 'k' }], deps);
    const posts = harness.calls.filter(([m, u]) => m === 'POST' && u.endsWith('/provider-nodes'));
    expect(posts).toEqual([]); // adopt the node already holding the prefix instead of creating a second one
    expect(harness.calls.some(([m, u]) => m === 'PUT' && u.endsWith('/provider-nodes/id-stale'))).toBe(true);
  });

  it('removes a duplicate node left behind on the same prefix', async () => {
    const stale: Node = { id: 'id-stale', prefix: 'cp-maestro', name: 'maestro (OpenSwarm-managed)' };
    const { deps, harness } = makeDeps([managed('cp-maestro'), stale]);
    await syncCustomProviders([{ name: 'Maestro', base_url: 'https://llm.martinstech.net/v1', api_key: 'k' }], deps);
    const deleted = deletes(harness).map((u) => u.split('/').pop());
    expect(deleted).toContain('id-stale'); // the rival on the same prefix must go
    expect(deleted).not.toContain('id-cp-maestro'); // our own node must survive
  });
});
