/**
 * KOSIS OpenAPI 타입 정의
 */

// 공통 응답 타입
export interface KosisApiResponse<T> {
  err?: string;
  errMsg?: string;
  result?: T[];
}

// 통계목록 API 응답
export interface StatisticsListItem {
  VW_CD: string;      // 서비스뷰ID
  VW_NM: string;      // 서비스뷰명
  LIST_ID?: string;   // 목록ID (폴더인 경우)
  LIST_NM?: string;   // 목록명
  ORG_ID?: string;    // 기관코드
  TBL_ID?: string;    // 통계표ID (통계표인 경우)
  TBL_NM?: string;    // 통계표명
  STAT_ID?: string;   // 통계조사ID
  SEND_DE?: string;   // 최종갱신일
  REC_TBL_SE?: string;// 추천 통계표 여부
  UP_ID?: string;     // 상위 ID
}

// 통계자료 API 응답
export interface StatisticsDataItem {
  ORG_ID: string;        // 기관코드
  TBL_ID: string;        // 통계표ID
  TBL_NM: string;        // 통계표명
  C1?: string;           // 분류값 ID1
  C1_OBJ_NM?: string;    // 분류명1
  C1_NM?: string;        // 분류값명1
  C2?: string;           // 분류값 ID2
  C2_OBJ_NM?: string;
  C2_NM?: string;
  C3?: string;
  C3_OBJ_NM?: string;
  C3_NM?: string;
  C4?: string;
  C4_OBJ_NM?: string;
  C4_NM?: string;
  C5?: string;
  C5_OBJ_NM?: string;
  C5_NM?: string;
  C6?: string;
  C6_OBJ_NM?: string;
  C6_NM?: string;
  C7?: string;
  C7_OBJ_NM?: string;
  C7_NM?: string;
  C8?: string;
  C8_OBJ_NM?: string;
  C8_NM?: string;
  ITM_ID: string;        // 항목 ID
  ITM_NM: string;        // 항목명
  ITM_NM_ENG?: string;   // 항목영문명
  UNIT_ID?: string;      // 단위ID
  UNIT_NM: string;       // 단위명
  UNIT_NM_ENG?: string;  // 단위영문명
  PRD_SE: string;        // 수록주기
  PRD_DE: string;        // 수록시점
  DT: string;            // 수치값
  LST_CHN_DE?: string;   // 최종수정일
}

// 통합검색 API 응답
// API 문서: https://kosis.kr/openapi/devGuide/devGuide_0701List.do
export interface SearchResultItem {
  ORG_ID: string;        // 기관코드
  ORG_NM: string;        // 기관명
  TBL_ID: string;        // 통계표ID
  TBL_NM: string;        // 통계표명
  STAT_ID: string;       // 조사코드
  STAT_NM: string;       // 조사명
  VW_CD: string;         // KOSIS 목록구분
  MT_ATITLE?: string;    // KOSIS 통계표 위치
  FULL_PATH_ID?: string; // 통계표 위치
  CONTENTS?: string;     // 통계표 주요내용
  STRT_PRD_DE?: string;  // 수록기간 시작일
  END_PRD_DE?: string;   // 수록기간 종료일
  ITEM03?: string;       // 통계표 주석
  REC_TBL_SE?: string;   // 추천통계표 여부
  TBL_VIEW_URL?: string; // 통계표 이동URL (KOSIS 목록)
  LINK_URL?: string;     // 통계표 이동URL (KOSIS 통계표)
  STAT_DB_CNT?: string;  // 검색결과 건수
  QUERY?: string;        // 검색어명
}

// 통계설명 API 응답
export interface StatisticsExplainItem {
  STAT_ID: string;     // 통계조사ID
  STAT_NM: string;     // 통계조사명
  STAT_KIND: string;   // 통계종류
  WRIT_PURPS: string;  // 작성목적
  EXAMIN_PD: string;   // 조사주기
  STAT_PERIOD: string; // 수록기간
  MAIN_TERM_EXPL: string; // 주요용어해설
  JOSA_NM: string;     // 담당부서
  CONTACT_DEPT_NM: string; // 연락처
}

// API 요청 파라미터 타입
export interface StatisticsListParams {
  method: 'getList';
  apiKey: string;
  vwCd: string;
  parentListId?: string;
  format: 'json';
  jsonVD?: 'Y';
}

export interface StatisticsDataParams {
  method: 'getList';
  apiKey: string;
  orgId: string;
  tblId: string;
  objL1?: string;
  objL2?: string;
  objL3?: string;
  objL4?: string;
  objL5?: string;
  objL6?: string;
  objL7?: string;
  objL8?: string;
  itmId?: string;
  prdSe: string;        // 주기 (Y, M, Q 등)
  startPrdDe?: string;  // 시작시점
  endPrdDe?: string;    // 종료시점
  newEstPrdCnt?: number;// 최근 N개 시점
  format: 'json';
  jsonVD?: 'Y';
}

export interface SearchStatisticsParams {
  method: 'getList';
  apiKey: string;
  searchNm: string;   // 검색명 (필수)
  orgId?: string;     // 기관코드 (선택)
  sort?: 'RANK' | 'DATE'; // 정렬: RANK(정확도순), DATE(최신순)
  startCount?: number;    // 페이지 번호
  resultCount?: number;   // 데이터 출력 개수
  format: 'json';
  content?: 'html' | 'json'; // 헤더 유형
}

// MCP 도구용 간소화된 타입
export interface SimplifiedStatisticsItem {
  orgId: string;
  orgName: string;
  tableId: string;
  tableName: string;
  statisticsName?: string;
  period: string;
  periodType: string;
  lastUpdated?: string;
}

export interface SimplifiedDataItem {
  period: string;
  value: string;
  classification: string;
  item: string;
  unit: string;
}

export interface ListItem {
  id: string;
  name: string;
  isTable: boolean;
  orgId?: string;
  tableId?: string;
  tableName?: string;
}
