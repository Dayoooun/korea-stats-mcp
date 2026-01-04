// dotenv는 하드코딩된 키 사용 시 불필요
// import 'dotenv/config';

export const config = {
  // KOSIS API 설정
  kosis: {
    apiKey: 'MTIyZDEyMjlkOGNiNjhhNjY0YzFmNjNiNzVmMTU2Njg=',  // ← 여기에 실제 키 입력
    baseUrl: 'https://kosis.kr/openapi',
    endpoints: {
      statisticsList: '/statisticsList.do',
      statisticsData: '/statisticsData.do',
      parameterData: '/Param/statisticsParameterData.do',
      searchStatistics: '/statisticsSearch.do',
      statsExplain: '/statsExplain.do',
    },
  },

  // 캐시 설정
  cache: {
    ttlHours: parseInt(process.env.CACHE_TTL_HOURS || '6', 10),
    maxKeys: 1000,
  },

  // 로그 레벨
  logLevel: process.env.LOG_LEVEL || 'info',

  // 서비스뷰 코드 (통계 분류 체계)
  viewCodes: {
    MT_ZTITLE: '국내통계 주제별',
    MT_OTITLE: '국내통계 기관별',
    MT_GTITLE01: 'e-지방지표(주제별)',
    MT_GTITLE02: 'e-지방지표(지역별)',
    MT_CHOSUN_TITLE: '광복이전통계(1908~1943)',
    MT_HANKUK_TITLE: '대한민국통계연감',
    MT_STOP_TITLE: '작성중지통계',
    MT_RTITLE: '국제통계',
    MT_BUKHAN: '북한통계',
    MT_TM1_TITLE: '대상별통계',
    MT_TM2_TITLE: '이슈별통계',
    MT_ETITLE: '영문 KOSIS',
  } as const,

  // 주기 코드
  periodCodes: {
    D: '일',
    M: '월',
    Q: '분기',
    S: '반기',
    Y: '년',
    F: '다년(2년~10년)',
    IR: '부정기',
  } as const,
} as const;

// 설정 유효성 검사
export function validateConfig(): void {
  // 기본 API 키가 내장되어 있어 별도 검사 불필요
}

export type ViewCode = keyof typeof config.viewCodes;
export type PeriodCode = keyof typeof config.periodCodes;
