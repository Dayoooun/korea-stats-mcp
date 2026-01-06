/**
 * 빠른 추세 분석 도구
 * 자연어 키워드로 시계열 추세를 간편하게 분석
 */

import { z } from 'zod';
import { getKosisClient } from '../api/client.js';
import { getCacheManager } from '../cache/index.js';
import {
  QUICK_STATS_PARAMS,
  getQuickStatsParam,
  getRegionCode,
} from '../data/quickStatsParams.js';
import { analyzeTrend } from '../utils/dataFormatter.js';

export const quickTrendSchema = {
  name: 'quick_trend',
  description: `【추세/변화/증감 질문 → 이 도구 사용】 시계열 추세를 분석합니다.

■ 사용 시점: "~추세", "~변화", "~감소", "~증가", "~추이", "~경향" 등 시간에 따른 변화 질문
■ 반환 형식: 10년간 데이터 + 증감률 + 최고/최저점 + 추세 요약

⚠️ 핵심 키워드만 추출하세요:
• "인구감소 추세" → keyword: "인구"
• "출산율 감소 원인" → keyword: "출산율"
• "실업률 변화" → keyword: "실업률"
• "고령화 추세" → keyword: "고령인구" 또는 "노령화지수"`,
  inputSchema: z.object({
    keyword: z
      .string()
      .describe('통계 키워드만 입력 (추세/감소/증가/변화 등 수식어 제외). 예: "인구", "출산율", "실업률", "GDP", "고령인구"'),
    region: z
      .string()
      .optional()
      .describe('지역명 (선택, 미지정시 전국). 예: "서울", "부산"'),
    yearCount: z
      .number()
      .min(2)
      .max(20)
      .optional()
      .default(10)
      .describe('분석 기간 (년 수, 기본: 10)'),
  }),
};

export type QuickTrendInput = z.infer<typeof quickTrendSchema.inputSchema>;

interface TrendDataPoint {
  year: string;
  value: number;
  formatted: string;
  changeRate?: string;
}

interface QuickTrendResult {
  success: boolean;
  keyword: string;
  region: string;
  trend: 'increasing' | 'decreasing' | 'stable' | 'fluctuating';
  trendDescription: string;
  summary: string;
  dataPoints: TrendDataPoint[];
  insights: string[];
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
  '서울', '부산', '대구', '인천', '광주', '대전', '울산', '세종', '경기',
  '강원', '충북', '충남', '전북', '전남', '경북', '경남', '제주'
];

export async function quickTrend(input: QuickTrendInput): Promise<QuickTrendResult> {
  const client = getKosisClient();
  const cache = getCacheManager();

  try {
    // 1. 키워드에서 파라미터 조회
    const param = getQuickStatsParam(input.keyword);

    if (!param) {
      const supportedKeywords = Object.keys(QUICK_STATS_PARAMS).join(', ');
      return {
        success: false,
        keyword: input.keyword,
        region: '전국',
        trend: 'stable',
        trendDescription: '',
        summary: `"${input.keyword}"에 대한 추세 분석이 지원되지 않습니다.`,
        dataPoints: [],
        insights: [],
        note: `지원 키워드: ${supportedKeywords}`,
      };
    }

    // 2. 지역 결정
    let regionName = '전국';
    let objL1 = param.objL1;

    if (input.region && param.regionCodes) {
      const regionCode = getRegionCode(param, input.region);
      if (regionCode !== param.objL1) {
        objL1 = regionCode;
        regionName = input.region;
      }
    }

    // 3. 시계열 데이터 조회
    const yearCount = input.yearCount || 10;
    const results = await cache.getStatisticsData(
      {
        orgId: param.orgId,
        tableId: param.tableId,
        objL1,
        objL2: param.objL2,
        itemId: param.itemId,
        periodType: 'Y',
        yearCount,
      },
      async () => {
        return client.getStatisticsData({
          orgId: param.orgId,
          tblId: param.tableId,
          objL1,
          objL2: param.objL2,
          itmId: param.itemId,
          prdSe: 'Y',
          newEstPrdCnt: yearCount,
        });
      }
    );

    if (results.length < 2) {
      return {
        success: false,
        keyword: input.keyword,
        region: regionName,
        trend: 'stable',
        trendDescription: '',
        summary: '추세 분석에 필요한 충분한 데이터가 없습니다.',
        dataPoints: [],
        insights: [],
        source: {
          orgId: param.orgId,
          tableId: param.tableId,
          tableName: param.tableName,
        },
      };
    }

    // 4. 데이터 정렬 및 분석
    const sortedData = results
      .map((r) => ({
        year: r.PRD_DE,
        value: parseFloat(r.DT.replace(/,/g, '')) || 0,
        formatted: r.DT,
      }))
      .sort((a, b) => a.year.localeCompare(b.year));

    const values = sortedData.map((d) => d.value);
    const { trend, avgGrowthRate, volatility } = analyzeTrend(values);

    // 5. 변화율 계산
    const dataPoints: TrendDataPoint[] = sortedData.map((d, i) => {
      if (i === 0) {
        return { ...d };
      }
      const prevValue = sortedData[i - 1].value;
      const changeRate = prevValue !== 0
        ? ((d.value - prevValue) / Math.abs(prevValue) * 100).toFixed(1)
        : '0';
      return {
        ...d,
        changeRate: `${parseFloat(changeRate) >= 0 ? '+' : ''}${changeRate}%`,
      };
    });

    // 6. 추세 설명 생성
    const trendDescriptions: Record<string, string> = {
      increasing: '지속적인 상승 추세',
      decreasing: '지속적인 하락 추세',
      stable: '안정적인 흐름',
      fluctuating: '변동이 큰 불안정한 흐름',
    };

    // 7. 최고/최저점 찾기
    const maxIdx = values.indexOf(Math.max(...values));
    const minIdx = values.indexOf(Math.min(...values));
    const firstValue = values[0];
    const lastValue = values[values.length - 1];
    const totalChange = firstValue !== 0
      ? ((lastValue - firstValue) / Math.abs(firstValue) * 100).toFixed(1)
      : '0';

    // 8. 인사이트 생성
    const insights: string[] = [];

    const trendEmoji = trend === 'increasing' ? '📈' : trend === 'decreasing' ? '📉' : '📊';
    insights.push(`${trendEmoji} **추세**: ${trendDescriptions[trend]}`);
    insights.push(`📊 **평균 변화율**: ${avgGrowthRate >= 0 ? '+' : ''}${avgGrowthRate.toFixed(1)}%/년`);
    insights.push(`🔝 **최고점**: ${sortedData[maxIdx].year}년 (${sortedData[maxIdx].formatted}${param.unit})`);
    insights.push(`🔻 **최저점**: ${sortedData[minIdx].year}년 (${sortedData[minIdx].formatted}${param.unit})`);
    insights.push(`📅 **전체 변화**: ${sortedData[0].year}→${sortedData[sortedData.length - 1].year}년, ${parseFloat(totalChange) >= 0 ? '+' : ''}${totalChange}%`);

    if (volatility > 20) {
      insights.push(`⚠️ **주의**: 변동성이 높습니다 (${volatility.toFixed(1)}%)`);
    }

    // 9. 요약 생성
    const summary = `${regionName}의 ${param.description} ${sortedData.length}년 추세: ${trendDescriptions[trend]}입니다. ` +
      `${sortedData[0].year}년 ${sortedData[0].formatted}${param.unit}에서 ` +
      `${sortedData[sortedData.length - 1].year}년 ${sortedData[sortedData.length - 1].formatted}${param.unit}로 ` +
      `${parseFloat(totalChange) >= 0 ? '증가' : '감소'}했습니다 (${parseFloat(totalChange) >= 0 ? '+' : ''}${totalChange}%).\n\n` +
      `📊 출처: ${param.tableName} (KOSIS)`;

    return {
      success: true,
      keyword: input.keyword,
      region: regionName,
      trend,
      trendDescription: trendDescriptions[trend],
      summary,
      dataPoints,
      insights,
      source: {
        orgId: param.orgId,
        tableId: param.tableId,
        tableName: param.tableName,
      },
    };
  } catch (error) {
    console.error('Quick trend error:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      keyword: input.keyword,
      region: input.region || '전국',
      trend: 'stable',
      trendDescription: '',
      summary: `추세 분석 중 오류가 발생했습니다: ${errorMessage}`,
      dataPoints: [],
      insights: [],
      note: `analyze_time_series를 직접 사용해보세요.`,
    };
  }
}
