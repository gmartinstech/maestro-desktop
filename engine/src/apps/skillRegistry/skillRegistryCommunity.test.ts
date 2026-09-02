// engine/src/apps/skillRegistry/skillRegistryCommunity.test.ts -- SUB-2's vitest twin of
// backend/tests/test_skill_registry_community.py (the parts not already covered by
// skillRegistryGithub.test.ts's pure-logic tests): the secret-scan wiring, safe-install
// (write_folder_skill) behavior, and the curated/community resolve + end-to-end HTTP install/
// update flows -- faking engineFetch (this project's one sanctioned network chokepoint, see
// net/http.ts) the same way engine/src/router/sync.test.ts fakes its own HTTP deps, rather than a
// live GitHub call. Module-namespace spying (`vi.spyOn(ns, 'fn')`) works the same way engine/src/
// apps/service/telemetryClient.test.ts already proves it does for engineFetch: a plain named
// import (`import { fn } from './mod'`) compiles under this project's CommonJS target to a
// property access on the shared, cached module.exports object at every call site, so reassigning
// that property from a `import * as ns from './mod'` reference in a test is visible to the
// production code's own calls too.

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import * as http from '../../net/http';
import { resolveAttachedSkills } from '../../agents/manager/prompt/promptContext';
import { findSecretsInFiles } from './secretScan';
import { loadIndex, pruneOrphanIndex, resetSkillsDirForTests, setSkillsDirForTests, skillExists, syncSkills, uniqueSkillSlug, writeFolderSkill } from '../skills/skills';
import { handleSkillsHttpRequest } from '../skills/http';
import { handleSkillRegistryHttpRequest } from './http';
import * as skillRegistrySources from './skillRegistrySources';
import { RegistryRateLimited } from './skillRegistryGithub';
import { resetSkillRegistryStateForTests, setCacheForTests } from './skillRegistry';
import { treeBlobPaths, type GithubTreeEntry } from './skillRegistryGithub';

class FakeResponse {
  constructor(
    public status: number,
    private jsonPayload: unknown = {},
    private textPayload?: string,
  ) {}
  get ok(): boolean {
    return this.status < 300;
  }
  async json(): Promise<unknown> {
    return this.jsonPayload;
  }
  async text(): Promise<string> {
    return this.textPayload ?? JSON.stringify(this.jsonPayload);
  }
}

function urlOf(input: string | URL | Request): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
}

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'maestro-engine-skillregistry-community-test-'));
  setSkillsDirForTests(dir);
});

afterEach(() => {
  resetSkillsDirForTests();
  resetSkillRegistryStateForTests();
  skillRegistrySources.setCuratedTreeForTests([]);
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('install disclosure secret scan', () => {
  test('flags a community skill shipping credentials, leaves clean files alone', () => {
    // The scan wired into the install disclosure (skillRegistrySources.ts's buildResolvedSkill)
    // must flag a community skill shipping credentials, and leave clean files alone.
    const files = {
      'SKILL.md': Buffer.from('Renders PDFs. No secrets.'),
      'config.py': Buffer.from('API_KEY = "sk-ant-api03-AAAABBBBCCCCDDDDEEEEFFFFGGGGHHHH"'),
    };
    const hits = findSecretsInFiles(files);
    expect(hits).toContain('config.py');
    expect(hits).not.toContain('SKILL.md');
  });
});

describe('write_folder_skill safe install', () => {
  test('lands files and indexes', () => {
    const skill = writeFolderSkill(
      'PDF Tk',
      { 'SKILL.md': '---\nname: PDF Tk\n---\nbody', 'scripts/run.sh': 'echo hi' },
      { name: 'PDF Tk', description: 'fill forms' },
    );
    expect(skill.id).toBe('pdf-tk');
    expect(skill.has_supporting_files).toBe(true);
    expect(existsSync(join(dir, 'pdf-tk', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(dir, 'pdf-tk', 'scripts', 'run.sh'))).toBe(true);
    expect(syncSkills().some((s) => s.id === 'pdf-tk')).toBe(true);
  });

  test('a registry install dedups instead of clobbering an existing local skill', () => {
    writeFolderSkill('pdf', { 'SKILL.md': 'MINE' }, { name: 'My PDF' });
    const slug = uniqueSkillSlug('pdf');
    expect(slug).toBe('pdf-2');
    writeFolderSkill(slug, { 'SKILL.md': 'THEIRS' }, { name: 'Registry PDF' });
    expect(readFileSync(join(dir, 'pdf', 'SKILL.md'), 'utf8')).toBe('MINE');
    expect(readFileSync(join(dir, 'pdf-2', 'SKILL.md'), 'utf8')).toBe('THEIRS');
    const ids = new Set(syncSkills().map((s) => s.id));
    expect(ids.has('pdf')).toBe(true);
    expect(ids.has('pdf-2')).toBe(true);
  });

  test('blocks path traversal', () => {
    writeFolderSkill('evil', { 'SKILL.md': 'x', '../escape.txt': 'pwned', '/etc/abs.txt': 'pwned' }, { name: 'evil' });
    expect(existsSync(join(dir, '..', 'escape.txt'))).toBe(false);
    expect(existsSync(join(dir, 'evil', 'SKILL.md'))).toBe(true);
  });
});

const CURATED_TREE: GithubTreeEntry[] = [
  { type: 'tree', path: 'skills/pdf', sha: 'PDFSHA1' },
  { type: 'blob', path: 'skills/pdf/SKILL.md' },
  { type: 'blob', path: 'skills/pdf/scripts/extract.py' },
  { type: 'tree', path: 'skills/pdf/scripts', sha: 'SCRIPTSHA' },
  { type: 'blob', path: 'skills/pdf/reference/notes.md' },
  { type: 'blob', path: 'skills/pdf-extra/SKILL.md' },
  { type: 'blob', path: 'skills/other/SKILL.md' },
];

describe('resolveCuratedSkill', () => {
  test('fetches the exact folder only, cold cache pays one live tree call', async () => {
    // Curated install must pull the WHOLE skill folder (so scripts/assets land), matched by EXACT
    // path: a sibling folder sharing a name prefix (skills/pdf vs skills/pdf-extra) must not leak
    // in. Here the cache is COLD.
    skillRegistrySources.setCuratedTreeForTests([]);
    let treeCalls = 0;
    vi.spyOn(http, 'engineFetch').mockImplementation(async (input) => {
      const url = urlOf(input);
      if (url.includes('git/trees')) {
        treeCalls += 1;
        return new FakeResponse(200, { tree: CURATED_TREE }) as unknown as Response;
      }
      const rel = url.split('/main/', 2)[1];
      return rel && rel.startsWith('skills/pdf/')
        ? (new FakeResponse(200, undefined, `content:${rel}`) as unknown as Response)
        : (new FakeResponse(404) as unknown as Response);
    });

    const resolved = await skillRegistrySources.resolveCuratedSkill('skills/pdf');
    expect(new Set(Object.keys(resolved.files))).toEqual(new Set(['SKILL.md', 'scripts/extract.py', 'reference/notes.md']));
    expect(resolved.scripts).toEqual(['scripts/extract.py']);
    expect(resolved.skill_id).toBe('pdf');
    expect(treeCalls).toBe(1);
  });

  test('uses the warm cache with ZERO trees-API calls, and records provenance', async () => {
    skillRegistrySources.setCuratedTreeForTests(CURATED_TREE);
    vi.spyOn(http, 'engineFetch').mockImplementation(async (input) => {
      const url = urlOf(input);
      if (url.includes('git/trees') || url.includes('api.github.com')) {
        throw new Error(`warm cache must not hit the API: ${url}`);
      }
      const rel = url.split('/main/', 2)[1];
      return rel && rel.startsWith('skills/pdf/')
        ? (new FakeResponse(200, undefined, `content:${rel}`) as unknown as Response)
        : (new FakeResponse(404) as unknown as Response);
    });

    const resolved = await skillRegistrySources.resolveCuratedSkill('skills/pdf');
    expect(new Set(Object.keys(resolved.files))).toEqual(new Set(['SKILL.md', 'scripts/extract.py', 'reference/notes.md']));
    expect(resolved.source).toBe('anthropics/skills');
    expect(resolved.folder).toBe('skills/pdf');
    expect(resolved.version).toBe('PDFSHA1');
  });
});

describe('warmCuratedTree', () => {
  test('populates the cache', async () => {
    skillRegistrySources.setCuratedTreeForTests([]);
    vi.spyOn(http, 'engineFetch').mockImplementation(async (input) => {
      const url = urlOf(input);
      expect(url).toContain('git/trees');
      return new FakeResponse(200, { tree: CURATED_TREE }) as unknown as Response;
    });
    await skillRegistrySources.warmCuratedTree();
    expect(treeBlobPaths(skillRegistrySources.curatedTree())).toContain('skills/pdf/SKILL.md');
  });
});

describe('HTTP-level: install / install-curated / update', () => {
  let fastify: FastifyInstance;
  let baseUrl: string;

  beforeAll(async () => {
    fastify = Fastify({ logger: false });
    fastify.removeAllContentTypeParsers();
    fastify.addContentTypeParser('*', { parseAs: 'buffer' }, (_req, payload, done) => done(null, payload));
    fastify.all('*', async (request, reply) => {
      const pathname = (request.raw.url ?? '/').split('?')[0];
      if (await handleSkillRegistryHttpRequest(pathname, request, reply)) return;
      if (await handleSkillsHttpRequest(pathname, request, reply)) return;
      reply.code(404).send({ error: 'unhandled_by_this_test_server' });
    });
    baseUrl = await fastify.listen({ port: 0, host: '127.0.0.1' });
  });

  afterAll(async () => {
    await fastify.close();
  });

  async function postJson(path: string, body: unknown): Promise<Response> {
    return fetch(`${baseUrl}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  }

  test('confirm=true install writes the folder, lists it, and it is injectable', async () => {
    vi.spyOn(skillRegistrySources, 'resolveCommunitySkill').mockResolvedValue({
      name: 'PDF Tools',
      description: 'work with pdfs',
      repo_url: 'https://github.com/o/r',
      skill_id: 'pdf-tools',
      files: { 'SKILL.md': '# PDF Tools\nRun scripts/extract.py to pull text.', 'scripts/extract.py': "print('extract')" },
      scripts: ['scripts/extract.py'],
      secret_findings: [],
      source: '',
      folder: '',
      version: '',
    });

    const r = await postJson('/api/skill-registry/install', { source: 'o/r', skill_id: 'pdf-tools', confirm: true });
    expect(r.status).toBe(200);
    const rBody = (await r.json()) as { installed: boolean; skill: { id: string } };
    expect(rBody.installed).toBe(true);
    const slug = rBody.skill.id;

    const listed = (await (await fetch(`${baseUrl}/api/skills/list`)).json()) as { skills: Array<{ id: string; has_supporting_files: boolean }> };
    const entry = listed.skills.find((s) => s.id === slug);
    expect(entry?.has_supporting_files).toBe(true);
    expect(existsSync(join(dir, slug, 'SKILL.md'))).toBe(true);
    expect(existsSync(join(dir, slug, 'scripts', 'extract.py'))).toBe(true);

    const block = resolveAttachedSkills([{ id: slug, name: 'PDF Tools', content: '# PDF Tools\nRun scripts/extract.py to pull text.' }]);
    expect(block).toContain('[Using skill: PDF Tools]');
    expect(block).toContain(join(dir, slug));
  });

  test('curated install writes the full folder', async () => {
    vi.spyOn(skillRegistrySources, 'resolveCuratedSkill').mockResolvedValue({
      name: 'PDF',
      description: 'work with pdfs',
      repo_url: 'https://github.com/anthropics/skills/tree/main/skills/pdf',
      skill_id: 'pdf',
      files: { 'SKILL.md': '# PDF\nRun scripts/extract.py', 'scripts/extract.py': "print('x')" },
      scripts: ['scripts/extract.py'],
      secret_findings: [],
      source: '',
      folder: '',
      version: '',
    });

    const r = await postJson('/api/skill-registry/install-curated', { folder: 'skills/pdf' });
    expect(r.status).toBe(200);
    const body = (await r.json()) as { installed: boolean; skill: { id: string } };
    expect(body.installed).toBe(true);
    const slug = body.skill.id;
    expect(existsSync(join(dir, slug, 'SKILL.md'))).toBe(true);
    expect(existsSync(join(dir, slug, 'scripts', 'extract.py'))).toBe(true);
    const listed = (await (await fetch(`${baseUrl}/api/skills/list`)).json()) as { skills: Array<{ id: string; has_supporting_files: boolean }> };
    expect(listed.skills.find((s) => s.id === slug)?.has_supporting_files).toBe(true);
  });

  test('curated install falls back to the cached SKILL.md when GitHub is unreachable', async () => {
    vi.spyOn(skillRegistrySources, 'resolveCuratedSkill').mockRejectedValue(new RegistryRateLimited());
    setCacheForTests({ PDF: { name: 'PDF', description: 'work with pdfs', content: 'Do PDF things.', folder: 'skills/pdf', category: '', repositoryUrl: '' } });

    const r = await postJson('/api/skill-registry/install-curated', { folder: 'skills/pdf' });
    expect(r.status).toBe(200);
    const body = (await r.json()) as { installed: boolean; files: string[]; scripts: string[]; skill: { id: string } };
    expect(body.installed).toBe(true);
    expect(body.files).toEqual(['SKILL.md']);
    expect(body.scripts).toEqual([]);
    const md = readFileSync(join(dir, body.skill.id, 'SKILL.md'), 'utf8');
    expect(md).toContain('Do PDF things.');
    expect(md).toContain('name: PDF');
  });

  test('curated install with no cache and no network errors honestly (502)', async () => {
    vi.spyOn(skillRegistrySources, 'resolveCuratedSkill').mockRejectedValue(new Error('connection refused'));
    setCacheForTests({});
    const r = await postJson('/api/skill-registry/install-curated', { folder: 'skills/pdf' });
    expect(r.status).toBe(502);
  });

  test('update detection and apply: stale version reads as outdated, then updates', async () => {
    skillRegistrySources.setCuratedTreeForTests(CURATED_TREE);
    writeFolderSkill('pdf', { 'SKILL.md': 'old' }, { name: 'PDF', source: 'anthropics/skills', folder: 'skills/pdf', version: 'OLDSHA' });

    const upd1 = await fetch(`${baseUrl}/api/skill-registry/updates`);
    expect(upd1.status).toBe(200);
    const upd1Body = (await upd1.json()) as { outdated: string[] };
    expect(upd1Body.outdated).toContain('pdf');

    vi.spyOn(skillRegistrySources, 'resolveCuratedSkill').mockResolvedValue({
      name: 'PDF',
      description: 'pdfs',
      repo_url: '',
      skill_id: 'pdf',
      files: { 'SKILL.md': 'new', 'scripts/x.py': 'print(1)' },
      scripts: ['scripts/x.py'],
      secret_findings: [],
      source: 'anthropics/skills',
      folder: 'skills/pdf',
      version: 'PDFSHA1',
    });

    const u = await postJson('/api/skill-registry/update', { skill_id: 'pdf' });
    expect(u.status).toBe(200);
    expect(((await u.json()) as { updated: boolean }).updated).toBe(true);
    expect(existsSync(join(dir, 'pdf', 'scripts', 'x.py'))).toBe(true);

    const upd2 = await fetch(`${baseUrl}/api/skill-registry/updates`);
    const upd2Body = (await upd2.json()) as { outdated: string[]; checked: string[] };
    expect(upd2Body.outdated).not.toContain('pdf');
    expect(upd2Body.checked).toContain('pdf');
  });
});

describe('manual out-of-band deletion does not leave a ghost blocking a slug', () => {
  test('the slug becomes reclaimable after a prune', () => {
    writeFolderSkill('pdf', { 'SKILL.md': 'x' }, { name: 'PDF' });
    rmSync(join(dir, 'pdf'), { recursive: true, force: true }); // delete the folder, leave the index entry
    expect(skillExists('pdf')).toBe(false);
    expect(uniqueSkillSlug('pdf')).toBe('pdf');
    expect('pdf' in loadIndex()).toBe(true);
    pruneOrphanIndex();
    expect('pdf' in loadIndex()).toBe(false);
  });
});
