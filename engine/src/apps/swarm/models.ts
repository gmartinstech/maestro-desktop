// engine/src/apps/swarm/models.ts -- SUB-3, a full TypeScript port of backend/apps/swarm/models.py.
//
// Schema for the .swarm bundle: a hardened zip whose manifest.json is a dependency graph of
// entities with one designated root. The manifest never carries secrets or payloads (payloads
// live as files in the zip). The *View types are the lighter, frontend-facing shapes the
// share/import modals read. Field names and defaults are ported 1:1 from the pydantic models --
// this is a wire format shared with the still-shipping Python backend during the migration, so
// the JSON shape must stay byte-identical, not just "equivalent".

export const FORMAT_VERSION = 1;

export enum EntityType {
  skill = 'skill',
  app = 'app',
  workflow = 'workflow',
  dashboard = 'dashboard',
  mode = 'mode',
  session = 'session',
}

export enum RequirementKind {
  mcp_action = 'mcp_action', // an MCP/Action that must be reconnected (never auto)
  setting = 'setting', // a safe settings fragment the user confirms
  builtin_mode = 'builtin_mode', // a builtin mode that must already exist locally
  api_key = 'api_key', // a provider key the bundle needs but can't carry
  custom_provider = 'custom_provider', // OpenAI-compatible endpoint (URL ssrf-checked)
}

export interface EntityRef {
  type: EntityType;
  bundle_id: string; // uuid4 hex, stable only within this bundle
  name: string;
  path: string; // dir inside the zip holding this entity
}

export interface DependencyEdge {
  from: string;
  to: string;
  relation: string;
}

export interface Requirement {
  kind: RequirementKind;
  key: string;
  label: string;
  detail: string;
  referenced_by: string[];
  proposal: Record<string, unknown>; // safe, non-secret hint only
}

export function makeRequirement(r: Partial<Requirement> & Pick<Requirement, 'kind' | 'key' | 'label'>): Requirement {
  return { detail: '', referenced_by: [], proposal: {}, ...r };
}

export interface BundlePreview {
  root_type: EntityType;
  root_name: string;
  counts: Record<string, number>;
  requirement_summary: string[];
}

export interface Manifest {
  format_version: number;
  created_with: string;
  created_at: string;
  bundle_id: string;
  // sha256 over every entity payload + file (not the manifest itself); set at pack time,
  // re-checked on import to reject a corrupted or edited archive.
  checksum: string | null;
  root: EntityRef;
  entities: EntityRef[];
  edges: DependencyEdge[];
  requirements: Requirement[];
  preview: BundlePreview;
}

// ---- frontend-facing summary (export + import preflight) ----

export interface IncludeItem {
  type: EntityType;
  name: string;
  detail: string;
}

export interface RequirementView {
  kind: RequirementKind;
  key: string;
  label: string;
  detail: string;
}

export interface BundleSummary {
  root: IncludeItem;
  includes: IncludeItem[];
  requirements: RequirementView[];
  counts: Record<string, number>;
}

export interface ReviewSummary {
  verdict: 'clean' | 'warn' | 'block';
  findings: string[];
  scanned_files: string[];
}

// ---- endpoint request/response ----

export interface ExportRequest {
  type: EntityType;
  id: string;
}

export interface ExportPreflightResponse {
  ok: boolean;
  summary: BundleSummary;
  filename: string;
  link_supported: boolean;
}

export interface ImportPreflightResponse {
  ok: boolean;
  summary: BundleSummary;
  staging_token: string;
  conflicts: IncludeItem[];
  review: ReviewSummary | null;
  warnings: string[];
}

export interface ImportCommitRequest {
  staging_token: string;
  accept_requirements: string[];
}

export interface ImportCommitResponse {
  ok: boolean;
  root_type: EntityType;
  root_id: string;
  created: Record<string, string[]>;
  unresolved_requirements: RequirementView[];
}
