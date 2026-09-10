import assert from 'node:assert/strict';
import test from 'node:test';

process.env.KOSIS_API_KEY = 'bulk-data-test-key';

const { getStatisticsData } = await import('../dist/tools/getStatisticsData.js');
const { boundedStatisticsDataError, periodLabel } = await import('../dist/utils/statisticsDataPage.js');
const { getCacheManager } = await import('../dist/cache/index.js');

const originalFetch = globalThis.fetch;
const calls = [];
const row = (period, value, extra = {}) => ({
  ORG_ID: '101',
  TBL_ID: 'BULK',
  TBL_NM: 'Bulk table',
  C1: 'A',
  C1_NM: 'A',
  ITM_ID: 'ITEM',
  ITM_NM: 'Item',
  UNIT_NM: '명',
  PRD_SE: 'Y',
  PRD_DE: period,
  DT: value,
  ...extra,
});

function clear() {
  calls.length = 0;
  getCacheManager().flush();
}

function response(rows, headers = {}) {
  return { ok: true, status: 200, headers: { get: (key) => headers[key] ?? null }, async json() { return rows; } };
}

const finiteInput = (overrides = {}) => ({
  orgId: '101', tableId: 'BULK', objL1: 'A', itemId: 'ITEM', periodType: 'Y',
  startPeriod: '2020', endPeriod: '2021', ...overrides,
});
const wireBytes = (result) => Buffer.byteLength(JSON.stringify({
  content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
}));

test('finite overflow bisects disjoint periods and resumes every row exactly once', async () => {
  clear();
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    calls.push(url);
    assert.equal(url.searchParams.has('pageSize'), false);
    assert.equal(url.searchParams.has('cursor'), false);
    const start = url.searchParams.get('startPrdDe');
    const end = url.searchParams.get('endPrdDe');
    if (start === '2020' && end === '2023') return response([], { 'content-length': '4194305' });
    return response([
      row(start, start),
      ...(start !== end ? [row(end, end)] : []),
    ].filter((item, index, all) => all.findIndex((candidate) => candidate.PRD_DE === item.PRD_DE) === index));
  };

  const input = {
    orgId: '101', tableId: 'BULK', objL1: 'A', itemId: 'ITEM', periodType: 'Y',
    startPeriod: '2020', endPeriod: '2023', pageSize: 2,
  };
  const pages = [];
  let page = await getStatisticsData(input);
  pages.push(page);
  while (page.hasMore) {
    page = await getStatisticsData({ ...input, cursor: page.nextCursor });
    pages.push(page);
  }

  assert.equal(pages[0].continuationReason, 'partition_split');
  assert.deepEqual(pages.flatMap((item) => item.data).map((item) => item.rawPeriod), ['2020', '2021', '2022', '2023']);
  assert.equal(pages.at(-1).completion, 'complete');
  assert.equal(pages.at(-1).completionScope, 'requested_period_traversal');
  assert.equal(pages.at(-1).aggregateRowCount, 4);
  assert.equal(pages.at(-1).providerTotalCount, null);
  assert.equal(pages.at(-1).providerSnapshot, 'unproven');
  assert.ok(calls.length >= 3);
});

test('a raw observation that cannot fit the MCP wrapper fails without truncation', async () => {
  clear();
  globalThis.fetch = async () => response([row('2020', 'x', { NOTE: '한글'.repeat(10_000) })]);
  const result = await getStatisticsData({
    orgId: '101', tableId: 'BULK', objL1: 'A', itemId: 'ITEM', periodType: 'Y',
    startPeriod: '2020', endPeriod: '2020',
  });
  assert.equal(result.success, false);
  assert.equal(result.errorCode, 'OUTPUT_ROW_TOO_LARGE');
  assert.ok(Buffer.byteLength(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] })) <= 32768);
});

test('split intervals retain empty and boundary-gap failures', async () => {
  for (const partial of [[], [row('2021', '1')]]) {
    clear();
    globalThis.fetch = async (input) => {
      const url = new URL(String(input));
      return url.searchParams.get('endPrdDe') === '2023'
        ? response([], { 'content-length': '4194305' })
        : response(partial);
    };
    const input = finiteInput({ endPeriod: '2023' });
    const progress = await getStatisticsData(input);
    assert.equal(progress.continuationReason, 'partition_split');
    const result = await getStatisticsData({ ...input, cursor: progress.nextCursor });
    assert.equal(result.success, false);
    assert.equal(result.errorCode, 'response_incomplete');
    assert.equal(result.completion, 'unproven');
    assert.equal(result.hasMore, false);
    assert.equal(result.data.length, partial.length);
  }
});

test('atomic period overflow cannot become a successful empty traversal', async () => {
  clear();
  globalThis.fetch = async () => response([], { 'content-length': '4194305' });
  const result = await getStatisticsData(finiteInput({ endPeriod: '2020' }));
  assert.equal(result.success, false);
  assert.equal(result.errorCode, 'ATOMIC_PERIOD_TOO_LARGE');
  assert.equal(result.nextCursor, null);
  assert.ok(wireBytes(result) <= 32768);
});

test('active partition replay detects changed provider observations', async () => {
  clear();
  let value = '1';
  globalThis.fetch = async () => response([row('2020', '0'), row('2021', value)]);
  const input = finiteInput({ pageSize: 1 });
  const first = await getStatisticsData(input);
  assert.equal(first.hasMore, true);
  value = '2';
  const changed = await getStatisticsData({ ...input, cursor: first.nextCursor });
  assert.equal(changed.success, false);
  assert.equal(changed.errorCode, 'RESTART_REQUIRED');
  assert.deepEqual(changed.data, []);
  assert.equal(changed.nextCursor, null);
  const restarted = await getStatisticsData(input);
  const completed = await getStatisticsData({ ...input, cursor: restarted.nextCursor });
  assert.equal(completed.success, true);
  assert.equal(completed.completion, 'complete');
  assert.equal(completed.data[0].rawValue, '2');
});

test('canonical replay is stable under provider ordering and terminal pages stay page scoped', async () => {
  clear();
  let reverse = false;
  globalThis.fetch = async () => {
    reverse = !reverse;
    const rows = [row('2020', '0'), row('2021', '1')];
    return response(reverse ? rows.reverse() : rows);
  };
  const input = finiteInput({ pageSize: 1 });
  const first = await getStatisticsData(input);
  const second = await getStatisticsData({ ...input, cursor: first.nextCursor });
  const replay = await getStatisticsData({ ...input, cursor: first.nextCursor });
  assert.equal(second.success, true);
  assert.deepEqual(second.data, replay.data);
  assert.equal(second.returnedCount, 1);
  assert.equal(second.emittedCount, 2);
  assert.equal(second.aggregateRowCount, 2);
  assert.equal(second.completionScope, 'requested_period_traversal');
  assert.equal(second.visualization, undefined);
  assert.equal(second.providerSnapshot, 'unproven');
});

test('UTF-8 observation pages fit the actual indented MCP wrapper', async () => {
  clear();
  globalThis.fetch = async () => response(
    ['2020', '2021', '2022'].map(period => row(period, '1', { NOTE: '한'.repeat(6000) }))
  );
  const input = finiteInput({ endPeriod: '2022', pageSize: 200 });
  const observed = [];
  let cursor;
  for (let count = 0; count < 4; count++) {
    const result = await getStatisticsData({ ...input, cursor });
    assert.equal(result.success, true);
    assert.ok(wireBytes(result) <= 32768);
    observed.push(...result.data.map(item => item.rawPeriod));
    if (!result.hasMore) break;
    assert.ok(result.nextCursor);
    cursor = result.nextCursor;
  }
  assert.deepEqual(observed, ['2020', '2021', '2022']);
});

test('large incomplete evidence is explicitly bounded rather than called complete', async () => {
  clear();
  globalThis.fetch = async () => response(
    Array.from({ length: 20 }, (_, i) => row(String(2020 + i), '1', { NOTE: '한'.repeat(3000) }))
  );
  const result = await getStatisticsData(finiteInput({ endPeriod: '2040' }));
  assert.equal(result.success, false);
  assert.equal(result.errorCode, 'response_incomplete');
  assert.equal(result.observedEvidenceCount, 20);
  assert.equal(result.evidenceTruncated, true);
  assert.equal(result.returnedEvidenceCount, result.data.length);
  assert.ok(result.data.length < 20);
  assert.ok(wireBytes(result) <= 32768);
});

test('every selector and page size are cursor-bound without provider pagination parameters', async () => {
  clear();
  const dimensions = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`objL${i + 1}`, `L${i + 1}`]));
  const rawDimensions = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`C${i + 1}`, `L${i + 1}`]));
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    calls.push(url);
    for (const [name, value] of Object.entries(dimensions)) assert.equal(url.searchParams.get(name), value);
    assert.equal(url.searchParams.has('cursor'), false);
    assert.equal(url.searchParams.has('pageSize'), false);
    return response([row('2020', '0', rawDimensions), row('2021', '1', rawDimensions)]);
  };
  const input = finiteInput({ ...dimensions, pageSize: 1 });
  const first = await getStatisticsData(input);
  assert.equal(first.hasMore, true);
  for (const name of [...Object.keys(dimensions), 'pageSize']) {
    const changed = await getStatisticsData({
      ...input, [name]: name === 'pageSize' ? 2 : 'WRONG', cursor: first.nextCursor,
    });
    assert.equal(changed.errorCode, 'INVALID_CURSOR', name);
  }
  assert.equal(calls.length, 1);
});
test('different recent counts cannot reuse another request observation set', async () => {
  clear();
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    calls.push(url);
    const count = Number(url.searchParams.get('newEstPrdCnt'));
    return response(Array.from({ length: count }, (_, i) => row(String(2020 + i), String(i))));
  };
  const input = finiteInput({ startPeriod: undefined, endPeriod: undefined });
  const one = await getStatisticsData({ ...input, recentCount: 1 });
  const two = await getStatisticsData({ ...input, recentCount: 2 });
  assert.equal(one.success, true);
  assert.equal(two.success, true);
  assert.equal(one.data.length, 1);
  assert.equal(two.data.length, 2);
  assert.equal(calls.length, 2);
  assert.equal(two.completion, 'unproven');
});

test('period reconstruction preserves accepted four-digit leading-zero years', () => {
  assert.equal(periodLabel('Y', 99, '0099'), '0099');
  assert.equal(periodLabel('M', 99 * 12, '009901'), '009901');
  assert.equal(periodLabel('Q', 99 * 4, '0099Q1'), '0099Q1');
  assert.equal(periodLabel('Q', 99 * 4 + 1, '009901'), '009902');
  assert.equal(periodLabel('Q', 99 * 4 + 1, '00991'), '00992');
});

test('even an oversized arbitrary error code cannot exceed the MCP byte budget', () => {
  const result = boundedStatisticsDataError(
    { tableName: '한'.repeat(20000) }, '한'.repeat(20000), 'message', []
  );
  assert.equal(result.success, false);
  assert.equal(result.errorCode, 'OUTPUT_TOO_LARGE');
  assert.ok(wireBytes(result) <= 32768);
});
test('final wrapper overhead shrinks a near-limit page instead of losing continuation', async () => {
  clear();
  let note = '';
  globalThis.fetch = async () => response([
    row('2020', '0', { NOTE: note }), row('2021', '1', { NOTE: note }),
  ]);
  const input = finiteInput({ pageSize: 2 });
  const baseline = await getStatisticsData(input);
  assert.equal(baseline.success, true);
  assert.equal(baseline.returnedCount, 2);
  note = '한'.repeat(Math.ceil((32769 - wireBytes(baseline)) / 6));
  const oversized = structuredClone(baseline);
  for (const item of oversized.data) item.raw.NOTE = note;
  assert.ok(wireBytes(oversized) > 32768);
  clear();
  const first = await getStatisticsData(input);
  assert.equal(first.success, true);
  assert.equal(first.returnedCount, 1);
  assert.equal(first.hasMore, true);
  const second = await getStatisticsData({ ...input, cursor: first.nextCursor });
  assert.equal(second.success, true);
  assert.equal(second.returnedCount, 1);
  assert.equal(second.aggregateRowCount, 2);
  assert.equal(second.data[0].raw.NOTE, note);
  assert.ok(wireBytes(first) <= 32768);
  assert.ok(wireBytes(second) <= 32768);
});
test('month and quarter splits preserve numeric provider notation across year boundaries', async () => {
  for (const [periodType, periods] of [
    ['M', ['202312', '202401', '202402', '202403']],
    ['Q', ['202304', '202401', '202402', '202403']],
  ]) {
    clear();
    globalThis.fetch = async (input) => {
      const url = new URL(String(input));
      calls.push(url);
      const start = url.searchParams.get('startPrdDe');
      const end = url.searchParams.get('endPrdDe');
      assert.match(start, /^\d{6}$/);
      assert.match(end, /^\d{6}$/);
      if (start === periods[0] && end === periods.at(-1)) {
        return response([], { 'content-length': '4194305' });
      }
      return response(periods.filter(period => period >= start && period <= end)
        .map(period => row(period, '1', { PRD_SE: periodType })));
    };
    const input = finiteInput({ periodType, startPeriod: periods[0], endPeriod: periods.at(-1) });
    const observed = [];
    let cursor;
    for (let index = 0; index < 6; index++) {
      const page = await getStatisticsData({ ...input, cursor });
      assert.equal(page.success, true);
      observed.push(...page.data.map(item => item.rawPeriod));
      if (!page.hasMore) break;
      cursor = page.nextCursor;
    }
    assert.deepEqual(observed, periods);
    assert.equal(calls.length, 3);
  }
});
test.after(() => {
  globalThis.fetch = originalFetch;
  getCacheManager().flush();
});
