/**
 * 통계 비교 도구
 * 여러 지역 또는 시점의 통계를 비교
 */

import { z } from 'zod';
import { getKosisClient } from '../api/client.js';
import { getCacheManager } from '../cache/index.js';
import { calculateChangeRate } from '../utils/dataFormatter.js';

export const compareStatisticsSchema = {
  name: 'compare_statistics',
  description:
    '여러 지역, 시점, 또는 항목의 통계 데이터를 비교합니다.',
  inputSchema: z.object({
    orgId: z.string().describe('기관 ID'),
    tableId: z.string().describe('통계표 ID'),
    compareType: z
      .enum(['period', 'item'])
      .describe('비교 유형: period(시점 비교), item(항목 비교)'),
    periodType: z.enum(['Y', 'M', 'Q']).describe('주기: Y(년), M(월), Q(분기)'),
    periods: z
      .array(z.string())
      .optional()
      .describe('비교할 시점들 (예: ["2022", "2023", "2024"])'),
    objL1: z.string().optional().describe('분류1 코드'),
    objL2: z.string().optional().describe('분류2 코드 (일부 테이블에서 필요)'),
    itemId: z.string().optional().describe('항목 ID'),
  }),
};

export type CompareStatisticsInput = z.infer<typeof compareStatisticsSchema.inputSchema>;

interface ComparisonItem {
  name: string;
  region?: string;        // 지역명 (C1_NM)
  itemName?: string;      // 항목명 (ITM_NM)
  period?: string;        // 시점 (PRD_DE)
  value: number;
  formattedValue: string;
  unit?: string;          // 단위 (UNIT_NM)
  rank?: number;
  change?: {
    rate: number;
    direction: 'up' | 'down' | 'stable';
    formatted: string;
  };
}

export async function compareStatistics(
  input: CompareStatisticsInput
): Promise<{
  success: boolean;
  compareType: string;
  items: ComparisonItem[];
  summary: string;
  insights: string[];
}> {
  const client = getKosisClient();
  const cache = getCacheManager();

  try {
    // 데이터 조회
    const results = await cache.getStatisticsData(
      {
        orgId: input.orgId,
        tableId: input.tableId,
        compareType: input.compareType,
        periods: input.periods,
      },
      async () => {
        if (input.compareType === 'period' && input.periods) {
          // 여러 시점 데이터 조회
          const allResults = [];
          for (const period of input.periods) {
            const data = await client.getStatisticsData({
              orgId: input.orgId,
              tblId: input.tableId,
              objL1: input.objL1 || 'ALL',
              objL2: input.objL2,
              itmId: input.itemId || 'ALL',
              prdSe: input.periodType,
              startPrdDe: period,
              endPrdDe: period,
            });
            allResults.push(...data);
          }
          return allResults;
        } else {
          // 단일 시점, 여러 항목 조회
          return client.getStatisticsData({
            orgId: input.orgId,
            tblId: input.tableId,
            objL1: input.objL1 || 'ALL',
            objL2: input.objL2,
            itmId: 'ALL',
            prdSe: input.periodType,
            newEstPrdCnt: 1,
          });
        }
      }
    );

    if (results.length === 0) {
      return {
        success: true,
        compareType: input.compareType,
        items: [],
        summary: '비교할 데이터가 없습니다.',
        insights: [],
      };
    }

    // 비교 항목 생성 (모든 관련 정보 포함)
    const items: ComparisonItem[] = results.map((r) => {
      const value = parseFloat(r.DT.replace(/,/g, '')) || 0;
      const region = r.C1_NM || undefined;
      const itemName = r.ITM_NM || undefined;
      const period = r.PRD_DE || undefined;
      const unit = r.UNIT_NM || undefined;

      // name은 비교 타입에 따라 주요 식별자로 설정
      // 하지만 모든 정보를 별도 필드로 제공
      let name: string;
      if (input.compareType === 'period') {
        name = period || 'N/A';
      } else {
        // item 비교 시: 지역명과 항목명 조합
        name = [region, itemName].filter(Boolean).join(' - ') || 'N/A';
      }

      return {
        name,
        region,
        itemName,
        period,
        value,
        formattedValue: r.DT,
        unit,
      };
    });

    // 순위 부여
    const sortedItems = [...items].sort((a, b) => b.value - a.value);
    sortedItems.forEach((item, index) => {
      const original = items.find((i) => i.name === item.name);
      if (original) {
        original.rank = index + 1;
      }
    });

    // 변화율 계산 (시점 비교인 경우)
    if (input.compareType === 'period' && items.length > 1) {
      for (let i = 1; i < items.length; i++) {
        items[i].change = calculateChangeRate(items[i].value, items[i - 1].value);
      }
    }

    // 요약 생성
    const maxItem = sortedItems[0];
    const minItem = sortedItems[sortedItems.length - 1];
    const summary =
      input.compareType === 'period'
        ? `${items[0].name}부터 ${items[items.length - 1].name}까지의 변화를 비교했습니다.`
        : `총 ${items.length}개 항목 중 "${maxItem.name}"이(가) 가장 높고, "${minItem.name}"이(가) 가장 낮습니다.`;

    // 인사이트 생성
    const insights: string[] = [];

    if (input.compareType === 'period') {
      const firstValue = items[0].value;
      const lastValue = items[items.length - 1].value;
      const totalChange = calculateChangeRate(lastValue, firstValue);
      insights.push(
        `전체 기간 동안 ${totalChange.direction === 'up' ? '증가' : totalChange.direction === 'down' ? '감소' : '변동 없음'} (${totalChange.formatted})`
      );

      const maxChange = items
        .filter((i) => i.change)
        .sort((a, b) => Math.abs(b.change!.rate) - Math.abs(a.change!.rate))[0];
      if (maxChange?.change) {
        insights.push(
          `가장 큰 변화: ${maxChange.name} (${maxChange.change.formatted})`
        );
      }
    } else {
      const diff = ((maxItem.value - minItem.value) / minItem.value * 100).toFixed(1);
      insights.push(`최대-최소 차이: ${diff}%`);
    }

    return {
      success: true,
      compareType: input.compareType,
      items,
      summary,
      insights,
    };
  } catch (error) {
    console.error('Compare error:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);

    return {
      success: false,
      compareType: input.compareType,
      items: [],
      summary: '비교 중 오류가 발생했습니다.',
      insights: [
        '## 오류 상세 정보',
        '',
        `### 오류 내용: ${errorMessage}`,
        '',
        '### 사용된 파라미터',
        `- orgId: "${input.orgId}"`,
        `- tableId: "${input.tableId}"`,
        `- compareType: "${input.compareType}"`,
        `- objL1: "${input.objL1 || '미지정'}"`,
        `- itemId: "${input.itemId || '미지정'}"`,
        input.periods ? `- periods: ${JSON.stringify(input.periods)}` : '',
        '',
        '### 해결 방법',
        '1. **get_table_info 먼저 호출**하여 유효한 코드 확인:',
        '   ```json',
        `   { "orgId": "${input.orgId}", "tableId": "${input.tableId}" }`,
        '   ```',
        '',
        '2. **다중 지역 비교 시 형식**:',
        '   - 개별 호출 후 결과 비교 (권장)',
        '   - 예: 서울과 부산을 각각 조회하여 비교',
        '',
        '3. **시점 비교 시 형식**:',
        '   - compareType: "period"',
        '   - periods: ["2020", "2021", "2022", "2023"]',
      ].filter(Boolean),
    };
  }
}
