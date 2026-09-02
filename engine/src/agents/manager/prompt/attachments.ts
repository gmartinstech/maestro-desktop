// engine/src/agents/manager/prompt/attachments.ts -- AGT-5, a full port of
// backend/apps/agents/manager/prompt/attachments.py. Self-contained: `sniff_file_kind`
// (backend/apps/settings/settings.py) is inlined here as `sniffFileKind` rather than standing up a
// DI seam for the whole settings/settings.py module over one small pure classifier function.
// `resolveForcedTools`/`resolveAttachedSkills` are re-exported from promptContext.ts's own DI
// stubs (tools_lib/skills aren't ported -- see that file's header) rather than duplicated here.

import { existsSync, lstatSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { resolveAttachedSkills, resolveForcedTools } from './promptContext';

export type FileKind = 'text' | 'pdf' | 'image' | 'binary';

/** Classify a file's contents as text/pdf/image/binary so the agent layer can route it (inline as
 * text, send as a native document/image block, or refuse). Mirrors `sniff_file_kind` field-for-
 * field, including the magic-byte table and the null-byte binary heuristic. */
export function sniffFileKind(head: Buffer): [FileKind, string | undefined] {
  if (head.subarray(0, 5).toString('latin1') === '%PDF-') return ['pdf', 'application/pdf'];
  if (head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return ['image', 'image/png'];
  if (head.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return ['image', 'image/jpeg'];
  const gif87 = head.subarray(0, 6).toString('latin1');
  if (gif87 === 'GIF87a' || gif87 === 'GIF89a') return ['image', 'image/gif'];
  if (head.subarray(0, 4).toString('latin1') === 'RIFF' && head.subarray(8, 12).toString('latin1') === 'WEBP') return ['image', 'image/webp'];
  const binarySignatures: Array<[number[], number]> = [
    [[0x50, 0x4b, 0x03, 0x04], 0],
    [[0x50, 0x4b, 0x05, 0x06], 0],
    [[0x1f, 0x8b], 0],
    [[0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c], 0],
    [[0x52, 0x61, 0x72, 0x21, 0x1a, 0x07], 0],
    [[0x7f, 0x45, 0x4c, 0x46], 0],
    [[0xfe, 0xed, 0xfa, 0xce], 0],
    [[0xce, 0xfa, 0xed, 0xfe], 0],
    [[0xfe, 0xed, 0xfa, 0xcf], 0],
    [[0xcf, 0xfa, 0xed, 0xfe], 0],
    [[0x4d, 0x5a], 0],
    [[0xca, 0xfe, 0xba, 0xbe], 0],
    [[0x53, 0x51, 0x4c, 0x69, 0x74, 0x65, 0x20, 0x66, 0x6f, 0x72, 0x6d, 0x61, 0x74, 0x20, 0x33, 0x00], 0],
  ];
  for (const [sig] of binarySignatures) {
    if (head.length >= sig.length && head.subarray(0, sig.length).equals(Buffer.from(sig))) return ['binary', undefined];
  }
  if (head.includes(0x00)) return ['binary', undefined];
  try {
    const text = head.toString('utf-8');
    // Node's utf-8 decode is lossy (replaces invalid sequences with U+FFFD) rather than throwing
    // the way Python's strict decode does; detect a replacement character as the "not valid utf-8"
    // signal instead.
    if (text.includes('�')) return ['binary', undefined];
    return ['text', 'text/plain'];
  } catch {
    return ['binary', undefined];
  }
}

export interface ContentPathEntry {
  path: string;
  type?: 'file' | 'directory';
}

export type NativeBlock = Record<string, unknown>;

/** Build a recursive directory tree listing. */
export function buildDirTree(root: string, maxDepth = 4, prefix = ''): string[] {
  const lines: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(root).slice().sort();
  } catch {
    return [`${prefix}[permission denied]`];
  }
  const isDir = (e: string) => {
    try {
      return statSync(join(root, e)).isDirectory();
    } catch {
      return false;
    }
  };
  const isFile = (e: string) => {
    try {
      return statSync(join(root, e)).isFile();
    } catch {
      return false;
    }
  };
  const visible = entries.filter((e) => !e.startsWith('.'));
  const dirs = visible.filter(isDir);
  const files = visible.filter(isFile);
  for (const f of files) lines.push(`${prefix}${f}`);
  for (const d of dirs) {
    lines.push(`${prefix}${d}/`);
    if (maxDepth > 1) lines.push(...buildDirTree(join(root, d), maxDepth - 1, `${prefix}  `));
  }
  return lines;
}

/** Split context_paths into inline text, native content blocks for this provider, and refusal
 * strings. Two layers of size guard: a per-file inline cap and a total base64-expanded size cap
 * across all native attachments, because providers cap the WHOLE request body. */
export function resolveAttachments(contextPaths: ContentPathEntry[] | null | undefined, apiType: string, model: string): [string, NativeBlock[], string[]] {
  if (!contextPaths || contextPaths.length === 0) return ['', [], []];
  const sections: string[] = [];
  const native: NativeBlock[] = [];
  const refusals: string[] = [];

  const api = (apiType || 'anthropic').toLowerCase();
  const supportsImage = ['anthropic', 'gemini', 'openai', 'openrouter', 'gemini-cli'].includes(api);
  let supportsPdf = ['anthropic', 'gemini', 'gemini-cli', 'openrouter', 'openai'].includes(api);
  if (api === 'openai' && typeof model === 'string' && (model.toLowerCase().includes('codex') || model.toLowerCase().startsWith('cx/'))) {
    supportsPdf = false;
  }

  let perFileCap = 0;
  let totalRequestCap = 0;
  if (api === 'anthropic') {
    perFileCap = 24 * 1024 * 1024;
    totalRequestCap = 28 * 1024 * 1024;
  } else if (api === 'gemini') {
    perFileCap = 14 * 1024 * 1024;
    totalRequestCap = 15 * 1024 * 1024;
  } else if (api === 'openai' || api === 'openrouter') {
    perFileCap = 24 * 1024 * 1024;
    totalRequestCap = 45 * 1024 * 1024;
  }

  let b64Total = 0;
  let textTotalChars = 0;
  const textTotalCap = 1_500_000;

  for (const cp of contextPaths) {
    const path = cp.path || '';
    const cpType = cp.type || 'file';
    if (!path || !existsSync(path)) {
      sections.push(`[Context: ${path}, not found]`);
      continue;
    }
    let isDirEntry = false;
    let isFileEntry = false;
    try {
      const st = lstatSync(path);
      isDirEntry = st.isDirectory();
      isFileEntry = st.isFile();
    } catch {
      // leave both false; falls through to "type mismatch"
    }
    if (cpType === 'directory' && isDirEntry) {
      const treeLines = buildDirTree(path, 4);
      sections.push(`<context_directory path="${path}">\n${treeLines.join('\n')}\n</context_directory>`);
      continue;
    }
    if (cpType !== 'file' || !isFileEntry) {
      sections.push(`[Context: ${path}, type mismatch]`);
      continue;
    }
    try {
      const size = statSync(path).size;
      const fd = readFileSync(path);
      const head = fd.subarray(0, 4096);
      const [kind, mediaType] = sniffFileKind(head);

      if (kind === 'text') {
        const content = fd.toString('utf-8').slice(0, 512_000);
        if (textTotalChars + content.length > textTotalCap) {
          const room = Math.max(0, textTotalCap - textTotalChars);
          refusals.push(
            `[Attached text file ${basename(path)} (${Math.floor(content.length / 1000)}K chars) skipped: would exceed combined ` +
              `text-attachment cap of ${Math.floor(textTotalCap / 1000)}K chars this turn (~${Math.floor(room / 1000)}K left). ` +
              'Detach a file or split into separate turns.]',
          );
          continue;
        }
        textTotalChars += content.length;
        sections.push(`<context_file path="${path}">\n${content}\n</context_file>`);
        continue;
      }

      const b64Size = Math.ceil(size / 3) * 4;

      if (kind === 'pdf') {
        if (!supportsPdf) {
          if (api === 'openai') {
            refusals.push(
              `[Attached PDF ${basename(path)} (${Math.floor(size / 1024)} KB) cannot be read on Codex models. ` +
                'Switch to a non-Codex GPT-5 (e.g. gpt-5.5), Claude, Gemini 3.x, or any model via OpenRouter to read PDFs natively.]',
            );
          } else {
            refusals.push(
              `[Attached PDF ${basename(path)} (${Math.floor(size / 1024)} KB) cannot be read on this provider. ` +
                'Switch to a Claude model (Sonnet 4.6, Opus 4.7, Haiku 4.5), Gemini 3.x, GPT-5 (non-Codex), ' +
                'or any model through OpenRouter to read PDFs natively.]',
            );
          }
          continue;
        }
        if (size > perFileCap) {
          refusals.push(
            `[Attached PDF ${basename(path)} (${Math.floor(size / (1024 * 1024))} MB) exceeds the per-file cap of ` +
              `${Math.floor(perFileCap / (1024 * 1024))} MB on this provider. Split the PDF or send a smaller excerpt.]`,
          );
          continue;
        }
        if (b64Total + b64Size > totalRequestCap) {
          const roomMb = Math.floor(Math.max(0, totalRequestCap - b64Total) / (1024 * 1024));
          refusals.push(
            `[Attached PDF ${basename(path)} would push the request over ${Math.floor(totalRequestCap / (1024 * 1024))} MB ` +
              `encoded (provider cap). Only ~${roomMb} MB of room left this turn. Detach a file, or send PDFs in separate turns.]`,
          );
          continue;
        }
        native.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: fd.toString('base64') } });
        b64Total += b64Size;
        continue;
      }

      if (kind === 'image') {
        if (!supportsImage) {
          refusals.push(
            `[Attached image ${basename(path)} cannot be displayed to this model. Switch to a vision-capable model (Claude, GPT-4o/5, Gemini).]`,
          );
          continue;
        }
        if (size > perFileCap) {
          refusals.push(`[Attached image ${basename(path)} (${Math.floor(size / (1024 * 1024))} MB) exceeds per-file cap.]`);
          continue;
        }
        if (b64Total + b64Size > totalRequestCap) {
          const roomMb = Math.floor(Math.max(0, totalRequestCap - b64Total) / (1024 * 1024));
          refusals.push(
            `[Attached image ${basename(path)} would push the request over ${Math.floor(totalRequestCap / (1024 * 1024))} MB encoded. ~${roomMb} MB of room left.]`,
          );
          continue;
        }
        native.push({ type: 'image', source: { type: 'base64', media_type: mediaType || 'image/png', data: fd.toString('base64') } });
        b64Total += b64Size;
        continue;
      }

      refusals.push(`[Attached binary file ${basename(path)} not inlined. Convert to text first.]`);
    } catch (e) {
      sections.push(`[Context: ${path}, error reading: ${e instanceof Error ? e.message : String(e)}]`);
    }
  }

  // Anthropic prompt caching: tag the last document block as ephemeral so a follow-up turn
  // referencing the same PDF stays cache-warm.
  if (api === 'anthropic' && native.length > 0) {
    for (let i = native.length - 1; i >= 0; i--) {
      if (native[i].type === 'document') {
        native[i].cache_control = { type: 'ephemeral' };
        break;
      }
    }
  }

  return [sections.join('\n\n'), native, refusals];
}

export interface ImageAttachment {
  media_type?: string;
  data: string;
}

/** Build message content for the Anthropic SDK's prompt stream. Routes attachments per provider
 * (see the Python original's docstring for the full per-provider rationale, preserved there
 * verbatim -- this file only re-implements the mechanics). */
export function buildPromptContent(
  prompt: string,
  images: ImageAttachment[] | null | undefined,
  contextPaths: ContentPathEntry[] | null | undefined,
  forcedTools: string[] | null | undefined,
  attachedSkills: unknown[] | null | undefined,
  apiType = 'anthropic',
  model = '',
): string | Array<Record<string, unknown>> {
  const [contextText, nativeBlocks, refusals] = resolveAttachments(contextPaths, apiType, model);
  const forcedToolsText = resolveForcedTools(forcedTools);
  const skillsText = resolveAttachedSkills(attachedSkills);

  const refusalText = refusals.join('\n\n');
  const parts = [forcedToolsText, contextText, refusalText, skillsText, prompt].filter(Boolean);
  const fullPrompt = parts.join('\n\n');

  const hasNative = nativeBlocks.length > 0;
  if (!images?.length && !hasNative) return fullPrompt;
  const content: Array<Record<string, unknown>> = [{ type: 'text', text: fullPrompt }];
  for (const img of images ?? []) {
    content.push({ type: 'image', source: { type: 'base64', media_type: img.media_type ?? 'image/png', data: img.data } });
  }
  content.push(...nativeBlocks);
  return content;
}

/** Legacy entry point retained for any external caller; routes to the new attachment resolver with
 * anthropic-default routing (no native blocks emitted, so behavior is the safe text-only old path). */
export function resolveContextPaths(contextPaths: ContentPathEntry[] | null | undefined): string {
  const [text, , refusals] = resolveAttachments(contextPaths, 'anthropic', '');
  const refusalText = refusals.join('\n\n');
  return [text, refusalText].filter(Boolean).join('\n\n');
}
