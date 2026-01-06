/**
 * 빠른 통계 조회 도구
 * 자연어 질문으로 한 번에 통계 데이터를 조회하고 자연어 응답을 생성
 *
 * 개선: 정적으로 검증된 파라미터 사용 (동적 조회 대신)
 */

import { z } from 'zod';
import { getKosisClient } from '../api/client.js';
import { getCacheManager } from '../cache/index.js';
import {
  QUICK_STATS_PARAMS,
  getQuickStatsParam,
  getRegionCode,
} from '../data/quickStatsParams.js';

export const quickStatsSchema = {
  name: 'quick_stats',
  description:
    '【실제 수치 반환】 80개 이상 키워드의 통계 수치를 즉시 조회합니다. 인구, 실업률, GDP, 출산율, 미세먼지, 교통사고, 의사수, 범죄율, 아파트가격 등. "~이 얼마야?", "~알려줘" 같은 수치 질문에 이 도구를 사용하세요. 17개 시도별 조회 지원. search_statistics는 통계표 목록만 검색하고, 이 도구는 실제 데이터 값을 반환합니다.',
  inputSchema: z.object({
    query: z
      .string()
      .describe('통계 키워드. 예: "실업률", "인구", "출산율", "GDP"'),
    region: z
      .string()
      .optional()
      .describe('지역명 (선택, 미지정시 전국). 예: "서울", "부산"'),
    year: z
      .number()
      .optional()
      .describe('조회할 연도 (선택, 미지정시 최근 데이터). 질문에 연도가 포함되면 반드시 추출하여 전달. 예: "2010년 GDP" → year: 2010'),
    period: z
      .enum(['Y', 'Q', 'M'])
      .optional()
      .describe('조회 주기 (선택, 기본값: Y). Y=연간, Q=분기, M=월별. 예: "10월 출생아수" → period: "M"'),
    month: z
      .number()
      .min(1)
      .max(12)
      .optional()
      .describe('조회할 월 (period가 M일 때 사용). 예: "10월 출생아수" → month: 10'),
    quarter: z
      .number()
      .min(1)
      .max(4)
      .optional()
      .describe('조회할 분기 (period가 Q일 때 사용). 예: "3분기 실업률" → quarter: 3'),
  }),
};

export type QuickStatsInput = z.infer<typeof quickStatsSchema.inputSchema>;

interface QuickStatsResult {
  success: boolean;
  answer: string;
  value?: number | string;
  unit?: string;
  period?: string;
  source?: {
    orgId: string;
    tableId: string;
    tableName: string;
  };
  note?: string;
}

/**
 * 지역명 목록 (쿼리에서 지역 추출용)
 */
const REGION_NAMES = [
  '서울', '부산', '대구', '인천', '광주', '대전', '울산', '세종',
  '경기', '강원', '충북', '충남', '전북', '전남', '경북', '경남', '제주'
];

export async function quickStats(input: QuickStatsInput): Promise<QuickStatsResult> {
  const client = getKosisClient();
  const cache = getCacheManager();

  try {
    // 1. 쿼리에서 키워드 추출
    const keyword = extractKeyword(input.query);
    const param = getQuickStatsParam(keyword);

    if (!param) {
      // 매핑이 없으면 카테고리별 지원 키워드 안내
      const keywordGuide = `
📊 지원 키워드 (카테고리별 대표 예시):
• 인구/출산: 인구, 출산율, 출생아수, 사망률, 기대수명
• 고용/노동: 실업률, 고용률, 취업자수, 임금
• 경제: GDP, GRDP, 경제성장률, 물가
• 무역: 수출, 수입, 무역수지
• 혼인/이혼: 혼인율, 이혼율
• 부동산: 주택가격, 아파트가격, 전세가격
• 교통: 자동차, 교통사고
• 환경: 미세먼지, PM2.5, PM10
• 사회: 범죄율, 의사수, 외래관광객

💡 지역별: "서울 실업률", "부산 인구" (17개 시도)
💡 월별: "2024년 10월 출생아수" (일부 키워드)`.trim();

      return {
        success: false,
        answer: `"${input.query}"에 대한 빠른 조회가 지원되지 않습니다.`,
        note: `${keywordGuide}\n\n🔍 다른 통계는 search_statistics("${input.query}")로 검색해보세요.`,
      };
    }

    // 2. 지역 결정
    let regionName = '전국';
    let objL1 = param.objL1;
    let requestedRegion: string | null = null;

    // 명시적 region 파라미터
    if (input.region) {
      requestedRegion = input.region;
    }

    // 쿼리에서 지역명 추출
    if (!requestedRegion) {
      for (const name of REGION_NAMES) {
        if (input.query.includes(name)) {
          requestedRegion = name;
          break;
        }
      }
    }

    // 지역 요청이 있는 경우 처리
    if (requestedRegion) {
      if (!param.regionCodes) {
        // 지역별 데이터를 지원하지 않는 통계
        return {
          success: false,
          answer: `"${input.query}"는 지역별 조회를 지원하지 않습니다. 전국 데이터만 제공됩니다.`,
          note: `지역별 조회 가능: 인구, 출산율, 사망률, 혼인율, 이혼율, 실업률, 고용률 등`,
        };
      }
      const regionCode = getRegionCode(param, requestedRegion);
      if (regionCode !== param.objL1) {
        objL1 = regionCode;
        regionName = requestedRegion;
      }
    }

    // 3. 주기(period) 결정 및 검증
    const supportedPeriods = param.supportedPeriods || ['Y'];
    // 사용자가 주기를 지정하지 않으면 키워드의 첫 번째 지원 주기 사용
    const defaultPeriod = supportedPeriods[0];
    const requestedPeriod = input.period || defaultPeriod;

    if (!supportedPeriods.includes(requestedPeriod)) {
      const periodNames = { 'Y': '연간', 'Q': '분기', 'M': '월별' } as const;
      const supportedNames = supportedPeriods.map(p => periodNames[p]).join(', ');
      return {
        success: false,
        answer: `"${input.query}"는 ${periodNames[requestedPeriod]} 조회를 지원하지 않습니다.`,
        note: `지원 주기: ${supportedNames}`,
      };
    }

    // 4. 조회 기간 계산
    let startPrd: string | undefined;
    let endPrd: string | undefined;

    if (input.year) {
      if (requestedPeriod === 'Y') {
        startPrd = input.year.toString();
        endPrd = input.year.toString();
      } else if (requestedPeriod === 'Q' && input.quarter) {
        const qStr = `${input.year}${input.quarter.toString().padStart(2, '0')}`;
        startPrd = qStr;
        endPrd = qStr;
      } else if (requestedPeriod === 'M' && input.month) {
        const mStr = `${input.year}${input.month.toString().padStart(2, '0')}`;
        startPrd = mStr;
        endPrd = mStr;
      } else if (requestedPeriod === 'Q') {
        // 해당 연도의 모든 분기
        startPrd = `${input.year}01`;
        endPrd = `${input.year}04`;
      } else if (requestedPeriod === 'M') {
        // 해당 연도의 모든 월
        startPrd = `${input.year}01`;
        endPrd = `${input.year}12`;
      }
    }

    // 5. 데이터 조회 (검증된 정적 파라미터 사용)
    const results = await cache.getStatisticsData(
      {
        orgId: param.orgId,
        tableId: param.tableId,
        objL1,
        objL2: param.objL2,
        itemId: param.itemId,
        periodType: requestedPeriod,
        recentCount: startPrd ? undefined : 1,
        year: input.year,
        month: input.month,
        quarter: input.quarter,
      },
      async () => {
        return client.getStatisticsData({
          orgId: param.orgId,
          tblId: param.tableId,
          objL1,
          objL2: param.objL2,
          itmId: param.itemId,
          prdSe: requestedPeriod,
          newEstPrdCnt: startPrd ? undefined : 1,
          startPrdDe: startPrd,
          endPrdDe: endPrd,
        });
      }
    );

    if (results.length === 0) {
      return {
        success: false,
        answer: `"${input.query}"에 대한 데이터를 찾을 수 없습니다.`,
        note: `테이블: ${param.tableName} (${param.tableId})\n다른 검색어로 시도하거나 search_statistics를 사용해보세요.`,
      };
    }

    // 6. 결과 파싱
    const latestData = results[0];
    const value = latestData.DT;
    const period = latestData.PRD_DE;
    const periodFormatted = formatPeriodWithType(period, requestedPeriod);
    const unit = param.unit;

    // 5. 자연어 응답 생성
    const answer = generateNaturalResponse({
      keyword,
      regionName,
      value,
      unit,
      period: periodFormatted,
      description: param.description,
    });

    return {
      success: true,
      answer,
      value,
      unit,
      period: periodFormatted,
      source: {
        orgId: param.orgId,
        tableId: param.tableId,
        tableName: param.tableName,
      },
    };
  } catch (error) {
    console.error('Quick stats error:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      answer: `조회 중 오류가 발생했습니다: ${errorMessage}`,
      note: `search_statistics("${input.query}")로 직접 검색해보세요.`,
    };
  }
}

/**
 * 쿼리에서 키워드 추출
 */
function extractKeyword(query: string): string {
  // 매핑 키워드와 직접 매칭 (긴 키워드 우선)
  const sortedKeywords = Object.keys(QUICK_STATS_PARAMS).sort((a, b) => b.length - a.length);

  for (const keyword of sortedKeywords) {
    if (query.includes(keyword)) {
      return keyword;
    }
  }

  // 공백으로 분리하여 매칭 시도
  const words = query.split(/\s+/);
  for (const word of words) {
    if (QUICK_STATS_PARAMS[word]) {
      return word;
    }
  }

  return query;
}

/**
 * 기간 형식 포맷팅 (년/분기/월 지원)
 */
function formatPeriod(period: string): string {
  if (period.length === 4) {
    // 연간: "2024" → "2024년"
    return `${period}년`;
  } else if (period.length === 6) {
    const year = period.slice(0, 4);
    const suffix = period.slice(4);
    const num = parseInt(suffix, 10);

    // 분기인지 월인지 구분 (01~04는 분기일 수도, 01~12는 월)
    // KOSIS API는 분기를 01, 02, 03, 04로, 월을 01~12로 표현
    // 구분을 위해 값의 범위로 판단 (5 이상이면 월)
    if (num >= 5 && num <= 12) {
      // 월간: "202410" → "2024년 10월"
      return `${year}년 ${num}월`;
    } else if (num >= 1 && num <= 4) {
      // 분기: "202401" → "2024년 1분기" (단, 월일 수도 있음)
      // 이 경우 호출 컨텍스트에서 판단해야 함
      // 기본적으로 월로 처리 (1~4월)
      return `${year}년 ${num}월`;
    }
  }
  return period;
}

/**
 * 기간 형식 포맷팅 (주기 타입 명시)
 */
function formatPeriodWithType(period: string, periodType: 'Y' | 'Q' | 'M'): string {
  if (period.length === 4) {
    return `${period}년`;
  } else if (period.length === 6) {
    const year = period.slice(0, 4);
    const num = parseInt(period.slice(4), 10);

    if (periodType === 'Q') {
      return `${year}년 ${num}분기`;
    } else if (periodType === 'M') {
      return `${year}년 ${num}월`;
    }
  }
  return period;
}

/**
 * 한국어 받침 유무에 따라 조사 선택
 * 받침이 있으면 '은', 없으면 '는'
 */
function getKoreanParticle(text: string): string {
  if (!text || text.length === 0) return '은';

  const lastChar = text.charAt(text.length - 1);
  const code = lastChar.charCodeAt(0);

  // 한글 유니코드 범위: 0xAC00 ~ 0xD7A3
  if (code >= 0xAC00 && code <= 0xD7A3) {
    // 종성(받침) 존재 여부 확인
    // (code - 0xAC00) % 28 === 0 이면 받침 없음
    const hasJongseong = (code - 0xAC00) % 28 !== 0;
    return hasJongseong ? '은' : '는';
  }

  // 숫자나 영문 등은 기본적으로 '는' 사용
  return '는';
}

/**
 * 자연어 응답 생성
 */
function generateNaturalResponse(data: {
  keyword: string;
  regionName: string;
  value: string;
  unit: string;
  period: string;
  description: string;
}): string {
  const { regionName, value, unit, period, description } = data;

  // 숫자 포맷팅 (콤마 추가)
  const formattedValue = value.includes(',') ? value : Number(value).toLocaleString();

  // 단위 포맷팅 (지수 기준연도는 괄호로 감싸기)
  let formattedUnit = unit;
  if (unit.includes('=')) {
    // 지수 단위 (예: 2020=100, 2021.6=100)
    formattedUnit = unit.startsWith('(') ? ` ${unit}` : ` (${unit})`;
  }

  // 한국어 문법: 받침 유무에 따라 은/는 선택
  const suffix = getKoreanParticle(description);

  if (regionName === '전국') {
    return `${period} 한국의 ${description}${suffix} ${formattedValue}${formattedUnit}입니다.`;
  } else {
    return `${period} ${regionName}의 ${description}${suffix} ${formattedValue}${formattedUnit}입니다.`;
  }
}
