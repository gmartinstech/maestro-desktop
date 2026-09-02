import { describe, expect, test, vi } from 'vitest';
import { mcpErr, mcpOk, runStdioMcpServer, type McpToolResult } from './mcpStdioServer';

async function* linesOf(...lines: string[]): AsyncIterable<string> {
  for (const l of lines) yield l;
}

function collectingIo(lines: string[]) {
  const written: string[] = [];
  return { lines: linesOf(...lines), write: (line: string) => written.push(line), written };
}

describe('mcpOk / mcpErr', () => {
  test('mcpOk wraps a string payload as-is', () => {
    expect(mcpOk('hello')).toEqual({ content: [{ type: 'text', text: 'hello' }] });
  });

  test('mcpOk JSON-stringifies a non-string payload', () => {
    const result = mcpOk({ a: 1 });
    expect(result.content[0].text).toBe(JSON.stringify({ a: 1 }, null, 2));
  });

  test('mcpErr sets isError and prefixes "Error: "', () => {
    expect(mcpErr('bad')).toEqual({ content: [{ type: 'text', text: 'Error: bad' }], isError: true });
  });
});

describe('runStdioMcpServer', () => {
  test('answers initialize with protocol/capabilities/serverInfo', async () => {
    const io = collectingIo([JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })]);
    await runStdioMcpServer({ serverName: 'maestro-test', tools: [], handleToolCall: () => mcpOk('n/a') }, io);
    const msg = JSON.parse(io.written[0]);
    expect(msg.result.serverInfo).toEqual({ name: 'maestro-test', version: '1.0.0' });
    expect(msg.result.capabilities).toEqual({ tools: {} });
  });

  test('notifications/initialized produces no reply', async () => {
    const io = collectingIo([JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })]);
    await runStdioMcpServer({ serverName: 's', tools: [], handleToolCall: () => mcpOk('n/a') }, io);
    expect(io.written.length).toBe(0);
  });

  test('tools/list returns the configured tool array', async () => {
    const tools = [{ name: 't1', description: 'd', inputSchema: { type: 'object' } }];
    const io = collectingIo([JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' })]);
    await runStdioMcpServer({ serverName: 's', tools, handleToolCall: () => mcpOk('n/a') }, io);
    expect(JSON.parse(io.written[0]).result.tools).toEqual(tools);
  });

  test('tools/call dispatches name+arguments to handleToolCall and returns its result', async () => {
    const handle = vi.fn().mockResolvedValue(mcpOk({ done: true }));
    const io = collectingIo([JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'x_tweet', arguments: { text: 'hi' } } })]);
    await runStdioMcpServer({ serverName: 's', tools: [], handleToolCall: handle }, io);
    expect(handle).toHaveBeenCalledWith('x_tweet', { text: 'hi' });
    expect(JSON.parse(io.written[0]).result).toEqual({ content: [{ type: 'text', text: JSON.stringify({ done: true }, null, 2) }] });
  });

  test('tools/call catches a throwing handler and surfaces "shim crashed" instead of crashing the loop', async () => {
    const io = collectingIo([JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'boom', arguments: {} } })]);
    await runStdioMcpServer({
      serverName: 's',
      tools: [],
      handleToolCall: () => {
        throw new Error('kaboom');
      },
    }, io);
    const result = JSON.parse(io.written[0]).result as McpToolResult;
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('shim crashed');
    expect(result.content[0].text).toContain('kaboom');
  });

  test('ping replies with an empty result', async () => {
    const io = collectingIo([JSON.stringify({ jsonrpc: '2.0', id: 5, method: 'ping' })]);
    await runStdioMcpServer({ serverName: 's', tools: [], handleToolCall: () => mcpOk('n/a') }, io);
    expect(JSON.parse(io.written[0])).toEqual({ jsonrpc: '2.0', id: 5, result: {} });
  });

  test('an unknown method with an id gets a JSON-RPC method-not-found error', async () => {
    const io = collectingIo([JSON.stringify({ jsonrpc: '2.0', id: 6, method: 'wat' })]);
    await runStdioMcpServer({ serverName: 's', tools: [], handleToolCall: () => mcpOk('n/a') }, io);
    const msg = JSON.parse(io.written[0]);
    expect(msg.error).toEqual({ code: -32601, message: 'Method not found: wat' });
  });

  test('an unknown method with no id produces no reply (a fire-and-forget notification)', async () => {
    const io = collectingIo([JSON.stringify({ jsonrpc: '2.0', method: 'wat' })]);
    await runStdioMcpServer({ serverName: 's', tools: [], handleToolCall: () => mcpOk('n/a') }, io);
    expect(io.written.length).toBe(0);
  });

  test('blank lines and malformed JSON lines are silently skipped', async () => {
    const io = collectingIo(['', '   ', 'not json at all', JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'ping' })]);
    await runStdioMcpServer({ serverName: 's', tools: [], handleToolCall: () => mcpOk('n/a') }, io);
    expect(io.written.length).toBe(1);
    expect(JSON.parse(io.written[0]).id).toBe(7);
  });
});
