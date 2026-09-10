import assert from 'node:assert/strict';
import test from 'node:test';

process.env.KOSIS_API_KEY = 'metadata-pagination-server-key';

const { getCacheManager } = await import('../dist/cache/index.js');
const { getTableInfo } = await import('../dist/tools/getTableInfo.js');
const { KosisClient } = await import('../dist/api/client.js');

const originalFetch = globalThis.fetch;
let currentRows = [];
let mode = 'json';
const calls = [];

function metadataResponse(rows = currentRows) {
  const encoded = JSON.stringify(rows);
  const headers = new Headers({ 'content-length': String(new TextEncoder().encode(encoded).byteLength) });
  if (mode === 'stream') {
    const response = new Response(encoded, { headers });
    return { ok: true, status: 200, headers, body: response.body };
  }
  return {
    ok: true,
    status: 200,
    headers,
    body: null,
    async json() {
      return rows;
    },
  };
}

globalThis.fetch = async input => {
  const url = new URL(String(input));
  calls.push(url);
  if (url.searchParams.get('method') === 'getMeta') return metadataResponse();
  return {
    ok: true,
    status: 200,
    async json() {
      return [];
    },
  };
};

function reset(rows) {
  currentRows = rows;
  mode = 'json';
  calls.length = 0;
  getCacheManager().flush();
}

function bytes(value) {
  return new TextEncoder().encode(JSON.stringify({
    content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
  })).byteLength;
}

function fixtureRows(count = 8) {
  return [
    { OBJ_ID: 'REGION', ITM_ID: '10000', ITM_NM: '시군구', UP_ITM_ID: '', OBJ_ID_SN: '1', UNIT: '명' },
    { OBJ_ID: 'REGION', ITM_ID: '26010', ITM_NM: '부산', UP_ITM_ID: '10000', OBJ_ID_SN: '2', UNIT: '명' },
    { OBJ_ID: 'REGION', ITM_ID: '11010', ITM_NM: '서울', UP_ITM_ID: '10000', OBJ_ID_SN: '3', UNIT: '명' },
    { OBJ_ID: 'T지역', ITM_ID: 'T-4자리', ITM_NM: '4자리비기간', UP_ITM_ID: '', OBJ_ID_SN: '4', UNIT: '비율' },
    ...Array.from({ length: Math.max(0, count - 4) }, (_, index) => ({
      OBJ_ID: 'OTHER', ITM_ID: `X${index}`, ITM_NM: `항목 ${index}`, UP_ITM_ID: '', OBJ_ID_SN: String(index), UNIT: '건',
    })),
  ];
}

test('official ITM fields remain grouped without guessed dimension mappings', async () => {
  reset(fixtureRows());
  const result = await getTableInfo({ orgId: '101', tableId: 'TABLE', infoType: 'ITM', pageSize: 50 });
  assert.equal(result.success, true);
  assert.equal(result.totalCount, 8);
  assert.deepEqual(result.rawData.find(row => row.ITM_ID === '26010'), fixtureRows().find(row => row.ITM_ID === '26010'));
  assert.equal(result.classificationGroups.find(group => group.objId === 'REGION').items[0].UNIT, '명');
  assert.equal(result.metadataConfidence.dimensionMapping, 'unverified');
  assert.match(result.usageHint, /OBJ_ID_SN/);
  assert.doesNotMatch(result.usageHint, /00=전국|T1|objL1.*00/);
});

test('default and maximum page sizes, invalid values, and byte-aware packing are explicit', async () => {
  reset(fixtureRows(60));
  const defaultPage = await getTableInfo({ orgId: '101', tableId: 'TABLE', infoType: 'ITM' });
  assert.equal(defaultPage.returnedCount, 50);
  const maxPage = await getTableInfo({ orgId: '101', tableId: 'TABLE', infoType: 'ITM', pageSize: 200 });
  assert.equal(maxPage.success, true);
  assert.ok(maxPage.returnedCount <= 200);
  assert.ok(bytes(maxPage) <= 32768);
  const invalid = await getTableInfo({ orgId: '101', tableId: 'TABLE', infoType: 'ITM', pageSize: 0 });
  assert.equal(invalid.success, false);
  assert.equal(invalid.errorCode, 'INVALID_PAGE_SIZE');
});

test('Korean byte boundaries and an oversized individual row are not truncated', async () => {
  const boundary = { OBJ_ID: 'A', ITM_ID: 'BOUNDARY', ITM_NM: '가'.repeat(5000), UP_ITM_ID: '', OBJ_ID_SN: '1', UNIT: '명' };
  reset([boundary, { OBJ_ID: 'A', ITM_ID: 'SECOND', ITM_NM: '둘째', UP_ITM_ID: '', OBJ_ID_SN: '2', UNIT: '명' }]);
  const page = await getTableInfo({ orgId: '101', tableId: 'TABLE', infoType: 'ITM', pageSize: 50 });
  assert.equal(page.rawData[0].ITM_NM, boundary.ITM_NM);
  assert.ok(bytes(page) <= 32768);

  const oversized = { ...boundary, ITM_ID: 'OVERSIZED', ITM_NM: '나'.repeat(20000) };
  reset([oversized]);
  const error = await getTableInfo({ orgId: '101', tableId: 'TABLE', infoType: 'ITM', pageSize: 50 });
  assert.equal(error.success, false);
  assert.equal(error.errorCode, 'SIZE_ERROR');
  assert.match(error.errorMessage, /32768|필터/);
  assert.equal('rawData' in error, false);
});

test('all pages are disjoint and preserve every source row after cache flushes', async () => {
  const rows = fixtureRows(17);
  reset(rows);
  const seen = [];
  let cursor;
  do {
    getCacheManager().flush();
    const page = await getTableInfo({ orgId: '101', tableId: 'TABLE', infoType: 'ITM', pageSize: 3, cursor });
    assert.equal(page.success, true);
    seen.push(...page.rawData.map(row => row.ITM_ID));
    cursor = page.nextCursor;
  } while (cursor);
  assert.equal(new Set(seen).size, rows.length);
  assert.deepEqual([...seen].sort(), rows.map(row => row.ITM_ID).sort());
});

test('cursor is bound to query, table, page size, and its signature', async () => {
  reset(fixtureRows(8));
  const first = await getTableInfo({ orgId: '101', tableId: 'TABLE', infoType: 'ITM', pageSize: 2 });
  assert.ok(first.nextCursor);
  assert.doesNotMatch(first.nextCursor, /metadata-pagination-server-key/);
  for (const altered of [
    { query: '부산' },
    { tableId: 'OTHER' },
    { pageSize: 3 },
    { cursor: `${first.nextCursor.slice(0, -1)}x` },
  ]) {
    const result = await getTableInfo({ orgId: '101', tableId: altered.tableId ?? 'TABLE', infoType: 'ITM', pageSize: altered.pageSize ?? 2, query: altered.query, cursor: altered.cursor ?? first.nextCursor });
    assert.equal(result.success, false);
    assert.equal(result.errorCode, 'INVALID_CURSOR');
  }
});

test('same snapshot continues across cache flush, changed snapshot requires restart', async () => {
  const rows = fixtureRows(8);
  reset(rows);
  const first = await getTableInfo({ orgId: '101', tableId: 'TABLE', infoType: 'ITM', pageSize: 2 });
  getCacheManager().flush();
  const second = await getTableInfo({ orgId: '101', tableId: 'TABLE', infoType: 'ITM', pageSize: 2, cursor: first.nextCursor });
  assert.equal(second.success, true);
  assert.equal(second.snapshot, first.snapshot);

  currentRows = [...rows, { OBJ_ID: 'A', ITM_ID: 'NEW', ITM_NM: '새 항목', UP_ITM_ID: '', OBJ_ID_SN: '9', UNIT: '명' }];
  getCacheManager().flush();
  const changed = await getTableInfo({ orgId: '101', tableId: 'TABLE', infoType: 'ITM', pageSize: 2, cursor: first.nextCursor });
  assert.equal(changed.success, false);
  assert.equal(changed.errorCode, 'RESTART_REQUIRED');
});

test('metadata filters are local and client ITM options reach upstream separately', async () => {
  reset(fixtureRows());
  const filtered = await getTableInfo({ orgId: '101', tableId: 'TABLE', infoType: 'ITM', objId: 'REGION', parentId: '10000', query: '부산' });
  assert.equal(filtered.totalCount, 1);
  assert.equal(filtered.rawData[0].ITM_ID, '26010');

  calls.length = 0;
  await new KosisClient('direct-key').getTableMeta('101', 'TABLE', 'ITM', { objId: 'REGION', itmId: '26010' });
  assert.equal(calls.at(-1).searchParams.get('objId'), 'REGION');
  assert.equal(calls.at(-1).searchParams.get('itmId'), '26010');
});

test('metadata budget is bounded while normal statistics data remains on request()', async () => {
  mode = 'stream';
  currentRows = [{ OBJ_ID: 'A', ITM_ID: 'HUGE', ITM_NM: 'x'.repeat(4 * 1024 * 1024) }];
  getCacheManager().flush();
  const tooLarge = await getTableInfo({ orgId: '101', tableId: 'TABLE', infoType: 'ITM' });
  assert.equal(tooLarge.success, false);
  assert.equal(tooLarge.errorCode, 'METADATA_TOO_LARGE');

  globalThis.fetch = async input => {
    const url = new URL(String(input));
    calls.push(url);
    return { ok: true, status: 200, async json() { return []; } };
  };
  const data = await new KosisClient('direct-key').getStatisticsData({ orgId: '101', tblId: 'TABLE', prdSe: 'Y' });
  assert.deepEqual(data, []);
});

test.after(() => {
  globalThis.fetch = originalFetch;
  getCacheManager().flush();
});
