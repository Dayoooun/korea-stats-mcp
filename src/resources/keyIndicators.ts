/**
 * 주요 경제사회 지표 리소스
 *
 * 이 리소스는 현재 관측값이 아니라 정적 참고 목록이다. 표 식별자와 주기 힌트는
 * 공식 KOSIS 메타데이터에서 다시 확인해야 하며, 단위·지역 범위·최신성·전체
 * 자료 취득 여부를 이 목록에서 추론하지 않는다.
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
 * 정적 참고용 주요 지표 식별자 목록.
 */
export function getKeyIndicators(): KeyIndicator[] {
  return [
    // 인구 지표
    {
      name: "총인구",
      category: "population",
      orgId: "101",
      tableId: "DT_1B04005",
      periodType: "Y",
      description: "주민등록인구 관련 총인구 지표(정적 참고 설명)",
    },
    {
      name: "합계출산율",
      category: "population",
      orgId: "101",
      tableId: "DT_1B8000F",
      periodType: "Y",
      description: "가임기 여성 1명당 출생아 수 지표(정적 참고 설명)",
    },
    {
      name: "기대수명",
      category: "population",
      orgId: "101",
      tableId: "DT_1B42",
      periodType: "Y",
      description: "출생 시 기대여명 지표(정적 참고 설명)",
    },

    // 경제 지표
    {
      name: "GDP(국내총생산)",
      category: "economy",
      orgId: "301",
      tableId: "DT_200Y001",
      periodType: "Y",
      description: "국내총생산 규모 지표(정적 참고 설명)",
    },
    {
      name: "경제성장률",
      category: "economy",
      orgId: "301",
      tableId: "DT_200Y002",
      periodType: "Y",
      description: "전년 대비 GDP 성장률 지표(정적 참고 설명)",
    },
    {
      name: "소비자물가지수",
      category: "economy",
      orgId: "101",
      tableId: "DT_1J20011",
      periodType: "M",
      description: "소비자물가 변동 지표(정적 참고 설명)",
    },

    // 고용 지표
    {
      name: "실업률",
      category: "employment",
      orgId: "101",
      tableId: "DT_1DA7012S",
      periodType: "M",
      description: "경제활동인구 중 실업자 비율 지표(정적 참고 설명)",
    },
    {
      name: "고용률",
      category: "employment",
      orgId: "101",
      tableId: "DT_1DA7012S",
      periodType: "M",
      description: "15세 이상 인구 중 취업자 비율 지표(정적 참고 설명)",
    },

    // 주거 지표
    {
      name: "주택가격지수",
      category: "housing",
      orgId: "408",
      tableId: "DT_408N_N0001",
      periodType: "M",
      description: "주택가격 변동 지표(지역 범위는 공식 메타데이터 확인)",
    },

    // 교육 지표
    {
      name: "대학진학률",
      category: "education",
      orgId: "334",
      tableId: "DT_334N_A005",
      periodType: "Y",
      description: "고등학교 졸업자의 대학 진학률 지표(정적 참고 설명)",
    },
  ];
}

/**
 * 리소스용 JSON 데이터 생성.
 */
export function getKeyIndicatorsJson(): string {
  return JSON.stringify(
    {
      name: "주요 경제사회 지표",
      description: "정적 참고용 주요 통계표 식별자 목록",
      metadataStatus: "static_reference",
      lastUpdated: new Date().toISOString().split("T")[0],
      lastUpdatedSemantics:
        "목록을 생성한 날짜이며, 통계값의 최신 시점이 아닙니다.",
      limitations: [
        "이 목록은 현재 수치, 단위, 지역 범위, 최신성 또는 전체 자료 취득을 보장하지 않습니다.",
        "periodType은 정적 주기 힌트일 뿐이며 실제 응답의 PRD_SE와 일치하는지 확인해야 합니다.",
        "지역 코드는 표마다 다르므로 목록에 지역 코드를 미리 채우지 않습니다.",
      ],
      indicators: getKeyIndicators(),
      usage:
        "정적 목록에서 orgId/tableId를 선택한 뒤 get_table_info({ orgId, tableId })로 실제 objL1·itemId·기간 메타데이터를 확인하고, 확인된 값을 get_statistics_data({ orgId, tableId, objL1, itemId, periodType, startPeriod 또는 endPeriod 또는 recentCount })에 전달하세요. 응답의 단위·기간·validationLevel·completeness·출처만 근거로 설명하세요.",
    },
    null,
    2,
  );
}
