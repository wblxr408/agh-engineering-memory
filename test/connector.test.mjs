import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { createMemoryClient } from '../lib/client.mjs';

// Protocol fixture, not a replacement for the live-service acceptance documented in docs/verification.md.
async function broker(t, handler) {
  const home = await mkdtemp(join(tmpdir(), 'agh-memory-test-'));
  const calls = [];
  const sockets = new Set();
  const server = createServer(socket => {
    sockets.add(socket);
    socket.on('error', () => {});
    socket.on('close', () => sockets.delete(socket));
    let input = Buffer.alloc(0);
    socket.on('data', chunk => {
      input = Buffer.concat([input, chunk]);
      if (input.length < 4 || input.length < input.readUInt32BE(0) + 4) return;
      const request = JSON.parse(input.subarray(4).toString('utf8'));
      calls.push(request);
      assert.equal(request.token, 'fixture-token-not-a-credential');
      handler(request.message, socket, value => {
        const body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: request.message.id, result: value }));
        const frame = Buffer.alloc(4 + body.length);
        frame.writeUInt32BE(body.length);
        body.copy(frame, 4);
        // Deliberately fragment the response so unicode and framing cross chunk boundaries.
        socket.write(frame.subarray(0, 5));
        socket.end(frame.subarray(5));
      });
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  await writeFile(join(home, 'resource-endpoint.json'), JSON.stringify({ port: server.address().port, token: 'fixture-token-not-a-credential' }));
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => server.close(resolve));
    await rm(home, { recursive: true, force: true });
  });
  return { home, calls };
}

test('search then read preserves the latest correction and exact Chinese source', async t => {
  const source = '## 最新纠正\n交付时间：周五 17:30；撤销此前周四的安排。\n关键原文：保持原文、标点与版本。';
  const b = await broker(t, (message, socket, respond) => {
    const { name, arguments: args } = message.params;
    assert.equal(args.project, 'main');
    if (name === 'bm_search') {
      assert.equal(args.mode, 'text');
      assert.equal(args.include_history, true);
      respond({ content: [{ type: 'text', text: 'memory://main/decisions/delivery' }] });
    } else {
      assert.equal(name, 'bm_read');
      assert.equal(args.identifier, 'main/decisions/delivery');
      respond({ content: [{ type: 'text', text: source }] });
    }
  });
  const client = createMemoryClient({ memoryHome: b.home });
  const result = await client.call('bm_search', { query: '交付时间', include_history: true });
  assert.equal(result.content[0].text, 'memory://main/decisions/delivery');
  const read = await client.call('bm_read', { identifier: 'decisions/delivery' });
  assert.equal(read.content[0].text, source);
  assert.notEqual(b.calls[0].message.id, b.calls[1].message.id);
});

test('save is opt-in, create-only, and a queued receipt stays queued until status confirms', async t => {
  const b = await broker(t, (message, socket, respond) => {
    if (message.params.name === 'bm_write') {
      assert.equal(message.params.arguments.overwrite, false);
      assert.equal(message.params.arguments.identifier, 'main/decisions/release.md');
      respond({ content: [{ type: 'text', text: '{"status":"queued","write_id":"save-1"}' }] });
    } else respond({ content: [{ type: 'text', text: '{"status":"saved","write_id":"save-1"}' }] });
  });
  await assert.rejects(createMemoryClient({ memoryHome: b.home }).call('bm_write', { identifier: 'decisions/release.md', content: 'source' }), /Writes are disabled/);
  const client = createMemoryClient({ memoryHome: b.home, allowWrites: true });
  const queued = await client.call('bm_write', { identifier: 'decisions/release.md', content: 'source' });
  assert.equal(JSON.parse(queued.content[0].text).status, 'queued');
  const saved = await client.call('memory_write_status', { write_id: 'save-1' });
  assert.equal(JSON.parse(saved.content[0].text).status, 'saved');
  assert.equal(b.calls.length, 2);
});

test('a lost write response is never retried and reports an unknown outcome', async t => {
  const b = await broker(t, (_message, socket) => socket.destroy());
  const client = createMemoryClient({ memoryHome: b.home, allowWrites: true });
  await assert.rejects(client.call('bm_write', { identifier: 'decisions/new.md', content: 'one effect' }), /outcome may be unknown/);
  assert.equal(b.calls.length, 1);
});

test('rejects project overrides, traversal, extra arguments and unknown tools before sending', async t => {
  const b = await broker(t, () => assert.fail('invalid request reached service'));
  const client = createMemoryClient({ memoryHome: b.home, allowWrites: true });
  for (const [name, args] of [
    ['bm_search', { query: 'x', project: 'other' }],
    ['bm_read', { identifier: '../private' }],
    ['bm_read', { identifier: 'memory://other/note' }],
    ['bm_write', { identifier: 'x', content: 'x', overwrite: true }],
    ['bm_delete', { identifier: 'x' }],
    ['bm_search', { query: 'x', page_size: 101 }],
  ]) await assert.rejects(client.call(name, args));
  assert.equal(b.calls.length, 0);
});

test('cancellation and timeouts close the request without replaying', async t => {
  let received;
  const arrival = new Promise(resolve => { received = resolve; });
  const b = await broker(t, () => received());
  const controller = new AbortController();
  const call = createMemoryClient({ memoryHome: b.home }).call('bm_search', { query: 'x' }, { signal: controller.signal });
  await arrival;
  controller.abort();
  await assert.rejects(call, { name: 'AbortError' });
  await assert.rejects(createMemoryClient({ memoryHome: b.home, timeoutMs: 30 }).call('bm_search', { query: 'x' }), /outcome may be unknown/);
  assert.equal(b.calls.length, 2);
});

test('malformed oversized responses and broker errors do not disclose endpoint credentials', async t => {
  const b = await broker(t, (_message, socket) => {
    const header = Buffer.alloc(4);
    header.writeUInt32BE(8 * 1024 * 1024 + 1);
    socket.end(header);
  });
  await assert.rejects(createMemoryClient({ memoryHome: b.home }).call('bm_search', { query: 'x' }), /response exceeds/);
  const e = await broker(t, (message, socket) => {
    const body = Buffer.from(JSON.stringify({ broker_error: 'private fixture-token-not-a-credential details' }));
    const header = Buffer.alloc(4);
    header.writeUInt32BE(body.length);
    socket.end(Buffer.concat([header, body]));
  });
  await assert.rejects(createMemoryClient({ memoryHome: e.home }).call('bm_search', { query: 'x' }), error => {
    assert.equal(error.message.includes('fixture-token'), false);
    return true;
  });
});

test('Antigravity stdio session reads original evidence, refuses writes and recovers after oversized input', { timeout: 10000 }, async t => {
  const original = '最新纠正：改为周五。关键原文必须保留：A、B；C。';
  const b = await broker(t, (message, _socket, respond) => {
    assert.equal(message.params.name, 'bm_read');
    assert.equal(message.params.arguments.identifier, 'main/decisions/delivery');
    respond({ content: [{ type: 'text', text: original }] });
  });
  const child = spawn(process.execPath, [fileURLToPath(new URL('../bin/mcp.mjs', import.meta.url)), '--memory-home', b.home], { stdio: ['pipe', 'pipe', 'pipe'] });
  const waiting = new Map();
  const lines = createInterface({ input: child.stdout });
  let next = 0;
  lines.on('line', line => {
    const response = JSON.parse(line);
    const resolve = waiting.get(response.id);
    waiting.delete(response.id);
    resolve?.(response);
  });
  t.after(() => { lines.close(); child.kill(); });
  const send = (method, params) => {
    const id = ++next;
    const received = new Promise(resolve => waiting.set(id, resolve));
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    return received;
  };
  await send('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'acceptance', version: '1' } });
  const read = await send('tools/call', { name: 'bm_read', arguments: { identifier: 'memory://main/decisions/delivery' } });
  assert.equal(read.result.content[0].text, original);
  const refused = await send('tools/call', { name: 'bm_write', arguments: { identifier: 'new', content: 'unauthorized write' } });
  assert.equal(refused.result.isError, true);
  const oversized = new Promise(resolve => waiting.set(null, resolve));
  child.stdin.write('x'.repeat(1024 * 1024 + 1) + '\n');
  assert.equal((await oversized).error.code, -32600);
  const after = await send('tools/call', { name: 'bm_read', arguments: { identifier: 'decisions/delivery' } });
  assert.equal(after.result.content[0].text, original);
  assert.equal(b.calls.length, 2);
  child.stdin.end();
  const [code] = await once(child, 'exit');
  assert.equal(code, 0);
});
