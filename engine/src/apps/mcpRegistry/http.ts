// engine/src/apps/mcpRegistry/http.ts -- SUB-4, native HTTP handler for the /api/mcp-registry
// surface (backend/apps/mcp_registry/mcp_registry.py's FastAPI router), wired into server.ts the
// same way settings/handler.ts, apps/health/health.ts, and apps/skills/http.ts already are.
//
// Route-table NAME is the hyphenated "mcp-registry" (matching the actual /api/mcp-registry URL
// prefix Python's SubApp("mcp-registry", ...) produces), same convention SUB-2 established for
// skill-registry -- MAESTRO_ENGINE_ROUTES=mcp-registry:native.

import type { FastifyReply, FastifyRequest } from 'fastify';
import { registryCache, registryCacheUpdatedAt, type RegistryServer } from './registry';

function queryParam(request: FastifyRequest, name: string): string | undefined {
  const q = request.query as Record<string, unknown> | undefined;
  const v = q?.[name];
  return typeof v === 'string' ? v : undefined;
}

function queryInt(request: FastifyRequest, name: string, def: number): number {
  const raw = queryParam(request, name);
  if (raw === undefined) return def;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : def;
}

interface SearchSummary {
  name: string;
  title: string;
  description: string;
  version: string;
  remoteUrl: string;
  remoteType: string;
  repositoryUrl: string;
  websiteUrl: string;
  iconUrl: string;
  stars: number | null;
  source: string;
}

function toSummary(s: RegistryServer): SearchSummary {
  return {
    name: s.name,
    title: s.title,
    description: s.description,
    version: s.version,
    remoteUrl: s.remoteUrl,
    remoteType: s.remoteType,
    repositoryUrl: s.repositoryUrl,
    websiteUrl: s.websiteUrl,
    iconUrl: s.iconUrl,
    stars: s.stars,
    source: s.source,
  };
}

export async function handleMcpRegistryHttpRequest(pathname: string, request: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  if (!pathname.startsWith('/api/mcp-registry')) return false;
  const sub = pathname.slice('/api/mcp-registry'.length);
  const method = request.method.toUpperCase();

  if (sub === '/stats' && method === 'GET') {
    const all = Object.values(registryCache());
    const google = all.filter((s) => s.source === 'google').length;
    const community = all.filter((s) => s.source === 'community').length;
    reply.code(200).send({ total: all.length, google, community, lastUpdated: registryCacheUpdatedAt() });
    return true;
  }

  if (sub === '/search' && method === 'GET') {
    let pool = Object.values(registryCache());
    const source = queryParam(request, 'source');
    if (source) pool = pool.filter((s) => s.source === source);

    const q = (queryParam(request, 'q') ?? '').toLowerCase().trim();
    let results = pool;
    if (q) {
      results = pool.filter((s) => {
        const searchable = `${s.name} ${s.title} ${s.description} ${(s.keywords ?? []).join(' ')}`.toLowerCase();
        return searchable.includes(q);
      });
    }

    const sort = queryParam(request, 'sort') ?? 'name';
    if (sort === 'stars') {
      results = [...results].sort((a, b) => {
        const aNone = a.stars === null || a.stars === undefined;
        const bNone = b.stars === null || b.stars === undefined;
        if (aNone !== bNone) return aNone ? 1 : -1;
        const byStars = (b.stars ?? 0) - (a.stars ?? 0);
        return byStars !== 0 ? byStars : a.name.localeCompare(b.name);
      });
    } else {
      results = [...results].sort((a, b) => a.name.localeCompare(b.name));
    }

    const limit = Math.min(Math.max(queryInt(request, 'limit', 20), 1), 100);
    const offset = Math.max(queryInt(request, 'offset', 0), 0);
    const total = results.length;
    const page = results.slice(offset, offset + limit);

    reply.code(200).send({ servers: page.map(toSummary), total, offset, limit });
    return true;
  }

  const detailMatch = /^\/detail\/(.+)$/.exec(sub);
  if (detailMatch && method === 'GET') {
    const serverName = decodeURIComponent(detailMatch[1]);
    const srv = registryCache()[serverName];
    if (!srv) {
      reply.code(404).send({ error: 'Server not found' });
      return true;
    }
    reply.code(200).send({ server: srv });
    return true;
  }

  return false;
}
