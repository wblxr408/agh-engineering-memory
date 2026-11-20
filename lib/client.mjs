import { open } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { definitions, validateArguments } from './contracts.mjs';

const MAX_REQUEST = 1024 * 1024;
const MAX_RESPONSE = 8 * 1024 * 1024;
const unknownOutcome = 'Memory service disconnected, timed out or returned an invalid response; request outcome may be unknown. No automatic retry was made. Check save status or read the target before retrying a write.';

function noteIdentifier(value, project) {
  let relative = value;
  if (relative.startsWith('memory://')) {
    const prefix = `memory://${project}/`;
    if (!relative.startsWith(prefix)) throw new TypeError('Note must belong to the configured project');
    relative = relative.slice(prefix.length);
  } else if (relative.startsWith(`${project}/`)) relative = relative.slice(project.length + 1);
  if (!relative || relative.includes('\\') || relative.includes(':') || relative.includes('\0') || relative.split('/').some(part => !part || part === '.' || part === '..')) throw new TypeError('Use a project-relative note path or a memory URL in the configured project');
  return `${project}/${relative}`;
}

async function endpointAt(home) {
  let file;
  try {
    file = await open(join(home, 'resource-endpoint.json'), 'r');
    const buffer = Buffer.alloc(65537);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    if (bytesRead > 65536) throw new Error();
    const endpoint = JSON.parse(buffer.subarray(0, bytesRead).toString('utf8'));
    if (!Number.isInteger(endpoint.port) || endpoint.port < 1 || endpoint.port > 65535 || typeof endpoint.token !== 'string' || !endpoint.token || endpoint.token.length > 8192) throw new Error();
    return { port: endpoint.port, token: endpoint.token };
  } catch {
    throw new Error('Existing shared memory endpoint unavailable or invalid; business request not sent. Configure memoryHome and start the existing listener through its owner.');
  } finally { await file?.close(); }
}

function exchange(endpoint, message, timeoutMs, signal) {
  signal?.throwIfAborted();
  const bytes = Buffer.from(JSON.stringify({ token: endpoint.token, message }), 'utf8');
  if (bytes.length > MAX_REQUEST) throw new RangeError('Memory request exceeds 1 MiB; business request not sent');
  const frame = Buffer.allocUnsafe(bytes.length + 4);
  frame.writeUInt32BE(bytes.length);
  bytes.copy(frame, 4);
  return new Promise((resolve, reject) => {
    let sent = false, settled = false, buffer = Buffer.alloc(0), expected;
    const socket = createConnection({ host: '127.0.0.1', port: endpoint.port });
    const finish = (error, response) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      socket.destroy();
      if (error) reject(error); else resolve(response);
    };
    const abort = () => finish(new DOMException(sent ? 'Cancelled after send; request outcome may be unknown. No automatic retry was made.' : 'Cancelled before send', 'AbortError'));
    const timer = setTimeout(() => finish(new Error(sent ? unknownOutcome : 'Existing shared memory listener unavailable; business request not sent')), timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) { abort(); return; }
    socket.once('connect', () => {
      if (settled) return;
      sent = true;
      socket.write(frame);
    });
    socket.on('data', chunk => {
      if (settled) return;
      if (buffer.length + chunk.length > MAX_RESPONSE + 4) { finish(new Error('Memory response exceeds 8 MiB; request outcome may be unknown')); return; }
      buffer = Buffer.concat([buffer, chunk]);
      if (expected === undefined && buffer.length >= 4) {
        expected = buffer.readUInt32BE(0);
        if (expected < 1 || expected > MAX_RESPONSE) { finish(new Error('Memory response exceeds allowed frame budget; request outcome may be unknown')); return; }
      }
      if (expected === undefined || buffer.length < expected + 4) return;
      if (buffer.length !== expected + 4) { finish(new Error(unknownOutcome)); return; }
      try {
        const response = JSON.parse(buffer.subarray(4).toString('utf8'));
        if (response?.broker_error || response?.error) {
          const detail = String(response.broker_error ?? response.error?.message ?? '');
          const busy = /busy|queue deadline/i.test(detail);
          finish(new Error(busy ? 'Shared memory service busy; request not executed. No automatic retry was made. Retry a read when the existing service is idle.' : 'Shared memory service rejected this request; no automatic retry was made. Consult the service owner.'));
          return;
        }
        if (response?.jsonrpc !== '2.0' || response.id !== message.id || !response.result || !Array.isArray(response.result.content) || response.result.content.some(item => item?.type !== 'text' || typeof item.text !== 'string')) throw new Error();
        finish(null, response.result);
      } catch { finish(new Error(unknownOutcome)); }
    });
    socket.once('error', () => finish(new Error(sent ? unknownOutcome : 'Existing shared memory listener unavailable; business request not sent')));
    socket.once('close', () => { if (!settled) finish(new Error(unknownOutcome)); });
  });
}

export function createMemoryClient(config = {}) {
  const memoryHome = config.memoryHome ?? join(homedir(), '.codex', 'services', 'engineering-memory');
  const project = config.project ?? 'main';
  const timeoutMs = config.timeoutMs ?? 145000;
  if (typeof memoryHome !== 'string' || !isAbsolute(memoryHome)) throw new TypeError('memoryHome must be an absolute directory');
  if (typeof project !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(project)) throw new TypeError('project must be a simple project name');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 145000) throw new TypeError('timeoutMs must be between 1 and 145000');
  if (config.allowWrites !== undefined && typeof config.allowWrites !== 'boolean') throw new TypeError('allowWrites must be boolean');
  const allowWrites = config.allowWrites === true;
  return {
    allowWrites,
    async call(name, args, { signal, timeoutMs: callTimeout } = {}) {
      signal?.throwIfAborted();
      const definition = definitions.find(item => item.name === name);
      if (!definition) throw new TypeError('Unsupported memory operation');
      validateArguments(definition, args);
      if (name === 'bm_write' && !allowWrites) throw new Error('Writes are disabled; enable allowWrites in owner configuration');
      const forwarded = { ...args };
      if (name !== 'memory_write_status') forwarded.project = project;
      if (forwarded.identifier) forwarded.identifier = noteIdentifier(forwarded.identifier, project);
      if (name === 'bm_search') forwarded.mode ??= 'text';
      if (name === 'bm_write') forwarded.overwrite = false;
      const endpoint = await endpointAt(memoryHome);
      signal?.throwIfAborted();
      const id = randomUUID();
      const budget = Number.isFinite(callTimeout) && callTimeout > 0 ? Math.min(timeoutMs, callTimeout) : timeoutMs;
      return exchange(endpoint, { jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: forwarded }, _engineering_request_key: id }, budget, signal);
    },
  };
}
