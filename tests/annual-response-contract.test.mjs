import assert from 'node:assert/strict';
import test from 'node:test';

process.env.KOSIS_API_KEY = 'annual-contract-fixture';
const { getCacheManager } = await import('../dist/cache/index.js');
const { getStatisticsData } = await import('../dist/tools/getStatisticsData.js');
const { quickStats } = await import('../dist/tools/quickStats.js');
const { quickTrend } = await import('../dist/tools/quickTrend.js');
const { compareStatistics } = await import('../dist/tools/compareStatistics.js');
const { analyzeTimeSeries } = await import('../dist/tools/analyzeTimeSeries.js');
const originalFetch = globalThis.fetch;
let responsePeriod = 'A';
let fixtureYears = ['2024', '2025'];
const query = { orgId: '101', tableId: 'DT_1B040A3', objL1: '00', itemId: 'T20', periodType: 'Y' };

globalThis.fetch = async (input) => {
  const url = new URL(String(input));
  if (url.searchParams.get('method') === 'getMeta') return Response.json([]);
  const start = url.searchParams.get('startPrdDe');
  const end = url.searchParams.get('endPrdDe');
  const rows = fixtureYears.filter(year => (!start || year >= start) && (!end || year <= end)).map(year => ({
    ORG_ID: '101', TBL_ID: 'DT_1B040A3', TBL_NM: '행정구역별 인구 fixture', PRD_SE: responsePeriod, PRD_DE: year,
    C1: '00', C1_NM: '전국', C1_OBJ_NM: '행정구역', ITM_ID: 'T20', ITM_NM: '총인구수', UNIT_NM: '명', DT: year === '2024' ? '100' : '90',
  }));
  return Response.json(rows);
};
test.after(() => { globalThis.fetch = originalFetch; getCacheManager().flush(); });
test.beforeEach(() => { responsePeriod = 'A'; fixtureYears = ['2024', '2025']; getCacheManager().flush(); });

test('annual A response is validated as requested Y without rewriting raw evidence', async () => {
  const result = await getStatisticsData({ ...query, startPeriod: '2024', endPeriod: '2025' });
  assert.equal(result.success, true);
  assert.equal(result.validationLevel, 'verified');
  assert.equal(result.data.length, 2);
  assert.equal(result.data[0].periodType, 'Y');
  assert.equal(result.data[0].raw.PRD_SE, 'A');
});

test('quick scalar and trend accept observed annual A responses', async () => {
  const scalar = await quickStats({ query: '인구', year: 2025 });
  assert.equal(scalar.success, true);
  assert.equal(scalar.value, '90');
  const trend = await quickTrend({ keyword: '인구', yearCount: 2 });
  assert.equal(trend.success, true);
  assert.equal(trend.dataPoints.length, 2);
  assert.equal(trend.dataPoints[1].absoluteChange, -10);
});

test('comparison and time series share annual response semantics', async () => {
  const comparison = await compareStatistics({ ...query, compareType: 'period', periods: ['2024', '2025'] });
  assert.equal(comparison.success, true);
  const analysis = await analyzeTimeSeries({ ...query, yearCount: 2 });
  assert.equal(analysis.success, true);
});

test('explicit distant period comparison does not require unrequested intervening years', async () => {
  fixtureYears = ['2015', '2025'];
  const comparison = await compareStatistics({ ...query, compareType: 'period', periods: ['2015', '2025'] });
  assert.equal(comparison.success, true);
  assert.deepEqual(comparison.items.map(item => item.period), ['2015', '2025']);
  getCacheManager().flush();
  const implicit = await compareStatistics({ ...query, compareType: 'period' });
  assert.equal(implicit.success, false, 'implicit continuous comparison must still reject a gap');
});

test('explicit period comparison still rejects a missing requested endpoint', async () => {
  fixtureYears = ['2015'];
  const comparison = await compareStatistics({ ...query, compareType: 'period', periods: ['2015', '2025'] });
  assert.equal(comparison.success, false);
});

test('annual equivalence does not admit monthly or unknown response codes', async () => {
  for (const code of ['M', 'UNKNOWN']) {
    responsePeriod = code;
    getCacheManager().flush();
    const result = await getStatisticsData({ ...query, startPeriod: '2024', endPeriod: '2025' });
    assert.equal(result.success, false);
    assert.equal(result.errorCode, 'response_mismatch');
    const quick = await quickStats({ query: '인구', year: 2025 });
    assert.equal(quick.success, false);
  }
});
