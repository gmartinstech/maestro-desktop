// Run: node --test frontend/src/shared/terminalFrames.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeTerminalFrame, encodeInputFrame, encodeResizeFrame } from './terminalFrames.ts';

test('decodes a status frame', () => {
  const raw = JSON.stringify({ event: 'term:status', data: { running: true, shell: 'pwsh.exe', cwd: 'C:\\ws' } });
  const frame = decodeTerminalFrame(raw);
  assert.equal(frame.kind, 'status');
  if (frame.kind !== 'status') return;
  assert.equal(frame.status.shell, 'pwsh.exe');
  assert.equal(frame.status.running, true);
});

test('decodes an output frame back to the original bytes', () => {
  const payload = Buffer.from('hello world').toString('base64');
  const raw = JSON.stringify({ event: 'term:output', data: { data: payload } });
  const frame = decodeTerminalFrame(raw);
  assert.equal(frame.kind, 'output');
  if (frame.kind !== 'output') return;
  assert.equal(frame.data, 'hello world');
});

test('round-trips multi-byte utf-8 through base64', () => {
  const original = 'olá — 日本語 ✓';
  const payload = Buffer.from(original, 'utf-8').toString('base64');
  const raw = JSON.stringify({ event: 'term:output', data: { data: payload } });
  const frame = decodeTerminalFrame(raw);
  assert.equal(frame.kind, 'output');
  if (frame.kind !== 'output') return;
  assert.equal(frame.data, original);
});

test('preserves the ansi escape sequences conpty actually emits', () => {
  const original = '\u001b[1t\u001b[c\u001b[?1004h\u001b[31mred\u001b[0m';
  const payload = Buffer.from(original, 'utf-8').toString('base64');
  const raw = JSON.stringify({ event: 'term:output', data: { data: payload } });
  const frame = decodeTerminalFrame(raw);
  assert.equal(frame.kind, 'output');
  if (frame.kind !== 'output') return;
  assert.equal(frame.data, original);
});

test('decodes an exit frame', () => {
  const raw = JSON.stringify({ event: 'term:exit', data: { code: 130 } });
  const frame = decodeTerminalFrame(raw);
  assert.equal(frame.kind, 'exit');
  if (frame.kind !== 'exit') return;
  assert.equal(frame.code, 130);
});

test('malformed json decodes to unknown rather than throwing', () => {
  assert.equal(decodeTerminalFrame('not json').kind, 'unknown');
  assert.equal(decodeTerminalFrame('').kind, 'unknown');
  assert.equal(decodeTerminalFrame(JSON.stringify({ event: 'term:mystery' })).kind, 'unknown');
});

test('encodes an input frame the backend can decode', () => {
  const encoded = encodeInputFrame('echo hi\r');
  const parsed = JSON.parse(encoded);
  assert.equal(parsed.event, 'term:input');
  assert.equal(Buffer.from(parsed.data.data, 'base64').toString('utf-8'), 'echo hi\r');
});

test('encodes ctrl-c as ordinary input', () => {
  const encoded = encodeInputFrame('\u0003');
  const parsed = JSON.parse(encoded);
  assert.equal(Buffer.from(parsed.data.data, 'base64').toString('utf-8'), '\u0003');
});

test('encodes a resize frame', () => {
  const parsed = JSON.parse(encodeResizeFrame(120, 40));
  assert.equal(parsed.event, 'term:resize');
  assert.equal(parsed.data.cols, 120);
  assert.equal(parsed.data.rows, 40);
});
