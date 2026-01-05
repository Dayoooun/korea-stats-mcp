/**
 * Quick Stats 정적 파라미터 매핑
 * - curl로 다운받은 메타데이터를 분석하여 생성
 * - 동적 조회 대신 미리 검증된 파라미터 사용
 */

export interface QuickStatsParam {
  orgId: string;
  tableId: string;
  tableName: string;
  description: string;
  // API 파라미터
  objL1: string;        // 분류1 (지역 또는 성별 등)
  objL2?: string;       // 분류2 (연령 등, 선택)
  itemId: string;       // 항목 ID
  unit: string;         // 단위
  // 지역별 코드 매핑 (선택)
  regionCodes?: Record<string, string>;
  // 지원하는 주기 (기본: ['Y'])
  supportedPeriods?: ('Y' | 'Q' | 'M')[];
}

// ===== 공통 지역 코드 상수 =====
// 테이블마다 지역 코드 체계가 다를 수 있음

/** 인구동향/출산율/혼인율 등에서 사용하는 지역 코드 */
export const REGION_CODES_DEMOGRAPHIC: Record<string, string> = {
  '전국': '00',
  '서울': '11',
  '부산': '21',
  '대구': '22',
  '인천': '23',
  '광주': '24',
  '대전': '25',
  '울산': '26',
  '세종': '29',
  '경기': '31',
  '강원': '32',
  '충북': '33',
  '충남': '34',
  '전북': '35',
  '전남': '36',
  '경북': '37',
  '경남': '38',
  '제주': '39',
};

/** 인구(주민등록)에서 사용하는 지역 코드 */
export const REGION_CODES_POPULATION: Record<string, string> = {
  '전국': '00',
  '서울': '11',
  '부산': '26',
  '대구': '27',
  '인천': '28',
  '광주': '29',
  '대전': '30',
  '울산': '31',
  '세종': '36',
  '경기': '41',
  '강원': '51',
  '충북': '43',
  '충남': '44',
  '전북': '52',
  '전남': '46',
  '경북': '47',
  '경남': '48',
  '제주': '50',
};

/** 물가지수에서 사용하는 지역 코드 */
export const REGION_CODES_CPI: Record<string, string> = {
  '전국': 'T10',
  '서울': 'T11',
  '부산': 'T12',
  '대구': 'T13',
  '인천': 'T14',
  '광주': 'T15',
  '대전': 'T16',
  '울산': 'T17',
  '세종': 'T18',
  '경기': 'T21',
  '강원': 'T31',
  '충북': 'T41',
  '충남': 'T51',
  '전북': 'T61',
  '전남': 'T71',
  '경북': 'T81',
  '경남': 'T90',
  '제주': 'T96',
};

/** 주택/아파트 가격지수에서 사용하는 지역 코드 */
export const REGION_CODES_HOUSING: Record<string, string> = {
  '전국': 'a0',
  '서울': 'a7',
  '경기': 'a8',
  '인천': 'a9',
  '부산': 'b1',
  '대구': 'b2',
  '광주': 'b3',
  '대전': 'b4',
  '울산': 'b5',
  '세종': 'b6',
  '강원': 'c1',
  '충북': 'c2',
  '충남': 'c3',
  '전북': 'c4',
  '전남': 'c5',
  '경북': 'c6',
  '경남': 'c7',
  '제주': 'c8',
};

/** PM2.5 미세먼지 지역 코드 (환경부 테이블) */
export const REGION_CODES_PM25: Record<string, string> = {
  '전국': '13102128219A.4100001',
  '서울': '13102128219A.4200003',
  '부산': '13102128219A.4200005',
  '대구': '13102128219A.4200007',
  '인천': '13102128219A.4200009',
  '광주': '13102128219A.4200011',
  '대전': '13102128219A.4200013',
  '울산': '13102128219A.4200015',
  '세종': '13102128219A.4200017',
  '경기': '13102128219A.4200050',  // 도평균
  '강원': '13102128219A.4200058',  // 도평균
  '충북': '13102128219A.4200081',  // 도평균
  '충남': '13102128219A.4200101',  // 도평균
  '전북': '13102128219A.4200115',  // 도평균
  '전남': '13102128219A.4200128',  // 도평균
  '경북': '13102128219A.4200152',  // 도평균
  '경남': '13102128219A.4200179',  // 도평균
  '제주': '13102128219A.4200192',  // 도평균
};

/** PM10 미세먼지 지역 코드 (환경부 테이블) */
export const REGION_CODES_PM10: Record<string, string> = {
  '전국': '13102128237A.4100001',
  '서울': '13102128237A.4200003',
  '부산': '13102128237A.4200005',
  '대구': '13102128237A.4200007',
  '인천': '13102128237A.4200009',
  '광주': '13102128237A.4200011',
  '대전': '13102128237A.4200013',
  '울산': '13102128237A.4200015',
  '세종': '13102128237A.4200017',
  '경기': '13102128237A.4200050',  // 도평균
  '강원': '13102128237A.4200058',  // 도평균
  '충북': '13102128237A.4200081',  // 도평균
  '충남': '13102128237A.4200101',  // 도평균
  '전북': '13102128237A.4200115',  // 도평균
  '전남': '13102128237A.4200128',  // 도평균
  '경북': '13102128237A.4200152',  // 도평균
  '경남': '13102128237A.4200179',  // 도평균
  '제주': '13102128237A.4200192',  // 도평균
};

/**
 * 검증된 Quick Stats 파라미터
 * - 2024년 기준 KOSIS API 메타데이터에서 추출
 */
export const QUICK_STATS_PARAMS: Record<string, QuickStatsParam> = {
  // ===== 인구 관련 =====
  // DT_1B040A3: 행정구역(시군구)별 성별 인구수 (1992~2025, 최신 데이터)
  '인구': {
    orgId: '101',
    tableId: 'DT_1B040A3',
    tableName: '행정구역(시군구)별 성별 인구수',
    description: '주민등록 총인구',
    objL1: '00',          // 전국 (C1: "00")
    itemId: 'T20',        // 총인구수 (ITM_ID: "T20")
    unit: '명',
    regionCodes: REGION_CODES_POPULATION,
  },
  '총인구': {
    orgId: '101',
    tableId: 'DT_1B040A3',
    tableName: '행정구역(시군구)별 성별 인구수',
    description: '주민등록 총인구',
    objL1: '00',
    itemId: 'T20',
    unit: '명',
    regionCodes: REGION_CODES_POPULATION,
  },

  // ===== 출산율 관련 =====
  // 주의: 출산율 테이블은 인구 테이블과 다른 지역 코드 체계 사용
  '출산율': {
    orgId: '101',
    tableId: 'DT_1B81A17',
    tableName: '합계출산율',
    description: '합계출산율',
    objL1: '00',          // 전국 (OBJ_ID: "A")
    itemId: 'T1',         // 합계출산율 (OBJ_ID: "ITEM")
    unit: '명',
    regionCodes: REGION_CODES_DEMOGRAPHIC,
  },
  '합계출산율': {
    orgId: '101',
    tableId: 'DT_1B81A17',
    tableName: '합계출산율',
    description: '합계출산율 (여성 1명당)',
    objL1: '00',
    itemId: 'T1',
    unit: '명',
    regionCodes: REGION_CODES_DEMOGRAPHIC,
  },

  // ===== 고용 관련 =====
  // DT_1DA7004S: 행정구역(시도)별 경제활동인구 (1999~2025, 시도별 지원, 월/분기/연 모두 지원)
  '실업률': {
    orgId: '101',
    tableId: 'DT_1DA7004S',
    tableName: '행정구역(시도)별 경제활동인구',
    description: '실업률',
    objL1: '00',          // 전국 (OBJ_ID: "A")
    itemId: 'T80',        // 실업률 (%)
    unit: '%',
    regionCodes: REGION_CODES_DEMOGRAPHIC,
    supportedPeriods: ['Y', 'Q', 'M'],
  },
  '고용률': {
    orgId: '101',
    tableId: 'DT_1DA7004S',
    tableName: '행정구역(시도)별 경제활동인구',
    description: '고용률',
    objL1: '00',          // 전국 (OBJ_ID: "A")
    itemId: 'T90',        // 고용률 (%)
    unit: '%',
    regionCodes: REGION_CODES_DEMOGRAPHIC,
    supportedPeriods: ['Y', 'Q', 'M'],
  },

  // ===== 경제 관련 =====
  'GDP': {
    orgId: '301',
    tableId: 'DT_200Y001',
    tableName: '국내총생산(GDP)',
    description: '국내총생산(GDP)',
    objL1: '13102134474ACC_ITEM.10101',  // 국내총생산 명목 원화표시
    itemId: '13103134474999',             // 주요지표
    unit: '십억원',
  },
  '국내총생산': {
    orgId: '301',
    tableId: 'DT_200Y001',
    tableName: '국내총생산(GDP)',
    description: '국내총생산(GDP)',
    objL1: '13102134474ACC_ITEM.10101',
    itemId: '13103134474999',
    unit: '십억원',
  },

  // ===== 물가 관련 =====
  '물가': {
    orgId: '101',
    tableId: 'DT_1J22001',
    tableName: '지출목적별 소비자물가지수',
    description: '소비자물가지수',
    objL1: 'T10',         // 전국 (OBJ_ID: "C" - 시도별)
    objL2: '0',           // 총지수 (OBJ_ID: "D" - 지출목적별, 0=총지수)
    itemId: 'T',          // 소비자물가지수 (OBJ_ID: "ITEM")
    unit: '2020=100',
    regionCodes: REGION_CODES_CPI,
    supportedPeriods: ['Y', 'M'],
  },
  '소비자물가': {
    orgId: '101',
    tableId: 'DT_1J22001',
    tableName: '지출목적별 소비자물가지수',
    description: '소비자물가지수',
    objL1: 'T10',
    objL2: '0',           // 총지수
    itemId: 'T',
    unit: '2020=100',
    regionCodes: REGION_CODES_CPI,
    supportedPeriods: ['Y', 'M'],
  },
  '소비자물가지수': {
    orgId: '101',
    tableId: 'DT_1J22001',
    tableName: '지출목적별 소비자물가지수',
    description: '소비자물가지수 (2020=100)',
    objL1: 'T10',
    objL2: '0',           // 총지수
    itemId: 'T',
    unit: '2020=100',
    regionCodes: REGION_CODES_CPI,
    supportedPeriods: ['Y', 'M'],
  },

  // ===== 혼인 관련 =====
  '혼인율': {
    orgId: '101',
    tableId: 'DT_1B83A34',
    tableName: '시도/일반혼인율',
    description: '일반혼인율 (인구 천명당)',
    objL1: '00',          // 전국
    itemId: 'T10',        // 남편 기준 혼인율
    unit: '‰',
    regionCodes: REGION_CODES_DEMOGRAPHIC,  // 인구동향 지역코드 사용 (POPULATION 코드가 아님)
  },

  // ===== 수명 관련 =====
  '기대수명': {
    orgId: '101',
    tableId: 'DT_1B42',
    tableName: '완전생명표(1세별)',
    description: '기대수명 (0세 기대여명)',
    objL1: '050',         // 0세 (출생시)
    itemId: 'T6',         // 기대여명(전체)
    unit: '년',
  },
  '기대여명': {
    orgId: '101',
    tableId: 'DT_1B42',
    tableName: '완전생명표(1세별)',
    description: '기대수명 (0세 기대여명)',
    objL1: '050',         // 0세 (출생시)
    itemId: 'T6',         // 기대여명(전체)
    unit: '년',
  },
  '평균수명': {
    orgId: '101',
    tableId: 'DT_1B42',
    tableName: '완전생명표(1세별)',
    description: '기대수명 (0세 기대여명)',
    objL1: '050',         // 0세 (출생시)
    itemId: 'T6',         // 기대여명(전체)
    unit: '년',
  },

  // ===== 무역 관련 =====
  '수출액': {
    orgId: '101',
    tableId: 'DT_1YL6901',
    tableName: '수출액(시도)',
    description: '수출액',
    objL1: '00',          // 전국
    itemId: 'T10',        // 수출액
    unit: '100만달러',
    regionCodes: REGION_CODES_DEMOGRAPHIC,
  },
  '수출': {
    orgId: '101',
    tableId: 'DT_1YL6901',
    tableName: '수출액(시도)',
    description: '수출액',
    objL1: '00',
    itemId: 'T10',
    unit: '100만달러',
    regionCodes: REGION_CODES_DEMOGRAPHIC,
  },

  // ===== 수입 관련 =====
  '수입액': {
    orgId: '134',
    tableId: 'DT_134001_001',
    tableName: '수출입총괄',
    description: '수입액',
    objL1: 'DATA',          // 가상분류
    itemId: 'T004',         // 수입금액
    unit: '천달러',
  },
  '수입': {
    orgId: '134',
    tableId: 'DT_134001_001',
    tableName: '수출입총괄',
    description: '수입액',
    objL1: 'DATA',
    itemId: 'T004',
    unit: '천달러',
  },
  '무역수지': {
    orgId: '134',
    tableId: 'DT_134001_001',
    tableName: '수출입총괄',
    description: '무역수지 (수출-수입)',
    objL1: 'DATA',
    itemId: 'T005',
    unit: '천달러',
  },

  // ===== 인구동향 (출생/사망/혼인/이혼) =====
  // DT_1B8000G: 종합 인구동향 테이블 (월/분기/연 모두 지원)
  // objL1 = 지역코드 (B), objL2 = 종류코드 (A), itmId = T1
  '출생아수': {
    orgId: '101',
    tableId: 'DT_1B8000G',
    tableName: '월.분기.연간 인구동향',
    description: '출생아수',
    objL1: '00',            // 전국 (지역)
    objL2: '10',            // 출생아수(명) (종류)
    itemId: 'T1',
    unit: '명',
    regionCodes: REGION_CODES_DEMOGRAPHIC,
    supportedPeriods: ['Y', 'Q', 'M'],
  },
  '출생아': {
    orgId: '101',
    tableId: 'DT_1B8000G',
    tableName: '월.분기.연간 인구동향',
    description: '출생아수',
    objL1: '00',
    objL2: '10',
    itemId: 'T1',
    unit: '명',
    regionCodes: REGION_CODES_DEMOGRAPHIC,
    supportedPeriods: ['Y', 'Q', 'M'],
  },
  '조출생률': {
    orgId: '101',
    tableId: 'DT_1B8000G',
    tableName: '월.분기.연간 인구동향',
    description: '조출생률 (인구 천명당)',
    objL1: '00',
    objL2: '11',            // 조출생률(천명당)
    itemId: 'T1',
    unit: '‰',
    regionCodes: REGION_CODES_DEMOGRAPHIC,
    supportedPeriods: ['Y', 'Q', 'M'],
  },
  '사망자수': {
    orgId: '101',
    tableId: 'DT_1B8000G',
    tableName: '월.분기.연간 인구동향',
    description: '사망자수',
    objL1: '00',
    objL2: '15',            // 사망자수(명)
    itemId: 'T1',
    unit: '명',
    regionCodes: REGION_CODES_DEMOGRAPHIC,
    supportedPeriods: ['Y', 'Q', 'M'],
  },
  '사망자': {
    orgId: '101',
    tableId: 'DT_1B8000G',
    tableName: '월.분기.연간 인구동향',
    description: '사망자수',
    objL1: '00',
    objL2: '15',
    itemId: 'T1',
    unit: '명',
    regionCodes: REGION_CODES_DEMOGRAPHIC,
    supportedPeriods: ['Y', 'Q', 'M'],
  },
  '조사망률': {
    orgId: '101',
    tableId: 'DT_1B8000G',
    tableName: '월.분기.연간 인구동향',
    description: '조사망률 (인구 천명당)',
    objL1: '00',
    objL2: '16',            // 조사망률(천명당)
    itemId: 'T1',
    unit: '‰',
    regionCodes: REGION_CODES_DEMOGRAPHIC,
    supportedPeriods: ['Y', 'Q', 'M'],
  },
  '사망률': {
    orgId: '101',
    tableId: 'DT_1B8000G',
    tableName: '월.분기.연간 인구동향',
    description: '조사망률 (인구 천명당)',
    objL1: '00',
    objL2: '16',
    itemId: 'T1',
    unit: '‰',
    regionCodes: REGION_CODES_DEMOGRAPHIC,
    supportedPeriods: ['Y', 'Q', 'M'],
  },
  '이혼건수': {
    orgId: '101',
    tableId: 'DT_1B8000G',
    tableName: '월.분기.연간 인구동향',
    description: '이혼건수',
    objL1: '00',
    objL2: '30',            // 이혼건수(건)
    itemId: 'T1',
    unit: '건',
    regionCodes: REGION_CODES_DEMOGRAPHIC,
    supportedPeriods: ['Y', 'Q', 'M'],
  },
  '조이혼율': {
    orgId: '101',
    tableId: 'DT_1B8000G',
    tableName: '월.분기.연간 인구동향',
    description: '조이혼율 (인구 천명당)',
    objL1: '00',
    objL2: '31',            // 조이혼율(천명당)
    itemId: 'T1',
    unit: '‰',
    regionCodes: REGION_CODES_DEMOGRAPHIC,
    supportedPeriods: ['Y', 'Q', 'M'],
  },
  '이혼율': {
    orgId: '101',
    tableId: 'DT_1B8000G',
    tableName: '월.분기.연간 인구동향',
    description: '조이혼율 (인구 천명당)',
    objL1: '00',
    objL2: '31',
    itemId: 'T1',
    unit: '‰',
    regionCodes: REGION_CODES_DEMOGRAPHIC,
    supportedPeriods: ['Y', 'Q', 'M'],
  },
  '혼인건수': {
    orgId: '101',
    tableId: 'DT_1B8000G',
    tableName: '월.분기.연간 인구동향',
    description: '혼인건수',
    objL1: '00',
    objL2: '20',            // 혼인건수(건)
    itemId: 'T1',
    unit: '건',
    regionCodes: REGION_CODES_DEMOGRAPHIC,
    supportedPeriods: ['Y', 'Q', 'M'],
  },
  '조혼인율': {
    orgId: '101',
    tableId: 'DT_1B8000G',
    tableName: '월.분기.연간 인구동향',
    description: '조혼인율 (인구 천명당)',
    objL1: '00',
    objL2: '21',            // 조혼인율(천명당)
    itemId: 'T1',
    unit: '‰',
    regionCodes: REGION_CODES_DEMOGRAPHIC,
    supportedPeriods: ['Y', 'Q', 'M'],
  },
  '자연증가': {
    orgId: '101',
    tableId: 'DT_1B8000G',
    tableName: '월.분기.연간 인구동향',
    description: '자연증가건수 (출생-사망)',
    objL1: '00',
    objL2: '17',            // 자연증가건수(명)
    itemId: 'T1',
    unit: '명',
    regionCodes: REGION_CODES_DEMOGRAPHIC,
    supportedPeriods: ['Y', 'Q', 'M'],
  },
  '자연증가율': {
    orgId: '101',
    tableId: 'DT_1B8000G',
    tableName: '월.분기.연간 인구동향',
    description: '자연증가율 (인구 천명당)',
    objL1: '00',
    objL2: '18',            // 자연증가율(천명당)
    itemId: 'T1',
    unit: '‰',
    regionCodes: REGION_CODES_DEMOGRAPHIC,
    supportedPeriods: ['Y', 'Q', 'M'],
  },

  // ===== 경제성장률 관련 =====
  '경제성장률': {
    orgId: '301',
    tableId: 'DT_200Y101',
    tableName: '주요지표(연간지표)',
    description: 'GDP 실질성장률',
    objL1: '13102136288ACC_ITEM.20101',  // 국내총생산(실질성장률)
    itemId: '13103136288999',             // 주요지표
    unit: '%',
  },
  '성장률': {
    orgId: '301',
    tableId: 'DT_200Y101',
    tableName: '주요지표(연간지표)',
    description: 'GDP 실질성장률',
    objL1: '13102136288ACC_ITEM.20101',
    itemId: '13103136288999',
    unit: '%',
  },
  'GDP성장률': {
    orgId: '301',
    tableId: 'DT_200Y101',
    tableName: '주요지표(연간지표)',
    description: 'GDP 실질성장률',
    objL1: '13102136288ACC_ITEM.20101',
    itemId: '13103136288999',
    unit: '%',
  },

  // ===== 고용 추가 지표 =====
  // DT_1DA7001S: 성별 경제활동인구 총괄
  '취업자수': {
    orgId: '101',
    tableId: 'DT_1DA7001S',
    tableName: '성별 경제활동인구 총괄',
    description: '취업자수',
    objL1: '0',           // 계 - 성별
    itemId: 'T30',        // 취업자 (천명)
    unit: '천명',
  },
  '취업자': {
    orgId: '101',
    tableId: 'DT_1DA7001S',
    tableName: '성별 경제활동인구 총괄',
    description: '취업자수',
    objL1: '0',
    itemId: 'T30',
    unit: '천명',
  },
  '경제활동인구': {
    orgId: '101',
    tableId: 'DT_1DA7001S',
    tableName: '성별 경제활동인구 총괄',
    description: '경제활동인구',
    objL1: '0',           // 계 - 성별
    itemId: 'T20',        // 경제활동인구 (천명)
    unit: '천명',
  },
  '실업자수': {
    orgId: '101',
    tableId: 'DT_1DA7001S',
    tableName: '성별 경제활동인구 총괄',
    description: '실업자수',
    objL1: '0',           // 계 - 성별
    itemId: 'T40',        // 실업자 (천명)
    unit: '천명',
  },
  '실업자': {
    orgId: '101',
    tableId: 'DT_1DA7001S',
    tableName: '성별 경제활동인구 총괄',
    description: '실업자수',
    objL1: '0',
    itemId: 'T40',
    unit: '천명',
  },
  '비경제활동인구': {
    orgId: '101',
    tableId: 'DT_1DA7001S',
    tableName: '성별 경제활동인구 총괄',
    description: '비경제활동인구',
    objL1: '0',
    itemId: 'T50',        // 비경제활동인구 (천명)
    unit: '천명',
  },

  // ===== 부동산 관련 =====
  // DT_1YL13501E: 주택매매가격지수 (2003.11~, 월간)
  '주택가격': {
    orgId: '101',
    tableId: 'DT_1YL13501E',
    tableName: '주택매매가격지수(시도/시/군/구)',
    description: '주택매매가격지수',
    objL1: 'a0',          // 전국
    itemId: 'sales',      // 주택매매가격지수
    unit: '(2021.6=100)',
    regionCodes: REGION_CODES_HOUSING,
    supportedPeriods: ['M'],
  },
  '주택매매가격': {
    orgId: '101',
    tableId: 'DT_1YL13501E',
    tableName: '주택매매가격지수(시도/시/군/구)',
    description: '주택매매가격지수',
    objL1: 'a0',
    itemId: 'sales',
    unit: '(2021.6=100)',
    regionCodes: REGION_CODES_HOUSING,
    supportedPeriods: ['M'],
  },
  '주택가격지수': {
    orgId: '101',
    tableId: 'DT_1YL13501E',
    tableName: '주택매매가격지수(시도/시/군/구)',
    description: '주택매매가격지수',
    objL1: 'a0',
    itemId: 'sales',
    unit: '(2021.6=100)',
    regionCodes: REGION_CODES_HOUSING,
    supportedPeriods: ['M'],
  },
  // DT_1YL20161E: 아파트매매가격지수 (2003.11~, 월간)
  '아파트가격': {
    orgId: '101',
    tableId: 'DT_1YL20161E',
    tableName: '아파트매매가격지수(시도/시/군/구)',
    description: '아파트매매가격지수',
    objL1: 'a0',          // 전국
    itemId: 'sales',      // 아파트매매가격지수
    unit: '(2021.6=100)',
    regionCodes: REGION_CODES_HOUSING,
    supportedPeriods: ['M'],
  },
  '아파트매매가격': {
    orgId: '101',
    tableId: 'DT_1YL20161E',
    tableName: '아파트매매가격지수(시도/시/군/구)',
    description: '아파트매매가격지수',
    objL1: 'a0',
    itemId: 'sales',
    unit: '(2021.6=100)',
    regionCodes: REGION_CODES_HOUSING,
    supportedPeriods: ['M'],
  },
  '아파트가격지수': {
    orgId: '101',
    tableId: 'DT_1YL20161E',
    tableName: '아파트매매가격지수(시도/시/군/구)',
    description: '아파트매매가격지수',
    objL1: 'a0',
    itemId: 'sales',
    unit: '(2021.6=100)',
    regionCodes: REGION_CODES_HOUSING,
    supportedPeriods: ['M'],
  },
  '아파트': {
    orgId: '101',
    tableId: 'DT_1YL20161E',
    tableName: '아파트매매가격지수(시도/시/군/구)',
    description: '아파트매매가격지수',
    objL1: 'a0',
    itemId: 'sales',
    unit: '(2021.6=100)',
    regionCodes: REGION_CODES_HOUSING,
    supportedPeriods: ['M'],
  },

  // ===== 임금/소득 관련 =====
  // DT_1YL15006: 월평균 임금 및 임금상승률 (시도별, 연간)
  '임금': {
    orgId: '101',
    tableId: 'DT_1YL15006',
    tableName: '월평균 임금 및 임금상승률(시도)',
    description: '상용근로자 월평균 임금',
    objL1: '00',          // 전국
    itemId: 'T001',       // 상용 월평균 임금
    unit: '원',
    regionCodes: REGION_CODES_DEMOGRAPHIC,
  },
  '월평균임금': {
    orgId: '101',
    tableId: 'DT_1YL15006',
    tableName: '월평균 임금 및 임금상승률(시도)',
    description: '상용근로자 월평균 임금',
    objL1: '00',
    itemId: 'T001',
    unit: '원',
    regionCodes: REGION_CODES_DEMOGRAPHIC,
  },
  '월급': {
    orgId: '101',
    tableId: 'DT_1YL15006',
    tableName: '월평균 임금 및 임금상승률(시도)',
    description: '상용근로자 월평균 임금',
    objL1: '00',
    itemId: 'T001',
    unit: '원',
    regionCodes: REGION_CODES_DEMOGRAPHIC,
  },
  '평균임금': {
    orgId: '101',
    tableId: 'DT_1YL15006',
    tableName: '월평균 임금 및 임금상승률(시도)',
    description: '상용근로자 월평균 임금',
    objL1: '00',
    itemId: 'T001',
    unit: '원',
    regionCodes: REGION_CODES_DEMOGRAPHIC,
  },

  // ===== GRDP (지역내총생산) =====
  // INH_1C91: GRDP 시도별 (연간)
  'GRDP': {
    orgId: '101',
    tableId: 'INH_1C91',
    tableName: 'GRDP(시도)',
    description: '지역내총생산(명목)',
    objL1: '00',          // 전국
    objL2: 'Z10',         // 지역내총생산(시장가격)
    itemId: 'T1',         // 명목
    unit: '백만원',
    regionCodes: REGION_CODES_DEMOGRAPHIC,
  },
  '지역내총생산': {
    orgId: '101',
    tableId: 'INH_1C91',
    tableName: 'GRDP(시도)',
    description: '지역내총생산(명목)',
    objL1: '00',
    objL2: 'Z10',
    itemId: 'T1',
    unit: '백만원',
    regionCodes: REGION_CODES_DEMOGRAPHIC,
  },

  // ===== 전세 가격지수 =====
  // DT_1YL13601E: 주택전세가격지수 (2003.11~, 월간)
  '전세가격': {
    orgId: '101',
    tableId: 'DT_1YL13601E',
    tableName: '주택전세가격지수(시도/시/군/구)',
    description: '주택전세가격지수',
    objL1: 'a0',
    itemId: 'sales',
    unit: '(2021.6=100)',
    regionCodes: REGION_CODES_HOUSING,
    supportedPeriods: ['M'],
  },
  '전세가격지수': {
    orgId: '101',
    tableId: 'DT_1YL13601E',
    tableName: '주택전세가격지수(시도/시/군/구)',
    description: '주택전세가격지수',
    objL1: 'a0',
    itemId: 'sales',
    unit: '(2021.6=100)',
    regionCodes: REGION_CODES_HOUSING,
    supportedPeriods: ['M'],
  },
  '주택전세': {
    orgId: '101',
    tableId: 'DT_1YL13601E',
    tableName: '주택전세가격지수(시도/시/군/구)',
    description: '주택전세가격지수',
    objL1: 'a0',
    itemId: 'sales',
    unit: '(2021.6=100)',
    regionCodes: REGION_CODES_HOUSING,
    supportedPeriods: ['M'],
  },
  '전세': {
    orgId: '101',
    tableId: 'DT_1YL13601E',
    tableName: '주택전세가격지수(시도/시/군/구)',
    description: '주택전세가격지수',
    objL1: 'a0',
    itemId: 'sales',
    unit: '(2021.6=100)',
    regionCodes: REGION_CODES_HOUSING,
    supportedPeriods: ['M'],
  },
  // DT_1YL20171E: 아파트전세가격지수 (2003.11~, 월간)
  '아파트전세': {
    orgId: '101',
    tableId: 'DT_1YL20171E',
    tableName: '아파트전세가격지수(시도/시/군/구)',
    description: '아파트전세가격지수',
    objL1: 'a0',
    itemId: 'sales',
    unit: '(2021.6=100)',
    regionCodes: REGION_CODES_HOUSING,
    supportedPeriods: ['M'],
  },
  '아파트전세가격': {
    orgId: '101',
    tableId: 'DT_1YL20171E',
    tableName: '아파트전세가격지수(시도/시/군/구)',
    description: '아파트전세가격지수',
    objL1: 'a0',
    itemId: 'sales',
    unit: '(2021.6=100)',
    regionCodes: REGION_CODES_HOUSING,
    supportedPeriods: ['M'],
  },

  // ===== 자동차 등록 =====
  // DT_1YL20731: 1인당 자동차 등록대수 (시도별, 연간)
  '자동차': {
    orgId: '101',
    tableId: 'DT_1YL20731',
    tableName: '1인당 자동차 등록대수(시도/시/군/구)',
    description: '자동차 등록대수',
    objL1: '00',
    itemId: 'T001',       // 자동차등록대수
    unit: '대',
    regionCodes: REGION_CODES_DEMOGRAPHIC,
  },
  '자동차등록': {
    orgId: '101',
    tableId: 'DT_1YL20731',
    tableName: '1인당 자동차 등록대수(시도/시/군/구)',
    description: '자동차 등록대수',
    objL1: '00',
    itemId: 'T001',
    unit: '대',
    regionCodes: REGION_CODES_DEMOGRAPHIC,
  },
  '자동차대수': {
    orgId: '101',
    tableId: 'DT_1YL20731',
    tableName: '1인당 자동차 등록대수(시도/시/군/구)',
    description: '자동차 등록대수',
    objL1: '00',
    itemId: 'T001',
    unit: '대',
    regionCodes: REGION_CODES_DEMOGRAPHIC,
  },

  // ===== 범죄 통계 =====
  // DT_1YL3001: 인구 천명당 범죄발생건수 (시도별, 연간)
  '범죄': {
    orgId: '101',
    tableId: 'DT_1YL3001',
    tableName: '인구 천명당 범죄발생건수(시도)',
    description: '인구 천명당 범죄발생건수',
    objL1: '00',
    itemId: 'T10',        // 인구 천명당 범죄발생건수
    unit: '건',
    regionCodes: REGION_CODES_DEMOGRAPHIC,
  },
  '범죄율': {
    orgId: '101',
    tableId: 'DT_1YL3001',
    tableName: '인구 천명당 범죄발생건수(시도)',
    description: '인구 천명당 범죄발생건수',
    objL1: '00',
    itemId: 'T10',
    unit: '건',
    regionCodes: REGION_CODES_DEMOGRAPHIC,
  },
  '범죄발생': {
    orgId: '101',
    tableId: 'DT_1YL3001',
    tableName: '인구 천명당 범죄발생건수(시도)',
    description: '범죄발생건수',
    objL1: '00',
    itemId: 'T001',       // 범죄발생건수 (총)
    unit: '건',
    regionCodes: REGION_CODES_DEMOGRAPHIC,
  },

  // ===== 관광 통계 =====
  // DT_TRD_TGT_ENT_AGG_MONTH: 외래관광객 입국 (월간)
  '관광객': {
    orgId: '314',
    tableId: 'DT_TRD_TGT_ENT_AGG_MONTH',
    tableName: '외래객 입국-목적별/국적별',
    description: '외래관광객수',
    objL1: '13102314422A.1',  // 총계
    itemId: '13103314422T01', // 계
    unit: '명',
    supportedPeriods: ['M'],
  },
  '외래관광객': {
    orgId: '314',
    tableId: 'DT_TRD_TGT_ENT_AGG_MONTH',
    tableName: '외래객 입국-목적별/국적별',
    description: '외래관광객수',
    objL1: '13102314422A.1',
    itemId: '13103314422T01',
    unit: '명',
    supportedPeriods: ['M'],
  },
  '입국자': {
    orgId: '314',
    tableId: 'DT_TRD_TGT_ENT_AGG_MONTH',
    tableName: '외래객 입국-목적별/국적별',
    description: '외래관광객수',
    objL1: '13102314422A.1',
    itemId: '13103314422T01',
    unit: '명',
    supportedPeriods: ['M'],
  },

  // ===== 교통사고 =====
  '교통사고': {
    orgId: '101',
    tableId: 'DT_1YL21051',
    tableName: '자동차 천대당 교통사고발생건수(시도/시/군/구)',
    description: '교통사고 발생건수',
    objL1: '00',
    itemId: 'T001',
    unit: '건',
    regionCodes: REGION_CODES_DEMOGRAPHIC,
  },
  '교통사고발생': {
    orgId: '101',
    tableId: 'DT_1YL21051',
    tableName: '자동차 천대당 교통사고발생건수(시도/시/군/구)',
    description: '교통사고 발생건수',
    objL1: '00',
    itemId: 'T001',
    unit: '건',
    regionCodes: REGION_CODES_DEMOGRAPHIC,
  },
  '사고건수': {
    orgId: '101',
    tableId: 'DT_1YL21051',
    tableName: '자동차 천대당 교통사고발생건수(시도/시/군/구)',
    description: '교통사고 발생건수',
    objL1: '00',
    itemId: 'T001',
    unit: '건',
    regionCodes: REGION_CODES_DEMOGRAPHIC,
  },

  // ===== 의료 (의사수) =====
  '의사': {
    orgId: '101',
    tableId: 'DT_1YL20981',
    tableName: '인구 천명당 의료기관 종사 의사수(시도/시/군/구)',
    description: '의료기관 종사 의사수',
    objL1: '00',
    itemId: 'T001',
    unit: '명',
    regionCodes: REGION_CODES_DEMOGRAPHIC,
  },
  '의사수': {
    orgId: '101',
    tableId: 'DT_1YL20981',
    tableName: '인구 천명당 의료기관 종사 의사수(시도/시/군/구)',
    description: '의료기관 종사 의사수',
    objL1: '00',
    itemId: 'T001',
    unit: '명',
    regionCodes: REGION_CODES_DEMOGRAPHIC,
  },
  '의료인력': {
    orgId: '101',
    tableId: 'DT_1YL20981',
    tableName: '인구 천명당 의료기관 종사 의사수(시도/시/군/구)',
    description: '의료기관 종사 의사수',
    objL1: '00',
    itemId: 'T001',
    unit: '명',
    regionCodes: REGION_CODES_DEMOGRAPHIC,
  },

  // ===== 대기환경 (미세먼지) =====
  '미세먼지': {
    orgId: '106',
    tableId: 'DT_106N_03_0200145',
    tableName: '미세먼지(PM2.5) 월별 도시별 대기오염도',
    description: '초미세먼지(PM2.5) 농도',
    objL1: '13102128219A.4100001',  // 전국(총계)
    itemId: '13103128219T.1100001', // 월평균
    unit: 'μg/m³',
    regionCodes: REGION_CODES_PM25,
    supportedPeriods: ['M'],
  },
  'PM2.5': {
    orgId: '106',
    tableId: 'DT_106N_03_0200145',
    tableName: '미세먼지(PM2.5) 월별 도시별 대기오염도',
    description: '초미세먼지(PM2.5) 농도',
    objL1: '13102128219A.4100001',
    itemId: '13103128219T.1100001',
    unit: 'μg/m³',
    regionCodes: REGION_CODES_PM25,
    supportedPeriods: ['M'],
  },
  '초미세먼지': {
    orgId: '106',
    tableId: 'DT_106N_03_0200145',
    tableName: '미세먼지(PM2.5) 월별 도시별 대기오염도',
    description: '초미세먼지(PM2.5) 농도',
    objL1: '13102128219A.4100001',
    itemId: '13103128219T.1100001',
    unit: 'μg/m³',
    regionCodes: REGION_CODES_PM25,
    supportedPeriods: ['M'],
  },
  'PM10': {
    orgId: '106',
    tableId: 'DT_106N_03_0200045',
    tableName: '미세먼지(PM10) 월별 도시별 대기오염도',
    description: '미세먼지(PM10) 농도',
    objL1: '13102128237A.4100001',  // 전국(총계)
    itemId: '13103128237T.1100001', // 월평균
    unit: 'μg/m³',
    regionCodes: REGION_CODES_PM10,
    supportedPeriods: ['M'],
  },
  '대기오염': {
    orgId: '106',
    tableId: 'DT_106N_03_0200145',
    tableName: '미세먼지(PM2.5) 월별 도시별 대기오염도',
    description: '초미세먼지(PM2.5) 농도',
    objL1: '13102128219A.4100001',
    itemId: '13103128219T.1100001',
    unit: 'μg/m³',
    regionCodes: REGION_CODES_PM25,
    supportedPeriods: ['M'],
  },
};

/**
 * 키워드로 파라미터 조회
 */
export function getQuickStatsParam(keyword: string): QuickStatsParam | undefined {
  return QUICK_STATS_PARAMS[keyword];
}

/**
 * 지역 코드 조회
 */
export function getRegionCode(param: QuickStatsParam, regionName: string): string {
  if (param.regionCodes && param.regionCodes[regionName]) {
    return param.regionCodes[regionName];
  }
  return param.objL1; // 기본값
}
