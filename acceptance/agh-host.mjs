// Run with a matching AGH source tree and its installed tsx; see docs/verification.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { main } from '../index.mjs';

const source = process.env.AGH_SOURCE_ROOT;
if (!source) throw new Error('Set AGH_SOURCE_ROOT to a matching AGH source tree with installed development dependencies');
const { createPluginTestHost } = await import(pathToFileURL(resolve(source, 'packages/host/testkit/author/index.ts')).href);

test('AGH native registration reads original evidence and refuses project overrides', async t => {
  const home = await mkdtemp(join(tmpdir(), 'agh-host-memory-'));
  let count = 0;
  const server = createServer(socket => {
    let input = Buffer.alloc(0);
    socket.on('data', chunk => {
      input = Buffer.concat([input, chunk]);
      if (input.length < 4 || input.length < input.readUInt32BE(0) + 4) return;
      const { message } = JSON.parse(input.subarray(4));
      count++;
      assert.equal(message.params.arguments.project, 'main');
      const payload = Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { content: [{ type: 'text', text: '周五 17:30；纠正此前周四的安排。' }] } }));
      const header = Buffer.alloc(4); header.writeUInt32BE(payload.length);
      socket.end(Buffer.concat([header, payload]));
    });
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  await writeFile(join(home, 'resource-endpoint.json'), JSON.stringify({ port: server.address().port, token: 'fixture' }));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await rm(home, { recursive: true, force: true }); });
  const skills = [];
  const fixture = await createPluginTestHost(main, {
    packageDir: fileURLToPath(new URL('../', import.meta.url)), config: { memoryHome: home },
    services: { skills: { register(value) { skills.push(value); return () => {}; } } },
  });
  try {
    const read = await fixture.invoke('engineering_memory_read', { identifier: 'decisions/delivery' });
    assert.equal(read.content[0].text, '周五 17:30；纠正此前周四的安排。');
    await assert.rejects(fixture.invoke('engineering_memory_read', { identifier: 'decisions/delivery', project: 'other' }));
    await assert.rejects(fixture.invoke('engineering_memory_save', { identifier: 'x', content: 'x' }), /not registered/);
    assert.equal(count, 1);
    assert.equal(skills.length, 1);
  } finally { await fixture.dispose(); }
});
