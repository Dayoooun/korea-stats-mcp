/**
 * 전체 키워드 종합 테스트 스크립트 (ESM)
 *
 * 테스트 범위:
 * 1. 전체 키워드 기본 조회 (전국, 연간)
 * 2. 지역별 조회 (regionCodes 있는 키워드만)
 * 3. 주기별 조회 (supportedPeriods 있는 키워드만)
 */

import { spawn } from 'child_process';
import { config } from 'dotenv';
import { writeFileSync } from 'fs';

// 환경 변수 로드
config();

const API_KEY = process.env.KOSIS_API_KEY?.trim();

// 키워드 정의 (quickStatsParams.ts에서 추출)
const KEYWORDS = [
  // 인구
  '인구', '총인구',
  // 출산율
  '출산율', '합계출산율',
  // 고용
  '실업률', '고용률',
  // 경제
  'GDP', '국내총생산',
  // 물가
  '물가', '소비자물가', '소비자물가지수',
  // 혼인
  '혼인율',
  // 수명
  '기대수명', '기대여명', '평균수명',
  // 무역
  '수출액', '수출', '수입액', '수입', '무역수지',
  // 인구동향
  '출생아수', '출생아', '조출생률', '사망자수', '사망자', '조사망률', '사망률',
  '이혼건수', '조이혼율', '이혼율', '혼인건수', '조혼인율', '자연증가', '자연증가율',
  // 경제성장률
  '경제성장률', '성장률', 'GDP성장률',
  // 고용 추가
  '취업자수', '취업자', '경제활동인구', '실업자수', '실업자', '비경제활동인구',
  // 부동산
  '주택가격', '주택매매가격', '주택가격지수', '아파트가격', '아파트매매가격', '아파트가격지수', '아파트',
  // 임금
  '임금', '월평균임금', '월급', '평균임금',
  // GRDP
  'GRDP', '지역내총생산',
  // 전세
  '전세가격', '전세가격지수', '주택전세', '전세', '아파트전세', '아파트전세가격',
  // 자동차
  '자동차', '자동차등록', '자동차대수',
  // 범죄
  '범죄', '범죄율', '범죄발생',
  // 관광
  '관광객', '외래관광객', '입국자',
  // 교통사고
  '교통사고', '교통사고발생', '사고건수',
  // 의료
  '의사', '의사수', '의료인력',
  // 미세먼지
  '미세먼지', 'PM2.5', '초미세먼지', 'PM10', '대기오염',
];

// 지역 목록
const REGIONS = ['서울', '부산', '대구', '인천', '광주', '대전', '울산', '세종',
                 '경기', '강원', '충북', '충남', '전북', '전남', '경북', '경남', '제주'];

const SAMPLE_REGIONS = ['서울', '부산', '제주'];
// 지역별 조회 지원 키워드 (regionCodes가 있는 키워드)
const REGION_KEYWORDS = [
  '인구', '총인구', '출산율', '합계출산율', '실업률', '고용률',
  '물가', '소비자물가', '소비자물가지수', '혼인율',
  '수출액', '수출',
  '출생아수', '출생아', '조출생률', '사망자수', '사망자', '조사망률', '사망률',
  '이혼건수', '조이혼율', '이혼율', '혼인건수', '조혼인율', '자연증가', '자연증가율',
  '주택가격', '주택매매가격', '주택가격지수', '아파트가격', '아파트매매가격', '아파트가격지수', '아파트',
  '임금', '월평균임금', '월급', '평균임금',
  'GRDP', '지역내총생산',
  '전세가격', '전세가격지수', '주택전세', '전세', '아파트전세', '아파트전세가격',
  '자동차', '자동차등록', '자동차대수',
  '범죄', '범죄율', '범죄발생',
  '교통사고', '교통사고발생', '사고건수',
  '의사', '의사수', '의료인력',
  '미세먼지', 'PM2.5', '초미세먼지', 'PM10', '대기오염',
];

// 월간(M) 지원 키워드
const MONTHLY_KEYWORDS = [
  '실업률', '고용률', '물가', '소비자물가', '소비자물가지수',
  '출생아수', '출생아', '조출생률', '사망자수', '사망자', '조사망률', '사망률',
  '이혼건수', '조이혼율', '이혼율', '혼인건수', '조혼인율', '자연증가', '자연증가율',
  '주택가격', '주택매매가격', '주택가격지수', '아파트가격', '아파트매매가격', '아파트가격지수', '아파트',
  '전세가격', '전세가격지수', '주택전세', '전세', '아파트전세', '아파트전세가격',
  '관광객', '외래관광객', '입국자',
  '미세먼지', 'PM2.5', '초미세먼지', 'PM10', '대기오염',
];

// 분기(Q) 지원 키워드
const QUARTERLY_KEYWORDS = [
  '실업률', '고용률',
  '출생아수', '출생아', '조출생률', '사망자수', '사망자', '조사망률', '사망률',
  '이혼건수', '조이혼율', '이혼율', '혼인건수', '조혼인율', '자연증가', '자연증가율',
];

// 결과 저장
const results = {
  basic: { expected: KEYWORDS.length, executed: 0, success: [], fail: [], skipped: 0 },
  regional: { expected: REGION_KEYWORDS.length * SAMPLE_REGIONS.length, executed: 0, success: [], fail: [], skipped: 0 },
  monthly: { expected: MONTHLY_KEYWORDS.length, executed: 0, success: [], fail: [], skipped: 0 },
  quarterly: { expected: QUARTERLY_KEYWORDS.length, executed: 0, success: [], fail: [], skipped: 0 },
};

// MCP 서버 프로세스
let mcpProcess = null;

/**
 * MCP 서버 시작
 */
function startServer() {
  return new Promise((resolve, reject) => {
    console.log('🚀 MCP 서버 시작 중...');

    mcpProcess = spawn('node', ['dist/index.js'], {
      env: { ...process.env, KOSIS_API_KEY: API_KEY },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let settled = false;
    const startupTimeout = setTimeout(() => {
      if (!settled) finish(new Error('MCP server startup timed out'));
    }, 10_000);

    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(startupTimeout);
      mcpProcess?.stderr.removeListener('data', onStderr);
      mcpProcess?.removeListener('error', onError);
      mcpProcess?.removeListener('close', onClose);
      if (error) reject(error);
      else resolve();
    };

    const onStderr = (data) => {
      // dist/index.ts emits this only after the stdio server is connected.
      if (data.toString().includes('Korea Stats MCP:')) finish();
    };
    const onError = (error) => finish(error);
    const onClose = (code) => {
      if (!settled) finish(new Error(`MCP server exited before readiness (code ${code ?? 'unknown'})`));
    };

    mcpProcess.stderr.on('data', onStderr);
    mcpProcess.once('error', onError);
    mcpProcess.once('close', onClose);
  });
}

/**
 * MCP 요청 전송
 */
async function sendRequest(method, params) {
  return new Promise((resolve, reject) => {
    if (!mcpProcess || mcpProcess.killed || !mcpProcess.stdin || !mcpProcess.stdout) {
      reject(new Error('MCP server is not ready'));
      return;
    }

    const request = {
      jsonrpc: '2.0',
      id: Date.now(),
      method,
      params,
    };
    let responseData = '';
    let settled = false;

    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      mcpProcess?.stdout.removeListener('data', onData);
      mcpProcess?.removeListener('close', onClose);
      if (error) reject(error);
      else resolve(value);
    };

    const timeout = setTimeout(() => finish(new Error('Request timeout')), 30_000);

    const onData = (data) => {
      responseData += data.toString();

      // JSON 응답 파싱 시도
      try {
        const lines = responseData.split('\n').filter(l => l.trim());
        for (const line of lines) {
          if (!line.startsWith('{')) continue;
          const json = JSON.parse(line);
          if (json.id === request.id) {
            finish(null, json);
            return;
          }
        }
      } catch {
        // 불완전한 JSON은 다음 chunk에서 다시 시도한다.
      }
    };
    const onClose = (code) => finish(new Error(`MCP server exited during request (code ${code ?? 'unknown'})`));

    mcpProcess.stdout.on('data', onData);
    mcpProcess.once('close', onClose);
    try {
      mcpProcess.stdin.write(JSON.stringify(request) + '\n');
    } catch (error) {
      finish(error);
    }
  });
}
function usableQuickStatsResult(result) {
  return result &&
    typeof result === 'object' &&
    result.success === true &&
    typeof result.answer === 'string' &&
    result.answer.trim().length > 0;
}

/**
 * quick_stats 호출
 */
async function callQuickStats(query, region = null, period = null, month = null, quarter = null) {
  const args = { query };
  if (region) args.region = region;
  if (period) args.period = period;
  if (month) args.month = month;
  if (quarter) args.quarter = quarter;

  try {
    const response = await sendRequest('tools/call', {
      name: 'quick_stats',
      arguments: args,
    });

    if (response.error) {
      return { success: false, error: response.error.message };
    }

    const content = response.result?.content?.[0]?.text;
    if (!content) {
      return { success: false, error: 'No content' };
    }

    const result = JSON.parse(content);
    return result;
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * 진행상황 출력
 */
function printProgress(current, total, label) {
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  const bar = '█'.repeat(Math.floor(pct / 5)) + '░'.repeat(20 - Math.floor(pct / 5));
  process.stdout.write(`\r[${bar}] ${pct}% - ${label}                    `);
}
function failureReason(result) {
  if (!result || typeof result !== 'object') return 'No usable live data';
  return result.answer || result.error || 'No usable live data';
}

function recordResult(cohort, details, result) {
  cohort.executed += 1;
  if (usableQuickStatsResult(result)) {
    cohort.success.push({ ...details, answer: result.answer.substring(0, 50) });
  } else {
    cohort.fail.push({ ...details, error: failureReason(result) });
  }
}
function requirePrerequisites() {
  const missing = [];
  if (!API_KEY) missing.push('KOSIS_API_KEY');
  if (KEYWORDS.length === 0) missing.push('basic keyword cohort');
  if (REGION_KEYWORDS.length === 0 || SAMPLE_REGIONS.length === 0) missing.push('regional cohort');
  if (MONTHLY_KEYWORDS.length === 0) missing.push('monthly keyword cohort');
  if (QUARTERLY_KEYWORDS.length === 0) missing.push('quarterly keyword cohort');
  if (missing.length > 0) throw new Error(`Test prerequisite failed: ${missing.join(', ')}`);
}

/**
 * 테스트 실행
 */
async function runTests() {
  console.log('\n📊 korea-stats-mcp 전체 키워드 종합 테스트\n');
  console.log(`총 키워드: ${KEYWORDS.length}개`);
  console.log(`지역 지원: ${REGION_KEYWORDS.length}개 × 샘플 지역 ${SAMPLE_REGIONS.length}개`);
  console.log(`월간 지원: ${MONTHLY_KEYWORDS.length}개`);
  console.log(`분기 지원: ${QUARTERLY_KEYWORDS.length}개`);
  console.log('─'.repeat(60));

  let executionError = null;
  try {
    requirePrerequisites();
    await startServer();
    console.log('✅ MCP 서버 시작 완료\n');

    // 1. 기본 테스트 (전체 키워드)
    console.log('\n📌 [1/4] 기본 조회 테스트 (전국, 연간)');
    console.log('─'.repeat(60));

    for (let i = 0; i < KEYWORDS.length; i++) {
      const keyword = KEYWORDS[i];
      printProgress(i + 1, results.basic.expected, keyword);
      const result = await callQuickStats(keyword);
      recordResult(results.basic, { keyword }, result);
      await sleep(100); // API 호출 제한 방지
    }
    console.log('\n');

    // 2. 지역별 테스트 (샘플링: 서울, 부산, 제주)
    console.log(`\n📌 [2/4] 지역별 조회 테스트 (${SAMPLE_REGIONS.join(', ')})`);
    console.log('─'.repeat(60));

    let regionalCount = 0;
    for (const keyword of REGION_KEYWORDS) {
      for (const region of SAMPLE_REGIONS) {
        regionalCount++;
        printProgress(regionalCount, results.regional.expected, `${region} ${keyword}`);

        const result = await callQuickStats(`${region} ${keyword}`, region);
        recordResult(results.regional, { keyword, region }, result);
        await sleep(100);
      }
    }
    console.log('\n');

    // 3. 월간 테스트
    console.log('\n📌 [3/4] 월간 조회 테스트 (period: M)');
    console.log('─'.repeat(60));

    for (let i = 0; i < MONTHLY_KEYWORDS.length; i++) {
      const keyword = MONTHLY_KEYWORDS[i];
      printProgress(i + 1, results.monthly.expected, keyword);

      const result = await callQuickStats(keyword, null, 'M');
      recordResult(results.monthly, { keyword }, result);
      await sleep(100);
    }
    console.log('\n');

    // 4. 분기 테스트
    console.log('\n📌 [4/4] 분기별 조회 테스트 (period: Q)');
    console.log('─'.repeat(60));

    for (let i = 0; i < QUARTERLY_KEYWORDS.length; i++) {
      const keyword = QUARTERLY_KEYWORDS[i];
      printProgress(i + 1, results.quarterly.expected, keyword);

      const result = await callQuickStats(keyword, null, 'Q');
      recordResult(results.quarterly, { keyword }, result);
      await sleep(100);
    }
    console.log('\n');
  } catch (error) {
    executionError = error instanceof Error ? error : new Error(String(error));
    console.error('테스트 실행 중 오류:', executionError.message);
  } finally {
    if (mcpProcess) {
      mcpProcess.kill();
      mcpProcess = null;
    }
  }

  // 결과 출력
  printResults();

  const cohorts = [results.basic, results.regional, results.monthly, results.quarterly];
  const complete = !executionError && cohorts.every(cohort =>
    cohort.expected > 0 &&
    cohort.executed === cohort.expected &&
    cohort.success.length === cohort.expected &&
    cohort.skipped === 0 &&
    cohort.fail.length === 0
  );
  if (!complete) {
    process.exitCode = 1;
    console.error('종합 테스트 실패: 모든 계획된 케이스가 실행되고 usable live data를 반환해야 합니다.');
  }
  return complete;
}

/**
 * 결과 출력
 */
function printCohort(label, cohort, formatFailure) {
  const notRun = Math.max(cohort.expected - cohort.executed, 0);
  const pct = cohort.expected > 0 ? Math.round((cohort.success.length / cohort.expected) * 100) : 0;
  console.log(
    `\n${label}: ${cohort.success.length}/${cohort.expected} (${pct}%)` +
    ` (실행 ${cohort.executed}, 실패 ${cohort.fail.length}, skip ${cohort.skipped}, 미실행 ${notRun})`
  );
  if (cohort.fail.length > 0) {
    console.log('   ❌ 실패:');
    cohort.fail.forEach(f => console.log(`      - ${formatFailure(f)}: ${String(f.error).slice(0, 60)}`));
  }
}

function printResults() {
  console.log('\n');
  console.log('═'.repeat(60));
  console.log('📊 테스트 결과 요약');
  console.log('═'.repeat(60));

  printCohort('[1] 기본 조회', results.basic, f => f.keyword);
  printCohort('[2] 지역별 조회', results.regional, f => `${f.region} ${f.keyword}`);
  printCohort('[3] 월간 조회', results.monthly, f => f.keyword);
  printCohort('[4] 분기별 조회', results.quarterly, f => f.keyword);

  const cohorts = [results.basic, results.regional, results.monthly, results.quarterly];
  const totalExpected = cohorts.reduce((sum, cohort) => sum + cohort.expected, 0);
  const totalExecuted = cohorts.reduce((sum, cohort) => sum + cohort.executed, 0);
  const totalSuccess = cohorts.reduce((sum, cohort) => sum + cohort.success.length, 0);
  const totalFail = cohorts.reduce((sum, cohort) => sum + cohort.fail.length, 0);
  const totalSkipped = cohorts.reduce((sum, cohort) => sum + cohort.skipped, 0);
  const totalNotRun = Math.max(totalExpected - totalExecuted, 0);
  const totalPct = totalExpected > 0 ? Math.round((totalSuccess / totalExpected) * 100) : 0;

  console.log('\n' + '═'.repeat(60));
  console.log(
    `📈 전체 결과: ${totalSuccess}/${totalExpected} (${totalPct}%)` +
    ` (실행 ${totalExecuted}, 실패 ${totalFail}, skip ${totalSkipped}, 미실행 ${totalNotRun})`
  );
  console.log('═'.repeat(60));

  if (totalFail === 0 && totalSkipped === 0 && totalNotRun === 0 && totalExpected > 0) {
    console.log('\n🎉 모든 테스트 통과!\n');
  } else {
    console.log(`\n⚠️ 실패 ${totalFail}건, skip ${totalSkipped}건, 미실행 ${totalNotRun}건\n`);
  }

  // JSON 결과 저장
  writeFileSync('test-results.json', JSON.stringify(results, null, 2));
  console.log('📁 상세 결과: test-results.json 저장됨\n');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 실행
runTests().then(passed => {
  if (!passed) process.exitCode = 1;
}).catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
