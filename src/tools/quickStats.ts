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
    '자주 묻는 통계를 한 번에 조회합니다. "한국 실업률", "출산율", "인구" 같은 간단한 질문에 바로 답변합니다. 내부적으로 검색, 테이블 정보 조회, 데이터 조회를 자동으로 수행합니다.',
  inputSchema: z.object({
    query: z
      .string()
      .describe('자연어 질문. 예: "한국 실업률", "서울 인구", "출산율", "GDP"'),
    region: z
      .string()
      .optional()
      .describe('지역명 (선택, 미지정시 전국). 예: "서울", "부산"'),
    year: z
      .number()
      .optional()
      .describe('연도 (선택, 미지정시 최근 데이터)'),
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
const REGION_NAMES = ['서울', '부산', '대구', '인천', '광주', '대전', '울산', '세종', '경기'];

export async function quickStats(input: QuickStatsInput): Promise<QuickStatsResult> {
  const client = getKosisClient();
  const cache = getCacheManager();

  try {
    // 1. 쿼리에서 키워드 추출
    const keyword = extractKeyword(input.query);
    const param = getQuickStatsParam(keyword);

    if (!param) {
      // 매핑이 없으면 지원 키워드 안내
      const supportedKeywords = Object.keys(QUICK_STATS_PARAMS).join(', ');
      return {
        success: false,
        answer: `"${input.query}"에 대한 빠른 조회가 지원되지 않습니다.`,
        note: `지원 키워드: ${supportedKeywords}\n또는 search_statistics("${input.query}")로 관련 통계를 검색해보세요.`,
      };
    }

    // 2. 지역 결정
    let regionName = '전국';
    let objL1 = param.objL1;

    // 명시적 region 파라미터
    if (input.region && param.regionCodes) {
      const regionCode = getRegionCode(param, input.region);
      if (regionCode !== param.objL1) {
        objL1 = regionCode;
        regionName = input.region;
      }
    }

    // 쿼리에서 지역명 추출
    if (!input.region) {
      for (const name of REGION_NAMES) {
        if (input.query.includes(name)) {
          if (param.regionCodes) {
            const regionCode = getRegionCode(param, name);
            if (regionCode !== param.objL1) {
              objL1 = regionCode;
              regionName = name;
            }
          }
          break;
        }
      }
    }

    // 3. 데이터 조회 (검증된 정적 파라미터 사용)
    const results = await cache.getStatisticsData(
      {
        orgId: param.orgId,
        tableId: param.tableId,
        objL1,
        objL2: param.objL2,
        itemId: param.itemId,
        periodType: 'Y',
        recentCount: input.year ? undefined : 1,
        year: input.year, // 캐시 키에 year 포함
      },
      async () => {
        return client.getStatisticsData({
          orgId: param.orgId,
          tblId: param.tableId,
          objL1,
          objL2: param.objL2,
          itmId: param.itemId,
          prdSe: 'Y',
          newEstPrdCnt: input.year ? undefined : 1,
          startPrdDe: input.year?.toString(),
          endPrdDe: input.year?.toString(),
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

    // 4. 결과 파싱
    const latestData = results[0];
    const value = latestData.DT;
    const period = latestData.PRD_DE;
    const periodFormatted = formatPeriod(period);
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
 * 연도 형식 포맷팅
 */
function formatPeriod(period: string): string {
  if (period.length === 4) {
    return `${period}년`;
  } else if (period.length === 6) {
    return `${period.slice(0, 4)}년 ${parseInt(period.slice(4), 10)}월`;
  }
  return period;
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

  if (regionName === '전국') {
    return `${period} 한국의 ${description}은(는) ${formattedValue}${unit}입니다.`;
  } else {
    return `${period} ${regionName}의 ${description}은(는) ${formattedValue}${unit}입니다.`;
  }
}
