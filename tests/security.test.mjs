import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { inspect } from 'node:util';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { version: packageVersion } = require('../package.json');
const sentinel = 'test-only-operator-key-not-a-real-credential';
process.env.KOSIS_API_KEY = sentinel;
process.env.DOTENV_CONFIG_PATH = '/nonexistent-korea-stats-test-env';
const { KosisClient } = await import('../dist/api/client.js');

function configProcess(key) {
  const env = { ...process.env, DOTENV_CONFIG_PATH: '/nonexistent-korea-stats-test-env' };
  if (key === undefined) delete env.KOSIS_API_KEY;
  else env.KOSIS_API_KEY = key;
  return spawnSync(process.execPath, ['--input-type=module', '-e',
    "import {config,validateConfig} from './dist/config/index.js'; validateConfig(); console.log(config.kosis.apiKey === process.env.KOSIS_API_KEY.trim() ? 'configured' : 'mismatch');"
  ], { env, encoding: 'utf8' });
}

test('local configuration requires an operator/user environment key, not a bundled default', () => {
  for (const key of [undefined, '', '   ']) {
    const result = configProcess(key);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /KOSIS_API_KEY/);
  }
  const result = configProcess(` ${sentinel} `);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /configured/);
  assert.ok(!`${result.stdout}${result.stderr}`.includes(sentinel));
});

test('missing client credentials fail before any upstream request', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('unexpected'); };
  try {
    await assert.rejects(new KosisClient('').getStatisticsList('MT_ZTITLE'), { code: 'INVALID_API_KEY' });
    assert.equal(calls, 0);
  } finally { globalThis.fetch = original; }
});

test('upstream credentials and error bodies never survive in returned error objects', async () => {
  const original = globalThis.fetch;
  const client = new KosisClient(sentinel);
  const failures = [
    async () => new Response(JSON.stringify({ err: sentinel, errMsg: `apiKey=${sentinel}` })),
    async () => new Response('', { status: 403, statusText: sentinel }),
    async () => { throw new Error(`https://example.test/?apiKey=${sentinel}`); },
  ];
  try {
    for (const failure of failures) {
      globalThis.fetch = failure;
      await assert.rejects(client.getStatisticsList('MT_ZTITLE'), error => {
        assert.ok(!inspect(error).includes(sentinel));
        assert.ok(!JSON.stringify(error).includes(sentinel));
        assert.equal(error.originalError, undefined);
        return true;
      });
    }
  } finally { globalThis.fetch = original; }
});

test('operator key reaches only upstream while successful public data is preserved', async () => {
  const original = globalThis.fetch;
  const rows = [{ ORG_ID: '101', TBL_ID: 'test-table', TBL_NM: '테스트' }];
  globalThis.fetch = async url => {
    assert.equal(new URL(url).searchParams.get('apiKey'), sentinel);
    return Response.json(rows);
  };
  try {
    assert.deepEqual(await new KosisClient().getStatisticsList('MT_ZTITLE'), rows);
  } finally { globalThis.fetch = original; }
});

test('remote MCP accepts anonymous discovery and data calls using only the operator key', async () => {
  const { default: handler } = await import('../api/mcp.ts');
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString();
    req.body = raw ? JSON.parse(raw) : undefined;
    res.status = code => { res.statusCode = code; return res; };
    res.json = value => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)); return res; };
    await handler(req, res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/mcp`;
  const originalFetch = globalThis.fetch;
  let upstreamCalls = 0;
  globalThis.fetch = async (input, options) => {
    const target = new URL(String(input));
    if (target.hostname === 'kosis.kr') {
      upstreamCalls++;
      assert.equal(target.searchParams.get('apiKey'), sentinel);
      if (target.searchParams.get('method') === 'getMeta') {
        return Response.json([{ OBJ_ID: 'A', OBJ_NM: '행정구역', ITM_ID: '26260', ITM_NM: '동래구', UP_ITM_ID: '26', OBJ_ID_SN: '1' }]);
      }
      return Response.json([{ ORG_ID: '101', TBL_ID: 'test-table', TBL_NM: '공개 통계' }]);
    }
    if (target.hostname === 'mdis.mods.go.kr') {
      assert.equal(target.searchParams.has('apiKey'), false);
      assert.equal(new Headers(options?.headers).has('authorization'), false);
      const html = target.pathname === '/'
        ? '<html><title>MDIS</title></html>'
        : '<html><div class="board_list"><table><tbody><tr class="notice"><td><a class="underline" id="STAT_47">경제활동인구조사</a></td></tr></tbody></table></div></html>';
      return new Response(html, { headers: { 'Content-Type': 'text/html' } });
    }
    return originalFetch(input, options);
  };
  try {
    for (const [id, method, params, expectedError] of [
      [1, 'initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'anonymous-test', version: '1' } }],
      [2, 'tools/list', {}],
      [3, 'tools/call', { name: 'get_statistics_list', arguments: { viewCode: 'MT_ZTITLE', parentId: 'anonymous-security-test' } }],
      [4, 'tools/call', { name: 'get_table_info', arguments: { orgId: '101', tableId: 'test-table', infoType: 'ITM' } }],
      [5, 'tools/call', { name: 'search_microdata', arguments: { query: '경제활동인구조사' } }],
      [6, 'tools/call', { name: 'search_businesses', arguments: { regionType: 'signguCd' } }, true],
      [7, 'tools/call', { name: 'search_microdata', arguments: { keyword: '경제활동인구조사' } }, true],
      [8, 'tools/call', { name: 'search_businesses', arguments: { regionType: 'signguCd', regionCode: '26260', industryCodeTypo: 'G204' } }, true],
      [9, 'tools/call', { name: 'get_indicator', arguments: { indicatorId: '123', kind: 'definition', startPeriod: '2023' } }, true],
    ]) {
      const response = await fetch(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
      });
      assert.equal(response.status, 200);
      const body = await response.text();
      assert.ok(!body.includes(sentinel));
      const result = JSON.parse(body);
      assert.ok(result.result);
      if (method === 'initialize') {
        assert.equal(result.result.serverInfo.version, packageVersion);
      }
      if (method === 'tools/list') {
        for (const name of ['get_statistics_data', 'get_table_info', 'search_indicators', 'get_indicator', 'search_businesses', 'search_microdata', 'get_microdata_info']) {
          assert.ok(result.result.tools.some(tool => tool.name === name), `Missing tool: ${name}`);
        }
      }
      if (method === 'tools/call') {
        if (expectedError) {
          assert.equal(result.result.isError, true);
          continue;
        }
        assert.notEqual(result.result.isError, true);
        const data = JSON.parse(result.result.content[0].text);
        assert.equal(data.success, true);
        if (params.name === 'get_statistics_list') {
          assert.equal(data.items[0].name, '공개 통계');
          assert.equal(upstreamCalls, 1);
        } else if (params.name === 'search_microdata') {
          assert.equal(data.items[0].survId, '47');
          assert.equal(data.items[0].name, '경제활동인구조사');
        } else {
          assert.equal(data.rawData[0].ITM_ID, '26260');
          assert.equal(data.totalCount, 1);
          assert.equal(data.hasMore, false);
          assert.ok(Buffer.byteLength(JSON.stringify(result.result)) <= 32768);
        }
      }
      assert.equal(response.headers.get('mcp-session-id'), null);
    }
    assert.equal((await fetch(url, { method: 'OPTIONS' })).status, 200);
    const denied = await fetch(url);
    assert.equal(denied.status, 405);
    assert.equal(denied.headers.get('allow'), 'POST');
  } finally {
    globalThis.fetch = originalFetch;
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test('unexpected upstream envelopes fail instead of masquerading as empty statistics', async () => {
  const original = globalThis.fetch;
  const client = new KosisClient(sentinel);
  try {
    for (const body of [null, {}, { unexpected: [] }, 'invalid']) {
      globalThis.fetch = async () => Response.json(body);
      await assert.rejects(client.getStatisticsList('MT_ZTITLE'), { code: 'INVALID_RESPONSE' });
      await assert.rejects(client.getTableMeta('101', 'TABLE', 'ITM'), { code: 'INVALID_RESPONSE' });
    }
    for (const body of [[], { result: [] }]) {
      globalThis.fetch = async () => Response.json(body);
      assert.deepEqual(await client.getStatisticsList('MT_ZTITLE'), []);
      assert.deepEqual(await client.getTableMeta('101', 'TABLE', 'ITM'), []);
    }
  } finally { globalThis.fetch = original; }
});

test('npm stdio transport still initializes and exposes the callable metadata tool', async () => {
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['dist/index.js'],
    env: { ...process.env, KOSIS_API_KEY: sentinel },
    stderr: 'pipe',
  });
  const client = new Client({ name: 'stdio-security-test', version: '1' });
  try {
    await client.connect(transport);
    assert.equal(client.getServerVersion()?.version, packageVersion);
    const listed = await client.listTools();
    assert.ok(listed.tools.some(tool => tool.name === 'get_table_info'));
    const result = await client.callTool({
      name: 'get_table_info',
      arguments: { orgId: '101', tableId: 'TABLE', pageSize: 0 },
    });
    assert.equal(result.isError, true);
    assert.ok(!JSON.stringify(result).includes(sentinel));
  } finally { await client.close(); }
});
