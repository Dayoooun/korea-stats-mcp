/**
 * Comprehensive E2E Test Script for korea-stats-mcp
 * Tests all keywords with quick_stats and quick_trend
 */

import { quickStats } from './dist/tools/quickStats.js';
import { quickTrend } from './dist/tools/quickTrend.js';

const KEYWORDS = [
  // 기존 키워드
  '인구', '총인구', '출산율', '합계출산율', '실업률', '고용률',
  'GDP', '국내총생산', '물가', '소비자물가', '소비자물가지수',
  '혼인율', '기대수명', '기대여명', '평균수명', '수출액', '수출',
  // 무역/수입 키워드
  '수입액', '수입', '무역수지',
  // 인구동향 키워드
  '출생아수', '출생아', '조출생률',
  '사망자수', '사망자', '조사망률', '사망률',
  '이혼건수', '조이혼율', '이혼율',
  '혼인건수', '조혼인율',
  '자연증가', '자연증가율',
  // 경제성장률
  '경제성장률', '성장률', 'GDP성장률',
  // 고용 추가 지표
  '취업자수', '취업자', '경제활동인구', '실업자수', '실업자',
  '비경제활동인구',
];

const REGIONS = ['전국', '서울', '부산', '제주', '경기'];
const TREND_KEYWORDS = ['인구', '출산율', '실업률', '물가', '출생아수', '사망률', '이혼율', '경제성장률'];
const REGIONAL_KEYWORDS = ['인구', '출산율', '물가', '출생아수', '이혼율'];

function requirePrerequisites() {
  const missing = [];
  if (!process.env.KOSIS_API_KEY?.trim()) missing.push('KOSIS_API_KEY');
  if (typeof quickStats !== 'function') missing.push('quickStats implementation');
  if (typeof quickTrend !== 'function') missing.push('quickTrend implementation');
  if (KEYWORDS.length === 0) missing.push('quick_stats keyword cohort');
  if (TREND_KEYWORDS.length === 0) missing.push('quick_trend keyword cohort');
  if (REGIONAL_KEYWORDS.length === 0 || REGIONS.length === 0) missing.push('regional cohort');
  if (missing.length > 0) {
    throw new Error(`E2E prerequisite failed: ${missing.join(', ')}`);
  }
}

function quickStatsPassed(result) {
  return result?.success === true &&
    result.value !== undefined &&
    result.value !== null &&
    typeof result.period === 'string' &&
    result.period.trim().length > 0;
}

function quickTrendPassed(result) {
  return result?.success === true &&
    Array.isArray(result.dataPoints) &&
    result.dataPoints.length > 0 &&
    typeof result.trend === 'string' &&
    result.trend.trim().length > 0;
}

async function testQuickStats() {
  console.log('\n========== QUICK_STATS 테스트 ==========\n');

  const results = { expected: KEYWORDS.length, executed: 0, success: 0, fail: 0, skipped: 0, errors: [] };

  for (const keyword of KEYWORDS) {
    results.executed++;
    try {
      const result = await quickStats({ query: keyword });
      if (quickStatsPassed(result)) {
        console.log(`✅ ${keyword}: ${result.value}${result.unit || ''} (${result.period})`);
        results.success++;
      } else {
        const error = result?.note || result?.answer || 'No usable live data';
        console.log(`❌ ${keyword}: ${error}`);
        results.fail++;
        results.errors.push({ keyword, error });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`❌ ${keyword}: ${message}`);
      results.fail++;
      results.errors.push({ keyword, error: message });
    }
  }

  console.log(`\n📊 Quick Stats 결과: ${results.success}/${results.expected} 성공 (실행 ${results.executed}, 실패 ${results.fail}, skip ${results.skipped}, 미실행 ${results.expected - results.executed})`);
  if (results.errors.length > 0) {
    console.log('\n실패 항목:');
    results.errors.forEach(e => console.log(`  - ${e.keyword}: ${e.error}`));
  }

  return results;
}

async function testQuickTrend() {
  console.log('\n========== QUICK_TREND 테스트 ==========\n');

  const results = { expected: TREND_KEYWORDS.length, executed: 0, success: 0, fail: 0, skipped: 0, errors: [] };

  for (const keyword of TREND_KEYWORDS) {
    results.executed++;
    try {
      const result = await quickTrend({ keyword, yearCount: 5 });
      if (quickTrendPassed(result)) {
        console.log(`✅ ${keyword}: ${result.trend} (${result.dataPoints.length}년)`);
        results.success++;
      } else {
        const error = result?.note || result?.summary || 'No usable live data';
        console.log(`❌ ${keyword}: ${error}`);
        results.fail++;
        results.errors.push({ keyword, error });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`❌ ${keyword}: ${message}`);
      results.fail++;
      results.errors.push({ keyword, error: message });
    }
  }

  console.log(`\n📊 Quick Trend 결과: ${results.success}/${results.expected} 성공 (실행 ${results.executed}, 실패 ${results.fail}, skip ${results.skipped}, 미실행 ${results.expected - results.executed})`);
  if (results.errors.length > 0) {
    console.log('\n실패 항목:');
    results.errors.forEach(e => console.log(`  - ${e.keyword}: ${e.error}`));
  }

  return results;
}

async function testRegionalQueries() {
  console.log('\n========== 지역별 조회 테스트 ==========\n');
  const expected = REGIONAL_KEYWORDS.length * REGIONS.length;
  const results = { expected, executed: 0, success: 0, fail: 0, skipped: 0, errors: [] };

  for (const keyword of REGIONAL_KEYWORDS) {
    for (const region of REGIONS) {
      results.executed++;
      try {
        const result = await quickStats({ query: keyword, region });
        if (quickStatsPassed(result)) {
          console.log(`✅ ${keyword} (${region}): ${result.value}${result.unit || ''}`);
          results.success++;
        } else {
          const error = result?.note || result?.answer || 'No usable live data';
          console.log(`❌ ${keyword} (${region}): ${error}`);
          results.fail++;
          results.errors.push({ keyword, region, error });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.log(`❌ ${keyword} (${region}): ${message}`);
        results.fail++;
        results.errors.push({ keyword, region, error: message });
      }
    }
  }

  console.log(`\n📊 지역별 조회 결과: ${results.success}/${results.expected} 성공 (실행 ${results.executed}, 실패 ${results.fail}, skip ${results.skipped}, 미실행 ${results.expected - results.executed})`);
  if (results.errors.length > 0) {
    console.log('\n실패 항목:');
    results.errors.forEach(e => console.log(`  - ${e.keyword} (${e.region}): ${e.error}`));
  }

  return results;
}

async function runAllTests() {
  console.log('🚀 Korea Stats MCP E2E 테스트 시작\n');
  console.log('='.repeat(50));
  const planned = KEYWORDS.length + TREND_KEYWORDS.length + REGIONAL_KEYWORDS.length * REGIONS.length;
  console.log(`계획된 케이스: Quick Stats ${KEYWORDS.length}, Quick Trend ${TREND_KEYWORDS.length}, 지역별 ${REGIONAL_KEYWORDS.length * REGIONS.length} (전체 ${planned})`);

  try {
    requirePrerequisites();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    console.log(`전체: 0/${planned} 성공 (실행 0, 실패 0, skip 0, 미실행 ${planned})`);
    process.exitCode = 1;
    return { totalExpected: planned, totalExecuted: 0, totalSuccess: 0, totalFail: 0, totalSkipped: 0, totalNotRun: planned };
  }

  const statsResults = await testQuickStats();
  const trendResults = await testQuickTrend();
  const regionalResults = await testRegionalQueries();

  console.log('\n' + '='.repeat(50));
  console.log('📋 전체 결과 요약');
  console.log('='.repeat(50));
  console.log(`Quick Stats: ${statsResults.success}/${statsResults.expected} 성공 (실행 ${statsResults.executed}, 실패 ${statsResults.fail}, skip ${statsResults.skipped}, 미실행 ${statsResults.expected - statsResults.executed})`);
  console.log(`Quick Trend: ${trendResults.success}/${trendResults.expected} 성공 (실행 ${trendResults.executed}, 실패 ${trendResults.fail}, skip ${trendResults.skipped}, 미실행 ${trendResults.expected - trendResults.executed})`);
  console.log(`지역별 조회: ${regionalResults.success}/${regionalResults.expected} 성공 (실행 ${regionalResults.executed}, 실패 ${regionalResults.fail}, skip ${regionalResults.skipped}, 미실행 ${regionalResults.expected - regionalResults.executed})`);

  const cohorts = [statsResults, trendResults, regionalResults];
  const totalSuccess = cohorts.reduce((sum, result) => sum + result.success, 0);
  const totalExpected = cohorts.reduce((sum, result) => sum + result.expected, 0);
  const totalExecuted = cohorts.reduce((sum, result) => sum + result.executed, 0);
  const totalFail = cohorts.reduce((sum, result) => sum + result.fail, 0);
  const totalSkipped = cohorts.reduce((sum, result) => sum + result.skipped, 0);
  const totalNotRun = totalExpected - totalExecuted;
  console.log(`\n🎯 전체: ${totalSuccess}/${totalExpected} 성공 (실행 ${totalExecuted}, 실패 ${totalFail}, skip ${totalSkipped}, 미실행 ${totalNotRun})`);

  const complete = cohorts.every(result =>
    result.expected > 0 &&
    result.executed === result.expected &&
    result.skipped === 0 &&
    result.fail === 0 &&
    result.success === result.expected
  );
  if (!complete) {
    process.exitCode = 1;
    throw new Error('E2E checks failed: every planned case must execute with usable live data');
  }
  return { totalExpected, totalExecuted, totalSuccess, totalFail, totalSkipped, totalNotRun };
}

runAllTests().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
