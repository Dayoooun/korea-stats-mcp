import assert from 'node:assert/strict';
import test from 'node:test';

process.env.KOSIS_API_KEY = 'quick-tools-test-key';

const { getCacheManager } = await import('../dist/cache/index.js');
const { quickStats } = await import('../dist/tools/quickStats.js');
const { quickTrend } = await import('../dist/tools/quickTrend.js');

const baseRow = {
  ORG_ID: '101',
  TBL_ID: 'DT_1DA7004S',
  PRD_SE: 'Y',
  C1: '00',
  C1_NM: '전국',
  ITM_ID: 'T80',
  ITM_NM: '실업률',
};

let fixtureRows = [];
const originalFetch = globalThis.fetch;

globalThis.fetch = async (input) => {
  const url = new URL(String(input));
  if (url.searchParams.get('method') === 'getMeta') {
    return { ok: true, status: 200, async json() { return []; } };
  }
  return {
    ok: true,
    status: 200,
    async json() { return fixtureRows; },
  };
};

function row(year, value, overrides = {}) {
  return {
    ...baseRow,
    PRD_DE: String(year),
    DT: value,
    UNIT_NM: '%',
    ...overrides,
  };
}

async function runTrend(rows) {
  fixtureRows = rows;
  getCacheManager().flush();
  return quickTrend({ keyword: '실업률', yearCount: 10 });
}

async function runStats(rows, input = { query: '실업률' }) {
  fixtureRows = rows;
  getCacheManager().flush();
  return quickStats(input);
}

test('quick_stats preserves zero and negative scalar observations and observed units', async () => {
  const result = await runStats([row(2024, '0'), row(2023, '-5')]);
  assert.equal(result.success, true);
  assert.equal(result.value, '0');
  assert.equal(result.unit, '%');
  assert.match(result.answer, /0/);
  assert.doesNotMatch(result.answer, /단위 미상/);
});

test('quick_stats does not claim a static unit when UNIT_NM is absent', async () => {
  const result = await runStats([row(2024, '5', { UNIT_NM: undefined })]);
  assert.equal(result.success, true);
  assert.equal(result.unit, undefined);
  assert.equal(result.validationLevel, 'partial');
  assert.match(result.answer, /단위 미상/);
});

test('quick_stats rejects duplicate periods and mixed categories', async () => {
  const duplicate = await runStats([row(2024, '5'), row(2024, '6')]);
  assert.equal(duplicate.success, false);
  assert.match(duplicate.note, /중복/);

  const mixed = await runStats([
    row(2024, '5', { C2: 'A' }),
    row(2023, '4', { C2: 'B' }),
  ]);
  assert.equal(mixed.success, false);
  assert.match(mixed.note, /분류/);
});

test('quick_trend reports absolute change and N/A for a zero baseline', async () => {
  const result = await runTrend([row(2022, '0'), row(2023, '5')]);
  assert.equal(result.success, true);
  assert.equal(result.trend, 'increasing');
  assert.match(result.trendDescription, /상승 흐름/);
  assert.equal(result.dataPoints[1].absoluteChange, 5);
  assert.equal(result.dataPoints[1].changeRate, 'N/A');
  assert.match(result.summary, /상승 흐름/);
  assert.match(result.summary, /절대 변화 \+5/);
  assert.match(result.summary, /변화율 N\/A/);
  assert.doesNotMatch(result.summary, /0\.0?%/);
  assert.ok(result.insights.some((line) => line.includes('상승 흐름')));
  assert.ok(result.insights.some((line) => line.includes('변화율 N/A')));
});

test('quick_trend preserves signs for a negative-to-positive transition', async () => {
  const result = await runTrend([row(2022, '-5'), row(2023, '5')]);
  assert.equal(result.success, true);
  assert.equal(result.dataPoints[1].absoluteChange, 10);
  assert.equal(result.dataPoints[1].changeRate, '+200.0%');
  assert.match(result.summary, /절대 변화 \+10/);
});

test('quick_trend uses absolute direction when rate evidence is partial', async () => {
  const positive = await runTrend([row(2022, '0'), row(2023, '5'), row(2024, '10')]);
  assert.equal(positive.success, true);
  assert.equal(positive.trend, 'increasing');
  assert.match(positive.trendDescription, /상승 흐름/);
  assert.ok(positive.insights.some((line) => line.includes('평균 변화율**: N/A')));
  assert.doesNotMatch(positive.summary, /100\.0%\/년/);
  assert.doesNotMatch(positive.summary, /100\.0%/);

  const zeros = await runTrend([row(2022, '0'), row(2023, '0')]);
  assert.equal(zeros.success, true);
  assert.equal(zeros.trend, 'stable');
  assert.match(zeros.trendDescription, /안정적인 흐름/);

  const reversal = await runTrend([row(2022, '0'), row(2023, '5'), row(2024, '0')]);
  assert.equal(reversal.success, true);
  assert.equal(reversal.trend, 'fluctuating');
  assert.match(reversal.trendDescription, /상승·하락이 혼재/);
  assert.ok(reversal.insights.some((line) => line.includes('상승·하락이 혼재')));
});
test('quick_trend fails closed for missing DT markers and retains raw observations', async () => {
  const result = await runTrend([row(2022, '1'), row(2023, '…'), row(2024, '3')]);
  assert.equal(result.success, false);
  assert.equal(result.dataPoints.length, 3);
  assert.equal(result.dataPoints[1].rawValue, '…');
  assert.equal(result.dataPoints[1].value, null);
  assert.match(result.note, /DT.*결측/);
});

test('quick_trend fails closed for annual gaps, duplicate years, and mixed categories', async () => {
  const gap = await runTrend([row(2022, '1'), row(2024, '3')]);
  assert.equal(gap.success, false);
  assert.match(gap.note, /이어지지 않습니다/);

  const duplicate = await runTrend([row(2022, '1'), row(2023, '2'), row(2023, '3')]);
  assert.equal(duplicate.success, false);
  assert.match(duplicate.note, /중복/);

  const mixed = await runTrend([
    row(2022, '1', { C2: 'A' }),
    row(2023, '2', { C2: 'B' }),
  ]);
  assert.equal(mixed.success, false);
  assert.match(mixed.note, /분류/);
});

test('quick_trend returns a verified contiguous annual series', async () => {
  const result = await runTrend([row(2022, '1'), row(2023, '2'), row(2024, '4')]);
  assert.equal(result.success, true);
  assert.equal(result.validationLevel, 'verified');
  assert.equal(result.source.unit, '%');
  assert.deepEqual(result.dataPoints.map((point) => point.year), ['2022', '2023', '2024']);
  assert.deepEqual(result.dataPoints.map((point) => point.changeRate), [undefined, '+100.0%', '+100.0%']);
  assert.match(result.summary, /절대 변화 \+3/);
});

test('quick_trend is honest when all observed units are unknown', async () => {
  const result = await runTrend([
    row(2022, '1', { UNIT_NM: undefined }),
    row(2023, '2', { UNIT_NM: undefined }),
  ]);
  assert.equal(result.success, true);
  assert.equal(result.validationLevel, 'partial');
  assert.equal(result.source.unit, undefined);
  assert.match(result.summary, /단위 미상/);
});

test.after(() => {
  globalThis.fetch = originalFetch;
  getCacheManager().flush();
});
