// engine/src/apps/outputs/models.ts -- SUB-5, a TypeScript port of backend/apps/outputs/models.py's
// pydantic models. TypeScript has no runtime validator equivalent to pydantic's BaseModel, so every
// "model" here is a plain interface plus a `hydrate*`/`coerce*` constructor function that fills in
// defaults the same way pydantic's Field(default_factory=...) does, and a `migrateFlatFields`
// helper that ports the `p_migrate_flat_fields` `model_validator(mode="before")` byte-for-byte
// (legacy frontend_code/backend_code/schema_json -> files{} migration every model variant shares).

import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { outputsWorkspaceDir } from './paths';

export type OutputVersionSource = 'auto' | 'manual' | 'pre_restore';
export type WorkspaceTemplateMode = 'flat' | 'webapp_template';

export interface JsonSchemaShape {
  type?: string;
  properties?: Record<string, unknown>;
  required?: string[];
  [k: string]: unknown;
}

export function defaultInputSchema(): JsonSchemaShape {
  return { type: 'object', properties: {}, required: [] };
}

export interface Output {
  id: string;
  name: string;
  description: string;
  icon: string;
  input_schema: JsonSchemaShape;
  files: Record<string, string>;
  thumbnail: string | null;
  preview_updated_at: string | null;
  session_id: string | null;
  workspace_id: string | null;
  recovered: boolean;
  created_at: string;
  updated_at: string;
}

function popLegacyFields(data: Record<string, unknown>, includeSchemaJson: boolean): Record<string, string> {
  const files: Record<string, string> = {};
  const fc = data.frontend_code;
  const bc = data.backend_code;
  const sj = includeSchemaJson ? data.schema_json : undefined;
  if (typeof fc === 'string' && fc) files['index.html'] = fc;
  if (typeof bc === 'string' && bc) files['backend.py'] = bc;
  if (includeSchemaJson && typeof sj === 'string' && sj) files['schema.json'] = sj;
  delete data.frontend_code;
  delete data.backend_code;
  if (includeSchemaJson) delete data.schema_json;
  return files;
}

/** Ports Output/OutputCreate's `p_migrate_flat_fields`: triggers on `"files" not in data OR
 * data["files"] is falsy`, and ALWAYS assigns `data["files"] = files` on that branch (even when
 * the legacy fields were absent too, matching pydantic's own unconditional assignment). */
export function migrateFlatFields(data: Record<string, unknown>): Record<string, unknown> {
  const hasFiles = 'files' in data && data.files && Object.keys(data.files as object).length > 0;
  if (!hasFiles) {
    data.files = popLegacyFields(data, false);
  } else {
    delete data.frontend_code;
    delete data.backend_code;
  }
  return data;
}

/** Ports OutputUpdate/WorkspaceSeedRequest's `p_migrate_flat_fields`: a DIFFERENT presence check
 * than migrateFlatFields above -- triggers on `"files" not in data` only (an explicit `files: {}`
 * is left alone, unlike migrateFlatFields's truthy check), and only assigns `data["files"]` when
 * the recovered legacy fields are non-empty (an update with no files and no legacy fields leaves
 * `files` unset entirely, so exclude_unset-style callers see it as untouched). */
export function migrateFlatFieldsIfAbsent(data: Record<string, unknown>, includeSchemaJson = false): Record<string, unknown> {
  if (!('files' in data)) {
    const files = popLegacyFields(data, includeSchemaJson);
    if (Object.keys(files).length > 0) data.files = files;
  } else {
    delete data.frontend_code;
    delete data.backend_code;
    if (includeSchemaJson) delete data.schema_json;
  }
  return data;
}

/** Ports Output's workspace_path computed field: the absolute on-disk folder for this app,
 * resolved from workspace_id. Empty string when there's no workspace (matches the Python
 * original returning "" rather than null). */
export function outputWorkspacePath(output: Pick<Output, 'workspace_id'>, env: NodeJS.ProcessEnv = process.env): string {
  if (!output.workspace_id) return '';
  return resolve(join(outputsWorkspaceDir(env), output.workspace_id));
}

export function frontendCode(output: Pick<Output, 'files'>): string {
  return output.files['index.html'] ?? '';
}

export function backendCode(output: Pick<Output, 'files'>): string | undefined {
  return output.files['backend.py'];
}

/** Hydrates a loosely-typed on-disk/request blob into a full Output, applying every pydantic
 * Field default the Python model declares. Callers that already have a raw parsed JSON object
 * should route it through here rather than casting, so a partial/legacy file still gets every
 * field. */
export function hydrateOutput(raw: Record<string, unknown>): Output {
  const data = migrateFlatFields({ ...raw }); // Output uses the same variant as OutputCreate
  const now = new Date().toISOString();
  return {
    id: typeof data.id === 'string' && data.id ? data.id : randomUUID().replace(/-/g, ''),
    name: typeof data.name === 'string' ? data.name : '',
    description: typeof data.description === 'string' ? data.description : '',
    icon: typeof data.icon === 'string' ? data.icon : 'view_quilt',
    input_schema: (data.input_schema as JsonSchemaShape) ?? defaultInputSchema(),
    files: (data.files as Record<string, string>) ?? {},
    thumbnail: typeof data.thumbnail === 'string' ? data.thumbnail : null,
    preview_updated_at: typeof data.preview_updated_at === 'string' ? data.preview_updated_at : null,
    session_id: typeof data.session_id === 'string' ? data.session_id : null,
    workspace_id: typeof data.workspace_id === 'string' ? data.workspace_id : null,
    recovered: data.recovered === true,
    created_at: typeof data.created_at === 'string' ? data.created_at : now,
    updated_at: typeof data.updated_at === 'string' ? data.updated_at : now,
  };
}

/** The JSON this engine persists to disk for an Output -- mirrors output.model_dump(exclude=
 * {"workspace_path"}): every stored field, minus the API-only computed workspace_path. */
export function outputToStoredJson(output: Output): Record<string, unknown> {
  return { ...output };
}

/** The JSON this engine returns over HTTP for an Output -- mirrors output.model_dump(): the
 * stored fields PLUS the computed workspace_path the frontend needs to show the real edit path. */
export function outputToApiJson(output: Output, env: NodeJS.ProcessEnv = process.env): Record<string, unknown> {
  return { ...output, workspace_path: outputWorkspacePath(output, env) };
}

export interface OutputVersion {
  id: string;
  created_at: string;
  label: string;
  source: OutputVersionSource;
  parent_id: string | null;
  thumbnail: string | null;
}

export function hydrateOutputVersion(raw: Record<string, unknown>): OutputVersion {
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : randomUUID().replace(/-/g, ''),
    created_at: typeof raw.created_at === 'string' ? raw.created_at : new Date().toISOString(),
    label: typeof raw.label === 'string' ? raw.label : '',
    source: raw.source === 'manual' || raw.source === 'pre_restore' ? raw.source : 'auto',
    parent_id: typeof raw.parent_id === 'string' ? raw.parent_id : null,
    thumbnail: typeof raw.thumbnail === 'string' ? raw.thumbnail : null,
  };
}

export interface OutputCreateInput {
  name: string;
  description: string;
  icon: string;
  input_schema: JsonSchemaShape;
  files: Record<string, string>;
  thumbnail: string | null;
  session_id: string | null;
  workspace_id: string | null;
}

export function parseOutputCreate(raw: Record<string, unknown>): OutputCreateInput | null {
  const data = migrateFlatFields({ ...raw });
  if (typeof data.name !== 'string') return null;
  return {
    name: data.name,
    description: typeof data.description === 'string' ? data.description : '',
    icon: typeof data.icon === 'string' ? data.icon : 'view_quilt',
    input_schema: (data.input_schema as JsonSchemaShape) ?? defaultInputSchema(),
    files: (data.files as Record<string, string>) ?? {},
    thumbnail: typeof data.thumbnail === 'string' ? data.thumbnail : null,
    session_id: typeof data.session_id === 'string' ? data.session_id : null,
    workspace_id: typeof data.workspace_id === 'string' ? data.workspace_id : null,
  };
}

export interface OutputUpdateInput {
  name?: string;
  description?: string;
  icon?: string;
  input_schema?: JsonSchemaShape;
  files?: Record<string, string>;
  thumbnail?: string | null;
  session_id?: string | null;
  workspace_id?: string | null;
}

/** Ports OutputUpdate's own model_validator: unlike Create/Output, an explicit empty `files: {}`
 * key means "no legacy fields, but files WAS provided" -- Python's own guard is `"files" not in
 * data`, not falsy-check, so a caller can send files:{} deliberately. Returns [parsed, setKeys]
 * so the route handler can apply `model_dump(exclude_unset=True)` semantics: only keys the client
 * actually sent (JS's `in` on the raw body) get applied, everything else leaves the stored field
 * untouched -- including an explicit `null` (e.g. clearing session_id), which must NOT be dropped. */
export function parseOutputUpdate(raw: Record<string, unknown>): { value: OutputUpdateInput; setKeys: Set<string> } {
  const data = migrateFlatFieldsIfAbsent({ ...raw });
  const setKeys = new Set<string>();
  const value: OutputUpdateInput = {};
  const maybeSet = <K extends keyof OutputUpdateInput>(key: K, present: boolean, v: OutputUpdateInput[K]): void => {
    if (!present) return;
    setKeys.add(key as string);
    value[key] = v;
  };
  maybeSet('name', typeof raw.name === 'string', raw.name as string);
  maybeSet('description', typeof raw.description === 'string', raw.description as string);
  maybeSet('icon', typeof raw.icon === 'string', raw.icon as string);
  maybeSet('input_schema', raw.input_schema !== undefined, raw.input_schema as JsonSchemaShape);
  maybeSet('files', data.files !== undefined, data.files as Record<string, string>);
  maybeSet('thumbnail', 'thumbnail' in raw, (raw.thumbnail as string | null) ?? null);
  maybeSet('session_id', 'session_id' in raw, (raw.session_id as string | null) ?? null);
  maybeSet('workspace_id', 'workspace_id' in raw, (raw.workspace_id as string | null) ?? null);
  return { value, setKeys };
}

export interface OutputExecuteInput {
  output_id: string;
  input_data: Record<string, unknown>;
  force: boolean;
}

export function parseOutputExecute(raw: Record<string, unknown>): OutputExecuteInput | null {
  if (typeof raw.output_id !== 'string') return null;
  return {
    output_id: raw.output_id,
    input_data: (raw.input_data as Record<string, unknown>) ?? {},
    force: raw.force === true,
  };
}

export interface OutputExecuteResult {
  output_id: string;
  output_name: string;
  frontend_code: string;
  input_data: Record<string, unknown>;
  backend_result: Record<string, unknown> | null;
  stdout: string | null;
  stderr: string | null;
  error: string | null;
  warnings: string[] | null;
  code_preview: string | null;
}

export interface AgentCreateAppRequest {
  name: string;
  description: string;
  parent_session_id: string;
}

export function parseAgentCreateAppRequest(raw: Record<string, unknown>): AgentCreateAppRequest | null {
  if (typeof raw.name !== 'string') return null;
  return {
    name: raw.name,
    description: typeof raw.description === 'string' ? raw.description : '',
    parent_session_id: typeof raw.parent_session_id === 'string' ? raw.parent_session_id : '',
  };
}

export interface WorkspaceSeedRequest {
  workspace_id: string;
  files: Record<string, string> | null;
  meta: Record<string, unknown> | null;
  template_mode: WorkspaceTemplateMode;
}

export function parseWorkspaceSeedRequest(raw: Record<string, unknown>): WorkspaceSeedRequest | null {
  const data = migrateFlatFieldsIfAbsent({ ...raw }, true);
  if (typeof data.workspace_id !== 'string') return null;
  const mode = data.template_mode;
  return {
    workspace_id: data.workspace_id,
    files: (data.files as Record<string, string>) ?? null,
    meta: (data.meta as Record<string, unknown>) ?? null,
    template_mode: mode === 'flat' ? 'flat' : 'webapp_template',
  };
}

export interface VibeCodeRequest {
  prompt: string;
  current_frontend_code: string;
  current_backend_code: string;
  current_schema: string;
  name: string;
  description: string;
}

export function parseVibeCodeRequest(raw: Record<string, unknown>): VibeCodeRequest | null {
  if (typeof raw.prompt !== 'string') return null;
  return {
    prompt: raw.prompt,
    current_frontend_code: typeof raw.current_frontend_code === 'string' ? raw.current_frontend_code : '',
    current_backend_code: typeof raw.current_backend_code === 'string' ? raw.current_backend_code : '',
    current_schema: typeof raw.current_schema === 'string' ? raw.current_schema : '',
    name: typeof raw.name === 'string' ? raw.name : '',
    description: typeof raw.description === 'string' ? raw.description : '',
  };
}
