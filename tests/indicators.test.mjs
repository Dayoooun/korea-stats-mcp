import assert from 'node:assert/strict';
import test from 'node:test';

process.env.KOSIS_API_KEY = 'indicator-test-key';

const { KosisClient } = await import('../dist/api/client.js');
const { getIndicator, searchIndicators } = await import('../dist/tools/indicators.js');

const originalFetch = globalThis.fetch;
let mode = 'normal';
const calls = [];

const listRow = {
  statJipyoId: '123',
  statJipyoNm: 'fixture indicator',
  areaTypeName: '전국',
  prdSeName: '년',
  strtPrdDe: '2020',
  endPrdDe: '2024',
  rn: 5,
  prdDe: '2024년',
};

const valueRows = [
  {
    statJipyoId: '123',
    statJipyoNm: 'fixture indicator',
    prdSe: 'Y',
    prdDe: '2024',
    itmNm: '전체',
    val: '-12.50',
  },
  {
    statJipyoId: '123',
    statJipyoNm: 'fixture indicator',
    prdSe: 'Y',
    prdDe: '2023',
    itmNm: '전체',
    val: '0',
  },
];

globalThis.fetch = async input => {
  const url = new URL(String(input));
  calls.push(url);
  if (mode === 'unknown-wrapper') {
    return { ok: true, status: 200, async json() { return { payload: [] }; } };
  }
  if (mode === 'api-error') {
    return { ok: true, status: 200, async json() { return { err: '401', errMsg: 'invalid key' }; } };
  }
  if (url.pathname.endsWith('indIdListSearchRequest.do')) {
    return { ok: true, status: 200, async json() { return [listRow]; } };
  }
  if (url.pathname.endsWith('prListSearchRequest.do')) {
    return { ok: true, status: 200, async json() { return [listRow]; } };
  }
  if (url.pathname.endsWith('indListSearchRequest.do')) {
    return { ok: true, status: 200, async json() { return [listRow]; } };
  }
  if (url.pathname.endsWith('indIdDetailSearchRequest.do')) {
    let rows = valueRows;
    if (mode === 'identity-mismatch') {
      rows = [{ ...valueRows[0], statJipyoId: '999' }];
    } else if (mode === 'outside-period') {
      rows = [{ ...valueRows[0], prdDe: '2025' }];
    } else if (mode === 'missing-period') {
      rows = [{ ...valueRows[0] }];
      delete rows[0].prdDe;
    } else if (mode === 'in-range-positive') {
      rows = [{ ...valueRows[0], prdDe: '2024', val: '12.50' }];
    }
    return { ok: true, status: 200, async json() { return rows; } };
  }
  if (url.pathname.endsWith('pkNumberService.do')) {
    return {
      ok: true,
      status: 200,
      async json() {
        const row = {
          jipyoId: '123',
          jipyoNm: 'fixture indicator',
          jipyoExplan: '<b>title</b>',
          jipyoExplan1: 'concept',
          jipyoExplan2: 'selection method',
          jipyoExplan3: 'source',
        };
        if (mode === 'definition-identity-conflict') {
          row.statJipyoId = '999';
          row.statJipyoNm = 'fixture indicator';
        }
        return [row];
      },
    };
  }
  throw new Error(`unexpected endpoint: ${url.pathname}`);
};

test('search maps the documented list rows and sends jsonVD=Y', async () => {
  mode = 'normal';
  calls.length = 0;
  const result = await searchIndicators({
    filters: { indicatorName: 'fixture indicator' },
    page: 1,
    pageSize: 10,
  });
  assert.equal(result.success, true);
  assert.equal(result.data[0].statJipyoId, '123');
  assert.equal(result.unit, 'unknown');
  assert.equal(result.completeness.returned, 1);
  assert.equal(result.completeness.hasMore, 'unknown');
  assert.equal(result.completeness.nextPage, 2);
  assert.equal(calls[0].searchParams.get('jipyoNm'), 'fixture indicator');
  assert.equal(calls[0].searchParams.get('service'), '4');
  assert.equal(calls[0].searchParams.get('serviceDetail'), 'indList');
  assert.equal(calls[0].searchParams.get('jipyoId'), null);
  assert.equal(calls[0].searchParams.get('prdSe'), null);
  assert.equal(calls[0].searchParams.get('jsonVD'), 'Y');
  assert.equal(calls[0].searchParams.get('apiKey'), 'indicator-test-key');
  assert.equal(new URL(result.sourceUrl).searchParams.get('jsonVD'), 'Y');
  assert.equal(result.sourceUrl.includes('apiKey'), false);
});
test('indicator search routes by primary filter and applies secondary filters locally', async () => {
  mode = 'normal';
  calls.length = 0;
  const result = await searchIndicators({
    filters: {
      indicatorId: '123',
      indicatorName: 'fixture',
      period: 'Y년',
    },
    page: 1,
    pageSize: 10,
  });
  assert.equal(result.success, true);
  assert.equal(result.data.length, 1);
  assert.deepEqual(result.appliedFilters, {
    indicatorId: '123',
    indicatorName: 'fixture',
    period: 'Y년',
  });
  assert.equal(result.filterScope.type, 'current_provider_page');
  assert.equal(result.filterScope.primary, 'indicatorId');
  assert.deepEqual(result.filterScope.secondary, ['indicatorName', 'period']);
  assert.equal(result.providerCount, 1);
  assert.equal(calls[0].pathname.endsWith('indIdListSearchRequest.do'), true);
  assert.equal(calls[0].searchParams.get('serviceDetail'), 'indIdList');
  assert.equal(calls[0].searchParams.get('jipyoId'), '123');
  assert.equal(calls[0].searchParams.get('jipyoNm'), null);
  assert.equal(calls[0].searchParams.get('prdSe'), null);
  assert.equal(new URL(result.sourceUrl).pathname.endsWith('indIdListSearchRequest.do'), true);
  assert.equal(new URL(result.sourceUrl).searchParams.get('jipyoId'), '123');
  assert.equal(new URL(result.sourceUrl).searchParams.get('jipyoNm'), null);
  assert.equal(new URL(result.sourceUrl).searchParams.get('prdSe'), null);
});

test('period-only search uses the documented period route', async () => {
  mode = 'normal';
  calls.length = 0;
  const result = await searchIndicators({ filters: { period: 'Y년' } });
  assert.equal(result.success, true);
  assert.equal(result.data.length, 1);
  assert.equal(calls[0].pathname.endsWith('prListSearchRequest.do'), true);
  assert.equal(calls[0].searchParams.get('serviceDetail'), 'prList');
  assert.equal(calls[0].searchParams.get('prdSe'), 'Y');
  assert.equal(calls[0].searchParams.get('jipyoId'), null);
  assert.equal(calls[0].searchParams.get('jipyoNm'), null);
  assert.equal(new URL(result.sourceUrl).searchParams.get('prdSe'), 'Y');
  assert.equal(new URL(result.sourceUrl).searchParams.get('jipyoId'), null);
  assert.equal(new URL(result.sourceUrl).searchParams.get('jipyoNm'), null);
  assert.equal(result.completeness.hasMore, 'unknown');
});
test('unknown period labels do not infer a provider period', async () => {
  mode = 'normal';
  calls.length = 0;
  const result = await searchIndicators({
    filters: { indicatorId: '123', period: 'S' },
  });
  assert.equal(result.success, true);
  assert.deepEqual(result.data, []);
  assert.equal(result.providerCount, 1);
  assert.equal(result.completeness.hasMore, 'unknown');
  assert.equal(calls[0].searchParams.get('jipyoId'), '123');
  assert.equal(calls[0].searchParams.get('prdSe'), null);
});

test('values retain negative decimals and zero as raw provider strings', async () => {
  mode = 'normal';
  calls.length = 0;
  const result = await getIndicator({
    indicatorId: '123',
    indicatorName: 'fixture indicator',
    kind: 'values',
    recentCount: 2,
    pageSize: 10,
  });
  assert.equal(result.success, true);
  assert.deepEqual(result.data.map(row => row.val), ['-12.50', '0']);
  assert.equal(result.unit, 'unknown');
  assert.equal(result.data[0].prdSe, 'Y');
  assert.equal(result.data[0].prdSeName, undefined);
  assert.equal(calls[0].searchParams.get('srvRn'), '2');
  assert.equal(calls[0].searchParams.get('jsonVD'), 'Y');
  assert.equal(calls[0].searchParams.get('jipyoNm'), null);
  assert.equal(new URL(result.sourceUrl).searchParams.get('jipyoNm'), null);
  assert.equal(new URL(result.sourceUrl).searchParams.get('jsonVD'), 'Y');
  assert.equal(result.validationLevel, 'unverified');
  assert.match(result.uncertainty, /최신성.*검증되지 않았습니다/);
});
test('bounded values reject rows outside the explicit period range', async () => {
  calls.length = 0;
  mode = 'outside-period';
  const result = await getIndicator({
    indicatorId: '123',
    indicatorName: 'fixture indicator',
    kind: 'values',
    startPeriod: '2023',
    endPeriod: '2024',
  });
  assert.equal(result.success, false);
  assert.equal(calls[0].searchParams.get('jsonVD'), 'Y');
  assert.equal(calls[0].searchParams.get('strtPrdDe'), '2023');
  assert.equal(calls[0].searchParams.get('startPrdDe'), null);
  assert.equal(result.sourceUrl.includes('strtPrdDe=2023'), true);
  assert.equal(result.sourceUrl.includes('startPrdDe='), false);
  assert.equal(result.errorCode, 'response_mismatch');
  assert.deepEqual(result.data, []);
});

test('bounded values require returned periods and accept in-range positive values', async () => {
  mode = 'missing-period';
  const missing = await getIndicator({
    indicatorId: '123',
    indicatorName: 'fixture indicator',
    kind: 'values',
    startPeriod: '2023',
    endPeriod: '2024',
  });
  assert.equal(missing.success, false);
  assert.equal(missing.errorCode, 'response_incomplete');
  assert.equal(missing.validationLevel, 'unverified');

  mode = 'in-range-positive';
  const inRange = await getIndicator({
    indicatorId: '123',
    indicatorName: 'fixture indicator',
    kind: 'values',
    startPeriod: '2023',
    endPeriod: '2024',
  });
  assert.equal(inRange.success, true);
  assert.equal(inRange.validationLevel, 'verified');
  assert.equal(inRange.data[0].val, '12.50');
});

test('obsolete provider aliases and alias conflicts are rejected before fetching', async () => {
  mode = 'normal';
  calls.length = 0;
  const search = await searchIndicators({
    filters: { indicatorName: 'fixture indicator', name: 'fixture indicator' },
  });
  assert.equal(search.success, false);
  assert.equal(search.errorCode, 'INVALID_INPUT');
  assert.equal(calls.length, 0);

  const values = await getIndicator({
    indicatorId: '123',
    indicatorName: 'fixture indicator',
    kind: 'values',
    startPeriod: '2023',
    startPrdDe: '2023',
  });
  assert.equal(values.success, false);
  assert.equal(values.errorCode, 'INVALID_INPUT');
  assert.equal(calls.length, 0);
});

test('empty identifiers and definition-only ignored controls fail before fetching', async () => {
  mode = 'normal';
  calls.length = 0;
  for (const filters of [{ indicatorName: ' ' }, { indicatorId: '' }, { period: ' ' }]) {
    const result = await searchIndicators({ filters });
    assert.equal(result.success, false);
    assert.equal(result.errorCode, 'INVALID_INPUT');
  }
  for (const input of [
    { indicatorId: ' ', kind: 'definition' },
    { indicatorId: '123', kind: 'values', indicatorName: ' ' },
    { indicatorId: '123', kind: 'values' },
    { indicatorId: '123', kind: 'definition', indicatorName: 'fixture indicator' },
    { indicatorId: '123', kind: 'definition', startPeriod: '2023' },
    { indicatorId: '123', kind: 'definition', endPeriod: '2024' },
    { indicatorId: '123', kind: 'definition', recentReference: '2024' },
    { indicatorId: '123', kind: 'definition', recentCount: 1 },
  ]) {
    const result = await getIndicator(input);
    assert.equal(result.success, false);
    assert.equal(result.errorCode, 'INVALID_INPUT');
  }
  assert.equal(calls.length, 0);
});

test('definition fields map to title, concept, selection method, and source text', async () => {
  mode = 'normal';
  calls.length = 0;
  const result = await getIndicator({ indicatorId: '123', kind: 'definition', pageSize: 10 });
  assert.equal(result.success, true);
  assert.equal(result.data[0].jipyoId, '123');
  assert.equal(result.data[0].jipyoNm, 'fixture indicator');
  assert.equal(calls[0].searchParams.get('serviceDetail'), 'pkAll');
  assert.equal(calls[0].searchParams.get('jsonVD'), 'Y');
  assert.equal(result.definition.title, '<b>title</b>');
  assert.equal(result.definition.concept, 'concept');
  assert.equal(result.definition.selectionMethod, 'selection method');
  assert.equal(result.definition.sourceInfo, 'source');
  assert.equal(result.definition.original.jipyoExplan2, 'selection method');
  assert.equal(result.definition.renderAs, 'text');
});
test('definition identity conflicts fail closed', async () => {
  mode = 'definition-identity-conflict';
  calls.length = 0;
  const result = await getIndicator({ indicatorId: '123', kind: 'definition' });
  assert.equal(result.success, false);
  assert.equal(result.errorCode, 'response_mismatch');
  assert.deepEqual(result.data, []);
});

test('unknown wrappers and upstream errors fail closed', async () => {
  mode = 'unknown-wrapper';
  const unknown = await searchIndicators({ filters: { indicatorId: '123' } });
  assert.equal(unknown.success, false);
  assert.equal(unknown.errorCode, 'INVALID_RESPONSE');
  mode = 'api-error';
  const apiError = await searchIndicators({ filters: { indicatorId: '123' } });
  assert.equal(apiError.success, false);
  assert.equal(apiError.errorCode, '401');
});

test('missing credentials fail before fetch', async () => {
  const callsBefore = calls.length;
  const client = new KosisClient('');
  await assert.rejects(
    client.searchIndicators({ jipyoNm: 'fixture', pageNo: 1, numOfRows: 1 }),
    error => error.code === 'INVALID_API_KEY'
  );
  assert.equal(calls.length, callsBefore);
});

test('identity mismatch is not reported as a successful value lookup', async () => {
  mode = 'identity-mismatch';
  const result = await getIndicator({
    indicatorId: '123',
    indicatorName: 'fixture indicator',
    kind: 'values',
  });
  assert.equal(result.success, false);
  assert.equal(result.errorCode, 'response_mismatch');
  assert.deepEqual(result.data, []);
});

test('reverse periods are rejected locally without an upstream request', async () => {
  mode = 'normal';
  calls.length = 0;
  const result = await getIndicator({
    indicatorId: '123',
    indicatorName: 'fixture indicator',
    kind: 'values',
    startPeriod: '2025',
    endPeriod: '2024',
  });
  assert.equal(result.success, false);
  assert.equal(result.errorCode, 'INVALID_PERIOD');
  assert.equal(calls.length, 0);
});

test.after(() => {
  globalThis.fetch = originalFetch;
});
