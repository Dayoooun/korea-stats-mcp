/**
 * 주요 경제사회 지표 리소스
 */

export interface KeyIndicator {
  name: string;
  category: string;
  orgId: string;
  tableId: string;
  periodType: string;
  description: string;
}

/**
 * 자주 조회되는 주요 지표 목록
 */
export function getKeyIndicators(): KeyIndicator[] {
  return [
    // 인구 지표
    {
      name: '총인구',
      category: 'population',
      orgId: '101',
      tableId: 'DT_1B04005',
      periodType: 'Y',
      description: '대한민국 총 인구수',
    },
    {
      name: '합계출산율',
      category: 'population',
      orgId: '101',
      tableId: 'DT_1B8000F',
      periodType: 'Y',
      description: '가임기 여성 1명당 출생아 수',
    },
    {
      name: '기대수명',
      category: 'population',
      orgId: '101',
      tableId: 'DT_1B42',
      periodType: 'Y',
      description: '출생 시 기대여명',
    },

    // 경제 지표
    {
      name: 'GDP(국내총생산)',
      category: 'economy',
      orgId: '301',
      tableId: 'DT_200Y001',
      periodType: 'Y',
      description: '국내총생산 규모',
    },
    {
      name: '경제성장률',
      category: 'economy',
      orgId: '301',
      tableId: 'DT_200Y002',
      periodType: 'Y',
      description: '전년 대비 GDP 성장률',
    },
    {
      name: '소비자물가지수',
      category: 'economy',
      orgId: '101',
      tableId: 'DT_1J20011',
      periodType: 'M',
      description: '소비자물가 변동 지수',
    },

    // 고용 지표
    {
      name: '실업률',
      category: 'employment',
      orgId: '101',
      tableId: 'DT_1DA7012S',
      periodType: 'M',
      description: '경제활동인구 중 실업자 비율',
    },
    {
      name: '고용률',
      category: 'employment',
      orgId: '101',
      tableId: 'DT_1DA7012S',
      periodType: 'M',
      description: '15세 이상 인구 중 취업자 비율',
    },

    // 주거 지표
    {
      name: '주택가격지수',
      category: 'housing',
      orgId: '408',
      tableId: 'DT_408N_N0001',
      periodType: 'M',
      description: '전국 주택가격 변동 지수',
    },

    // 교육 지표
    {
      name: '대학진학률',
      category: 'education',
      orgId: '334',
      tableId: 'DT_334N_A005',
      periodType: 'Y',
      description: '고등학교 졸업자의 대학 진학률',
    },
  ];
}

/**
 * 리소스용 JSON 데이터 생성
 */
export function getKeyIndicatorsJson(): string {
  return JSON.stringify(
    {
      name: '주요 경제사회 지표',
      description: '자주 조회되는 핵심 통계 지표 목록',
      lastUpdated: new Date().toISOString().split('T')[0],
      indicators: getKeyIndicators(),
      usage:
        'get_statistics_data 도구에 orgId, tableId, periodType을 전달하여 데이터를 조회하세요.',
    },
    null,
    2
  );
}
