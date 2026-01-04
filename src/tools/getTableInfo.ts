/**
 * 통계표 정보 조회 도구
 * 통계표의 분류/항목 코드를 조회하여 get_statistics_data 호출에 필요한 파라미터 정보 제공
 */

import { z } from 'zod';
import { getKosisClient } from '../api/client.js';

export const getTableInfoSchema = {
  name: 'get_table_info',
  description:
    '통계표의 분류/항목 코드를 조회합니다. get_statistics_data 호출 전에 이 도구로 유효한 objL1, itmId 값을 확인하세요.',
  inputSchema: z.object({
    orgId: z.string().describe('기관 ID (예: 101)'),
    tableId: z.string().describe('통계표 ID (예: DT_1B04005)'),
    infoType: z
      .enum(['ITM', 'TBL', 'PRD', 'UNIT', 'SOURCE'])
      .optional()
      .default('ITM')
      .describe(
        '조회 유형: ITM(분류/항목, 기본값), TBL(통계표명), PRD(수록정보), UNIT(단위), SOURCE(출처)'
      ),
  }),
};

export type GetTableInfoInput = z.infer<typeof getTableInfoSchema.inputSchema>;

interface ClassificationItem {
  id: string;
  name: string;
  parentId?: string;
  level: number;
}

interface ItemInfo {
  id: string;
  name: string;
  unit?: string;
}

interface TableInfoResult {
  success: boolean;
  orgId: string;
  tableId: string;
  tableName?: string;
  classifications?: {
    objL1?: ClassificationItem[];
    objL2?: ClassificationItem[];
    objL3?: ClassificationItem[];
    objL4?: ClassificationItem[];
    objL5?: ClassificationItem[];
    objL6?: ClassificationItem[];
    objL7?: ClassificationItem[];
    objL8?: ClassificationItem[];
  };
  items?: ItemInfo[];
  periodInfo?: {
    periodType?: string;
    startPeriod?: string;
    endPeriod?: string;
  };
  unit?: string;
  source?: string;
  rawData?: Record<string, string>[];
  usageHint?: string;
}

export async function getTableInfo(
  input: GetTableInfoInput
): Promise<TableInfoResult> {
  const client = getKosisClient();

  try {
    const metaType = input.infoType as 'ITM' | 'TBL' | 'ORG' | 'PRD' | 'UNIT' | 'SOURCE';
    const results = await client.getTableMeta(input.orgId, input.tableId, metaType);

    if (results.length === 0) {
      return {
        success: false,
        orgId: input.orgId,
        tableId: input.tableId,
        usageHint: '메타데이터를 찾을 수 없습니다. orgId와 tableId를 확인해주세요.',
      };
    }

    const result: TableInfoResult = {
      success: true,
      orgId: input.orgId,
      tableId: input.tableId,
    };

    if (input.infoType === 'ITM') {
      // 분류/항목 정보 파싱
      const classifications: TableInfoResult['classifications'] = {};
      const items: ItemInfo[] = [];

      for (const item of results) {
        // 분류 정보 추출 (OBJ_ID, OBJ_NM 등)
        if (item.OBJ_ID && item.OBJ_NM) {
          const level = parseInt(item.OBJ_ID?.replace(/[^0-9]/g, '') || '1', 10);
          const key = `objL${level}` as keyof typeof classifications;

          if (!classifications[key]) {
            classifications[key] = [];
          }

          // 중복 방지
          const existing = classifications[key]!.find(c => c.id === item.OBJ_ID);
          if (!existing) {
            classifications[key]!.push({
              id: item.OBJ_ID,
              name: item.OBJ_NM,
              level,
            });
          }
        }

        // 항목 정보 추출 (ITM_ID, ITM_NM 등)
        if (item.ITM_ID && item.ITM_NM) {
          const existing = items.find(i => i.id === item.ITM_ID);
          if (!existing) {
            items.push({
              id: item.ITM_ID,
              name: item.ITM_NM,
              unit: item.UNIT_NM,
            });
          }
        }
      }

      result.classifications = classifications;
      result.items = items;
      result.rawData = results;

      // 코드 패턴으로 분류 코드와 항목 코드 구분
      // 지역 코드 패턴: 2자리 숫자 (00=전국, 11=서울, 26=부산, 27=대구, ...)
      const regionPattern = /^\d{2}$/;
      // 항목 코드 패턴: T로 시작하는 코드 (T1, T10, T12, ...)
      const itemPattern = /^T\d*/;
      // 연도/기간 패턴: 4자리 이상 숫자 (2020, 202001, ...)
      const periodPattern = /^\d{4,}$/;

      // OBJ_ID에서 분류 레벨별로 분류값 추출
      const classificationValues: Record<string, { id: string; name: string }[]> = {};

      for (const item of results) {
        // OBJ_ID가 있고, ITM_ID/ITM_NM도 있는 경우 분류값으로 처리
        if (item.OBJ_ID && item.ITM_ID) {
          const objId = item.OBJ_ID;
          const itmId = item.ITM_ID;
          const itmNm = item.ITM_NM || itmId;

          // OBJ_ID별로 그룹화 (예: "A"=지역분류, "ITEM"=항목분류)
          if (!classificationValues[objId]) {
            classificationValues[objId] = [];
          }

          // 중복 방지
          const existing = classificationValues[objId].find(v => v.id === itmId);
          if (!existing) {
            classificationValues[objId].push({ id: itmId, name: itmNm });
          }
        }
      }

      // 분류 타입별로 코드 분리
      const regionCodes: { id: string; name: string }[] = [];
      const itemCodes: { id: string; name: string }[] = [];
      const otherCodes: { objId: string; values: { id: string; name: string }[] }[] = [];

      for (const [objId, values] of Object.entries(classificationValues)) {
        // 첫 번째 값으로 코드 유형 판단
        const firstValue = values[0]?.id || '';

        if (regionPattern.test(firstValue)) {
          // 지역 코드 (00, 11, 26 등)
          regionCodes.push(...values);
        } else if (itemPattern.test(firstValue)) {
          // 항목 코드 (T1, T10 등)
          itemCodes.push(...values);
        } else if (!periodPattern.test(firstValue)) {
          // 기타 분류 (기간이 아닌 경우)
          otherCodes.push({ objId, values });
        }
      }

      // items 배열에서도 추가로 코드 분류
      for (const item of items) {
        if (regionPattern.test(item.id)) {
          const existing = regionCodes.find(r => r.id === item.id);
          if (!existing) {
            regionCodes.push({ id: item.id, name: item.name });
          }
        } else if (itemPattern.test(item.id) || item.id.startsWith('T')) {
          const existing = itemCodes.find(i => i.id === item.id);
          if (!existing) {
            itemCodes.push({ id: item.id, name: item.name });
          }
        }
      }

      // 분류 코드 예시 생성
      const regionExamples = regionCodes.slice(0, 8).map(r =>
        `"${r.id}" (${r.name})`
      ).join('\n    - ');

      const itemExamples = itemCodes.slice(0, 8).map(i =>
        `"${i.id}" (${i.name})`
      ).join('\n    - ');

      const otherExamples = otherCodes.map(o =>
        `### ${o.objId} 분류:\n    - ${o.values.slice(0, 5).map(v => `"${v.id}" (${v.name})`).join('\n    - ')}`
      ).join('\n\n');

      // 기본값 결정
      const defaultObjL1 = regionCodes[0]?.id || items[0]?.id || '00';
      const defaultItemId = itemCodes[0]?.id || items[0]?.id || 'T1';

      // 향상된 사용 힌트 생성
      result.usageHint = `
## get_statistics_data 사용법

### 파라미터 설명
- objL1: 분류1의 실제 값 코드 (지역 코드 또는 분류 코드)
- itemId: 항목 코드 (통계 지표 코드)

### 사용 가능한 분류1(objL1) 코드 ${regionCodes.length > 0 ? '(지역)' : ''}
${regionCodes.length > 0 ? `    - ${regionExamples}` : '(지역 분류 없음)'}
${otherExamples ? `\n${otherExamples}` : ''}

### 사용 가능한 항목(itemId) 코드
${itemCodes.length > 0 ? `    - ${itemExamples}` : (items.length > 0 ? `    - ${items.slice(0, 5).map(i => `"${i.id}" (${i.name})`).join('\n    - ')}` : '(항목 정보 없음)')}

### 예시 호출
\`\`\`json
{
  "orgId": "${input.orgId}",
  "tableId": "${input.tableId}",
  "objL1": "${defaultObjL1}",
  "itemId": "${defaultItemId}",
  "periodType": "Y",
  "recentCount": 5
}
\`\`\`

⚠️ **주의사항**
- OBJ_ID(예: "ITEM", "A", "B")가 아닌 **실제 분류값 코드**(예: "00", "11", "T10")를 사용하세요
- 위에 나열된 **이 통계표의 실제 코드**를 사용하세요 (통계표마다 코드 체계가 다릅니다)
`;

    } else if (input.infoType === 'TBL') {
      result.tableName = results[0]?.TBL_NM;
      result.rawData = results;

    } else if (input.infoType === 'PRD') {
      result.periodInfo = {
        periodType: results[0]?.PRD_SE,
        startPeriod: results[0]?.STRT_PRD_DE,
        endPeriod: results[0]?.END_PRD_DE,
      };
      result.rawData = results;

    } else if (input.infoType === 'UNIT') {
      result.unit = results[0]?.UNIT_NM;
      result.rawData = results;

    } else if (input.infoType === 'SOURCE') {
      result.source = results[0]?.JOSA_NM;
      result.rawData = results;
    }

    return result;
  } catch (error) {
    console.error('Table info error:', error);
    return {
      success: false,
      orgId: input.orgId,
      tableId: input.tableId,
      usageHint: `오류가 발생했습니다: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
