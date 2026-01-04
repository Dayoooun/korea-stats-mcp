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

async function testQuickStats() {
  console.log('\n========== QUICK_STATS 테스트 ==========\n');

  const results = { success: 0, fail: 0, errors: [] };

  for (const keyword of KEYWORDS) {
    try {
      const result = await quickStats({ query: keyword });
      if (result.success) {
        console.log(`✅ ${keyword}: ${result.value}${result.unit} (${result.period})`);
        results.success++;
      } else {
        console.log(`❌ ${keyword}: ${result.note || 'Failed'}`);
        results.fail++;
        results.errors.push({ keyword, error: result.note });
      }
    } catch (error) {
      console.log(`❌ ${keyword}: ${error.message}`);
      results.fail++;
      results.errors.push({ keyword, error: error.message });
    }
  }

  console.log(`\n📊 Quick Stats 결과: ${results.success}/${KEYWORDS.length} 성공`);
  if (results.errors.length > 0) {
    console.log('\n실패 항목:');
    results.errors.forEach(e => console.log(`  - ${e.keyword}: ${e.error}`));
  }

  return results;
}

async function testQuickTrend() {
  console.log('\n========== QUICK_TREND 테스트 ==========\n');

  const trendKeywords = ['인구', '출산율', '실업률', '물가', '출생아수', '사망률', '이혼율', '경제성장률'];
  const results = { success: 0, fail: 0, errors: [] };

  for (const keyword of trendKeywords) {
    try {
      const result = await quickTrend({ keyword, yearCount: 5 });
      if (result.success) {
        console.log(`✅ ${keyword}: ${result.trend} (${result.dataPoints.length}년)`);
        results.success++;
      } else {
        console.log(`❌ ${keyword}: ${result.note || 'Failed'}`);
        results.fail++;
        results.errors.push({ keyword, error: result.note });
      }
    } catch (error) {
      console.log(`❌ ${keyword}: ${error.message}`);
      results.fail++;
      results.errors.push({ keyword, error: error.message });
    }
  }

  console.log(`\n📊 Quick Trend 결과: ${results.success}/${trendKeywords.length} 성공`);
  if (results.errors.length > 0) {
    console.log('\n실패 항목:');
    results.errors.forEach(e => console.log(`  - ${e.keyword}: ${e.error}`));
  }

  return results;
}

async function testRegionalQueries() {
  console.log('\n========== 지역별 조회 테스트 ==========\n');

  const regionalKeywords = ['인구', '출산율', '물가', '출생아수', '이혼율'];
  const results = { success: 0, fail: 0, errors: [] };

  for (const keyword of regionalKeywords) {
    for (const region of REGIONS) {
      try {
        const result = await quickStats({ query: keyword, region });
        if (result.success) {
          console.log(`✅ ${keyword} (${region}): ${result.value}${result.unit}`);
          results.success++;
        } else {
          console.log(`❌ ${keyword} (${region}): ${result.note || 'Failed'}`);
          results.fail++;
          results.errors.push({ keyword, region, error: result.note });
        }
      } catch (error) {
        console.log(`❌ ${keyword} (${region}): ${error.message}`);
        results.fail++;
        results.errors.push({ keyword, region, error: error.message });
      }
    }
  }

  const total = regionalKeywords.length * REGIONS.length;
  console.log(`\n📊 지역별 조회 결과: ${results.success}/${total} 성공`);
  if (results.errors.length > 0) {
    console.log('\n실패 항목:');
    results.errors.forEach(e => console.log(`  - ${e.keyword} (${e.region}): ${e.error}`));
  }

  return results;
}

async function runAllTests() {
  console.log('🚀 Korea Stats MCP E2E 테스트 시작\n');
  console.log('=' .repeat(50));

  const statsResults = await testQuickStats();
  const trendResults = await testQuickTrend();
  const regionalResults = await testRegionalQueries();

  console.log('\n' + '='.repeat(50));
  console.log('📋 전체 결과 요약');
  console.log('='.repeat(50));
  console.log(`Quick Stats: ${statsResults.success}/${KEYWORDS.length} 성공`);
  console.log(`Quick Trend: ${trendResults.success}/8 성공`);
  console.log(`지역별 조회: ${regionalResults.success}/25 성공`);

  const totalSuccess = statsResults.success + trendResults.success + regionalResults.success;
  const totalTests = KEYWORDS.length + 8 + 25;
  console.log(`\n🎯 전체: ${totalSuccess}/${totalTests} 성공 (${(totalSuccess/totalTests*100).toFixed(1)}%)`);
}

runAllTests().catch(console.error);
