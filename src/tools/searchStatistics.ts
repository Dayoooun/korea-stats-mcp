/**
 * 통계 검색 도구
 * 키워드로 KOSIS 통계표를 검색
 */

import { z } from 'zod';
import { getKosisClient } from '../api/client.js';
import { getCacheManager } from '../cache/index.js';
import { parseQuery, generateSearchTerms, REGION_NAMES } from '../utils/queryParser.js';
import type { SimplifiedStatisticsItem } from '../api/types.js';

/**
 * 키워드별 우선 표시 테이블 ID
 * - 검색 결과에서 이 테이블들이 있으면 상위로 배치
 * - 일반 사용자가 가장 기대하는 결과를 먼저 보여주기 위함
 */
const PRIORITY_TABLES: Record<string, string[]> = {
  // 인구 관련
  '인구': ['DT_1B04005', 'DT_1IN1503', 'DT_1YL20001', 'DT_1B8000F'],
  '인구수': ['DT_1B04005', 'DT_1IN1503'],
  '총인구': ['DT_1B04005', 'DT_1IN1503', 'DT_1YL20001'],
  '주민등록인구': ['DT_1B04005', 'DT_1IN1503'],
  '인구현황': ['DT_1B04005', 'DT_1IN1503'],

  // 주거/부동산 관련
  '집값': ['DT_1YL21101', 'DT_1YL20111E'],
  '주택가격': ['DT_1YL21101', 'DT_1YL20111E'],
  '아파트': ['DT_1YL21101', 'DT_1YL20111E'],
  '아파트가격': ['DT_1YL21101'],
  '전세': ['DT_1YL21101', 'DT_1YL20111E'],
  '매매': ['DT_1YL21101', 'DT_1YL20111E'],
  '부동산': ['DT_1YL21101', 'DT_1YL20111E'],

  // 고용 관련
  '실업률': ['DT_1DA7102S', 'DT_1DA7001'],
  '실업': ['DT_1DA7102S', 'DT_1DA7001'],
  '취업': ['DT_1DA7001', 'DT_1DA7012'],
  '고용률': ['DT_1DA7001', 'DT_1DA7012'],

  // 경제 관련
  'GDP': ['DT_2AS004', 'DT_2AS003'],
  '국내총생산': ['DT_2AS004', 'DT_2AS003'],
  '경제성장': ['DT_2AS004', 'DT_2AS003'],
  '물가': ['DT_1J22001', 'DT_1J20001'],
  '소비자물가': ['DT_1J22001', 'DT_1J20001'],

  // 출산/사망 관련
  '출산율': ['DT_1B81A17', 'DT_1B8000H'],
  '합계출산율': ['DT_1B81A17'],
  '출생': ['DT_1B8000H', 'DT_1B8000F'],
  '사망': ['DT_1B8000H', 'DT_1B8000F'],
};

/**
 * 검색어 동의어 사전
 * - 다양한 표현을 표준 검색어로 통일
 */
const SYNONYMS: Record<string, string[]> = {
  '인구': ['인구수', '총인구', '주민등록인구', '인구현황', '인구통계'],
  '집값': ['주택가격', '아파트값', '부동산가격', '집가격', '아파트가격'],
  '월급': ['임금', '급여', '소득', '평균임금', '월소득'],
  '실업률': ['실업', '실업자', '실업자수'],
  '물가': ['소비자물가', '물가지수', 'CPI'],
};

/**
 * 검색 결과에 우선 테이블이 없을 때 직접 삽입할 폴백 테이블
 * - KOSIS API 검색이 핵심 통계를 반환하지 않을 때 사용
 */
const FALLBACK_TABLES: Record<string, Array<{
  ORG_ID: string;
  ORG_NM: string;
  TBL_ID: string;
  TBL_NM: string;
  STAT_ID: string;
  STAT_NM: string;
  VW_CD: string;
}>> = {
  '인구': [
    { ORG_ID: '101', ORG_NM: '통계청', TBL_ID: 'DT_1B04005', TBL_NM: '시도/성/연령별 주민등록인구', STAT_ID: 'DT_1B04005', STAT_NM: '주민등록인구현황', VW_CD: 'MT_ZTITLE' },
    { ORG_ID: '101', ORG_NM: '통계청', TBL_ID: 'DT_1IN1503', TBL_NM: '주민등록인구현황(시군구)', STAT_ID: 'DT_1IN1503', STAT_NM: '주민등록인구현황', VW_CD: 'MT_ZTITLE' },
  ],
  '집값': [
    { ORG_ID: '116', ORG_NM: '한국부동산원', TBL_ID: 'DT_1YL21101', TBL_NM: '아파트 매매/전세 가격지수', STAT_ID: 'DT_1YL21101', STAT_NM: '부동산통계', VW_CD: 'MT_ZTITLE' },
    { ORG_ID: '116', ORG_NM: '한국부동산원', TBL_ID: 'DT_1YL20111E', TBL_NM: '주택매매가격지수', STAT_ID: 'DT_1YL20111E', STAT_NM: '부동산통계', VW_CD: 'MT_ZTITLE' },
  ],
  '실업률': [
    { ORG_ID: '101', ORG_NM: '통계청', TBL_ID: 'DT_1DA7102S', TBL_NM: '성/연령별 실업률', STAT_ID: 'DT_1DA7102S', STAT_NM: '경제활동인구조사', VW_CD: 'MT_ZTITLE' },
    { ORG_ID: '101', ORG_NM: '통계청', TBL_ID: 'DT_1DA7001', TBL_NM: '경제활동인구총괄', STAT_ID: 'DT_1DA7001', STAT_NM: '경제활동인구조사', VW_CD: 'MT_ZTITLE' },
  ],
  'GDP': [
    { ORG_ID: '301', ORG_NM: '한국은행', TBL_ID: 'DT_200Y001', TBL_NM: '국내총생산(GDP)', STAT_ID: 'DT_200Y001', STAT_NM: '국민계정', VW_CD: 'MT_OTITLE' },
    { ORG_ID: '301', ORG_NM: '한국은행', TBL_ID: 'DT_2AS004', TBL_NM: '경제성장률', STAT_ID: 'DT_2AS004', STAT_NM: '국민계정', VW_CD: 'MT_OTITLE' },
  ],
  '물가': [
    { ORG_ID: '101', ORG_NM: '통계청', TBL_ID: 'DT_1J22001', TBL_NM: '소비자물가 등락률', STAT_ID: 'DT_1J22001', STAT_NM: '소비자물가조사', VW_CD: 'MT_ZTITLE' },
    { ORG_ID: '101', ORG_NM: '통계청', TBL_ID: 'DT_1J20001', TBL_NM: '소비자물가지수', STAT_ID: 'DT_1J20001', STAT_NM: '소비자물가조사', VW_CD: 'MT_ZTITLE' },
  ],
  '출산율': [
    { ORG_ID: '101', ORG_NM: '통계청', TBL_ID: 'DT_1B81A17', TBL_NM: '합계출산율', STAT_ID: 'DT_1B81A17', STAT_NM: '인구동향조사', VW_CD: 'MT_ZTITLE' },
    { ORG_ID: '101', ORG_NM: '통계청', TBL_ID: 'DT_1B8000H', TBL_NM: '인구동태건수(출생/사망)', STAT_ID: 'DT_1B8000H', STAT_NM: '인구동향조사', VW_CD: 'MT_ZTITLE' },
  ],
};

export const searchStatisticsSchema = {
  name: 'search_statistics',
  description:
    '키워드로 KOSIS 통계표를 검색합니다. 예: "인구", "GDP", "실업률", "서울 물가"',
  inputSchema: z.object({
    query: z
      .string()
      .describe('검색어 (예: 인구, 경제성장률, 출생률, 서울 실업률)'),
    orgId: z
      .string()
      .optional()
      .describe('기관코드 (선택, 예: 101=통계청)'),
    sort: z
      .enum(['RANK', 'DATE'])
      .optional()
      .default('RANK')
      .describe('정렬: RANK(정확도순), DATE(최신순)'),
    limit: z
      .number()
      .min(1)
      .max(50)
      .optional()
      .default(10)
      .describe('결과 개수 (기본: 10, 최대: 50)'),
  }),
};

export type SearchStatisticsInput = z.infer<typeof searchStatisticsSchema.inputSchema>;

export async function searchStatistics(
  input: SearchStatisticsInput
): Promise<{
  success: boolean;
  totalCount: number;
  results: SimplifiedStatisticsItem[];
  queryAnalysis?: {
    topics: string[];
    regions: string[];
    intent: string;
  };
  suggestions?: string[];
}> {
  const client = getKosisClient();
  const cache = getCacheManager();

  // 쿼리 분석
  const parsed = parseQuery(input.query);
  const searchTerms = generateSearchTerms(parsed, input.query);

  // 지역명 추출 (결과 필터링용)
  const regionNames = parsed.regions.map(code => REGION_NAMES[code]).filter(Boolean);
  const hasRegion = regionNames.length > 0;

  // 검색어 결정 - 지역이 있으면 조합 검색어 우선, 없으면 원본 쿼리
  const searchWord = searchTerms.length > 0 ? searchTerms[0] : input.query;

  try {
    // 캐시된 검색 결과 조회
    let results = await cache.getSearchResults(
      { query: searchWord, orgId: input.orgId, sort: input.sort },
      async () => {
        return client.searchStatistics(searchWord, {
          orgId: input.orgId,
          sort: input.sort,
          startCount: 1,
          resultCount: input.limit ? input.limit * 2 : 20, // 지역 필터링을 위해 더 많이 조회
        });
      }
    );

    // 검색 결과 후처리 - 우선 테이블 상위 배치
    // 1. 검색어에서 우선 테이블 ID 추출
    const priorityTableIds = getPriorityTableIds(input.query);

    // 2. 검색 결과에 우선 테이블이 없으면 폴백 테이블 삽입
    const existingTableIds = new Set(results.map(r => r.TBL_ID));
    const hasPriorityTable = priorityTableIds.some(id => existingTableIds.has(id));

    if (!hasPriorityTable) {
      // 폴백 테이블 가져오기
      const fallbackTables = getFallbackTables(input.query);
      if (fallbackTables.length > 0) {
        // 폴백 테이블을 맨 앞에 추가 (중복 제거)
        const newTables = fallbackTables.filter(t => !existingTableIds.has(t.TBL_ID));
        results = [...newTables, ...results];
      }
    }

    if (results.length > 0) {
      // 3. 결과 정렬 - 우선 테이블과 지역명 고려
      results = results.sort((a, b) => {
        // 우선 테이블 점수 계산 (낮을수록 우선)
        const aPriority = getPriorityScore(a.TBL_ID, priorityTableIds);
        const bPriority = getPriorityScore(b.TBL_ID, priorityTableIds);

        // 우선 테이블 점수가 다르면 그걸로 정렬
        if (aPriority !== bPriority) {
          return aPriority - bPriority;
        }

        // 지역이 있는 경우 지역명 포함 여부로 2차 정렬
        if (hasRegion) {
          const aHasRegion = regionNames.some(region =>
            (a.TBL_NM || '').includes(region) ||
            (a.STAT_NM || '').includes(region)
          );
          const bHasRegion = regionNames.some(region =>
            (b.TBL_NM || '').includes(region) ||
            (b.STAT_NM || '').includes(region)
          );

          if (aHasRegion && !bHasRegion) return -1;
          if (!aHasRegion && bHasRegion) return 1;
        }

        // 테이블명에 검색 키워드가 직접 포함된 경우 우선
        const queryKeywords = input.query.split(/\s+/).filter(k => k.length > 1);
        const aHasKeyword = queryKeywords.some(k =>
          (a.TBL_NM || '').includes(k)
        );
        const bHasKeyword = queryKeywords.some(k =>
          (b.TBL_NM || '').includes(k)
        );
        if (aHasKeyword && !bHasKeyword) return -1;
        if (!aHasKeyword && bHasKeyword) return 1;

        return 0;
      });
    }

    // 결과 개수 제한 (정렬 후 상위 N개만)
    const limitedResults = results.slice(0, input.limit || 10);

    // 결과 간소화
    // API 응답 필드: ORG_ID, ORG_NM, TBL_ID, TBL_NM, STAT_NM, STRT_PRD_DE, END_PRD_DE, VW_CD 등
    const simplifiedResults: SimplifiedStatisticsItem[] = limitedResults.map((item) => ({
      orgId: item.ORG_ID,
      orgName: item.ORG_NM,
      tableId: item.TBL_ID,
      tableName: item.TBL_NM,
      statisticsName: item.STAT_NM,
      period: item.STRT_PRD_DE && item.END_PRD_DE
        ? `${item.STRT_PRD_DE}~${item.END_PRD_DE}`
        : item.STRT_PRD_DE || item.END_PRD_DE || '',
      periodType: item.VW_CD || '',
      lastUpdated: item.END_PRD_DE,
    }));

    // 후속 질문 제안
    const suggestions: string[] = [];
    if (simplifiedResults.length > 0) {
      const firstResult = simplifiedResults[0];
      suggestions.push(
        `"${firstResult.tableName}"의 최근 데이터 조회`,
        `${firstResult.orgName}의 다른 통계 검색`,
      );

      if (parsed.regions.length === 0) {
        suggestions.push('서울, 부산 등 지역별 데이터 비교');
      }

      if (!parsed.timeRange) {
        suggestions.push('최근 5년 추세 분석');
      }
    }

    return {
      success: true,
      totalCount: simplifiedResults.length,
      results: simplifiedResults,
      queryAnalysis: {
        topics: parsed.topics,
        regions: parsed.regions,
        intent: parsed.intent,
      },
      suggestions,
    };
  } catch (error) {
    console.error('Search error:', error);
    return {
      success: false,
      totalCount: 0,
      results: [],
      queryAnalysis: {
        topics: parsed.topics,
        regions: parsed.regions,
        intent: parsed.intent,
      },
    };
  }
}

/**
 * 검색어에서 우선 배치해야 할 테이블 ID 목록 추출
 */
function getPriorityTableIds(query: string): string[] {
  const tableIds: string[] = [];

  // 1. 직접 매칭되는 키워드 확인
  for (const [keyword, ids] of Object.entries(PRIORITY_TABLES)) {
    if (query.includes(keyword)) {
      tableIds.push(...ids);
    }
  }

  // 2. 동의어 확인
  for (const [standard, synonyms] of Object.entries(SYNONYMS)) {
    if (synonyms.some(syn => query.includes(syn))) {
      // 동의어가 매칭되면 표준 키워드의 우선 테이블 추가
      if (PRIORITY_TABLES[standard]) {
        tableIds.push(...PRIORITY_TABLES[standard]);
      }
    }
  }

  // 중복 제거
  return [...new Set(tableIds)];
}

/**
 * 테이블 ID의 우선순위 점수 계산
 * - 우선 목록에 있으면 순서대로 낮은 점수 (0, 1, 2...)
 * - 없으면 높은 점수 (1000)
 */
function getPriorityScore(tableId: string, priorityTableIds: string[]): number {
  const index = priorityTableIds.indexOf(tableId);
  return index >= 0 ? index : 1000;
}

/**
 * 검색어에 해당하는 폴백 테이블 가져오기
 * - 직접 매칭 및 동의어 매칭 지원
 */
function getFallbackTables(query: string): Array<{
  ORG_ID: string;
  ORG_NM: string;
  TBL_ID: string;
  TBL_NM: string;
  STAT_ID: string;
  STAT_NM: string;
  VW_CD: string;
}> {
  const tables: Array<{
    ORG_ID: string;
    ORG_NM: string;
    TBL_ID: string;
    TBL_NM: string;
    STAT_ID: string;
    STAT_NM: string;
    VW_CD: string;
  }> = [];

  // 1. 직접 매칭
  for (const [keyword, fallbacks] of Object.entries(FALLBACK_TABLES)) {
    if (query.includes(keyword)) {
      tables.push(...fallbacks);
    }
  }

  // 2. 동의어 매칭
  for (const [standard, synonyms] of Object.entries(SYNONYMS)) {
    if (synonyms.some(syn => query.includes(syn))) {
      if (FALLBACK_TABLES[standard]) {
        tables.push(...FALLBACK_TABLES[standard]);
      }
    }
  }

  // 중복 제거
  const seen = new Set<string>();
  return tables.filter(t => {
    if (seen.has(t.TBL_ID)) return false;
    seen.add(t.TBL_ID);
    return true;
  });
}
