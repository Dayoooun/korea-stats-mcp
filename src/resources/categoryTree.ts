/**
 * 통계 분류 체계 리소스
 */

export interface CategoryNode {
  code: string;
  name: string;
  description?: string;
  children?: CategoryNode[];
}

/**
 * 사용 가능한 서비스뷰(분류 체계) 목록
 */
export function getCategoryTree(): CategoryNode[] {
  return [
    {
      code: "MT_ZTITLE",
      name: "국내통계 주제별",
      description: "인구, 경제, 사회 등 주제별로 분류된 국내 통계",
      children: [
        { code: "A", name: "인구·가구" },
        { code: "B", name: "고용·노동·임금" },
        { code: "C", name: "물가·가계" },
        { code: "D", name: "보건·사회·복지" },
        { code: "E", name: "교육·문화·과학" },
        { code: "F", name: "환경" },
        { code: "G", name: "농림수산업" },
        { code: "H", name: "광업·제조업·에너지" },
        { code: "I", name: "건설·주택·토지" },
        { code: "J", name: "교통·정보통신" },
        { code: "K", name: "도소매·서비스" },
        { code: "L", name: "경기·기업경영" },
        { code: "M", name: "무역·외환·국제수지" },
        { code: "N", name: "통화·금융" },
        { code: "O", name: "재정·조세" },
        { code: "P", name: "국민계정" },
      ],
    },
    {
      code: "MT_OTITLE",
      name: "국내통계 기관별",
      description: "통계 작성기관별로 분류된 국내 통계",
    },
    {
      code: "MT_GTITLE01",
      name: "e-지방지표(주제별)",
      description: "지방자치단체 통계 (주제별)",
    },
    {
      code: "MT_GTITLE02",
      name: "e-지방지표(지역별)",
      description: "지방자치단체 통계 (지역별)",
    },
    {
      code: "MT_RTITLE",
      name: "국제통계",
      description: "OECD, UN 등 국제기구 통계",
    },
    {
      code: "MT_BUKHAN",
      name: "북한통계",
      description: "북한 관련 통계",
    },
    {
      code: "MT_TM1_TITLE",
      name: "대상별통계",
      description: "여성, 청소년, 고령자 등 대상별 통계",
    },
    {
      code: "MT_TM2_TITLE",
      name: "이슈별통계",
      description: "사회적 이슈별 통계",
    },
  ];
}

/**
 * 리소스용 JSON 데이터 생성
 */
export function getCategoryTreeJson(): string {
  return JSON.stringify(
    {
      name: "정적 참고용 KOSIS 통계 분류 안내",
      description:
        "통계 탐색을 위한 정적 분류 안내이며 공식 전체 분류의 실시간 조회가 아닙니다.",
      metadataStatus: "static_reference",
      lastUpdated: new Date().toISOString().split("T")[0],
      lastUpdatedSemantics:
        "안내를 생성한 날짜이며, 공식 분류의 갱신 시점이 아닙니다.",
      limitations: [
        "현재 공식 목록은 get_statistics_list에서 확인하세요.",
        "이 안내의 분류를 통계표의 항목·지역 차원 선택값으로 사용하지 마세요.",
      ],
      categories: getCategoryTree(),
    },
    null,
    2,
  );
}
