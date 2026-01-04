/**
 * 통계 분류 체계 리소스
 */

import { config } from '../config/index.js';

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
      code: 'MT_ZTITLE',
      name: '국내통계 주제별',
      description: '인구, 경제, 사회 등 주제별로 분류된 국내 통계',
      children: [
        { code: 'A', name: '인구·가구' },
        { code: 'B', name: '고용·노동·임금' },
        { code: 'C', name: '물가·가계' },
        { code: 'D', name: '보건·사회·복지' },
        { code: 'E', name: '교육·문화·과학' },
        { code: 'F', name: '환경' },
        { code: 'G', name: '농림수산업' },
        { code: 'H', name: '광업·제조업·에너지' },
        { code: 'I', name: '건설·주택·토지' },
        { code: 'J', name: '교통·정보통신' },
        { code: 'K', name: '도소매·서비스' },
        { code: 'L', name: '경기·기업경영' },
        { code: 'M', name: '무역·외환·국제수지' },
        { code: 'N', name: '통화·금융' },
        { code: 'O', name: '재정·조세' },
        { code: 'P', name: '국민계정' },
      ],
    },
    {
      code: 'MT_OTITLE',
      name: '국내통계 기관별',
      description: '통계 작성기관별로 분류된 국내 통계',
    },
    {
      code: 'MT_GTITLE01',
      name: 'e-지방지표(주제별)',
      description: '지방자치단체 통계 (주제별)',
    },
    {
      code: 'MT_GTITLE02',
      name: 'e-지방지표(지역별)',
      description: '지방자치단체 통계 (지역별)',
    },
    {
      code: 'MT_RTITLE',
      name: '국제통계',
      description: 'OECD, UN 등 국제기구 통계',
    },
    {
      code: 'MT_BUKHAN',
      name: '북한통계',
      description: '북한 관련 통계',
    },
    {
      code: 'MT_TM1_TITLE',
      name: '대상별통계',
      description: '여성, 청소년, 고령자 등 대상별 통계',
    },
    {
      code: 'MT_TM2_TITLE',
      name: '이슈별통계',
      description: '사회적 이슈별 통계',
    },
  ];
}

/**
 * 리소스용 JSON 데이터 생성
 */
export function getCategoryTreeJson(): string {
  return JSON.stringify(
    {
      name: 'KOSIS 통계 분류 체계',
      description: '국가통계포털(KOSIS)의 통계 분류 구조',
      lastUpdated: new Date().toISOString().split('T')[0],
      categories: getCategoryTree(),
    },
    null,
    2
  );
}
