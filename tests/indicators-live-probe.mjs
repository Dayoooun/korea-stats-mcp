import assert from 'node:assert/strict';

if (!process.env.KOSIS_API_KEY?.trim()) {
  console.error('KOSIS_API_KEY is required; no live checks executed.');
  process.exit(1);
}
const { searchIndicators, getIndicator } = await import('../dist/tools/indicators.js');
const { QUICK_STATS_PARAMS } = await import('../dist/data/quickStatsParams.js');
const cases = [
  { id: '160', name: '합계출산율' },
  { id: '478', name: '지니계수(전체가구, 처분가능소득)' },
];
assert.equal(Object.hasOwn(QUICK_STATS_PARAMS, '지니계수'), false);
let passed = 0;
for (const item of cases) {
  try {
    const search = await searchIndicators({ filters: { indicatorId: item.id, indicatorName: item.name }, page: 1, pageSize: 20 });
    assert.equal(search.success, true, 'indicator search failed');
    assert.ok(search.data.some(row => String(row.statJipyoId) === item.id && row.statJipyoNm === item.name));
    const definition = await getIndicator({ indicatorId: item.id, kind: 'definition', page: 1, pageSize: 20 });
    assert.equal(definition.success, true, 'indicator definition failed');
    assert.ok(definition.data.some(row => String(row.jipyoId) === item.id && row.jipyoNm === item.name && row.jipyoExplan1 && row.jipyoExplan3));
    const values = await getIndicator({ indicatorId: item.id, indicatorName: item.name, kind: 'values', startPeriod: '2023', endPeriod: '2024', page: 1, pageSize: 20 });
    assert.equal(values.success, true, 'indicator values failed');
    assert.ok(values.data.length >= 2, 'both requested years need observations');
    const periods = new Set();
    for (const row of values.data) {
      assert.equal(String(row.statJipyoId), item.id);
      assert.equal(row.statJipyoNm, item.name);
      assert.ok(['2023', '2024'].includes(String(row.prdDe)), 'provider ignored the requested range');
      assert.ok(Number.isFinite(Number(String(row.val).replaceAll(',', ''))), 'nonnumeric official value');
      periods.add(String(row.prdDe));
    }
    assert.equal(periods.size, 2);
    const url = new URL(values.sourceUrl);
    assert.equal(url.searchParams.get('strtPrdDe'), '2023');
    assert.equal(url.searchParams.has('startPrdDe'), false);
    assert.equal(url.searchParams.has('apiKey'), false);
    passed++;
    console.log(JSON.stringify({ id: item.id, name: item.name, status: 'passed', source: definition.data[0].jipyoExplan3, observations: values.data, unit: values.unit, completeness: values.completeness }));
  } catch (error) {
    console.log(JSON.stringify({ id: item.id, status: 'failed', assertion: error instanceof assert.AssertionError ? error.message : 'request_or_validation_error' }));
  }
}
console.log(JSON.stringify({ expected: 2, executed: 2, passed, failed: 2 - passed, skipped: 0, scope: 'local_candidate_live_KOSIS_not_deployment' }));
process.exit(passed === 2 ? 0 : 1);
