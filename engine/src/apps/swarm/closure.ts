// engine/src/apps/swarm/closure.ts -- SUB-3, a full TypeScript port of
// backend/apps/swarm/closure.py.
//
// Export = walk the dependency closure from a root, scrub, pack. Import = stage into a sandbox,
// topo-sort leaves-first, assign fresh local ids, rewrite cross refs through a RemapTable. The
// single-skill staging path lets a bare .md or a zip-of-SKILL.md come in through the same commit
// machinery as a full .swarm.
//
// Every I/O-touching step here is async (unpack/pack/entry reads all go through jszip's Promise
// API -- see ziputil.ts's header), unlike the synchronous Python original; callers (swarm.ts's
// HTTP handlers) already run inside an async request handler, so this is a mechanical, not
// behavioral, difference.

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import JSZip from 'jszip';
import { RemapTable, type ExportContext } from './exportable';
import {
  FORMAT_VERSION,
  EntityType,
  type BundlePreview,
  type BundleSummary,
  type DependencyEdge,
  type EntityRef,
  type IncludeItem,
  type Manifest,
  type Requirement,
  type RequirementView,
  type ReviewSummary,
} from './models';
import { scrubPayload } from './redact';
import { getExportable, IMPORT_ORDER } from './registry';
import { scanAppFiles } from './scanAppFiles';
import {
  BundleError,
  MANIFEST_NAME,
  hasMember,
  isZip,
  pack,
  readManifest,
  unpack,
  verifyChecksum,
} from './ziputil';

function pNow(): string {
  return new Date().toISOString();
}

function pCreatedWith(): string {
  return process.env.MAESTRO_VERSION || 'Maestro';
}

class PCtx implements ExportContext {
  constructor(private readonly localToBundle: ReadonlyMap<string, string>) {}

  bundleIdFor(etype: EntityType, localId: string): string | null {
    return this.localToBundle.get(`${etype} ${localId}`) ?? null;
  }
}

// ---------- export ----------

interface AssembleResult {
  manifest: Manifest;
  payloads: Record<string, Record<string, unknown>>;
  files: Record<string, Buffer>;
}

export async function pAssemble(rootType: EntityType, rootId: string): Promise<AssembleResult> {
  const rootCls = getExportable(rootType);
  if (rootCls === null) throw new BundleError(`can't share a ${rootType} yet`);
  const root = rootCls.load(rootId);
  if (root === null) throw new BundleError('nothing found to share');

  type Loaded = NonNullable<ReturnType<typeof rootCls.load>>;
  type Key = string; // `${type} ${localId}`
  const keyOf = (t: EntityType, id: string): Key => `${t} ${id}`;
  const nodes = new Map<Key, { type: EntityType; localId: string; inst: Loaded }>();
  const order: Key[] = [];
  const queue: Array<{ type: EntityType; localId: string; inst: Loaded }> = [
    { type: rootType, localId: rootId, inst: root },
  ];
  while (queue.length > 0) {
    const { type: etype, localId: lid, inst } = queue.shift()!;
    const key = keyOf(etype, lid);
    if (nodes.has(key)) continue;
    nodes.set(key, { type: etype, localId: lid, inst });
    order.push(key);
    for (const dep of inst.dependencies()) {
      const dkey = keyOf(dep.type, dep.local_id);
      if (nodes.has(dkey)) continue;
      const dcls = getExportable(dep.type);
      if (dcls === null) throw new BundleError(`can't bundle a dependency of type ${dep.type} yet`);
      const dinst = dcls.load(dep.local_id);
      if (dinst !== null) queue.push({ type: dep.type, localId: dep.local_id, inst: dinst });
    }
  }

  const localToBundle = new Map<string, string>();
  for (const key of order) localToBundle.set(key, randomUUID().replace(/-/g, ''));
  const ctx = new PCtx(localToBundle);
  const payloads: Record<string, Record<string, unknown>> = {};
  const files: Record<string, Buffer> = {};
  const entities: EntityRef[] = [];
  const edges: DependencyEdge[] = [];
  let requirements: Requirement[] = [];
  const counts: Record<string, number> = {};

  for (const key of order) {
    const node = nodes.get(key)!;
    const { type: etype, inst } = node;
    const bid = localToBundle.get(key)!;
    payloads[bid] = scrubPayload(inst.serialize(ctx)) as Record<string, unknown>;
    for (const [rel, data] of Object.entries(inst.files())) {
      files[`entities/${bid}/files/${rel}`] = data;
    }
    entities.push({ type: etype, bundle_id: bid, name: inst.name, path: `entities/${bid}` });
    counts[etype] = (counts[etype] ?? 0) + 1;
    for (const dep of inst.dependencies()) {
      const dkey = keyOf(dep.type, dep.local_id);
      const dbid = localToBundle.get(dkey);
      if (dbid) edges.push({ from: bid, to: dbid, relation: dep.relation });
    }
    requirements.push(...inst.requirements());
  }

  requirements = pDedupeRequirements(requirements);
  const rootBid = localToBundle.get(keyOf(rootType, rootId))!;
  const manifest: Manifest = {
    format_version: FORMAT_VERSION,
    created_with: pCreatedWith(),
    created_at: pNow(),
    bundle_id: randomUUID().replace(/-/g, ''),
    checksum: null,
    root: { type: rootType, bundle_id: rootBid, name: root.name, path: `entities/${rootBid}` },
    entities,
    edges,
    requirements,
    preview: {
      root_type: rootType,
      root_name: root.name,
      counts,
      requirement_summary: requirements.map((r) => r.label),
    },
  };
  return { manifest, payloads, files };
}

export async function buildManifest(rootType: EntityType, rootId: string): Promise<Manifest> {
  return (await pAssemble(rootType, rootId)).manifest;
}

export async function buildBundle(rootType: EntityType, rootId: string): Promise<{ raw: Buffer; rootName: string }> {
  const { manifest, payloads, files } = await pAssemble(rootType, rootId);
  const raw = await pack(manifest as unknown as Record<string, unknown>, payloads, files);
  return { raw, rootName: manifest.root.name };
}

function pDedupeRequirements(reqs: Requirement[]): Requirement[] {
  const out = new Map<string, Requirement>();
  for (const r of reqs) {
    const k = `${r.kind} ${r.key}`;
    const existing = out.get(k);
    if (existing) {
      for (const ref of r.referenced_by) {
        if (!existing.referenced_by.includes(ref)) existing.referenced_by.push(ref);
      }
    } else {
      out.set(k, { ...r, referenced_by: [...r.referenced_by] });
    }
  }
  return [...out.values()];
}

// ---------- summary (shared by export + import preflight) ----------

export function summarize(manifest: Manifest): BundleSummary {
  const includes: IncludeItem[] = manifest.entities
    .filter((e) => e.bundle_id !== manifest.root.bundle_id)
    .map((e) => ({ type: e.type, name: e.name, detail: '' }));
  const reqs: RequirementView[] = manifest.requirements.map((r) => ({ kind: r.kind, key: r.key, label: r.label, detail: r.detail }));
  return {
    root: { type: manifest.root.type, name: manifest.root.name, detail: '' },
    includes,
    requirements: reqs,
    counts: manifest.preview.counts,
  };
}

export function swarmFilename(name: string): string {
  const keep = [...(name || 'bundle')].filter((c) => /[A-Za-z0-9]/.test(c) || c === ' ' || c === '-' || c === '_').join('').trim();
  const slug = (keep.replace(/ /g, '-').toLowerCase() || 'bundle');
  return `${slug}.swarm`;
}

// ---------- import: staging ----------

const ENTITY_TYPES: ReadonlySet<string> = new Set(Object.values(EntityType));

function isEntityRefShaped(v: unknown): v is EntityRef {
  if (v === null || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return typeof r.type === 'string' && ENTITY_TYPES.has(r.type)
    && typeof r.bundle_id === 'string' && typeof r.name === 'string' && typeof r.path === 'string';
}

/** Parses an untyped JSON blob into a Manifest, throwing BundleError on anything structurally
 * wrong -- TypeScript interfaces are erased at runtime (unlike the Python original's pydantic
 * `Manifest(**raw_manifest)`, which performs real field/type validation and raises on a
 * missing/malformed field), so this function is what actually stands in for that validation here.
 * Deliberately not exhaustive against every nested field (e.g. `preview.counts`'s value types
 * aren't checked) -- it covers every field validateManifest() and closure.ts's own callers
 * (topo-sort, requirement lookups, path safety) dereference, which is what "invalid" needs to mean
 * for this bundle to be safely rejected rather than crash deeper in with a confusing error. */
export function parseManifest(raw: Record<string, unknown>): Manifest {
  const fail = (): never => {
    throw new BundleError('bundle manifest is invalid');
  };
  if (typeof raw.format_version !== 'number') fail();
  if (typeof raw.bundle_id !== 'string') fail();
  if (!isEntityRefShaped(raw.root)) fail();
  if (!Array.isArray(raw.entities) || !raw.entities.every(isEntityRefShaped)) fail();
  const edges = raw.edges;
  if (!Array.isArray(edges) || !edges.every((e) => e !== null && typeof e === 'object' && typeof (e as Record<string, unknown>).from === 'string' && typeof (e as Record<string, unknown>).to === 'string')) {
    fail();
  }
  const requirements = raw.requirements;
  if (requirements !== undefined && (!Array.isArray(requirements) || !requirements.every((r) => r !== null && typeof r === 'object' && typeof (r as Record<string, unknown>).kind === 'string' && typeof (r as Record<string, unknown>).key === 'string'))) {
    fail();
  }
  if (raw.preview === null || typeof raw.preview !== 'object') fail();
  return {
    format_version: raw.format_version as number,
    created_with: typeof raw.created_with === 'string' ? raw.created_with : 'Maestro',
    created_at: typeof raw.created_at === 'string' ? raw.created_at : '',
    bundle_id: raw.bundle_id as string,
    checksum: typeof raw.checksum === 'string' ? raw.checksum : null,
    root: raw.root as EntityRef,
    entities: raw.entities as EntityRef[],
    edges: (edges as Array<{ from: string; to: string; relation?: string }>).map((e) => ({ from: e.from, to: e.to, relation: e.relation ?? '' })),
    requirements: ((requirements as Array<Record<string, unknown>> | undefined) ?? []).map((r) => ({
      kind: r.kind as Requirement['kind'],
      key: r.key as string,
      label: typeof r.label === 'string' ? r.label : String(r.key),
      detail: typeof r.detail === 'string' ? r.detail : '',
      referenced_by: Array.isArray(r.referenced_by) ? (r.referenced_by as string[]) : [],
      proposal: (r.proposal as Record<string, unknown> | undefined) ?? {},
    })),
    preview: raw.preview as BundlePreview,
  };
}

/** Structural integrity of the untrusted part of a .swarm. The checksum covers entity payloads +
 * files but NOT the manifest itself, so an attacker can rewrite root/edges/paths freely; catch the
 * breakages that would import silently wrong. */
export function validateManifest(manifest: Manifest): void {
  const seen = new Set<string>();
  for (const e of manifest.entities) {
    if (seen.has(e.bundle_id)) throw new BundleError('bundle manifest has duplicate entity ids');
    seen.add(e.bundle_id);
    if (!e.path.startsWith('entities/') || e.path.split('/').includes('..')) {
      throw new BundleError('bundle manifest has an out-of-tree entity path');
    }
  }
  if (!seen.has(manifest.root.bundle_id)) {
    throw new BundleError('bundle manifest root is not one of its entities');
  }
  for (const edge of manifest.edges) {
    if (!seen.has(edge.from) || !seen.has(edge.to)) {
      throw new BundleError('bundle manifest has an edge to an unknown entity');
    }
  }
}

export interface StagedBundle {
  sandbox: string;
  manifest: Manifest;
  warnings: string[];
}

export async function stageUpload(raw: Buffer, filename: string): Promise<StagedBundle> {
  const warnings: string[] = [];
  if (await isZip(raw)) {
    if (await hasMember(raw, MANIFEST_NAME)) {
      const sandbox = await unpack(raw);
      let manifest: Manifest;
      try {
        const rawManifest = readManifest(sandbox);
        verifyChecksum(sandbox, rawManifest);
        manifest = parseManifest(rawManifest);
        validateManifest(manifest);
      } catch (e) {
        rmSync(sandbox, { recursive: true, force: true });
        if (e instanceof BundleError) throw e;
        throw new BundleError('bundle manifest is invalid');
      }
      if (manifest.format_version > FORMAT_VERSION) {
        rmSync(sandbox, { recursive: true, force: true });
        throw new BundleError('this .swarm was made by a newer Maestro; please update');
      }
      return { sandbox, manifest, warnings };
    }
    return stageSkillFromZip(raw, filename, warnings);
  }
  return pStageSkillFromMarkdown(raw, filename, warnings);
}

function pNameFromFilename(filename: string): string {
  const base = basename(filename || 'skill', extname(filename || 'skill'));
  const title = base.replace(/-/g, ' ').replace(/_/g, ' ').trim();
  if (!title) return 'Imported Skill';
  return title.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

async function pStageSkillFromMarkdown(raw: Buffer, filename: string, warnings: string[]): Promise<StagedBundle> {
  let content: string;
  try {
    // Buffer.toString('utf8') is lossy-permissive (silently substitutes U+FFFD for an invalid
    // byte sequence rather than throwing) -- TextDecoder with `fatal: true` is Node/web-standard's
    // actual strict decoder, matching Python's raw.decode("utf-8") throwing UnicodeDecodeError on
    // a truly binary blob.
    content = new TextDecoder('utf-8', { fatal: true }).decode(raw);
  } catch {
    throw new BundleError('unrecognized file; expected a .swarm or a .md skill');
  }
  return pSynthSingleSkill(content, pNameFromFilename(filename), warnings);
}

async function stageSkillFromZip(raw: Buffer, filename: string, warnings: string[]): Promise<StagedBundle> {
  const zip = await JSZip.loadAsync(raw);
  const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
  const mds = names.filter((n) => n.toLowerCase().endsWith('.md'));
  let target = mds.find((n) => basename(n).toLowerCase() === 'skill.md');
  if (!target && mds.length > 0) target = mds[0];
  if (!target) throw new BundleError('zip has no SKILL.md');
  const content = (await zip.file(target)!.async('nodebuffer')).toString('utf8');
  // Carry supporting files (scripts, templates) through as a folder skill, keyed relative to the
  // SKILL.md's directory so a nested layout flattens onto the skill folder. Cap count + per-file
  // size so a hostile zip can't balloon the install.
  const baseDir = target.includes('/') ? `${target.slice(0, target.lastIndexOf('/'))}/` : '';
  const extraFiles: Record<string, Buffer> = {};
  for (const n of names) {
    if (n === target) continue;
    const rel = baseDir && n.startsWith(baseDir) ? n.slice(baseDir.length) : basename(n);
    if (!rel || rel.startsWith('.')) continue;
    const fileObj = zip.file(n);
    if (!fileObj) continue;
    const data = await fileObj.async('nodebuffer');
    if (data.length > 2_000_000 || Object.keys(extraFiles).length >= 50) {
      warnings.push('some oversized/extra supporting files were skipped');
      continue;
    }
    extraFiles[rel] = data;
  }
  return pSynthSingleSkill(content, pNameFromFilename(filename), warnings, extraFiles);
}

function pSafeJoin(sandbox: string, rel: string): string {
  const dest = resolve(join(sandbox, rel));
  const root = resolve(sandbox);
  if (dest !== root && !dest.startsWith(root + sep)) {
    throw new BundleError('bundle manifest references a path outside the bundle');
  }
  return dest;
}

function pSynthSingleSkill(content: string, name: string, warnings: string[], extraFiles: Record<string, Buffer> = {}): StagedBundle {
  const bid = randomUUID().replace(/-/g, '');
  const sandbox = mkdtempSync(join(tmpdir(), 'swarm-import-'));
  const edir = join(sandbox, 'entities', bid);
  mkdirSync(edir, { recursive: true });
  const slug = name.toLowerCase().replace(/ /g, '-');
  const payload = { slug, name, description: '', command: slug, content, builtin: false };
  writeFileSync(join(edir, 'payload.json'), JSON.stringify(payload));
  // Supporting files ride the same entities/<bid>/files/<rel> channel the commit reader
  // (pReadFiles) feeds into import_, so a zip-of-SKILL.md round-trips as a folder skill instead of
  // getting flattened.
  for (const [rel, data] of Object.entries(extraFiles)) {
    const dest = pSafeJoin(edir, join('files', rel));
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, data);
  }
  const ref: EntityRef = { type: EntityType.skill, bundle_id: bid, name, path: `entities/${bid}` };
  const preview: BundlePreview = { root_type: EntityType.skill, root_name: name, counts: { skill: 1 }, requirement_summary: [] };
  const manifest: Manifest = {
    format_version: FORMAT_VERSION,
    created_with: pCreatedWith(),
    created_at: pNow(),
    bundle_id: randomUUID().replace(/-/g, ''),
    checksum: null,
    root: ref,
    entities: [ref],
    edges: [],
    requirements: [],
    preview,
  };
  return { sandbox, manifest, warnings };
}

// ---------- import: commit ----------

function pReadPayload(sandbox: string, ref: EntityRef): Record<string, unknown> {
  const path = pSafeJoin(sandbox, join(ref.path, 'payload.json'));
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
}

function pReadFiles(sandbox: string, ref: EntityRef): Record<string, Buffer> {
  const base = pSafeJoin(sandbox, join(ref.path, 'files'));
  const out: Record<string, Buffer> = {};
  if (!existsSync(base) || !statSync(base).isDirectory()) return out;
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      out[relative(base, full).split(sep).join('/')] = readFileSync(full);
    }
  };
  walk(base);
  return out;
}

/** Safety read of any app code in the staged bundle. Returns null when the bundle contains no
 * apps (nothing to review). Async because scanAppFiles now spawns a real Python subprocess for
 * its AST scan (see scanAppFiles.ts's own header, SUB-5). */
export async function reviewBundle(sandbox: string, manifest: Manifest): Promise<ReviewSummary | null> {
  const findings: string[] = [];
  const scanned: string[] = [];
  let verdict: ReviewSummary['verdict'] = 'clean';
  let anyApp = false;
  for (const e of manifest.entities) {
    if (e.type !== EntityType.app) continue;
    anyApp = true;
    const r = await scanAppFiles(pReadFiles(sandbox, e));
    findings.push(...r.findings);
    scanned.push(...r.scanned_files);
    if (r.verdict !== 'clean') verdict = r.verdict;
  }
  return anyApp ? { verdict, findings, scanned_files: scanned } : null;
}

export function detectConflicts(sandbox: string, manifest: Manifest): IncludeItem[] {
  const out: IncludeItem[] = [];
  for (const e of manifest.entities) {
    const cls = getExportable(e.type);
    if (!cls?.conflict) continue;
    const msg = cls.conflict(pReadPayload(sandbox, e));
    if (msg) out.push({ type: e.type, name: e.name, detail: msg });
  }
  return out;
}

function pTopoOrder(manifest: Manifest): EntityRef[] {
  const entities = new Map(manifest.entities.map((e) => [e.bundle_id, e] as const));
  const deps = new Map<string, Set<string>>();
  for (const bid of entities.keys()) deps.set(bid, new Set());
  for (const edge of manifest.edges) {
    if (entities.has(edge.from) && entities.has(edge.to)) deps.get(edge.from)!.add(edge.to);
  }
  const tier = new Map(IMPORT_ORDER.map((t, i) => [t, i] as const));
  const result: EntityRef[] = [];
  const done = new Set<string>();
  const remaining = new Set(entities.keys());
  while (remaining.size > 0) {
    let ready = [...remaining].filter((b) => [...deps.get(b)!].every((d) => done.has(d)));
    if (ready.length === 0) ready = [...remaining];
    ready.sort((a, b) => (tier.get(entities.get(a)!.type) ?? 99) - (tier.get(entities.get(b)!.type) ?? 99));
    const nxt = ready[0];
    result.push(entities.get(nxt)!);
    done.add(nxt);
    remaining.delete(nxt);
  }
  return result;
}

export interface CommitResult {
  rootType: EntityType;
  rootId: string | null;
  created: Record<string, string[]>;
  unresolved: Requirement[];
}

export function commit(sandbox: string, manifest: Manifest, acceptRequirements: string[]): CommitResult {
  const remap = new RemapTable();
  const created: Record<string, string[]> = {};
  const trail: Array<{ cls: NonNullable<ReturnType<typeof getExportable>>; newLocalId: string }> = [];
  try {
    for (const e of pTopoOrder(manifest)) {
      const cls = getExportable(e.type);
      if (cls === null) throw new BundleError(`can't import a ${e.type} yet`);
      const newId = cls.import_(pReadPayload(sandbox, e), pReadFiles(sandbox, e), remap);
      remap.assign(e.bundle_id, newId);
      (created[e.type] ??= []).push(newId);
      trail.push({ cls, newLocalId: newId });
    }
  } catch (ex) {
    // All-or-nothing: undo whatever already landed so a failed import never leaves half a
    // dashboard behind.
    for (let i = trail.length - 1; i >= 0; i -= 1) {
      const { cls, newLocalId } = trail[i];
      try {
        cls.rollback?.(newLocalId);
      } catch {
        // best-effort, matches closure.py's own try/except pass around rollback
      }
    }
    if (ex instanceof BundleError) throw ex;
    throw new BundleError('import failed and was rolled back');
  }
  const accepted = new Set(acceptRequirements);
  const unresolved = manifest.requirements.filter((r) => !accepted.has(r.key));
  return { rootType: manifest.root.type, rootId: remap.local(manifest.root.bundle_id), created, unresolved };
}
