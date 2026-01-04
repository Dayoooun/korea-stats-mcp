/**
 * 추천 통계 도구
 * 분야별 관련 통계표를 추천
 */

import { z } from 'zod';
import { getKosisClient } from '../api/client.js';
import { getCacheManager } from '../cache/index.js';
import type { SimplifiedStatisticsItem } from '../api/types.js';

/**
 * 토픽별 핵심 통계 테이블 ID
 * - 일반 사용자가 가장 먼저 보고 싶어하는 대표 통계
 * - 검색 결과보다 우선 표시
 */
const PRIORITY_TABLES: Record<string, Array<{ orgId: string; tableId: string; name: string }>> = {
  population: [
    { orgId: '101', tableId: 'DT_1B04005', name: '시도/성/연령별 주민등록인구' },
    { orgId: '101', tableId: 'DT_1IN1503', name: '주민등록인구현황' },
    { orgId: '101', tableId: 'DT_1B8000H', name: '인구동태건수 (출생/사망)' },
    { orgId: '101', tableId: 'DT_1B81A17', name: '합계출산율' },
    { orgId: '101', tableId: 'DT_1BPA002', name: '주요인구지표' },
  ],
  economy: [
    { orgId: '301', tableId: 'DT_200Y001', name: '국내총생산(GDP)' },
    { orgId: '101', tableId: 'DT_1J20001', name: '소비자물가지수' },
    { orgId: '101', tableId: 'DT_1J22001', name: '소비자물가 등락률' },
    { orgId: '301', tableId: 'DT_2AS004', name: '경제성장률' },
  ],
  employment: [
    { orgId: '101', tableId: 'DT_1DA7102S', name: '성/연령별 실업률' },
    { orgId: '101', tableId: 'DT_1DA7001', name: '경제활동인구총괄' },
    { orgId: '101', tableId: 'DT_1DA7012', name: '취업자수' },
    { orgId: '118', tableId: 'DT_118N_PAYM02', name: '평균임금' },
  ],
  housing: [
    { orgId: '116', tableId: 'DT_1YL21101', name: '아파트 매매/전세 가격지수' },
    { orgId: '116', tableId: 'DT_1YL20111E', name: '주택매매가격지수' },
    { orgId: '101', tableId: 'DT_1YL20001', name: '주택수' },
  ],
  education: [
    { orgId: '101', tableId: 'DT_1YL21121', name: '학생수' },
    { orgId: '101', tableId: 'DT_1YL21131', name: '학교수' },
  ],
  health: [
    { orgId: '101', tableId: 'DT_1B41', name: '기대수명' },
    { orgId: '101', tableId: 'DT_1B34E01', name: '사망원인' },
  ],
  environment: [
    { orgId: '106', tableId: 'DT_106N_99_2400001', name: '미세먼지 농도' },
  ],
  transport: [
    { orgId: '101', tableId: 'DT_1YL12001', name: '자동차등록현황' },
  ],
  social: [
    { orgId: '101', tableId: 'DT_1YL13001', name: '범죄발생 현황' },
  ],
};

// 분야별 추천 검색어 및 대표 통계
const TOPIC_RECOMMENDATIONS: Record<string, {
  name: string;
  description: string;
  searchTerms: string[];
}> = {
  population: {
    name: '인구',
    description: '인구수, 출생, 사망, 혼인, 이혼 등',
    searchTerms: ['주민등록인구', '출생', '사망', '혼인', '합계출산율'],
  },
  economy: {
    name: '경제',
    description: 'GDP, 물가, 수출입, 경제성장률 등',
    searchTerms: ['GDP', '경제성장률', '소비자물가', '수출', '무역수지'],
  },
  employment: {
    name: '고용/노동',
    description: '취업자, 실업률, 임금, 근로시간 등',
    searchTerms: ['취업자', '실업률', '고용률', '임금', '근로시간'],
  },
  housing: {
    name: '주거/부동산',
    description: '주택가격, 전월세, 주거환경 등',
    searchTerms: ['아파트가격', '전세', '주택매매', '월세', '주거'],
  },
  education: {
    name: '교육',
    description: '학생수, 학교, 진학률, 사교육비 등',
    searchTerms: ['학생수', '학교', '진학률', '사교육비', '대학'],
  },
  health: {
    name: '보건/의료',
    description: '기대수명, 의료비, 건강보험 등',
    searchTerms: ['기대수명', '의료비', '건강보험', '병원', '사망원인'],
  },
  environment: {
    name: '환경',
    description: '대기질, 미세먼지, 폐기물, 에너지 등',
    searchTerms: ['미세먼지', '대기오염', '폐기물', '재활용', '탄소배출'],
  },
  transport: {
    name: '교통',
    description: '자동차, 대중교통, 도로, 사고 등',
    searchTerms: ['자동차등록', '대중교통', '교통사고', '도로'],
  },
  social: {
    name: '사회/복지',
    description: '사회보장, 범죄, 안전, 문화 등',
    searchTerms: ['사회보장', '범죄', '안전', '문화', '여가'],
  },
};

export const getRecommendedStatsSchema = {
  name: 'get_recommended_statistics',
  description:
    '관심 분야에 맞는 주요 통계표를 추천합니다.',
  inputSchema: z.object({
    topic: z
      .enum([
        'population',
        'economy',
        'employment',
        'housing',
        'education',
        'health',
        'environment',
        'transport',
        'social',
      ])
      .describe(
        '관심 분야: population(인구), economy(경제), employment(고용), housing(주거), education(교육), health(보건), environment(환경), transport(교통), social(사회/복지)'
      ),
    limit: z
      .number()
      .min(1)
      .max(20)
      .optional()
      .default(5)
      .describe('추천 개수 (기본: 5)'),
  }),
};

export type GetRecommendedStatsInput = z.infer<typeof getRecommendedStatsSchema.inputSchema>;

export async function getRecommendedStats(
  input: GetRecommendedStatsInput
): Promise<{
  success: boolean;
  topic: {
    code: string;
    name: string;
    description: string;
  };
  recommendations: SimplifiedStatisticsItem[];
  relatedTopics: string[];
  searchSuggestions: string[];
}> {
  const client = getKosisClient();
  const cache = getCacheManager();

  const topicInfo = TOPIC_RECOMMENDATIONS[input.topic];

  if (!topicInfo) {
    return {
      success: false,
      topic: { code: input.topic, name: '알 수 없음', description: '' },
      recommendations: [],
      relatedTopics: [],
      searchSuggestions: [],
    };
  }

  try {
    const recommendations: SimplifiedStatisticsItem[] = [];

    // 1. 먼저 PRIORITY_TABLES에서 핵심 통계 추가
    const priorityTables = PRIORITY_TABLES[input.topic] || [];
    for (const table of priorityTables) {
      if (recommendations.length >= input.limit) break;

      recommendations.push({
        orgId: table.orgId,
        orgName: table.orgId === '101' ? '통계청' : (table.orgId === '301' ? '한국은행' : table.orgId === '116' ? '한국부동산원' : '기타기관'),
        tableId: table.tableId,
        tableName: table.name,
        statisticsName: topicInfo.name + ' 통계',
        period: '',
        periodType: '',
        lastUpdated: '',
        isPriority: true, // 핵심 통계 표시
      } as SimplifiedStatisticsItem);
    }

    // 2. 핵심 통계로 limit을 못 채웠으면 검색 결과로 보충
    if (recommendations.length < input.limit) {
      const searchResults = await cache.getSearchResults(
        { topic: input.topic, limit: input.limit },
        async () => {
          const allResults = [];
          for (const term of topicInfo.searchTerms.slice(0, 2)) {
            const results = await client.searchStatistics(term, {
              sort: 'RANK',
              startCount: 1,
              resultCount: Math.ceil(input.limit / 2),
            });
            allResults.push(...results);
          }
          return allResults;
        }
      );

      // 중복 제거 (이미 추가된 테이블 제외)
      const addedTableIds = new Set(recommendations.map(r => r.tableId));

      for (const item of searchResults) {
        if (recommendations.length >= input.limit) break;
        if (addedTableIds.has(item.TBL_ID)) continue;

        recommendations.push({
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
        });

        addedTableIds.add(item.TBL_ID);
      }
    }

    // 관련 분야 추천
    const relatedTopics = getRelatedTopics(input.topic);

    return {
      success: true,
      topic: {
        code: input.topic,
        name: topicInfo.name,
        description: topicInfo.description,
      },
      recommendations,
      relatedTopics,
      searchSuggestions: topicInfo.searchTerms,
    };
  } catch (error) {
    console.error('Recommendation error:', error);
    return {
      success: false,
      topic: {
        code: input.topic,
        name: topicInfo.name,
        description: topicInfo.description,
      },
      recommendations: [],
      relatedTopics: [],
      searchSuggestions: topicInfo.searchTerms,
    };
  }
}

function getRelatedTopics(topic: string): string[] {
  const relations: Record<string, string[]> = {
    population: ['economy', 'housing', 'social'],
    economy: ['employment', 'housing', 'transport'],
    employment: ['economy', 'education', 'social'],
    housing: ['economy', 'population', 'transport'],
    education: ['employment', 'social', 'population'],
    health: ['social', 'environment', 'population'],
    environment: ['health', 'transport', 'economy'],
    transport: ['environment', 'housing', 'economy'],
    social: ['health', 'education', 'population'],
  };

  return relations[topic] || [];
}

/**
 * 사용 가능한 분야 목록 반환
 */
export function getAvailableTopics(): Array<{
  code: string;
  name: string;
  description: string;
}> {
  return Object.entries(TOPIC_RECOMMENDATIONS).map(([code, info]) => ({
    code,
    name: info.name,
    description: info.description,
  }));
}
