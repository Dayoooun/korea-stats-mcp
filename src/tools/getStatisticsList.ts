/**
 * 통계 목록 조회 도구
 * 주제별/기관별로 통계 목록을 탐색
 */

import { z } from 'zod';
import { getKosisClient } from '../api/client.js';
import { getCacheManager } from '../cache/index.js';
import { config } from '../config/index.js';
import type { ListItem } from '../api/types.js';

export const getStatisticsListSchema = {
  name: 'get_statistics_list',
  description:
    '주제별/기관별로 통계 목록을 탐색합니다. 트리 구조로 하위 목록을 탐색할 수 있습니다.',
  inputSchema: z.object({
    viewCode: z
      .string()
      .transform((val) => {
        // 빈 문자열이면 기본값 MT_ZTITLE 사용
        if (!val || val.trim() === '') return 'MT_ZTITLE';
        return val;
      })
      .pipe(
        z.enum([
          'MT_ZTITLE',
          'MT_OTITLE',
          'MT_GTITLE01',
          'MT_GTITLE02',
          'MT_RTITLE',
          'MT_BUKHAN',
          'MT_TM1_TITLE',
          'MT_TM2_TITLE',
        ])
      )
      .describe(
        '서비스뷰 코드: MT_ZTITLE(주제별, 기본값), MT_OTITLE(기관별), MT_GTITLE01(e-지방지표 주제별), MT_GTITLE02(e-지방지표 지역별), MT_RTITLE(국제통계), MT_BUKHAN(북한통계)'
      ),
    parentId: z
      .string()
      .optional()
      .default('')
      .describe('상위 목록 ID (비어있으면 최상위 목록 조회)'),
  }),
};

export type GetStatisticsListInput = z.infer<typeof getStatisticsListSchema.inputSchema>;

export async function getStatisticsList(
  input: GetStatisticsListInput
): Promise<{
  success: boolean;
  viewName: string;
  parentId: string;
  items: ListItem[];
  hasMore: boolean;
  navigation?: {
    canGoUp: boolean;
    instruction: string;
  };
}> {
  const client = getKosisClient();
  const cache = getCacheManager();

  const viewName = config.viewCodes[input.viewCode as keyof typeof config.viewCodes] || input.viewCode;

  try {
    // 캐시된 목록 조회
    const results = await cache.getStatisticsList(
      { viewCode: input.viewCode, parentId: input.parentId },
      async () => {
        return client.getStatisticsList(input.viewCode, input.parentId);
      }
    );

    // 결과 간소화
    const items: ListItem[] = results.map((item) => {
      const isTable = !!item.TBL_ID;
      return {
        id: isTable ? item.TBL_ID! : item.LIST_ID!,
        name: isTable ? item.TBL_NM! : item.LIST_NM!,
        isTable,
        orgId: item.ORG_ID,
        tableId: item.TBL_ID,
        tableName: item.TBL_NM,
      };
    });

    const hasMore = items.some((item) => !item.isTable);
    const canGoUp = input.parentId !== '';

    return {
      success: true,
      viewName,
      parentId: input.parentId,
      items,
      hasMore,
      navigation: {
        canGoUp,
        instruction: hasMore
          ? '폴더 ID를 parentId로 전달하면 하위 목록을 조회할 수 있습니다.'
          : '통계표 ID와 기관 ID를 사용하여 get_statistics_data로 데이터를 조회하세요.',
      },
    };
  } catch (error) {
    console.error('List error:', error);
    return {
      success: false,
      viewName,
      parentId: input.parentId,
      items: [],
      hasMore: false,
    };
  }
}

/**
 * 사용 가능한 서비스뷰 목록 반환
 */
export function getAvailableViewCodes(): Array<{
  code: string;
  name: string;
  description: string;
}> {
  return [
    { code: 'MT_ZTITLE', name: '국내통계 주제별', description: '주제(인구, 경제 등)로 분류된 국내 통계' },
    { code: 'MT_OTITLE', name: '국내통계 기관별', description: '작성기관별로 분류된 국내 통계' },
    { code: 'MT_GTITLE01', name: 'e-지방지표(주제별)', description: '지방자치단체 통계 (주제별)' },
    { code: 'MT_GTITLE02', name: 'e-지방지표(지역별)', description: '지방자치단체 통계 (지역별)' },
    { code: 'MT_RTITLE', name: '국제통계', description: 'OECD, UN 등 국제기구 통계' },
    { code: 'MT_BUKHAN', name: '북한통계', description: '북한 관련 통계' },
    { code: 'MT_TM1_TITLE', name: '대상별통계', description: '여성, 청소년, 고령자 등 대상별 통계' },
    { code: 'MT_TM2_TITLE', name: '이슈별통계', description: '사회적 이슈별 통계' },
  ];
}
