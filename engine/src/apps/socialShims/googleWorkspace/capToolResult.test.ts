import { mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { capToolResult, MAX_RESULT_CHARS } from './capToolResult';

let reportDir: string;
const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  reportDir = mkdtempSync(join(tmpdir(), 'maestro-gws-cap-'));
  process.env.MAESTRO_TOOL_REPORT_DIR = reportDir;
});

afterEach(() => {
  rmSync(reportDir, { recursive: true, force: true });
  process.env = { ...ORIGINAL_ENV };
});

describe('capToolResult', () => {
  test('passes a short result through unchanged, no spill file written', () => {
    const result = { content: [{ type: 'text', text: 'hello' }] };
    expect(capToolResult(result)).toBe(result);
    expect(readdirSync(reportDir).length).toBe(0);
  });

  test('caps a long single block, appends a truncation note, and spills the full text', () => {
    const longText = 'x'.repeat(MAX_RESULT_CHARS + 500);
    const result = { content: [{ type: 'text', text: longText }] };
    const capped = capToolResult(result);
    expect(capped.content[0].text.length).toBeGreaterThan(MAX_RESULT_CHARS); // cap + the note itself
    expect(capped.content[0].text).toContain('[Truncated:');
    expect(capped.content[0].text).toContain('saved to');
    const files = readdirSync(reportDir);
    expect(files.length).toBe(1);
    expect(readFileSync(join(reportDir, files[0]), 'utf8')).toBe(longText);
  });

  test('the block where the cap is hit gets the truncation note; every block after it is blanked', () => {
    const result = {
      content: [
        { type: 'text', text: 'a'.repeat(MAX_RESULT_CHARS) },
        { type: 'text', text: 'this block hits the cap and gets the note' },
        { type: 'text', text: 'this block should be blanked entirely' },
      ],
    };
    const capped = capToolResult(result);
    expect(capped.content[1].text).toContain('[Truncated:');
    expect(capped.content[2].text).toBe('');
  });

  test('accepts the bare-array shape (no {content:...} wrapper)', () => {
    const result = [{ type: 'text', text: 'hi' }];
    expect(capToolResult(result)).toBe(result);
  });

  test('non-text blocks and blocks with no text pass through untouched', () => {
    const result = { content: [{ type: 'image', text: undefined }, { type: 'text', text: 'short' }] };
    const capped = capToolResult(result);
    expect(capped.content[0].type).toBe('image');
    expect(capped.content[1].text).toBe('short');
  });

  test('an unrecognized shape (missing .content, not an array) passes through unchanged, never throws', () => {
    const weird = { notContent: 'nope' } as unknown as { content?: never[] };
    expect(capToolResult(weird)).toBe(weird);
  });

  test('prunes report files older than 7 days on the next spill', () => {
    const longText = 'y'.repeat(MAX_RESULT_CHARS + 10);
    capToolResult({ content: [{ type: 'text', text: longText }] });
    const [firstFile] = readdirSync(reportDir);
    const eightDaysAgo = new Date(Date.now() - 8 * 86_400_000);
    utimesSync(join(reportDir, firstFile), eightDaysAgo, eightDaysAgo);

    capToolResult({ content: [{ type: 'text', text: longText }] });
    const files = readdirSync(reportDir);
    expect(files.length).toBe(1); // the stale one was pruned, only the newest spill remains
    expect(files[0]).not.toBe(firstFile);
  });

  test('a custom maxChars is respected', () => {
    const result = { content: [{ type: 'text', text: 'x'.repeat(100) }] };
    const capped = capToolResult(result, 10);
    expect(capped.content[0].text.startsWith('x'.repeat(10))).toBe(true);
  });
});
