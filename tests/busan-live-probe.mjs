import assert from 'node:assert/strict';

if (!process.env.KOSIS_API_KEY?.trim()) {
  console.error('KOSIS_API_KEY is required; no live checks executed.');
  process.exit(1);
}
const { quickStats } = await import('../dist/tools/quickStats.js');
const { quickTrend } = await import('../dist/tools/quickTrend.js');
const { getStatisticsData } = await import('../dist/tools/getStatisticsData.js');
const { compareStatistics } = await import('../dist/tools/compareStatistics.js');
const { analyzeTimeSeries } = await import('../dist/tools/analyzeTimeSeries.js');
const { resolveRegion } = await import('../dist/utils/regionResolver.js');
const { QUICK_STATS_PARAMS } = await import('../dist/data/quickStatsParams.js');
const districts = ['중구', '서구', '동구', '영도구', '부산진구', '동래구', '남구', '북구', '해운대구', '사하구', '금정구', '강서구', '연제구', '수영구', '사상구', '기장군'];
let passed = 0;
let failed = 0;
const totals = new Map();
async function check(name, run) {
  try {
    const evidence = await run();
    passed++;
    console.log(JSON.stringify({ name, status: 'passed', ...evidence }));
  } catch (error) {
    failed++;
    // No raw upstream errors, credential-bearing URLs, or request objects.
    console.log(JSON.stringify({ name, status: 'failed', assertion: error instanceof assert.AssertionError ? error.message : 'request_or_validation_error' }));
  }
}
for (const district of districts) {
  await check(`부산 ${district}: scalar and 11 annual observations`, async () => {
    const region = `부산 ${district}`;
    const scalar = await quickStats({ query: '인구', region, year: 2025 });
    assert.equal(scalar.success, true, 'district scalar failed');
    const trend = await quickTrend({ keyword: '인구', region, yearCount: 11 });
    assert.equal(trend.success, true, 'district trend failed');
    assert.equal(trend.dataPoints.length, 11, 'annual observations missing');
    for (let i = 0; i < 11; i++) {
      const point = trend.dataPoints[i];
      assert.equal(String(point.year), String(2015 + i), 'unexpected period');
      assert.ok(Number.isFinite(point.value) && point.value > 0, 'unusable population');
      totals.set(String(point.year), (totals.get(String(point.year)) ?? 0) + point.value);
    }
    assert.equal(Number(scalar.value), trend.dataPoints.at(-1).value, 'scalar/trend mismatch');
    return { population2025: Number(scalar.value), first: trend.dataPoints[0].value, observations: 11 };
  });
}
await check('16 districts sum to Busan in every year 2015–2025', async () => {
  assert.equal(passed, 16, 'not every district completed');
  const busan = await quickTrend({ keyword: '인구', region: '부산', yearCount: 11 });
  assert.equal(busan.success, true);
  assert.equal(busan.dataPoints.length, 11);
  for (const point of busan.dataPoints) assert.equal(totals.get(String(point.year)), point.value, 'district sum differs from Busan');
  return { yearsChecked: 11, total2025: totals.get('2025') };
});
for (const district of ['동래구', '해운대구', '강서구', '기장군']) {
  await check(`부산 ${district}: continuation, comparison and time series`, async () => {
    const resolved = await resolveRegion(QUICK_STATS_PARAMS.인구, `부산 ${district}`);
    assert.equal(resolved.status, 'resolved');
    const query = { orgId: '101', tableId: 'DT_1B040A3', ...resolved.dimensions, itemId: 'T20', periodType: 'Y' };
    const collected = [];
    let cursor;
    let pages = 0;
    do {
      const page = await getStatisticsData({ ...query, startPeriod: '2015', endPeriod: '2025', pageSize: 2, cursor });
      assert.equal(page.success, true, 'continuation page failed');
      assert.ok(Buffer.byteLength(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(page, null, 2) }] })) <= 32768);
      for (const row of page.data) {
        assert.equal(row.raw[`C${resolved.axis}`], resolved.regionCode, 'wrong district identity');
        assert.equal(row.raw.PRD_SE, 'A', 'unexpected live annual code');
        assert.equal(row.periodType, 'Y', 'normalized annual type missing');
        collected.push(row);
      }
      pages++;
      assert.ok(pages <= 10, 'continuation did not terminate');
      if (!page.hasMore) {
        assert.equal(page.traversalComplete, true);
        assert.equal(page.aggregateRowCount, 11);
      }
      cursor = page.nextCursor;
    } while (cursor);
    assert.equal(collected.length, 11);
    assert.equal(new Set(collected.map(row => row.rawPeriod)).size, 11);
    const comparison = await compareStatistics({ ...query, compareType: 'period', periods: ['2015', '2025'] });
    assert.equal(comparison.success, true, 'comparison failed');
    const analysis = await analyzeTimeSeries({ ...query, yearCount: 11 });
    assert.equal(analysis.success, true, 'time series failed');
    return { pages, observations: collected.length, regionCode: resolved.regionCode };
  });
}
for (const region of ['부산 없는군', '부산 기장동', '중구', '강서구']) {
  await check(`${region}: must not return national data`, async () => {
    const result = await quickStats({ query: '인구', region, year: 2025 });
    assert.equal(result.success, false);
    assert.equal(result.value, undefined);
    return {};
  });
}
console.log(JSON.stringify({ expected: 25, executed: passed + failed, passed, failed, skipped: 0, scope: 'local_candidate_live_KOSIS_not_deployment' }));
process.exit(passed === 25 && failed === 0 ? 0 : 1);
