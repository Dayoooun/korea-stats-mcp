/**
 * 통계 데이터 조회 도구
 * 특정 통계표의 실제 데이터를 조회
 */

import { z } from 'zod';
import { getKosisClient } from '../api/client.js';
import { getCacheManager } from '../cache/index.js';
import { simplifyStatisticsData, recommendVisualization } from '../utils/dataFormatter.js';
import type { SimplifiedDataItem } from '../api/types.js';

export const getStatisticsDataSchema = {
  name: 'get_statistics_data',
  description:
    '특정 통계표의 실제 데이터를 조회합니다. 중요: 먼저 get_table_info로 유효한 objL1, itemId 값을 확인한 후 호출하세요.',
  inputSchema: z.object({
    orgId: z.string().describe('기관 ID (예: 101)'),
    tableId: z.string().describe('통계표 ID (예: DT_1B04005)'),
    objL1: z
      .string()
      .describe('분류1 코드 (필수) - get_table_info로 유효한 값 조회 필요'),
    objL2: z.string().optional().describe('분류2 코드 (선택)'),
    objL3: z.string().optional().describe('분류3 코드 (선택)'),
    objL4: z.string().optional().describe('분류4 코드 (선택)'),
    itemId: z
      .string()
      .describe('항목 ID (필수) - get_table_info로 유효한 값 조회 필요'),
    periodType: z
      .enum(['Y', 'M', 'Q', 'S', 'D', 'F', 'IR'])
      .describe(
        '주기: Y(년), M(월), Q(분기), S(반기), D(일), F(다년), IR(부정기)'
      ),
    startPeriod: z
      .string()
      .optional()
      .describe('시작 시점 (예: 2020, 202001)'),
    endPeriod: z
      .string()
      .optional()
      .describe('종료 시점 (예: 2024, 202412)'),
    recentCount: z
      .number()
      .min(1)
      .max(100)
      .optional()
      .describe('최근 N개 시점 (startPeriod/endPeriod 대신 사용)'),
  }),
};

export type GetStatisticsDataInput = z.infer<typeof getStatisticsDataSchema.inputSchema>;

export async function getStatisticsData(
  input: GetStatisticsDataInput
): Promise<{
  success: boolean;
  tableName?: string;
  unit?: string;
  data: SimplifiedDataItem[];
  totalCount: number;
  visualization?: {
    recommendedType: string;
    reason: string;
  };
  metadata?: {
    orgId: string;
    tableId: string;
    periodType: string;
    periodRange?: string;
  };
  usageHint?: string;
}> {
  const client = getKosisClient();
  const cache = getCacheManager();

  try {
    // 캐시된 데이터 조회
    const results = await cache.getStatisticsData(
      {
        orgId: input.orgId,
        tableId: input.tableId,
        objL1: input.objL1,
        objL2: input.objL2,
        itemId: input.itemId,
        periodType: input.periodType,
        startPeriod: input.startPeriod,
        endPeriod: input.endPeriod,
        recentCount: input.recentCount,
      },
      async () => {
        return client.getStatisticsData({
          orgId: input.orgId,
          tblId: input.tableId,
          objL1: input.objL1,
          objL2: input.objL2,
          objL3: input.objL3,
          objL4: input.objL4,
          itmId: input.itemId,
          prdSe: input.periodType,
          startPrdDe: input.startPeriod,
          endPrdDe: input.endPeriod,
          newEstPrdCnt: input.recentCount,
        });
      }
    );

    if (results.length === 0) {
      return {
        success: true,
        data: [],
        totalCount: 0,
        metadata: {
          orgId: input.orgId,
          tableId: input.tableId,
          periodType: input.periodType,
        },
        usageHint: `
## 데이터를 찾을 수 없습니다

### 사용된 파라미터
- orgId: "${input.orgId}"
- tableId: "${input.tableId}"
- objL1: "${input.objL1}"
- itemId: "${input.itemId}"
- periodType: "${input.periodType}"

### 해결 방법
1. **get_table_info 호출**하여 유효한 코드를 확인하세요:
   \`\`\`json
   { "orgId": "${input.orgId}", "tableId": "${input.tableId}" }
   \`\`\`

2. **파라미터 확인**:
   - objL1: 분류값 코드 (예: "00"=전국, "11"=서울)
   - itemId: 항목 코드 (예: "T10", "T1")
   - ⚠️ OBJ_ID(예: "ITEM", "B")가 아닌 실제 분류값 코드를 사용하세요

### 예시 호출
{
  "orgId": "${input.orgId}",
  "tableId": "${input.tableId}",
  "objL1": "00",
  "itemId": "T1",
  "periodType": "${input.periodType}",
  "recentCount": 5
}
`,
      };
    }

    // 데이터 간소화
    const simplifiedData = simplifyStatisticsData(results);

    // 메타데이터 추출
    const firstItem = results[0];
    const periods = results.map((r) => r.PRD_DE);
    const periodRange =
      periods.length > 1
        ? `${periods[periods.length - 1]} ~ ${periods[0]}`
        : periods[0];

    // 시각화 추천
    const hasMultipleCategories =
      new Set(simplifiedData.map((d) => d.classification)).size > 1;
    const visualization = recommendVisualization(
      simplifiedData.length,
      hasMultipleCategories,
      ['Y', 'M', 'Q'].includes(input.periodType)
    );

    return {
      success: true,
      tableName: firstItem.TBL_NM,
      unit: firstItem.UNIT_NM,
      data: simplifiedData,
      totalCount: simplifiedData.length,
      visualization: {
        recommendedType: visualization.type,
        reason: visualization.reason,
      },
      metadata: {
        orgId: input.orgId,
        tableId: input.tableId,
        periodType: input.periodType,
        periodRange,
      },
    };
  } catch (error) {
    console.error('Data error:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      data: [],
      totalCount: 0,
      metadata: {
        orgId: input.orgId,
        tableId: input.tableId,
        periodType: input.periodType,
      },
      usageHint: `
## 데이터 조회 중 오류 발생

### 오류 내용
${errorMessage}

### 확인 사항
1. orgId, tableId가 올바른지 확인하세요
2. get_table_info로 유효한 objL1, itemId 코드를 확인하세요
3. periodType이 해당 통계표에서 지원되는지 확인하세요

### get_table_info 호출 예시
{
  "orgId": "${input.orgId}",
  "tableId": "${input.tableId}"
}
`,
    };
  }
}
