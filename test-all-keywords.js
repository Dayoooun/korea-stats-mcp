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

const API_KEY = process.env.KOSIS_API_KEY;
if (!API_KEY) {
  console.error('❌ KOSIS_API_KEY 환경 변수가 설정되지 않았습니다.');
  process.exit(1);
}

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
  basic: { success: [], fail: [] },
  regional: { success: [], fail: [] },
  monthly: { success: [], fail: [] },
  quarterly: { success: [], fail: [] },
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

    let initialized = false;

    mcpProcess.stderr.on('data', (data) => {
      const msg = data.toString();
      if (msg.includes('KOSIS MCP Server started') || msg.includes('Server running')) {
        if (!initialized) {
          initialized = true;
          setTimeout(resolve, 500);
        }
      }
    });

    mcpProcess.on('error', reject);

    // 3초 후 타임아웃
    setTimeout(() => {
      if (!initialized) {
        initialized = true;
        resolve();
      }
    }, 3000);
  });
}

/**
 * MCP 요청 전송
 */
async function sendRequest(method, params) {
  return new Promise((resolve, reject) => {
    const request = {
      jsonrpc: '2.0',
      id: Date.now(),
      method,
      params,
    };

    let responseData = '';

    const timeout = setTimeout(() => {
      reject(new Error('Request timeout'));
    }, 30000);

    const onData = (data) => {
      responseData += data.toString();

      // JSON 응답 파싱 시도
      try {
        const lines = responseData.split('\n').filter(l => l.trim());
        for (const line of lines) {
          if (line.startsWith('{')) {
            const json = JSON.parse(line);
            if (json.id === request.id) {
              clearTimeout(timeout);
              mcpProcess.stdout.removeListener('data', onData);
              resolve(json);
              return;
            }
          }
        }
      } catch (e) {
        // 계속 대기
      }
    };

    mcpProcess.stdout.on('data', onData);
    mcpProcess.stdin.write(JSON.stringify(request) + '\n');
  });
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
    return { success: false, error: e.message };
  }
}

/**
 * 진행상황 출력
 */
function printProgress(current, total, label) {
  const pct = Math.round((current / total) * 100);
  const bar = '█'.repeat(Math.floor(pct / 5)) + '░'.repeat(20 - Math.floor(pct / 5));
  process.stdout.write(`\r[${bar}] ${pct}% - ${label}                    `);
}

/**
 * 테스트 실행
 */
async function runTests() {
  console.log('\n📊 korea-stats-mcp 전체 키워드 종합 테스트\n');
  console.log(`총 키워드: ${KEYWORDS.length}개`);
  console.log(`지역 지원: ${REGION_KEYWORDS.length}개`);
  console.log(`월간 지원: ${MONTHLY_KEYWORDS.length}개`);
  console.log(`분기 지원: ${QUARTERLY_KEYWORDS.length}개`);
  console.log('─'.repeat(60));

  try {
    await startServer();
    console.log('✅ MCP 서버 시작 완료\n');

    // 1. 기본 테스트 (전체 키워드)
    console.log('\n📌 [1/4] 기본 조회 테스트 (전국, 연간)');
    console.log('─'.repeat(60));

    for (let i = 0; i < KEYWORDS.length; i++) {
      const keyword = KEYWORDS[i];
      printProgress(i + 1, KEYWORDS.length, keyword);

      const result = await callQuickStats(keyword);

      if (result.success) {
        results.basic.success.push({ keyword, answer: result.answer?.substring(0, 50) });
      } else {
        results.basic.fail.push({ keyword, error: result.answer || result.error });
      }

      await sleep(100); // API 호출 제한 방지
    }
    console.log('\n');

    // 2. 지역별 테스트 (샘플링: 서울, 부산, 제주)
    console.log('\n📌 [2/4] 지역별 조회 테스트 (서울, 부산, 제주)');
    console.log('─'.repeat(60));

    const sampleRegions = ['서울', '부산', '제주'];
    const regionalTests = REGION_KEYWORDS.length * sampleRegions.length;
    let regionalCount = 0;

    for (const keyword of REGION_KEYWORDS) {
      for (const region of sampleRegions) {
        regionalCount++;
        printProgress(regionalCount, regionalTests, `${region} ${keyword}`);

        const result = await callQuickStats(`${region} ${keyword}`, region);

        if (result.success) {
          results.regional.success.push({ keyword, region, answer: result.answer?.substring(0, 50) });
        } else {
          results.regional.fail.push({ keyword, region, error: result.answer || result.error });
        }

        await sleep(100);
      }
    }
    console.log('\n');

    // 3. 월간 테스트
    console.log('\n📌 [3/4] 월간 조회 테스트 (period: M)');
    console.log('─'.repeat(60));

    for (let i = 0; i < MONTHLY_KEYWORDS.length; i++) {
      const keyword = MONTHLY_KEYWORDS[i];
      printProgress(i + 1, MONTHLY_KEYWORDS.length, keyword);

      const result = await callQuickStats(keyword, null, 'M');

      if (result.success) {
        results.monthly.success.push({ keyword, answer: result.answer?.substring(0, 50) });
      } else {
        results.monthly.fail.push({ keyword, error: result.answer || result.error });
      }

      await sleep(100);
    }
    console.log('\n');

    // 4. 분기 테스트
    console.log('\n📌 [4/4] 분기별 조회 테스트 (period: Q)');
    console.log('─'.repeat(60));

    for (let i = 0; i < QUARTERLY_KEYWORDS.length; i++) {
      const keyword = QUARTERLY_KEYWORDS[i];
      printProgress(i + 1, QUARTERLY_KEYWORDS.length, keyword);

      const result = await callQuickStats(keyword, null, 'Q');

      if (result.success) {
        results.quarterly.success.push({ keyword, answer: result.answer?.substring(0, 50) });
      } else {
        results.quarterly.fail.push({ keyword, error: result.answer || result.error });
      }

      await sleep(100);
    }
    console.log('\n');

  } catch (error) {
    console.error('테스트 실행 중 오류:', error);
  } finally {
    if (mcpProcess) {
      mcpProcess.kill();
    }
  }

  // 결과 출력
  printResults();
}

/**
 * 결과 출력
 */
function printResults() {
  console.log('\n');
  console.log('═'.repeat(60));
  console.log('📊 테스트 결과 요약');
  console.log('═'.repeat(60));

  // 기본 테스트
  const basicTotal = results.basic.success.length + results.basic.fail.length;
  const basicPct = basicTotal > 0 ? Math.round((results.basic.success.length / basicTotal) * 100) : 0;
  console.log(`\n[1] 기본 조회: ${results.basic.success.length}/${basicTotal} (${basicPct}%)`);
  if (results.basic.fail.length > 0) {
    console.log('   ❌ 실패:');
    results.basic.fail.forEach(f => console.log(`      - ${f.keyword}: ${f.error?.substring(0, 60)}`));
  }

  // 지역별 테스트
  const regTotal = results.regional.success.length + results.regional.fail.length;
  const regPct = regTotal > 0 ? Math.round((results.regional.success.length / regTotal) * 100) : 0;
  console.log(`\n[2] 지역별 조회: ${results.regional.success.length}/${regTotal} (${regPct}%)`);
  if (results.regional.fail.length > 0) {
    console.log('   ❌ 실패:');
    results.regional.fail.slice(0, 10).forEach(f =>
      console.log(`      - ${f.region} ${f.keyword}: ${f.error?.substring(0, 50)}`));
    if (results.regional.fail.length > 10) {
      console.log(`      ... 외 ${results.regional.fail.length - 10}건`);
    }
  }

  // 월간 테스트
  const monthTotal = results.monthly.success.length + results.monthly.fail.length;
  const monthPct = monthTotal > 0 ? Math.round((results.monthly.success.length / monthTotal) * 100) : 0;
  console.log(`\n[3] 월간 조회: ${results.monthly.success.length}/${monthTotal} (${monthPct}%)`);
  if (results.monthly.fail.length > 0) {
    console.log('   ❌ 실패:');
    results.monthly.fail.forEach(f => console.log(`      - ${f.keyword}: ${f.error?.substring(0, 60)}`));
  }

  // 분기 테스트
  const qtrTotal = results.quarterly.success.length + results.quarterly.fail.length;
  const qtrPct = qtrTotal > 0 ? Math.round((results.quarterly.success.length / qtrTotal) * 100) : 0;
  console.log(`\n[4] 분기별 조회: ${results.quarterly.success.length}/${qtrTotal} (${qtrPct}%)`);
  if (results.quarterly.fail.length > 0) {
    console.log('   ❌ 실패:');
    results.quarterly.fail.forEach(f => console.log(`      - ${f.keyword}: ${f.error?.substring(0, 60)}`));
  }

  // 전체 요약
  const totalSuccess = results.basic.success.length + results.regional.success.length +
                       results.monthly.success.length + results.quarterly.success.length;
  const totalFail = results.basic.fail.length + results.regional.fail.length +
                    results.monthly.fail.length + results.quarterly.fail.length;
  const totalTests = totalSuccess + totalFail;
  const totalPct = totalTests > 0 ? Math.round((totalSuccess / totalTests) * 100) : 0;

  console.log('\n' + '═'.repeat(60));
  console.log(`📈 전체 결과: ${totalSuccess}/${totalTests} (${totalPct}%)`);
  console.log('═'.repeat(60));

  if (totalFail === 0) {
    console.log('\n🎉 모든 테스트 통과!\n');
  } else {
    console.log(`\n⚠️ ${totalFail}건 실패\n`);
  }

  // JSON 결과 저장
  writeFileSync('test-results.json', JSON.stringify(results, null, 2));
  console.log('📁 상세 결과: test-results.json 저장됨\n');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 실행
runTests().catch(console.error);
