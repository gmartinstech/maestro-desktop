// engine/src/apps/skills/models.ts -- SUB-2, a TypeScript port of backend/apps/skills/models.py's
// pydantic models. Plain interfaces + factory helpers stand in for pydantic's default_factory /
// Optional-with-default fields -- there is no runtime validation layer on this side (the HTTP
// handler is the one place a request body gets shape-checked, same division of labor
// settings/handler.ts already established for its own models).

import { randomUUID } from 'node:crypto';

export interface Skill {
  id: string;
  name: string;
  description: string;
  content: string;
  file_path: string;
  command: string;
  // Platform-shipped skills (e.g. App Builder): UI hides delete and DELETE returns 409, but content
  // stays editable so users can tune them.
  built_in: boolean;
  // Multi-file skills live in ~/.claude/skills/<id>/ with a SKILL.md plus supporting files
  // (scripts, templates). dir_path is set for those; empty for a legacy flat <id>.md skill.
  // has_supporting_files flags extra files beyond SKILL.md so the prompt layer knows to point the
  // agent at the folder for on-demand reading.
  dir_path: string;
  has_supporting_files: boolean;
  // Provenance for registry-installed skills, used to detect + apply updates. source is
  // owner/repo ('' for user-created), folder is the skill's path in that repo, version is the
  // folder's git tree SHA at install time (changes iff something inside the folder changes
  // upstream).
  source: string;
  folder: string;
  version: string;
}

/** Fills every field a bare `{ name, content }` payload would get from the Python model's
 * defaults (uuid4().hex id, empty strings/false elsewhere). Mirrors pydantic's Field(default_factory=...). */
export function newSkillDefaults(): Pick<
  Skill,
  'id' | 'description' | 'file_path' | 'command' | 'built_in' | 'dir_path' | 'has_supporting_files' | 'source' | 'folder' | 'version'
> {
  return {
    id: randomUUID().replace(/-/g, ''),
    description: '',
    file_path: '',
    command: '',
    built_in: false,
    dir_path: '',
    has_supporting_files: false,
    source: '',
    folder: '',
    version: '',
  };
}

export interface SkillCreate {
  name: string;
  description?: string;
  content: string;
  command?: string;
}

export interface SkillUpdate {
  name?: string | null;
  description?: string | null;
  content?: string | null;
  command?: string | null;
}

export interface SkillLoadRequest {
  id: string;
}

export interface SkillWorkspaceSeedRequest {
  workspace_id: string;
  skill_content?: string | null;
  meta?: Record<string, unknown> | null;
}
