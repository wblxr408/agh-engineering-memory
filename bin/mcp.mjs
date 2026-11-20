#!/usr/bin/env node
import { createMemoryClient } from '../lib/client.mjs';
import { definitions } from '../lib/contracts.mjs';

// CLI values are owner configuration. The model cannot change the service directory or project.
const config = {};
for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (arg === '--allow-writes') config.allowWrites = true;
  else if (arg === '--memory-home') config.memoryHome = process.argv[++i];
  else if (arg === '--project') config.project = process.argv[++i];
  else throw new Error('Supported options: --memory-home ABSOLUTE_DIRECTORY --project NAME --allow-writes');
}
const client = createMemoryClient(config);
const reply = value => process.stdout.write(JSON.stringify(value) + '\n');
const controller = new AbortController();
process.once('SIGTERM', () => { controller.abort(); process.stdin.destroy(); });
process.once('SIGINT', () => { controller.abort(); process.stdin.destroy(); });

async function* lines(stream) {
  let pending = Buffer.alloc(0), oversized = false;
  for await (const chunk of stream) {
    let start = 0;
    while (start < chunk.length) {
      const newline = chunk.indexOf(10, start);
      const end = newline === -1 ? chunk.length : newline;
      const part = chunk.subarray(start, end);
      if (!oversized) {
        if (pending.length + part.length > 1024 * 1024) { pending = Buffer.alloc(0); oversized = true; }
        else pending = Buffer.concat([pending, part]);
      }
      if (newline !== -1) {
        yield oversized ? null : pending.toString('utf8');
        pending = Buffer.alloc(0); oversized = false;
      }
      start = newline === -1 ? chunk.length : newline + 1;
    }
  }
  if (pending.length || oversized) yield oversized ? null : pending.toString('utf8');
}
// Sequential dispatch makes each write receipt unambiguous and limits in-flight memory use.
for await (const line of lines(process.stdin)) {
  let message;
  try {
    if (line === null) throw new Error('MCP input exceeds 1 MiB');
    message = JSON.parse(line);
    if (!message || typeof message !== 'object' || Array.isArray(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string') throw new Error('Expected JSON-RPC request object');
    if (!Object.hasOwn(message, 'id')) continue;
    if (typeof message.id !== 'string' && typeof message.id !== 'number') throw new Error('Expected request id');
    let result;
    switch (message.method) {
      case 'initialize':
        result = { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'agh-engineering-memory', version: '0.1.0' } };
        break;
      case 'ping': result = {}; break;
      case 'tools/list': result = { tools: definitions.filter(d => d.name !== 'bm_write' || client.allowWrites).map(d => ({ name: d.name, description: d.description, inputSchema: d.inputSchema, annotations: { readOnlyHint: d.name !== 'bm_write', destructiveHint: d.name === 'bm_write', idempotentHint: d.name !== 'bm_write', openWorldHint: false } })) }; break;
      case 'tools/call':
        try { result = await client.call(message.params?.name, message.params?.arguments ?? {}, { signal: controller.signal }); }
        catch (error) { result = { isError: true, content: [{ type: 'text', text: error.message }] }; }
        break;
      default: reply({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Method not supported' } }); continue;
    }
    reply({ jsonrpc: '2.0', id: message.id, result });
  } catch (error) { reply({ jsonrpc: '2.0', id: message?.id ?? null, error: { code: error instanceof SyntaxError ? -32700 : -32600, message: 'Invalid or oversized JSON-RPC request' } }); }
}
