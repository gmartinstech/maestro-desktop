// engine/src/apps/modes/models.ts -- SUB-1's native port of backend/apps/modes/models.py.
//
// Ports Mode/ModeCreate/ModeUpdate field-for-field (same field names, same defaults) plus the
// BUILTIN_MODES catalog verbatim, byte-for-byte down to the system_prompt copy -- these prompts
// are user-facing product content, not something a "port" gets to paraphrase.

import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { resolveDataRoot } from '../../auth/token';

export interface Mode {
  id: string;
  name: string;
  description: string;
  system_prompt: string | null;
  tools: string[] | null;
  default_next_mode: string | null;
  is_builtin: boolean;
  icon: string;
  color: string;
  default_folder: string | null;
}

export interface ModeCreateInput {
  name: string;
  description?: string;
  system_prompt?: string | null;
  tools?: string[] | null;
  default_next_mode?: string | null;
  icon?: string;
  color?: string;
  default_folder?: string | null;
}

export interface ModeUpdateInput {
  name?: string;
  description?: string;
  system_prompt?: string | null;
  tools?: string[] | null;
  default_next_mode?: string | null;
  icon?: string;
  color?: string;
  default_folder?: string | null;
}

// Mirrors Mode's pydantic Field(default_factory=lambda: uuid4().hex) -- a bare 32-hex-char string,
// not a canonical dashed UUID (models.py's own choice, reproduced exactly).
export function newModeId(): string {
  return randomBytes(16).toString('hex');
}

// backend/apps/modes/models.py's OUTPUTS_WORKSPACE_DIR / SKILLS_WORKSPACE_DIR imports, resolved
// against this engine's own DATA_ROOT (auth/token.ts's resolveDataRoot -- the same physical
// directory backend/config/paths.py's DATA_ROOT resolves to, dev and packaged alike).
export function outputsWorkspaceDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(resolveDataRoot(env), 'outputs_workspace');
}

export function skillsWorkspaceDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(resolveDataRoot(env), 'skills_workspace');
}

// The 5 built-in modes, ported verbatim from BUILTIN_MODES (chat was already deleted/merged into
// ask -- see modes.py's own migration comment and test_builtin_modes_no_chat). default_folder for
// view-builder/skill-builder is resolved lazily (per-env) rather than baked into a static array,
// since a static module-level constant can't see a test's monkeypatched DATA_ROOT the way
// outputsWorkspaceDir()/skillsWorkspaceDir() can.
export function builtinModes(env: NodeJS.ProcessEnv = process.env): Mode[] {
  return [
    {
      id: 'agent',
      name: 'Agent',
      description: 'Full autonomous agent with read and write access to tools.',
      system_prompt: null,
      tools: null,
      default_next_mode: null,
      is_builtin: true,
      icon: 'smart_toy',
      color: '#818cf8',
      default_folder: null,
    },
    {
      id: 'ask',
      name: 'Ask',
      description:
        'Read-only conversation. Browse the codebase, search the web, and discuss ideas; but no edits, shells, or file writes.',
      system_prompt:
        'You are in Ask mode; a read-only assistant. Keep responses ' +
        'natural and conversational. You CAN read files, search the ' +
        'codebase, and search/fetch the web. You CANNOT edit files, run ' +
        'shell commands, or otherwise modify anything; if the user asks ' +
        'for real work (writing code, running commands), tell them to ' +
        'switch to Agent mode. You may use MCPSearch and MCPActivate to ' +
        'bring in additional read-only data sources (email, calendar, ' +
        'etc.) when relevant.',
      tools: ['Read', 'Glob', 'Grep', 'AskUserQuestion', 'WebFetch', 'WebSearch'],
      default_next_mode: null,
      is_builtin: true,
      icon: 'question_answer',
      color: '#4ade80',
      default_folder: null,
    },
    {
      id: 'plan',
      name: 'Plan',
      description: 'Analyze requests and produce a detailed step-by-step plan without executing.',
      system_prompt: 'Analyze the request and produce a detailed step-by-step plan. Do not execute the plan or make any changes.',
      tools: ['Read', 'Glob', 'Grep', 'AskUserQuestion'],
      default_next_mode: 'agent',
      is_builtin: true,
      icon: 'map',
      color: '#fbbf24',
      default_folder: null,
    },
    {
      id: 'view-builder',
      name: 'App Builder',
      description: 'Create and iterate on reusable App artifacts.',
      system_prompt:
        'You are an App Builder; an AI assistant that creates self-contained ' +
        'web apps rendered in an iframe preview.\n\n' +
        'Your working directory is a dedicated workspace folder pre-seeded with ' +
        'template files. Read the existing files before making changes.\n\n' +
        '## Critical rules\n\n' +
        '- The entry point MUST be named `index.html`. Never rename it or create ' +
        'a different HTML file as the main entry point.\n' +
        '- Write files immediately when you have code ready; the user sees a ' +
        'live preview that auto-refreshes from these files.\n' +
        '- Always write the complete file content on first creation (do not use ' +
        'Edit for partial patches on new files).\n' +
        '- For complex apps, split code into separate files (JS, CSS, etc.) ' +
        'and reference them from index.html with relative paths.\n' +
        '- Always update meta.json with a short name and one-sentence description.\n' +
        '- Build beautiful, polished UIs with modern design; dark themes, smooth ' +
        'transitions, proper spacing, and responsive layouts.\n\n' +
        'Read the SKILL.md reference in your workspace for the full technical ' +
        'specification of the App platform (available globals, file conventions, ' +
        'schema format, backend.py usage, and examples).',
      tools: null,
      default_next_mode: null,
      is_builtin: true,
      icon: 'view_quilt',
      color: '#f472b6',
      default_folder: outputsWorkspaceDir(env),
    },
    {
      id: 'skill-builder',
      name: 'Skill Builder',
      description: 'Create and iterate on skills using AI-assisted vibe coding.',
      system_prompt:
        'You are a Skill Builder; an AI assistant that helps users create, ' +
        'refine, and iterate on Claude skills (SKILL.md files).\n\n' +
        '## How Skills Work\n\n' +
        'A skill is a Markdown file that teaches Claude how to perform a specific task. ' +
        'Skills have YAML frontmatter with `name` and `description` fields, followed by ' +
        'the skill body in Markdown. The description is the primary triggering mechanism; ' +
        'it tells Claude when to use the skill.\n\n' +
        '## Your Working Directory\n\n' +
        'Your working directory is a dedicated workspace folder for this skill. ' +
        'Write your output directly to these files using the Write tool:\n\n' +
        '1. **SKILL.md**; The complete skill file with YAML frontmatter and Markdown body. ' +
        'Example frontmatter:\n' +
        '   ```\n' +
        '   ---\n' +
        '   name: my-skill\n' +
        '   description: When to trigger and what this skill does.\n' +
        '   ---\n' +
        '   ```\n\n' +
        '2. **meta.json**; Metadata for the skill builder UI. Always write this file. Example:\n' +
        '   {"name":"My Skill","description":"A short description","command":"my-skill"}\n\n' +
        'Write these files immediately when you have content ready. The user can see ' +
        'a live preview that auto-refreshes from these files. Always write the ' +
        'complete file content (do not use Edit for partial patches on first creation).\n\n' +
        '## Skill Creation Process\n\n' +
        '1. **Understand intent**; Ask what the skill should do, when it should trigger, ' +
        'and what the expected output format is.\n' +
        '2. **Draft the skill**; Write a SKILL.md with clear instructions, examples, ' +
        'and good progressive disclosure.\n' +
        '3. **Iterate**; Refine based on user feedback. Update the files each time.\n\n' +
        '## Skill Writing Best Practices\n\n' +
        '- Keep SKILL.md under 500 lines; use bundled reference files for large content.\n' +
        '- The `description` frontmatter is the primary trigger. Make it slightly "pushy"; ' +
        'include both what the skill does AND specific contexts for when to use it.\n' +
        '- Use imperative form in instructions.\n' +
        '- Include examples with input/output pairs when helpful.\n' +
        '- Define output formats explicitly with templates.\n' +
        '- Use theory of mind; explain *why* things matter rather than just MUST directives.\n' +
        '- Think about edge cases, error handling, and progressive disclosure.\n\n' +
        '## Skill Anatomy\n\n' +
        '```\n' +
        'skill-name/\n' +
        '├── SKILL.md (required); YAML frontmatter + Markdown instructions\n' +
        '└── Bundled Resources (optional)\n' +
        '    ├── scripts/   ; Executable code for repetitive tasks\n' +
        '    ├── references/; Docs loaded into context as needed\n' +
        '    └── assets/    ; Files used in output\n' +
        '```\n\n' +
        'Be collaborative and flexible. If the user wants to "just vibe", skip the formal ' +
        'process and iterate freely. Always write updated files so the preview stays current.',
      tools: null,
      default_next_mode: null,
      is_builtin: true,
      icon: 'psychology',
      color: '#10b981',
      default_folder: skillsWorkspaceDir(env),
    },
  ];
}

// Builds a full Mode from a create request, filling every field the pydantic model's own defaults
// would (Field(default_factory=...) / plain defaults in models.py's Mode).
export function modeFromCreate(body: ModeCreateInput): Mode {
  return {
    id: newModeId(),
    name: body.name,
    description: body.description ?? '',
    system_prompt: body.system_prompt ?? null,
    tools: body.tools ?? null,
    default_next_mode: body.default_next_mode ?? null,
    is_builtin: false,
    icon: body.icon ?? 'smart_toy',
    color: body.color ?? '#818cf8',
    default_folder: body.default_folder ?? null,
  };
}

// Mirrors update_mode's `for k, v in body.model_dump(exclude_unset=True).items(): setattr(...)` --
// only keys actually present on the update body overwrite the loaded mode; everything else is left
// as-is. `undefined` on ModeUpdateInput IS "unset" here (matches exclude_unset's semantics).
export function applyModeUpdate(mode: Mode, body: ModeUpdateInput): Mode {
  const next: Mode = { ...mode };
  if (body.name !== undefined) next.name = body.name;
  if (body.description !== undefined) next.description = body.description;
  if (body.system_prompt !== undefined) next.system_prompt = body.system_prompt;
  if (body.tools !== undefined) next.tools = body.tools;
  if (body.default_next_mode !== undefined) next.default_next_mode = body.default_next_mode;
  if (body.icon !== undefined) next.icon = body.icon;
  if (body.color !== undefined) next.color = body.color;
  if (body.default_folder !== undefined) next.default_folder = body.default_folder;
  return next;
}
