import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createRemoteProxy, PUBLIC_MCP_URL } from '../dist/remoteProxy.js';

test('keyless bridge forwards discovery, calls, resources and prompts without client credentials', async () => {
  const originalFetch = globalThis.fetch;
  const originalTimeout = AbortSignal.timeout;
  // Scale only transport deadlines: a 160 ms fixture represents a 16 s response.
  AbortSignal.timeout = milliseconds => originalTimeout.call(AbortSignal, milliseconds / 100);
  const requests = [];
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), PUBLIC_MCP_URL);
    assert.equal(new Headers(init?.headers).has('authorization'), false);
    if (init?.method === 'GET') return new Response(null, { status: 405 });
    const request = JSON.parse(init.body);
    requests.push(request);
    if (request.id === undefined) return new Response(null, { status: 202 });
    if (request.method === 'tools/call') {
      await new Promise((resolve, reject) => {
        const onAbort = () => { clearTimeout(timer); reject(init.signal.reason); };
        const timer = setTimeout(() => {
          init.signal.removeEventListener('abort', onAbort);
          resolve();
        }, 160);
        init.signal.addEventListener('abort', onAbort, { once: true });
      });
    }
    let result;
    switch (request.method) {
      case 'initialize':
        result = { protocolVersion: '2025-03-26', serverInfo: { name: 'fixture-upstream', version: '1' }, capabilities: { tools: {}, resources: {}, prompts: {} } };
        break;
      case 'tools/list': result = { tools: [{ name: 'fixture_tool', inputSchema: { type: 'object' } }], nextCursor: 'upstream-cursor' }; break;
      case 'tools/call': result = { content: [{ type: 'text', text: JSON.stringify(request.params.arguments) }], structuredContent: { original: true } }; break;
      case 'resources/list': result = { resources: [{ uri: 'fixture://resource', name: 'Resource' }] }; break;
      case 'prompts/list': result = { prompts: [{ name: 'fixture_prompt' }] }; break;
      default: throw new Error(`Unexpected test method: ${request.method}`);
    }
    return Response.json({ jsonrpc: '2.0', id: request.id, result });
  };
  let server;
  const client = new Client({ name: 'fixture-local-client', version: '1' });
  try {
    server = await createRemoteProxy();
    const [local, downstream] = InMemoryTransport.createLinkedPair();
    await server.connect(downstream);
    await client.connect(local);
    const listed = await client.listTools();
    assert.equal(listed.tools[0].name, 'fixture_tool');
    assert.equal(listed.nextCursor, 'upstream-cursor');
    const args = { region: '부산 동래구', objL5: 'observed-code' };
    const called = await client.callTool({ name: 'fixture_tool', arguments: args });
    assert.deepEqual(JSON.parse(called.content[0].text), args);
    assert.deepEqual(called.structuredContent, { original: true });
    assert.equal((await client.listResources()).resources[0].uri, 'fixture://resource');
    assert.equal((await client.listPrompts()).prompts[0].name, 'fixture_prompt');
    assert.ok(requests.every(request => !JSON.stringify(request).includes('apiKey')));
  } finally {
    await client.close();
    await server?.close();
    globalThis.fetch = originalFetch;
    AbortSignal.timeout = originalTimeout;
  }
});

test('unavailable public upstream fails clearly rather than demanding a user API key', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('fixture-network-failure'); };
  try {
    await assert.rejects(createRemoteProxy(), error => {
      assert.match(error.message, /공개 원격 통계 서버/);
      assert.ok(!error.message.includes('fixture-network-failure'));
      assert.ok(!error.message.includes('KOSIS_API_KEY'));
      return true;
    });
  } finally { globalThis.fetch = originalFetch; }
});
